import { useEffect, useState } from "react";

/**
 * One shared 1 s tick for every "Running 12s" label, started only while some node needs it,
 * instead of one interval per node.
 */
const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: (now: number) => void) {
  listeners.add(fn);
  timer ??= setInterval(() => {
    const now = Date.now();
    for (const l of listeners) l(now);
  }, 1_000);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time while `active`, refreshed every second; null otherwise (never read during render). */
export function useTicker(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const off = subscribe(setNow);
    const first = setTimeout(() => setNow(Date.now()), 0);
    return () => {
      clearTimeout(first);
      off();
    };
  }, [active]);
  return active ? now : null;
}
