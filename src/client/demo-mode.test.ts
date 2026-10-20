import { afterEach, describe, expect, it, vi } from "vitest";

import { executionStore } from "@/store/execution";
import { graphStore } from "@/store/graph";

import { ApiError, fetchPrediction, setDemoOverride, submitTextToImage } from "./atlas-client";
import { continueInDemoMode, handleRunError, MAX_BILLABLE_PER_RUN, runProblem } from "./engine";
import { uiStore } from "./ui";

const LIVE = { mode: "live" as const, reason: "live" as const, signedIn: true };

afterEach(() => {
  setDemoOverride(false);
  uiStore.setState({ serverMode: null, liveBlocked: false, sessionEnded: false, notice: null });
  graphStore.getState().replaceGraph({ nodes: [], edges: [] });
  executionStore.getState().replaceAll({});
});

function spyFetch() {
  const fetchSpy = vi.fn(async () => Response.json({ id: "x", mode: "mock", status: "processing", outputs: [] }));
  vi.stubGlobal("fetch", fetchSpy);
  return () => fetchSpy.mock.calls.map((c) => String((c as unknown as [string])[0]));
}

describe("routes follow the mode (route split)", () => {
  it("live mode calls /api/atlas; demo mode and 'continue in demo mode' stay in the page", async () => {
    const urls = spyFetch();
    expect((await submitTextToImage({ model: "m", prompt: "x" })).mode).toBe("mock");
    uiStore.setState({ serverMode: LIVE });
    await submitTextToImage({ model: "m", prompt: "x" });
    continueInDemoMode();
    expect((await submitTextToImage({ model: "m", prompt: "x" })).mode).toBe("mock");
    expect(urls()).toEqual(["/api/atlas/generate-image"]);
  });

  it("predictions are polled where they were made, whatever the mode is now", async () => {
    const urls = spyFetch();
    uiStore.setState({ serverMode: LIVE });
    await fetchPrediction("mock_vid_abc_1_0000abcd_ok");
    await fetchPrediction("pred-123");
    expect(urls()).toEqual(["/api/atlas/prediction/pred-123"]); // the demo id was answered in the page
  });
});

describe("AT-06 and DP-01 banners", () => {
  it("402 or an exhausted budget shows the paused banner; 401 marks the session ended", () => {
    handleRunError(new ApiError("upstream_error", "boom", 502));
    expect(uiStore.getState()).toMatchObject({ liveBlocked: false, sessionEnded: false });
    handleRunError(new ApiError("insufficient_balance", "no credit", 402));
    expect(uiStore.getState().liveBlocked).toBe(true);
    handleRunError(new ApiError("unauthorized", "sign in", 401));
    expect(uiStore.getState().sessionEnded).toBe(true);
    continueInDemoMode();
    expect(uiStore.getState()).toMatchObject({ liveBlocked: false, sessionEnded: false, demoOverride: true });
  });
});

describe("live run guard", () => {
  function videos(n: number) {
    const g = graphStore.getState();
    for (let i = 0; i < n; i++) g.addNode("imageToVideo", { x: i * 10, y: 0 });
  }

  it(`refuses more than ${MAX_BILLABLE_PER_RUN} billable nodes in live mode only`, () => {
    videos(MAX_BILLABLE_PER_RUN + 1);
    expect(runProblem({ type: "all" })).toBeNull(); // demo mode
    uiStore.setState({ serverMode: LIVE });
    expect(runProblem({ type: "all" })).toMatch(/limited to 8 paid steps/);
    continueInDemoMode();
    expect(runProblem({ type: "all" })).toBeNull();
  });

  it("allows the example-sized run (6 billable) in live mode", () => {
    videos(6);
    uiStore.setState({ serverMode: LIVE });
    expect(runProblem({ type: "all" })).toBeNull();
  });

  it("stress-test graphs never run, in demo mode either", () => {
    graphStore.getState().appendBatch(
      [{ id: "st-0", type: "textPrompt", position: { x: 0, y: 0 }, data: { text: "" } }],
      [],
    );
    expect(runProblem({ type: "all" })).toMatch(/measure rendering only/);
    uiStore.setState({ serverMode: LIVE });
    expect(runProblem({ type: "all" })).toMatch(/measure rendering only/);
  });
});
