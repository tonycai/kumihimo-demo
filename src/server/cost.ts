import "server-only";

import type { ImageToolModel, ImageToVideoModel, LlmModel, TextToImageModel } from "@/atlas/models";

/**
 * Upper-bound cost per submission in integer micro-USD (reserved at the upper bound so
 * real spend can never exceed what was reserved). Prices come from the registry.
 */

const MICRO = 1_000_000;
/** A resolution the registry has no multiplier for is charged as if it cost double (architecture §4). */
const UNKNOWN_RESOLUTION_MULTIPLIER = 2;

export function imageCost(model: TextToImageModel | ImageToolModel): number {
  return Math.ceil(model.price.usd * MICRO);
}

export function videoCost(model: ImageToVideoModel, duration: number, resolution: string | null): number {
  const table = model.price.resolutionMultiplier;
  const multiplier =
    resolution === null ? 1 : (table?.[resolution] ?? (resolution === model.defaultResolution ? 1 : UNKNOWN_RESOLUTION_MULTIPLIER));
  return Math.ceil(model.price.usd * duration * multiplier * MICRO);
}

/** Input counted as one token per character (always ≥ real tokens) plus the full max_tokens output. */
export function chatCost(model: LlmModel, inputChars: number): number {
  const input = (inputChars * model.price.usd) / 1_000_000;
  const output = (model.maxTokens * (model.price.outputUsdPer1M ?? model.price.usd)) / 1_000_000;
  return Math.ceil((input + output) * MICRO);
}
