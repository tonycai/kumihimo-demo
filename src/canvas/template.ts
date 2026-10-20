/**
 * TP-01 built-in example "Character → Storyboard Video". All prompts and the character are
 * original. Each video has its own shot prompt so editing
 * one shot re-runs one branch (§15, EX-05).
 */

import { modelsFor } from "@/atlas/models";
import { TEMPLATE_IDEA, TEMPLATE_SHOTS } from "@/demo/content";
import type { EdgePair } from "@/engine/graph";
import { edgeId } from "@/engine/layout";
import type { NodeKind } from "@/engine/nodes";
import { t } from "@/i18n";
import { defaultParams } from "@/store/defaults";
import type { GraphSnapshot, KEdge, KNode, NodeParams } from "@/store/types";

export { TEMPLATE_IDEA, TEMPLATE_SHOTS };

/** Rough rendered heights, including room for a result thumbnail, so results never overlap. */
export const LAYOUT_HEIGHT: Record<NodeKind, number> = {
  textPrompt: 120,
  llm: 150,
  textToImage: 270,
  imageTool: 270,
  imageToVideo: 290,
  imageUpload: 260,
  outputPreview: 170,
};
export const NODE_WIDTH = 224;

interface Spec {
  id: string;
  kind: NodeKind;
  params?: Partial<NodeParams[NodeKind]>;
}

/** The example as plain data; positions come from the layered layout in the Worker. */
export function exampleGraph(): { specs: Spec[]; edges: Omit<KEdge, "id">[] } {
  const upscaler = modelsFor("imageTool").find((m) => m.hostedByAtlas && m.tool === "upscale");
  const specs: Spec[] = [
    { id: "ex-idea", kind: "textPrompt", params: { text: TEMPLATE_IDEA } },
    { id: "ex-llm", kind: "llm", params: { systemPrompt: t("defaults.llmSystemPrompt") } },
    { id: "ex-image", kind: "textToImage" },
    { id: "ex-upscale", kind: "imageTool", params: upscaler ? { tool: "upscale", model: upscaler.id } : { tool: "upscale" } },
    ...TEMPLATE_SHOTS.flatMap((text, i): Spec[] => [
      { id: `ex-shot-${i + 1}`, kind: "textPrompt", params: { text } },
      { id: `ex-video-${i + 1}`, kind: "imageToVideo" },
    ]),
    { id: "ex-preview", kind: "outputPreview" },
  ];
  const link = (source: string, out: string, target: string, inp: string): Omit<KEdge, "id"> => {
    const portType = out.replace("out:", "") as "text" | "image" | "video";
    return { source, sourceHandle: out, target, targetHandle: inp, data: { portType }, className: `edge-${portType}` };
  };
  const edges = [
    link("ex-idea", "out:text", "ex-llm", "in:text"),
    link("ex-llm", "out:text", "ex-image", "in:text"),
    link("ex-image", "out:image", "ex-upscale", "in:image"),
    ...[1, 2, 3].flatMap((i) => [
      link("ex-upscale", "out:image", `ex-video-${i}`, "in:image"),
      link(`ex-shot-${i}`, "out:text", `ex-video-${i}`, "in:text"),
      link(`ex-video-${i}`, "out:video", "ex-preview", "in:any"),
    ]),
  ];
  return { specs, edges };
}

/** Build the snapshot once positions are known. `fresh` gives each load its own ids. */
export function buildExample(
  positions: Record<string, { x: number; y: number }>,
  fresh: (id: string) => string = (id) => id,
): GraphSnapshot {
  const { specs, edges } = exampleGraph();
  const nodes = specs.map(
    (s) =>
      ({
        id: fresh(s.id),
        type: s.kind,
        position: positions[s.id] ?? { x: 0, y: 0 },
        data: { ...defaultParams(s.kind), ...(s.params ?? {}) },
      }) as KNode,
  );
  const kEdges: KEdge[] = edges.map((e) => {
    const edge = { ...e, source: fresh(e.source), target: fresh(e.target) };
    return { ...edge, id: edgeId(edge) };
  });
  return { nodes, edges: kEdges };
}

const ROW_GAP = 16;

export function exampleLayoutRequest() {
  const { specs, edges } = exampleGraph();
  return {
    nodes: specs.map((s) => ({ id: s.id, width: NODE_WIDTH, height: LAYOUT_HEIGHT[s.kind] })),
    edges: edges.map((e) => [e.source, e.target] as const) as EdgePair[],
    options: { columnGap: 40, rowGap: ROW_GAP },
  };
}

/**
 * Each shot prompt sits in the row of its own video, so "edit shot 2,
 * only video 2 re-runs" reads at a glance; the upscaler, which feeds all three, goes above them.
 */
export function arrangeExample(
  positions: Record<string, { x: number; y: number }>,
): Record<string, { x: number; y: number }> {
  const out = { ...positions };
  const column = positions["ex-shot-1"]?.x ?? positions["ex-upscale"]?.x ?? 0;
  // Top-aligned: an idle video is much shorter than the room kept for its result, so centring
  // on that room would put the shot below its video until the first run.
  for (const i of [1, 2, 3]) {
    const video = positions[`ex-video-${i}`];
    if (video) out[`ex-shot-${i}`] = { x: column, y: video.y };
  }
  const top = Math.min(...[1, 2, 3].map((i) => out[`ex-shot-${i}`]?.y ?? 0));
  out["ex-upscale"] = { x: column, y: top - ROW_GAP - LAYOUT_HEIGHT.imageTool };
  // Keep the example at y ≥ 0 like every other layout, so it starts where a new canvas does.
  const minY = Math.min(...Object.values(out).map((p) => p.y));
  if (minY >= 0) return out;
  return Object.fromEntries(Object.entries(out).map(([id, p]) => [id, { x: p.x, y: p.y - minY }]));
}
