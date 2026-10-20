import { createStore, useStore } from "zustand";

import type { ModeDecision } from "@/atlas/types";

/** Page-level flags that are not part of the graph or of any node. */
export interface UiState {
  /** What the server decided for this browser (GET /api/mode). */
  serverMode: ModeDecision | null;
  /** AT-06 / DM-05: the visitor chose to carry on with demo results for this tab. */
  demoOverride: boolean;
  /** AT-06: Atlas answered 402; offer demo mode. */
  liveBlocked: boolean;
  /** DP-01: a live request came back 401 (session expired or signed out elsewhere). */
  sessionEnded: boolean;
  autosave: "ok" | "unavailable" | "unknown";
  /** One-line message for the toast (refused live runs and the like). */
  notice: string | null;
  /** Bumped to make the mode be fetched again (after sign-in, sign-out, demo switch). */
  modeVersion: number;
}

export const uiStore = createStore<UiState>()(() => ({
  serverMode: null,
  demoOverride: false,
  liveBlocked: false,
  sessionEnded: false,
  autosave: "unknown",
  notice: null,
  modeVersion: 0,
}));

/** Live only when the server says so and the visitor has not switched to demo results. */
export function effectiveMode(s: UiState = uiStore.getState()): "live" | "mock" {
  return s.serverMode?.mode === "live" && !s.demoOverride ? "live" : "mock";
}

export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(uiStore, selector);
}
