/**
 * Execution store, keyed by nodeId. Status, progress, outputs and stream text live
 * here, never in React Flow's nodes array, so a running node does not re-render the whole graph.
 * Not part of undo/redo.
 */

import { createStore, useStore } from "zustand";

import type { RunStatus, Value } from "@/engine/run";

export type NodeStatus = RunStatus;
export type NodeOutput = Value;

export type PredictionKind = "image" | "video";

export interface NodeExec {
  status: NodeStatus;
  startedAt?: number;
  finishedAt?: number;
  output?: NodeOutput;
  /** Cache key the output was produced for (EX-04). */
  cacheKey?: string;
  /** Cache key of the run in progress; a resumed prediction finishes under this key (EX-07). */
  runKey?: string;
  /** Upstream error text shown verbatim (AT-06), or our own reason (timeout, cancel, rules). */
  error?: string;
  /** EX-10: why a queued node went back to its previous state; AT-08: the result link died. */
  hint?: "waiting_upstream" | "expired";
  /** LLM text as it streams in (ND-02), flushed at most once per frame (PF-03). */
  streamText?: string;
  /** In-flight Atlas prediction, kept so a reload resumes polling instead of resubmitting (EX-07). */
  prediction?: { id: string; kind: PredictionKind };
  /** Upload node: object URL and name of the picked file, shown before any upload. */
  localPreview?: string;
  localName?: string;
  /** Upload node: why the picked file was refused (ND-06). */
  inputProblem?: string;
}

export interface ExecutionState {
  byId: Readonly<Record<string, NodeExec>>;
  patch(id: string, patch: Partial<NodeExec>): void;
  /** Succeeded nodes among `ids` become stale (CV-11, EX-05). Others keep their state. */
  markStale(ids: Iterable<string>): void;
  replaceAll(byId: Record<string, NodeExec>): void;
  /** Drops these nodes' entries: they start idle (an imported document reusing ids). */
  forget(ids: Iterable<string>): void;
}

const IDLE: NodeExec = { status: "idle" };

export function createExecutionStore() {
  return createStore<ExecutionState>()((set) => ({
    byId: {},
    patch: (id, patch) =>
      set((s) => ({ byId: { ...s.byId, [id]: { ...(s.byId[id] ?? IDLE), ...patch } } })),
    markStale: (ids) =>
      set((s) => {
        let byId: Record<string, NodeExec> | null = null;
        for (const id of ids) {
          if (s.byId[id]?.status !== "succeeded") continue;
          byId ??= { ...s.byId };
          byId[id] = { ...s.byId[id], status: "stale" };
        }
        return byId ? { byId } : s;
      }),
    replaceAll: (byId) => set({ byId }),
    forget: (ids) =>
      set((s) => {
        const byId = { ...s.byId };
        for (const id of ids) delete byId[id];
        return { byId };
      }),
  }));
}

export type ExecutionStoreApi = ReturnType<typeof createExecutionStore>;

export const executionStore = createExecutionStore();

export function execOf(id: string, store: ExecutionStoreApi = executionStore): NodeExec {
  return store.getState().byId[id] ?? IDLE;
}

/** One node's slot: components re-render only when their own entry changes (PF-02). */
export function useNodeExec(id: string): NodeExec {
  return useStore(executionStore, (s) => s.byId[id] ?? IDLE);
}

/**
 * Only a node's result, for components showing another node's output (Output Preview): streamed
 * words, progress and status changes leave the reference unchanged, so they cause no re-render.
 */
export function useNodeOutput(id: string): NodeExec["output"] {
  return useStore(executionStore, (s) => s.byId[id]?.output);
}
