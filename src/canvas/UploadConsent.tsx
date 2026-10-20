"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { t } from "@/i18n";

/**
 * KQ-11b (provisional until decided): asked once per tab, before the first upload. A native modal
 * <dialog> sits in the top layer, so the canvas transform of the node that opened it cannot clip or
 * move it.
 */
export function UploadConsentDialog({ onAgree, onCancel }: { onAgree: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="upload-consent-title"
      className="nodrag nowheel m-auto max-w-md rounded-lg p-5 text-sm text-zinc-900 shadow-xl backdrop:bg-black/40 dark:bg-zinc-900 dark:text-zinc-100"
      onCancel={(e) => {
        e.preventDefault(); // Escape: close through React state, not behind its back
        onCancel();
      }}
    >
      <h2 id="upload-consent-title" className="text-base font-semibold">
        {t("consent.title")}
      </h2>
      <p lang="ja" className="mt-3">
        {t("consent.ja")}
      </p>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">{t("consent.en")}</p>
      <p className="mt-2">
        <Link className="underline" href="/privacy" target="_blank">
          {t("consent.privacy")}
        </Link>
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-600" onClick={onCancel}>
          {t("consent.cancel")}
        </button>
        <button type="button" autoFocus className="rounded bg-indigo-600 px-3 py-1 font-semibold text-white" onClick={onAgree}>
          {t("consent.agree")}
        </button>
      </div>
    </dialog>
  );
}
