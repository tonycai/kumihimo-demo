import { describe, expect, it } from "vitest";

import { layeredLayout } from "./auto-layout";
import type { EdgePair } from "./graph";
import {
  cacheKey,
  canRevertQueued,
  canTransition,
  fedByUpload,
  inputsOf,
  invalidated,
  missingInputs,
  nodesToRun,
  readiness,
  TRANSITIONS,
  type RunStatus,
  type Value,
} from "./run";

const ALL: RunStatus[] = ["idle", "queued", "running", "succeeded", "failed", "stale"];

describe("state machine (EX-09)", () => {
  it("allows exactly the 7 documented transitions", () => {
    expect(TRANSITIONS).toHaveLength(7);
    const allowed = ALL.flatMap((f) => ALL.filter((t) => canTransition(f, t)).map((t) => `${f}→${t}`));
    expect(allowed.sort()).toEqual(
      [
        "idle→queued",
        "queued→running",
        "running→succeeded",
        "running→failed",
        "failed→queued",
        "succeeded→stale",
        "stale→queued",
      ].sort(),
    );
  });

  it("refuses shortcuts such as idle→running or succeeded→queued", () => {
    expect(canTransition("idle", "running")).toBe(false);
    expect(canTransition("succeeded", "queued")).toBe(false);
    expect(canTransition("running", "queued")).toBe(false);
  });

  it("reverts queued nodes only to a pre-run state (EX-10)", () => {
    expect(canRevertQueued("idle")).toBe(true);
    expect(canRevertQueued("stale")).toBe(true);
    expect(canRevertQueued("running")).toBe(false);
  });
});

// text → llm → t2i → up → v1,v2,v3 ; p1→v1 p2→v2 p3→v3 ; v* → preview
const EX = {
  edges: [
    { source: "text", target: "llm", targetHandle: "in:text" },
    { source: "llm", target: "t2i", targetHandle: "in:text" },
    { source: "t2i", target: "up", targetHandle: "in:image" },
    ...[1, 2, 3].flatMap((i) => [
      { source: "up", target: `v${i}`, targetHandle: "in:image" },
      { source: `p${i}`, target: `v${i}`, targetHandle: "in:text" },
      { source: `v${i}`, target: "pre", targetHandle: "in:any" },
    ]),
  ],
  ids: ["text", "llm", "t2i", "up", "p1", "p2", "p3", "v1", "v2", "v3", "pre"],
};
const pairs: EdgePair[] = EX.edges.map((e) => [e.source, e.target]);

describe("scheduling (EX-01, EX-05)", () => {
  it("diamond: the join waits for both upstreams", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
    ];
    const status: Record<string, RunStatus> = { a: "succeeded", b: "succeeded", c: "running", d: "queued" };
    expect(readiness("d", edges, (id) => status[id])).toBe("waiting");
    status.c = "succeeded";
    expect(readiness("d", edges, (id) => status[id])).toBe("ready");
    status.c = "failed";
    expect(readiness("d", edges, (id) => status[id])).toBe("blocked");
  });

  it("fan-out: all three videos become ready together once the upscale succeeds", () => {
    const status = (id: string): RunStatus => (["text", "llm", "t2i", "up", "p1", "p2", "p3"].includes(id) ? "succeeded" : "queued");
    expect(["v1", "v2", "v3"].map((v) => readiness(v, EX.edges, status))).toEqual(["ready", "ready", "ready"]);
    expect(readiness("pre", EX.edges, status)).toBe("waiting");
  });

  it("Run skips fresh nodes; Run from here takes only stale ones downstream; Retry takes one node", () => {
    const status: Record<string, RunStatus> = Object.fromEntries(EX.ids.map((id) => [id, "succeeded"]));
    expect(nodesToRun({ type: "all" }, EX.ids, pairs, (id) => status[id])).toEqual([]);
    for (const id of invalidated(["p2"], pairs)) status[id] = "stale";
    expect(Object.entries(status).filter(([, s]) => s === "stale").map(([id]) => id).sort()).toEqual(["p2", "pre", "v2"]);
    expect(nodesToRun({ type: "from", nodeId: "p2" }, EX.ids, pairs, (id) => status[id]).sort()).toEqual(["p2", "pre", "v2"]);
    status.v2 = "failed";
    expect(nodesToRun({ type: "only", nodeId: "v2" }, EX.ids, pairs, (id) => status[id]).sort()).toEqual(["p2", "v2"]);
    status.p2 = "succeeded";
    expect(nodesToRun({ type: "only", nodeId: "v2" }, EX.ids, pairs, (id) => status[id])).toEqual(["v2"]);
  });
});

