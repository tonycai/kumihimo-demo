import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NODE_SPECS } from "@/engine/nodes";

import { nodeTypes } from "./node-types";

describe("node components (PF-02)", () => {
  it("every node kind has a component, and every component is React.memo", () => {
    for (const kind of Object.keys(NODE_SPECS)) expect(nodeTypes).toHaveProperty(kind);
    for (const [kind, component] of Object.entries(nodeTypes)) {
      expect((component as unknown as { $$typeof: symbol }).$$typeof, kind).toBe(Symbol.for("react.memo"));
    }
  });

  it("the canvas passes the module-level nodeTypes and builds no node or edge types inline", () => {
    const workspace = readFileSync(join(__dirname, "Workspace.tsx"), "utf8");
    expect(workspace).toContain('import { nodeTypes } from "./node-types";');
    expect(workspace).toContain("nodeTypes={nodeTypes}");
    expect(workspace).not.toMatch(/nodeTypes=\{\{|edgeTypes=\{\{|useMemo\(\s*\(\)\s*=>\s*\(\{[^}]*Node/);
    expect(workspace).not.toContain("edgeTypes="); // default edges only, so there is no edgeTypes object at all
  });
});
