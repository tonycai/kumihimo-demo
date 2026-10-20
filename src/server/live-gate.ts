import "server-only";

import { clientIp, hashIp } from "./client-ip";
import { readLiveConfig, type LiveConfig } from "./config";
import { readServerEnv, type ServerEnv } from "./env";
import { apiError } from "./http";
import { readCookie, SESSION_COOKIE, verifySession, type Session } from "./session";
import type { RateBucket } from "./usage/rules";
import type { UsageStore } from "./usage/store";
import { sharedStoreAvailable, usageStore } from "./usage/runtime";

/** Only for `next dev` without configured passcodes (local AT-03 check); never in production. */
const DEV_SALT = "kumihimo-development-only-salt";

export function sessionFor(request: Request, env: ServerEnv, config: LiveConfig, now: number): Session | null {
  const session = verifySession(readCookie(request, SESSION_COOKIE), config, now);
  if (session) return session;
  // Local live testing with a key in .env.local and no passcodes configured (stage 0 AT-03 path).
  if (env.isDevelopment && config.passcodes.length === 0) return { label: "dev", expiresAt: now + 3_600_000 };
  return null;
}

export function ipHashFor(request: Request, env: ServerEnv, config: LiveConfig): string | null {
  const salt = config.ipSalt ?? (env.isDevelopment || process.env.NODE_ENV === "test" ? DEV_SALT : undefined);
  if (!salt) return null;
  return hashIp(clientIp(request, config.forwardedHops) ?? "unknown", salt);
}

export interface LiveContext {
  env: ServerEnv;
  config: LiveConfig;
  session: Session;
  ipHash: string;
  store: UsageStore;
  now: number;
}

export async function rateLimited(
  store: UsageStore,
  bucket: RateBucket,
  ipHash: string,
  limit: number,
  now: number,
): Promise<Response | null> {
  const result = await store.hitRateLimit({ bucket, ipHash, windowMs: 60_000, limit, now });
  return result.allowed ? null : apiError(429, "rate_limited", "Too many requests. Please wait a minute and try again.");
}

/**
 * Every /api/atlas/* request passes here first (DP-01, DP-03, DP-08). Anything missing fails
 * closed: no Atlas request is made unless all checks pass.
 */
export async function openLive(
  request: Request,
  options: { rateLimit: boolean },
): Promise<{ ok: true; ctx: LiveContext } | { ok: false; response: Response }> {
  const env = readServerEnv();
  const config = readLiveConfig();
  const now = Date.now();
  if (!env.liveModeOn) {
    return { ok: false, response: apiError(503, "live_off", "Live mode is temporarily off. You can continue in demo mode.") };
  }
  if (!env.apiKey) return { ok: false, response: apiError(503, "live_off", "Live mode is not configured.") };
  const session = sessionFor(request, env, config, now);
  if (!session) return { ok: false, response: apiError(401, "unauthorized", "Enter the demo passcode to use live mode.") };
  const ipHash = ipHashFor(request, env, config);
  if (!ipHash) return { ok: false, response: apiError(503, "live_off", "Live mode is not configured.") };
  // Budgets and concurrency must hold across instances (DP-04): no shared store, no live mode.
  if (!sharedStoreAvailable()) return { ok: false, response: apiError(503, "live_off", "Live mode is not configured.") };
  let store: UsageStore;
  try {
    store = await usageStore();
    if (options.rateLimit) {
      const limited = await rateLimited(store, "submit", ipHash, config.submitPerMinute, now);
      if (limited) return { ok: false, response: limited };
    }
  } catch {
    return { ok: false, response: apiError(503, "live_off", "Usage limits are unavailable, so live mode is paused.") };
  }
  return { ok: true, ctx: { env, config, session, ipHash, store, now } };
}
