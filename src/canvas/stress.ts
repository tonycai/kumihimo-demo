import { edgeId } from "@/engine/layout";
import type { PortType } from "@/engine/nodes";
import { defaultParams } from "@/store/defaults";
import { graphStore } from "@/store/graph";
import type { KEdge, KNode } from "@/store/types";
import { graphClient } from "@/workers/graph-client";

import { NODE_WIDTH } from "./template";

/**
 * Nodes added per frame: small enough that no single React commit becomes a long task (PF-05).
 * Halving it did not help with the CPU slowed 4×: the cost per update grows with the nodes already
 * on the canvas, not with the batch, so it only made loading slower.
 */
export const STRESS_BATCH = 50;

/** Next animation frame; falls back to a timer in background tabs, where rAF does not fire. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => finish());
    setTimeout(finish, 50);
  });
}

/**
 * PF-07: generate and lay out the graph in the Worker, clear the canvas as one undoable step, fit
 * the view to the final bounds, then stream the nodes in. Fitting first means each batch mounts in
 * its final, zoomed-out form; fitting afterwards switched all 500 nodes to the compact form in one
 * 70 ms commit (PF-05). Edges only point forward, so each batch can bring the edges into its nodes.
 */
export async function loadStressGraph(
  count: number,
  aspect: number,
  fit: (bounds: { x: number; y: number; width: number; height: number }) => Promise<unknown>,
): Promise<{ nodes: number; edges: number }> {
  const res = await graphClient().run({
    op: "stress",
    count,
    seed: count,
    cell: { width: NODE_WIDTH + 60, height: 134 },
    aspect,
  });
  graphStore.getState().loadDocument({ nodes: [], edges: [] });
  const xs = Object.values(res.positions).map((p) => p.x);
  const ys = Object.values(res.positions).map((p) => p.y);
  const bounds = { x: 0, y: 0, width: Math.max(...xs) + NODE_WIDTH, height: Math.max(...ys) + 110 };
  await fit(bounds);
  // An undo or edit while nodes are streaming in wins: stop appending to whatever is shown now.
  const history = graphStore.getState().history;
  const nodes: KNode[] = res.nodes.map(
    (n) => ({ id: n.id, type: n.kind, position: res.positions[n.id], data: defaultParams(n.kind) }) as KNode,
  );
  const incoming = new Map<string, KEdge[]>();
  for (const e of res.edges) {
    const portType = e.sourceHandle.replace("out:", "") as PortType;
    const edge: KEdge = { ...e, id: edgeId(e), data: { portType }, className: `edge-${portType}` };
    const list = incoming.get(e.target);
    if (list) list.push(edge);
    else incoming.set(e.target, [edge]);
  }
  for (let i = 0; i < nodes.length; i += STRESS_BATCH) {
    await nextFrame();
    if (graphStore.getState().history !== history) return { nodes: 0, edges: 0 };
    const batch = nodes.slice(i, i + STRESS_BATCH);
    graphStore.getState().appendBatch(batch, batch.flatMap((n) => incoming.get(n.id) ?? []));
  }
  // React Flow runs a fitView asked for earlier (Load example's, say) on the next node update, which
  // can be our first batch: fit again once the last batch is on screen. Same zoom, so nothing
  // re-renders; it only undoes such a stray fit.
  await nextFrame();
  await nextFrame();
  if (graphStore.getState().history === history) await fit(bounds);
  return { nodes: res.nodes.length, edges: res.edges.length };
}
