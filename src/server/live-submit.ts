import "server-only";

import { randomUUID } from "node:crypto";

import { isUploadSafe, type ModelSpec } from "@/atlas/models";

import { apiError } from "./http";
import { logEvent } from "./events";
import type { LiveContext } from "./live-gate";

const MICRO = 1_000_000;
/** A slot nobody releases frees itself after this long (architecture §4). */
export const LEASE_MS = { image: 120_000, video: 360_000, chat: 120_000 } as const;
/**
 * How long a prediction stays bound to its passcode (1 day, so with TTL
 * deletion the record is gone within 2 days; privacy notice "最長 2 日間").
 */
export const PREDICTION_TTL_MS = 86_400_000;
/**
 * Upload-derived URLs are remembered for 15 days: longer than Atlas keeps any result (24 h with the retention headers,
 * 14 days without), and uploaded files have no published expiry. Longer is stricter, never looser.
 */
export const UPLOAD_LINEAGE_TTL_MS = 15 * 86_400_000;

export type Reservation = { ok: true; reservationId: string } | { ok: false; response: Response };

/** DP-04: passcode budget + site budget + concurrency slot in one transaction, at the upper bound. */
export async function reserve(ctx: LiveContext, costMicroUsd: number, leaseMs: number): Promise<Reservation> {
  const entry = ctx.config.passcodes.find((p) => p.label === ctx.session.label);
  const siteDaily = Math.round(ctx.config.siteDailyBudgetUsd * MICRO);
  const reservationId = randomUUID().replaceAll("-", "");
  const result = await ctx.store.reserve({
    reservationId,
    passcodeLabel: ctx.session.label,
    costMicroUsd,
    passcodeDailyMicroUsd: entry ? Math.round(entry.dailyBudgetUsd * MICRO) : siteDaily,
    siteDailyMicroUsd: siteDaily,
    maxConcurrent: ctx.config.maxConcurrent,
    leaseMs,
    now: ctx.now,
  });
  if (result.ok) return { ok: true, reservationId };
  if (result.reason === "concurrency") {
    return { ok: false, response: apiError(429, "rate_limited", "Live mode is busy with other tasks. Try again in a moment.") };
  }
  logEvent("budget_exhausted"); // DP-10 alert; which passcode is in the usage report, not the log
  return {
    ok: false,
    response: apiError(429, "budget_exhausted", "Today's live budget is used up. You can continue in demo mode."),
  };
}

/**
 * Upload rule, server side: an image that came from an upload — directly or
 * through earlier results — may only go to a model Atlas is verified to run itself.
 */
export async function checkUploadRule(
  ctx: LiveContext,
  image: string,
  model: ModelSpec,
): Promise<{ ok: true; uploadDerived: boolean } | { ok: false; response: Response }> {
  const derived = await ctx.store.isUploadDerived(image, ctx.now);
  if (derived && !isUploadSafe(model)) {
    return {
      ok: false,
      response: apiError(
        403,
        "upload_not_allowed",
        "Uploaded images can only go to models Atlas Cloud runs itself (Atlas Image Upscaler).",
      ),
    };
  }
  return { ok: true, uploadDerived: derived };
}

export async function bind(ctx: LiveContext, predictionId: string, reservationId: string, uploadDerived: boolean) {
  await ctx.store.bindPrediction(
    predictionId,
    { passcodeLabel: ctx.session.label, reservationId, uploadDerived },
    ctx.now + PREDICTION_TTL_MS,
  );
}
