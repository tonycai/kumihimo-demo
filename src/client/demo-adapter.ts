import { AtlasError } from "@/atlas/adapter";
import { createMockAdapter } from "@/atlas/mock";
import type { ChatInput, ImageToolInput, ImageToVideoInput, Prediction, SubmitResult, TextToImageInput, UploadResult } from "@/atlas/types";

import { ApiError } from "./api-error";
import { uiStore } from "./ui";

declare global {
  interface Window {
    /** Exposed by an E2E test to count demo calls (survives reloads); absent otherwise. */
    __kumihimoDemoCall?: (kind: string) => void;
  }
}

/**
 * Demo mode runs entirely in the browser (since 2026-10-20): the mock adapter is pure code with
 * bundled sample results, so prompts and images never leave the page and no server route is called.
 * The server only says which mode applies and how fast demo results should arrive (E2E speeds it up).
 */
function adapter() {
  return createMockAdapter(undefined, { delayScale: uiStore.getState().serverMode?.demoDelayScale ?? 1 });
}

function count(kind: string) {
  if (typeof window !== "undefined") window.__kumihimoDemoCall?.(kind);
}

async function call<T>(kind: string, run: () => Promise<T>): Promise<T> {
  count(kind);
  try {
    return await run();
  } catch (err) {
    if (err instanceof AtlasError) throw new ApiError(err.code, err.message, err.status);
    throw err;
  }
}

export const demoApi = {
  submitTextToImage: (input: TextToImageInput): Promise<SubmitResult> =>
    call("generate-image", async () => ({ ...(await adapter().submitTextToImage(input)), mode: "mock" as const })),
  submitImageTool: (input: ImageToolInput): Promise<SubmitResult> =>
    call("generate-image", async () => ({ ...(await adapter().submitImageTool(input)), mode: "mock" as const })),
  submitImageToVideo: (input: ImageToVideoInput): Promise<SubmitResult> =>
    call("generate-video", async () => ({ ...(await adapter().submitImageToVideo(input)), mode: "mock" as const })),
  upload: (file: File): Promise<UploadResult> =>
    call("upload", async () => ({ ...(await adapter().uploadMedia(file, file.name)), mode: "mock" as const })),
  getPrediction: (id: string): Promise<Prediction> => call("prediction", () => adapter().getPrediction(id)),
  chat: (input: ChatInput, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> =>
    call("chat", () => adapter().chatStream(input, signal)),
};
