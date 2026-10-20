import { describe, expect, it, vi } from "vitest";

import {
  MOCK_FAIL_MARKER,
  MOCK_IMAGE_DELAY_MS,
  MOCK_IMAGE_SAMPLES,
  createMockAdapter,
  isMockPredictionId,
  mockDelayMs,
} from "./mock";

function clock(start: number, random = 0.5) {
  let t = start;
  return {
    now: () => t,
    random: () => random,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const input = { model: "any", prompt: "a woven cord" };

describe("mock adapter", () => {
  it("never touches the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const c = clock(1_700_000_000_000);
    const adapter = createMockAdapter(c);
    const { id } = await adapter.submitTextToImage(input);
    await adapter.getPrediction(id);
    c.advance(MOCK_IMAGE_DELAY_MS.max);
    await adapter.getPrediction(id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is processing until its delay passes, then completes with a same-origin sample", async () => {
    const c = clock(1_700_000_000_000);
    const adapter = createMockAdapter(c);
    const { id } = await adapter.submitTextToImage(input);
    expect(isMockPredictionId(id)).toBe(true);

    expect((await adapter.getPrediction(id)).status).toBe("processing");
    c.advance(MOCK_IMAGE_DELAY_MS.max);
    const done = await adapter.getPrediction(id);
    expect(done.status).toBe("completed");
    expect(done.outputs).toHaveLength(1);
    expect(MOCK_IMAGE_SAMPLES).toContain(done.outputs[0]);
    expect(done.outputs[0].startsWith("/")).toBe(true);
  });

  it("is stateless: a fresh adapter (another instance) answers the same way", async () => {
    const c = clock(1_700_000_000_000);
    const { id } = await createMockAdapter(c).submitTextToImage(input);
    c.advance(MOCK_IMAGE_DELAY_MS.max);
    const other = createMockAdapter(c);
    expect((await other.getPrediction(id)).status).toBe("completed");
  });

  it("fails when the prompt contains the fail marker", async () => {
    const c = clock(1_700_000_000_000);
    const adapter = createMockAdapter(c);
    const { id } = await adapter.submitTextToImage({ ...input, prompt: `x ${MOCK_FAIL_MARKER}` });
    c.advance(MOCK_IMAGE_DELAY_MS.max);
    const failed = await adapter.getPrediction(id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain(MOCK_FAIL_MARKER);
  });

  it("rejects ids that are not demo ids", async () => {
    const adapter = createMockAdapter(clock(0));
    await expect(adapter.getPrediction("abc123")).rejects.toMatchObject({
      code: "mode_mismatch",
      status: 400,
    });
    expect(isMockPredictionId("mock_img_zz_1_abcdefgh_ok/../x")).toBe(false);
  });

  it("keeps delays inside the documented range", () => {
    for (const nonce of ["00000000", "zzzzzzzz", "abc12345"]) {
      const d = mockDelayMs(nonce);
      expect(d).toBeGreaterThanOrEqual(MOCK_IMAGE_DELAY_MS.min);
      expect(d).toBeLessThanOrEqual(MOCK_IMAGE_DELAY_MS.max);
    }
  });
});
