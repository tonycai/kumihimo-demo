import { describe, expect, it } from "vitest";

import type { NodeKind } from "@/engine/nodes";
import type { EdgeRef, Value } from "@/engine/run";
import { createExecutionStore, execOf } from "@/store/execution";

import { Scheduler, type NodeRunner, type RunContext } from "./scheduler";

interface Deferred {
  ctx: RunContext;
  resolve(v: Value | null): void;
  reject(e: Error): void;
}

function harness(
  nodes: { id: string; type: NodeKind; data?: Record<string, unknown> }[],
  edges: EdgeRef[],
  opts: { maxConcurrent?: number; uploadSafeModels?: string[] } = {},
) {
  const exec = createExecutionStore();
  const pending: Deferred[] = [];
  const calls: string[] = [];
  const remote: NodeRunner = (ctx) =>
    new Promise((resolve, reject) => {
      calls.push(ctx.nodeId);
      const d: Deferred = { ctx, resolve, reject };
      pending.push(d);
      ctx.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const graph = { nodes: nodes.map((n) => ({ ...n, data: n.data ?? {} })), edges };
  const scheduler = new Scheduler({
    graph: () => graph,
    exec,
    runners: {
      llm: remote,
      textToImage: remote,
      imageTool: remote,
      imageToVideo: remote,
      imageUpload: remote,
    },
    cache: new Map(),
    maxConcurrent: opts.maxConcurrent ?? 3,
    now: () => 1_000,
    uploadSafe: (_kind, params) => (opts.uploadSafeModels ?? []).includes(String(params.model)),
    messages: {
      missingInput: (p) => `Connect ${p}`,
      uploadBlocked: "Upload not allowed",
      cancelled: "Cancelled",
      emptyText: "Empty",
    },
  });
  const status = (id: string) => execOf(id, exec).status;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const finish = async (id: string, value: Value) => {
    const d = pending.find((p) => p.ctx.nodeId === id)!;
    pending.splice(pending.indexOf(d), 1);
    d.resolve(value);
    await settle();
  };
  return { scheduler, exec, graph, pending, calls, status, settle, finish };
}

const img = (v: string): Value => ({ type: "image", value: v });
const vid = (v: string): Value => ({ type: "video", value: v });

// text → t2i → v1, v2, v3 (each with its own prompt) → preview
function example() {
  const nodes: { id: string; type: NodeKind; data?: Record<string, unknown> }[] = [
    { id: "text", type: "textPrompt", data: { text: "crane" } },
    { id: "t2i", type: "textToImage", data: { model: "m", seed: 1 } },
    ...[1, 2, 3].flatMap((i) => [
      { id: `p${i}`, type: "textPrompt" as const, data: { text: `shot ${i}` } },
      { id: `v${i}`, type: "imageToVideo" as const, data: { model: "wan" } },
    ]),
    { id: "pre", type: "outputPreview" },
  ];
  const edges: EdgeRef[] = [
    { source: "text", target: "t2i", targetHandle: "in:text" },
    ...[1, 2, 3].flatMap((i) => [
      { source: "t2i", target: `v${i}`, targetHandle: "in:image" },
      { source: `p${i}`, target: `v${i}`, targetHandle: "in:text" },
      { source: `v${i}`, target: "pre", targetHandle: "in:any" },
    ]),
  ];
  return { nodes, edges };
}

describe("Scheduler", () => {
  it("runs in dependency order with fan-out in parallel (EX-01)", async () => {
    const { nodes, edges } = example();
    const h = harness(nodes, edges);
    await h.scheduler.run({ type: "all" });
    expect(h.status("text")).toBe("succeeded"); // local, instant
    expect(h.calls).toEqual(["t2i"]);
    expect(h.status("v1")).toBe("queued");
    await h.finish("t2i", img("https://x/a.png"));
    expect(h.calls.slice(1).sort()).toEqual(["v1", "v2", "v3"]);
    expect(["v1", "v2", "v3"].map(h.status)).toEqual(["running", "running", "running"]);
    // EX-03: the video got the upstream URL and its own prompt.
    expect(h.pending[0].ctx.inputs).toEqual({ "in:image": [img("https://x/a.png")], "in:text": [{ type: "text", value: "shot 1" }] });
    for (const v of ["v1", "v2", "v3"]) await h.finish(v, vid(`https://x/${v}.mp4`));
    expect(h.status("pre")).toBe("succeeded");
    expect(h.scheduler.busy).toBe(false);
  });

  it("never runs more Atlas tasks than the cap (EX-02)", async () => {
    const { nodes, edges } = example();
    const h = harness(nodes, edges, { maxConcurrent: 2 });
    await h.scheduler.run({ type: "all" });
    await h.finish("t2i", img("https://x/a.png"));
    expect(["v1", "v2", "v3"].map(h.status)).toEqual(["running", "running", "queued"]);
    await h.finish("v1", vid("https://x/1.mp4"));
    expect(h.status("v3")).toBe("running");
  });

  it("a second Run after success sends nothing; editing one shot re-runs one video (EX-04, EX-05)", async () => {
    const { nodes, edges } = example();
    const h = harness(nodes, edges);
    await h.scheduler.run({ type: "all" });
    await h.finish("t2i", img("https://x/a.png"));
    for (const v of ["v1", "v2", "v3"]) await h.finish(v, vid(`https://x/${v}.mp4`));
    const before = h.calls.length;

    await h.scheduler.run({ type: "all" });
    expect(h.calls.length).toBe(before);

    // Edit shot 2: it and its downstream go stale (done by the graph-change hook in the app).
    h.graph.nodes.find((n) => n.id === "p2")!.data = { text: "shot 2, closer" };
    h.exec.getState().markStale(["p2", "v2", "pre"]);
    await h.scheduler.run({ type: "from", nodeId: "p2" });
    expect(h.calls.slice(before)).toEqual(["v2"]);
    expect(h.status("v1")).toBe("succeeded");
    await h.finish("v2", vid("https://x/v2b.mp4"));

    // Undo the edit: the old key is cached, so the video succeeds without a request.
    h.graph.nodes.find((n) => n.id === "p2")!.data = { text: "shot 2" };
    h.exec.getState().markStale(["p2", "v2", "pre"]);
    await h.scheduler.run({ type: "from", nodeId: "p2" });
    expect(h.calls.length).toBe(before + 1);
    expect(execOf("v2", h.exec).output).toEqual(vid("https://x/v2.mp4"));
  });

  it("cancel fails the running node and puts queued downstream back (EX-06, EX-10)", async () => {
    const { nodes, edges } = example();
    const h = harness(nodes, edges);
    await h.scheduler.run({ type: "all" });
    h.scheduler.cancelAll();
    await h.settle();
    expect(h.status("t2i")).toBe("failed");
    expect(execOf("t2i", h.exec).error).toBe("Cancelled");
    expect(["v1", "v2", "v3", "pre"].map(h.status)).toEqual(["idle", "idle", "idle", "idle"]);
    expect(h.scheduler.busy).toBe(false);
  });

  it("an upstream failure returns waiting nodes to their previous state with a hint (EX-10)", async () => {
    const { nodes, edges } = example();
    const h = harness(nodes, edges);
    await h.scheduler.run({ type: "all" });
    h.pending[0].reject(new Error("prompt rejected by safety filter"));
    await h.settle();
    expect(h.status("t2i")).toBe("failed");
    expect(execOf("t2i", h.exec).error).toBe("prompt rejected by safety filter");
    expect(execOf("v1", h.exec)).toMatchObject({ status: "idle", hint: "waiting_upstream" });
  });

  it("Retry runs just the failed node (EX-08)", async () => {
    const { nodes, edges } = example();
    const h = harness(nodes, edges);
    await h.scheduler.run({ type: "all" });
    await h.finish("t2i", img("https://x/a.png"));
    h.pending.find((p) => p.ctx.nodeId === "v2")!.reject(new Error("boom"));
    for (const v of ["v1", "v3"]) await h.finish(v, vid(`https://x/${v}.mp4`));
    const before = h.calls.length;
    await h.scheduler.run({ type: "only", nodeId: "v2" });
    expect(h.calls.slice(before)).toEqual(["v2"]);
  });

  it("fails nodes with a required input missing, without calling Atlas", async () => {
    const h = harness([{ id: "v", type: "imageToVideo" }], []);
    await h.scheduler.run({ type: "all" });
    expect(execOf("v", h.exec)).toMatchObject({ status: "failed", error: "Connect in:image" });
    expect(h.calls).toEqual([]);
  });

  describe("upload rule", () => {
    const upload = { id: "u", type: "imageUpload" as const };
    const prompt = { id: "p", type: "textPrompt" as const, data: { text: "rain" } };

    it("blocks upload → video", async () => {
      const h = harness([upload, prompt, { id: "v", type: "imageToVideo", data: { model: "wan" } }], [
        { source: "u", target: "v", targetHandle: "in:image" },
        { source: "p", target: "v", targetHandle: "in:text" },
      ], { uploadSafeModels: ["atlas-up"] });
      await h.scheduler.run({ type: "all" });
      await h.finish("u", img("https://files/u.png"));
      expect(execOf("v", h.exec)).toMatchObject({ status: "failed", error: "Upload not allowed" });
      expect(h.calls).toEqual(["u"]);
    });

    it("blocks upload → upscale → video, while the Atlas-run upscale itself runs", async () => {
      const h = harness(
        [upload, prompt, { id: "up", type: "imageTool", data: { model: "atlas-up" } }, { id: "v", type: "imageToVideo", data: { model: "wan" } }],
        [
          { source: "u", target: "up", targetHandle: "in:image" },
          { source: "up", target: "v", targetHandle: "in:image" },
          { source: "p", target: "v", targetHandle: "in:text" },
        ],
        { uploadSafeModels: ["atlas-up"] },
      );
      await h.scheduler.run({ type: "all" });
      await h.finish("u", img("https://files/u.png"));
      expect(h.status("up")).toBe("running");
      await h.finish("up", img("https://x/up.png"));
      expect(execOf("v", h.exec)).toMatchObject({ status: "failed", error: "Upload not allowed" });
      expect(h.calls).toEqual(["u", "up"]);
    });

    it("leaves text-to-image → video alone", async () => {
      const h = harness(
        [prompt, { id: "t", type: "textToImage", data: { model: "m" } }, { id: "v", type: "imageToVideo", data: { model: "wan" } }],
        [
          { source: "p", target: "t", targetHandle: "in:text" },
          { source: "t", target: "v", targetHandle: "in:image" },
          { source: "p", target: "v", targetHandle: "in:text" },
        ],
        { uploadSafeModels: ["atlas-up"] },
      );
      await h.scheduler.run({ type: "all" });
      await h.finish("t", img("https://x/t.png"));
      expect(h.status("v")).toBe("running");
    });
  });

  it("a result for a node edited mid-run arrives stale", async () => {
    const h = harness([{ id: "p", type: "textPrompt", data: { text: "a" } }, { id: "t", type: "textToImage", data: { model: "m", seed: 1 } }], [
      { source: "p", target: "t", targetHandle: "in:text" },
    ]);
    await h.scheduler.run({ type: "all" });
    h.graph.nodes.find((n) => n.id === "t")!.data = { model: "m", seed: 2 };
    await h.finish("t", img("https://x/t.png"));
    expect(h.status("t")).toBe("stale");
  });

  it("a prediction resumed after a reload finishes as succeeded under its own run key (EX-07)", async () => {
    const h = harness(
      [{ id: "p", type: "textPrompt", data: { text: "a" } }, { id: "t", type: "textToImage", data: { model: "m", seed: 1 } }],
      [{ source: "p", target: "t", targetHandle: "in:text" }],
    );
    await h.scheduler.run({ type: "all" });
    h.pending[0].ctx.report({ prediction: { id: "pred-1", kind: "image" } });
    const runKey = execOf("t", h.exec).runKey;
    expect(runKey).toBeDefined();
    // "Reload": a new scheduler over the persisted execution state resumes polling.
    const after = new Scheduler({
      graph: () => h.graph,
      exec: h.exec,
      runners: {},
      cache: new Map(),
      maxConcurrent: 3,
      now: () => 2_000,
      uploadSafe: () => true,
      messages: { missingInput: () => "", uploadBlocked: "", cancelled: "Cancelled", emptyText: "" },
    });
    after.resume("t", async () => img("https://x/resumed.png"));
    await h.settle();
    expect(execOf("t", h.exec)).toMatchObject({ status: "succeeded", cacheKey: runKey, output: img("https://x/resumed.png") });
  });
});
