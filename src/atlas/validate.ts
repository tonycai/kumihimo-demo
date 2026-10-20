import { z } from "zod";

import { getModel } from "./models";
import type { ApiErrorCode, ChatInput, ImageToolInput, ImageToVideoInput, TextToImageInput } from "./types";

export const MAX_PROMPT_LENGTH = 2_000;

const textToImageShape = z
  .object({
    model: z.string().min(1).max(200),
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
    size: z.string().min(1).max(32).optional(),
    seed: z.number().int().optional(),
  })
  .strict();

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; code: ApiErrorCode; message: string };

/**
 * Server-side allowlist (DP-05): only registry models, only registry parameter values.
 * Anything else is rejected before a request could reach Atlas Cloud.
 */
export function parseTextToImageInput(raw: unknown): Parsed<TextToImageInput> {
  const shape = textToImageShape.safeParse(raw);
  if (!shape.success) {
    return { ok: false, code: "bad_request", message: "Invalid text-to-image request." };
  }
  const input = shape.data;
  const model = getModel(input.model, "textToImage");
  if (!model) {
    return { ok: false, code: "unknown_model", message: "Model is not in the registry." };
  }
  if (input.size !== undefined && !model.sizes.includes(input.size)) {
    return { ok: false, code: "bad_request", message: "Size is not allowed for this model." };
  }
  if (input.seed !== undefined) {
    if (!model.seed || input.seed < model.seed.min || input.seed > model.seed.max) {
      return { ok: false, code: "bad_request", message: "Seed is not allowed for this model." };
    }
  }
  return { ok: true, value: input };
}

/** Demo-mode results are site-relative sample paths; everything else must be an https URL. */
export const SAMPLE_PATH = /^\/samples\/[a-z0-9-]+\.(svg|png|jpg|mp4)$/;
const imageUrl = z
  .string()
  .max(2_048)
  .refine((v) => SAMPLE_PATH.test(v) || /^https:\/\/[^\s]+$/.test(v), "image must be an https URL");

export function isSamplePath(url: string): boolean {
  return SAMPLE_PATH.test(url);
}

const imageToolShape = z
  .object({
    model: z.string().min(1).max(200),
    image: imageUrl,
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH).optional(),
  })
  .strict();

export function parseImageToolInput(raw: unknown): Parsed<ImageToolInput> {
  const shape = imageToolShape.safeParse(raw);
  if (!shape.success) return { ok: false, code: "bad_request", message: "Invalid image tool request." };
  const model = getModel(shape.data.model, "imageTool");
  if (!model) return { ok: false, code: "unknown_model", message: "Model is not in the registry." };
  if (shape.data.prompt && !model.promptField) {
    return { ok: false, code: "bad_request", message: "This model takes no prompt." };
  }
  return { ok: true, value: shape.data };
}

const imageToVideoShape = z
  .object({
    model: z.string().min(1).max(200),
    image: imageUrl,
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
    duration: z.number().int().optional(),
    resolution: z.string().min(1).max(16).optional(),
  })
  .strict();

/** DP-05: durations and resolutions outside the registry are refused here, not just hidden in the UI. */
export function parseImageToVideoInput(raw: unknown): Parsed<ImageToVideoInput> {
  const shape = imageToVideoShape.safeParse(raw);
  if (!shape.success) return { ok: false, code: "bad_request", message: "Invalid image-to-video request." };
  const input = shape.data;
  const model = getModel(input.model, "imageToVideo");
  if (!model) return { ok: false, code: "unknown_model", message: "Model is not in the registry." };
  if (input.duration !== undefined && !model.durations.includes(input.duration)) {
    return { ok: false, code: "bad_request", message: "Duration is not allowed for this model." };
  }
  if (input.resolution !== undefined && !model.resolutions.includes(input.resolution)) {
    return { ok: false, code: "bad_request", message: "Resolution is not allowed for this model." };
  }
  return { ok: true, value: input };
}

const chatShape = z
  .object({
    model: z.string().min(1).max(200),
    system: z.string().max(MAX_PROMPT_LENGTH).optional(),
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
    temperature: z.number().optional(),
  })
  .strict();

export function parseChatInput(raw: unknown): Parsed<ChatInput> {
  const shape = chatShape.safeParse(raw);
  if (!shape.success) return { ok: false, code: "bad_request", message: "Invalid chat request." };
  const input = shape.data;
  const model = getModel(input.model, "llm");
  if (!model) return { ok: false, code: "unknown_model", message: "Model is not in the registry." };
  const t = input.temperature;
  if (t !== undefined && (t < model.temperature.min || t > model.temperature.max)) {
    return { ok: false, code: "bad_request", message: "Temperature is out of range." };
  }
  return { ok: true, value: input };
}

/** Which generate-image flavour a body is for, decided by the registry entry of its model. */
export function imageRequestKind(raw: unknown): "textToImage" | "imageTool" | null {
  const id = (raw as { model?: unknown } | null)?.model;
  if (typeof id !== "string") return null;
  if (getModel(id, "textToImage")) return "textToImage";
  if (getModel(id, "imageTool")) return "imageTool";
  return null;
}
