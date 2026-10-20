import { z } from "zod";

import { readLiveConfig } from "@/server/config";
import { readServerEnv } from "@/server/env";
import { logEvent } from "@/server/events";
import { apiError, json, readJson } from "@/server/http";
import { ipHashFor, rateLimited } from "@/server/live-gate";
import { checkPasscode, clearedSessionCookie, issueSession, sessionCookie } from "@/server/session";
import { usageStore } from "@/server/usage/runtime";

const loginShape = z.object({ passcode: z.string().min(1).max(200) }).strict();

/**
 * DP-01: the passcode arrives only in this POST body and is never logged or echoed. Wrong
 * attempts are rate limited per IP hash (DP-03); a match yields a signed HttpOnly session cookie.
 */
export async function POST(request: Request): Promise<Response> {
  const env = readServerEnv();
  const config = readLiveConfig();
  const now = Date.now();
  if (!config.sessionSecret || config.passcodes.length === 0) {
    return apiError(503, "live_off", "Live mode is not available on this deployment.");
  }
  const ipHash = ipHashFor(request, env, config);
  if (!ipHash) return apiError(503, "live_off", "Live mode is not available on this deployment.");

  let store;
  try {
    store = await usageStore();
  } catch {
    return apiError(503, "live_off", "Live mode is paused.");
  }
  // Once an address has used up its wrong guesses, every attempt waits out the minute — even a right one.
  const failures = await store.peekRate({ bucket: "passcode_fail", ipHash, windowMs: 60_000, limit: config.passcodeFailPerMinute, now });
  if (failures > config.passcodeFailPerMinute) {
    logEvent("passcode_rate_limited");
    return apiError(429, "rate_limited", "Too many attempts. Please wait a minute.");
  }

  const body = await readJson(request, 1_024);
  if (!body.ok) return body.response;
  const parsed = loginShape.safeParse(body.value);
  if (!parsed.success) return apiError(400, "bad_request", "Expected { passcode }.");

  const check = checkPasscode(parsed.data.passcode, config, now);
  if (!check.ok) {
    const limited = await rateLimited(store, "passcode_fail", ipHash, config.passcodeFailPerMinute, now);
    if (limited) {
      logEvent("passcode_rate_limited");
      return limited;
    }
    return check.reason === "expired"
      ? apiError(401, "unauthorized", "This passcode has expired. You can continue in demo mode.")
      : apiError(401, "unauthorized", "That passcode is not valid.");
  }

  const expiresAt = Math.min(now + config.sessionHours * 3_600_000, Date.parse(check.entry.expiresAt));
  const token = issueSession({ label: check.entry.label, expiresAt }, config.sessionSecret);
  const res = json({ mode: "live" });
  res.headers.append("Set-Cookie", sessionCookie(token, (expiresAt - now) / 1000, !env.isDevelopment));
  return res;
}

export async function DELETE(): Promise<Response> {
  const res = json({ mode: "mock" });
  res.headers.append("Set-Cookie", clearedSessionCookie(!readServerEnv().isDevelopment));
  return res;
}
