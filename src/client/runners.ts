/**
 * One runner per Atlas-bound node kind. Each takes typed inputs (EX-03), calls our own proxy,
 * polls with the Atlas-recommended cadence (EX-06) and returns a typed value.
 */

import type { Prediction } from "@/atlas/types";
import type { NodeKind } from "@/engine/nodes";
import type { Value } from "@/engine/run";
import type { PredictionKind } from "@/store/execution";

import * as api from "./atlas-client";
import { pollPrediction, POLL_POLICY } from "./polling";
import type { NodeRunner, RunContext } from "./scheduler";
import { frameBatcher, readChatStream } from "./sse";

export interface RunnerDeps {
  api: Pick<
    typeof api,
    "submitTextToImage" | "submitImageTool" | "submitImageToVideo" | "fetchPrediction" | "uploadImage" | "openChat"
  >;
  /** Files picked in upload nodes; they never leave the browser until the node runs. */
  files: ReadonlyMap<string, File>;
  messages: { noFile: string; failed: string };
}

const first = (ctx: RunContext, port: string) => ctx.inputs[port]?.[0]?.value;

export function createRunners(deps: RunnerDeps): Partial<Record<NodeKind, NodeRunner>> {
  /** Poll a submitted prediction to its single output URL. Shared by fresh runs and resumes. */
  async function await_(ctx: RunContext, id: string, kind: PredictionKind): Promise<string> {
    ctx.report({ prediction: { id, kind } });
    const policy = kind === "video" ? POLL_POLICY.video : POLL_POLICY.image;
    const result: Prediction = await pollPrediction(id, {
      ...policy,
      signal: ctx.signal,
      fetchPrediction: deps.api.fetchPrediction,
    });
    if (result.status === "failed" || !result.outputs[0]) throw new Error(result.error ?? deps.messages.failed);
    return result.outputs[0];
  }

  return {
    async llm(ctx) {
      const p = ctx.params as { model: string; systemPrompt?: string; temperature?: number };
      const stream = await deps.api.openChat(
        { model: p.model, system: p.systemPrompt || undefined, prompt: first(ctx, "in:text") ?? "", temperature: p.temperature },
        ctx.signal,
      );
      let text = "";
      const batch = frameBatcher(() => ctx.report({ streamText: text }));
      const full = await readChatStream(stream, (delta) => {
        text += delta;
        batch.schedule();
      });
      batch.flushNow();
      if (!full.trim()) throw new Error(deps.messages.failed);
      return { type: "text", value: full.trim() };
    },

    async textToImage(ctx) {
      const p = ctx.params as { model: string; size?: string; seed?: number };
      const { id } = await deps.api.submitTextToImage(
        { model: p.model, prompt: first(ctx, "in:text") ?? "", size: p.size, seed: p.seed },
        ctx.signal,
      );
      return { type: "image", value: await await_(ctx, id, "image") };
    },

    async imageTool(ctx) {
      const p = ctx.params as { model: string };
      const prompt = first(ctx, "in:text");
      const { id } = await deps.api.submitImageTool(
        { model: p.model, image: first(ctx, "in:image") ?? "", ...(prompt ? { prompt } : {}) },
        ctx.signal,
      );
      return { type: "image", value: await await_(ctx, id, "image") };
    },

    async imageToVideo(ctx) {
      const p = ctx.params as { model: string; duration?: number; resolution?: string | null };
      const image = first(ctx, "in:image") ?? "";
      const { id } = await deps.api.submitImageToVideo(
        {
          model: p.model,
          image,
          prompt: first(ctx, "in:text") ?? "",
          duration: p.duration,
          ...(p.resolution ? { resolution: p.resolution } : {}),
        },
        ctx.signal,
      );
      // The clip starts from its input image, which doubles as its cover frame (PF-06).
      return { type: "video", value: await await_(ctx, id, "video"), poster: image };
    },

    async imageUpload(ctx) {
      const file = deps.files.get(ctx.nodeId);
      if (!file) throw new Error(deps.messages.noFile);
      const { url } = await deps.api.uploadImage(file, ctx.signal);
      return { type: "image", value: url };
    },
  };
}

/** EX-07: continue polling a prediction submitted before a reload. */
export function resumeRunner(deps: RunnerDeps, prediction: { id: string; kind: PredictionKind }): NodeRunner {
  return async (ctx) => {
    const policy = prediction.kind === "video" ? POLL_POLICY.video : POLL_POLICY.image;
    const result = await pollPrediction(prediction.id, { ...policy, signal: ctx.signal, fetchPrediction: deps.api.fetchPrediction });
    if (result.status === "failed" || !result.outputs[0]) throw new Error(result.error ?? deps.messages.failed);
    const poster = ctx.inputs["in:image"]?.[0]?.value;
    const value: Value =
      prediction.kind === "video"
        ? { type: "video", value: result.outputs[0], ...(poster ? { poster } : {}) }
        : { type: "image", value: result.outputs[0] };
    return value;
  };
}
