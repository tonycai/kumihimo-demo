import { expect, test, type Page } from "@playwright/test";

/**
 * PF-02: while one node streams, no other node component re-renders. Every node logs its renders
 * (src/canvas/render-log.ts) once the test sets window.__kumihimoRenders; the LLM node's streamed
 * words are timestamped with a MutationObserver. Demo streams last about 0.5 s here (E2E delays
 * are scaled down), so the LLM is re-run, with a new system prompt each time, until at least 5 s of
 * streaming has been recorded.
 */
const STREAMING_MS = 5_000;
const nodes = (page: Page) => page.locator(".react-flow__node");
const node = (page: Page, text: string) => page.locator(".react-flow__node", { hasText: text });

test("PF-02: during 5 s of LLM streaming, no other node re-renders", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    window.__kumihimoRenders = [];
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Load example" }).first().click();
  await expect(nodes(page)).toHaveCount(11);
  // Start from a finished run, so the other nodes hold images and videos as in the demo.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator("[data-status]:not([data-status=succeeded])")).toHaveCount(0, { timeout: 60_000 });

  const llm = node(page, "LLM Rewrite");
  const llmId = (await llm.getAttribute("data-id"))!;
  await page.evaluate((id) => {
    const w = window as unknown as { __tokens: number[] };
    w.__tokens = [];
    const root = document.querySelector(`.react-flow__node[data-id="${id}"]`)!;
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target instanceof Element ? r.target : r.target.parentElement;
        if (el?.closest("[data-testid=stream-text]")) w.__tokens.push(performance.now());
      }
    }).observe(root, { subtree: true, childList: true, characterData: true });
  }, llmId);

  const status = llm.locator("[data-status]").first();
  await llm.click();
  const systemPrompt = page.getByLabel("System prompt");
  const base = await systemPrompt.inputValue();
  const windows: [number, number][] = [];
  for (let i = 1; i <= 40 && windows.reduce((sum, [a, b]) => sum + b - a, 0) < STREAMING_MS; i++) {
    const before = await page.evaluate(() => (window as unknown as { __tokens: number[] }).__tokens.length);
    await systemPrompt.fill(`${base} (${i})`); // a new input, so the LLM is out of date and runs again
    await expect(status).toHaveAttribute("data-status", "stale"); // marked via the Worker, asynchronously
    await page.getByRole("button", { name: "Run from here" }).click();
    await expect(status).toHaveAttribute("data-status", "running");
    await expect(status).toHaveAttribute("data-status", "succeeded");
    const tokens = await page.evaluate(
      (from) => (window as unknown as { __tokens: number[] }).__tokens.slice(from),
      before,
    );
    expect(tokens.length).toBeGreaterThan(5);
    windows.push([tokens[0], tokens[tokens.length - 1]]);
    // Downstream finishes from the cache: the demo rewrite depends on the prompt, not the system prompt.
    await expect(page.locator("[data-status=running], [data-status=queued]")).toHaveCount(0, { timeout: 30_000 });
  }

  const renders = await page.evaluate(() => window.__kumihimoRenders!);
  const inside = renders.filter((r) => windows.some(([a, b]) => r.t > a && r.t < b));
  const byNode: Record<string, number> = {};
  for (const r of inside) byNode[r.id] = (byNode[r.id] ?? 0) + 1;
  const streamedMs = Math.round(windows.reduce((sum, [a, b]) => sum + b - a, 0));
  test.info().annotations.push({
    type: "PF-02",
    description: JSON.stringify({ streamedMs, runs: windows.length, llmRenders: byNode[llmId] ?? 0, byNode }),
  });

  expect(streamedMs).toBeGreaterThanOrEqual(STREAMING_MS);
  expect(byNode[llmId]).toBeGreaterThan(0);
  expect(Object.keys(byNode)).toEqual([llmId]); // every other node: 0 renders while streaming
});
