import { describe, expect, it } from "vitest";

import { layeredLayout } from "@/engine/auto-layout";

import { arrangeExample, exampleLayoutRequest, LAYOUT_HEIGHT, NODE_WIDTH } from "./template";

describe("example layout (TP-01)", () => {
  const request = exampleLayoutRequest();
  const positions = arrangeExample(layeredLayout(request.nodes, request.edges, request.options));
  const height = Object.fromEntries(request.nodes.map((n) => [n.id, n.height]));

  it("puts each shot prompt in the row of its video, the upscaler above them in the same column", () => {
    for (const i of [1, 2, 3]) expect(positions[`ex-shot-${i}`].y).toBe(positions[`ex-video-${i}`].y);
    expect(positions["ex-upscale"].x).toBe(positions["ex-shot-1"].x);
    expect(positions["ex-upscale"].y + LAYOUT_HEIGHT.imageTool).toBeLessThan(positions["ex-shot-1"].y);
  });

  it("keeps every node at y ≥ 0, and no two nodes overlap", () => {
    const ids = Object.keys(positions);
    for (const id of ids) expect(positions[id].y).toBeGreaterThanOrEqual(0);
    for (const a of ids) {
      for (const b of ids) {
        if (a >= b) continue;
        const pa = positions[a];
        const pb = positions[b];
        const apart =
          pa.x + NODE_WIDTH <= pb.x ||
          pb.x + NODE_WIDTH <= pa.x ||
          pa.y + height[a] <= pb.y ||
          pb.y + height[b] <= pa.y;
        expect(apart, `${a} overlaps ${b}`).toBe(true);
      }
    }
  });
});
