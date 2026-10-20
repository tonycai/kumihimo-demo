"use client";

import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { availableImageTools, getModel, modelsFor, type ModelSpec } from "@/atlas/models";
import { cancelNode, markExpired, retry, runFrom } from "@/client/engine";
import { GROUP_TYPE } from "@/engine/layout";
import type { NodeKind } from "@/engine/nodes";
import { t } from "@/i18n";
import { useNodeExec, type NodeOutput } from "@/store/execution";
import { graphStore, useGraph } from "@/store/graph";
import type { NodeParams } from "@/store/types";

import { DemoChip, isDemoSample, UploadPicker } from "./media";

const field =
  "w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-zinc-600";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
      {label}
      {children}
      {hint && <span className="text-[11px] text-zinc-400">{hint}</span>}
    </label>
  );
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      className={field}
      value={String(value)}
      onChange={(e) => {
        const picked = options.find((o) => String(o.value) === e.target.value);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} className="bg-white text-zinc-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function formatPrice(m: ModelSpec): string {
  const p = m.price;
  if (p.unit === "1M input tokens") return `$${p.usd} / $${p.outputUsdPer1M ?? "?"} per 1M tokens (in / out)`;
  return `$${p.usd} / ${p.unit === "second" ? "s" : "image"}`;
}

function ModelSelect<K extends "llm" | "textToImage" | "imageTool" | "imageToVideo">({
  kind,
  value,
  models,
  onChange,
}: {
  kind: K;
  value: string;
  models: readonly ModelSpec[];
  onChange: (id: string) => void;
}) {
  const current = getModel(value, kind);
  return (
    <Field label={t("panel.model")} hint={current ? t("panel.price", { price: formatPrice(current) }) : undefined}>
      <Select value={value} options={models.map((m) => ({ value: m.id, label: m.label }))} onChange={onChange} />
    </Field>
  );
}

function update<K extends NodeKind>(id: string, patch: Partial<NodeParams[K]>, coalesce?: string) {
  graphStore.getState().updateParams<K>(id, patch, coalesce ? { coalesce } : undefined);
}

function Editor({ id, kind, data }: { id: string; kind: NodeKind; data: NodeParams[NodeKind] }) {
  switch (kind) {
    case "textPrompt": {
      const p = data as NodeParams["textPrompt"];
      return (
        <Field label={t("panel.text")}>
          <textarea
            className={`${field} min-h-32`}
            value={p.text}
            onChange={(e) => update<"textPrompt">(id, { text: e.target.value }, "text")}
          />
        </Field>
      );
    }
    case "llm": {
      const p = data as NodeParams["llm"];
      const m = getModel(p.model, "llm");
      return (
        <>
          <ModelSelect kind="llm" value={p.model} models={modelsFor("llm")} onChange={(model) => update<"llm">(id, { model })} />
          <Field label={t("panel.systemPrompt")}>
            <textarea
              className={`${field} min-h-24`}
              value={p.systemPrompt}
              onChange={(e) => update<"llm">(id, { systemPrompt: e.target.value }, "systemPrompt")}
            />
          </Field>
          <Field label={`${t("panel.temperature")}: ${p.temperature.toFixed(1)}`}>
            <input
              type="range"
              min={m?.temperature.min ?? 0}
              max={m?.temperature.max ?? 2}
              step={0.1}
              value={p.temperature}
              onChange={(e) => update<"llm">(id, { temperature: Number(e.target.value) }, "temperature")}
            />
          </Field>
        </>
      );
    }
    case "textToImage": {
      const p = data as NodeParams["textToImage"];
      const m = getModel(p.model, "textToImage");
      return (
        <>
          <ModelSelect
            kind="textToImage"
            value={p.model}
            models={modelsFor("textToImage")}
            onChange={(model) => update<"textToImage">(id, { model })}
          />
          <Field label={t("panel.size")}>
            <Select
              value={p.size}
              options={(m?.sizes ?? []).map((s) => ({ value: s, label: s.replace("*", " × ") }))}
              onChange={(size) => update<"textToImage">(id, { size })}
            />
          </Field>
          {m?.seed && (
            <Field label={t("panel.seed")} hint={t("panel.seedHint")}>
              <input
                type="number"
                className={field}
                min={m.seed.min}
                max={m.seed.max}
                step={1}
                value={p.seed}
                onChange={(e) => {
                  const seed = Number.parseInt(e.target.value, 10);
                  if (Number.isInteger(seed)) update<"textToImage">(id, { seed }, "seed");
                }}
              />
            </Field>
          )}
        </>
      );
    }
    case "imageTool": {
      const p = data as NodeParams["imageTool"];
      return (
        <>
          <Field label={t("panel.tool")}>
            <Select
              value={p.tool}
              options={availableImageTools().map((tool) => ({ value: tool, label: t(`tool.${tool}`) }))}
              onChange={(tool) => update<"imageTool">(id, { tool })}
            />
          </Field>
          <ModelSelect
            kind="imageTool"
            value={p.model}
            models={modelsFor("imageTool").filter((m) => m.tool === p.tool)}
            onChange={(model) => update<"imageTool">(id, { model })}
          />
        </>
      );
    }
    case "imageToVideo": {
      const p = data as NodeParams["imageToVideo"];
      const m = getModel(p.model, "imageToVideo");
      return (
        <>
          <ModelSelect
            kind="imageToVideo"
            value={p.model}
            models={modelsFor("imageToVideo")}
            onChange={(model) => update<"imageToVideo">(id, { model })}
          />
          <Field label={t("panel.duration")}>
            <Select
              value={p.duration}
              options={(m?.durations ?? []).map((d) => ({ value: d, label: t("panel.seconds", { n: d }) }))}
              onChange={(duration) => update<"imageToVideo">(id, { duration })}
            />
          </Field>
          {m && m.resolutions.length > 0 && p.resolution !== null && (
            <Field label={t("panel.resolution")}>
              <Select
                value={p.resolution}
                options={m.resolutions.map((r) => ({ value: r, label: r }))}
                onChange={(resolution) => update<"imageToVideo">(id, { resolution })}
              />
            </Field>
          )}
        </>
      );
    }
    case "imageUpload":
      return (
        <>
          <UploadPicker id={id} />
          <p className="text-[11px] text-zinc-500">{t("notice.data")}</p>
        </>
      );
    case "outputPreview":
      return null;
  }
}

