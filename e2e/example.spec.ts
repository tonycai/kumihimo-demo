import { expect, test, type Page } from "@playwright/test";

const nodes = (page: Page) => page.locator(".react-flow__node");
const node = (page: Page, text: string) => page.locator(".react-flow__node", { hasText: text });
const statusOf = (page: Page, text: string) => node(page, text).locator("[data-status]").first();

/**
 * What the page does: demo calls are counted in the page (demo mode never touches the network,
 * so there are no requests to count), and every request is kept to check where the page goes.
 */
async function recordRequests(page: Page) {
  const urls: string[] = [];
  const demoCalls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.exposeFunction("__kumihimoDemoCall", (kind: string) => void demoCalls.push(kind));
  return {
    submits: () => demoCalls.filter((k) => /^(generate-image|generate-video|chat|upload)$/.test(k)).length,
    videoSubmits: () => demoCalls.filter((k) => k === "generate-video").length,
    /** Paths under /api/ the page requested. */
    api: () => urls.map((u) => new URL(u)).filter((u) => u.pathname.startsWith("/api/")).map((u) => u.pathname),
    offSite: () => urls.filter((u) => !u.startsWith("http://127.0.0.1:3071") && !u.startsWith("data:") && !u.startsWith("blob:")),
  };
}

async function loadExample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load example" }).first().click();
  await expect(nodes(page)).toHaveCount(11);
}

async function allDone(page: Page, timeout = 60_000) {
  await expect(page.locator("[data-status]:not([data-status=succeeded])")).toHaveCount(0, { timeout });
}

test("TP-01 loads, fits a 1440×900 window and runs end to end in demo mode (EX-01, EX-04)", async ({ page }) => {
  const requests = await recordRequests(page);
  await loadExample(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(12);

  // Fit: every node is inside the canvas without scrolling.
  const canvas = (await page.locator(".react-flow").boundingBox())!;
  for (const box of await nodes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.left).toBeGreaterThanOrEqual(canvas.x - 1);
    expect(box.top).toBeGreaterThanOrEqual(canvas.y - 1);
    expect(box.right).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    expect(box.bottom).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
  }

  await page.getByRole("button", { name: "Run", exact: true }).click();
  // The three shots run side by side once the upscale is done.
  await expect(page.locator("[data-kind=imageToVideo][data-status=running]")).toHaveCount(3, { timeout: 30_000 });
  await allDone(page);
  await expect(page.locator("[data-testid=video-cover]")).toHaveCount(6); // 3 nodes + 3 preview tiles
  const afterFirstRun = requests.submits();
  expect(afterFirstRun).toBe(6); // chat, text-to-image, upscale, 3 videos
  expect(requests.offSite()).toEqual([]);
  // Demo mode runs in the page: prompts and images never reach the server; only the mode is asked for.
  expect(new Set(requests.api())).toEqual(new Set(["/api/mode"]));

  // EX-04: nothing changed → Run sends nothing and everything stays done.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(500);
  expect(requests.submits()).toBe(afterFirstRun);
  await allDone(page, 5_000);
});

test("EX-05: editing one shot re-runs only that branch, with one request", async ({ page }) => {
  const requests = await recordRequests(page);
  await loadExample(page);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await allDone(page);

  await node(page, "Close-up").click();
  const field = page.locator("aside textarea");
  await field.click();
  await field.press("End");
  await field.pressSequentially(" Rain glitters on the folds.");
  await expect(page.locator("[data-status=stale]")).toHaveCount(3); // shot 2, video 2, preview
  await expect(statusOf(page, "Wide shot")).toHaveAttribute("data-status", "succeeded");

  const before = requests.submits();
  await page.locator("aside").getByRole("button", { name: "Run from here" }).click();
  await allDone(page);
  expect(requests.submits() - before).toBe(1);
  expect(requests.videoSubmits()).toBe(4);
});

test("EX-07: a reload during video generation resumes polling and never resubmits", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("[data-kind=imageToVideo][data-status=running]").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(300); // the prediction id is saved as soon as it arrives

  const requests = await recordRequests(page);
  await page.reload();
  await expect(nodes(page)).toHaveCount(11);
  await allDone(page);
  expect(requests.videoSubmits()).toBe(0);
});
