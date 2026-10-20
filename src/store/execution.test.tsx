// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { executionStore, useNodeExec, useNodeOutput } from "./execution";

/** PF-02: which updates re-render a component, counted per probe after each commit. */
const renders: Record<string, number> = {};

function useCount(name: string) {
  useLayoutEffect(() => {
    renders[name] = (renders[name] ?? 0) + 1;
  });
}

function ExecProbe({ id, name }: { id: string; name: string }) {
  useNodeExec(id);
  useCount(name);
  return null;
}

function OutputProbe({ id, name }: { id: string; name: string }) {
  useNodeOutput(id);
  useCount(name);
  return null;
}

afterEach(() => {
  cleanup();
  executionStore.getState().replaceAll({});
  for (const k of Object.keys(renders)) delete renders[k];
});

describe("execution store subscriptions (PF-02)", () => {
  it("streaming into one node re-renders only that node's subscribers", () => {
    render(
      <>
        <ExecProbe id="llm" name="llm" />
        <ExecProbe id="image" name="image" />
        <OutputProbe id="llm" name="previewOfLlm" />
      </>,
    );
    act(() => executionStore.getState().patch("llm", { status: "running" }));
    for (let i = 0; i < 20; i++) act(() => executionStore.getState().patch("llm", { streamText: "word ".repeat(i + 1) }));
    expect(renders).toEqual({ llm: 22, image: 1, previewOfLlm: 1 });

    act(() => executionStore.getState().patch("llm", { status: "succeeded", output: { type: "text", value: "done" } }));
    expect(renders).toEqual({ llm: 23, image: 1, previewOfLlm: 2 });
  });
});
