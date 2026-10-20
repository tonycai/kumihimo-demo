import { expect, test, type Page } from "@playwright/test";

/**
 * Consent before the first upload in a tab, where live mode is possible (the E2E server has a test
 * key and live mode on). With demo data only, the image never leaves the browser: no question.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function addUploadNode(page: Page) {
  await page.goto("/");
  await page.locator(".react-flow__pane").dblclick({ position: { x: 300, y: 200 } });
  await page.getByPlaceholder("Add a node…").fill("upload");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__node-imageUpload")).toHaveCount(1);
}

test("upload consent: the first upload asks; cancel picks nothing; agree opens the file picker", async ({ page, context }) => {
  await addUploadNode(page);
  const choose = page.locator(".react-flow__node-imageUpload").getByRole("button", { name: "Choose image…" });
  const dialog = page.getByRole("dialog", { name: "Before you upload an image" });

  await choose.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("ATLAS CLOUD AI INC.（米国）");
  await expect(dialog.getByRole("link", { name: /Privacy/ })).toHaveAttribute("href", "/privacy");
  let chooserOpened = false;
  page.on("filechooser", () => (chooserOpened = true));
  await dialog.getByRole("button", { name: /Cancel/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(chooserOpened).toBe(false);

  await choose.click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), dialog.getByRole("button", { name: /Agree and continue/ }).click()]);
  await chooser.setFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator(".react-flow__node-imageUpload").getByRole("button", { name: "Replace image" })).toBeVisible();

  // Running it in demo mode: the image never leaves the page; the server is asked for nothing but the mode.
  const api: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/")) api.push(path);
  });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".react-flow__node-imageUpload [data-status]").first()).toHaveAttribute("data-status", "succeeded");
  expect(api.filter((p) => p !== "/api/mode")).toEqual([]);

  // Same tab: not asked again.
  const [again] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".react-flow__node-imageUpload").getByRole("button", { name: "Replace image" }).click()]);
  expect(again).toBeTruthy();
  await expect(dialog).toHaveCount(0);

  // A new tab asks again (sessionStorage is per tab).
  const other = await context.newPage();
  await addUploadNode(other);
  await other.locator(".react-flow__node-imageUpload").getByRole("button", { name: "Choose image…" }).click();
  await expect(other.getByRole("dialog", { name: "Before you upload an image" })).toBeVisible();
});

test("upload consent: running the example (text to image, no upload) never asks", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load example" }).first().click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("[data-status]:not([data-status=succeeded])")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("upload consent: with demo data only (live mode off), the file picker opens without asking", async ({ page }) => {
  await page.route("**/api/mode", (route) =>
    route.fulfill({ json: { mode: "mock", reason: "live_mode_off", signedIn: false, demoDelayScale: 0.25 } }),
  );
  await addUploadNode(page);
  await expect(page.getByTestId("mode-badge")).toHaveText("Demo data");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator(".react-flow__node-imageUpload").getByRole("button", { name: "Choose image…" }).click(),
  ]);
  expect(chooser).toBeTruthy();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
