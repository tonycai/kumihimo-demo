import "server-only";

import { createHmac } from "node:crypto";

/**
 * DP-03: the client address as appended by Google's front end, never a value the client wrote.
 * Clients can prepend anything to X-Forwarded-For, so the entry is counted from the right; the
 * hop count is configuration because it depends on whether a load balancer sits in front
 * (verified on the first deploy).
 */
export function clientIp(request: Request, hopsFromRight: number): string | null {
  const header = request.headers.get("x-forwarded-for");
  if (!header) return null;
  const parts = header.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts[parts.length - 1 - hopsFromRight];
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/** Salted, truncated HMAC: usable as a counter key, useless for recovering the address. */
export function hashIp(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}
