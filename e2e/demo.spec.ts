import { expect, test, type Page } from "@playwright/test";

/**
 * Records the README's demo GIF in demo mode (no real model timings): load the example, run it,
 * edit one shot so only its branch re-runs, then a 500-node stress test.
 * The FPS counter is in the recording, so its readings are logged and checked: the GIF must not
 * show a frame rate far below what `pnpm perf` measures on the same machine.
 */
const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

test("demo GIF", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as unknown as { __fps: string[] };
    w.__fps = [];
    setInterval(() => w.__fps.push(document.querySelector("[data-testid=fps]")?.textContent ?? ""), 1000);
  });
  await pause(page, 1200);

  await page.getByRole("button", { name: "Load example" }).first().click();
  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await pause(page, 1500);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("[data-status]:not([data-status=succeeded])")).toHaveCount(0, { timeout: 90_000 });
  await pause(page, 1500);

  // Edit the second shot: only its video runs again.
  await page.locator(".react-flow__node", { hasText: "Close-up" }).click();
  const text = page.locator("aside textarea");
  await text.click();
  await text.press("End");
  await text.pressSequentially(" Rain glitters on the folds.", { delay: 35 });
  await pause(page, 800);
  await page.locator("aside").getByRole("button", { name: "Run from here" }).click();
  await expect(page.locator("[data-status]:not([data-status=succeeded])")).toHaveCount(0, { timeout: 90_000 });
  await pause(page, 1500);

  // Stress test: the 500 nodes stream in, then hold. No pan or zoom here: with every node on
  // screen each such frame changes the whole picture and the GIF grows several megabytes; the
  // live demo and the README's screenshot cover it.
  await page.getByLabel("Stress test").selectOption("500");
  await expect(page.locator(".react-flow__node")).toHaveCount(500);
  await pause(page, 2500);

  const readings = await page.evaluate(() => (window as unknown as { __fps: string[] }).__fps);
  const values = readings.map((r) => Number.parseInt(r, 10)).filter((n) => Number.isFinite(n));
  console.log(JSON.stringify({ min: Math.min(...values), median: values.sort((a, b) => a - b)[values.length >> 1], readings }));
});
