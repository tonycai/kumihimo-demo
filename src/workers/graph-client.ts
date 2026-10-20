/**
 * Promise-based RPC to the graph Worker. One Worker per page, created on first use. Where Worker is
 * unavailable (tests, very old browsers) the same handler runs in-thread.
 */

import {
  handleGraphRequest,
  type GraphRequest,
  type GraphResult,
  type WorkerRequest,
  type WorkerResponse,
} from "./graph-protocol";

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

export interface GraphClient {
  run<R extends GraphRequest>(request: R): Promise<GraphResult<R>>;
  /** Where the last request ran: evidence for PF-05 in the acceptance record. */
  readonly ranIn: "worker" | "main" | null;
}

export function createGraphClient(makeWorker: (() => Worker) | null): GraphClient {
  let worker: Worker | null = null;
  let broken = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let ranIn: GraphClient["ranIn"] = null;

  function ensureWorker(): Worker | null {
    if (worker || broken || !makeWorker) return worker;
    try {
      worker = makeWorker();
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.ok) entry.resolve(message.result);
        else entry.reject(new Error(message.error));
      };
      worker.onerror = () => {
        broken = true;
        for (const entry of pending.values()) entry.reject(new Error("graph worker failed"));
        pending.clear();
        worker?.terminate();
        worker = null;
      };
    } catch {
      broken = true;
    }
    return worker;
  }

  return {
    get ranIn() {
      return ranIn;
    },
    run<R extends GraphRequest>(request: R): Promise<GraphResult<R>> {
      const w = ensureWorker();
      if (!w) {
        ranIn = "main";
        return Promise.resolve(handleGraphRequest(request));
      }
      ranIn = "worker";
      const id = nextId++;
      return new Promise<GraphResult<R>>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        w.postMessage({ id, request } satisfies WorkerRequest);
      });
    },
  };
}

let shared: GraphClient | null = null;

/** The page-wide client. The `new URL(..., import.meta.url)` form lets the bundler emit the Worker. */
export function graphClient(): GraphClient {
  shared ??= createGraphClient(
    typeof Worker === "undefined"
      ? null
      : () => new Worker(new URL("./graph.worker.ts", import.meta.url), { type: "module" }),
  );
  return shared;
}
