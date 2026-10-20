import { describe, expect, it } from "vitest";

import { checkPorts } from "./connection";
import { hasCycle } from "./graph";
import { EDGE_RATIO, generateStressGraph, isStressNode, STRESS_SIZES, stressLayout } from "./stress";

describe("stress graphs (PF-07)", () => {
  it.each(STRESS_SIZES)("%i nodes: 1.2× edges, all type-correct, no cycles", (count) => {
    const g = generateStressGraph(count, count); // the seed the canvas uses
    expect(g.nodes).toHaveLength(count);
    expect(g.edges).toHaveLength(Math.round(count * EDGE_RATIO));
    const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
    for (const e of g.edges) {
      const verdict = checkPorts({
        sourceKind: kind.get(e.source),
        sourceHandle: e.sourceHandle,
        targetKind: kind.get(e.target),
        targetHandle: e.targetHandle,
      });
      expect(verdict.ok).toBe(true);
    }
    expect(hasCycle(g.nodes.map((n) => n.id), g.edges.map((e) => [e.source, e.target]))).toBe(false);
    expect(g.nodes.every((n) => isStressNode(n.id))).toBe(true);
  });

  it("hits the edge count for other seeds too, without duplicate edges", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = generateStressGraph(500, seed);
      expect(g.edges).toHaveLength(600);
      expect(new Set(g.edges.map((e) => `${e.source}>${e.target}`)).size).toBe(600);
    }
  });

  it("the grid fits a 1440×820 canvas above the 0.1 minimum zoom, and edges stay short", () => {
    const g = generateStressGraph(500, 500);
    const cell = { width: 284, height: 134 };
    const pos = stressLayout(g.nodes.map((n) => n.id), cell, 1216 / 820);
    const width = Math.max(...Object.values(pos).map((p) => p.x)) + cell.width;
    const height = Math.max(...Object.values(pos).map((p) => p.y)) + cell.height;
    expect(Math.min(1216 / width, 820 / height)).toBeGreaterThan(0.15);
    const columnsSpanned = g.edges.map((e) => Math.abs(pos[e.target].x - pos[e.source].x) / cell.width);
    expect(columnsSpanned.filter((c) => c <= 2).length / g.edges.length).toBeGreaterThan(0.9);
  });

  it("is reproducible for a seed", () => {
    expect(generateStressGraph(100, 7)).toEqual(generateStressGraph(100, 7));
    expect(generateStressGraph(100, 7)).not.toEqual(generateStressGraph(100, 8));
  });
});
