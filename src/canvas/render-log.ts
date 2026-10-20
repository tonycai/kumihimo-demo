import { useLayoutEffect } from "react";

declare global {
  interface Window {
    /** Set to an array by an E2E test (PF-02) to record node renders; absent otherwise. */
    __kumihimoRenders?: { id: string; t: number }[];
  }
}

/** PF-02 evidence: appends { node id, time } after every render while a test is recording. */
export function useRenderLog(nodeId: string): void {
  useLayoutEffect(() => {
    window.__kumihimoRenders?.push({ id: nodeId, t: performance.now() });
  });
}
