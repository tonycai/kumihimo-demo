import { describe, expect, it, vi } from "vitest";

import type { Prediction } from "@/atlas/types";

import { POLL_POLICY, PollError, abortableSleep, pollPrediction } from "./polling";

function fakeTime() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleeps,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw signal.reason;
      sleeps.push(ms);
      t += ms;
    },
  };
}

const processing: Prediction = { id: "p1", status: "processing", outputs: [] };
const completed: Prediction = { id: "p1", status: "completed", outputs: ["/samples/a.svg"] };

describe("pollPrediction", () => {
  it("polls at the image interval until completed", async () => {
    const time = fakeTime();
    const fetchPrediction = vi
      .fn()
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(completed);
    const updates: Prediction[] = [];
    const result = await pollPrediction("p1", {
      ...POLL_POLICY.image,
      fetchPrediction,
      onUpdate: (p) => updates.push(p),
      now: time.now,
      sleep: time.sleep,
    });
    expect(result).toEqual(completed);
    expect(fetchPrediction).toHaveBeenCalledTimes(3);
    expect(time.sleeps).toEqual([2_000, 2_000]);
    expect(updates.map((u) => u.status)).toEqual(["processing", "processing", "completed"]);
  });

  it("returns a failed prediction as a result, not an exception", async () => {
    const time = fakeTime();
    const failed: Prediction = { id: "p1", status: "failed", outputs: [], error: "bad prompt" };
    const result = await pollPrediction("p1", {
      ...POLL_POLICY.image,
      fetchPrediction: vi.fn().mockResolvedValue(failed),
      now: time.now,
      sleep: time.sleep,
    });
    expect(result.error).toBe("bad prompt");
  });

  it("times out with 'Timed out'", async () => {
    const time = fakeTime();
    const run = pollPrediction("p1", {
      intervalMs: 2_000,
      timeoutMs: 5_000,
      fetchPrediction: vi.fn().mockResolvedValue(processing),
      now: time.now,
      sleep: time.sleep,
    });
    await expect(run).rejects.toThrow(new PollError("timeout"));
    await expect(run).rejects.toThrow("Timed out");
  });

  it("is cancelled through the AbortSignal with 'Cancelled'", async () => {
    const controller = new AbortController();
    const fetchPrediction = vi.fn().mockImplementation(async () => {
      controller.abort();
      return processing;
    });
    const run = pollPrediction("p1", {
      ...POLL_POLICY.image,
      signal: controller.signal,
      fetchPrediction,
    });
    await expect(run).rejects.toThrow("Cancelled");
    expect(fetchPrediction).toHaveBeenCalledTimes(1);
  });

  it("uses the video interval of 5 s and a 5 minute timeout", () => {
    expect(POLL_POLICY.video).toEqual({ intervalMs: 5_000, timeoutMs: 300_000 });
  });
});

describe("abortableSleep", () => {
  it("rejects promptly when aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sleeping = abortableSleep(10_000, controller.signal);
    controller.abort(new Error("stop"));
    await expect(sleeping).rejects.toThrow("stop");
    vi.useRealTimers();
  });
});
