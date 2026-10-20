import "server-only";

import { z } from "zod";

/**
 * Live-mode protection settings. Secret values arrive as environment variables from
 * Secret Manager (stage 3); this module never logs or returns them.
 */

const passcodeEntry = z.object({
  /** Who it was sent to, e.g. "atlas". Becomes part of document ids. */
  label: z.string().regex(/^[a-z0-9-]{1,32}$/),
  /** Hex SHA-256 of the passcode; the passcode itself is never stored anywhere. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** ISO date-time after which the passcode stops working (DP-01). */
  expiresAt: z.string().datetime({ offset: true }),
  /** Per-passcode daily budget in USD. */
  dailyBudgetUsd: z.number().positive().max(50),
});

export type PasscodeEntry = z.infer<typeof passcodeEntry>;

export interface LiveConfig {
  passcodes: PasscodeEntry[];
  sessionSecret: string | undefined;
  ipSalt: string | undefined;
  siteDailyBudgetUsd: number;
  /** Server-side global cap across instances; the browser's limit of 3 is only for feel. */
  maxConcurrent: number;
  submitPerMinute: number;
  passcodeFailPerMinute: number;
  /** Demo routes cost nothing upstream but still occupy instances. */
  /** Most billable nodes one live run may submit. */
  maxBillablePerRun: number;
  /** Which X-Forwarded-For entry is the client, counted from the right (0 = last). */
  forwardedHops: number;
  sessionHours: number;
}

const num = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== undefined && raw !== "" ? Math.min(max, Math.max(min, n)) : fallback;
};

function parsePasscodes(raw: string | undefined): PasscodeEntry[] {
  if (!raw) return [];
  try {
    const parsed = z.array(passcodeEntry).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function readLiveConfig(source: Readonly<Record<string, string | undefined>> = process.env): LiveConfig {
  const secret = source.KUMIHIMO_SESSION_SECRET?.trim();
  const salt = source.KUMIHIMO_IP_SALT?.trim();
  return {
    passcodes: parsePasscodes(source.KUMIHIMO_PASSCODES),
    // Short secrets would make forged sessions guessable: treat them as missing (fail closed).
    sessionSecret: secret && secret.length >= 32 ? secret : undefined,
    ipSalt: salt && salt.length >= 16 ? salt : undefined,
    siteDailyBudgetUsd: num(source.KUMIHIMO_SITE_DAILY_USD, 5, 0.01, 100),
    maxConcurrent: num(source.KUMIHIMO_MAX_CONCURRENT, 3, 1, 10),
    submitPerMinute: num(source.KUMIHIMO_SUBMIT_PER_MINUTE, 10, 1, 120),
    passcodeFailPerMinute: num(source.KUMIHIMO_PASSCODE_FAIL_PER_MINUTE, 5, 1, 60),
    maxBillablePerRun: 8,
    forwardedHops: num(source.KUMIHIMO_FORWARDED_HOPS, 0, 0, 3),
    sessionHours: num(source.KUMIHIMO_SESSION_HOURS, 12, 1, 72),
  };
}
