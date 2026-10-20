import { expect, test, type Page } from "@playwright/test";

/** Demo data is labelled as such everywhere, and the example gets matching original samples. */
const node = (page: Page, text: string) => page.locator(".react-flow__node", { hasText: text });

async function runExample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load example" }).first().click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("[data-status]:not([data-status=succeeded])")).toHaveCount(0, { timeout: 60_000 });
}

test("demo data is labelled: badge, a note on every model node, a chip on every result; no 'Live' anywhere", async ({ page }) => {
  await runExample(page);
  await expect(page.getByTestId("mode-badge")).toHaveText("Demo data");
  // LLM, text-to-image, upscaler and three videos carry a model name, and the note beside it.
  await expect(page.getByText("Sample output, not produced by this model")).toHaveCount(6);
  // Text-to-image, upscaler and three video covers.
  await expect(page.locator(".react-flow__node [data-testid=demo-chip]")).toHaveCount(5);
  await expect(node(page, "Output Preview")).toContainText("Demo data");
  await expect(page.getByText(/\bLive\b/)).toHaveCount(0);
});

test("each shot plays its own original clip; an edited shot gets the second take", async ({ page }) => {
  await runExample(page);
  // Opening the side panel narrows the canvas: fit again so every node stays clickable.
  await page.locator(".react-flow__node-imageToVideo").first().click({ timeout: 5_000 });
  await page.locator(".react-flow__controls-fitview").click({ timeout: 5_000 });
  const clipOf = async (shot: number) => {
    await page.locator(".react-flow__node-imageToVideo").nth(shot).click({ position: { x: 40, y: 12 }, timeout: 5_000 }); // the header: the minimap can cover the bottom
    const src = await page.locator("aside video").getAttribute("src");
    await expect(page.locator("aside [data-testid=demo-chip]")).toBeVisible();
    return src;
  };
  const clips = [await clipOf(0), await clipOf(1), await clipOf(2)];
  expect(new Set(clips).size).toBe(3);
  expect(clips.every((c) => /^\/samples\/video-[123]\.mp4$/.test(c ?? ""))).toBe(true);

  await node(page, "Close-up").click();
  const field = page.locator("aside textarea");
  await field.click();
  await field.press("End");
  await field.pressSequentially(" Rain glitters on the folds.");
  await page.locator("aside").getByRole("button", { name: "Run from here" }).click();
  await expect(page.locator("[data-status]:not([data-status=succeeded])")).toHaveCount(0, { timeout: 60_000 });
  await page.locator(".react-flow__controls-fitview").click({ timeout: 5_000 });
  const edited: (string | null)[] = [];
  for (const i of [0, 1, 2]) edited.push(await clipOf(i));
  expect(edited.filter((c) => c?.endsWith("-b.mp4"))).toHaveLength(1);
});
