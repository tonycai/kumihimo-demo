import { expect, test, type Page } from "@playwright/test";

/** PF-01, PF-04, PF-07 behaviour (the numbers are measured by e2e/perf.spec.ts in desktop Chrome). */
const nodes = (page: Page) => page.locator(".react-flow__node");
const zoom = (page: Page) =>
  page.locator(".react-flow__viewport").evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);

async function loadStress(page: Page, count: number) {
  await page.goto("/");
  await page.getByLabel("Stress test").selectOption(String(count));
  await expect(page.getByLabel("Stress test")).toBeEnabled();
  await expect(nodes(page)).toHaveCount(count);
}

test("PF-07: 500 nodes and 600 edges, all on screen at fit; they never run", async ({ page }) => {
  await loadStress(page, 500);
  await expect(page.locator(".react-flow__edge")).toHaveCount(600);
  await expect.poll(() => zoom(page)).toBeGreaterThan(0.1);
  await expect(page.getByTestId("fps")).toHaveText(/^\d+ fps$/);
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
});

test("PF-04: below zoom 0.5 nodes show only title and status; at 0.5 or more, full content", async ({ page }) => {
  await loadStress(page, 500);
  expect(await zoom(page)).toBeLessThan(0.5);
  await expect(page.locator("[data-lod=compact]")).toHaveCount(500);

  const pane = (await page.locator(".react-flow").boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  for (let i = 0; i < 40 && (await zoom(page)) < 0.6; i++) await page.mouse.wheel(0, -100);
  expect(await zoom(page)).toBeGreaterThanOrEqual(0.5);
  await expect(page.locator("[data-lod=compact]")).toHaveCount(0);
  await expect(nodes(page).first().locator("[data-status]")).toBeVisible();
});

test("PF-01: zoomed in, only the visible nodes are in the DOM", async ({ page }) => {
  await loadStress(page, 500);
  const pane = (await page.locator(".react-flow").boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  for (let i = 0; i < 60 && (await zoom(page)) < 1.0; i++) await page.mouse.wheel(0, -100);
  // Nodes whose box intersects the pane, from React Flow's own positions.
  await expect
    .poll(async () => {
      const inDom = await nodes(page).count();
      const visible = await nodes(page).evaluateAll(
        (els, p) =>
          els.filter((e) => {
            const r = e.getBoundingClientRect();
            return r.right > p.x && r.left < p.x + p.width && r.bottom > p.y && r.top < p.y + p.height;
          }).length,
        pane,
      );
      return { inDom, close: inDom <= visible + 12 && inDom < 60 };
    })
    .toMatchObject({ close: true });
});

test("undo after a stress test brings back the previous graph; redo brings the stress graph back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load example" }).first().click();
  await expect(nodes(page)).toHaveCount(11);
  await page.getByLabel("Stress test").selectOption("100");
  await expect(nodes(page)).toHaveCount(100);
  // Undo and redo keep the viewport, and only nodes on screen are rendered (PF-01): fit, then count.
  // Fit again until it holds: a click in the same frame as the undo still sees the old nodes.
  const fitAndCount = (count: number) =>
    expect(async () => {
      await page.locator(".react-flow__controls-fitview").click();
      await expect(nodes(page)).toHaveCount(count, { timeout: 1_000 });
    }).toPass();
  await page.getByRole("button", { name: "Undo" }).click();
  await fitAndCount(11);
  await page.getByRole("button", { name: "Redo" }).click();
  await fitAndCount(100);
});

test("a stress graph picked right after Load example still ends fully in view (queued fitView race)", async ({ page }) => {
  // React Flow runs Load example's fitView on the next node update; without the loader's final fit
  // that was the first stress batch, and 16 of 20 runs ended with part of the graph off screen.
  await page.goto("/");
  await page.getByRole("button", { name: "Load example" }).first().click();
  await page.getByLabel("Stress test").selectOption("100");
  await expect(page.getByLabel("Stress test")).toBeEnabled();
  await expect(nodes(page)).toHaveCount(100);
});
