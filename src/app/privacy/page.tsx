import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { t } from "@/i18n";
import { PRIVACY_DRAFT, type Block, type PrivacyText } from "@/i18n/privacy";
import { demoPrivacyEn, demoPrivacyJa, hostingOf } from "@/i18n/privacy-demo";

export const metadata: Metadata = { title: "Privacy — Kumihimo" };

/** **bold** and [label](url); everything else is plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/).map((part, i) => {
    const bold = /^\*\*(.+)\*\*$/.exec(part);
    if (bold) return <strong key={i}>{bold[1]}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={i} className="underline" href={link[2]}>
          {link[1]}
        </a>
      );
    }
    return part;
  });
}

function BlockView({ block }: { block: Block }) {
  if ("h" in block) return <h2 className="mt-6 text-base font-semibold">{block.h}</h2>;
  if ("p" in block) return <p className="mt-2">{inline(block.p)}</p>;
  if ("ol" in block || "ul" in block) {
    const items = "ol" in block ? block.ol : block.ul;
    const List = "ol" in block ? "ol" : "ul";
    return (
      <List className={`mt-2 space-y-1 pl-5 ${"ol" in block ? "list-decimal" : "list-disc"}`}>
        {items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </List>
    );
  }
  return (
    <table className="mt-2 w-full border-collapse text-left">
      <thead>
        <tr>
          {block.table.head.map((h) => (
            <th key={h} className="border border-zinc-300 px-2 py-1 font-semibold dark:border-zinc-700">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.table.rows.map(([a, b]) => (
          <tr key={a}>
            <td className="border border-zinc-300 px-2 py-1 dark:border-zinc-700">{a}</td>
            <td className="border border-zinc-300 px-2 py-1 dark:border-zinc-700">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Notice({ text }: { text: PrivacyText }) {
  return (
    <section lang={text.lang} className="mt-10 first:mt-0">
      <h1 className="text-xl font-semibold">{text.title}</h1>
      <p className="mt-1 text-xs text-zinc-500">{text.dates}</p>
      <p className="text-xs text-zinc-500">{inline(text.operator)}</p>
      {text.blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </section>
  );
}

/** DP-09: the demo's own privacy notice, Japanese (prevails) then English. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 text-sm leading-relaxed">
      <p className="mb-6">
        <Link className="underline" href="/">
          {t("privacy.back")}
        </Link>
      </p>
      {PRIVACY_DRAFT && (
        <p role="note" className="mb-6 rounded bg-amber-100 px-3 py-2 text-xs text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">
          {t("privacy.draft")}
        </p>
      )}
      <Suspense fallback={null}>
        <DemoNotices />
      </Suspense>
    </main>
  );
}

/**
 * The notice for the demo as it runs now (demo data, live mode off). What applies depends on where
 * the page is served from, so it is read from the request: on this computer there are no server logs
 * or hosting to describe; under solanalink.jp, parent-domain cookies are mentioned.
 */
async function DemoNotices() {
  const hosting = hostingOf((await headers()).get("host"));
  return (
    <>
      <Notice text={demoPrivacyJa(hosting)} />
      <Notice text={demoPrivacyEn(hosting)} />
    </>
  );
}
