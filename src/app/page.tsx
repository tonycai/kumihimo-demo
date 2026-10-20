import Link from "next/link";

import { BrowserNotice } from "@/canvas/BrowserNotice";
import { Workspace } from "@/canvas/Workspace";
import { t } from "@/i18n";
import { COMPANY_URL, CTA_PATH } from "@/site/links";

export default function Home() {
  return (
    <div className="flex h-screen flex-col">
      <BrowserNotice />
      <header className="flex items-baseline gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h1 className="text-lg font-semibold">{t("app.title")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("app.tagline")}</p>
      </header>
      <Workspace />
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-200 px-4 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800">
        <p>
          {t("footer.unofficial")} {t("footer.usesApi")}
        </p>
        <nav aria-label="SolanaLink" className="ml-auto flex flex-wrap items-center gap-x-3">
          <span>{t("footer.madeBy")}</span>
          <a className="underline" href={COMPANY_URL}>
            {t("footer.company")}
          </a>
          <a className="underline" href={CTA_PATH} rel="nofollow">
            {t("footer.contact")}
          </a>
          <Link className="underline" href="/privacy">
            {t("footer.privacy")}
          </Link>
          <a
            className="rounded bg-indigo-600 px-2 py-0.5 font-semibold text-white hover:bg-indigo-500"
            href={CTA_PATH}
            rel="nofollow"
          >
            {t("footer.cta")}
          </a>
          <span lang="ja">{t("footer.ctaNote")}</span>
        </nav>
      </footer>
    </div>
  );
}
