import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/** TP-02 (export / import), AT-07 (no URLs in the file), TP-04 (reset with a confirmation). */
const nodes = (page: Page) => page.locator(".react-flow__node");
const edges = (page: Page) => page.locator(".react-flow__edge");
/**
 * Only nodes on screen are rendered (PF-01): fit the view before counting a restored graph, again
 * until it holds (a click in the same frame as the undo still sees the old nodes).
 */
async function fitAndCount(page: Page, count: number) {
  await expect(async () => {
    await page.locator(".react-flow__controls-fitview").click();
    await expect(nodes(page)).toHaveCount(count, { timeout: 1_000 });
  }).toPass();
}

async function loadExample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load example" }).first().click();
  await expect(nodes(page)).toHaveCount(11);
}

test("TP-02: export, change the canvas, import the file: the same graph comes back, idle", async ({ page }) => {
  await loadExample(page);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("[data-status]:not([data-status=succeeded])")).toHaveCount(0, { timeout: 60_000 });

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^kumihimo-workflow-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const text = readFileSync(path, "utf8");
  const file = JSON.parse(text);
  expect(file).toMatchObject({ schema: "kumihimo.workflow", version: 1 });
  expect(file.nodes).toHaveLength(11);
  expect(file.edges).toHaveLength(12);
  expect(text).not.toMatch(/https?:|blob:|\/samples\//); // AT-07: results are not part of the file

  await page.getByLabel("Stress test").selectOption("100");
  await expect(nodes(page)).toHaveCount(100);

  await page.getByTestId("workflow-file").setInputFiles(path);
  await expect(page.getByText("Imported 11 nodes and 12 connections.")).toBeVisible();
  await expect(nodes(page)).toHaveCount(11);
  await expect(edges(page)).toHaveCount(12);
  await expect(page.locator("[data-status]:not([data-status=idle])")).toHaveCount(0);
  const ids = await nodes(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id")).sort());
  expect(ids).toEqual(file.nodes.map((n: { id: string }) => n.id).sort());

  await page.getByRole("button", { name: "Undo" }).click();
  await fitAndCount(page, 100);
});

test("TP-02: a refused file says why and leaves the canvas as it was", async ({ page }) => {
  await loadExample(page);
  const bad = JSON.stringify({ schema: "kumihimo.workflow", version: 1, nodes: [{ id: "x", type: "llm", position: { x: 0, y: 0 }, data: { model: "someone/unlisted", systemPrompt: "", temperature: 0.5 } }], edges: [] });
  await page.getByTestId("workflow-file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(bad) });
  await expect(page.getByText(/Couldn't import: .*not in this demo's model registry/)).toBeVisible();
  await expect(nodes(page)).toHaveCount(11);

  await page.getByTestId("workflow-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{nodes:") });
  await expect(page.getByText("Couldn't import: the file is not valid JSON.")).toBeVisible();
  await expect(nodes(page)).toHaveCount(11);
});

test("TP-04: Reset asks first, then puts the example back; undo restores the canvas", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Stress test").selectOption("100");
  await expect(nodes(page)).toHaveCount(100);

  await page.getByRole("button", { name: "Reset" }).click();
  const question = page.getByRole("group", { name: "Replace the canvas with the example?" });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(nodes(page)).toHaveCount(100);

  await page.getByRole("button", { name: "Reset" }).click();
  await question.getByRole("button", { name: "Replace" }).click();
  await expect(nodes(page)).toHaveCount(11);
  await page.getByRole("button", { name: "Undo" }).click();
  await fitAndCount(page, 100);
});
