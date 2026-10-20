import { describe, expect, it } from "vitest";

import { createGraphClient } from "./graph-client";
import { respond, type WorkerRequest } from "./graph-protocol";

/** Stands in for a module Worker: replies asynchronously, like the real one. */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  received = 0;
  postMessage(message: WorkerRequest) {
    this.received++;
    queueMicrotask(() => this.onmessage?.({ data: respond(message) } as MessageEvent));
  }
  terminate() {}
}

const edges = [
  ["a", "b"],
  ["b", "c"],
] as [string, string][];

describe("graph client (PF-05)", () => {
  it("sends requests to the Worker and matches replies by id", async () => {
    const fake = new FakeWorker();
    const client = createGraphClient(() => fake as unknown as Worker);
    const [up, cycle, order] = await Promise.all([
      client.run({ op: "ancestors", edges, nodeId: "c" }),
      client.run({ op: "wouldCreateCycle", edges, source: "c", target: "a" }),
      client.run({ op: "topoSort", nodeIds: ["c", "b", "a"], edges }),
    ]);
    expect(up.sort()).toEqual(["a", "b"]);
    expect(cycle).toBe(true);
    expect(order).toEqual({ order: ["a", "b", "c"], cyclic: [] });
    expect(fake.received).toBe(3);
    expect(client.ranIn).toBe("worker");
  });

  it("falls back to the main thread when no Worker can be made", async () => {
    const client = createGraphClient(() => {
      throw new Error("no workers here");
    });
    expect(await client.run({ op: "descendants", edges, nodeId: "a" })).toEqual(["b", "c"]);
    expect(client.ranIn).toBe("main");
  });
});
