import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/** Static guards for AT-01 / DP-06: the key and the upstream host stay on the server. */

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sourceFiles = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, "utf8") }));

describe("server-only boundaries", () => {
  it("reads ATLASCLOUD_API_KEY only in src/server/env.ts", () => {
    const readers = sourceFiles.filter((f) => f.text.includes("ATLASCLOUD_API_KEY"));
    expect(readers.map((f) => f.path)).toEqual(["src/server/env.ts"]);
  });

  it("mentions the Atlas API host only in the live adapter", () => {
    const hits = sourceFiles.filter((f) => f.text.includes("api.atlascloud.ai"));
    expect(hits.map((f) => f.path)).toEqual(["src/atlas/live.ts"]);
  });

  it("never exposes Atlas settings through NEXT_PUBLIC_ variables", () => {
    const hits = sourceFiles.filter((f) => /NEXT_PUBLIC_[A-Z_]*(ATLAS|KEY|LIVE|PASS)/.test(f.text));
    expect(hits.map((f) => f.path)).toEqual([]);
  });

  it("marks modules that touch the key or upstream as server-only", () => {
    const sensitive = ["src/server/env.ts", "src/server/mode.ts", "src/server/http.ts", "src/atlas/live.ts"];
    for (const path of sensitive) {
      const file = sourceFiles.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(file!.text.startsWith('import "server-only";'), path).toBe(true);
    }
  });

  it("keeps client components away from server modules", () => {
    const clientFiles = sourceFiles.filter((f) => /^["']use client["'];/.test(f.text));
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      expect(file.text, file.path).not.toMatch(/from ["']@\/server\//);
      expect(file.text, file.path).not.toMatch(/from ["']@\/atlas\/live["']/);
    }
  });
});
