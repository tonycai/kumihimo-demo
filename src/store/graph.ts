/**
 * Graph store: the document (nodes + edges) with snapshot undo/redo (CV-06). Only discrete edits
 * are recorded — drag end, connect, delete, paste, group, parameter edits — never each drag frame
 * or selection change.
 */

import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { createStore, useStore } from "zustand";

import { checkConnection, displacedEdges, type Verdict } from "@/engine/connection";
import { wouldCreateCycle, type EdgePair } from "@/engine/graph";
import { emptyHistory, pushHistory, redoHistory, undoHistory, type History } from "@/engine/history";
import {
  copySelection,
  edgeId,
  GROUP_TYPE,
  groupNodes,
  pasteClip,
  ungroupNodes,
  withGroupMembers,
  type Clip,
} from "@/engine/layout";
import type { NodeKind } from "@/engine/nodes";

import { defaultParams, reconcileParams } from "./defaults";
import { executionStore } from "./execution";
import type { GraphSnapshot, GroupNode, KEdge, KNode, NodeParams, WorkNode } from "./types";

export const PASTE_OFFSET = 40;

export interface GraphState extends GraphSnapshot {
  history: History<GraphSnapshot>;
  /** Snapshot taken at the first frame of a drag, recorded once the drag ends. */
  dragStart: GraphSnapshot | null;
  /** Consecutive edits with the same key (typing in one field) collapse into one undo step. */
  coalesceKey: string | null;
  clipboard: Clip<KNode, KEdge> | null;
  pasteCount: number;
  /** Bumped when the document is replaced wholesale from storage: not an edit (EX-05 watcher). */
  restoreSeq: number;

  onNodesChange(changes: NodeChange<KNode>[]): void;
  onEdgesChange(changes: EdgeChange<KEdge>[]): void;
  /** `closesCycle` comes from the Worker on the canvas; computed here when omitted. */
  connect(connection: Connection, closesCycle?: boolean): Verdict;
  addNode(kind: NodeKind, position: XYPosition): string;
  updateParams<K extends NodeKind>(id: string, patch: Partial<NodeParams[K]>, options?: { coalesce?: string }): void;
  deleteSelected(): void;
  copySelected(): boolean;
  paste(): void;
  groupSelected(): void;
  ungroupSelected(): void;
  undo(): void;
  redo(): void;
  replaceGraph(snapshot: GraphSnapshot): void;
  /** Replace the document as one undoable step (Load example). */
  loadDocument(snapshot: GraphSnapshot): void;
  /**
   * Add nodes and edges without a history step: the stress test streams 500 nodes in small batches
   * after one undoable clear, so no single React commit blocks the main thread (PF-05).
   */
  appendBatch(nodes: KNode[], edges: KEdge[]): void;
}

export interface GraphStoreOptions {
  makeId?: (prefix: string) => string;
  onParamsChanged?: (id: string) => void;
}

const randomId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export function edgePairs(edges: readonly KEdge[]): EdgePair[] {
  return edges.map((e) => [e.source, e.target] as const);
}

function snap(s: GraphSnapshot): GraphSnapshot {
  return { nodes: s.nodes, edges: s.edges };
}

function samePositions(a: readonly KNode[], b: readonly KNode[]): boolean {
  if (a.length !== b.length) return false;
  const before = new Map(a.map((n) => [n.id, n.position]));
  return b.every((n) => {
    const p = before.get(n.id);
    return p !== undefined && p.x === n.position.x && p.y === n.position.y;
  });
}

const deselectNode = (n: KNode): KNode => (n.selected ? { ...n, selected: false } : n);
const deselectEdge = (e: KEdge): KEdge => (e.selected ? { ...e, selected: false } : e);

