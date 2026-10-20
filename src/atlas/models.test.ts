import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MODELS,
  availableImageTools,
  buildTextToImageBody,
  getModel,
  modelsFor,
  type NodeKind,
} from "./models";

describe("model registry (ND-09, AT-02)", () => {
  it("has unique ids", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records an official source, a check date, a price and upstream terms for every model", () => {
    for (const m of MODELS) {
      expect(m.source.urls.length, m.id).toBeGreaterThan(0);
      for (const url of [...m.source.urls, m.price.source]) {
        expect(url, m.id).toMatch(/^https:\/\/www\.atlascloud\.ai\//);
      }
      expect(m.source.checkedAt, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.price.usd, m.id).toBeGreaterThan(0);
      expect(m.upstream.provider, m.id).not.toBe("");
      expect(m.upstream.checkedAt, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it.each<NodeKind>(["llm", "textToImage"])("picks 2–3 models for %s", (kind) => {
    const count = modelsFor(kind).length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
  });

  it("image-to-video has one model at launch, Wan 2.2 Turbo (AT-02: a second one after launch)", () => {
    expect(modelsFor("imageToVideo").map((m) => m.id)).toEqual(["atlascloud/wan-2.2-turbo/image-to-video"]);
  });

  it("every registered model has first-party upstream terms on record (curated subset)", () => {
    for (const m of modelsFor("llm")) expect(m.upstream.url, m.id).toMatch(/^https:\/\//);
    for (const kind of ["textToImage", "imageTool", "imageToVideo"] as const) {
      for (const m of modelsFor(kind)) {
        expect(m.upstream.url ?? (m.upstream.provider === "Atlas Cloud" ? "atlas" : null), m.id).not.toBeNull();
      }
    }
  });

  it("exposes only verified image tools (background removal unverified → hidden)", () => {
    expect(availableImageTools().sort()).toEqual(["stylize", "upscale"]);
    expect(modelsFor("imageTool").some((m) => m.tool === "removeBackground")).toBe(false);
  });

  it("keeps defaults inside the allowed values", () => {
    for (const m of modelsFor("textToImage")) expect(m.sizes, m.id).toContain(m.defaultSize);
    for (const m of modelsFor("imageToVideo")) {
      expect(m.durations, m.id).toContain(m.defaultDuration);
      if (m.defaultResolution) expect(m.resolutions, m.id).toContain(m.defaultResolution);
    }
    for (const m of modelsFor("llm")) {
      const { min, max, default: d } = m.temperature;
      expect(d >= min && d <= max, m.id).toBe(true);
    }
  });

  it("caps video at 5 s and 720p, fast enough for a short live demo", () => {
    for (const m of modelsFor("imageToVideo")) {
      expect(Math.max(...m.durations), m.id).toBeLessThanOrEqual(5);
      expect(m.resolutions.every((r) => r === "480p" || r === "720p"), m.id).toBe(true);
    }
  });

  it("looks models up by kind only", () => {
    const [img] = modelsFor("textToImage");
    expect(getModel(img.id, "textToImage")).toBe(img);
    expect(getModel(img.id, "imageToVideo")).toBeUndefined();
  });

  it("maps input onto the model's own field names", () => {
    const [img] = modelsFor("textToImage");
    const body = buildTextToImageBody(img, { model: img.id, prompt: "cords", seed: 7 });
    expect(body).toMatchObject({
      model: img.id,
      prompt: "cords",
      [img.sizeField]: img.defaultSize,
      seed: 7,
      enable_sync_mode: false,
      enable_base64_output: false,
    });
  });
});

describe("no model ids outside the registry (ND-09)", () => {
  const root = join(__dirname, "..");
  const UI_DIRS = ["components", "canvas"].map((d) => join(root, d));

  function walk(dir: string): string[] {
    try {
      return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    } catch {
      return [];
    }
  }

  it("UI code never spells a model id", () => {
    const files = UI_DIRS.flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of MODELS) expect(text, `${file} contains ${m.id}`).not.toContain(m.id);
    }
  });
});
