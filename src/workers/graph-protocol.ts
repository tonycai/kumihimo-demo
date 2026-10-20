/**
 * Messages between the main thread and the graph Worker (PF-05). `handleGraphRequest` is the whole
 * Worker body, kept here so tests and the no-Worker fallback run exactly the same code.
 */

import { layeredLayout, type LayoutInput, type LayoutOptions } from "@/engine/auto-layout";
import { ancestors, descendants, topoSort, wouldCreateCycle, type EdgePair } from "@/engine/graph";
import { generateStressGraph, stressLayout, type StressGraph } from "@/engine/stress";

export type GraphRequest =
  | { op: "ancestors"; edges: EdgePair[]; nodeId: string }
  | { op: "descendants"; edges: EdgePair[]; nodeId: string }
  | { op: "wouldCreateCycle"; edges: EdgePair[]; source: string; target: string }
  | { op: "topoSort"; nodeIds: string[]; edges: EdgePair[] }
  | { op: "layout"; nodes: LayoutInput[]; edges: EdgePair[]; options?: LayoutOptions }
  | { op: "stress"; count: number; seed: number; cell: { width: number; height: number }; aspect: number };

export type GraphResult<R extends GraphRequest> = R extends { op: "ancestors" | "descendants" }
  ? string[]
  : R extends { op: "wouldCreateCycle" }
    ? boolean
    : R extends { op: "topoSort" }
      ? { order: string[]; cyclic: string[] }
      : R extends { op: "layout" }
        ? Record<string, { x: number; y: number }>
        : R extends { op: "stress" }
          ? StressGraph & { positions: Record<string, { x: number; y: number }> }
          : never;

export type WorkerRequest = { id: number; request: GraphRequest };
export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export function handleGraphRequest<R extends GraphRequest>(request: R): GraphResult<R> {
  switch (request.op) {
    case "ancestors":
      return [...ancestors(request.edges, request.nodeId)] as GraphResult<R>;
    case "descendants":
      return [...descendants(request.edges, request.nodeId)] as GraphResult<R>;
    case "wouldCreateCycle":
      return wouldCreateCycle(request.edges, request.source, request.target) as GraphResult<R>;
    case "topoSort":
      return topoSort(request.nodeIds, request.edges) as GraphResult<R>;
    case "layout":
      return layeredLayout(request.nodes, request.edges, request.options) as GraphResult<R>;
    case "stress": {
      // PF-05: generation and layout of 100–500 nodes stay off the main thread.
      const graph = generateStressGraph(request.count, request.seed);
      const positions = stressLayout(graph.nodes.map((n) => n.id), request.cell, request.aspect);
      return { ...graph, positions } as GraphResult<R>;
    }
  }
}

export function respond(message: WorkerRequest): WorkerResponse {
  try {
    return { id: message.id, ok: true, result: handleGraphRequest(message.request) };
  } catch (error) {
    return { id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
