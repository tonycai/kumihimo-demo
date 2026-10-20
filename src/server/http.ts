import "server-only";

import { AtlasError } from "@/atlas/adapter";
import type { ApiErrorBody, ApiErrorCode } from "@/atlas/types";

import { logEvent } from "./events";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function apiError(status: number, code: ApiErrorCode, message: string): Response {
  return json<ApiErrorBody>({ error: { code, message } }, status);
}

/** Map adapter errors to responses. Unknown errors never leak details to the browser. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AtlasError) {
    if (err.status === 402) logEvent("upstream_402"); // DP-10 alert: the Atlas balance ran out
    return apiError(err.status, err.code, err.message);
  }
  return apiError(500, "upstream_error", "Unexpected server error.");
}

export type JsonResult = { ok: true; value: unknown } | { ok: false; response: Response };

/** Read a small JSON body; rejects oversized or malformed input before parsing. */
export async function readJson(request: Request, maxBytes = 16_384): Promise<JsonResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return { ok: false, response: apiError(413, "bad_request", "Request body too large.") };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, response: apiError(413, "bad_request", "Request body too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: apiError(400, "bad_request", "Body must be JSON.") };
  }
}
