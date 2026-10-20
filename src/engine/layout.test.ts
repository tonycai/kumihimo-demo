import { describe, expect, it } from "vitest";

import {
  copySelection,
  GROUP_HEADER,
  GROUP_PADDING,
  groupNodes,
  pasteClip,
  ungroupNodes,
  withGroupMembers,
  type LayoutEdge,
  type LayoutNode,
} from "./layout";

const size = { width: 100, height: 50 };
const node = (id: string, x: number, y: number, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id,
  type: "llm",
  position: { x, y },
  measured: size,
  ...extra,
});
const edge = (source: string, target: string): LayoutEdge => ({ id: `${source}->${target}`, source, target });

describe("copy / paste (CV-09)", () => {
  const nodes = [node("a", 0, 0), node("b", 200, 0), node("c", -200, 0)];
  const edges = [edge("a", "b"), edge("c", "a")];

  it("keeps edges inside the selection only", () => {
    const clip = copySelection(nodes, edges, new Set(["a", "b"]))!;
    expect(clip.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(clip.edges.map((e) => e.id)).toEqual(["a->b"]);
  });

  it("pastes with fresh ids, an offset and the inner edge rewired", () => {
    const clip = copySelection(nodes, edges, new Set(["a", "b"]))!;
    let i = 0;
    const pasted = pasteClip(clip, () => `new${++i}`, { x: 40, y: 40 });
    expect(pasted.nodes.map((n) => [n.id, n.position, n.selected])).toEqual([
      ["new1", { x: 40, y: 40 }, true],
      ["new2", { x: 240, y: 40 }, true],
    ]);
    expect(pasted.edges).toHaveLength(1);
    expect(pasted.edges[0]).toMatchObject({ source: "new1", target: "new2" });
    expect(pasted.edges[0].id).not.toBe("a->b");
  });

  it("returns null for an empty selection", () => {
    expect(copySelection(nodes, edges, new Set())).toBeNull();
  });
});

describe("grouping (CV-07)", () => {
  const nodes = [node("a", 0, 0), node("x", 500, 500), node("b", 200, 100), node("c", 0, 300)];
  const makeGroup = (r: { x: number; y: number; width: number; height: number }): LayoutNode => ({
    id: "g",
    type: "group",
    position: { x: r.x, y: r.y },
    width: r.width,
    height: r.height,
  });

  it("wraps the members, puts the parent first and makes positions relative", () => {
    const out = groupNodes(nodes, new Set(["a", "b", "c"]), makeGroup)!;
    expect(out.map((n) => n.id)).toEqual(["g", "a", "x", "b", "c"]);
    const g = out[0];
    expect(g.position).toEqual({ x: -GROUP_PADDING, y: -GROUP_PADDING - GROUP_HEADER });
    expect(g.width).toBe(300 + GROUP_PADDING * 2);
    expect(g.height).toBe(350 + GROUP_PADDING * 2 + GROUP_HEADER);
    const b = out.find((n) => n.id === "b")!;
    expect(b).toMatchObject({ parentId: "g", extent: "parent" });
    expect({ x: g.position.x + b.position.x, y: g.position.y + b.position.y }).toEqual({ x: 200, y: 100 });
    expect(out.find((n) => n.id === "x")!.parentId).toBeUndefined();
  });

  it("ungroup restores absolute positions", () => {
    const grouped = groupNodes(nodes, new Set(["a", "b", "c"]), makeGroup)!;
    const back = ungroupNodes(grouped, "g")!;
    expect(back.map((n) => [n.id, n.position, n.parentId, n.extent])).toEqual(
      nodes.map((n) => [n.id, n.position, undefined, undefined]),
    );
  });

  it("skips nodes that are already children, and empty selections", () => {
    const grouped = groupNodes(nodes, new Set(["a", "b"]), makeGroup)!;
    expect(groupNodes(grouped, new Set(["a"]), makeGroup)).toBeNull();
  });

  it("selecting a group takes its members along", () => {
    const grouped = groupNodes(nodes, new Set(["a", "b"]), makeGroup)!;
    expect([...withGroupMembers(grouped, new Set(["g"]))].sort()).toEqual(["a", "b", "g"]);
    const clip = copySelection(grouped, [], new Set(["b"]))!;
    expect(clip.nodes[0].parentId).toBeUndefined();
    expect(clip.nodes[0].position).toEqual({ x: 200, y: 100 });
  });
});
