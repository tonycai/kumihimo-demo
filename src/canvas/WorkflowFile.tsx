"use client";

import { useReactFlow } from "@xyflow/react";
import { useRef, useState } from "react";

import { openWorkflow } from "@/client/engine";
import { t } from "@/i18n";
import { graphStore } from "@/store/graph";
import type { KEdge, KNode } from "@/store/types";
import { exportWorkflow, importWorkflow, MAX_IMPORT_BYTES } from "@/store/workflow-file";

import { showToast } from "./toast";

/** TP-02: downloads the graph and parameters as JSON (no results, no URLs: AT-07). */
export function ExportButton({ className }: { className: string }) {
  return (
    <button
      type="button"
      className={className}
      title={t("workflow.exportHint")}
      onClick={() => {
        const { nodes, edges } = graphStore.getState();
        const blob = new Blob([`${JSON.stringify(exportWorkflow({ nodes, edges }), null, 2)}\n`], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `kumihimo-workflow-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }}
    >
      {t("workflow.export")}
    </button>
  );
}

/** TP-02: opens a workflow file; a refused file leaves the canvas as it was and says why. */
export function ImportButton({ className }: { className: string }) {
  const input = useRef<HTMLInputElement>(null);
  const { fitView } = useReactFlow<KNode, KEdge>();
  return (
    <>
      <button type="button" className={className} title={t("workflow.importHint")} onClick={() => input.current?.click()}>
        {t("workflow.import")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        data-testid="workflow-file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // the same file can be picked again
          if (!file) return;
          const result =
            file.size > MAX_IMPORT_BYTES
              ? ({ ok: false, reason: t("workflow.tooLarge", { mb: MAX_IMPORT_BYTES / 1_000_000 }) } as const)
              : importWorkflow(await file.text());
          if (!result.ok) {
            showToast(t("workflow.refused", { reason: result.reason }));
            return;
          }
          openWorkflow(result.graph);
          showToast(t("workflow.opened", { nodes: result.graph.nodes.length, edges: result.graph.edges.length }));
          setTimeout(() => void fitView({ padding: 0.06 }), 0);
        }}
      />
    </>
  );
}

/** TP-04: asks once, inline (no browser dialog), then puts the example back; undo brings the old canvas back. */
export function ResetButton({ className, onReset }: { className: string; onReset: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {t("workflow.reset")}
      </button>
    );
  }
  return (
    <span role="group" aria-label={t("workflow.resetQuestion")} className="flex items-center gap-1 text-xs">
      <span>{t("workflow.resetQuestion")}</span>
      <button
        type="button"
        className={className}
        onClick={() => {
          setAsking(false);
          onReset();
        }}
      >
        {t("workflow.resetConfirm")}
      </button>
      <button type="button" className={className} onClick={() => setAsking(false)}>
        {t("workflow.resetCancel")}
      </button>
    </span>
  );
}
