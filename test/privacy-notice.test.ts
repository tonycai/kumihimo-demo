import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as ctaRedirect } from "@/app/go/contact/route";
import { PRIVACY_EN, PRIVACY_JA, type Block } from "@/i18n/privacy";
import { demoPrivacyEn, demoPrivacyJa, hostingOf } from "@/i18n/privacy-demo";
import { PREDICTION_TTL_MS, UPLOAD_LINEAGE_TTL_MS } from "@/server/live-submit";
import { sessionCookie } from "@/server/session";
import { rateWindow } from "@/server/usage/rules";
import { CONTACT_URL } from "@/site/links";

/**
 * The privacy notice (DP-09) must match what the server actually keeps: each retention
 * row is the expiry the code sets plus up to 24 h for Firestore's TTL deletion.
 */
const DAY = 86_400_000;
const TTL_DELAY = DAY;

function rows(blocks: Block[]): [string, string][] {
  const table = blocks.find((b): b is Extract<Block, { table: unknown }> => "table" in b);
  return table?.table.rows ?? [];
}

const retention = (text: typeof PRIVACY_EN, label: RegExp) => rows(text.blocks).find(([what]) => label.test(what))?.[1];

describe("live-mode privacy notice (v0.3, shown only once live mode is on) matches the code (DP-09)", () => {
  it("rate-limit hashes: one-minute windows, kept two windows, then TTL → up to 25 hours", () => {
    const { expireAt } = rateWindow({ bucket: "submit", ipHash: "h", windowMs: 60_000, now: 0 } as never);
    expect(Math.ceil((expireAt + TTL_DELAY) / 3_600_000)).toBeLessThanOrEqual(25);
    expect(retention(PRIVACY_EN, /rate limiting/)).toBe("Up to 25 hours");
    expect(retention(PRIVACY_JA, /アクセス制限/)).toBe("最長 25 時間");
  });

  it("prediction ↔ passcode links: 1 day, then TTL → up to 2 days", () => {
    expect((PREDICTION_TTL_MS + TTL_DELAY) / DAY).toBe(2);
    expect(retention(PRIVACY_EN, /generation ID/)).toBe("Up to 2 days");
    expect(retention(PRIVACY_JA, /受付番号/)).toBe("最長 2 日間");
  });

  it("upload lineage hashes: 15 days, then TTL → up to 16 days", () => {
    expect((UPLOAD_LINEAGE_TTL_MS + TTL_DELAY) / DAY).toBe(16);
    expect(retention(PRIVACY_EN, /derived from uploaded images/)).toBe("Up to 16 days");
    expect(retention(PRIVACY_JA, /アップロード画像に由来/)).toBe("最長 16 日間");
  });

  it("the session cookie belongs to this host only (no Domain), as §1.4 says", () => {
    expect(sessionCookie("t", 60, true)).not.toMatch(/Domain=/i);
    expect(JSON.stringify(PRIVACY_JA.blocks)).toMatch(/本デモではこれらを利用せず、記録もしません/);
  });

  it("names the recipient and its country in both languages", () => {
    const all = (t: typeof PRIVACY_EN) => JSON.stringify(t.blocks);
    expect(all(PRIVACY_JA)).toMatch(/ATLAS CLOUD AI INC\.（アメリカ合衆国）/);
    expect(all(PRIVACY_EN)).toMatch(/ATLAS CLOUD AI INC\. \(United States\)/);
  });
});

describe("Work with SolanaLink (DM-06)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redirects to the contact form with the UTM tags and logs only the event name", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = ctaRedirect();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(CONTACT_URL);
    expect(new URL(CONTACT_URL).searchParams.get("utm_source")).toBe("kumihimo");
    expect(new URL(CONTACT_URL).searchParams.get("utm_medium")).toBe("demo");
    expect(new URL(CONTACT_URL).searchParams.get("from")).toBe("kumihimo");
    expect(new URL(CONTACT_URL).pathname).toBe("/ja/contact-us/");
    expect(log.mock.calls).toEqual([[JSON.stringify({ severity: "INFO", event: "cta_clicked" })]]);
  });
});

describe("demo-data privacy notice (v0.4, what /privacy shows now)", () => {
  const text = (t: ReturnType<typeof demoPrivacyJa>) => JSON.stringify(t.blocks);
  const headings = (t: ReturnType<typeof demoPrivacyJa>) => t.blocks.filter((b): b is { h: string } => "h" in b).map((b) => b.h);

  it("tells where it is served from by the Host header", () => {
    expect(hostingOf("127.0.0.1:3080")).toEqual({ public: false, solanalinkSubdomain: false });
    expect(hostingOf("localhost:3070")).toEqual({ public: false, solanalinkSubdomain: false });
    expect(hostingOf("kumihimo-abc-an.a.run.app")).toEqual({ public: true, solanalinkSubdomain: false });
    expect(hostingOf("kumihimo.solanalink.jp")).toEqual({ public: true, solanalinkSubdomain: true });
  });

  it("on this computer: no server logs or hosting section, no parent-domain cookies", () => {
    const ja = demoPrivacyJa(hostingOf("127.0.0.1:3080"));
    expect(text(ja)).toContain("当社のサーバーには送信されません");
    expect(text(ja)).not.toMatch(/運用環境|アクセスログ|solanalink\.jp 全体/);
    expect(headings(ja).map((h) => h.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("served publicly under solanalink.jp: access logs, hosting and parent-domain cookies are described", () => {
    const h = hostingOf("kumihimo.solanalink.jp");
    const ja = demoPrivacyJa(h);
    const en = demoPrivacyEn(h);
    expect(text(ja)).toMatch(/運用環境/);
    expect(text(ja)).toMatch(/アクセスログ/);
    expect(text(ja)).toMatch(/solanalink\.jp 全体/);
    expect(headings(ja)).toHaveLength(7);
    expect(headings(en)).toHaveLength(7);
    expect(text(en)).toMatch(/Hosting/);
  });

  it("never describes sending anything to an AI provider, consent or retention periods", () => {
    for (const h of [hostingOf("127.0.0.1"), hostingOf("kumihimo.solanalink.jp")]) {
      for (const t of [demoPrivacyJa(h), demoPrivacyEn(h)]) {
        expect(text(t)).not.toMatch(/ATLAS CLOUD|保存期間|Retention|同意|consent/i);
        expect(t.blocks.some((b) => "table" in b)).toBe(false);
      }
    }
  });
});
