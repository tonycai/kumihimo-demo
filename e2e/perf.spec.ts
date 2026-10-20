import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * PF-07 numbers: 500 nodes / 600 edges, 10 s each of panning, zooming and dragging one node, in a
 * visible desktop Chrome window (`pnpm perf`, project "perf"). Not part of `pnpm e2e`: the numbers
 * depend on the machine, so this writes them to docs/perf/ with the machine and browser it ran on.
 * PF-05: long tasks (> 50 ms) on the main thread while the graph is generated and streamed in.
 * `idleFps` is what the display gives an empty page: the ceiling for every other number.
 */
const SECONDS = 10;

interface FrameStats {
  fps: number;
  p95FrameMs: number;
  worstFrameMs: number;
  longTasks: number[];
}

async function startSampling(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: number; __long: number[] };
    w.__frames = [];
    w.__long = [];
    // A run id, not a flag: a loop from the previous sample can still have a frame pending when the
    // next one starts, and would otherwise count every frame twice.
    const run = (w.__run ?? 0) + 1;
    w.__run = run;
    const tick = (t: number) => {
      if (w.__run !== run) return;
      w.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopSampling(page: Page): Promise<FrameStats> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __run: number; __long: number[] };
    w.__run += 1;
    const f = w.__frames;
    const gaps = f
      .slice(1)
      .map((t, i) => t - f[i])
      .sort((a, b) => a - b);
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      fps: round(((f.length - 1) * 1000) / (f[f.length - 1] - f[0])),
      p95FrameMs: round(gaps[Math.floor(gaps.length * 0.95)]),
      worstFrameMs: round(gaps[gaps.length - 1]),
      longTasks: w.__long.map(Math.round),
    };
  });
}

/** Moves the mouse along a circle for SECONDS, about one step per frame. */
async function circle(page: Page, cx: number, cy: number, radius: number) {
  const start = Date.now();
  for (let i = 0; Date.now() - start < SECONDS * 1000; i++) {
    const a = i / 15;
    await page.mouse.move(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
    await page.waitForTimeout(8);
  }
}

function machine() {
  const sh = (cmd: string, args: string[]) => {
    try {
      return execFileSync(cmd, args, { encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  };
  return {
    model: sh("sysctl", ["-n", "hw.model"]),
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    os: sh("sw_vers", ["-productVersion"]),
  };
}

/**
 * cpu 1: this machine as it is. cpu 4: the renderer's CPU slowed four times through DevTools
 * (Emulation.setCPUThrottlingRate) as a stand-in for an ordinary laptop; the GPU
 * and compositor are not slowed, so it is a reference number, not a measurement of other hardware.
 */
for (const cpu of [1, 4]) {
  test(`PF-07: 500 nodes, pan / zoom / drag 10 s each (CPU ×${cpu})`, async ({ page, browser }, testInfo) => {
    test.setTimeout(150_000);
    await page.goto("/");
    if (cpu > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    }
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__long.push(e.duration);
      }).observe({ type: "longtask" });
    });

    // The frame rate the display gives an idle page: the ceiling for every number below.
    await startSampling(page);
    await page.waitForTimeout(2000);
    const idle = await stopSampling(page);

    // PF-05: generation (Worker) and streaming the nodes in.
    await startSampling(page);
    const t0 = Date.now();
    await page.getByLabel("Stress test").selectOption("500");
    await expect(page.locator(".react-flow__node")).toHaveCount(500);
    await expect(page.locator(".react-flow__edge")).toHaveCount(600);
    const loadMs = Date.now() - t0;
    await page.waitForTimeout(1000);
    const load = await stopSampling(page);
    const dir = join(__dirname, "..", "docs", "perf");
    mkdirSync(dir, { recursive: true });
    if (cpu === 1) await page.screenshot({ path: join(dir, "pf07-500.jpg"), type: "jpeg", quality: 85, scale: "css" });
    const fitZoom = await page
      .locator(".react-flow__viewport")
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    const pane = (await page.locator(".react-flow").boundingBox())!;
    const cx = pane.x + pane.width / 2;
    const cy = pane.y + pane.height / 2;

    // Pan: Space-drag over the whole graph (CV-05), every node on screen.
    await startSampling(page);
    await page.keyboard.down("Space");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await circle(page, cx, cy, 150);
    await page.mouse.up();
    await page.keyboard.up("Space");
    const pan = await stopSampling(page);

    // Zoom: wheel in for a second, out for a second, crossing the 0.5 detail threshold (PF-04).
    await startSampling(page);
    await page.mouse.move(cx, cy);
    const zStart = Date.now();
    while (Date.now() - zStart < SECONDS * 1000) {
      const inward = Math.floor((Date.now() - zStart) / 1000) % 2 === 0;
      await page.mouse.wheel(0, inward ? -24 : 24);
      await page.waitForTimeout(8);
    }
    const zoom = await stopSampling(page);

    // Drag one node near the centre, at fit view (all 500 rendered, its edges follow).
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(500);
    const target = await page.locator(".react-flow__node").evaluateAll(
      (els, c) =>
        els
          .map((e) => e.getBoundingClientRect())
          .map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))
          .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0],
      { x: cx, y: cy },
    );
    await startSampling(page);
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await circle(page, target.x, target.y, 80);
    await page.mouse.up();
    const drag = await stopSampling(page);

    const result = {
      measuredAt: new Date().toISOString(),
      commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
      // Uncommitted changes in the code under test make the commit above an approximation.
      dirty: execFileSync("git", ["status", "--porcelain", "--", "src", "e2e", "playwright.config.ts"], { encoding: "utf8" }).trim() !== "",
      build: "next build (standalone), served locally",
      browser: `Google Chrome ${browser.version()} (headed, Playwright)`,
      viewport: { ...page.viewportSize(), deviceScaleFactor: testInfo.project.use.deviceScaleFactor },
      cpuThrottlingRate: cpu,
      idleFps: idle.fps,
      machine: machine(),
      graph: { nodes: 500, edges: 600, fitZoom: Math.round(fitZoom * 1000) / 1000 },
      pf05: { loadMs, longTasksOver50ms: load.longTasks },
      pf07: { pan, zoom, drag },
    };
    const name = cpu === 1 ? "pf07" : `pf07-cpu${cpu}x`;
    writeFileSync(join(dir, `${name}-${result.measuredAt.slice(0, 10)}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  });
}
