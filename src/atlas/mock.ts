import { AtlasError, type AtlasAdapter } from "./adapter";
import { TEMPLATE_SHOTS } from "@/demo/content";

import type { ChatInput, Prediction } from "./types";

/**
 * Mock adapter: never touches the network (DP-02). Predictions are stateless: the id encodes
 * kind, creation time, sample and outcome, so polling works across Cloud Run instances and cold
 * starts without any shared store. All samples are original artwork kept in the repo.
 */

/**
 * Original demo art (public/samples/; provenance in docs/demo-samples.md). Images: the
 * originals, then their 2048 px versions, which the upscaler returns. Videos: the three shots of
 * the example, then a second take of each for after an edit.
 */
export const MOCK_IMAGE_SAMPLES = [
  "/samples/image-1.svg",
  "/samples/image-2.svg",
  "/samples/image-3.svg",
  "/samples/image-1-2x.jpg",
  "/samples/image-2-2x.jpg",
  "/samples/image-3-2x.jpg",
] as const;

export const MOCK_VIDEO_SAMPLES = [
  "/samples/video-1.mp4",
  "/samples/video-2.mp4",
  "/samples/video-3.mp4",
  "/samples/video-1-b.mp4",
  "/samples/video-2-b.mp4",
  "/samples/video-3-b.mp4",
] as const;

const ORIGINALS = 3;

/** Simulated generation time in ms (Atlas docs: images 2–10 s, video 30 s–3 min; shortened for demos). */
export const MOCK_DELAY_MS = {
  img: { min: 3_000, max: 6_000 },
  vid: { min: 10_000, max: 18_000 },
} as const;
/** Kept for the stage 0 tests and docs. */
export const MOCK_IMAGE_DELAY_MS = MOCK_DELAY_MS.img;

/** Mock LLM pacing: close to a fast hosted model (ND-02: "about as fast as live mode"). */
export const MOCK_CHAT = { firstTokenMs: 400, perWordMs: 30 } as const;

/** Prompts containing this marker produce a failure, for exercising error UI. */
export const MOCK_FAIL_MARKER = "#fail";

type MockKind = keyof typeof MOCK_DELAY_MS;

const ID_PATTERN = /^mock_(img|vid)_([0-9a-z]{1,12})_([0-9])_([0-9a-z]{8})_(ok|fail)$/;

export interface MockClock {
  now(): number;
  random(): number;
}

const systemClock: MockClock = { now: () => Date.now(), random: () => Math.random() };

export function isMockPredictionId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** Small stable hash so each prompt gets its own demo sample. */
function promptIndex(prompt: string, n: number): number {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) h = (h * 31 + prompt.charCodeAt(i)) >>> 0;
  return h % n;
}

/** Which original (0–2) a sample URL shows, so a run stays consistent along the chain. */
function originalOf(url: string | undefined): number | null {
  const m = url ? /^\/samples\/(?:image|video)-([1-9])(?:-2x|-b)?\./.exec(url) : null;
  return m ? (Number(m[1]) - 1) % ORIGINALS : null;
}

/** Text-to-image: the crane key art for prompts about Tsumugi, otherwise one of the other two. */
function imageFor(prompt: string): number {
  return /tsumugi|crane|courier|origami/i.test(prompt) ? 0 : 1 + promptIndex(prompt, ORIGINALS - 1);
}

/**
 * Image-to-video: the shot named in the prompt (wide, close-up, tracking), else by hash. The
 * example's own wording gets the first take; an edited prompt gets the second, so "edit one shot,
 * re-run that branch" visibly changes that clip.
 */
function videoFor(prompt: string): number {
  const text = prompt.trim();
  const named = /\bwide\b/i.test(text) ? 0 : /close-?up/i.test(text) ? 1 : /tracking/i.test(text) ? 2 : null;
  const shot = named ?? promptIndex(text, ORIGINALS);
  const original = (TEMPLATE_SHOTS as readonly string[]).includes(text);
  return original ? shot : shot + ORIGINALS;
}

