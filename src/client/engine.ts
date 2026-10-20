/**
 * The page's execution engine: one scheduler wired to the graph store, the execution store, the
 * real runners and the graph Worker. Components call the functions exported here.
 */

import { findModel, isUploadSafe } from "@/atlas/models";
import type { EdgePair } from "@/engine/graph";
import type { NodeKind } from "@/engine/nodes";
import { nodesToRun, type RunScope, type Value } from "@/engine/run";
import { isStressNode } from "@/engine/stress";
import { t, type MessageKey } from "@/i18n";
import { executionStore } from "@/store/execution";
import { graphStore } from "@/store/graph";
import type { GraphSnapshot, KEdge, KNode } from "@/store/types";
import { graphClient } from "@/workers/graph-client";

import * as api from "./atlas-client";
import { createRunners, resumeRunner, type RunnerDeps } from "./runners";
import { Scheduler } from "./scheduler";
import { effectiveMode, uiStore } from "./ui";

export const MAX_CONCURRENT = 3;

/** Files picked in upload nodes, by node id. Kept in memory only (lost on reload). */
export const uploadFiles = new Map<string, File>();

/** Results by cache key (EX-04). Persisted with the canvas (see persist.ts). */
export const resultCache = new Map<string, Value>();

const portName = (port: string) => {
  const type = port.replace(/^in:/, "");
  return type === "any" ? t("port.any") : t(`port.${type}` as MessageKey);
};

const runnerDeps: RunnerDeps = {
  api,
  files: uploadFiles,
  messages: { noFile: t("run.noFile"), failed: t("run.failed") },
};

export const scheduler = new Scheduler({
  graph: () => graphStore.getState(),
  exec: executionStore,
  runners: createRunners(runnerDeps),
  cache: resultCache,
  maxConcurrent: MAX_CONCURRENT,
  now: () => Date.now(),
  order: async (nodeIds, edges) => (await graphClient().run({ op: "topoSort", nodeIds, edges })).order,
  uploadSafe: (_kind, params) => isUploadSafe(findModel(String(params.model ?? ""))),
  fingerprint: (id, kind) => {
    if (kind !== "imageUpload") return undefined;
    const f = uploadFiles.get(id);
    return f ? { name: f.name, size: f.size, modified: f.lastModified } : null;
  },
  messages: {
    missingInput: (port) => t("run.missingInput", { port: portName(port) }),
    uploadBlocked: t("run.uploadBlocked"),
    cancelled: t("run.cancelled"),
    emptyText: t("run.emptyText"),
  },
  onError: (_id, error) => handleRunError(error),
});

/** AT-06: a 402 pauses live mode on this page and offers demo mode; a 401 means the session ended. */
export function handleRunError(error: unknown) {
  if (!(error instanceof api.ApiError)) return;
  if (error.code === "insufficient_balance" || error.code === "budget_exhausted") uiStore.setState({ liveBlocked: true });
  if (error.status === 401) uiStore.setState((s) => ({ sessionEnded: true, modeVersion: s.modeVersion + 1 }));
}

/** Kinds that cost money in live mode (at most 8 per run). */
const BILLABLE: ReadonlySet<string> = new Set(["llm", "textToImage", "imageTool", "imageToVideo"]);
export const MAX_BILLABLE_PER_RUN = 8;

/**
 * Run guard. Stress-test nodes never run, in either mode: they exist to measure rendering,
 * and 500 of them would only flood the demo endpoints. In live mode a run also takes at most 8
 * billable nodes. The server's budgets and rate limits are the real defence; this stops an
 * oversized run from sending its first eight requests and failing on the ninth.
 */
export function runProblem(scope: RunScope): string | null {
  const { nodes, edges } = graphStore.getState();
  const pairs: EdgePair[] = edges.map((e) => [e.source, e.target]);
  const ids = new Set(
    nodesToRun(scope, nodes.map((n) => n.id), pairs, (id) => executionStore.getState().byId[id]?.status ?? "idle"),
  );
  const picked = nodes.filter((n) => ids.has(n.id));
  if (picked.some((n) => isStressNode(n.id))) return t("run.stressOnly");
  if (effectiveMode() !== "live") return null;
  const billable = picked.filter((n) => BILLABLE.has(n.type ?? "")).length;
  return billable > MAX_BILLABLE_PER_RUN ? t("run.tooManyLive", { count: billable, max: MAX_BILLABLE_PER_RUN }) : null;
}

function guarded(scope: RunScope) {
  const problem = runProblem(scope);
  if (problem) {
    uiStore.setState({ notice: problem });
    return Promise.resolve([] as string[]);
  }
  return scheduler.run(scope);
}

