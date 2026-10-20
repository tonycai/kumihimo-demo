/**
 * Left-to-right layered layout (TP-01, PF-05 "自动排版"). Pure; runs in the graph Worker.
 *
 * - Layers by longest path from a source, then sources are pulled right next to their first
 *   consumer, so per-shot prompts sit beside their videos instead of in column 0.
 * - Order inside a layer follows the average position of connected nodes (a few up/down sweeps),
 *   which keeps edges between neighbouring columns from crossing other nodes.
 */

import type { EdgePair } from "./graph";

export interface LayoutInput {
  id: string;
  width: number;
  height: number;
}

export interface LayoutOptions {
  columnGap: number;
  rowGap: number;
}

export function layeredLayout(
  nodes: readonly LayoutInput[],
  edges: readonly EdgePair[],
  options: LayoutOptions = { columnGap: 80, rowGap: 40 },
): Record<string, { x: number; y: number }> {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [s, t] of edges) {
    if (!known.has(s) || !known.has(t)) continue;
    preds.get(t)!.push(s);
    succs.get(s)!.push(t);
  }

  // Longest path from any source (graph is a DAG; leftover nodes from a cycle land in layer 0).
  const layer = new Map<string, number>();
  const indeg = new Map(ids.map((id) => [id, preds.get(id)!.length]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (const id of queue) layer.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const t of succs.get(id)!) {
      layer.set(t, Math.max(layer.get(t) ?? 0, layer.get(id)! + 1));
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);

  // Pull sources forward: a source sits one column left of its earliest consumer.
  for (const id of ids) {
    if (preds.get(id)!.length > 0) continue;
    const next = succs.get(id)!.map((t) => layer.get(t)!);
    if (next.length > 0) layer.set(id, Math.max(0, Math.min(...next) - 1));
  }

  const columns: string[][] = [];
  for (const id of ids) (columns[layer.get(id)!] ??= []).push(id);
  for (let c = 0; c < columns.length; c++) columns[c] ??= [];

  // Barycentre ordering, alternating left→right and right→left sweeps.
  const indexIn = new Map<string, number>();
  const reindex = () => columns.forEach((col) => col.forEach((id, i) => indexIn.set(id, i)));
  reindex();
  const bary = (id: string, neighbours: string[]) => {
    const ns = neighbours.filter((n) => indexIn.has(n));
    return ns.length === 0 ? indexIn.get(id)! : ns.reduce((sum, n) => sum + indexIn.get(n)!, 0) / ns.length;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const order = forward ? columns.keys() : [...columns.keys()].reverse();
    for (const c of order) {
      const scores = new Map(columns[c].map((id) => [id, bary(id, forward ? preds.get(id)! : succs.get(id)!)]));
      columns[c].sort((a, b) => scores.get(a)! - scores.get(b)! || indexIn.get(a)! - indexIn.get(b)!);
      reindex();
    }
  }

  const size = new Map(nodes.map((n) => [n.id, n]));
  const columnWidth = columns.map((col) => Math.max(0, ...col.map((id) => size.get(id)!.width)));
  const columnHeight = columns.map(
    (col) => col.reduce((sum, id) => sum + size.get(id)!.height, 0) + Math.max(0, col.length - 1) * options.rowGap,
  );
  const tallest = Math.max(0, ...columnHeight);

  const positions: Record<string, { x: number; y: number }> = {};
  let x = 0;
  columns.forEach((col, c) => {
    let y = (tallest - columnHeight[c]) / 2; // centre each column vertically
    for (const id of col) {
      positions[id] = { x, y };
      y += size.get(id)!.height + options.rowGap;
    }
    x += columnWidth[c] + options.columnGap;
  });
  return positions;
}