/** Deterministic text standing in for an LLM rewrite. Original copy, built from the input. */
export function mockRewrite(input: ChatInput): string {
  const idea = input.prompt.trim().replace(/\s+/g, " ").slice(0, 160).replace(/[.!?]+$/, "");
  return (
    `${idea}, staged as a hand-folded paper diorama, warm lantern light against cool blue dusk, ` +
    `gentle rain catching the light, shallow depth of field, muted teal and amber palette, ` +
    `cinematic wide composition, soft film grain.`
  );
}

export function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
}
export const SSE_DONE = "data: [DONE]\n\n";

export interface MockOptions {
  /** Demo delays × this; E2E runs use a small value (MOCK_DELAY_SCALE). */
  delayScale?: number;
}

export function createMockAdapter(clock: MockClock = systemClock, options: MockOptions = {}): AtlasAdapter {
  const scale = options.delayScale ?? 1;
  function submit(kind: MockKind, prompt: string | undefined, sample: number) {
    const createdAt = clock.now().toString(36);
    const nonce = Math.floor(clock.random() * 36 ** 8)
      .toString(36)
      .padStart(8, "0");
    const outcome = prompt?.includes(MOCK_FAIL_MARKER) ? "fail" : "ok";
    return { id: `mock_${kind}_${createdAt}_${sample}_${nonce}_${outcome}` };
  }

  return {
    mode: "mock",

    async submitTextToImage(input) {
      return submit("img", input.prompt, imageFor(input.prompt));
    },

    async submitImageTool(input) {
      // The 2048 px version of whatever came in.
      return submit("img", input.prompt, (originalOf(input.image) ?? 0) + ORIGINALS);
    },

    async submitImageToVideo(input) {
      return submit("vid", input.prompt, videoFor(input.prompt));
    },

    async getPrediction(id: string): Promise<Prediction> {
      const match = ID_PATTERN.exec(id);
      if (!match) {
        throw new AtlasError("mode_mismatch", "Not a demo-mode prediction id.", 400);
      }
      const [, kind, createdAt, sample, nonce, outcome] = match as unknown as [string, MockKind, string, string, string, string];
      const elapsed = clock.now() - parseInt(createdAt, 36);
      if (elapsed < mockDelayMs(nonce, kind) * scale) {
        return { id, status: "processing", outputs: [] };
      }
      if (outcome === "fail") {
        return {
          id,
          status: "failed",
          outputs: [],
          error: `Demo failure: the prompt contained "${MOCK_FAIL_MARKER}".`,
        };
      }
      const samples = kind === "vid" ? MOCK_VIDEO_SAMPLES : MOCK_IMAGE_SAMPLES;
      return { id, status: "completed", outputs: [samples[Number(sample) % samples.length]] };
    },

    async uploadMedia() {
      // The file has already been checked and is dropped here: demo mode keeps nothing.
      return { url: MOCK_IMAGE_SAMPLES[0] };
    },

    async chatStream(input, signal) {
      if (input.prompt.includes(MOCK_FAIL_MARKER)) {
        throw new AtlasError("upstream_error", `Demo failure: the prompt contained "${MOCK_FAIL_MARKER}".`, 502);
      }
      const words = mockRewrite(input).split(/(?<= )/);
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setTimeout> | undefined;
      return new ReadableStream<Uint8Array>({
        start(controller) {
          let i = 0;
          const stop = () => {
            clearTimeout(timer);
            try {
              controller.close();
            } catch {
              // already closed
            }
          };
          signal?.addEventListener("abort", stop, { once: true });
          const tick = () => {
            if (i < words.length) {
              controller.enqueue(encoder.encode(sseChunk(words[i++])));
              timer = setTimeout(tick, MOCK_CHAT.perWordMs * scale);
            } else {
              controller.enqueue(encoder.encode(SSE_DONE));
              signal?.removeEventListener("abort", stop);
              controller.close();
            }
          };
          timer = setTimeout(tick, MOCK_CHAT.firstTokenMs * scale);
        },
        cancel() {
          clearTimeout(timer);
        },
      });
    },
  };
}

/** Deterministic per-id delay so every instance answers the same way. */
export function mockDelayMs(nonce: string, kind: MockKind = "img"): number {
  const { min, max } = MOCK_DELAY_MS[kind];
  return min + (parseInt(nonce, 36) % (max - min + 1));
}
