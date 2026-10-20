/**
 * Execution rules (EX-01 to EX-10). Pure: the scheduler on the main thread asks these
 * functions what to do; it owns timers, requests and stores. Tests call them directly.
 */

import { ancestors, descendants, type EdgePair } from "./graph";
import { NODE_SPECS, type NodeKind, type PortType } from "./nodes";

// ── State machine: 6 states, 7 transitions ────────────────────────────────────────────────────

export type RunStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "stale";

export const TRANSITIONS: readonly (readonly [RunStatus, RunStatus])[] = [
  ["idle", "queued"], // 1. included in a run
  ["queued", "running"], // 2. upstream succeeded and a slot is free
  ["running", "succeeded"], // 3. result (cache hits included)
  ["running", "failed"], // 4. data.error, timeout or cancel
  ["failed", "queued"], // 5. retry
  ["succeeded", "stale"], // 6. own parameters or upstream output changed
  ["stale", "queued"], // 7. run again
];

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/**
 * Wrap-up rule (EX-10), not an 8th transition: a queued node whose upstream can no
 * longer succeed in this run goes back to where it was before the run.
 */
export function canRevertQueued(previous: RunStatus): boolean {
  return previous === "idle" || previous === "stale" || previous === "failed";
}

// ── Values on edges (EX-03) ─────────────────────────────────────────────────────────────────

export interface Value {
  type: PortType;
  /** Text, or a result URL. */
  value: string;
  /** Video cover frame (PF-06): the image the clip was made from. */
  poster?: string;
}

export interface EdgeRef {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Values arriving at each input port of `nodeId`, in edge order. */
export function inputsOf(
  nodeId: string,
  edges: readonly EdgeRef[],
  outputOf: (id: string) => Value | undefined,
): Record<string, Value[]> {
  const inputs: Record<string, Value[]> = {};
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    const value = outputOf(e.source);
    if (!value) continue;
    const port = e.targetHandle ?? "";
    (inputs[port] ??= []).push(value);
  }
  return inputs;
}

/** Required input ports with nothing connected. */
export function missingInputs(kind: NodeKind, nodeId: string, edges: readonly EdgeRef[]): string[] {
  const connected = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.targetHandle ?? ""));
  return NODE_SPECS[kind].inputs.filter((p) => !p.optional && !connected.has(p.id)).map((p) => p.id);
}

// ── Cache (EX-04) ───────────────────────────────────────────────────────────────────────────

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

/**
 * node kind + parameters + input values (+ anything else the runner depends on, such as the
 * picked file's fingerprint). Same key, same result: no request, no spend.
 */
export function cacheKey(kind: NodeKind, params: unknown, inputs: Record<string, Value[]>, extra?: unknown): string {
  return stable({ kind, params, inputs, extra: extra ?? null });
}

// ── Run scope and readiness (EX-01, EX-05, EX-08) ───────────────────────────────────────────

export type RunScope =
  | { type: "all" }
  | { type: "from"; nodeId: string }
  | { type: "only"; nodeId: string }
  /** Continue a run interrupted by a reload (EX-07): the nodes that were still queued. */
  | { type: "nodes"; ids: readonly string[] };

/**
 * Nodes to queue. Succeeded nodes are fresh by construction (edits make them stale), so they are
 * never re-queued: "Run" after a full success sends nothing (EX-04); "Run from here" re-queues
 * only what is out of date (EX-05); Retry runs the one node (EX-08). Both also take any upstream
 * that is not done yet (an edited prompt, say); upstream that already succeeded is not re-run.
 */
export function nodesToRun(
  scope: RunScope,
  nodeIds: readonly string[],
  edges: readonly EdgePair[],
  statusOf: (id: string) => RunStatus,
): string[] {
  let candidates: string[];
  if (scope.type === "all") candidates = [...nodeIds];
  else if (scope.type === "only") candidates = [...ancestors(edges, scope.nodeId), scope.nodeId];
  else if (scope.type === "nodes") candidates = [...scope.ids];
  else candidates = [...ancestors(edges, scope.nodeId), scope.nodeId, ...descendants(edges, scope.nodeId)];
  return candidates.filter((id) => {
    const s = statusOf(id);
    return s !== "succeeded" && s !== "queued" && s !== "running";
  });
}

export type Readiness = "ready" | "waiting" | "blocked";

/**
 * ready: every upstream succeeded. waiting: some upstream is still queued or running.
 * blocked: some upstream can no longer succeed in this run (failed, idle, stale) → EX-10.
 */
export function readiness(nodeId: string, edges: readonly EdgeRef[], statusOf: (id: string) => RunStatus): Readiness {
  let waiting = false;
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    const s = statusOf(e.source);
    if (s === "succeeded") continue;
    if (s === "queued" || s === "running") waiting = true;
    else return "blocked";
  }
  return waiting ? "waiting" : "ready";
}

/** Changing a node invalidates it and everything downstream (EX-05). */
export function invalidated(changed: Iterable<string>, edges: readonly EdgePair[]): Set<string> {
  const out = new Set<string>();
  for (const id of changed) {
    out.add(id);
    for (const d of descendants(edges, id)) out.add(d);
  }
  return out;
}

// ── Upload provenance ───────────────────────────────────────────────────────────────────────

/**
 * True when an upload node feeds `nodeId` directly or through other nodes. Such a node may only
 * use a model Atlas is verified to run itself (registry `hostedByAtlas`, "uploadSafe").
 */
export function fedByUpload(nodeId: string, edges: readonly EdgePair[], kindOf: (id: string) => string | undefined): boolean {
  for (const a of ancestors(edges, nodeId)) if (kindOf(a) === "imageUpload") return true;
  return false;
}
