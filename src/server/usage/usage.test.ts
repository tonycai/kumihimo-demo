import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createFileLedger } from "./file-ledger";
import { COLLECTIONS, createFirestoreUsageStore, type FirestoreLike, type TxLike } from "./firestore";
import { decideReserve, jstDay, rateWindow, type ReserveRequest } from "./rules";
import { countsOf, createMemoryUsageStore, predictionKey, type UsageCounts, type UsageStore } from "./store";

/**
 * In-memory Firestore with the two behaviours the store relies on: transactions are isolated
 * (run one at a time, writes land only on success) and every read precedes the first write.
 */
class FakeFirestore implements FirestoreLike<string> {
  docs = new Map<string, Record<string, unknown>>();
  private queue: Promise<unknown> = Promise.resolve();

  doc(path: string) {
    return path;
  }

  runTransaction<T>(fn: (tx: TxLike<string>) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const writes = new Map<string, Record<string, unknown>>();
      const tx: TxLike<string> = {
        get: async (ref) => {
          if (writes.size > 0) throw new Error("Firestore: all reads must happen before any write");
          const data = this.docs.get(ref);
          return { exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
        },
        set: (ref, data) => {
          writes.set(ref, structuredClone(data));
        },
      };
      const result = await fn(tx);
      for (const [ref, data] of writes) this.docs.set(ref, data);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

const NOON_JST = Date.UTC(2026, 9, 22, 3, 0, 0); // 2026-10-22 12:00 JST
const MICRO = 1_000_000;

function req(over: Partial<ReserveRequest> = {}): ReserveRequest {
  return {
    reservationId: "r1",
    passcodeLabel: "guest",
    costMicroUsd: 100_000,
    passcodeDailyMicroUsd: 1 * MICRO,
    siteDailyMicroUsd: 3 * MICRO,
    maxConcurrent: 3,
    leaseMs: 120_000,
    now: NOON_JST,
    ...over,
  };
}

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const STORES: [string, () => Promise<UsageStore>][] = [
  ["memory", async () => createMemoryUsageStore()],
  ["firestore (fake)", async () => createFirestoreUsageStore(new FakeFirestore())],
  [
    "dev file ledger",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kumihimo-ledger-"));
      dirs.push(dir);
      return createFileLedger(join(dir, "ledger.json"));
    },
  ],
];

describe.each(STORES)("UsageStore contract: %s", (_name, make) => {
  it("charges both budgets and takes a slot", async () => {
    const s = await make();
    expect(await s.reserve(req())).toEqual({ ok: true });
    expect(await s.reserve(req({ reservationId: "r2" }))).toEqual({ ok: true });
  });

  it("refuses over the passcode budget and charges nothing", async () => {
    const s = await make();
    expect(await s.reserve(req({ costMicroUsd: 900_000 }))).toEqual({ ok: true });
    expect(await s.reserve(req({ reservationId: "r2", costMicroUsd: 200_000 }))).toEqual({
      ok: false,
      reason: "passcode_budget",
    });
    // The refused request took nothing: exactly the remaining 100k still fits.
    expect(await s.reserve(req({ reservationId: "r3", costMicroUsd: 100_000 }))).toEqual({ ok: true });
  });

  it("refuses over the site budget across passcodes", async () => {
    const s = await make();
    for (const [i, label] of ["a", "b", "c"].entries()) {
      expect(await s.reserve(req({ reservationId: `r${i}`, passcodeLabel: label, costMicroUsd: MICRO, maxConcurrent: 9 }))).toEqual({
        ok: true,
      });
    }
    expect(await s.reserve(req({ reservationId: "r9", passcodeLabel: "d", costMicroUsd: 1, maxConcurrent: 9 }))).toEqual({
      ok: false,
      reason: "site_budget",
    });
  });

  it("caps concurrency; release and lease expiry free slots", async () => {
    const s = await make();
    for (const id of ["a", "b", "c"]) expect((await s.reserve(req({ reservationId: id, costMicroUsd: 1 }))).ok).toBe(true);
    expect(await s.reserve(req({ reservationId: "d", costMicroUsd: 1 }))).toEqual({ ok: false, reason: "concurrency" });
    await s.release("a", NOON_JST);
    expect((await s.reserve(req({ reservationId: "d", costMicroUsd: 1 }))).ok).toBe(true);
    const later = NOON_JST + 120_001;
    expect((await s.reserve(req({ reservationId: "e", costMicroUsd: 1, now: later }))).ok).toBe(true);
  });

  it("starts a new budget day at midnight JST", async () => {
    const s = await make();
    const beforeMidnight = Date.UTC(2026, 9, 22, 14, 59, 59);
    const afterMidnight = Date.UTC(2026, 9, 22, 15, 0, 0);
    expect(jstDay(beforeMidnight)).toBe("2026-10-22");
    expect(jstDay(afterMidnight)).toBe("2026-10-23");
    expect((await s.reserve(req({ costMicroUsd: MICRO, now: beforeMidnight }))).ok).toBe(true);
    expect((await s.reserve(req({ reservationId: "r2", costMicroUsd: MICRO, now: afterMidnight }))).ok).toBe(true);
  });

  it("rate-limits per IP hash, bucket and window", async () => {
    const s = await make();
    const hit = { bucket: "submit" as const, ipHash: "abc123", windowMs: 60_000, limit: 3, now: NOON_JST };
    for (let i = 1; i <= 3; i++) expect(await s.hitRateLimit(hit)).toEqual({ allowed: true, count: i });
    expect(await s.hitRateLimit(hit)).toEqual({ allowed: false, count: 4 });
    expect((await s.hitRateLimit({ ...hit, ipHash: "def456" })).allowed).toBe(true);
    expect((await s.hitRateLimit({ ...hit, bucket: "passcode_fail" })).allowed).toBe(true);
    expect(await s.hitRateLimit({ ...hit, now: NOON_JST + 60_000 })).toEqual({ allowed: true, count: 1 });
  });

  it("binds a prediction to its passcode until it expires", async () => {
    const s = await make();
    const info = { passcodeLabel: "guest", reservationId: "r1", uploadDerived: false };
    await s.bindPrediction("pred.abc:123", info, NOON_JST + 1_000);
    expect(await s.predictionInfo("pred.abc:123", NOON_JST)).toEqual(info);
    expect(await s.predictionInfo("pred.abc:123", NOON_JST + 1_000)).toBeNull();
    expect(await s.predictionInfo("unknown", NOON_JST)).toBeNull();
  });

  it("remembers upload-derived URLs until they expire (upload rule, server side)", async () => {
    const s = await make();
    await s.markUploadDerived(["https://files.example/u.png", "https://cdn.example/up.png"], NOON_JST + 1_000);
    expect(await s.isUploadDerived("https://files.example/u.png", NOON_JST)).toBe(true);
    expect(await s.isUploadDerived("https://cdn.example/up.png", NOON_JST)).toBe(true);
    expect(await s.isUploadDerived("https://cdn.example/other.png", NOON_JST)).toBe(false);
    expect(await s.isUploadDerived("https://files.example/u.png", NOON_JST + 1_000)).toBe(false);
  });

  it("rejects ids that could break document paths", async () => {
    const s = await make();
    await expect(s.reserve(req({ passcodeLabel: "a/b" }))).rejects.toThrow(/unsafe/);
    await expect(s.hitRateLimit({ bucket: "submit", ipHash: "../x", windowMs: 1, limit: 1, now: 0 })).rejects.toThrow(/unsafe/);
  });

  it("keeps the limits under parallel requests", async () => {
    const s = await make();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => s.reserve(req({ reservationId: `p${i}`, costMicroUsd: 1 }))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
});

/** The same stores, with a way to read one budget document's counters back (DP-10). */
type Counted = UsageCounts & { spent: number };
const COUNTING: [string, () => Promise<{ s: UsageStore; read: (key: string) => Promise<Counted> }>][] = [
  [
    "memory",
    async () => {
      const s = createMemoryUsageStore();
      return {
        s,
        read: async (key) => ({ ...countsOf(s.state.counts[key] as unknown as Record<string, unknown>), spent: s.state.budget[key] ?? 0 }),
      };
    },
  ],
  [
    "firestore (fake)",
    async () => {
      const db = new FakeFirestore();
      return {
        s: createFirestoreUsageStore(db),
        read: async (key) => {
          const d = db.docs.get(`${COLLECTIONS.budget}/${key}`);
          return { ...countsOf(d), spent: Number(d?.spentMicroUsd ?? 0) };
        },
      };
    },
  ],
  [
    "dev file ledger",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kumihimo-ledger-"));
      dirs.push(dir);
      const path = join(dir, "ledger.json");
      return {
        s: createFileLedger(path),
        read: async (key) => {
          const state = JSON.parse(await readFile(path, "utf8"));
          return { ...countsOf(state.counts?.[key]), spent: state.budget?.[key] ?? 0 };
        },
      };
    },
  ],
];

describe.each(COUNTING)("usage counters (DP-10): %s", (_name, make) => {
  it("counts accepted submissions and the day's limit, per passcode and for the site", async () => {
    const { s, read } = await make();
    await s.reserve(req({ costMicroUsd: 400_000 }));
    await s.reserve(req({ reservationId: "r2", costMicroUsd: 400_000 }));
    expect(await s.reserve(req({ reservationId: "r3", costMicroUsd: 400_000 }))).toMatchObject({ ok: false }); // refused: not counted
    expect(await read("2026-10-22_guest")).toEqual({ submits: 2, succeeded: 0, failed: 0, limitMicroUsd: 1 * MICRO, spent: 800_000 });
    expect(await read("2026-10-22_site")).toEqual({ submits: 2, succeeded: 0, failed: 0, limitMicroUsd: 3 * MICRO, spent: 800_000 });
  });

  it("counts each prediction's outcome once, however often it is polled; chat outcomes without an id", async () => {
    const { s, read } = await make();
    await s.reserve(req());
    await s.bindPrediction("pred-1", { passcodeLabel: "guest", reservationId: "r1", uploadDerived: false }, NOON_JST + 86_400_000);
    await s.recordOutcome("guest", true, NOON_JST, "pred-1");
    await s.recordOutcome("guest", true, NOON_JST + 1_000, "pred-1"); // polled again after it finished
    await s.recordOutcome("guest", false, NOON_JST); // a chat stream that failed
    expect(await read("2026-10-22_guest")).toMatchObject({ submits: 1, succeeded: 1, failed: 1, spent: 100_000 });
    expect(await read("2026-10-22_site")).toMatchObject({ submits: 1, succeeded: 1, failed: 1 });
  });
});

describe("Firestore layout", () => {
  it("writes the documents the IAM list and TTL policy expect", async () => {
    const db = new FakeFirestore();
    const s = createFirestoreUsageStore(db);
    await s.reserve(req());
    await s.hitRateLimit({ bucket: "submit", ipHash: "abc", windowMs: 60_000, limit: 10, now: NOON_JST });
    await s.bindPrediction("pred-1", { passcodeLabel: "guest", reservationId: "r1", uploadDerived: false }, NOON_JST + 86_400_000);
    const paths = [...db.docs.keys()].sort();
    const window = rateWindow({ bucket: "submit", ipHash: "abc", windowMs: 60_000, limit: 10, now: NOON_JST });
    expect(paths).toEqual(
      [
        `${COLLECTIONS.budget}/2026-10-22_guest`,
        `${COLLECTIONS.budget}/2026-10-22_site`,
        `${COLLECTIONS.concurrency}/global`,
        `${COLLECTIONS.predictions}/${predictionKey("pred-1")}`,
        `${COLLECTIONS.ratelimit}/${window.key}`,
      ].sort(),
    );
    // TTL policies need a timestamp field, so expireAt is stored as a Date.
    expect(db.docs.get(`${COLLECTIONS.ratelimit}/${window.key}`)!.expireAt).toBeInstanceOf(Date);
    expect(db.docs.get(`${COLLECTIONS.predictions}/${predictionKey("pred-1")}`)!.expireAt).toBeInstanceOf(Date);
    // No raw IP, passcode or prompt anywhere.
    expect(JSON.stringify([...db.docs.values()])).not.toMatch(/\d+\.\d+\.\d+\.\d+|passcode"|prompt|https?:/);
  });

  it("rate-limit documents expire within two windows (privacy notice: under 25 h)", () => {
    const w = rateWindow({ bucket: "submit", ipHash: "x", windowMs: 60_000, limit: 1, now: NOON_JST });
    expect(w.expireAt - NOON_JST).toBeLessThanOrEqual(120_000);
  });
});

describe("dev file ledger", () => {
  it("survives a restart and keeps the file private", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kumihimo-ledger-"));
    dirs.push(dir);
    const path = join(dir, ".data", "ledger.json");
    await createFileLedger(path).reserve(req({ costMicroUsd: 900_000 }));
    const restarted = createFileLedger(path);
    expect(await restarted.reserve(req({ reservationId: "r2", costMicroUsd: 200_000 }))).toEqual({
      ok: false,
      reason: "passcode_budget",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8")).budget["2026-10-22_guest"]).toBe(900_000);
  });
});

describe("decideReserve", () => {
  it("prunes expired slots even when it refuses", () => {
    const d = decideReserve(
      { passcodeSpentMicroUsd: 0, siteSpentMicroUsd: 0, slots: { old: NOON_JST - 1 } },
      req({ costMicroUsd: 2 * MICRO }),
    );
    expect(d).toEqual({
      ok: false,
      reason: "passcode_budget",
      next: { passcodeSpentMicroUsd: 0, siteSpentMicroUsd: 0, slots: {} },
    });
  });
});