export function createGraphStore(options: GraphStoreOptions = {}) {
  const makeId = options.makeId ?? randomId;
  const onParamsChanged = options.onParamsChanged ?? (() => {});

  return createStore<GraphState>()((set, get) => {
    /** Apply a recorded edit: push the current document, then replace it. */
    function commit(next: Partial<GraphSnapshot>, coalesceKey: string | null = null) {
      const s = get();
      set({ ...next, history: pushHistory(s.history, snap(s)), dragStart: null, coalesceKey });
    }

    function selectedIds(): Set<string> {
      return new Set(get().nodes.filter((n) => n.selected).map((n) => n.id));
    }

    return {
      nodes: [],
      edges: [],
      history: emptyHistory(),
      dragStart: null,
      coalesceKey: null,
      clipboard: null,
      pasteCount: 0,
      restoreSeq: 0,

      onNodesChange(changes) {
        const s = get();
        let dragStart = s.dragStart;
        let record: GraphSnapshot | null = null;
        let dragEnded = false;
        for (const c of changes) {
          if (c.type === "position") {
            if (c.dragging) dragStart ??= snap(s);
            else if (dragStart) {
              record = dragStart;
              dragStart = null;
              dragEnded = true;
            } else if (c.position) record ??= snap(s); // keyboard nudge
          } else if (c.type === "remove" || c.type === "add" || c.type === "replace") {
            record ??= snap(s);
          }
        }
        const nodes = applyNodeChanges(changes, s.nodes);
        if (record && dragEnded && samePositions(record.nodes, nodes)) record = null;
        if (record) set({ nodes, dragStart, history: pushHistory(s.history, record), coalesceKey: null });
        else set({ nodes, dragStart });
      },

      onEdgesChange(changes) {
        const s = get();
        const edges = applyEdgeChanges(changes, s.edges);
        if (changes.some((c) => c.type !== "select")) commit({ edges });
        else set({ edges });
      },

      connect(connection, closesCycle) {
        const s = get();
        const source = s.nodes.find((n) => n.id === connection.source);
        const target = s.nodes.find((n) => n.id === connection.target);
        const verdict = checkConnection(
          {
            sourceKind: source?.type,
            sourceHandle: connection.sourceHandle,
            targetKind: target?.type,
            targetHandle: connection.targetHandle,
          },
          closesCycle ?? wouldCreateCycle(edgePairs(s.edges), connection.source, connection.target),
        );
        if (!verdict.ok) return verdict;
        const edge: KEdge = {
          id: edgeId(connection),
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          data: { portType: verdict.portType },
          className: `edge-${verdict.portType}`,
        };
        const drop = new Set(displacedEdges(s.edges, target?.type, connection.target, connection.targetHandle));
        drop.add(edge.id);
        commit({ edges: [...s.edges.filter((e) => !drop.has(e.id)), edge] });
        return verdict;
      },

      addNode(kind, position) {
        const id = makeId("n");
        const node = { id, type: kind, position, data: defaultParams(kind), selected: true } as WorkNode;
        commit({ nodes: [...get().nodes.map(deselectNode), node] });
        return id;
      },

      updateParams(id, patch, opts) {
        const s = get();
        const node = s.nodes.find((n): n is WorkNode => n.id === id && n.type !== GROUP_TYPE);
        if (!node) return;
        const merged = reconcileParams(node.type, { ...node.data, ...patch } as NodeParams[typeof node.type]);
        const keys = Object.keys(merged) as (keyof typeof merged)[];
        if (keys.every((k) => merged[k] === (node.data as typeof merged)[k])) return;
        const nodes = s.nodes.map((n) => (n.id === id ? ({ ...n, data: merged } as KNode) : n));
        const key = opts?.coalesce ? `${id}:${opts.coalesce}` : null;
        if (key !== null && key === s.coalesceKey) set({ nodes });
        else commit({ nodes }, key);
        onParamsChanged(id);
      },

      deleteSelected() {
        const s = get();
        const ids = withGroupMembers(s.nodes, selectedIds());
        const edgeIds = new Set(s.edges.filter((e) => e.selected).map((e) => e.id));
        if (ids.size === 0 && edgeIds.size === 0) return;
        commit({
          nodes: s.nodes.filter((n) => !ids.has(n.id)),
          edges: s.edges.filter((e) => !edgeIds.has(e.id) && !ids.has(e.source) && !ids.has(e.target)),
        });
      },

      copySelected() {
        const s = get();
        const clip = copySelection(s.nodes, s.edges, selectedIds());
        if (!clip) return false;
        set({ clipboard: clip, pasteCount: 0 });
        return true;
      },

      paste() {
        const s = get();
        if (!s.clipboard) return;
        const count = s.pasteCount + 1;
        const offset = { x: PASTE_OFFSET * count, y: PASTE_OFFSET * count };
        const pasted = pasteClip(s.clipboard, (old) => makeId(old.startsWith("g_") ? "g" : "n"), offset);
        commit({
          nodes: [...s.nodes.map(deselectNode), ...pasted.nodes],
          edges: [...s.edges.map(deselectEdge), ...pasted.edges],
        });
        set({ pasteCount: count });
      },

      groupSelected() {
        const nodes = groupNodes(
          get().nodes,
          selectedIds(),
          (rect): GroupNode => ({
            id: makeId("g"),
            type: GROUP_TYPE,
            position: { x: rect.x, y: rect.y },
            width: rect.width,
            height: rect.height,
            data: { label: "" },
            selected: true,
          }),
        );
        if (nodes) commit({ nodes });
      },

      ungroupSelected() {
        let nodes: KNode[] | null = null;
        for (const n of get().nodes) {
          if (n.type === GROUP_TYPE && n.selected) nodes = ungroupNodes(nodes ?? get().nodes, n.id) ?? nodes;
        }
        if (nodes) commit({ nodes });
      },

      undo() {
        const s = get();
        const r = undoHistory(s.history, snap(s));
        if (r) set({ ...r.state, history: r.history, dragStart: null, coalesceKey: null });
      },

      redo() {
        const s = get();
        const r = redoHistory(s.history, snap(s));
        if (r) set({ ...r.state, history: r.history, dragStart: null, coalesceKey: null });
      },

      loadDocument(snapshot) {
        commit({ nodes: snapshot.nodes, edges: snapshot.edges });
        set({ pasteCount: 0 });
      },

      appendBatch(nodes, edges) {
        set((s) => ({ nodes: [...s.nodes, ...nodes], edges: [...s.edges, ...edges] }));
      },

      replaceGraph(snapshot) {
        set((s) => ({
          ...snapshot,
          history: emptyHistory(),
          dragStart: null,
          coalesceKey: null,
          pasteCount: 0,
          restoreSeq: s.restoreSeq + 1,
        }));
      },
    };
  });
}

export const graphStore = createGraphStore({
  onParamsChanged: (id) => executionStore.getState().markStale([id]),
});

export function useGraph<T>(selector: (s: GraphState) => T): T {
  return useStore(graphStore, selector);
}
