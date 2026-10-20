import "server-only";

import { createHash } from "node:crypto";

import {
  assertSafeId,
  decideRate,
  decideRelease,
  decideReserve,
  jstDay,
  rateWindow,
  type BudgetState,
  type RateHit,
  type ReserveFailure,
  type ReserveRequest,
} from "./rules";

/**
 * Cross-instance usage counters (architecture §4). Cloud Run scales to zero and may run
 * several instances, so nothing here may live only in process memory in production.
 */
export interface UsageStore {
  reserve(req: ReserveRequest): Promise<{ ok: true } | { ok: false; reason: ReserveFailure }>;
  release(reservationId: string, now: number): Promise<void>;
  hitRateLimit(hit: RateHit): Promise<{ allowed: boolean; count: number }>;
  /** Current count in the hit's window, without adding to it. */
  peekRate(hit: RateHit): Promise<number>;
  /** Binds a live prediction to the passcode session that created it. */
  bindPrediction(predictionId: string, info: PredictionInfo, expireAt: number): Promise<void>;
  predictionInfo(predictionId: string, now: number): Promise<PredictionInfo | null>;
  /** Server half of the upload rule: URLs that carry an uploaded image. */
  markUploadDerived(urls: readonly string[], expireAt: number): Promise<void>;
  isUploadDerived(url: string, now: number): Promise<boolean>;
  /**
   * DP-10: counts a finished submission as succeeded or failed for its passcode label and JST day.
   * With `predictionId` it counts once per prediction, however often the result is polled.
   */
  recordOutcome(passcodeLabel: string, ok: boolean, now: number, predictionId?: string): Promise<void>;
}

/** DP-10 counters kept beside the money in each budget document (no prompts, images or addresses). */
export interface UsageCounts {
  /** Accepted submissions (budget reserved). */
  submits: number;
  succeeded: number;
  failed: number;
  /** That day's limit, so a report can show what is left without reading the passcode secret. */
  limitMicroUsd?: number;
}

export function countsOf(data: Record<string, unknown> | undefined): UsageCounts {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const limit = data?.limitMicroUsd;
  return {
    submits: n(data?.submits),
    succeeded: n(data?.succeeded),
    failed: n(data?.failed),
    ...(typeof limit === "number" ? { limitMicroUsd: limit } : {}),
  };
}

export interface PredictionInfo {
  passcodeLabel: string;
  /** Concurrency slot to release when the prediction finishes. */
  reservationId: string | null;
  /** Its input came from an upload, so its outputs do too. */
  uploadDerived: boolean;
}

/** Atlas prediction ids may contain `.` and `:`; hash them into safe, fixed-length doc ids. */
export function predictionKey(predictionId: string): string {
  return createHash("sha256").update(predictionId).digest("hex").slice(0, 40);
}

/** URLs are stored only as hashes. */
export function urlKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 40);
}

export function budgetKeys(req: Pick<ReserveRequest, "passcodeLabel" | "now">) {
  const day = jstDay(req.now);
  return {
    passcode: `${day}_${assertSafeId(req.passcodeLabel, "passcode label")}`,
    site: `${day}_site`,
  };
}

// ── In-memory: tests and the reference behaviour ───────────────────────────────────────────

export interface MemoryState {
  budget: Record<string, number>;
  slots: Record<string, number>;
  rate: Record<string, { count: number; expireAt: number }>;
  predictions: Record<string, PredictionInfo & { expireAt: number; outcome?: "ok" | "failed" }>;
  uploads: Record<string, number>;
  counts: Record<string, UsageCounts>;
}

export function emptyMemoryState(): MemoryState {
  return { budget: {}, slots: {}, rate: {}, predictions: {}, uploads: {}, counts: {} };
}

/** Operations run one at a time, like a transaction per call. */
export function createMemoryUsageStore(state: MemoryState = emptyMemoryState()): UsageStore & { state: MemoryState } {
  return {
    state,
    async reserve(req) {
      const keys = budgetKeys(req);
      const current: BudgetState = {
        passcodeSpentMicroUsd: state.budget[keys.passcode] ?? 0,
        siteSpentMicroUsd: state.budget[keys.site] ?? 0,
        slots: state.slots,
      };
      const decision = decideReserve(current, { ...req, reservationId: assertSafeId(req.reservationId, "reservation id") });
      state.slots = { ...decision.next.slots };
      if (!decision.ok) return { ok: false, reason: decision.reason };
      state.budget[keys.passcode] = decision.next.passcodeSpentMicroUsd;
      state.budget[keys.site] = decision.next.siteSpentMicroUsd;
      state.counts ??= {};
      for (const [key, limit] of [
        [keys.passcode, req.passcodeDailyMicroUsd],
        [keys.site, req.siteDailyMicroUsd],
      ] as const) {
        const c = countsOf(state.counts[key] as unknown as Record<string, unknown>);
        state.counts[key] = { ...c, submits: c.submits + 1, limitMicroUsd: limit };
      }
      return { ok: true };
    },
    async release(reservationId, now) {
      state.slots = decideRelease(state.slots, reservationId, now);
    },
    async hitRateLimit(hit) {
      assertSafeId(hit.ipHash, "ip hash");
      const { key, expireAt } = rateWindow(hit);
      const existing = state.rate[key];
      const count = existing && existing.expireAt > hit.now ? existing.count : 0;
      const result = decideRate(count, hit);
      state.rate[key] = { count: result.count, expireAt };
      return result;
    },
    async peekRate(hit) {
      assertSafeId(hit.ipHash, "ip hash");
      const existing = state.rate[rateWindow(hit).key];
      return existing && existing.expireAt > hit.now ? existing.count : 0;
    },
    async bindPrediction(predictionId, info, expireAt) {
      assertSafeId(info.passcodeLabel, "passcode label");
      state.predictions[predictionKey(predictionId)] = { ...info, expireAt };
    },
    async predictionInfo(predictionId, now) {
      const entry = state.predictions[predictionKey(predictionId)];
      if (!entry || entry.expireAt <= now) return null;
      return { passcodeLabel: entry.passcodeLabel, reservationId: entry.reservationId, uploadDerived: entry.uploadDerived };
    },
    async markUploadDerived(urls, expireAt) {
      state.uploads ??= {};
      for (const url of urls) state.uploads[urlKey(url)] = expireAt;
    },
    async isUploadDerived(url, now) {
      return (state.uploads?.[urlKey(url)] ?? 0) > now;
    },
    async recordOutcome(passcodeLabel, ok, now, predictionId) {
      const keys = budgetKeys({ passcodeLabel, now });
      if (predictionId !== undefined) {
        const entry = state.predictions[predictionKey(predictionId)];
        if (entry?.outcome) return;
        if (entry) entry.outcome = ok ? "ok" : "failed";
      }
      state.counts ??= {};
      for (const key of [keys.passcode, keys.site]) {
        const c = countsOf(state.counts[key] as unknown as Record<string, unknown>);
        state.counts[key] = ok ? { ...c, succeeded: c.succeeded + 1 } : { ...c, failed: c.failed + 1 };
      }
    },
  };
}
