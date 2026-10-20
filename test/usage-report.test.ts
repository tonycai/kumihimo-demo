import { describe, expect, it } from "vitest";

import { decodeDoc, format, summarize } from "../scripts/usage-report";

/** DP-10: the read-only usage report an operator runs (scripts/usage-report.ts). */
const doc = (id: string, fields: Record<string, number>) =>
  decodeDoc(
    `projects/p/databases/(default)/documents/budget/${id}`,
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }])),
  );

describe("usage report (DP-10)", () => {
  const docs = [
    doc("2026-10-21_atlas", { spentMicroUsd: 330_000, submits: 6, succeeded: 6, failed: 0, limitMicroUsd: 3_000_000 }),
    doc("2026-10-22_atlas", { spentMicroUsd: 110_000, submits: 2, succeeded: 1, failed: 1, limitMicroUsd: 3_000_000 }),
    doc("2026-10-22_site", { spentMicroUsd: 110_000, submits: 2, succeeded: 1, failed: 1, limitMicroUsd: 5_000_000 }),
    doc("2026-10-20_tony", { spentMicroUsd: 5_000, submits: 1 }), // written before the counters existed: no limit
  ];

  it("totals per label, today and all time; site last", () => {
    const s = summarize(docs, "2026-10-22");
    expect(s.map((x) => x.label)).toEqual(["atlas", "tony", "site"]);
    expect(s[0].today).toEqual({ submits: 2, succeeded: 1, failed: 1, spentMicroUsd: 110_000, limitMicroUsd: 3_000_000 });
    expect(s[0].total).toEqual({ submits: 8, succeeded: 7, failed: 1, spentMicroUsd: 440_000, days: 2 });
    expect(s[1].today).toEqual({ submits: 0, succeeded: 0, failed: 0, spentMicroUsd: 0, limitMicroUsd: null });
  });

  it("prints money left today, and ? where the limit is unknown", () => {
    const text = format(summarize(docs, "2026-10-22"), "2026-10-22", 2);
    expect(text).toMatch(/atlas\s+2\s+1\s+1\s+\$0\.11 \/ \$3\.00 \(\$2\.89\)/);
    expect(text).toMatch(/tony\s+0\s+0\s+0\s+\$0\.00 \/ \? \(\?\)/);
    expect(text).toContain("2026-10-22 2/1/1/$0.11  2026-10-21 6/6/0/$0.33");
  });

  it("says so when nothing has been submitted", () => {
    expect(format([], "2026-10-22", 0)).toContain("(no live submissions yet)");
  });
});
