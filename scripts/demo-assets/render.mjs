/**
 * Renders the demo samples in public/samples/ from scripts/demo-assets/scenes.mjs.
 *   node scripts/demo-assets/render.mjs [stills|videos|all]
 * Stills: SVG as drawn, plus a 2048 px JPEG standing in for the upscaler's output.
 * Videos: 5 s at 24 fps, 640 px square, each frame drawn by the scene function at time t and
 * screenshotted in headless Chromium, then encoded with ffmpeg (H.264, faststart).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { cords, harbourStreet, keyArt, SHOTS } from "./scenes.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "samples");
const what = process.argv[2] ?? "all";
const FPS = 24;
const SECONDS = 5;
const VIDEO_PX = 640;

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function shoot(page, svg, px, path, type) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(
    `<html><body style="margin:0;background:#000">${svg.replace("<svg ", `<svg style="display:block;width:${px}px;height:${px}px" `)}</body></html>`,
  );
  await page.screenshot({ path, type, ...(type === "jpeg" ? { quality: 86 } : {}) });
}

if (what === "stills" || what === "all") {
  const page = await browser.newPage();
  for (const [i, draw] of [keyArt, harbourStreet, cords].entries()) {
    const svg = draw();
    writeFileSync(join(out, `image-${i + 1}.svg`), svg);
    await shoot(page, svg, 2048, join(out, `image-${i + 1}-2x.jpg`), "jpeg");
    console.log(`image-${i + 1}.svg, image-${i + 1}-2x.jpg`);
  }
  await page.close();
}

if (what === "videos" || what === "all") {
  const page = await browser.newPage();
  for (const [n, name] of ["wide", "close", "tracking"].entries()) {
    for (const take of ["a", "b"]) {
      const dir = mkdtempSync(join(tmpdir(), "kumihimo-frames-"));
      for (let k = 0; k < FPS * SECONDS; k++) {
        await shoot(page, SHOTS[name](k / FPS, take), VIDEO_PX, join(dir, `${String(k).padStart(4, "0")}.png`), "png");
      }
      const file = `video-${n + 1}${take === "b" ? "-b" : ""}.mp4`;
      execFileSync("ffmpeg", [
        "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(dir, "%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "27", "-preset", "slow", "-movflags", "+faststart", join(out, file),
      ]);
      rmSync(dir, { recursive: true, force: true });
      console.log(file);
    }
  }
  await page.close();
}

await browser.close();
