/**
 * Model registry: the ONLY place model ids live (ND-09).
 * Node components read dropdown options from here; the server validates every request against it
 * (DP-05). Each entry records where it was verified and when. Tool types that could not be
 * verified are simply absent, so they never appear in a dropdown.
 *
 * Shared by client and server: no secrets, no server-only imports.
 */

import type { ChatInput, ImageToolInput, ImageToVideoInput, TextToImageInput } from "./types";

export type NodeKind = "llm" | "textToImage" | "imageTool" | "imageToVideo";
export type ImageTool = "upscale" | "removeBackground" | "stylize";

export interface DocSource {
  /** Official Atlas Cloud pages this entry was checked against. */
  urls: readonly string[];
  /** YYYY-MM-DD (JST). */
  checkedAt: string;
}

export interface Price {
  usd: number;
  unit: "image" | "second" | "1M input tokens";
  /** LLM only: price per 1M output tokens. */
  outputUsdPer1M?: number;
  /** Video only: documented multiplier per resolution (price = usd × seconds × multiplier). */
  resolutionMultiplier?: Readonly<Record<string, number>>;
  source: string;
  note?: string;
}

export interface UpstreamTerms {
  provider: string;
  url: string | null;
  checkedAt: string;
  note?: string;
}

interface ModelBase {
  id: string;
  label: string;
  source: DocSource;
  price: Price;
  upstream: UpstreamTerms;
  /** Fixed body fields every request to this model carries. */
  fixedParams?: Readonly<Record<string, string | number | boolean>>;
  /**
   * Set only when an official Atlas page states that Atlas itself runs the model. Upload-derived
   * images may only go to such models ("uploadSafe").
   */
  hostedByAtlas?: { evidence: string; source: string; checkedAt: string };
}

export interface LlmModel extends ModelBase {
  kind: "llm";
  temperature: { min: number; max: number; default: number };
  maxTokens: number;
}

export interface TextToImageModel extends ModelBase {
  kind: "textToImage";
  /** Body field that carries the size value, e.g. "size". */
  sizeField: string;
  /** Exact strings sent to Atlas; the first one is the default. */
  sizes: readonly string[];
  defaultSize: string;
  seed: { field: string; min: number; max: number } | null;
}

export interface ImageToolModel extends ModelBase {
  kind: "imageTool";
  tool: ImageTool;
  /** Tool models disagree on the image field name: `image` vs `image_url`. */
  imageField: string;
  promptField: string | null;
}

export interface ImageToVideoModel extends ModelBase {
  kind: "imageToVideo";
  imageField: string;
  promptField: string;
  durationField: string;
  durations: readonly number[];
  defaultDuration: number;
  resolutionField: string | null;
  resolutions: readonly string[];
  defaultResolution: string | null;
}

export type ModelSpec = LlmModel | TextToImageModel | ImageToolModel | ImageToVideoModel;

type ByKind = {
  llm: LlmModel;
  textToImage: TextToImageModel;
  imageTool: ImageToolModel;
  imageToVideo: ImageToVideoModel;
};

const CHECKED = "2026-10-16";
const MP = "https://www.atlascloud.ai/models/";
const OA = "https://www.atlascloud.ai/docs/more-models/";
const ASYNC_URL_OUTPUT = { enable_sync_mode: false, enable_base64_output: false } as const;
/** Our own cap for demo cost control, well below every model's documented maximum. */
const LLM_MAX_TOKENS = 1_024;
const LLM_TEMPERATURE = { min: 0, max: 2, default: 0.7 } as const;
/** Documented as an integer with -1 = random; the upper bound is our int32 assumption. */
const SEED = { field: "seed", min: -1, max: 2_147_483_647 } as const;
const SQUARE_AND_PORTRAIT = ["1024*1024", "1024*1536", "1536*1024"] as const;

