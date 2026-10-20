"use client";

import { useStore as useFlowStore } from "@xyflow/react";
import { createContext, startTransition, useContext, useEffect, useState, type ReactNode } from "react";

/** PF-04: below this zoom a node shrinks to its title and status dot. */
export const LOD_ZOOM = 0.5;

const CompactContext = createContext(false);

/**
 * Hands the detail level to the nodes as a transition. Crossing the threshold re-renders every
 * visible node; as a transition React renders that in short slices between frames instead of one
 * long task (measured: up to 100 ms per crossing with the CPU slowed 4×), and drops it if the zoom
 * keeps changing.
 */
export function DetailLevel({ children }: { children: ReactNode }) {
  const compactNow = useFlowStore((s) => s.transform[2] < LOD_ZOOM);
  const [compact, setCompact] = useState(compactNow);
  useEffect(() => {
    startTransition(() => setCompact(compactNow));
  }, [compactNow]);
  return <CompactContext.Provider value={compact}>{children}</CompactContext.Provider>;
}

export function useCompact(): boolean {
  return useContext(CompactContext);
}
