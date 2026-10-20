import type { UploadResult } from "@/atlas/types";
import { errorResponse, json } from "@/server/http";
import { openLive } from "@/server/live-gate";
import { UPLOAD_LINEAGE_TTL_MS } from "@/server/live-submit";
import { liveAdapter } from "@/server/mode";
import { readUploadFile } from "@/server/upload";

/**
 * Live upload (AT-05): checked in memory, forwarded to uploadMedia, dropped. The returned URL is
 * remembered (as a hash) as upload-derived for the server half of the upload rule.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = await openLive(request, { rateLimit: true });
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const upload = await readUploadFile(request);
  if (!upload.ok) return upload.response;
  try {
    const { url } = await liveAdapter(ctx.env).uploadMedia(upload.file, "upload", request.signal);
    await ctx.store.markUploadDerived([url], ctx.now + UPLOAD_LINEAGE_TTL_MS);
    return json<UploadResult>({ url, mode: "live" });
  } catch (err) {
    return errorResponse(err);
  }
}