export const MODELS: readonly ModelSpec[] = [
  // The demo uses a curated subset: every model here has first-party upstream terms on record
  // (docs/model-registry.md §5, 2026-10-19).

  // ── LLM rewrite: POST /v1/chat/completions (OpenAI compatible) ─────────────────────────
  {
    kind: "llm",
    id: "deepseek-ai/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    temperature: LLM_TEMPERATURE,
    maxTokens: LLM_MAX_TOKENS,
    price: {
      usd: 0.14,
      unit: "1M input tokens",
      outputUsdPer1M: 0.28,
      source: `${MP}deepseek-ai/deepseek-v4-flash/llms.txt`,
      note: "Page examples use stream:false; streaming per generic LLM docs. Thinking mode not documented.",
    },
    source: {
      urls: [`${MP}deepseek-ai/deepseek-v4-flash/llms.txt`, "https://www.atlascloud.ai/docs/models/llm"],
      checkedAt: CHECKED,
    },
    upstream: {
      provider: "DeepSeek",
      url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash",
      checkedAt: "2026-10-19",
      note: "MIT per the deepseek-ai model card (first party).",
    },
  },
  {
    kind: "llm",
    id: "deepseek-ai/deepseek-v3.2",
    label: "DeepSeek V3.2",
    temperature: LLM_TEMPERATURE,
    maxTokens: LLM_MAX_TOKENS,
    price: {
      usd: 0.26,
      unit: "1M input tokens",
      outputUsdPer1M: 0.38,
      source: `${MP}deepseek-ai/deepseek-v3.2/llms.txt`,
    },
    source: {
      urls: [`${MP}deepseek-ai/deepseek-v3.2/llms.txt`, "https://www.atlascloud.ai/docs/models/llm"],
      checkedAt: CHECKED,
    },
    upstream: {
      provider: "DeepSeek",
      url: "https://huggingface.co/deepseek-ai/DeepSeek-V3.2",
      checkedAt: CHECKED,
      note: "MIT per upstream model card.",
    },
  },

  // ── Text-to-image: POST /api/v1/model/generateImage; size is "W*H", 512–2048 ────────────
  {
    kind: "textToImage",
    id: "z-image/turbo",
    label: "Z-Image Turbo",
    sizeField: "size",
    sizes: SQUARE_AND_PORTRAIT,
    defaultSize: "1024*1024",
    seed: SEED,
    fixedParams: ASYNC_URL_OUTPUT,
    price: { usd: 0.005, unit: "image", source: `${MP}z-image/turbo/llms.txt` },
    source: {
      urls: [`${MP}z-image/turbo/llms.txt`, `${OA}z-image/turbo/generateImage`],
      checkedAt: CHECKED,
    },
    upstream: {
      provider: "Alibaba (Tongyi-MAI)",
      url: "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo",
      checkedAt: CHECKED,
      note: "Apache-2.0 per upstream model card.",
    },
  },
  {
    kind: "textToImage",
    id: "atlascloud/qwen-image/text-to-image",
    label: "Qwen-Image",
    sizeField: "size",
    sizes: SQUARE_AND_PORTRAIT,
    defaultSize: "1024*1024",
    seed: SEED,
    fixedParams: ASYNC_URL_OUTPUT,
    price: { usd: 0.024, unit: "image", source: `${MP}atlascloud/qwen-image/text-to-image/llms.txt` },
    source: {
      urls: [
        `${MP}atlascloud/qwen-image/text-to-image/llms.txt`,
        `${OA}atlascloud/qwen-image-text-to-image/generateImage`,
      ],
      checkedAt: CHECKED,
    },
    upstream: {
      provider: "Alibaba (Qwen-Image)",
      url: "https://huggingface.co/Qwen/Qwen-Image",
      checkedAt: CHECKED,
      note: "Apache-2.0 per upstream model card.",
    },
  },

  // ── Image tools: POST /api/v1/model/generateImage; field names differ per model ─────────
  // Background removal is intentionally absent: the only family on Atlas has conflicting ids
  // (midjourney/v8.2/remove-background vs youchuan/v8.2/remove-background) across official pages,
  // and atlascloud/image-background-remover returns 404. See docs/model-registry.md.
  {
    kind: "imageTool",
    tool: "upscale",
    id: "atlascloud/image-upscaler",
    label: "Atlas Image Upscaler (2×)",
    imageField: "image",
    promptField: null,
    fixedParams: { outscale: 2, output_format: "png" },
    hostedByAtlas: {
      evidence: "Requests route to the RealESRGAN sync backend through AtlasCloud Serverless",
      source: `${MP}atlascloud/image-upscaler/llms.txt`,
      checkedAt: "2026-10-17",
    },
    price: { usd: 0.01, unit: "image", source: `${MP}atlascloud/image-upscaler` },
    source: {
      urls: [`${MP}atlascloud/image-upscaler`, `${OA}atlascloud/image-upscaler/generateImage`],
      checkedAt: CHECKED,
    },
    upstream: {
      provider: "Atlas Cloud (Real-ESRGAN backend)",
      url: "https://github.com/xinntao/Real-ESRGAN",
      checkedAt: CHECKED,
      note: "Atlas's own model; BSD-3-Clause backend per model page.",
    },
  },
  {
    kind: "imageTool",
    tool: "stylize",
    id: "atlascloud/qwen-image/edit",
    label: "Qwen-Image Edit",
    imageField: "image",
    promptField: "prompt",
    fixedParams: ASYNC_URL_OUTPUT,
    price: { usd: 0.032, unit: "image", source: `${MP}atlascloud/qwen-image/edit/llms.txt` },
    source: {
      urls: [`${MP}atlascloud/qwen-image/edit/llms.txt`, `${OA}atlascloud/qwen-image-edit/generateImage`],
      checkedAt: CHECKED,
    },
    upstream: {
      provider: "Alibaba (Qwen-Image-Edit)",
      url: "https://huggingface.co/Qwen/Qwen-Image-Edit",
      checkedAt: "2026-10-19",
      note: "Apache-2.0 per the Qwen model card metadata (first party).",
    },
  },

  // ── Image-to-video: POST /api/v1/model/generateVideo; image field is `image` ────────────
  // KQ-6 (provisional default): fast models, 5 s clips, 480p or 720p only, to fit a short live demo.
  {
    kind: "imageToVideo",
    id: "atlascloud/wan-2.2-turbo/image-to-video",
    label: "Wan 2.2 Turbo",
    imageField: "image",
    promptField: "prompt",
    durationField: "duration",
    durations: [5],
    defaultDuration: 5,
    resolutionField: "resolution",
    resolutions: ["480p", "720p"],
    defaultResolution: "480p",
    price: {
      usd: 0.02,
      unit: "second",
      resolutionMultiplier: { "480p": 1, "720p": 2 },
      source: `${MP}atlascloud/wan-2.2-turbo/image-to-video/llms.txt`,
      note: "5 s minimum; 480p $0.10, 720p $0.20 per 5 s clip.",
    },
    source: {
      urls: [
        `${MP}atlascloud/wan-2.2-turbo/image-to-video/llms.txt`,
        `${OA}atlascloud/wan-2.2-turbo-image-to-video/generateVideo`,
      ],
      checkedAt: CHECKED,
    },
    upstream: {
      provider: "Atlas Cloud",
      url: null,
      checkedAt: CHECKED,
      note: "Built by Atlas Cloud per model page; likely Wan 2.2 based (not stated).",
    },
  },
];

