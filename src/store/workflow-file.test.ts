import { afterEach, describe, expect, it } from "vitest";

import { buildExample, exampleLayoutRequest } from "@/canvas/template";

import { executionStore } from "./execution";
import { graphStore } from "./graph";
import type { GraphSnapshot, KNode } from "./types";
import { exportWorkflow, importWorkflow, MAX_IMPORT_NODES, WORKFLOW_SCHEMA, WORKFLOW_VERSION } from "./workflow-file";

afterEach(() => {
  graphStore.getState().replaceGraph({ nodes: [], edges: [] });
  executionStore.getState().replaceAll({});
});

/** The example with two of its nodes in a group, as the canvas would hold it. */
function exampleWithGroup(): GraphSnapshot {
  const positions = Object.fromEntries(exampleLayoutRequest().nodes.map((n, i) => [n.id, { x: i * 300, y: (i % 3) * 150 }]));
  graphStore.getState().loadDocument(buildExample(positions));
  const [first, second] = graphStore.getState().nodes;
  graphStore.setState((s) => ({
    nodes: s.nodes.map((n) => (n.id === first.id || n.id === second.id ? { ...n, selected: true } : n)),
  }));
  graphStore.getState().groupSelected();
  // What React Flow adds at runtime must not leak into the file.
  graphStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, measured: { width: 224, height: 120 }, dragging: false }) as KNode),
  }));
  const { nodes, edges } = graphStore.getState();
  return { nodes, edges };
}

/** The fields that make up the document (selection and React Flow's measurements are view state). */
function documentOf(g: GraphSnapshot) {
  return {
    nodes: g.nodes.map(({ id, type, position, data, parentId, extent, width, height }) => ({
      id,
      type,
      position,
      data,
      ...(parentId ? { parentId, extent } : {}),
      ...(type === "group" ? { width, height } : {}),
    })),
    edges: g.edges.map(({ id, source, sourceHandle, target, targetHandle, data, className }) => ({
      id,
      source,
      sourceHandle,
      target,
      targetHandle,
      data,
      className,
    })),
  };
}

const roundTrip = (g: GraphSnapshot) => importWorkflow(JSON.stringify(exportWorkflow(g)));

function fileWith(patch: (f: ReturnType<typeof exportWorkflow>) => void): string {
  const f = structuredClone(exportWorkflow(exampleWithGroup()));
  patch(f);
  return JSON.stringify(f);
}

function reasonOf(text: string): string {
  const r = importWorkflow(text);
  if (r.ok) throw new Error("expected the import to be refused");
  return r.reason;
}

describe("workflow export and import (TP-02)", () => {
  it("export → import gives the same nodes, edges, parameters and groups", () => {
    const g = exampleWithGroup();
    expect(g.nodes.some((n) => n.type === "group")).toBe(true);
    expect(g.nodes.some((n) => n.parentId)).toBe(true);
    const r = roundTrip(g);
    if (!r.ok) throw new Error(r.reason);
    expect(documentOf(r.graph)).toEqual(documentOf(g));
    expect(exportWorkflow(r.graph)).toEqual(exportWorkflow(g));
  });

  it("the file carries a schema name and version", () => {
    const f = exportWorkflow(exampleWithGroup());
    expect(f.schema).toBe(WORKFLOW_SCHEMA);
    expect(f.version).toBe(WORKFLOW_VERSION);
  });

  it("holds no results, upload previews or URLs, and no view state (AT-07)", () => {
    const g = exampleWithGroup();
    const exec = executionStore.getState();
    for (const n of g.nodes) {
      exec.patch(n.id, { status: "succeeded", output: { type: "image", value: "https://example.invalid/out.png" } });
    }
    exec.patch(g.nodes[0].id, { localPreview: "blob:http://127.0.0.1/abc", localName: "me.png" });
    const text = JSON.stringify(exportWorkflow(g));
    expect(text).not.toMatch(/https?:|blob:|data:/);
    expect(text).not.toMatch(/"(output|localPreview|localName|selected|measured|dragging|status)"/);
  });
});

