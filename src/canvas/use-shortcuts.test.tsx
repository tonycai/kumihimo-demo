// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { graphStore } from "@/store/graph";

import { useShortcuts, useSpaceHeld } from "./use-shortcuts";

function Probe() {
  const held = useSpaceHeld();
  useShortcuts();
  return (
    <div>
      <output data-testid="held">{String(held)}</output>
      <input aria-label="prompt" defaultValue="" />
      <textarea aria-label="system" defaultValue="" />
    </div>
  );
}

function press(target: EventTarget, init: KeyboardEventInit, type: "keydown" | "keyup" = "keydown") {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const isHeld = () => document.querySelector("[data-testid=held]")?.textContent === "true";

afterEach(() => {
  cleanup();
  graphStore.getState().replaceGraph({ nodes: [], edges: [] });
});

describe("Space and Backspace inside fields (CV-08)", () => {
  it("Space typed in an input or textarea stays a space: no pan mode, default not prevented", () => {
    const { getByLabelText } = render(<Probe />);
    for (const field of [getByLabelText("prompt"), getByLabelText("system")]) {
      const down = press(field, { key: " ", code: "Space" });
      expect(down.defaultPrevented).toBe(false);
      expect(isHeld()).toBe(false);
      press(field, { key: " ", code: "Space" }, "keyup");
    }
  });

  it("Space on the canvas enters pan mode and leaves it on release", () => {
    render(<Probe />);
    const down = press(document.body, { key: " ", code: "Space" });
    expect(down.defaultPrevented).toBe(true);
    expect(isHeld()).toBe(true);
    press(document.body, { key: " ", code: "Space" }, "keyup");
    expect(isHeld()).toBe(false);
  });

  it("Backspace in a field never deletes the selected node", () => {
    const id = graphStore.getState().addNode("textPrompt", { x: 0, y: 0 });
    const { getByLabelText } = render(<Probe />);
    press(getByLabelText("prompt"), { key: "Backspace", code: "Backspace" });
    expect(graphStore.getState().nodes.map((n) => n.id)).toEqual([id]);
    press(document.body, { key: "Backspace", code: "Backspace" });
    expect(graphStore.getState().nodes).toEqual([]);
  });
});
