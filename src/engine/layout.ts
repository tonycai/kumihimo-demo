/**
 * Selection-level graph edits that React Flow leaves to the app: copy/paste (CV-09), grouping
 * (CV-07) and delete expansion (CV-08). Generic over the node shape so the store keeps its own
 * node type; pure, ids come from the caller.
 */

export interface XY {
  x: number;
  y: number;
}

export interface Rect extends XY {
  width: number;
  height: number;
}

export interface LayoutNode {
  id: string;
  type?: string;
  position: XY;
  parentId?: string;
  extent?: unknown;
  selected?: boolean;
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  selected?: boolean;
}

export const GROUP_TYPE = "group";
/** Used before React Flow has measured a node. */
export const DEFAULT_NODE_SIZE = { width: 224, height: 120 } as const;
export const GROUP_PADDING = 24;
export const GROUP_HEADER = 28;

export function edgeId(e: Pick<LayoutEdge, "source" | "target" | "sourceHandle" | "targetHandle">): string {
  return `e:${e.source}:${e.sourceHandle ?? ""}->${e.target}:${e.targetHandle ?? ""}`;
}

export function sizeOf(n: LayoutNode): { width: number; height: number } {
  return {
    width: n.measured?.width ?? n.width ?? DEFAULT_NODE_SIZE.width,
    height: n.measured?.height ?? n.height ?? DEFAULT_NODE_SIZE.height,
  };
}

function detach<N extends LayoutNode>(n: N, absolute: XY): N {
  const copy: N = { ...n, position: absolute };
  delete copy.parentId;
  delete copy.extent;
  return copy;
}

function absolutePosition(n: LayoutNode, byId: ReadonlyMap<string, LayoutNode>): XY {
  const parent = n.parentId ? byId.get(n.parentId) : undefined;
  return parent ? { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y } : n.position;
}

/** Selected ids plus the children of any selected group: deleting or copying a group takes its members. */
export function withGroupMembers(nodes: readonly LayoutNode[], ids: ReadonlySet<string>): Set<string> {
  const out = new Set(ids);
  for (const n of nodes) if (n.parentId && ids.has(n.parentId)) out.add(n.id);
  return out;
}

// ── Copy / paste ─────────────────────────────────────────────────────────────────────────────

export interface Clip<N extends LayoutNode, E extends LayoutEdge> {
  nodes: N[];
  edges: E[];
}

/**
 * Copies the selection: members of selected groups come along; a child copied without its group
 * is detached to absolute coordinates; only edges with both ends in the selection are kept.
 */
export function copySelection<N extends LayoutNode, E extends LayoutEdge>(
  nodes: readonly N[],
  edges: readonly E[],
  selectedIds: ReadonlySet<string>,
): Clip<N, E> | null {
  const ids = withGroupMembers(nodes, selectedIds);
  if (ids.size === 0) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const clipNodes = nodes
    .filter((n) => ids.has(n.id))
    .map((n) => (n.parentId && !ids.has(n.parentId) ? detach(n, absolutePosition(n, byId)) : n));
  const clipEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes: clipNodes, edges: clipEdges };
}

/** New ids everywhere, top-level nodes shifted by `offset`, pasted items selected. */
export function pasteClip<N extends LayoutNode, E extends LayoutEdge>(
  clip: Clip<N, E>,
  newId: (oldId: string) => string,
  offset: XY,
): Clip<N, E> {
  const map = new Map(clip.nodes.map((n) => [n.id, newId(n.id)]));
  const nodes = clip.nodes.map((n) => {
    const parentId = n.parentId ? map.get(n.parentId) : undefined;
    const position = parentId ? n.position : { x: n.position.x + offset.x, y: n.position.y + offset.y };
    const copy: N = { ...n, id: map.get(n.id)!, position, selected: !parentId };
    if (parentId) copy.parentId = parentId;
    return copy;
  });
  const edges = clip.edges.map((e) => {
    const source = map.get(e.source)!;
    const target = map.get(e.target)!;
    return { ...e, source, target, selected: false, id: edgeId({ ...e, source, target }) };
  });
  return { nodes, edges };
}

// ── Grouping ─────────────────────────────────────────────────────────────────────────────────

/** Top-level, non-group nodes among `ids`: groups are one level deep. */
export function groupable<N extends LayoutNode>(nodes: readonly N[], ids: ReadonlySet<string>): N[] {
  return nodes.filter((n) => ids.has(n.id) && !n.parentId && n.type !== GROUP_TYPE);
}

export function boundsOf(nodes: readonly LayoutNode[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const { width, height } = sizeOf(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + width);
    maxY = Math.max(maxY, n.position.y + height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Wraps the groupable nodes among `ids` in a new parent built by `makeGroup` (children get
 * `extent: "parent"` and positions relative to it). The parent is inserted before its first child,
 * as React Flow requires. Returns null when nothing can be grouped.
 */
export function groupNodes<N extends LayoutNode>(
  nodes: readonly N[],
  ids: ReadonlySet<string>,
  makeGroup: (rect: Rect) => N,
): N[] | null {
  const members = groupable(nodes, ids);
  if (members.length === 0) return null;
  const inner = boundsOf(members);
  const rect: Rect = {
    x: inner.x - GROUP_PADDING,
    y: inner.y - GROUP_PADDING - GROUP_HEADER,
    width: inner.width + GROUP_PADDING * 2,
    height: inner.height + GROUP_PADDING * 2 + GROUP_HEADER,
  };
  const group = makeGroup(rect);
  const memberIds = new Set(members.map((n) => n.id));
  const out: N[] = [];
  let placed = false;
  for (const n of nodes) {
    if (!memberIds.has(n.id)) {
      out.push(n);
      continue;
    }
    if (!placed) {
      out.push(group);
      placed = true;
    }
    out.push({
      ...n,
      parentId: group.id,
      extent: "parent",
      selected: false,
      position: { x: n.position.x - rect.x, y: n.position.y - rect.y },
    });
  }
  return out;
}

/** Removes the group node and moves its children back to absolute coordinates. */
export function ungroupNodes<N extends LayoutNode>(nodes: readonly N[], groupId: string): N[] | null {
  const group = nodes.find((n) => n.id === groupId && n.type === GROUP_TYPE);
  if (!group) return null;
  return nodes
    .filter((n) => n.id !== groupId)
    .map((n) =>
      n.parentId === groupId
        ? detach(n, { x: group.position.x + n.position.x, y: group.position.y + n.position.y })
        : n,
    );
}
