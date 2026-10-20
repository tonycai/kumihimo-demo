import { getModel } from "@/atlas/models";
import { parseChatInput } from "@/atlas/validate";
import { chatCost } from "@/server/cost";
import { apiError, errorResponse, readJson } from "@/server/http";
import { openLive } from "@/server/live-gate";
import { LEASE_MS, reserve } from "@/server/live-submit";
import { liveAdapter } from "@/server/mode";
import { onStreamEnd, SSE_HEADERS } from "@/server/upload";

/**
 * Live LLM rewrite (AT-04). Atlas's SSE is passed through as-is; `request.signal` aborts when the
 * browser goes away, which closes the upstream connection too. The concurrency slot is released
 * when the stream ends, inside the response's own lifetime (CLAUDE.md rule 7).
 */
export async function POST(request: Request): Promise<Response> {
  const gate = await openLive(request, { rateLimit: true });
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = parseChatInput(body.value);
  if (!parsed.ok) return apiError(400, parsed.code, parsed.message);
  const model = getModel(parsed.value.model, "llm")!;

  const chars = (parsed.value.system?.length ?? 0) + parsed.value.prompt.length;
  const slot = await reserve(ctx, chatCost(model, chars), LEASE_MS.chat);
  if (!slot.ok) return slot.response;
  const finish = async (completed: boolean) => {
    await ctx.store.release(slot.reservationId, Date.now());
    await ctx.store.recordOutcome(ctx.session.label, completed, Date.now()); // DP-10
  };
  try {
    const stream = await liveAdapter(ctx.env).chatStream(parsed.value, request.signal);
    return new Response(onStreamEnd(stream, finish), { headers: { ...SSE_HEADERS, "X-Kumihimo-Mode": "live" } });
  } catch (err) {
    await finish(false).catch(() => {});
    return errorResponse(err);
  }
}
