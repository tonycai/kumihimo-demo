import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { LiveConfig, PasscodeEntry } from "./config";

/**
 * Passcode sessions (DP-01): the passcode arrives once in a POST body, is compared by hash in
 * constant time, and is exchanged for a short-lived signed HttpOnly cookie that carries only the
 * passcode's label and an expiry.
 */

export const SESSION_COOKIE = "kumihimo_session";

export interface Session {
  label: string;
  /** Epoch ms. */
  expiresAt: number;
}

const b64 = (buf: Buffer) => buf.toString("base64url");

function sign(payload: string, secret: string): string {
  return b64(createHmac("sha256", secret).update(payload).digest());
}

export function issueSession(session: Session, secret: string): string {
  const payload = b64(Buffer.from(JSON.stringify({ l: session.label, e: session.expiresAt })));
  return `${payload}.${sign(payload, secret)}`;
}

/** Valid signature, not expired, and the passcode behind it still configured and unexpired. */
export function verifySession(token: string | undefined, config: LiveConfig, now: number): Session | null {
  if (!token || !config.sessionSecret) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, config.sessionSecret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { l, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { l?: unknown; e?: unknown };
    if (typeof l !== "string" || typeof e !== "number" || e <= now) return null;
    const entry = config.passcodes.find((p) => p.label === l);
    if (!entry || Date.parse(entry.expiresAt) <= now) return null;
    return { label: l, expiresAt: e };
  } catch {
    return null;
  }
}

export type PasscodeCheck = { ok: true; entry: PasscodeEntry } | { ok: false; reason: "wrong" | "expired" };

/** Compares against every entry so timing does not reveal which one matched. */
export function checkPasscode(passcode: string, config: LiveConfig, now: number): PasscodeCheck {
  const digest = createHash("sha256").update(passcode, "utf8").digest();
  let match: PasscodeEntry | undefined;
  for (const entry of config.passcodes) {
    const stored = Buffer.from(entry.sha256, "hex");
    if (stored.length === digest.length && timingSafeEqual(stored, digest)) match ??= entry;
  }
  if (!match) return { ok: false, reason: "wrong" };
  if (Date.parse(match.expiresAt) <= now) return { ok: false, reason: "expired" };
  return { ok: true, entry: match };
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie("", 0, secure);
}
