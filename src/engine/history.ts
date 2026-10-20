/**
 * Snapshot undo/redo (CV-06). Each discrete edit pushes the state from *before* the edit; snapshots
 * are immutable, so unchanged nodes are shared between entries rather than copied.
 */

/** At least 50 undo steps. */
export const HISTORY_LIMIT = 100;

export interface History<S> {
  readonly past: readonly S[];
  readonly future: readonly S[];
}

export function emptyHistory<S>(): History<S> {
  return { past: [], future: [] };
}

export function pushHistory<S>(history: History<S>, before: S, limit = HISTORY_LIMIT): History<S> {
  const past = [...history.past, before];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

export function undoHistory<S>(history: History<S>, current: S): { history: History<S>; state: S } | null {
  if (history.past.length === 0) return null;
  const state = history.past[history.past.length - 1];
  return {
    state,
    history: { past: history.past.slice(0, -1), future: [current, ...history.future] },
  };
}

export function redoHistory<S>(history: History<S>, current: S): { history: History<S>; state: S } | null {
  if (history.future.length === 0) return null;
  const [state, ...future] = history.future;
  return { state, history: { past: [...history.past, current], future } };
}
