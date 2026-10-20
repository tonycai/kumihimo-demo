import { expect, test, type Page } from "@playwright/test";

/** Review follow-ups from stages 1 and 2, checked on the production build. */
const nodes = (page: Page) => page.locator(".react-flow__node");
const node = (page: Page, text: string) => page.locator(".react-flow__node", { hasText: text });

async function loadExample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load example" }).first().click();
  await expect(nodes(page)).toHaveCount(11);
}

test("CV-04: Shift-drag box-selects with a real key press (browser input, not a script event)", async ({ page }) => {
  await loadExample(page);
  // Playwright's keyboard goes through the browser's input pipeline: the page sees trusted events.
  await page.evaluate(() => {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Shift") (window as unknown as { __shiftTrusted: boolean }).__shiftTrusted = e.isTrusted;
    });
  });
  const boxes = await Promise.all(
    ["Tsumugi, a shy", "LLM Rewrite", "Text-to-Image"].map(async (text) => (await node(page, text).boundingBox())!),
  );
  const left = Math.min(...boxes.map((b) => b.x)) - 10;
  const top = Math.min(...boxes.map((b) => b.y)) - 10;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + 10;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 10;

  await page.keyboard.down("Shift");
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  expect(await page.evaluate(() => (window as unknown as { __shiftTrusted?: boolean }).__shiftTrusted)).toBe(true);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(3);
  await expect(page.getByText("3 nodes selected")).toBeVisible();
});

test("example: each shot prompt is in the row of its video; zoom at least 0.75 (TP-01 checks it all fits)", async ({ page }) => {
  await loadExample(page);
  for (const [shot, video] of [
    ["Wide shot", 1],
    ["Close-up", 2],
    ["Tracking shot", 3],
  ] as const) {
    const s = (await node(page, shot).boundingBox())!;
    const videos = await page.locator(".react-flow__node-imageToVideo").evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().top).sort((a, b) => a - b),
    );
    expect(Math.abs(s.y - videos[video - 1])).toBeLessThan(2);
  }
  const zoom = await page
    .locator(".react-flow__viewport")
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
  expect(zoom).toBeGreaterThanOrEqual(0.75);
});

test("production build: no API smoke test link in the toolbar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "API smoke test" })).toHaveCount(0);
});
