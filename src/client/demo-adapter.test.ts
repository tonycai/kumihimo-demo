import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOCK_IMAGE_SAMPLES, MOCK_VIDEO_SAMPLES, mockRewrite } from "@/atlas/mock";
import { modelsFor } from "@/atlas/models";
import { TEMPLATE_IDEA, TEMPLATE_SHOTS } from "@/demo/content";

import { ApiError } from "./api-error";
import { fetchPrediction, openChat, submitImageTool, submitImageToVideo, submitTextToImage, uploadImage } from "./atlas-client";
import { uiStore } from "./ui";

/** Demo mode runs in the browser: sample results, chosen to match the example, and no network at all. */
const t2i = modelsFor("textToImage")[0];
const tool = modelsFor("imageTool").find((m) => m.tool === "upscale")!;
const video = modelsFor("imageToVideo")[0];
const llm = modelsFor("llm")[0];

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  uiStore.setState({ serverMode: { mode: "mock", reason: "no_api_key", demoDelayScale: 0 } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  uiStore.setState({ serverMode: null });
});

const output = async (submit: Promise<{ id: string }>) => (await fetchPrediction((await submit).id)).outputs[0];

describe("in-browser demo (since 2026-10-20)", () => {
  it("the example's prompts get the crane key art, its 2048 px version and each shot's own clip", async () => {
    const rewrite = mockRewrite({ model: llm.id, prompt: TEMPLATE_IDEA });
    expect(await output(submitTextToImage({ model: t2i.id, prompt: rewrite }))).toBe("/samples/image-1.svg");
    expect(await output(submitImageTool({ model: tool.id, image: "/samples/image-1.svg" }))).toBe("/samples/image-1-2x.jpg");
    const clips = [];
    for (const shot of TEMPLATE_SHOTS) clips.push(await output(submitImageToVideo({ model: video.id, image: "/samples/image-1-2x.jpg", prompt: shot })));
    expect(clips).toEqual(["/samples/video-1.mp4", "/samples/video-2.mp4", "/samples/video-3.mp4"]);
  });

  it("an edited shot gets the second take of that shot", async () => {
    const edited = `${TEMPLATE_SHOTS[1]} Rain glitters on the folds.`;
    expect(await output(submitImageToVideo({ model: video.id, image: "/samples/image-1-2x.jpg", prompt: edited }))).toBe("/samples/video-2-b.mp4");
  });

  it("other prompts get one of the other originals", async () => {
    expect(["/samples/image-2.svg", "/samples/image-3.svg"]).toContain(await output(submitTextToImage({ model: t2i.id, prompt: "a quiet street" })));
  });

  it("uploads and the streamed rewrite stay in the page", async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "me.png", { type: "image/png" });
    expect((await uploadImage(file)).url).toMatch(/^\/samples\//);
    const text = await new Response(await openChat({ model: llm.id, prompt: "an idea" })).text();
    expect(text).toContain("data: [DONE]");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the #fail marker still exercises the error paths", async () => {
    await expect(openChat({ model: llm.id, prompt: "#fail" })).rejects.toBeInstanceOf(ApiError);
    const p = await fetchPrediction((await submitTextToImage({ model: t2i.id, prompt: "#fail" })).id);
    expect(p.status).toBe("failed");
  });

  it("every listed sample exists in public/samples", () => {
    for (const url of [...MOCK_IMAGE_SAMPLES, ...MOCK_VIDEO_SAMPLES]) {
      expect(existsSync(join(__dirname, "..", "..", "public", url)), url).toBe(true);
    }
  });
});
