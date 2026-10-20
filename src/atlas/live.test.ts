import { describe, expect, it, vi } from "vitest";

import { createLiveAdapter, isLivePredictionId, normalizeStatus } from "./live";
import { buildImageToolBody, modelsFor } from "./models";

const FAKE_KEY = "fake-key-for-tests-0123456789";

function fetchReturning(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("live adapter: prediction", () => {
  it("calls the prediction endpoint with the bearer key and maps the response", async () => {
    const fetchImpl = fetchReturning(200, {
      data: { id: "abc123", status: "completed", outputs: ["https://cdn.example/x.png"] },
    });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl, baseUrl: "https://atlas.test" });
    const result = await adapter.getPrediction("abc123");

    expect(result).toEqual({
      id: "abc123",
      status: "completed",
      outputs: ["https://cdn.example/x.png"],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://atlas.test/api/v1/model/prediction/abc123");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  it("passes data.error through verbatim (truncated) on failure", async () => {
    const fetchImpl = fetchReturning(200, {
      data: { id: "abc123", status: "failed", outputs: [], error: "prompt rejected by safety filter" },
    });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    const result = await adapter.getPrediction("abc123");
    expect(result.status).toBe("failed");
    expect(result.error).toBe("prompt rejected by safety filter");
  });

  it("maps HTTP 402 to insufficient_balance", async () => {
    const adapter = createLiveAdapter({
      apiKey: FAKE_KEY,
      fetchImpl: fetchReturning(402, { message: "Insufficient balance" }),
    });
    await expect(adapter.getPrediction("abc123")).rejects.toMatchObject({
      code: "insufficient_balance",
      status: 402,
      message: "Insufficient balance",
    });
  });

  it("never echoes the key back, even if upstream does", async () => {
    const adapter = createLiveAdapter({
      apiKey: FAKE_KEY,
      fetchImpl: fetchReturning(401, { message: `invalid key ${FAKE_KEY}` }),
    });
    const err = await adapter.getPrediction("abc123").catch((e: Error) => e);
    expect((err as Error).message).not.toContain(FAKE_KEY);
    expect((err as Error).message).toContain("[redacted]");
  });

  it("turns a hung upstream into upstream_timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    const pending = adapter.getPrediction("abc123").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ code: "upstream_timeout", status: 504 });
    vi.useRealTimers();
  });

  it("refuses demo ids and malformed ids without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    await expect(adapter.getPrediction("mock_img_x_1_abcdefgh_ok")).rejects.toMatchObject({
      code: "mode_mismatch",
    });
    await expect(adapter.getPrediction("../../etc")).rejects.toMatchObject({ code: "mode_mismatch" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isLivePredictionId("a/b")).toBe(false);
  });
});

