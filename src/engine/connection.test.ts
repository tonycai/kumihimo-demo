import { describe, expect, it } from "vitest";

import { checkConnection, checkPorts, displacedEdges } from "./connection";

describe("port types (CV-02)", () => {
  it("refuses text → image and accepts text → text", () => {
    const bad = checkPorts({
      sourceKind: "textPrompt",
      sourceHandle: "out:text",
      targetKind: "imageToVideo",
      targetHandle: "in:image",
    });
    expect(bad).toEqual({ ok: false, reason: "type-mismatch", from: "text", to: ["image"] });
    const good = checkPorts({
      sourceKind: "textPrompt",
      sourceHandle: "out:text",
      targetKind: "imageToVideo",
      targetHandle: "in:text",
    });
    expect(good).toEqual({ ok: true, portType: "text" });
  });

  it("lets Output Preview take text, image and video", () => {
    for (const [kind, handle] of [
      ["llm", "out:text"],
      ["textToImage", "out:image"],
      ["imageToVideo", "out:video"],
    ] as const) {
      expect(
        checkPorts({ sourceKind: kind, sourceHandle: handle, targetKind: "outputPreview", targetHandle: "in:any" }).ok,
      ).toBe(true);
    }
  });

  it("refuses unknown kinds and handles", () => {
    expect(checkPorts({ sourceKind: "group", sourceHandle: null, targetKind: "llm", targetHandle: "in:text" })).toEqual({
      ok: false,
      reason: "unknown-port",
    });
    expect(
      checkPorts({ sourceKind: "llm", sourceHandle: "out:video", targetKind: "llm", targetHandle: "in:text" }).ok,
    ).toBe(false);
  });

  it("reports a cycle only after the ports match", () => {
    const q = { sourceKind: "llm", sourceHandle: "out:text", targetKind: "llm", targetHandle: "in:text" };
    expect(checkConnection(q, true)).toEqual({ ok: false, reason: "cycle" });
    expect(checkConnection({ ...q, targetKind: "textToImage", targetHandle: "in:image" }, true).ok).toBe(false);
    expect(checkConnection(q, false)).toEqual({ ok: true, portType: "text" });
  });
});

describe("displacedEdges", () => {
  const edges = [
    { id: "e1", target: "v", targetHandle: "in:text" },
    { id: "e2", target: "v", targetHandle: "in:image" },
    { id: "e3", target: "p", targetHandle: "in:any" },
  ];

  it("replaces the edge on a single-value input", () => {
    expect(displacedEdges(edges, "imageToVideo", "v", "in:text")).toEqual(["e1"]);
  });

  it("keeps all edges on a multi-input port", () => {
    expect(displacedEdges(edges, "outputPreview", "p", "in:any")).toEqual([]);
  });
});
