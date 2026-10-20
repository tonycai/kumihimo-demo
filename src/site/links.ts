/**
 * Links out of the demo (DP-09, DM-06, CV-10). www.solanalink.jp is the corporate site's
 * canonical host; its pages always carry a locale prefix, and the contact form is Japanese.
 */
const SITE = "https://www.solanalink.jp";

export const COMPANY_URL = `${SITE}/ja/about-us`;
/**
 * Lower-case UTM tags; `from` names the demo for SolanaLink's inquiry tracking. The trailing slash avoids a 308. The form takes no prefill, so the
 * CTA also asks in words.
 */
export const CONTACT_URL = `${SITE}/ja/contact-us/?from=kumihimo&utm_source=kumihimo&utm_medium=demo`;
/** Our own redirect, so the server can count the click (DM-06) before sending the visitor on. */
export const CTA_PATH = "/go/contact";
/** The public repository (decided 2026-10-20). */
const REPO = "https://github.com/tonycai/kumihimo-demo";
export const README_URL = `${REPO}#readme`;
export const DEMO_GIF_URL = `${REPO}/blob/main/docs/demo.gif`;
