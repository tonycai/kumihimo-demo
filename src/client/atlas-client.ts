import { isMockPredictionId } from "@/atlas/mock";
import {
  type ApiErrorBody,
  type ChatInput,
  type ImageToolInput,
  type ImageToVideoInput,
  type ModeDecision,
  type Prediction,
  type SubmitResult,
  type TextToImageInput,
  type UploadResult,
} from "@/atlas/types";

import { ApiError } from "./api-error";
import { demoApi } from "./demo-adapter";
import { effectiveMode, uiStore } from "./ui";

/**
 * Browser-side calls. Live mode goes through our own proxy and never to Atlas Cloud directly
 * (AT-01); demo mode never leaves the browser (demo-adapter.ts).
 */

export { ApiError };

/** Live requests go to /api/atlas/*, which needs a passcode session (DP-01); demo ones stay in the page. */
const live = () => effectiveMode() === "live";

export function isDemoOverride(): boolean {
  return uiStore.getState().demoOverride;
}

/** AT-06 / DM-05: carry on with demo results in this tab (kept for the tab's lifetime). */
export function setDemoOverride(on: boolean) {
  uiStore.setState({ demoOverride: on });
  try {
    if (on) sessionStorage.setItem(DEMO_KEY, "1");
    else sessionStorage.removeItem(DEMO_KEY);
  } catch {
    // storage unavailable: the choice lasts until reload
  }
}

const DEMO_KEY = "kumihimo.demo";

/** Restore the tab's demo choice; called once on page start. */
export function restoreDemoOverride() {
  try {
    if (sessionStorage.getItem(DEMO_KEY) === "1") uiStore.setState({ demoOverride: true });
  } catch {
    // no storage: start in whatever mode the server reports
  }
}

async function send(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, cache: "no-store" });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ApiError("network", "Network error. Check your connection and retry.", 0);
  }
}

async function failure(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const error = (body as ApiErrorBody | null)?.error;
  return new ApiError(error?.code ?? "upstream_error", error?.message ?? `Request failed (HTTP ${res.status}).`, res.status);
}

async function request<T>(input: string, init: RequestInit): Promise<T> {
  const res = await send(input, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      error?.code ?? "upstream_error",
      error?.message ?? `Request failed (HTTP ${res.status}).`,
      res.status,
    );
  }
  return body as T;
}

export function fetchMode(signal?: AbortSignal): Promise<ModeDecision> {
  return request<ModeDecision>("/api/mode", { signal });
}

/** DP-01: the passcode goes only in this POST body. */
export function signIn(passcode: string): Promise<{ mode: "live" }> {
  return request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
}

export function signOut(): Promise<{ mode: "mock" }> {
  return request("/api/session", { method: "DELETE" });
}

export function submitTextToImage(
  input: TextToImageInput,
  signal?: AbortSignal,
): Promise<SubmitResult> {
  if (!live()) return demoApi.submitTextToImage(input);
  return request<SubmitResult>("/api/atlas/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}

/** Demo ids are answered in the page, live ids by the live poller, whatever the mode is now. */
export function fetchPrediction(id: string, signal?: AbortSignal): Promise<Prediction> {
  if (isMockPredictionId(id)) return demoApi.getPrediction(id);
  return request<Prediction>(`/api/atlas/prediction/${encodeURIComponent(id)}`, { signal });
}

const postJson = (path: string, body: unknown, signal?: AbortSignal): RequestInit & { path: string } => ({
  path,
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
});

export function submitImageTool(input: ImageToolInput, signal?: AbortSignal): Promise<SubmitResult> {
  if (!live()) return demoApi.submitImageTool(input);
  const { path, ...init } = postJson("/api/atlas/generate-image", input, signal);
  return request<SubmitResult>(path, init);
}

export function submitImageToVideo(input: ImageToVideoInput, signal?: AbortSignal): Promise<SubmitResult> {
  if (!live()) return demoApi.submitImageToVideo(input);
  const { path, ...init } = postJson("/api/atlas/generate-video", input, signal);
  return request<SubmitResult>(path, init);
}

export function uploadImage(file: File, signal?: AbortSignal): Promise<UploadResult> {
  if (!live()) return demoApi.upload(file);
  const form = new FormData();
  form.append("file", file);
  return request<UploadResult>("/api/atlas/upload", { method: "POST", body: form, signal });
}

/** Opens the SSE stream; the body is read by `readChatStream`. */
export async function openChat(input: ChatInput, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  if (!live()) return demoApi.chat(input, signal);
  const { path, ...init } = postJson("/api/atlas/chat", input, signal);
  const res = await send(path, init);
  if (!res.ok || !res.body) throw await failure(res);
  return res.body;
}
