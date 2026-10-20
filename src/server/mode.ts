import "server-only";

import type { AtlasAdapter } from "@/atlas/adapter";
import { createLiveAdapter } from "@/atlas/live";
import type { ModeDecision } from "@/atlas/types";

import { readLiveConfig } from "./config";
import { readServerEnv, type ServerEnv } from "./env";
import { sessionFor } from "./live-gate";

export interface SessionState {
  /** A valid passcode session (DP-01). */
  valid: boolean;
}

/**
 * Decided on the server for every request; the browser cannot ask for live mode.
 * Order matters: the emergency switch wins over everything (DP-08).
 */
export function resolveMode(env: ServerEnv, session: SessionState): ModeDecision {
  if (!env.liveModeOn) return { mode: "mock", reason: "live_mode_off", signedIn: session.valid };
  if (!env.apiKey) return { mode: "mock", reason: "no_api_key", signedIn: session.valid };
  if (!session.valid) return { mode: "mock", reason: "no_session", signedIn: false };
  return { mode: "live", reason: "live", signedIn: true };
}

/** What GET /api/mode reports: live requests go to /api/atlas/*, demo mode stays in the browser. */
export function modeForRequest(request: Request, env: ServerEnv = readServerEnv()): ModeDecision {
  const session = sessionFor(request, env, readLiveConfig(), Date.now());
  return { ...resolveMode(env, { valid: session !== null }), demoDelayScale: env.mockDelayScale };
}

export function liveAdapter(env: ServerEnv): AtlasAdapter {
  if (!env.apiKey) throw new Error("live adapter without a key");
  return createLiveAdapter({ apiKey: env.apiKey });
}

