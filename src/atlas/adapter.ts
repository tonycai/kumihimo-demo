import type {
  ChatInput,
  ImageToolInput,
  ImageToVideoInput,
  Mode,
  Prediction,
  TextToImageInput,
} from "./types";

/**
 * One interface, two implementations: the mock adapter (no network, ever) and the live
 * adapter (Atlas Cloud, server-only). Route handlers pick one per request via
 * `src/server/mode.ts`; the browser can never choose live.
 */
export interface AtlasAdapter {
  readonly mode: Mode;
  submitTextToImage(input: TextToImageInput, signal?: AbortSignal): Promise<{ id: string }>;
  submitImageTool(input: ImageToolInput, signal?: AbortSignal): Promise<{ id: string }>;
  submitImageToVideo(input: ImageToVideoInput, signal?: AbortSignal): Promise<{ id: string }>;
  getPrediction(id: string, signal?: AbortSignal): Promise<Prediction>;
  /** The file is read in memory and forwarded; nothing is written to disk (AT-05). */
  uploadMedia(file: Blob, filename: string, signal?: AbortSignal): Promise<{ url: string }>;
  /**
   * OpenAI-style SSE bytes (`data: {...}\n\n`, ending with `data: [DONE]`). Aborting `signal`
   * closes the upstream connection (AT-04).
   */
  chatStream(input: ChatInput, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

export class AtlasError extends Error {
  constructor(
    readonly code:
      | "insufficient_balance"
      | "upstream_error"
      | "upstream_timeout"
      | "mode_mismatch"
      | "bad_request",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AtlasError";
  }
}
