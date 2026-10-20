import { afterEach, describe, expect, it } from "vitest";

import { executionStore } from "@/store/execution";

import { markExpired, resultCache } from "./engine";

afterEach(() => {
  executionStore.getState().replaceAll({});
  resultCache.clear();
});

describe("AT-08: expired results", () => {
  it("drops the dead link, marks the node stale with a note and forgets the cache entry", () => {
    const url = "https://cdn.example/out.png";
    executionStore.getState().patch("a", { status: "succeeded", output: { type: "image", value: url }, cacheKey: "k" });
    executionStore.getState().patch("b", { status: "succeeded", output: { type: "image", value: "https://cdn.example/other.png" } });
    resultCache.set("k", { type: "image", value: url });

    markExpired(url);

    expect(executionStore.getState().byId.a).toMatchObject({ status: "stale", hint: "expired" });
    expect(executionStore.getState().byId.a.output).toBeUndefined();
    expect(executionStore.getState().byId.b.status).toBe("succeeded");
    expect(resultCache.has("k")).toBe(false);
  });

  it("never expires demo samples or local previews", () => {
    executionStore.getState().patch("s", { status: "succeeded", output: { type: "image", value: "/samples/image-1.svg" } });
    markExpired("/samples/image-1.svg");
    markExpired("blob:http://127.0.0.1/x");
    expect(executionStore.getState().byId.s.status).toBe("succeeded");
  });
});
