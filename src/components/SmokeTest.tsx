"use client";

import { useEffect, useRef, useState } from "react";

import { modelsFor } from "@/atlas/models";
import type { ModeDecision } from "@/atlas/types";
import { fetchMode } from "@/client/atlas-client";
import { runTextToImage } from "@/client/run-text-to-image";
import { uiStore } from "@/client/ui";
import { t } from "@/i18n";

type RunState =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "succeeded"; url: string; seconds: number; mode: ModeDecision["mode"] }
  | { kind: "failed"; error: string };

const textToImageModels = modelsFor("textToImage");

export function SmokeTest() {
  const [mode, setMode] = useState<ModeDecision | null>(null);
  const [prompt, setPrompt] = useState<string>(t("smoke.defaultPrompt"));
  const [modelId, setModelId] = useState<string>(textToImageModels[0]?.id ?? "");
  const model = textToImageModels.find((m) => m.id === modelId);
  const [size, setSize] = useState<string>(model?.defaultSize ?? "");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  // Set when a run starts; never read the clock during render (prerender with Cache Components).
  const [now, setNow] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchMode(controller.signal).then(
      (m) => {
        setMode(m);
        uiStore.setState({ serverMode: m }); // requests go to /api/atlas only when live
      },
      () => setMode(null),
    );
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (run.kind !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [run.kind]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    if (!model) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = await runTextToImage(
      { model: model.id, prompt, size },
      controller.signal,
      (startedAt) => {
        setNow(startedAt);
        setRun({ kind: "running", startedAt });
      },
    );
    if (abortRef.current === controller) setRun(outcome);
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const running = run.kind === "running";
  const elapsed = running ? Math.max(0, Math.round((now - run.startedAt) / 1_000)) : 0;

  return (
    <section className="w-full max-w-3xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t("smoke.heading")}</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("smoke.description")}</p>
        </div>
        <ModeBadge mode={mode} />
      </header>

      {textToImageModels.length === 0 ? (
        <p className="text-sm text-red-600">{t("smoke.noModels")}</p>
      ) : (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{t("smoke.prompt")}</span>
            <textarea
              className="min-h-20 rounded-md border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
              value={prompt}
              maxLength={2_000}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={running}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">{t("smoke.model")}</span>
              <select
                className="rounded-md border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
                value={modelId}
                onChange={(e) => {
                  const next = textToImageModels.find((m) => m.id === e.target.value);
                  setModelId(e.target.value);
                  setSize(next?.defaultSize ?? "");
                }}
                disabled={running}
              >
                {textToImageModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">{t("smoke.size")}</span>
              <select
                className="rounded-md border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                disabled={running}
              >
                {model?.sizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-zinc-500">{t("notice.data")}</p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              onClick={start}
              disabled={running || prompt.trim().length === 0}
              data-testid="smoke-run"
            >
              {run.kind === "failed" ? t("smoke.retry") : t("smoke.run")}
            </button>
            {running && (
              <button
                type="button"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
                onClick={cancel}
              >
                {t("smoke.cancel")}
              </button>
            )}
            <StatusText run={run} elapsed={elapsed} />
          </div>
          {run.kind === "succeeded" && (
            <figure className="mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- result URLs are arbitrary upstream URLs */}
              <img
                src={run.url}
                alt={prompt}
                className="max-h-96 rounded-lg border border-zinc-200 dark:border-zinc-800"
                loading="lazy"
                decoding="async"
                data-testid="smoke-result"
              />
              <figcaption className="mt-2 flex gap-3 text-xs text-zinc-500">
                {run.mode === "mock" && <span>{t("smoke.sampleOutput")}</span>}
                <a href={run.url} target="_blank" rel="noreferrer" className="underline">
                  {t("smoke.download")}
                </a>
              </figcaption>
            </figure>
          )}
        </div>
      )}
    </section>
  );
}

function StatusText({ run, elapsed }: { run: RunState; elapsed: number }) {
  const text =
    run.kind === "running"
      ? t("smoke.running", { seconds: elapsed })
      : run.kind === "succeeded"
        ? t("smoke.succeeded", { seconds: run.seconds })
        : run.kind === "failed"
          ? `${t("smoke.failed")}: ${run.error}`
          : t("smoke.idle");
  const color =
    run.kind === "failed"
      ? "text-red-600"
      : run.kind === "succeeded"
        ? "text-emerald-600"
        : "text-zinc-500";
  return (
    <span className={`text-sm ${color}`} role="status" data-testid="smoke-status">
      {text}
    </span>
  );
}

function ModeBadge({ mode }: { mode: ModeDecision | null }) {
  if (!mode) {
    return <span className="text-xs text-zinc-500">{t("mode.loading")}</span>;
  }
  const live = mode.mode === "live";
  return (
    <span
      title={live ? t("mode.liveHint") : t("mode.mockHint")}
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
        live
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
          : "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100"
      }`}
      data-testid="mode-badge"
    >
      {live ? t("mode.live") : t("mode.mock")}
    </span>
  );
}
