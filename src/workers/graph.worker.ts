/// <reference lib="webworker" />
/** Graph Worker entry (PF-05): cycle checks and topological sorts run here, off the main thread. */

import { respond, type WorkerRequest } from "./graph-protocol";

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  self.postMessage(respond(event.data));
};
