/**
 * Connection rules (CV-02, CV-03). The cycle part takes a precomputed answer so React Flow's
 * synchronous `isValidConnection` can use a set the Worker computed at drag start.
 */

import { inputPort, isNodeKind, outputPort, type PortType } from "./nodes";

export type RejectReason = "unknown-port" | "type-mismatch" | "cycle";

export type Verdict =
  | { ok: true; portType: PortType }
  | { ok: false; reason: RejectReason; from?: PortType; to?: readonly PortType[] };

export interface ConnectionQuery {
  sourceKind: string | undefined;
  sourceHandle: string | null | undefined;
  targetKind: string | undefined;
  targetHandle: string | null | undefined;
}

/** Port-type check only: an output type must be one of the input's accepted types. */
export function checkPorts(q: ConnectionQuery): Verdict {
  if (!isNodeKind(q.sourceKind) || !isNodeKind(q.targetKind)) return { ok: false, reason: "unknown-port" };
  const out = outputPort(q.sourceKind, q.sourceHandle);
  const inp = inputPort(q.targetKind, q.targetHandle);
  if (!out || !inp) return { ok: false, reason: "unknown-port" };
  if (!inp.accepts.includes(out.type)) {
    return { ok: false, reason: "type-mismatch", from: out.type, to: inp.accepts };
  }
  return { ok: true, portType: out.type };
}

/** Full check: ports first, then the cycle answer supplied by the caller. */
export function checkConnection(q: ConnectionQuery, closesCycle: boolean): Verdict {
  const ports = checkPorts(q);
  if (!ports.ok) return ports;
  return closesCycle ? { ok: false, reason: "cycle" } : ports;
}

interface EdgeLike {
  id: string;
  target: string;
  targetHandle?: string | null;
}

/**
 * Single-value inputs hold one edge: connecting a new one replaces the old. Returns the ids of the
 * edges the new connection displaces.
 */
export function displacedEdges(
  edges: readonly EdgeLike[],
  targetKind: string | undefined,
  target: string,
  targetHandle: string | null | undefined,
): string[] {
  if (!isNodeKind(targetKind)) return [];
  const port = inputPort(targetKind, targetHandle);
  if (!port || port.multiple) return [];
  return edges
    .filter((e) => e.target === target && (e.targetHandle ?? port.id) === port.id)
    .map((e) => e.id);
}
