"use client";

import type { NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useStore as useZustand } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { getModel } from "@/atlas/models";
import { t } from "@/i18n";
import { effectiveMode, useUi } from "@/client/ui";
import { useNodeExec, useNodeOutput } from "@/store/execution";
import { graphStore } from "@/store/graph";
import type { GroupNode as GroupNodeType, KindNode } from "@/store/types";

import { OutputThumb, Thumb, UploadPicker } from "../media";
import { useRenderLog } from "../render-log";
import { NodeFrame } from "./NodeFrame";

// Every custom node is memoised and only subscribes to its own execution slot.
// Model names come from the registry by id; no model id is written here (ND-09).

/**
 * Demo mode: says next to the model name that results are samples, not this model's work. It
 * subscribes to the mode only, so streaming elsewhere does not re-render it (PF-02).
 */
function SampleNote() {
  const demo = useUi((s) => effectiveMode(s) === "mock");
  if (!demo) return null;
  return <p className="text-[10px] italic text-amber-700 dark:text-amber-300">{t("demo.notThisModel")}</p>;
}

/** Demo mode, on the Output Preview: its tiles are too small for a chip each. */
function DemoLine() {
  const demo = useUi((s) => effectiveMode(s) === "mock");
  if (!demo) return null;
  return <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">{t("demo.sample")}</p>;
}

function Result({ id }: { id: string }) {
  const { output, streamText, status } = useNodeExec(id);
  // ND-02: words appear as they stream in; the final text replaces them when done.
  if (status === "running" && streamText) {
    return (
      <p className="mt-1 line-clamp-5 whitespace-pre-wrap" data-testid="stream-text">
        {streamText}
        <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current align-middle" />
      </p>
    );
  }
  // An out-of-date or failed node keeps its last result, dimmed so it is not mistaken for current.
  return output ? (
    <div className={`mt-1 ${status === "stale" || status === "failed" ? "opacity-40" : ""}`}>
      <OutputThumb output={output} />
    </div>
  ) : null;
}

export const TextPromptNode = memo(function TextPromptNode({ id, data, selected }: NodeProps<KindNode<"textPrompt">>) {
  return (
    <NodeFrame id={id} kind="textPrompt" selected={selected}>
      {data.text ? (
        <p className="line-clamp-3 whitespace-pre-wrap">{data.text}</p>
      ) : (
        <p className="italic text-zinc-400">{t("text.empty")}</p>
      )}
    </NodeFrame>
  );
});

export const LlmNode = memo(function LlmNode({ id, data, selected }: NodeProps<KindNode<"llm">>) {
  return (
    <NodeFrame id={id} kind="llm" selected={selected}>
      <p className="truncate">{getModel(data.model, "llm")?.label}</p>
      <SampleNote />
      <Result id={id} />
    </NodeFrame>
  );
});

export const TextToImageNode = memo(function TextToImageNode({
  id,
  data,
  selected,
}: NodeProps<KindNode<"textToImage">>) {
  return (
    <NodeFrame id={id} kind="textToImage" selected={selected}>
      <p className="truncate">
        {getModel(data.model, "textToImage")?.label} · {data.size.replace("*", "×")}
      </p>
      <SampleNote />
      <Result id={id} />
    </NodeFrame>
  );
});

export const ImageToolNode = memo(function ImageToolNode({ id, data, selected }: NodeProps<KindNode<"imageTool">>) {
  return (
    <NodeFrame id={id} kind="imageTool" selected={selected}>
      <p className="truncate">
        {t(`tool.${data.tool}`)} · {getModel(data.model, "imageTool")?.label}
      </p>
      <SampleNote />
      <Result id={id} />
    </NodeFrame>
  );
});

export const ImageToVideoNode = memo(function ImageToVideoNode({
  id,
  data,
  selected,
}: NodeProps<KindNode<"imageToVideo">>) {
  return (
    <NodeFrame id={id} kind="imageToVideo" selected={selected}>
      <p className="truncate">
        {getModel(data.model, "imageToVideo")?.label} · {t("panel.seconds", { n: data.duration })}
        {data.resolution ? ` · ${data.resolution}` : ""}
      </p>
      <SampleNote />
      <Result id={id} />
    </NodeFrame>
  );
});

export const ImageUploadNode = memo(function ImageUploadNode({ id, selected }: NodeProps<KindNode<"imageUpload">>) {
  const { localPreview } = useNodeExec(id);
  return (
    <NodeFrame id={id} kind="imageUpload" selected={selected}>
      <UploadPicker id={id} />
      {localPreview && (
        <div className="mt-1">
          <Thumb src={localPreview} className="max-h-40" />
        </div>
      )}
      <p className="mt-1 text-[10px] leading-tight text-zinc-400">{t("upload.noticeShort")}</p>
    </NodeFrame>
  );
});

/** ND-07: one small tile per connected result, in a grid so the node stays compact. */
function PreviewItem({ ownerId, sourceId }: { ownerId: string; sourceId: string }) {
  const output = useNodeOutput(sourceId);
  useRenderLog(ownerId);
  if (!output) return <div className="h-14 rounded border border-dashed border-zinc-300 dark:border-zinc-700" />;
  if (output.type === "text") return <p className="line-clamp-4 h-14 overflow-hidden text-[10px] leading-tight">{output.value}</p>;
  return (
    <div className="h-14 overflow-hidden rounded [&_img]:h-14 [&_img]:max-h-14">
      {/* Tiles are too small for a chip; the preview node says "Demo data" once instead. */}
      <OutputThumb output={output} chip={false} />
    </div>
  );
}

export const OutputPreviewNode = memo(function OutputPreviewNode({
  id,
  selected,
}: NodeProps<KindNode<"outputPreview">>) {
  const sources = useZustand(
    graphStore,
    useShallow((s) => s.edges.filter((e) => e.target === id).map((e) => e.source)),
  );
  return (
    <NodeFrame id={id} kind="outputPreview" selected={selected}>
      {sources.length === 0 ? (
        <p className="italic text-zinc-400">{t("preview.empty")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          <p>{t("preview.inputs", { count: sources.length })}</p>
          <DemoLine />
          <div className="grid grid-cols-3 gap-1">
            {sources.map((source) => (
              <PreviewItem key={source} ownerId={id} sourceId={source} />
            ))}
          </div>
        </div>
      )}
    </NodeFrame>
  );
});

export const GroupNode = memo(function GroupNode({ data, selected }: NodeProps<GroupNodeType>) {
  return (
    <div
      className={`h-full w-full rounded-xl border-2 border-dashed bg-indigo-50/40 dark:bg-indigo-950/20 ${
        selected ? "border-indigo-500" : "border-indigo-300 dark:border-indigo-800"
      }`}
    >
      <p className="px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">
        {data.label || t("node.group")}
      </p>
    </div>
  );
});
