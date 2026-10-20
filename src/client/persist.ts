/**
 * Canvas autosave in IndexedDB (TP-03, EX-07). Everything stays in this browser; nothing here is
 * sent to our server. Saves about one second after the last change, and immediately when a new
 * prediction id appears so a reload resumes polling instead of resubmitting.
 */

import type { Viewport } from "@xyflow/react";

import type { Value } from "@/engine/run";
import { executionStore, type NodeExec } from "@/store/execution";
import { graphStore } from "@/store/graph";
import type { KEdge, KNode } from "@/store/types";

const DB_NAME = "kumihimo";
const STORE = "kv";
const KEY = "canvas";
export const SCHEMA_VERSION = 1;
export const AUTOSAVE_DELAY_MS = 1_000;

export interface SavedCanvas {
  version: typeof SCHEMA_VERSION;
  savedAt: number;
  nodes: KNode[];
  edges: KEdge[];
  exec: Record<string, NodeExec>;
  cache: [string, Value][];
  viewport: Viewport | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = op(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** Selection and drag flags are view state; local file previews die with the page. */
function cleanNode(n: KNode): KNode {
  const copy = { ...n } as KNode & { dragging?: boolean };
  delete copy.selected;
  delete copy.dragging;
  return copy;
}

function cleanExec(e: NodeExec): NodeExec {
  const copy = { ...e };
  delete copy.localPreview;
  delete copy.localName;
  delete copy.inputProblem;
  delete copy.streamText;
  return copy;
}

export function snapshotCanvas(cache: Map<string, Value>, viewport: Viewport | null, now: number): SavedCanvas {
  const { nodes, edges } = graphStore.getState();
  const alive = new Set(nodes.map((n) => n.id));
  return {
    version: SCHEMA_VERSION,
    savedAt: now,
    nodes: nodes.map(cleanNode),
    edges: edges.map((e) => ({ ...e, selected: false })),
    // Deleted nodes' entries are dropped (undo within the session still has them in memory).
    exec: Object.fromEntries(
      Object.entries(executionStore.getState().byId)
        .filter(([id]) => alive.has(id))
        .map(([id, e]) => [id, cleanExec(e)]),
    ),
    cache: [...cache.entries()],
    viewport,
  };
}

export interface Autosave {
  /** Last saved canvas, or null on first visit. Throws when IndexedDB is unavailable. */
  load(): Promise<SavedCanvas | null>;
  start(getViewport: () => Viewport | null, cache: Map<string, Value>): () => void;
  /** Ask for a save soon (viewport moves are not in any store). */
  touch(): void;
}

export function createAutosave(): Autosave {
  let db: IDBDatabase | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let save: (() => void) | null = null;

  return {
    async load() {
      db = await openDb();
      const saved = (await tx(db, "readonly", (s) => s.get(KEY))) as SavedCanvas | undefined;
      return saved && saved.version === SCHEMA_VERSION ? saved : null;
    },

    start(getViewport, cache) {
      save = () => {
        timer = null;
        if (!db) return;
        const data = snapshotCanvas(cache, getViewport(), Date.now());
        void tx(db, "readwrite", (s) => s.put(data, KEY)).catch(() => {});
      };
      const soon = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => save?.(), AUTOSAVE_DELAY_MS);
      };
      const offGraph = graphStore.subscribe((next, prev) => {
        if (next.nodes !== prev.nodes || next.edges !== prev.edges) soon();
      });
      const offExec = executionStore.subscribe((next, prev) => {
        const newPrediction = Object.entries(next.byId).some(
          ([id, e]) => e.prediction && e.prediction.id !== prev.byId[id]?.prediction?.id,
        );
        if (newPrediction) {
          if (timer) clearTimeout(timer);
          save?.();
        } else soon();
      });
      return () => {
        offGraph();
        offExec();
        if (timer) clearTimeout(timer);
      };
    },

    touch() {
      if (!save) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => save?.(), AUTOSAVE_DELAY_MS);
    },
  };
}