describe("live adapter: submit", () => {
  const [model] = modelsFor("textToImage");

  it.runIf(model)("posts to generateImage with registry field names and returns data.id", async () => {
    const fetchImpl = fetchReturning(200, { data: { id: "pred_42" } });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl, baseUrl: "https://atlas.test" });
    const { id } = await adapter.submitTextToImage({
      model: model!.id,
      prompt: "woven cords",
      size: model!.sizes[0],
    });
    expect(id).toBe("pred_42");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://atlas.test/api/v1/model/generateImage");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(model!.id);
    expect(body.prompt).toBe("woven cords");
    expect(body[model!.sizeField]).toBe(model!.sizes[0]);
  });

  it("rejects models outside the registry without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    await expect(
      adapter.submitTextToImage({ model: "not/in-registry", prompt: "x" }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("normalizeStatus", () => {
  it("maps upstream statuses onto our three states", () => {
    expect(normalizeStatus("completed")).toBe("completed");
    expect(normalizeStatus("succeeded")).toBe("completed");
    expect(normalizeStatus("failed")).toBe("failed");
    expect(normalizeStatus("canceled")).toBe("failed");
    expect(normalizeStatus("processing")).toBe("processing");
    expect(normalizeStatus("created")).toBe("processing");
    expect(normalizeStatus(undefined)).toBe("processing");
  });
});

describe("live adapter: stage 2 endpoints", () => {
  const [upscale] = modelsFor("imageTool").filter((m) => m.id === "atlascloud/image-upscaler");
  const [video] = modelsFor("imageToVideo");
  const [llm] = modelsFor("llm");
  const img = "https://cdn.example/in.png";

  it("sends the upstream image under each model's own field name (EX-03)", async () => {
    const fetchImpl = fetchReturning(200, { data: { id: "p1" } });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl, baseUrl: "https://atlas.test" });
    await adapter.submitImageTool({ model: upscale.id, image: img });
    const [body] = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(body).toMatchObject({ model: upscale.id, image: img, outscale: 2 });
    expect(body).not.toHaveProperty("image_url");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://atlas.test/api/v1/model/generateImage");
    // Tool models disagree on the field name; the registry decides. (The one registered model that
    // used image_url, Tencent's upscaler, left the registry on 10/19, so a fixture stands in.)
    const imageUrlModel = { ...upscale, id: "fixture/image-url-tool", imageField: "image_url", fixedParams: {} };
    expect(buildImageToolBody(imageUrlModel, { model: imageUrlModel.id, image: img })).toMatchObject({ image_url: img });
    expect(buildImageToolBody(imageUrlModel, { model: imageUrlModel.id, image: img })).not.toHaveProperty("image");
  });

  it("submits video with image, prompt, duration and resolution", async () => {
    const fetchImpl = fetchReturning(200, { id: "v1" });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl, baseUrl: "https://atlas.test" });
    expect(await adapter.submitImageToVideo({ model: video.id, image: img, prompt: "rain", duration: 5, resolution: "480p" })).toEqual({
      id: "v1",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://atlas.test/api/v1/model/generateVideo");
    expect(JSON.parse(init!.body as string)).toEqual({ model: video.id, image: img, prompt: "rain", duration: 5, resolution: "480p" });
  });

  it("never sends demo-mode sample paths to Atlas", async () => {
    const fetchImpl = fetchReturning(200, { id: "x" });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    await expect(adapter.submitImageTool({ model: upscale.id, image: "/samples/image-1.svg" })).rejects.toThrow(/demo-mode sample/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uploads as multipart field `file` and reads the url from either envelope", async () => {
    const fetchImpl = fetchReturning(200, { url: "https://files.example/u.png" });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl, baseUrl: "https://atlas.test" });
    const result = await adapter.uploadMedia(new Blob([new Uint8Array(10)], { type: "image/png" }), "upload");
    expect(result).toEqual({ url: "https://files.example/u.png" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://atlas.test/api/v1/model/uploadMedia");
    expect((init!.body as FormData).get("file")).toBeInstanceOf(Blob);
    const nested = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl: fetchReturning(200, { data: { url: "https://f.example/2.png" } }) });
    expect((await nested.uploadMedia(new Blob(["x"]), "upload")).url).toBe("https://f.example/2.png");
  });

  it("streams chat SSE through untouched and caps max_tokens at the registry limit", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl, baseUrl: "https://atlas.test" });
    const stream = await adapter.chatStream({ model: llm.id, system: "be brief", prompt: "crane", temperature: 0.5 });
    expect(await new Response(stream).text()).toBe(sse);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://atlas.test/v1/chat/completions");
    expect(JSON.parse(init!.body as string)).toEqual({
      model: llm.id,
      stream: true,
      temperature: 0.5,
      max_tokens: llm.maxTokens,
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "crane" },
      ],
    });
  });

  it("propagates the browser's abort to the upstream chat request (AT-04)", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return new Response(new ReadableStream({ start() {} }), { status: 200 });
    });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    const browser = new AbortController();
    await adapter.chatStream({ model: llm.id, prompt: "x" }, browser.signal);
    expect(upstreamSignal?.aborted).toBe(false);
    browser.abort();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("maps 402 on chat to insufficient balance without leaking the key", async () => {
    const fetchImpl = fetchReturning(402, { msg: `no credit for ${FAKE_KEY}` });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    await expect(adapter.chatStream({ model: llm.id, prompt: "x" })).rejects.toMatchObject({
      code: "insufficient_balance",
      status: 402,
      message: "no credit for [redacted]",
    });
  });
});

describe("live adapter: retention headers", () => {
  const [t2i] = modelsFor("textToImage");
  const [video] = modelsFor("imageToVideo");
  const [llm] = modelsFor("llm");
  const headersOf = (init: RequestInit | undefined) => new Headers(init?.headers);

  it("image and video submissions ask Atlas to drop the prompt record at once and results after 24 h", async () => {
    const fetchImpl = fetchReturning(200, { data: { id: "p1" } });
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    await adapter.submitTextToImage({ model: t2i.id, prompt: "x" });
    await adapter.submitImageToVideo({ model: video.id, image: "https://x.test/a.png", prompt: "x" });
    for (const [, init] of fetchImpl.mock.calls) {
      expect(headersOf(init).get("X-AtlasCloud-Request-Retention-Hours")).toBe("0");
      expect(headersOf(init).get("X-AtlasCloud-Object-Expiration-Hours")).toBe("24");
    }
  });

  it("chat, upload and polling do not send them (not documented for those endpoints)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("uploadMedia")
        ? Response.json({ url: "https://f.example/u.png" })
        : String(url).includes("chat")
          ? new Response("data: [DONE]\n\n")
          : Response.json({ data: { status: "processing", outputs: [] } }),
    );
    const adapter = createLiveAdapter({ apiKey: FAKE_KEY, fetchImpl });
    await adapter.chatStream({ model: llm.id, prompt: "x" });
    await adapter.uploadMedia(new Blob(["x"]), "upload");
    await adapter.getPrediction("p1");
    for (const [, init] of fetchImpl.mock.calls) expect(headersOf(init).has("X-AtlasCloud-Object-Expiration-Hours")).toBe(false);
  });
});
