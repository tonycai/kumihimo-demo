import { getModel } from "@/atlas/models";
import type { SubmitResult } from "@/atlas/types";
import { imageRequestKind, parseImageToolInput, parseTextToImageInput } from "@/atlas/validate";
import { imageCost } from "@/server/cost";
import { apiError, errorResponse, json, readJson } from "@/server/http";
import { openLive } from "@/server/live-gate";
import { bind, checkUploadRule, LEASE_MS, reserve } from "@/server/live-submit";
import { liveAdapter } from "@/server/mode";

/** Live text-to-image and image tools (Atlas generateImage). Passcode session required (DP-01). */
export async function POST(request: Request): Promise<Response> {
  const gate = await openLive(request, { rateLimit: true });
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const kind = imageRequestKind(body.value);
  if (!kind) return apiError(400, "unknown_model", "Model is not in the registry.");

  let input;
  let uploadDerived = false;
  let model;
  if (kind === "textToImage") {
    const parsed = parseTextToImageInput(body.value);
    if (!parsed.ok) return apiError(400, parsed.code, parsed.message);
    input = parsed.value;
    model = getModel(input.model, "textToImage")!;
  } else {
    const parsed = parseImageToolInput(body.value);
    if (!parsed.ok) return apiError(400, parsed.code, parsed.message);
    input = parsed.value;
    model = getModel(input.model, "imageTool")!;
    const rule = await checkUploadRule(ctx, parsed.value.image, model);
    if (!rule.ok) return rule.response;
    uploadDerived = rule.uploadDerived;
  }

  const slot = await reserve(ctx, imageCost(model), LEASE_MS.image);
  if (!slot.ok) return slot.response;
  const adapter = liveAdapter(ctx.env);
  try {
    const { id } =
      kind === "textToImage"
        ? await adapter.submitTextToImage(input as Parameters<typeof adapter.submitTextToImage>[0], request.signal)
        : await adapter.submitImageTool(input as Parameters<typeof adapter.submitImageTool>[0], request.signal);
    await bind(ctx, id, slot.reservationId, uploadDerived);
    return json<SubmitResult>({ id, mode: "live" });
  } catch (err) {
    // The budget stays spent (Atlas may already bill); only the slot is freed.
    await ctx.store.release(slot.reservationId, Date.now()).catch(() => {});
    await ctx.store.recordOutcome(ctx.session.label, false, Date.now()).catch(() => {}); // DP-10
    return errorResponse(err);
  }
}
