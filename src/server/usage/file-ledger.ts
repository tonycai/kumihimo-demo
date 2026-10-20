import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createMemoryUsageStore, emptyMemoryState, type MemoryState, type UsageStore } from "./store";

/**
 * `next dev` only (architecture §4): a single-process JSON ledger under `.data/` (git-ignored) so
 * local live-mode runs (AT-03, stage 2 debugging) keep their budget across restarts without
 * touching the real Firestore. Production never uses it: no Firestore there means fail closed.
 */
export function createFileLedger(path: string): UsageStore {
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<MemoryState> {
    try {
      return { ...emptyMemoryState(), ...(JSON.parse(await readFile(path, "utf8")) as Partial<MemoryState>) };
    } catch {
      return emptyMemoryState();
    }
  }

  async function save(state: MemoryState) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
    await rename(tmp, path); // atomic replace: a crash never leaves half a ledger
  }

  /** One operation at a time: load, apply, save. */
  function run<T>(op: (store: UsageStore) => Promise<T>): Promise<T> {
    const next = queue.then(async () => {
      const store = createMemoryUsageStore(await load());
      const result = await op(store);
      await save(store.state);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  }

  return {
    reserve: (req) => run((s) => s.reserve(req)),
    release: (id, now) => run((s) => s.release(id, now)),
    hitRateLimit: (hit) => run((s) => s.hitRateLimit(hit)),
    peekRate: (hit) => run((s) => s.peekRate(hit)),
    bindPrediction: (id, info, expireAt) => run((s) => s.bindPrediction(id, info, expireAt)),
    predictionInfo: (id, now) => run((s) => s.predictionInfo(id, now)),
    markUploadDerived: (urls, expireAt) => run((s) => s.markUploadDerived(urls, expireAt)),
    isUploadDerived: (url, now) => run((s) => s.isUploadDerived(url, now)),
    recordOutcome: (label, ok, now, predictionId) => run((s) => s.recordOutcome(label, ok, now, predictionId)),
  };
}
