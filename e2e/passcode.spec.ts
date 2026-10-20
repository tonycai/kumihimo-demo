import { expect, test } from "@playwright/test";

import { E2E_PASSCODE } from "../playwright.config";

/** DP-01 in the browser: sign in with the passcode, see "Live", sign out. Nothing is run. */
test("passcode sign-in switches the badge to Live and back; a wrong passcode is refused", async ({ page }) => {
  await page.goto("/");
  const badge = page.getByTestId("mode-badge");
  await expect(badge).toHaveText("Demo data");

  await page.getByRole("button", { name: "Enter passcode" }).click();
  await page.getByLabel("Demo passcode").fill("definitely-not-the-passcode-000");
  await page.getByRole("button", { name: "Go live" }).click();
  await expect(page.locator("form [role=alert]")).toHaveText("That passcode is not valid.");
  await expect(badge).toHaveText("Demo data");

  await page.getByLabel("Demo passcode").fill(E2E_PASSCODE);
  await page.getByRole("button", { name: "Go live" }).click();
  await expect(badge).toHaveText("Live");

  // The session cookie is HttpOnly: page scripts cannot read it.
  expect(await page.evaluate(() => document.cookie)).not.toContain("kumihimo_session");
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "kumihimo_session")?.httpOnly).toBe(true);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(badge).toHaveText("Demo data");
});
