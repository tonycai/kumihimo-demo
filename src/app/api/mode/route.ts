import { connection } from "next/server";

import type { ModeDecision } from "@/atlas/types";
import { json } from "@/server/http";
import { modeForRequest } from "@/server/mode";

/** Read at request time (never prerendered) so LIVE_MODE changes apply without a rebuild. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  return json<ModeDecision>(modeForRequest(request));
}
