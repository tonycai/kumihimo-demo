import type { NodeChange } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";

import { hasCycle } from "@/engine/graph";
import type { NodeKind } from "@/engine/nodes";

import { createGraphStore, edgePairs } from "./graph";
import type { KNode } from "./types";

function setup(onParamsChanged?: (id: string) => void) {
  let i = 0;
  const store = createGraphStore({ makeId: (p) => `${p}${++i}`, onParamsChanged });
  const s = () => store.getState();
  const add = (kind: NodeKind, x = 0, y = 0) => s().addNode(kind, { x, y });
  const link = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
    s().connect({ source, sourceHandle, target, targetHandle });
  const select = (...ids: string[]) =>
    s().onNodesChange(s().nodes.map((n) => ({ type: "select", id: n.id, selected: ids.includes(n.id) })));
  /** A drag as React Flow reports it: several `dragging: true` frames, then one `dragging: false`. */
  const drag = (id: string, dx: number, dy: number, frames = 5) => {
    const start = s().nodes.find((n) => n.id === id)!.position;
    for (let f = 1; f <= frames; f++) {
      const position = { x: start.x + (dx * f) / frames, y: start.y + (dy * f) / frames };
      s().onNodesChange([{ type: "position", id, position, dragging: true }]);
    }
    const end = { x: start.x + dx, y: start.y + dy };
    s().onNodesChange([{ type: "position", id, position: end, dragging: false }] as NodeChange<KNode>[]);
  };
  /** The graph content for deep comparison. Selection is view state, not content, so it is left out. */
  const doc = () => {
    const strip = <T extends { selected?: boolean }>(x: T) => {
      const copy = structuredClone(x);
      delete copy.selected;
      return copy;
    };
    return { nodes: s().nodes.map(strip), edges: s().edges.map(strip) };
  };
  return { store, s, add, link, select, drag, doc };
}

