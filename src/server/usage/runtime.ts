import "server-only";

import { join } from "node:path";

import { createFileLedger } from "./file-ledger";
import { createFirestoreDb, createFirestoreUsageStore } from "./firestore";
import { createMemoryUsageStore, type UsageStore } from "./store";

/**
 * Which store backs the counters.
 *
 * Firestore is used ONLY when KUMIHIMO_FIRESTORE_PROJECT names the project explicitly (the
 * dedicated Kumihimo project). Ambient credentials and GOOGLE_CLOUD_PROJECT on a developer
 * machine are never picked up: a local production build must not write to whatever project
 * happens to be configured there.
 *
 * Without it: `next dev` uses the `.data/` ledger; tests and local production builds use memory,
 * which `sharedStoreAvailable()` reports so live mode can fail closed.
 */
let shared: Promise<UsageStore> | null = null;
/** A store handed in by tests stands in for the shared one. */
let injected = false;

export function firestoreProject(): string | null {
  const p = process.env.KUMIHIMO_FIRESTORE_PROJECT?.trim();
  return p && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(p) ? p : null;
}

/** Live mode needs counters shared across instances (DP-04); memory is per instance. */
export function sharedStoreAvailable(): boolean {
  return injected || firestoreProject() !== null || process.env.NODE_ENV === "development";
}

export function usageStore(): Promise<UsageStore> {
  shared ??= (async () => {
    const project = firestoreProject();
    if (project) return createFirestoreUsageStore(await createFirestoreDb(project));
    if (process.env.NODE_ENV === "development") return createFileLedger(join(process.cwd(), ".data", "ledger.json"));
    return createMemoryUsageStore();
  })();
  shared.catch(() => {
    shared = null; // try again on the next request instead of caching the failure
  });
  return shared;
}

/** Tests swap in their own store. */
export function setUsageStoreForTests(store: UsageStore | null) {
  shared = store ? Promise.resolve(store) : null;
  injected = store !== null;
}
