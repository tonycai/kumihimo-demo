"use client";

import type { XYPosition } from "@xyflow/react";
import { useState } from "react";

import type { NodeKind } from "@/engine/nodes";
import { t } from "@/i18n";

import { searchKinds } from "./catalog";

/** Double-click search box (CV-01). Enter adds the highlighted match where the user double-clicked. */
export function QuickAdd({
  at,
  onPick,
  onClose,
}: {
  /** Position inside the canvas wrapper, in screen pixels. */
  at: XYPosition;
  onPick: (kind: NodeKind) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = searchKinds(query);
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  return (
    <div
      className="absolute z-20 w-64 rounded-lg border border-zinc-300 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left: at.x, top: at.y }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={query}
        placeholder={t("quickAdd.placeholder")}
        aria-label={t("quickAdd.placeholder")}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, matches.length - 1));
          else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
          else if (e.key === "Enter" && matches[current]) onPick(matches[current]);
          else return;
          e.preventDefault();
        }}
        className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600"
      />
      <ul role="listbox" className="mt-1 max-h-60 overflow-y-auto text-sm">
        {matches.length === 0 && <li className="px-2 py-1 text-zinc-500">{t("quickAdd.empty")}</li>}
        {matches.map((kind, i) => (
          <li key={kind} role="option" aria-selected={i === current}>
            <button
              type="button"
              // mousedown, not click: the input's blur would close the box first.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(kind);
              }}
              className={`w-full rounded px-2 py-1 text-left ${i === current ? "bg-indigo-100 dark:bg-indigo-900/50" : ""}`}
            >
              {t(`node.${kind}`)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