export const runAll = () => guarded({ type: "all" });
export const runFrom = (nodeId: string) => guarded({ type: "from", nodeId });
export const retry = (nodeId: string) => guarded({ type: "only", nodeId });
export const cancelNode = (nodeId: string) => scheduler.cancelNode(nodeId);
export const stopAll = () => scheduler.cancelAll();

/**
 * TP-02: replaces the canvas with an imported document, as one undoable step. Its nodes start
 * idle: results and picked files of earlier nodes with the same ids do not carry over.
 */
export function openWorkflow(graph: GraphSnapshot) {
  stopAll();
  const ids = graph.nodes.map((n) => n.id);
  for (const id of ids) uploadFiles.delete(id);
  executionStore.getState().forget(ids);
  graphStore.getState().loadDocument(graph);
}

/** EX-07: continue predictions that were in flight when the page was reloaded. */
export function resumeInFlight() {
  const requeue: string[] = [];
  for (const [id, exec] of Object.entries(executionStore.getState().byId)) {
    if (exec.status === "queued") {
      // Not submitted yet: queue it again so the interrupted run finishes.
      executionStore.getState().patch(id, { status: exec.output ? "stale" : "idle" });
      requeue.push(id);
    }
    if (exec.status !== "running") continue;
    if (exec.prediction) scheduler.resume(id, resumeRunner(runnerDeps, exec.prediction));
    else executionStore.getState().patch(id, { status: "failed", error: t("run.interrupted") });
  }
  if (requeue.length > 0) void scheduler.run({ type: "nodes", ids: requeue });
}

/** AT-06 / DM-05: switch this tab to demo results; the canvas keeps its structure. */
export function continueInDemoMode() {
  api.setDemoOverride(true);
  uiStore.setState((s) => ({ liveBlocked: false, sessionEnded: false, modeVersion: s.modeVersion + 1 }));
}

// ── Staleness (CV-11, EX-05): what changed in the document invalidates itself and downstream ──

function changedForExecution(prev: { nodes: KNode[]; edges: KEdge[] }, next: { nodes: KNode[]; edges: KEdge[] }): string[] {
  const changed = new Set<string>();
  const before = new Map(prev.nodes.map((n) => [n.id, n.data]));
  for (const n of next.nodes) {
    const data = before.get(n.id);
    if (data !== undefined && data !== n.data) changed.add(n.id);
  }
  const key = (e: KEdge) => e.id;
  const prevEdges = new Set(prev.edges.map(key));
  const nextEdges = new Set(next.edges.map(key));
  for (const e of next.edges) if (!prevEdges.has(e.id)) changed.add(e.target);
  for (const e of prev.edges) if (!nextEdges.has(e.id)) changed.add(e.target);
  return [...changed];
}

/** Mark `ids` and everything downstream of them stale. */
export function invalidate(ids: string[]) {
  if (ids.length === 0) return;
  const edges: EdgePair[] = graphStore.getState().edges.map((e) => [e.source, e.target]);
  executionStore.getState().markStale(ids);
  // Downstream of the change, computed in the Worker (PF-05).
  void Promise.all(ids.map((nodeId) => graphClient().run({ op: "descendants", edges, nodeId }))).then((lists) =>
    executionStore.getState().markStale(lists.flat()),
  );
}

let watching = false;

export function watchGraphForStaleness() {
  if (watching) return;
  watching = true;
  graphStore.subscribe((next, prev) => {
    if (next.nodes === prev.nodes && next.edges === prev.edges) return;
    if (next.restoreSeq !== prev.restoreSeq) return; // loaded from storage, not edited
    invalidate(changedForExecution(prev, next));
  });
}

export function kindOf(id: string): NodeKind | undefined {
  const n = graphStore.getState().nodes.find((x) => x.id === id);
  return n && n.type !== "group" ? (n.type as NodeKind) : undefined;
}

/**
 * AT-08: a stored result URL stopped loading (Atlas deletes outputs after its retention period).
 * Nodes holding it drop the dead link and go stale with an "expired" note; the cache forgets it.
 * Demo samples and local previews never expire.
 */
export function markExpired(url: string) {
  if (!/^https:\/\//.test(url)) return;
  for (const [key, value] of resultCache) if (value.value === url) resultCache.delete(key);
  const store = executionStore.getState();
  for (const [id, exec] of Object.entries(store.byId)) {
    if (exec.output?.value !== url) continue;
    store.patch(id, { status: "stale", output: undefined, cacheKey: undefined, hint: "expired" });
  }
}
