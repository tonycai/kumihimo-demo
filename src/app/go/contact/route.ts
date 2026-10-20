import { logEvent } from "@/server/events";
import { CONTACT_URL } from "@/site/links";

/** DM-06: count the click, then send the visitor to SolanaLink's contact form. */
export function GET() {
  logEvent("cta_clicked");
  return new Response(null, { status: 302, headers: { Location: CONTACT_URL, "Cache-Control": "no-store" } });
}
