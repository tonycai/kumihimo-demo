import "server-only";

import { checkUpload, MAX_UPLOAD_BYTES } from "@/engine/upload";

import { apiError } from "./http";

/** Multipart overhead allowance on top of the file itself. */
const ENVELOPE_BYTES = 64 * 1024;

const PROBLEM_TEXT = {
  "too-large": "The file is larger than 10 MB.",
  "bad-type": "Use a PNG, JPEG or WebP image.",
  empty: "The file is empty.",
} as const;

/**
 * AT-05: the image is read into memory and checked; nothing is written to disk and nothing about
 * it is logged (architecture §6). Oversized bodies are refused before they are read.
 */
export async function readUploadFile(request: Request): Promise<{ ok: true; file: File } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + ENVELOPE_BYTES) {
    return { ok: false, response: apiError(413, "bad_request", PROBLEM_TEXT["too-large"]) };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: apiError(400, "bad_request", "Expected multipart/form-data with a file field.") };
  }
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, response: apiError(400, "bad_request", "Missing file field.") };
  const problem = checkUpload(file);
  if (problem) {
    return { ok: false, response: apiError(problem === "too-large" ? 413 : 400, "bad_request", PROBLEM_TEXT[problem]) };
  }
  return { ok: true, file };
}

/** Close hook for a streamed body: runs once when it ends, errors or the client goes away. */
export function onStreamEnd(
  stream: ReadableStream<Uint8Array>,
  done: (completed: boolean) => Promise<void> | void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let finished = false;
  /** `completed`: the upstream stream ended normally (not an error, not a cancel). */
  const finish = (completed: boolean) => {
    if (finished) return;
    finished = true;
    void Promise.resolve(done(completed)).catch(() => {});
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done: end } = await reader.read();
        if (end) {
          finish(true);
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        finish(false);
        controller.error(error);
      }
    },
    cancel(reason) {
      finish(false);
      return reader.cancel(reason);
    },
  });
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
} as const;
