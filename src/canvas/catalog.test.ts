import { describe, expect, it } from "vitest";

import { NODE_KINDS } from "@/engine/nodes";

import { searchKinds } from "./catalog";

describe("node search (CV-01)", () => {
  it("finds Image-to-Video for 'video'", () => {
    expect(searchKinds("video")).toEqual(["imageToVideo"]);
  });

  it("matches every word and lists everything for an empty query", () => {
    expect(searchKinds("text image")).toEqual(["textToImage"]);
    expect(searchKinds("  ")).toEqual([...NODE_KINDS]);
    expect(searchKinds("audio")).toEqual([]);
  });
});
