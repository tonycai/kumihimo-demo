/**
 * Graph algorithms on a minimal edge list (PF-05: these run in the Worker; tests call them directly).
 * Pure: no I/O, no clock, no randomness.
 */

/** `[source, target]` pairs: the compact form the Worker receives. */
export type EdgePair = readonly [source: string, target: string];

function adjacency(edges: readonly EdgePair[], reverse: boolean): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [source, target] of edges) {
    const from = reverse ? target : source;
    const to = reverse ? source : target;
    const list = map.get(from);
    if (list) list.push(to);
    else map.set(from, [to]);
  }
  return map;
}

function reach(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(next.get(start) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of next.get(id) ?? []) if (!seen.has(n)) stack.push(n);
  }
  return seen;
}

/** Every node with a path to `nodeId` (excluding `nodeId` unless it sits on a cycle). */
export function ancestors(edges: readonly EdgePair[], nodeId: string): Set<string> {
  return reach(nodeId, adjacency(edges, true));
}

/** Every node reachable from `nodeId` (excluding `nodeId` unless it sits on a cycle). */
export function descendants(edges: readonly EdgePair[], nodeId: string): Set<string> {
  return reach(nodeId, adjacency(edges, false));
}

/** True if adding `source → target` would close a cycle (self-loops included). CV-03. */
export function wouldCreateCycle(edges: readonly EdgePair[], source: string, target: string): boolean {
  return source === target || descendants(edges, target).has(source);
}

/**
 * Kahn's algorithm. `order` lists the nodes that can be scheduled; `cyclic` lists the ones left
 * over because they sit on or behind a cycle (empty for a DAG). Ties keep `nodeIds` order, so the
 * result is deterministic.
 */
export function topoSort(
  nodeIds: readonly string[],
  edges: readonly EdgePair[],
): { order: string[]; cyclic: string[] } {
  const known = new Set(nodeIds);
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const next = new Map<string, string[]>();
  for (const [source, target] of edges) {
    if (!known.has(source) || !known.has(target)) continue;
    indegree.set(target, indegree.get(target)! + 1);
    const list = next.get(source);
    if (list) list.push(target);
    else next.set(source, [target]);
  }
  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const n of next.get(id) ?? []) {
      const d = indegree.get(n)! - 1;
      indegree.set(n, d);
      if (d === 0) queue.push(n);
    }
  }
  const placed = new Set(order);
  return { order, cyclic: nodeIds.filter((id) => !placed.has(id)) };
}

export function hasCycle(nodeIds: readonly string[], edges: readonly EdgePair[]): boolean {
  return topoSort(nodeIds, edges).cyclic.length > 0;
}