/** Full-size result: images and video play here, never on the canvas (CV-11, PF-06). */
function ResultView({ output }: { output: NodeOutput }) {
  const link = (
    <a href={output.value} download target="_blank" rel="noreferrer" className="text-xs underline">
      {t("panel.download")}
    </a>
  );
  if (output.type === "text") return <p className="whitespace-pre-wrap text-sm">{output.value}</p>;
  if (output.type === "image")
    return (
      <figure className="relative flex flex-col gap-1">
        {isDemoSample(output.value) && <DemoChip />}
        {/* eslint-disable-next-line @next/next/no-img-element -- result URLs are arbitrary upstream URLs */}
        <img
          src={output.value}
          alt=""
          className="rounded border border-zinc-200 dark:border-zinc-700"
          onError={() => markExpired(output.value)}
        />
        {link}
      </figure>
    );
  return (
    <figure className="relative flex flex-col gap-1">
      {isDemoSample(output.value) && <DemoChip />}
      <video
        src={output.value}
        poster={output.poster}
        controls
        preload="metadata"
        className="rounded"
        onError={() => markExpired(output.value)}
      />
      {link}
    </figure>
  );
}

function NodeProperties({ id }: { id: string }) {
  // `data` keeps its identity while a node is dragged, so the panel does not re-render per frame.
  const node = useGraph(useShallow((s) => {
    const n = s.nodes.find((x) => x.id === id);
    return n ? { type: n.type, data: n.data } : null;
  }));
  const exec = useNodeExec(id);
  if (!node) return null;

  if (node.type === GROUP_TYPE) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t("node.group")}</h3>
        <button type="button" className={field} onClick={() => graphStore.getState().ungroupSelected()}>
          {t("panel.ungroup")}
        </button>
      </div>
    );
  }

  const kind = node.type as NodeKind;
  const active = exec.status === "running" || exec.status === "queued";
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t(`node.${kind}`)}</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} disabled={active} onClick={() => void runFrom(id)}>
          {t("run.fromHere")}
        </button>
        {exec.status === "failed" && (
          <button type="button" className={action} onClick={() => void retry(id)}>
            {t("run.retry")}
          </button>
        )}
        {active && (
          <button type="button" className={action} onClick={() => cancelNode(id)}>
            {t("run.cancel")}
          </button>
        )}
      </div>
      {exec.status === "failed" && exec.error && (
        <p role="alert" className="whitespace-pre-wrap break-words rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {exec.error}
        </p>
      )}
      <Editor id={id} kind={kind} data={node.data as NodeParams[NodeKind]} />
      {kind !== "textPrompt" && kind !== "imageUpload" && kind !== "outputPreview" && (
        <section className="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("panel.result")}</h4>
          {exec.status === "running" && exec.streamText ? (
            <p className="whitespace-pre-wrap text-sm">{exec.streamText}</p>
          ) : exec.output ? (
            <ResultView output={exec.output} />
          ) : (
            <p className="text-xs text-zinc-500">{t("panel.noResult")}</p>
          )}
        </section>
      )}
    </div>
  );
}

const action =
  "rounded border border-zinc-300 px-2 py-1 text-xs font-medium disabled:opacity-40 hover:enabled:bg-zinc-100 dark:border-zinc-600 dark:hover:enabled:bg-zinc-800";

/**
 * CV-11: full parameters for the selection. An overlay on the canvas's right edge that appears
 * only while something is selected, so the whole canvas width is free otherwise (TP-01 fit).
 */
export function PropertiesPanel({ width }: { width: number }) {
  const selected = useGraph(useShallow((s) => s.nodes.filter((n) => n.selected).map((n) => n.id)));
  if (selected.length === 0) return null;
  return (
    <aside
      style={{ width }}
      className="absolute inset-y-0 right-0 z-10 overflow-y-auto border-l border-zinc-200 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("panel.heading")}</h2>
      {selected.length === 1 && <NodeProperties key={selected[0]} id={selected[0]} />}
      {selected.length > 1 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t("panel.multi", { count: selected.length })}</p>
          <button type="button" className={field} onClick={() => graphStore.getState().groupSelected()}>
            {t("panel.group")}
          </button>
        </div>
      )}
    </aside>
  );
}