export function modelsFor<K extends NodeKind>(kind: K): ByKind[K][] {
  return MODELS.filter((m): m is ByKind[K] => m.kind === kind);
}

export function getModel<K extends NodeKind>(id: string, kind: K): ByKind[K] | undefined {
  return modelsFor(kind).find((m) => m.id === id);
}

/** Tool types with at least one verified model. Unverified tools never reach a dropdown. */
export function availableImageTools(): ImageTool[] {
  return [...new Set(modelsFor("imageTool").map((m) => m.tool))];
}

/** Map our validated input onto the model's own field names. */
export function buildTextToImageBody(
  model: TextToImageModel,
  input: TextToImageInput,
): Record<string, unknown> {
  return {
    ...model.fixedParams,
    model: model.id,
    prompt: input.prompt,
    [model.sizeField]: input.size ?? model.defaultSize,
    ...(model.seed && input.seed !== undefined ? { [model.seed.field]: input.seed } : {}),
  };
}

export function buildImageToolBody(model: ImageToolModel, input: ImageToolInput): Record<string, unknown> {
  return {
    ...model.fixedParams,
    model: model.id,
    [model.imageField]: input.image,
    ...(model.promptField && input.prompt ? { [model.promptField]: input.prompt } : {}),
  };
}

export function buildImageToVideoBody(model: ImageToVideoModel, input: ImageToVideoInput): Record<string, unknown> {
  return {
    ...model.fixedParams,
    model: model.id,
    [model.imageField]: input.image,
    [model.promptField]: input.prompt,
    [model.durationField]: input.duration ?? model.defaultDuration,
    ...(model.resolutionField
      ? { [model.resolutionField]: input.resolution ?? model.defaultResolution }
      : {}),
  };
}

/** OpenAI-compatible chat body; `max_tokens` is always our registry cap, so the reserved cost is an upper bound. */
export function buildChatBody(model: LlmModel, input: ChatInput): Record<string, unknown> {
  return {
    model: model.id,
    stream: true,
    temperature: input.temperature ?? model.temperature.default,
    max_tokens: model.maxTokens,
    messages: [
      ...(input.system ? [{ role: "system", content: input.system }] : []),
      { role: "user", content: input.prompt },
    ],
  };
}

/** "uploadSafe": verified that Atlas itself runs this model. */
export function isUploadSafe(model: ModelSpec | undefined): boolean {
  return Boolean(model?.hostedByAtlas);
}

export function findModel(id: string): ModelSpec | undefined {
  return MODELS.find((m) => m.id === id);
}
