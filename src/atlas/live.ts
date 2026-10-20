import "server-only";

import { AtlasError, type AtlasAdapter } from "./adapter";
import {
  buildChatBody,
  buildImageToolBody,
  buildImageToVideoBody,
  buildTextToImageBody,
  getModel,
} from "./models";
import type { Prediction, PredictionStatus } from "./types";
import { isSamplePath } from "./validate";

export const ATLAS_BASE_URL = "https://api.atlascloud.ai";
const SUBMIT_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 30_000;
/** Whole LLM stream; max_tokens bounds it anyway. */
const CHAT_TIMEOUT_MS = 90_000;
const MAX_ERROR_LENGTH = 500;
const PREDICTION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

/**
 * Retention (applied 2026-10-18; reversible): ask Atlas to delete the request record (prompt and parameters) when generation finishes, and the
 * result after 24 hours. Documented for generateImage / generateVideo only
 * (https://www.atlascloud.ai/docs/data-retention, checked 2026-10-17), so chat and upload do not
 * send them. Keep `src/atlas/retention.ts` and the privacy notice in step with these values.
 */
export const RETENTION_HEADERS: Readonly<Record<string, string>> = {
  "X-AtlasCloud-Request-Retention-Hours": "0",
  "X-AtlasCloud-Object-Expiration-Hours": "24",
};

export function isLivePredictionId(id: string): boolean {
  return PREDICTION_ID_PATTERN.test(id) && !id.startsWith("mock_");
}

export interface LiveAdapterOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

function rejectSample(url: string) {
  if (isSamplePath(url)) {
    throw new AtlasError(
      "bad_request",
      "This input is a demo-mode sample. Run the upstream node again in live mode.",
      400,
    );
  }
}

export function createLiveAdapter({
  apiKey,
  fetchImpl = fetch,
  baseUrl = ATLAS_BASE_URL,
}: LiveAdapterOptions): AtlasAdapter {
  /** Fetch with a deadline; returns the response with its body still unread. */
  async function send(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ res: Response; done: () => void }> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
        cache: "no-store",
      });
      return { res, done: () => clearTimeout(timer) };
    } catch {
      clearTimeout(timer);
      if (timeout.signal.aborted) {
        throw new AtlasError("upstream_timeout", "Atlas Cloud did not respond in time.", 504);
      }
      throw new AtlasError("upstream_error", "Could not reach Atlas Cloud.", 502);
    }
  }

  function fail(res: Response, body: unknown): never {
    const message = upstreamMessage(body, apiKey);
    if (res.status === 402) {
      throw new AtlasError("insufficient_balance", message ?? "Atlas Cloud balance is insufficient.", 402);
    }
    throw new AtlasError("upstream_error", message ?? `Atlas Cloud returned HTTP ${res.status}.`, 502);
  }

  async function call(path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const { res, done } = await send(path, init, timeoutMs, signal);
    let body: unknown;
    try {
      body = await res.json().catch(() => null);
    } finally {
      done();
    }
    if (!res.ok) fail(res, body);
    return body;
  }

  async function submit(path: string, payload: Record<string, unknown>, signal?: AbortSignal) {
    const body = await call(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...RETENTION_HEADERS },
        body: JSON.stringify(payload),
      },
      SUBMIT_TIMEOUT_MS,
      signal,
    );
    const id = unwrap(body).id;
    if (typeof id !== "string" || !isLivePredictionId(id)) {
      throw new AtlasError("upstream_error", "Atlas Cloud returned no prediction id.", 502);
    }
    return { id };
  }

  return {
    mode: "live",

    async submitTextToImage(input, signal) {
      const model = getModel(input.model, "textToImage");
      if (!model) throw new AtlasError("bad_request", "Unknown model.", 400);
      return submit("/api/v1/model/generateImage", buildTextToImageBody(model, input), signal);
    },

    async submitImageTool(input, signal) {
      const model = getModel(input.model, "imageTool");
      if (!model) throw new AtlasError("bad_request", "Unknown model.", 400);
      rejectSample(input.image);
      return submit("/api/v1/model/generateImage", buildImageToolBody(model, input), signal);
    },

    async submitImageToVideo(input, signal) {
      const model = getModel(input.model, "imageToVideo");
      if (!model) throw new AtlasError("bad_request", "Unknown model.", 400);
      rejectSample(input.image);
      return submit("/api/v1/model/generateVideo", buildImageToVideoBody(model, input), signal);
    },

    async getPrediction(id: string, signal?: AbortSignal): Promise<Prediction> {
      if (!isLivePredictionId(id)) {
        throw new AtlasError("mode_mismatch", "Not a live prediction id.", 400);
      }
      const body = await call(
        `/api/v1/model/prediction/${encodeURIComponent(id)}`,
        { method: "GET" },
        POLL_TIMEOUT_MS,
        signal,
      );
      const data = unwrap(body);
      const status = normalizeStatus(data.status);
      const outputs = Array.isArray(data.outputs)
        ? data.outputs.filter((o): o is string => typeof o === "string")
        : [];
      const error =
        typeof data.error === "string" && data.error ? clean(data.error, apiKey) : undefined;
      return { id, status, outputs, ...(error ? { error } : {}) };
    },

    async uploadMedia(file, filename, signal) {
      const form = new FormData();
      form.append("file", file, filename);
      const body = await call("/api/v1/model/uploadMedia", { method: "POST", body: form }, UPLOAD_TIMEOUT_MS, signal);
      // Docs read `url` at top level; accept `data.url` too (envelope varies across pages).
      const url = (body as { url?: unknown } | null)?.url ?? unwrap(body).url;
      if (typeof url !== "string" || !/^https:\/\//.test(url)) {
        throw new AtlasError("upstream_error", "Atlas Cloud returned no upload URL.", 502);
      }
      return { url };
    },

    async chatStream(input, signal) {
      const model = getModel(input.model, "llm");
      if (!model) throw new AtlasError("bad_request", "Unknown model.", 400);
      const { res, done } = await send(
        "/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(buildChatBody(model, input)),
        },
        CHAT_TIMEOUT_MS,
        signal,
      );
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        done();
        fail(res, body);
      }
      // Pass the SSE bytes through untouched; clear the deadline once the stream ends.
      return res.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          flush: done,
        }),
      );
    },
  };
}

export function normalizeStatus(raw: unknown): PredictionStatus {
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  if (s === "completed" || s === "succeeded") return "completed";
  if (["failed", "error", "timeout", "canceled", "cancelled"].includes(s)) return "failed";
  return "processing";
}

/**
 * Docs disagree on the envelope: examples read `data.id` / `data.outputs`, per-model OpenAPI
 * schemas show the same fields at top level. Accept both.
 */
function unwrap(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const data = (body as { data?: unknown }).data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : (body as Record<string, unknown>);
}

function upstreamMessage(body: unknown, apiKey: string): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as {
    message?: unknown;
    msg?: unknown;
    error?: unknown;
    data?: { error?: unknown };
  };
  const candidates = [
    b.data?.error,
    b.message,
    b.msg,
    typeof b.error === "object" && b.error ? (b.error as { message?: unknown }).message : b.error,
  ];
  const first = candidates.find((c): c is string => typeof c === "string" && c.length > 0);
  return first ? clean(first, apiKey) : undefined;
}

/** Truncate and make sure the key can never be echoed back to the browser. */
function clean(text: string, apiKey: string): string {
  return text.split(apiKey).join("[redacted]").slice(0, MAX_ERROR_LENGTH);
}
