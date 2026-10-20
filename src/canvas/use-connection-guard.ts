"use client";

import type { Connection, FinalConnectionState, OnConnectStartParams } from "@xyflow/react";
import { useMemo, useRef } from "react";

import { checkConnection, type Verdict } from "@/engine/connection";
import { wouldCreateCycle } from "@/engine/graph";
import { t, type MessageKey } from "@/i18n";
import { edgePairs, graphStore } from "@/store/graph";
import type { KEdge } from "@/store/types";
import { graphClient } from "@/workers/graph-client";

import { showToast } from "./toast";

interface Drag {
  token: number;
  nodeId: string;
  from: "source" | "target";
  /** Filled by the Worker: nodes the other end must not be (ancestors or descendants). */
  blocked: Set<string> | null;
}

function explain(verdict: Verdict): string | null {
  if (verdict.ok) return null;
  if (verdict.reason === "cycle") return t("toast.cycle");
  if (verdict.reason === "type-mismatch" && verdict.from && verdict.to) {
    const to = verdict.to.length > 1 ? t("port.any") : t(`port.${verdict.to[0]}` as MessageKey);
    return t("toast.type", { from: t(`port.${verdict.from}`), to });
  }
  return null;
}

/**
 * CV-02 / CV-03. React Flow's `isValidConnection` must answer synchronously, so when a drag starts
 * the Worker computes every node the dragged end must not reach; the hover check is then a set
 * lookup. On release the Worker confirms once more before the edge is added.
 */
export function useConnectionGuard() {
  const drag = useRef<Drag | null>(null);
  const last = useRef<Verdict | null>(null);
  const seq = useRef(0);

  return useMemo(() => {
    function closesCycle(source: string, target: string): boolean {
      const d = drag.current;
      if (source === target) return true;
      if (d?.blocked && d.from === "source" && d.nodeId === source) return d.blocked.has(target);
      if (d?.blocked && d.from === "target" && d.nodeId === target) return d.blocked.has(source);
      // The Worker has not answered yet (first few ms of a drag): same check, in-thread.
      return wouldCreateCycle(edgePairs(graphStore.getState().edges), source, target);
    }

    return {
      onConnectStart(_: unknown, { nodeId, handleType }: OnConnectStartParams) {
        if (!nodeId || !handleType) return;
        const token = ++seq.current;
        drag.current = { token, nodeId, from: handleType, blocked: null };
        last.current = null;
        const edges = edgePairs(graphStore.getState().edges);
        void graphClient()
          .run({ op: handleType === "source" ? "ancestors" : "descendants", edges, nodeId })
          .then((ids) => {
            if (drag.current?.token === token) drag.current.blocked = new Set(ids);
          });
      },

      isValidConnection(c: Connection | KEdge): boolean {
        const nodes = graphStore.getState().nodes;
        const verdict = checkConnection(
          {
            sourceKind: nodes.find((n) => n.id === c.source)?.type,
            sourceHandle: c.sourceHandle,
            targetKind: nodes.find((n) => n.id === c.target)?.type,
            targetHandle: c.targetHandle,
          },
          closesCycle(c.source, c.target),
        );
        last.current = verdict;
        return verdict.ok;
      },

      async onConnect(c: Connection) {
        const edges = edgePairs(graphStore.getState().edges);
        const cycle = await graphClient().run({ op: "wouldCreateCycle", edges, source: c.source, target: c.target });
        const message = explain(graphStore.getState().connect(c, cycle));
        if (message) showToast(message);
      },

      onConnectEnd(_: unknown, state: FinalConnectionState) {
        if (state.toHandle && state.isValid === false && last.current) {
          const message = explain(last.current);
          if (message) showToast(message);
        }
        drag.current = null;
        last.current = null;
      },
    };
  }, []);
}
