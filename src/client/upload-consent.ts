/**
 * KQ-11b (provisional until decided): consent before the first image upload, asked once per browser tab. Kept in
 * sessionStorage (closing the tab forgets it), as the privacy notice says; when storage is blocked
 * the tab remembers it in memory instead.
 */
const KEY = "kumihimo.uploadConsent.v1";
let inMemory = false;

export function hasUploadConsent(): boolean {
  if (inMemory) return true;
  try {
    return window.sessionStorage.getItem(KEY) === "yes";
  } catch {
    return false;
  }
}

export function recordUploadConsent(): void {
  inMemory = true;
  try {
    window.sessionStorage.setItem(KEY, "yes");
  } catch {
    // Storage blocked (private mode): the in-memory flag covers this tab.
  }
}

/** Tests only. */
export function resetUploadConsentForTests(): void {
  inMemory = false;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