describe("values and cache (EX-03, EX-04)", () => {
  const outputs: Record<string, Value> = {
    up: { type: "image", value: "https://x/up.png" },
    p1: { type: "text", value: "wide shot" },
  };

  it("passes typed values along edges", () => {
    expect(inputsOf("v1", EX.edges, (id) => outputs[id])).toEqual({
      "in:image": [{ type: "image", value: "https://x/up.png" }],
      "in:text": [{ type: "text", value: "wide shot" }],
    });
  });

  it("same kind, params and inputs give the same key; a new seed does not", () => {
    const inputs = { "in:text": [{ type: "text" as const, value: "fox" }] };
    const a = cacheKey("textToImage", { model: "m", size: "1024*1024", seed: 1 }, inputs);
    const b = cacheKey("textToImage", { seed: 1, size: "1024*1024", model: "m" }, inputs);
    const c = cacheKey("textToImage", { model: "m", size: "1024*1024", seed: 2 }, inputs);
    const d = cacheKey("textToImage", { model: "m", size: "1024*1024", seed: 1 }, { "in:text": [{ type: "text", value: "cat" }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it("lists required inputs that are not connected", () => {
    expect(missingInputs("imageToVideo", "vX", EX.edges)).toEqual(["in:image", "in:text"]);
    expect(missingInputs("imageTool", "up", EX.edges)).toEqual([]);
  });
});

describe("upload provenance", () => {
  const kinds: Record<string, string> = { u: "imageUpload", up: "imageTool", v: "imageToVideo", t2i: "textToImage" };
  const kindOf = (id: string) => kinds[id];

  it("flags direct and indirect upload inputs, not text-to-image chains", () => {
    expect(fedByUpload("v", [["u", "v"]], kindOf)).toBe(true);
    expect(fedByUpload("v", [["u", "up"], ["up", "v"]], kindOf)).toBe(true);
    expect(fedByUpload("up", [["u", "up"]], kindOf)).toBe(true);
    expect(fedByUpload("v", [["t2i", "up"], ["up", "v"]], kindOf)).toBe(false);
  });
});

describe("layered layout (TP-01)", () => {
  it("lays the example out left to right with prompts next to their videos", () => {
    const pos = layeredLayout(EX.ids.map((id) => ({ id, width: 240, height: 100 })), pairs, { columnGap: 60, rowGap: 30 });
    const col = (id: string) => pos[id].x / 300;
    expect(["text", "llm", "t2i", "up", "v1", "pre"].map(col)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(["p1", "p2", "p3"].map(col)).toEqual([3, 3, 3]);
    // Every edge goes strictly left to right: nothing loops back.
    for (const [s, t] of pairs) expect(pos[t].x).toBeGreaterThan(pos[s].x);
    // Videos keep the order of their prompts, so prompt→video edges do not cross.
    expect(pos.v1.y < pos.v2.y && pos.v2.y < pos.v3.y).toBe(pos.p1.y < pos.p2.y && pos.p2.y < pos.p3.y);
    // No two nodes overlap.
    const boxes = EX.ids.map((id) => ({ id, ...pos[id] }));
    for (const a of boxes)
      for (const b of boxes)
        if (a.id < b.id) expect(a.x === b.x && Math.abs(a.y - b.y) < 100).toBe(false);
  });
});

describe("resume scope (EX-07)", () => {
  it("re-queues exactly the nodes that were waiting", () => {
    const status: Record<string, RunStatus> = { a: "running", b: "idle", c: "stale", d: "succeeded" };
    expect(nodesToRun({ type: "nodes", ids: ["b", "c", "d"] }, ["a", "b", "c", "d"], [], (id) => status[id])).toEqual(["b", "c"]);
  });
});
