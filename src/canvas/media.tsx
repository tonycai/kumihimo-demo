"use client";

import { useRef, useState } from "react";

import { invalidate, markExpired, uploadFiles } from "@/client/engine";
import { hasUploadConsent, recordUploadConsent } from "@/client/upload-consent";
import { uiStore } from "@/client/ui";
import { checkUpload, UPLOAD_TYPES } from "@/engine/upload";
import { t, type MessageKey } from "@/i18n";
import { executionStore, useNodeExec, type NodeOutput } from "@/store/execution";

import { UploadConsentDialog } from "./UploadConsent";

/** Thumbnails only on the canvas; full size and video playback live in the panel (PF-06). */
export function Thumb({ src, className = "", onDead }: { src: string; className?: string; onDead?: () => void }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- result URLs are arbitrary upstream URLs
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={onDead}
      className={`w-full rounded border border-zinc-200 object-cover dark:border-zinc-700 ${className}`}
    />
  );
}

/** Results bundled with the demo (public/samples/): pre-made art, never a model's output. */
export function isDemoSample(url: string | undefined): boolean {
  return url?.startsWith("/samples/") === true;
}

/** Marks a pre-made demo result on the media itself, so a screenshot cannot pass it off as generated. */
export function DemoChip() {
  return (
    <span data-testid="demo-chip" className="pointer-events-none absolute left-1 top-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
      {t("demo.sample")}
    </span>
  );
}

/** Node-sized view of a result: text excerpt, image thumbnail, or a video's cover frame. */
export function OutputThumb({ output, chip = true }: { output: NodeOutput; chip?: boolean }) {
  const demo = chip && isDemoSample(output.value);
  if (output.type === "text") return <p className="line-clamp-4 whitespace-pre-wrap">{output.value}</p>;
  if (output.type === "image") {
    return (
      <div className="relative">
        <Thumb src={output.value} className="max-h-40" onDead={() => markExpired(output.value)} />
        {demo && <DemoChip />}
      </div>
    );
  }
  // PF-06: the canvas shows a cover frame only; the clip plays in the properties panel.
  return (
    <div className="relative" data-testid="video-cover">
      {demo && <DemoChip />}
      {output.poster ? (
        <Thumb src={output.poster} className="max-h-40" />
      ) : (
        <div className="h-24 rounded border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800" />
      )}
      <span className="absolute inset-0 m-auto flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-xs text-white">
        ▶
      </span>
    </div>
  );
}

/** Checks the file in the browser first (ND-06); a refused file never leaves the page. */
export function pickUpload(id: string, file: File) {
  const exec = executionStore.getState();
  const problem = checkUpload(file);
  if (problem) {
    exec.patch(id, { inputProblem: problem });
    return;
  }
  const previous = exec.byId[id]?.localPreview;
  if (previous) URL.revokeObjectURL(previous);
  uploadFiles.set(id, file);
  exec.patch(id, { localPreview: URL.createObjectURL(file), localName: file.name, inputProblem: undefined });
  invalidate([id]);
}

/**
 * KQ-11b: consent is asked only where an upload could reach Atlas, i.e. when the server can run
 * live mode (a key, live mode on). With demo data only, the image never leaves the browser.
 * Until the mode is known, ask.
 */
function livePossible(): boolean {
  const server = uiStore.getState().serverMode;
  return !server || server.reason === "live" || server.reason === "no_session";
}

export function UploadPicker({ id }: { id: string }) {
  const input = useRef<HTMLInputElement>(null);
  const exec = useNodeExec(id);
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="nodrag rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
        onClick={() => (hasUploadConsent() || !livePossible() ? input.current?.click() : setAsking(true))}
      >
        {exec.localPreview ? t("upload.replace") : t("upload.choose")}
      </button>
      <input
        ref={input}
        type="file"
        accept={UPLOAD_TYPES.join(",")}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) pickUpload(id, file);
        }}
      />
      {asking && (
        <UploadConsentDialog
          onCancel={() => setAsking(false)}
          onAgree={() => {
            recordUploadConsent();
            setAsking(false);
            input.current?.click(); // still inside the click on "agree", so the browser allows it
          }}
        />
      )}
      {exec.inputProblem && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {t(`upload.${exec.inputProblem}` as MessageKey)}
        </p>
      )}
    </div>
  );
}
