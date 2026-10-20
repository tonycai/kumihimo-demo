/**
 * Budget, concurrency and rate-limit decisions (DP-04). Pure: every store (memory,
 * dev file ledger, Firestore) loads the same state, calls these, and writes the result, so the
 * rules are tested once. Money is in integer micro-USD to avoid float drift.
 */

export type ReserveFailure = "passcode_budget" | "site_budget" | "concurrency";

export interface ReserveRequest {
  /** One per submission; also the concurrency slot key. */
  reservationId: string;
  /** Passcode tag, never the passcode itself. */
  passcodeLabel: string;
  /** Cost reserved up front at the upper bound; never refunded. */
  costMicroUsd: number;
  passcodeDailyMicroUsd: number;
  siteDailyMicroUsd: number;
  maxConcurrent: number;
  /** Slot lease: a slot nobody releases expires on its own (image 2 min, video 6 min). */
  leaseMs: number;
  now: number;
}

export interface BudgetState {
  passcodeSpentMicroUsd: number;
  siteSpentMicroUsd: number;
  /** reservationId → lease expiry (epoch ms). */
  slots: Readonly<Record<string, number>>;
}

export type ReserveDecision =
  | { ok: true; next: BudgetState }
  | { ok: false; reason: ReserveFailure; next: BudgetState };

export function liveSlots(slots: Readonly<Record<string, number>>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, expiresAt] of Object.entries(slots)) if (expiresAt > now) out[id] = expiresAt;
  return out;
}

/**
 * All three limits pass, or nothing is written except pruning expired slots: no half-success
 * where money is taken but no slot is granted.
 */
export function decideReserve(state: BudgetState, req: ReserveRequest): ReserveDecision {
  const slots = liveSlots(state.slots, req.now);
  const pruned: BudgetState = { ...state, slots };
  if (Object.keys(slots).length >= req.maxConcurrent) return { ok: false, reason: "concurrency", next: pruned };
  if (state.passcodeSpentMicroUsd + req.costMicroUsd > req.passcodeDailyMicroUsd) {
    return { ok: false, reason: "passcode_budget", next: pruned };
  }
  if (state.siteSpentMicroUsd + req.costMicroUsd > req.siteDailyMicroUsd) {
    return { ok: false, reason: "site_budget", next: pruned };
  }
  return {
    ok: true,
    next: {
      passcodeSpentMicroUsd: state.passcodeSpentMicroUsd + req.costMicroUsd,
      siteSpentMicroUsd: state.siteSpentMicroUsd + req.costMicroUsd,
      slots: { ...slots, [req.reservationId]: req.now + req.leaseMs },
    },
  };
}

export function decideRelease(
  slots: Readonly<Record<string, number>>,
  reservationId: string,
  now: number,
): Record<string, number> {
  const next = liveSlots(slots, now);
  delete next[reservationId];
  return next;
}

/** Budget day in JST (the demo's daily cap resets at midnight Tokyo time). */
export function jstDay(now: number): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

export type RateBucket = "submit" | "passcode_fail" | "demo";

export interface RateHit {
  bucket: RateBucket;
  /** Salted hash of the client IP; the raw address is never stored. */
  ipHash: string;
  windowMs: number;
  limit: number;
  now: number;
}

export function rateWindow(hit: RateHit): { key: string; expireAt: number } {
  const start = Math.floor(hit.now / hit.windowMs) * hit.windowMs;
  // Kept one extra window so the document outlives its own window; Firestore TTL deletes it
  // later (typically within 24 h), and reads never trust a document past `expireAt`.
  return { key: `${hit.bucket}_${start}_${hit.ipHash}`, expireAt: start + hit.windowMs * 2 };
}

export function decideRate(count: number, hit: RateHit): { allowed: boolean; count: number } {
  const next = count + 1;
  return { allowed: next <= hit.limit, count: next };
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Labels, hashes and ids become document ids: no slashes, bounded length. */
export function assertSafeId(value: string, what: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`unsafe ${what}`);
  return value;
}
