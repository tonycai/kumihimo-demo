"use client";

import { useReactFlow } from "@xyflow/react";

import { NODE_KINDS } from "@/engine/nodes";
import { t, type MessageKey } from "@/i18n";
import { graphStore } from "@/store/graph";

import { DND_MIME } from "./catalog";

/** Left-hand node library (CV-01): drag an item onto the canvas, or click to add it in view. */
export function NodeLibrary() {
  const { screenToFlowPosition } = useReactFlow();

  function addInView(kind: (typeof NODE_KINDS)[number]) {
    const pane = document.querySelector(".react-flow__pane")?.getBoundingClientRect();
    if (!pane) return;
    const center = screenToFlowPosition({ x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 });
    graphStore.getState().addNode(kind, { x: center.x - 120, y: center.y - 40 });
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r border-zinc-200 p-3 dark:border-zinc-800">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("library.heading")}</h2>
      <ul className="flex flex-col gap-1.5">
        {NODE_KINDS.map((kind) => (
          <li key={kind}>
            <button
              type="button"
              draggable
              data-node-kind={kind}
              onDragStart={(e) => {
                e.dataTransfer.setData(DND_MIME, kind);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => addInView(kind)}
              className="w-full cursor-grab rounded-md border border-zinc-200 px-2.5 py-1.5 text-left hover:border-indigo-400 hover:bg-indigo-50 active:cursor-grabbing dark:border-zinc-700 dark:hover:bg-indigo-950/40"
            >
              <span className="block text-sm font-medium">{t(`node.${kind}`)}</span>
              <span className="block text-[11px] text-zinc-500">{t(`node.${kind}.about` as MessageKey)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-[11px] text-zinc-500">{t("library.hint")}</p>
    </aside>
  );
}
