import { connection, type NextRequest } from "next/server";

import { isLivePredictionId } from "@/atlas/live";
import type { Prediction } from "@/atlas/types";
import { apiError, errorResponse, json } from "@/server/http";
import { openLive } from "@/server/live-gate";
import { UPLOAD_LINEAGE_TTL_MS } from "@/server/live-submit";
import { liveAdapter } from "@/server/mode";

/**
 * Live polling. A prediction is only visible to the passcode session that created it; anything
 * else is a 404 and never reaches Atlas. A finished prediction frees its slot.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/atlas/prediction/[id]">): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  if (!isLivePredictionId(id)) return apiError(400, "bad_request", "Invalid prediction id.");

  const gate = await openLive(request, { rateLimit: false });
  if (!gate.ok) return gate.response;
  const live = gate.ctx;
  try {
    const info = await live.store.predictionInfo(id, live.now);
    if (!info || info.passcodeLabel !== live.session.label) return apiError(404, "not_found", "Prediction not found.");
    const prediction = await liveAdapter(live.env).getPrediction(id, request.signal);
    if (prediction.status !== "processing") {
      if (info.reservationId) await live.store.release(info.reservationId, Date.now());
      await live.store.recordOutcome(info.passcodeLabel, prediction.status === "completed", live.now, id);
      if (info.uploadDerived && prediction.status === "completed") {
        await live.store.markUploadDerived(prediction.outputs, live.now + UPLOAD_LINEAGE_TTL_MS);
      }
    }
    return json<Prediction>(prediction);
  } catch (err) {
    return errorResponse(err);
  }
}
