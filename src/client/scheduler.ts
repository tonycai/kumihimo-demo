/**
 * Run scheduler. Owns timing, requests and the execution store; every decision comes
 * from the pure rules in `src/engine/run.ts`. Topological order comes from the graph Worker.
 */

import { topoSort, type EdgePair } from "@/engine/graph";
import type { NodeKind } from "@/engine/nodes";
import {
  cacheKey,
  fedByUpload,
  inputsOf,
  missingInputs,
  nodesToRun,
  readiness,
  type EdgeRef,
  type RunScope,
  type RunStatus,
  type Value,
} from "@/engine/run";
import { execOf, type ExecutionStoreApi, type NodeExec } from "@/store/execution";

export interface GraphView {
  nodes: readonly { id: string; type?: string; data: unknown }[];
  edges: readonly EdgeRef[];
}

export interface RunContext {
  nodeId: string;
  kind: NodeKind;
  params: Record<string, unknown>;
  inputs: Record<string, Value[]>;
  signal: AbortSignal;
  /** Progress the runner wants on screen or persisted (stream text, prediction id). */
  report(patch: Partial<NodeExec>): void;
}

/** Returns the node's output, or null for nodes without one (Output Preview). */
export type NodeRunner = (ctx: RunContext) => Promise<Value | null>;

export interface SchedulerMessages {
  missingInput(port: string): string;
  uploadBlocked: string;
  cancelled: string;
  emptyText: string;
}

export interface SchedulerDeps {
  graph(): GraphView;
  exec: ExecutionStoreApi;
  runners: Partial<Record<NodeKind, NodeRunner>>;
  cache: Map<string, Value>;
  /** EX-02: Atlas-bound tasks at once (default 3). Local nodes do not count. */
  maxConcurrent: number;
  now(): number;
  /** Kahn order, computed in the Worker (PF-05). Falls back to in-thread when absent. */
  order?(nodeIds: string[], edges: EdgePair[]): Promise<string[]>;
  /** Upload provenance: may this node's model take upload-derived images? */
  uploadSafe(kind: NodeKind, params: Record<string, unknown>): boolean;
  /** Anything the runner's result depends on beyond params and inputs (picked file). */
  fingerprint?(nodeId: string, kind: NodeKind): unknown;
  messages: SchedulerMessages;
  onError?(nodeId: string, error: unknown): void;
}

/** Nodes that call Atlas and therefore take a concurrency slot. */
const REMOTE: ReadonlySet<NodeKind> = new Set(["llm", "textToImage", "imageTool", "imageToVideo", "imageUpload"]);
/**
 * Local nodes finish inside the same scheduling pass (ND-01 "succeeds immediately", ND-07): text passes its
 * own value on; the preview has no output of its own.
 */
function localResult(kind: NodeKind, params: Record<string, unknown>): { value: Value | null } | { empty: true } | null {
  if (kind === "textPrompt") {
    const text = typeof params.text === "string" ? params.text.trim() : "";
    return text ? { value: { type: "text", value: text } } : { empty: true };
  }
  if (kind === "outputPreview") return { value: null };
  return null;
}

/** Nodes whose model choice is constrained by the upload rule. */
const MODEL_KINDS: ReadonlySet<NodeKind> = new Set(["llm", "textToImage", "imageTool", "imageToVideo"]);

export class Scheduler {
  private readonly queued = new Map<string, RunStatus>(); // node → status before it was queued
  private readonly running = new Map<string, AbortController>();
  private order: string[] = [];
  private pumping = false;

  constructor(private readonly deps: SchedulerDeps) {}

  private status(id: string): RunStatus {
    return execOf(id, this.deps.exec).status;
  }

  private patch(id: string, patch: Partial<NodeExec>) {
    this.deps.exec.getState().patch(id, patch);
  }

  private pairs(edges: readonly EdgeRef[]): EdgePair[] {
    return edges.map((e) => [e.source, e.target] as const);
  }

  get busy(): boolean {
    return this.queued.size > 0 || this.running.size > 0;
  }

  isActive(id: string): boolean {
    return this.queued.has(id) || this.running.has(id);
  }

  /** Queue the nodes in `scope` and start whatever is ready. Resolves once they are queued. */
  async run(scope: RunScope): Promise<string[]> {
    const g = this.deps.graph();
    const ids = g.nodes.map((n) => n.id);
    const pairs = this.pairs(g.edges);
    const picked = nodesToRun(scope, ids, pairs, (id) => this.status(id)).filter((id) => {
      const kind = g.nodes.find((n) => n.id === id)?.type;
      return kind !== undefined && kind !== "group";
    });
    for (const id of picked) {
      this.queued.set(id, this.status(id));
      this.patch(id, { status: "queued", error: undefined, hint: undefined });
    }
    this.order = this.deps.order ? await this.deps.order(ids, pairs) : topoSort(ids, pairs).order;
    this.pump();
    return picked;
  }

  /** Stop everything: running tasks fail as Cancelled, queued ones go back (EX-06, EX-10). */
  cancelAll() {
    for (const id of [...this.queued.keys()]) this.revert(id, false);
    for (const controller of this.running.values()) controller.abort();
  }

  cancelNode(id: string) {
    if (this.queued.has(id)) this.revert(id, false);
    this.running.get(id)?.abort();
    this.pump();
  }

