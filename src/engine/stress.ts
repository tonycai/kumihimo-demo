/**
 * Stress-test graphs (PF-07): 100 / 250 / 500 nodes with about 1.2× as many typed edges, always a
 * DAG. Pure and seeded, so a run is reproducible; generated in the graph Worker (PF-05).
 * Stress nodes are marked by their id prefix and never run.
 */

import { NODE_SPECS, type NodeKind } from "./nodes";

export const STRESS_PREFIX = "st-";
export const STRESS_SIZES = [100, 250, 500] as const;

export function isStressNode(id: string): boolean {
  return id.startsWith(STRESS_PREFIX);
}

export interface StressGraph {
  nodes: { id: string; kind: NodeKind }[];
  edges: { source: string; sourceHandle: string; target: string; targetHandle: string }[];
}

/** mulberry32: tiny, fast, good enough for layout noise. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Rough mix of a real workflow: sources first, then processing, then previews. */
const MIX: [NodeKind, number][] = [
  ["textPrompt", 0.24],
  ["llm", 0.14],
  ["textToImage", 0.18],
  ["imageTool", 0.12],
  ["imageToVideo", 0.24],
  ["outputPreview", 0.08],
];

function pickKind(r: number, index: number): NodeKind {
  if (index < 3) return "textPrompt"; // something to connect from
  let acc = 0;
  for (const [kind, share] of MIX) {
    acc += share;
    if (r < acc) return kind;
  }
  return "textPrompt";
}

/** PF-07: about 1.2 edges per node. */
export const EDGE_RATIO = 1.2;
const MAX_PREVIEW_FAN_IN = 6;

/**
 * Pass 1 gives every required input an edge; pass 2 adds optional and fan-in edges until there
 * are exactly round(1.2 × count). Sources are always earlier nodes with a matching output, so
 * edges only point forward (no cycles) and every edge is type-correct.
 */
export function generateStressGraph(count: number, seed = 1): StressGraph {
  const random = rng(seed);
  const nodes: StressGraph["nodes"] = [];
  const edges: StressGraph["edges"] = [];
  const byOutput: Record<string, number[]> = { text: [], image: [], video: [] };
  const fanIn = new Map<string, number>();
  const pairs = new Set<string>();

  const connect = (i: number, port: (typeof NODE_SPECS)[NodeKind]["inputs"][number]): boolean => {
    const candidates = port.accepts.flatMap((t) => byOutput[t].filter((j) => j < i)).sort((a, b) => a - b);
    if (candidates.length === 0) return false;
    // Prefer recent nodes so edges stay short in the grid layout, like a real workflow.
    const pick = candidates[candidates.length - 1 - Math.floor(random() * Math.min(12, candidates.length))];
    const source = nodes[pick];
    const target = nodes[i];
    const out = NODE_SPECS[source.kind].outputs.find((o) => port.accepts.includes(o.type));
    if (!out || pairs.has(`${source.id}>${target.id}`)) return false;
    pairs.add(`${source.id}>${target.id}`);
    fanIn.set(`${target.id}:${port.id}`, (fanIn.get(`${target.id}:${port.id}`) ?? 0) + 1);
    edges.push({ source: source.id, sourceHandle: out.id, target: target.id, targetHandle: port.id });
    return true;
  };

  for (let i = 0; i < count; i++) {
    const kind = pickKind(random(), i);
    nodes.push({ id: `${STRESS_PREFIX}${i}`, kind });
    for (const out of NODE_SPECS[kind].outputs) byOutput[out.type].push(i);
  }
  for (let i = 0; i < count; i++) {
    for (const port of NODE_SPECS[nodes[i].kind].inputs) if (!port.optional) connect(i, port);
  }

  const target = Math.round(count * EDGE_RATIO);
  const open = nodes.flatMap((n, i) =>
    NODE_SPECS[n.kind].inputs.filter((p) => p.optional || p.multiple).map((port) => ({ i, port })),
  );
  for (let tries = 0; edges.length < target && open.length > 0 && tries < count * 20; tries++) {
    const { i, port } = open[Math.floor(random() * open.length)];
    const used = fanIn.get(`${nodes[i].id}:${port.id}`) ?? 0;
    if (used >= (port.multiple ? MAX_PREVIEW_FAN_IN : 1)) continue;
    connect(i, port);
  }
  return { nodes, edges };
}

/**
 * Column-major grid in generation order, shaped to the canvas: edges join nearby indices, so they
 * mostly run to the next column, and 500 nodes fit the view above React Flow's minimum zoom.
 * (The layered layout of the example would stack 500 nodes about 15 000 px high.)
 */
export function stressLayout(
  ids: readonly string[],
  cell: { width: number; height: number },
  aspect: number,
): Record<string, { x: number; y: number }> {
  const rows = Math.max(1, Math.round(Math.sqrt((ids.length * cell.width) / cell.height / Math.max(0.5, aspect))));
  const positions: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    positions[id] = { x: Math.floor(i / rows) * cell.width, y: (i % rows) * cell.height };
  });
  return positions;
}
