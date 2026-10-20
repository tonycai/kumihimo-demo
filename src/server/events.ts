import "server-only";

/**
 * Product events as structured log lines (Cloud Run sends JSON on stdout to Cloud Logging).
 * Never anything about the person: no IP, user agent, prompt, passcode or label.
 * - cta_clicked: the contact button (DM-06).
 * - upstream_402, budget_exhausted, passcode_rate_limited: what the DP-10 alerts watch.
 */
export type ProductEvent = "cta_clicked" | "upstream_402" | "budget_exhausted" | "passcode_rate_limited";

export function logEvent(event: ProductEvent): void {
  console.log(JSON.stringify({ severity: "INFO", event }));
}