describe("undo / redo (CV-06)", () => {
  it("20 mixed edits, 20 undos, 20 redos: deep-equal before and after", () => {
    const { s, add, link, select, drag, doc } = setup();
    const text = add("textPrompt", 0, 0);
    const llm = add("llm", 300, 0);
    const image = add("textToImage", 600, 0);
    const before = doc();
    const undosBefore = s().history.past.length;

    const steps: (() => void)[] = [
      () => link(text, "out:text", llm, "in:text"),
      () => link(llm, "out:text", image, "in:text"),
      () => drag(text, 50, 20),
      () => s().updateParams(llm, { temperature: 1.1 }),
      () => s().updateParams(image, { seed: 42 }),
      () => add("imageTool", 900, 0),
      () => drag(llm, -30, 80),
      () => link(image, "out:image", "n4", "in:image"),
      () => add("imageToVideo", 1200, 0),
      () => link("n4", "out:image", "n5", "in:image"),
      () => s().updateParams("n5", { resolution: "720p" }),
      () => {
        select(image);
        s().deleteSelected();
      },
      () => s().updateParams(text, { text: "a fox" }, { coalesce: "text" }),
      () => add("outputPreview", 1500, 0),
      () => link("n5", "out:video", "n6", "in:any"),
      () => {
        select("n4", "n5");
        s().copySelected();
        s().paste();
      },
      () => drag("n6", 10, 10),
      () => {
        select(text, llm);
        s().groupSelected();
      },
      () => s().updateParams("n4", { tool: "stylize" }),
      () => {
        select("n6");
        s().deleteSelected();
      },
    ];
    for (const step of steps) step();
    const after = doc();
    expect(s().history.past.length - undosBefore).toBe(20);

    for (let k = 0; k < 20; k++) s().undo();
    expect(doc()).toEqual(before);
    for (let k = 0; k < 20; k++) s().redo();
    expect(doc()).toEqual(after);
  });

  it("records a drag once, on release", () => {
    const { s, add, drag } = setup();
    const id = add("llm");
    const depth = s().history.past.length;
    drag(id, 100, 0, 30);
    expect(s().history.past.length).toBe(depth + 1);
    s().undo();
    expect(s().nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("keeps at least 50 of 60 steps", () => {
    const { s, add } = setup();
    for (let k = 0; k < 60; k++) add("textPrompt", k * 10, 0);
    let undone = 0;
    while (s().history.past.length > 0) {
      s().undo();
      undone++;
    }
    expect(undone).toBeGreaterThanOrEqual(50);
  });

  it("collapses typing in one field into one step", () => {
    const { s, add } = setup();
    const id = add("textPrompt");
    const depth = s().history.past.length;
    for (const text of ["a", "a ", "a f", "a fo", "a fox"]) s().updateParams(id, { text }, { coalesce: "text" });
    expect(s().history.past.length).toBe(depth + 1);
    s().updateParams(id, { text: "a fox!" }, { coalesce: "other" });
    expect(s().history.past.length).toBe(depth + 2);
  });

  it("ignores selection changes and no-op edits", () => {
    const { s, add, select } = setup();
    const id = add("llm");
    const depth = s().history.past.length;
    select(id);
    select();
    s().updateParams(id, { temperature: (s().nodes[0].data as { temperature: number }).temperature });
    expect(s().history.past.length).toBe(depth);
  });
});

describe("delete (CV-08)", () => {
  it("removes a node with its two edges; undo brings all three back", () => {
    const { s, add, link, select, doc } = setup();
    const a = add("textPrompt");
    const b = add("llm");
    const c = add("textToImage");
    link(a, "out:text", b, "in:text");
    link(b, "out:text", c, "in:text");
    const before = doc();
    select(b);
    s().deleteSelected();
    expect(s().nodes.map((n) => n.id)).toEqual([a, c]);
    expect(s().edges).toEqual([]);
    s().undo();
    expect(doc()).toEqual(before);
  });

  it("deleting a group deletes its members", () => {
    const { s, add, select } = setup();
    add("llm");
    add("llm", 300);
    select("n1", "n2");
    s().groupSelected();
    expect(s().nodes.map((n) => n.id)).toEqual(["g3", "n1", "n2"]);
    select("g3");
    s().deleteSelected();
    expect(s().nodes).toEqual([]);
  });
});

describe("copy / paste (CV-09)", () => {
  it("pastes A'→B' with new ids, without C→A'", () => {
    const { s, add, link, select } = setup();
    const a = add("llm");
    const b = add("textToImage", 300);
    const c = add("textPrompt", -300);
    link(a, "out:text", b, "in:text");
    link(c, "out:text", a, "in:text");
    select(a, b);
    expect(s().copySelected()).toBe(true);
    s().paste();
    const fresh = s().nodes.filter((n) => ![a, b, c].includes(n.id));
    expect(fresh.map((n) => n.type)).toEqual(["llm", "textToImage"]);
    expect(fresh.every((n) => n.selected)).toBe(true);
    expect(fresh[0].position).toEqual({ x: 40, y: 40 });
    const newEdges = s().edges.filter((e) => fresh.some((n) => n.id === e.target));
    expect(newEdges).toHaveLength(1);
    expect(newEdges[0]).toMatchObject({ source: fresh[0].id, target: fresh[1].id });
    s().paste();
    expect(s().nodes.filter((n) => n.type === "llm").map((n) => n.position)).toContainEqual({ x: 80, y: 80 });
  });
});

describe("groups (CV-07)", () => {
  it("groups three nodes with extent=parent; undo restores the original", () => {
    const { s, add, select, doc } = setup();
    add("llm", 0, 0);
    add("llm", 300, 0);
    add("llm", 0, 300);
    select("n1", "n2", "n3");
    const before = doc();
    s().groupSelected();
    const group = s().nodes[0];
    expect(group.type).toBe("group");
    expect(s().nodes.slice(1).every((n) => n.parentId === group.id && n.extent === "parent")).toBe(true);
    s().undo();
    expect(doc()).toEqual(before);
    s().redo();
    select(group.id);
    s().ungroupSelected();
    expect(s().nodes.map((n) => [n.id, n.position, n.parentId])).toEqual([
      ["n1", { x: 0, y: 0 }, undefined],
      ["n2", { x: 300, y: 0 }, undefined],
      ["n3", { x: 0, y: 300 }, undefined],
    ]);
  });
});

describe("connections (CV-02, CV-03)", () => {
  it("refuses wrong port types and cycles; replaces a single-input edge", () => {
    const { s, add, link } = setup();
    const a = add("textPrompt");
    const b = add("llm");
    const c = add("llm");
    const v = add("imageToVideo");
    expect(link(a, "out:text", v, "in:image")).toMatchObject({ ok: false, reason: "type-mismatch" });
    link(a, "out:text", b, "in:text");
    link(b, "out:text", c, "in:text");
    expect(link(c, "out:text", b, "in:text")).toEqual({ ok: false, reason: "cycle" });
    expect(link(b, "out:text", b, "in:text")).toEqual({ ok: false, reason: "cycle" });
    link(a, "out:text", c, "in:text");
    expect(s().edges.filter((e) => e.target === c).map((e) => e.source)).toEqual([a]);
  });
});

describe("properties (CV-11)", () => {
  it("reports parameter edits so a succeeded node can go stale", () => {
    const changed = vi.fn();
    const { s, add } = setup(changed);
    const id = add("textToImage");
    s().updateParams(id, { seed: 7 });
    expect(changed).toHaveBeenCalledWith(id);
  });

  it("keeps dependent fields valid when the model changes", () => {
    const { s, add } = setup();
    const id = add("imageTool");
    s().updateParams(id, { tool: "stylize" });
    expect(s().nodes[0].data).toEqual({ tool: "stylize", model: "atlascloud/qwen-image/edit" });
  });
});

describe("example workflow by hand (TP-01 shape)", () => {
  it("text → LLM → text-to-image → upscale → 3× image-to-video (fan-out) → preview", () => {
    const { s, add, link } = setup();
    const idea = add("textPrompt");
    const llm = add("llm");
    const image = add("textToImage");
    const upscale = add("imageTool");
    expect(s().nodes.find((n) => n.id === upscale)!.data).toMatchObject({ tool: "upscale" });
    const preview = add("outputPreview");
    const results = [
      link(idea, "out:text", llm, "in:text"),
      link(llm, "out:text", image, "in:text"),
      link(image, "out:image", upscale, "in:image"),
    ];
    for (let shot = 0; shot < 3; shot++) {
      const prompt = add("textPrompt");
      const video = add("imageToVideo");
      results.push(
        link(upscale, "out:image", video, "in:image"),
        link(prompt, "out:text", video, "in:text"),
        link(video, "out:video", preview, "in:any"),
      );
    }
    expect(results.every((r) => r.ok)).toBe(true);
    expect(s().nodes).toHaveLength(11);
    expect(s().edges).toHaveLength(12);
    expect(s().edges.filter((e) => e.source === upscale)).toHaveLength(3);
    expect(hasCycle(s().nodes.map((n) => n.id), edgePairs(s().edges))).toBe(false);
  });
});
