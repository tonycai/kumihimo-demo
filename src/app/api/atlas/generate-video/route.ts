import { getModel } from "@/atlas/models";
import type { SubmitResult } from "@/atlas/types";
import { parseImageToVideoInput } from "@/atlas/validate";
import { videoCost } from "@/server/cost";
import { apiError, errorResponse, json, readJson } from "@/server/http";
import { openLive } from "@/server/live-gate";
import { bind, checkUploadRule, LEASE_MS, reserve } from "@/server/live-submit";
import { liveAdapter } from "@/server/mode";

/** Live image-to-video (Atlas generateVideo). Passcode session required (DP-01). */
export async function POST(request: Request): Promise<Response> {
  const gate = await openLive(request, { rateLimit: true });
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = parseImageToVideoInput(body.value);
  if (!parsed.ok) return apiError(400, parsed.code, parsed.message);
  const model = getModel(parsed.value.model, "imageToVideo")!;

  const rule = await checkUploadRule(ctx, parsed.value.image, model);
  if (!rule.ok) return rule.response;

  const cost = videoCost(model, parsed.value.duration ?? model.defaultDuration, parsed.value.resolution ?? model.defaultResolution);
  const slot = await reserve(ctx, cost, LEASE_MS.video);
  if (!slot.ok) return slot.response;
  try {
    const { id } = await liveAdapter(ctx.env).submitImageToVideo(parsed.value, request.signal);
    await bind(ctx, id, slot.reservationId, rule.uploadDerived);
    return json<SubmitResult>({ id, mode: "live" });
  } catch (err) {
    await ctx.store.release(slot.reservationId, Date.now()).catch(() => {});
    await ctx.store.recordOutcome(ctx.session.label, false, Date.now()).catch(() => {}); // DP-10
    return errorResponse(err);
  }
}
