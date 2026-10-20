/** Default parameters for a new node, read from the model registry (ND-09). */

import { availableImageTools, getModel, modelsFor } from "@/atlas/models";
import type { NodeKind } from "@/engine/nodes";
import { t } from "@/i18n";

import type { NodeParams } from "./types";

const DEFAULTS: { [K in NodeKind]: () => NodeParams[K] } = {
  textPrompt: () => ({ text: "" }),
  llm: () => {
    const m = modelsFor("llm")[0];
    return {
      model: m?.id ?? "",
      systemPrompt: t("defaults.llmSystemPrompt"),
      temperature: m?.temperature.default ?? 0.7,
    };
  },
  textToImage: () => {
    const m = modelsFor("textToImage")[0];
    return { model: m?.id ?? "", size: m?.defaultSize ?? "", seed: -1 };
  },
  imageTool: () => {
    const tool = availableImageTools()[0] ?? "upscale";
    return { tool, model: modelsFor("imageTool").find((m) => m.tool === tool)?.id ?? "" };
  },
  imageToVideo: () => {
    const m = modelsFor("imageToVideo")[0];
    return {
      model: m?.id ?? "",
      duration: m?.defaultDuration ?? 5,
      resolution: m?.defaultResolution ?? null,
    };
  },
  imageUpload: () => ({}),
  outputPreview: () => ({}),
};

export function defaultParams<K extends NodeKind>(kind: K): NodeParams[K] {
  return DEFAULTS[kind]();
}

/**
 * Keeps dependent fields valid after an edit: a new model resets sizes, durations and resolutions
 * it does not offer; a new tool type picks that tool's first model.
 */
export function reconcileParams<K extends NodeKind>(kind: K, params: NodeParams[K]): NodeParams[K] {
  switch (kind) {
    case "textToImage": {
      const p = params as NodeParams["textToImage"];
      const m = getModel(p.model, "textToImage");
      if (m && !m.sizes.includes(p.size)) return { ...p, size: m.defaultSize } as NodeParams[K];
      return params;
    }
    case "imageTool": {
      const p = params as NodeParams["imageTool"];
      const m = getModel(p.model, "imageTool");
      if (m?.tool === p.tool) return params;
      const first = modelsFor("imageTool").find((x) => x.tool === p.tool);
      return { ...p, model: first?.id ?? "" } as NodeParams[K];
    }
    case "imageToVideo": {
      const p = params as NodeParams["imageToVideo"];
      const m = getModel(p.model, "imageToVideo");
      if (!m) return params;
      const duration = m.durations.includes(p.duration) ? p.duration : m.defaultDuration;
      const resolution =
        p.resolution !== null && m.resolutions.includes(p.resolution) ? p.resolution : m.defaultResolution;
      return { ...p, duration, resolution } as NodeParams[K];
    }
    default:
      return params;
  }
}
