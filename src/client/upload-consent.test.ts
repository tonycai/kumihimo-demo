// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasUploadConsent, recordUploadConsent, resetUploadConsentForTests } from "./upload-consent";

afterEach(() => {
  vi.restoreAllMocks();
  resetUploadConsentForTests();
});

describe("upload consent", () => {
  it("is asked until given, then remembered in this tab's sessionStorage only", () => {
    expect(hasUploadConsent()).toBe(false);
    recordUploadConsent();
    expect(hasUploadConsent()).toBe(true);
    expect(window.sessionStorage.getItem("kumihimo.uploadConsent.v1")).toBe("yes");
    expect(window.localStorage.length).toBe(0); // nothing that outlives the tab
  });

  it("still works for the tab when storage is blocked (private mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(hasUploadConsent()).toBe(false);
    recordUploadConsent();
    expect(hasUploadConsent()).toBe(true);
  });
});
