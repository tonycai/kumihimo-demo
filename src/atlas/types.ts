// Shared types for the Atlas Cloud proxy. Safe to import from client and server code.

export type Mode = "mock" | "live";

export type ModeReason = "live" | "live_mode_off" | "no_api_key" | "no_session";

export interface ModeDecision {
  mode: Mode;
  reason: ModeReason;
  /** A passcode session is active (DP-08: show "Live mode is temporarily off" rather than a prompt). */
  signedIn?: boolean;
  /** Demo results arrive after their usual delay × this (E2E runs use a small value). */
  demoDelayScale?: number;
}

export type PredictionStatus = "processing" | "completed" | "failed";

/** What our own API returns to the browser, independent of Atlas field names. */
export interface Prediction {
  id: string;
  status: PredictionStatus;
  /** Result URLs; only meaningful when status is "completed". */
  outputs: string[];
  /** Upstream error text, shown verbatim on the node. */
  error?: string;
}

export interface SubmitResult {
  id: string;
  mode: Mode;
}

export type ApiErrorCode =
  | "bad_request"
  | "unknown_model"
  | "unauthorized"
  | "insufficient_balance"
  | "rate_limited"
  | "upstream_error"
  | "upstream_timeout"
  | "mode_mismatch"
  | "live_off"
  | "budget_exhausted"
  | "upload_not_allowed"
  | "not_found";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/** Validated text-to-image request, as accepted by POST /api/atlas/generate-image. */
export interface TextToImageInput {
  model: string;
  prompt: string;
  size?: string;
  seed?: number;
}

/** Image tool request (upscale, stylize), also POST /api/atlas/generate-image. */
export interface ImageToolInput {
  model: string;
  /** Upstream image URL. Sent under the field name the registry records for this model. */
  image: string;
  prompt?: string;
}

/** POST /api/atlas/generate-video. */
export interface ImageToVideoInput {
  model: string;
  image: string;
  prompt: string;
  duration?: number;
  resolution?: string;
}

/** POST /api/atlas/chat: one user turn, streamed back as OpenAI-style SSE. */
export interface ChatInput {
  model: string;
  system?: string;
  prompt: string;
  temperature?: number;
}

export interface UploadResult {
  url: string;
  mode: Mode;
}