describe("import refuses bad files with a reason (TP-02)", () => {
  it.each([
    ["not JSON", "{nodes:", /not valid JSON/],
    ["another schema", JSON.stringify({ schema: "other", version: 1, nodes: [], edges: [] }), /not a Kumihimo workflow/],
    ["a newer version", JSON.stringify({ schema: WORKFLOW_SCHEMA, version: 2, nodes: [], edges: [] }), /version 2/],
  ])("%s", (_, text, reason) => {
    expect(reasonOf(text)).toMatch(reason);
  });

  it(`more than ${MAX_IMPORT_NODES} nodes`, () => {
    const nodes = Array.from({ length: MAX_IMPORT_NODES + 1 }, (_, i) => ({
      id: `n${i}`,
      type: "textPrompt",
      position: { x: 0, y: 0 },
      data: { text: "" },
    }));
    expect(reasonOf(JSON.stringify({ schema: WORKFLOW_SCHEMA, version: 1, nodes, edges: [] }))).toMatch(/more than 1000 nodes/);
  });

  it("a model that is not in the registry", () => {
    const text = fileWith((f) => {
      const llm = f.nodes.find((n) => n.type === "llm")!;
      llm.data.model = "someone/unlisted-model";
    });
    expect(reasonOf(text)).toMatch(/not in this demo's model registry/);
  });

  it("parameters the model does not offer", () => {
    const text = fileWith((f) => {
      f.nodes.find((n) => n.type === "textToImage")!.data.size = "99999*99999";
    });
    expect(reasonOf(text)).toMatch(/size/);
  });

  it("an unknown node type", () => {
    const text = fileWith((f) => void (f.nodes.find((n) => n.type === "outputPreview")!.type = "script"));
    expect(reasonOf(text)).toMatch(/unknown node type "script"/);
  });

  it("edges to missing nodes, wrong ports, duplicate inputs and cycles", () => {
    expect(reasonOf(fileWith((f) => void (f.edges[0].target = "nowhere")))).toMatch(/not in the file/);
    expect(reasonOf(fileWith((f) => void (f.edges[0].targetHandle = "in:video")))).toMatch(/does not fit/);
    expect(
      reasonOf(
        fileWith((f) => {
          const video = f.edges.find((e) => e.targetHandle === "in:image" && f.nodes.find((n) => n.id === e.target)?.type === "imageToVideo")!;
          const other = f.nodes.find((n) => n.type === "textToImage")!;
          f.edges.push({ ...video, source: other.id, sourceHandle: "out:image" });
        }),
      ),
    ).toMatch(/more than one edge/);
    const prompt = { id: "a", type: "llm", position: { x: 0, y: 0 }, data: exportWorkflow(exampleWithGroup()).nodes.find((n) => n.type === "llm")!.data };
    const loop = {
      schema: WORKFLOW_SCHEMA,
      version: 1,
      nodes: [prompt, { ...prompt, id: "b" }],
      edges: [
        { source: "a", sourceHandle: "out:text", target: "b", targetHandle: "in:text" },
        { source: "b", sourceHandle: "out:text", target: "a", targetHandle: "in:text" },
      ],
    };
    expect(reasonOf(JSON.stringify(loop))).toMatch(/cycle/);
  });

  it("duplicate ids and children listed before their group", () => {
    expect(reasonOf(fileWith((f) => void (f.nodes[1].id = f.nodes[0].id)))).toMatch(/duplicate node id/);
    expect(reasonOf(fileWith((f) => void f.nodes.reverse()))).toMatch(/not a group listed before it/);
  });

  it("treats everything as data: no code runs, no prototype is touched", () => {
    const text = fileWith((f) => {
      const p = f.nodes.find((n) => n.type === "textPrompt")!;
      p.data.text = "<script>alert(1)</script> ${process.exit()}";
    }).replace('"data":{', '"data":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},');
    const r = importWorkflow(text);
    expect(r.ok).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    if (r.ok) {
      const p = r.graph.nodes.find((n) => n.type === "textPrompt")!;
      expect(p.data).toEqual({ text: "<script>alert(1)</script> ${process.exit()}" });
    }
  });
});
