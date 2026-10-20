import type { Mode, TextToImageInput } from "@/atlas/types";

import { ApiError, fetchPrediction, submitTextToImage } from "./atlas-client";
import { POLL_POLICY, PollError, pollPrediction } from "./polling";

export type RunOutcome =
  | { kind: "succeeded"; url: string; seconds: number; mode: Mode }
  | { kind: "failed"; error: string };

export interface RunDeps {
  submit: typeof submitTextToImage;
  fetchPrediction: typeof fetchPrediction;
  now: () => number;
}

const defaultDeps: RunDeps = { submit: submitTextToImage, fetchPrediction, now: () => Date.now() };

/** Submit one text-to-image job through our proxy and poll it to the end (stage 0 smoke test). */
export async function runTextToImage(
  input: TextToImageInput,
  signal: AbortSignal,
  onStarted: (startedAt: number) => void,
  deps: RunDeps = defaultDeps,
): Promise<RunOutcome> {
  const startedAt = deps.now();
  onStarted(startedAt);
  try {
    const submitted = await deps.submit(input, signal);
    const result = await pollPrediction(submitted.id, {
      ...POLL_POLICY.image,
      signal,
      fetchPrediction: deps.fetchPrediction,
      now: deps.now,
    });
    if (result.status === "completed" && result.outputs[0]) {
      const seconds = Math.round((deps.now() - startedAt) / 1_000);
      return { kind: "succeeded", url: result.outputs[0], seconds, mode: submitted.mode };
    }
    return { kind: "failed", error: result.error ?? "Failed" };
  } catch (err) {
    if (err instanceof PollError || err instanceof ApiError) {
      return { kind: "failed", error: err.message };
    }
    if (signal.aborted) return { kind: "failed", error: new PollError("cancelled").message };
    return { kind: "failed", error: "Failed" };
  }
}
