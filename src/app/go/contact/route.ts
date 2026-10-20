import { connection } from "next/server";

import { logEvent } from "@/server/events";
import { CONTACT_URL } from "@/site/links";

/**
 * DM-06: count the click, then send the visitor to SolanaLink's contact form. Request time only:
 * without `connection()` the route was prerendered at build, so no click was ever counted.
 */
export async function GET() {
  await connection();
  logEvent("cta_clicked");
  return new Response(null, { status: 302, headers: { Location: CONTACT_URL, "Cache-Control": "no-store" } });
}
