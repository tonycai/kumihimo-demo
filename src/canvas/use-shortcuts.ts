"use client";

import { useEffect, useState } from "react";

import { graphStore } from "@/store/graph";

/** Keys typed into a field belong to the field (CV-08: Backspace in the panel edits text only). */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Canvas shortcuts. React Flow's own delete key is turned off so every edit goes through
 * the graph store and lands in undo history.
 */
export function useShortcuts() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || isEditable(e.target)) return;
      const g = graphStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      let handled = true;
      if (mod && key === "z") {
        if (e.shiftKey) g.redo();
        else g.undo();
      } else if (mod && key === "y") g.redo();
      else if (mod && key === "c") {
        // Let the browser copy selected page text.
        if (window.getSelection()?.toString()) return;
        handled = g.copySelected();
      } else if (mod && key === "v") g.paste();
      else if (mod && key === "g") {
        if (e.shiftKey) g.ungroupSelected();
        else g.groupSelected();
      } else if (!mod && (e.key === "Delete" || e.key === "Backspace")) g.deleteSelected();
      else handled = false;
      if (handled) e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * CV-05: while Space is held a drag pans the canvas even when it starts on a node. React Flow's own
 * pan key only covers empty canvas, so the workspace turns node dragging off and lets the pointer
 * fall through to the pane.
 */
export function useSpaceHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || isEditable(e.target)) return;
      e.preventDefault(); // no page scroll, no button press
      setHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") setHeld(false);
    }
    const release = () => setHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, []);
  return held;
}
