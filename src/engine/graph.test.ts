import { describe, expect, it } from "vitest";

import { ancestors, descendants, hasCycle, topoSort, wouldCreateCycle, type EdgePair } from "./graph";

const diamond: EdgePair[] = [
  ["a", "b"],
  ["a", "c"],
  ["b", "d"],
  ["c", "d"],
];

function chain(length: number): EdgePair[] {
  return Array.from({ length: length - 1 }, (_, i) => [`n${i}`, `n${i + 1}`] as const);
}

describe("reachability", () => {
  it("finds ancestors and descendants of a diamond", () => {
    expect([...ancestors(diamond, "d")].sort()).toEqual(["a", "b", "c"]);
    expect([...descendants(diamond, "a")].sort()).toEqual(["b", "c", "d"]);
    expect(ancestors(diamond, "a").size).toBe(0);
  });
});

describe("wouldCreateCycle (CV-03)", () => {
  it("rejects a self-loop", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("rejects closing A→B→C with C→A", () => {
    expect(wouldCreateCycle(chain(3).map(([s, t]) => [s, t] as const), "n2", "n0")).toBe(true);
  });

  it("rejects closing a long chain", () => {
    expect(wouldCreateCycle(chain(500), "n499", "n0")).toBe(true);
    expect(wouldCreateCycle(chain(500), "n0", "n499")).toBe(false);
  });

  it("accepts a diamond shortcut (not a cycle) and rejects its reverse", () => {
    expect(wouldCreateCycle(diamond, "a", "d")).toBe(false);
    expect(wouldCreateCycle(diamond, "d", "a")).toBe(true);
    expect(wouldCreateCycle(diamond, "b", "c")).toBe(false);
  });
});

describe("topoSort", () => {
  it("orders a diamond with the join last", () => {
    const { order, cyclic } = topoSort(["d", "c", "b", "a"], diamond);
    expect(cyclic).toEqual([]);
    expect(order[0]).toBe("a");
    expect(order[3]).toBe("d");
  });

  it("reports nodes on and behind a cycle", () => {
    const edges: EdgePair[] = [
      ["a", "b"],
      ["b", "c"],
      ["c", "b"],
      ["c", "d"],
    ];
    const { order, cyclic } = topoSort(["a", "b", "c", "d"], edges);
    expect(order).toEqual(["a"]);
    expect(cyclic).toEqual(["b", "c", "d"]);
    expect(hasCycle(["a"], [["a", "a"]])).toBe(true);
    expect(hasCycle(["a", "b", "c", "d"], diamond)).toBe(false);
  });

  it("ignores edges to unknown nodes", () => {
    expect(topoSort(["a"], [["a", "zzz"]])).toEqual({ order: ["a"], cyclic: [] });
  });
});
