import type { Prediction } from "@/atlas/types";

/** Atlas guidance: poll images every 2 s and videos every 5 s, always with a timeout (EX-06). */
export const POLL_POLICY = {
  image: { intervalMs: 2_000, timeoutMs: 60_000 },
  video: { intervalMs: 5_000, timeoutMs: 300_000 },
} as const;

export class PollError extends Error {
  constructor(readonly reason: "timeout" | "cancelled") {
    super(reason === "timeout" ? "Timed out" : "Cancelled");
    this.name = "PollError";
  }
}

export interface PollOptions {
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onUpdate?: (prediction: Prediction) => void;
  fetchPrediction: (id: string, signal?: AbortSignal) => Promise<Prediction>;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Poll until the prediction completes or fails. Resolves with the final prediction (a failed
 * prediction is a result, not an exception); rejects with PollError on timeout or cancel.
 */
export async function pollPrediction(id: string, options: PollOptions): Promise<Prediction> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const deadline = now() + options.timeoutMs;

  for (;;) {
    if (options.signal?.aborted) throw new PollError("cancelled");
    let prediction: Prediction;
    try {
      prediction = await options.fetchPrediction(id, options.signal);
    } catch (err) {
      if (options.signal?.aborted) throw new PollError("cancelled");
      throw err;
    }
    options.onUpdate?.(prediction);
    if (prediction.status !== "processing") return prediction;
    if (now() + options.intervalMs > deadline) throw new PollError("timeout");
    try {
      await sleep(options.intervalMs, options.signal);
    } catch {
      throw new PollError("cancelled");
    }
  }
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
