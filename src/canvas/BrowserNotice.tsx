"use client";

import { useState, useSyncExternalStore } from "react";

import { t } from "@/i18n";
import { DEMO_GIF_URL, README_URL } from "@/site/links";

/** CV-10: desktop Chrome / Edge (or another Chromium browser) at 1024 px or wider. */
function unsupported(): boolean {
  if (window.innerWidth < 1024) return true;
  const brands = (navigator as { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
  if (brands) return !brands.some((b) => /Google Chrome|Microsoft Edge|Chromium/.test(b.brand));
  return !/\b(Chrome|Edg)\//.test(navigator.userAgent) || /\b(OPR|Firefox|FxiOS|CriOS)\//.test(navigator.userAgent);
}

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** A one-line notice; the page keeps working underneath. */
export function BrowserNotice() {
  const show = useSyncExternalStore(subscribe, unsupported, () => false);
  const [dismissed, setDismissed] = useState(false);
  if (!show || dismissed) return null;
  return (
    <div role="note" className="flex items-center gap-3 bg-amber-100 px-4 py-1.5 text-xs text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">
      <p className="flex-1">
        {t("browser.notice")}{" "}
        <a className="underline" href={README_URL}>
          {t("browser.readme")}
        </a>
        {" · "}
        <a className="underline" href={DEMO_GIF_URL}>
          {t("browser.gif")}
        </a>
      </p>
      <button type="button" className="rounded px-2 py-0.5 hover:bg-amber-200 dark:hover:bg-amber-800" onClick={() => setDismissed(true)}>
        {t("browser.dismiss")}
      </button>
    </div>
  );
}
