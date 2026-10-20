"use client";

import { useEffect, useState } from "react";

/** PF-07: always-on frames-per-second readout, sampled with requestAnimationFrame twice a second. */
export function FpsMeter({ right }: { right: number }) {
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    let frames = 0;
    let since = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames++;
      if (now - since >= 500) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <output
      data-testid="fps"
      aria-label="Frames per second"
      style={{ right }}
      className="pointer-events-none absolute top-2 z-[6] rounded bg-zinc-900/80 px-2 py-0.5 font-mono text-xs text-white tabular-nums"
    >
      {fps === null ? "-- fps" : `${fps} fps`}
    </output>
  );
}
