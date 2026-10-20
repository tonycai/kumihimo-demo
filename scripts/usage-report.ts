/**
 * DP-10 usage report: per passcode label, today's and all-time submissions, successes, failures and
 * spend, and what is left of today's budget. Read-only; it reads only the `budget` collection, which
 * holds counts and money, never prompts, images or addresses.
 *
 * Reading Firestore is a GCP read: whoever runs this uses their own gcloud login, and the project is
 * always named explicitly (an ambient default project is never used). The access token goes from
 * gcloud straight into the request header and is never printed.
 *   usage: pnpm usage-report --project <gcp-project-id> [--days 7]
 */
import { execFileSync } from "node:child_process";

export interface BudgetDoc {
  /** Document id: `{YYYY-MM-DD JST}_{label}`; label `site` is the whole site. */
  id: string;
  spentMicroUsd: number;
  submits: number;
  succeeded: number;
  failed: number;
  limitMicroUsd: number | null;
}

export interface LabelSummary {
  label: string;
  today: { submits: number; succeeded: number; failed: number; spentMicroUsd: number; limitMicroUsd: number | null };
  total: { submits: number; succeeded: number; failed: number; spentMicroUsd: number; days: number };
  byDay: { day: string; submits: number; succeeded: number; failed: number; spentMicroUsd: number }[];
}

type FirestoreValue = { integerValue?: string; doubleValue?: number };

/** Firestore REST field values → numbers (missing fields count as 0, a missing limit as unknown). */
export function decodeDoc(name: string, fields: Record<string, FirestoreValue> = {}): BudgetDoc {
  const num = (key: string): number | null => {
    const v = fields[key];
    if (v?.integerValue !== undefined) return Number(v.integerValue);
    if (v?.doubleValue !== undefined) return v.doubleValue;
    return null;
  };
  return {
    id: name.split("/").pop() ?? name,
    spentMicroUsd: num("spentMicroUsd") ?? 0,
    submits: num("submits") ?? 0,
    succeeded: num("succeeded") ?? 0,
    failed: num("failed") ?? 0,
    limitMicroUsd: num("limitMicroUsd"),
  };
}

export function jstDay(now: number): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** Groups budget documents by label; `site` sorts last. */
export function summarize(docs: readonly BudgetDoc[], today: string): LabelSummary[] {
  const byLabel = new Map<string, LabelSummary>();
  for (const d of docs) {
    const match = /^(\d{4}-\d{2}-\d{2})_(.+)$/.exec(d.id);
    if (!match) continue;
    const [, day, label] = match;
    const s = byLabel.get(label) ?? {
      label,
      today: { submits: 0, succeeded: 0, failed: 0, spentMicroUsd: 0, limitMicroUsd: null },
      total: { submits: 0, succeeded: 0, failed: 0, spentMicroUsd: 0, days: 0 },
      byDay: [],
    };
    s.total.submits += d.submits;
    s.total.succeeded += d.succeeded;
    s.total.failed += d.failed;
    s.total.spentMicroUsd += d.spentMicroUsd;
    s.total.days += 1;
    s.byDay.push({ day, submits: d.submits, succeeded: d.succeeded, failed: d.failed, spentMicroUsd: d.spentMicroUsd });
    if (day === today) {
      s.today = { submits: d.submits, succeeded: d.succeeded, failed: d.failed, spentMicroUsd: d.spentMicroUsd, limitMicroUsd: d.limitMicroUsd };
    }
    byLabel.set(label, s);
  }
  for (const s of byLabel.values()) s.byDay.sort((a, b) => b.day.localeCompare(a.day));
  return [...byLabel.values()].sort((a, b) => (a.label === "site" ? 1 : b.label === "site" ? -1 : a.label.localeCompare(b.label)));
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

export function format(summaries: readonly LabelSummary[], today: string, days: number): string {
  const lines = [`Kumihimo usage · today ${today} (JST)`, ""];
  lines.push("label        today: sent  ok  failed  spent / limit (left)        all time: sent  ok  failed  spent   days");
  for (const s of summaries) {
    const t = s.today;
    const left = t.limitMicroUsd === null ? "?" : usd(Math.max(0, t.limitMicroUsd - t.spentMicroUsd));
    const limit = t.limitMicroUsd === null ? "?" : usd(t.limitMicroUsd);
    lines.push(
      [
        s.label.padEnd(12),
        String(t.submits).padStart(11),
        String(t.succeeded).padStart(3),
        String(t.failed).padStart(7),
        `  ${usd(t.spentMicroUsd)} / ${limit} (${left})`.padEnd(29),
        String(s.total.submits).padStart(10),
        String(s.total.succeeded).padStart(3),
        String(s.total.failed).padStart(7),
        `  ${usd(s.total.spentMicroUsd)}`.padEnd(8),
        String(s.total.days).padStart(5),
      ].join(""),
    );
  }
  if (summaries.length === 0) lines.push("(no live submissions yet)");
  if (days > 0) {
    lines.push("", `Last ${days} days (sent / ok / failed / spent):`);
    for (const s of summaries) {
      const recent = s.byDay.slice(0, days).map((d) => `${d.day} ${d.submits}/${d.succeeded}/${d.failed}/${usd(d.spentMicroUsd)}`);
      lines.push(`  ${s.label.padEnd(10)} ${recent.join("  ") || "-"}`);
    }
  }
  return lines.join("\n");
}

async function fetchBudgetDocs(project: string, token: string): Promise<BudgetDoc[]> {
  const docs: BudgetDoc[] = [];
  let pageToken = "";
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/budget`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": project },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Firestore answered ${res.status} for ${project}`);
    const body = (await res.json()) as { documents?: { name: string; fields?: Record<string, FirestoreValue> }[]; nextPageToken?: string };
    for (const d of body.documents ?? []) docs.push(decodeDoc(d.name, d.fields));
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return docs;
}

async function main(argv: string[]) {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const project = arg("--project");
  if (!project || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
    console.error("usage: pnpm usage-report --project <gcp-project-id> [--days 7]");
    process.exit(2);
  }
  const days = Number(arg("--days") ?? "0") || 0;
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const today = jstDay(Date.now());
  console.log(format(summarize(await fetchBudgetDocs(project, token), today), today, days));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
