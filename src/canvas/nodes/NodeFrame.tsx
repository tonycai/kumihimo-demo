"use client";

import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";

import { ATLAS_OUTPUT_RETENTION } from "@/atlas/retention";
import { useTicker } from "@/client/clock";
import { cancelNode, retry } from "@/client/engine";
import { NODE_SPECS, type InputPort, type NodeKind } from "@/engine/nodes";
import { t, type MessageKey } from "@/i18n";
import { useNodeExec, type NodeExec, type NodeStatus } from "@/store/execution";

import { useCompact } from "../lod";
import { useRenderLog } from "../render-log";

/** EX-08: every state has its own border colour and label. */
const STATUS_STYLE: Record<NodeStatus, { border: string; dot: string; text: string }> = {
  idle: { border: "border-zinc-300 dark:border-zinc-700", dot: "bg-zinc-300 dark:bg-zinc-600", text: "text-zinc-400" },
  queued: { border: "border-sky-400", dot: "bg-sky-400", text: "text-sky-600 dark:text-sky-400" },
  running: { border: "border-amber-400", dot: "bg-amber-400 animate-pulse", text: "text-amber-700 dark:text-amber-300" },
  succeeded: { border: "border-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  failed: { border: "border-red-500", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  stale: { border: "border-amber-500 border-dashed", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
};

function inputLabel(port: InputPort): string {
  return port.accepts.length > 1 ? t("port.any") : t(`port.${port.accepts[0]}` as MessageKey);
}

function StatusLabel({ exec }: { exec: NodeExec }) {
  const now = useTicker(exec.status === "running");
  let label: string = t(`status.${exec.status}`);
  if (exec.status === "running" && exec.startedAt && now !== null) {
    label = t("status.runningFor", { seconds: Math.max(0, Math.round((now - exec.startedAt) / 1000)) });
  }
  return <span className={`ml-auto shrink-0 text-[11px] font-normal ${STATUS_STYLE[exec.status].text}`}>{label}</span>;
}

const smallButton =
  "nodrag rounded border border-current px-1.5 py-0.5 text-[11px] font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800";

/** Compact node for zoomed-out views: same border, dot and handles (edges stay attached). */
function CompactNode({ kind, exec, selected }: { kind: NodeKind; exec: NodeExec; selected: boolean }) {
  const spec = NODE_SPECS[kind];
  const style = STATUS_STYLE[exec.status];
  return (
    <div
      data-kind={kind}
      data-status={exec.status}
      data-lod="compact"
      className={`relative flex w-56 items-center gap-2 rounded-lg border-2 bg-white px-3 py-2 text-sm font-medium text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 ${style.border} ${
        selected ? "ring-2 ring-indigo-500/40 ring-offset-1" : ""
      }`}
    >
      <span className={`h-3 w-3 shrink-0 rounded-full ${style.dot}`} />
      <span className="truncate">{t(`node.${kind}`)}</span>
      {spec.inputs.map((port) => (
        <Handle key={port.id} type="target" position={Position.Left} id={port.id} className="port port-any" />
      ))}
      {spec.outputs.map((port) => (
        <Handle key={port.id} type="source" position={Position.Right} id={port.id} className={`port port-${port.type}`} />
      ))}
    </div>
  );
}

/** Shared chrome for every work node: title, status, typed ports, error and actions. */
export function NodeFrame({
  id,
  kind,
  selected,
  children,
}: {
  id: string;
  kind: NodeKind;
  selected: boolean;
  children?: ReactNode;
}) {
  const exec = useNodeExec(id);
  useRenderLog(id);
  // Changes only when the zoom crosses the threshold, not on every zoom step (lod.tsx).
  const compact = useCompact();
  const spec = NODE_SPECS[kind];
  const style = STATUS_STYLE[exec.status];
  if (compact) return <CompactNode kind={kind} exec={exec} selected={selected} />;
  return (
    <div
      data-kind={kind}
      data-status={exec.status}
      className={`w-56 rounded-lg border-2 bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100 ${style.border} ${
        selected ? "ring-2 ring-indigo-500/40 ring-offset-1" : ""
      }`}
    >
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 text-sm font-medium dark:border-zinc-700">
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
        <span className="truncate">{t(`node.${kind}`)}</span>
        <StatusLabel exec={exec} />
      </header>
      {(spec.inputs.length > 0 || spec.outputs.length > 0) && (
        <div className="flex justify-between py-1 text-[11px] text-zinc-500">
          <div className="flex flex-col gap-1">
            {spec.inputs.map((port) => (
              <div key={port.id} className="relative flex h-4 items-center pl-3">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={port.id}
                  className={`port port-${port.accepts.length > 1 ? "any" : port.accepts[0]}`}
                />
                {inputLabel(port)}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {spec.outputs.map((port) => (
              <div key={port.id} className="relative flex h-4 items-center justify-end pr-3">
                {t(`port.${port.type}`)}
                <Handle type="source" position={Position.Right} id={port.id} className={`port port-${port.type}`} />
              </div>
            ))}
          </div>
        </div>
      )}
      {children && <div className="px-3 pb-2 text-xs text-zinc-600 dark:text-zinc-300">{children}</div>}
      {exec.hint === "waiting_upstream" && exec.status !== "running" && (
        <p className="px-3 pb-2 text-[11px] italic text-zinc-500">{t("status.waitingUpstream")}</p>
      )}
      {exec.hint === "expired" && exec.status === "stale" && (
        <div className="flex items-start gap-2 px-3 pb-2 text-[11px] text-amber-800 dark:text-amber-300">
          <p className="flex-1">{t("result.expired", { period: ATLAS_OUTPUT_RETENTION })}</p>
          <button type="button" className={smallButton} onClick={() => void retry(id)}>
            {t("result.rerun")}
          </button>
        </div>
      )}
      {exec.status === "failed" && (
        <div className="flex items-start gap-2 border-t border-red-200 px-3 py-2 text-[11px] text-red-700 dark:border-red-900 dark:text-red-300">
          <p className="line-clamp-3 flex-1 break-words" title={exec.error}>
            {exec.error}
          </p>
          <button type="button" className={smallButton} onClick={() => void retry(id)}>
            {t("run.retry")}
          </button>
        </div>
      )}
      {(exec.status === "running" || exec.status === "queued") && (
        <div className="flex justify-end px-3 pb-2">
          <button type="button" className={`${smallButton} text-zinc-500`} onClick={() => cancelNode(id)}>
            {t("run.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