  /** EX-07: pick up an in-flight prediction after a reload, without resubmitting. */
  resume(id: string, runner: NodeRunner) {
    const g = this.deps.graph();
    const node = g.nodes.find((n) => n.id === id);
    if (!node || this.running.has(id)) return;
    const inputs = inputsOf(id, g.edges, (x) => execOf(x, this.deps.exec).output);
    const exec = execOf(id, this.deps.exec);
    this.launch(id, node.type as NodeKind, (node.data ?? {}) as Record<string, unknown>, inputs, runner, exec.runKey ?? exec.cacheKey);
  }

  private revert(id: string, becauseUpstream: boolean) {
    const previous = this.queued.get(id) ?? "idle";
    this.queued.delete(id);
    this.patch(id, { status: previous, hint: becauseUpstream ? "waiting_upstream" : undefined });
  }

  private remoteRunning(): number {
    const g = this.deps.graph();
    let n = 0;
    for (const id of this.running.keys()) {
      const kind = g.nodes.find((x) => x.id === id)?.type as NodeKind | undefined;
      if (kind && REMOTE.has(kind)) n++;
    }
    return n;
  }

  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      let progressed = true;
      while (progressed) {
        progressed = false;
        const g = this.deps.graph();
        for (const id of this.order) {
          if (!this.queued.has(id)) continue;
          const node = g.nodes.find((n) => n.id === id);
          if (!node) {
            this.queued.delete(id);
            continue;
          }
          const ready = readiness(id, g.edges, (x) => this.status(x));
          if (ready === "blocked") {
            this.revert(id, true);
            progressed = true;
            continue;
          }
          if (ready === "waiting") continue;
          const kind = node.type as NodeKind;
          if (REMOTE.has(kind) && this.remoteRunning() >= this.deps.maxConcurrent) continue;
          this.queued.delete(id);
          if (this.start(id, kind, (node.data ?? {}) as Record<string, unknown>, g)) progressed = true;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Returns true when the node finished synchronously (local, cache hit, or refused). */
  private start(id: string, kind: NodeKind, params: Record<string, unknown>, g: GraphView): boolean {
    const now = this.deps.now();
    this.patch(id, { status: "running", startedAt: now, finishedAt: undefined, error: undefined, streamText: undefined });

    const missing = missingInputs(kind, id, g.edges);
    if (missing.length > 0) return this.fail(id, this.deps.messages.missingInput(missing[0]));

    const pairs = this.pairs(g.edges);
    const kindOf = (x: string) => g.nodes.find((n) => n.id === x)?.type;
    if (MODEL_KINDS.has(kind) && fedByUpload(id, pairs, kindOf) && !this.deps.uploadSafe(kind, params)) {
      return this.fail(id, this.deps.messages.uploadBlocked);
    }

    const inputs = inputsOf(id, g.edges, (x) => execOf(x, this.deps.exec).output);
    const key = cacheKey(kind, params, inputs, this.deps.fingerprint?.(id, kind));
    const local = localResult(kind, params);
    if (local) {
      if ("empty" in local) return this.fail(id, this.deps.messages.emptyText);
      this.succeed(id, local.value, key);
      return true;
    }
    const cached = this.deps.cache.get(key);
    if (cached) {
      this.succeed(id, cached, key);
      return true;
    }
    const runner = this.deps.runners[kind];
    if (!runner) {
      this.succeed(id, null, key);
      return true;
    }
    this.launch(id, kind, params, inputs, runner, key);
    return false;
  }

  private launch(
    id: string,
    kind: NodeKind,
    params: Record<string, unknown>,
    inputs: Record<string, Value[]>,
    runner: NodeRunner,
    key: string | undefined,
  ) {
    const controller = new AbortController();
    this.running.set(id, controller);
    this.patch(id, { runKey: key });
    if (this.status(id) !== "running") this.patch(id, { status: "running", startedAt: this.deps.now() });
    runner({ nodeId: id, kind, params, inputs, signal: controller.signal, report: (p) => this.patch(id, p) })
      .then(
        (value) => {
          if (controller.signal.aborted) this.fail(id, this.deps.messages.cancelled);
          else this.succeed(id, value, key);
        },
        (error: unknown) => {
          this.deps.onError?.(id, error);
          const message = controller.signal.aborted
            ? this.deps.messages.cancelled
            : error instanceof Error
              ? error.message
              : String(error);
          this.fail(id, message);
        },
      )
      .finally(() => {
        this.running.delete(id);
        this.pump();
      });
  }

  /** Key for the node as the graph stands now; differs from the run's key if edited meanwhile. */
  private currentKey(id: string): string | undefined {
    const g = this.deps.graph();
    const node = g.nodes.find((n) => n.id === id);
    if (!node) return undefined;
    const kind = node.type as NodeKind;
    const inputs = inputsOf(id, g.edges, (x) => execOf(x, this.deps.exec).output);
    return cacheKey(kind, node.data ?? {}, inputs, this.deps.fingerprint?.(id, kind));
  }

  private succeed(id: string, value: Value | null, key: string | undefined) {
    if (value && key) this.deps.cache.set(key, value);
    const edited = key !== undefined && this.currentKey(id) !== key;
    this.patch(id, {
      status: edited ? "stale" : "succeeded",
      finishedAt: this.deps.now(),
      output: value ?? undefined,
      cacheKey: key,
      runKey: undefined,
      prediction: undefined,
      streamText: undefined,
      hint: undefined,
    });
  }

  private fail(id: string, error: string): true {
    this.patch(id, { status: "failed", finishedAt: this.deps.now(), error, prediction: undefined, runKey: undefined });
    return true;
  }
}
