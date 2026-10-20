import "server-only";

import {
  assertSafeId,
  decideRate,
  decideRelease,
  decideReserve,
  rateWindow,
  type BudgetState,
} from "./rules";
import { budgetKeys, countsOf, predictionKey, urlKey, type UsageStore } from "./store";

/**
 * The slice of the Firestore SDK this store uses, so tests can supply a fake. `createFirestoreDb`
 * adapts the real client to it. Firestore rule mirrored by the fake: in a transaction every read
 * happens before the first write.
 */
export interface DocSnapshotLike {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
export interface TxLike<Ref> {
  get(ref: Ref): Promise<DocSnapshotLike>;
  set(ref: Ref, data: Record<string, unknown>): void;
}
export interface FirestoreLike<Ref = unknown> {
  doc(path: string): Ref;
  runTransaction<T>(fn: (tx: TxLike<Ref>) => Promise<T>): Promise<T>;
}

export const COLLECTIONS = {
  budget: "budget",
  concurrency: "concurrency",
  ratelimit: "ratelimit",
  predictions: "predictions",
  uploads: "uploads",
} as const;

/** Firestore returns Timestamps for Date fields; the fake keeps Dates; old docs may hold numbers. */
export function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis(): number }).toMillis();
  }
  return 0;
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function slotsOf(data: Record<string, unknown> | undefined): Record<string, number> {
  const raw = data?.slots;
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const [id, expiresAt] of Object.entries(raw)) out[id] = toMillis(expiresAt);
  }
  return out;
}

export function createFirestoreUsageStore<Ref>(db: FirestoreLike<Ref>): UsageStore {
  const concurrencyRef = () => db.doc(`${COLLECTIONS.concurrency}/global`);

  return {
    async reserve(req) {
      const keys = budgetKeys(req);
      const reservationId = assertSafeId(req.reservationId, "reservation id");
      const passcodeRef = db.doc(`${COLLECTIONS.budget}/${keys.passcode}`);
      const siteRef = db.doc(`${COLLECTIONS.budget}/${keys.site}`);
      const slotsRef = concurrencyRef();
      // One transaction: passcode budget + site budget + concurrency slot, all or nothing.
      return db.runTransaction(async (tx) => {
        const [passcode, site, slots] = await Promise.all([tx.get(passcodeRef), tx.get(siteRef), tx.get(slotsRef)]);
        const state: BudgetState = {
          passcodeSpentMicroUsd: num(passcode.data()?.spentMicroUsd),
          siteSpentMicroUsd: num(site.data()?.spentMicroUsd),
          slots: slotsOf(slots.data()),
        };
        const decision = decideReserve(state, { ...req, reservationId });
        tx.set(slotsRef, { slots: decision.next.slots, updatedAt: new Date(req.now) });
        if (!decision.ok) return { ok: false as const, reason: decision.reason };
        // DP-10: the counters ride along in the same documents and the same transaction.
        const pc = countsOf(passcode.data());
        const sc = countsOf(site.data());
        tx.set(passcodeRef, {
          spentMicroUsd: decision.next.passcodeSpentMicroUsd,
          ...pc,
          submits: pc.submits + 1,
          limitMicroUsd: req.passcodeDailyMicroUsd,
          updatedAt: new Date(req.now),
        });
        tx.set(siteRef, {
          spentMicroUsd: decision.next.siteSpentMicroUsd,
          ...sc,
          submits: sc.submits + 1,
          limitMicroUsd: req.siteDailyMicroUsd,
          updatedAt: new Date(req.now),
        });
        return { ok: true as const };
      });
    },

    async release(reservationId, now) {
      const slotsRef = concurrencyRef();
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(slotsRef);
        tx.set(slotsRef, { slots: decideRelease(slotsOf(snap.data()), reservationId, now), updatedAt: new Date(now) });
      });
    },

    async hitRateLimit(hit) {
      assertSafeId(hit.ipHash, "ip hash");
      const { key, expireAt } = rateWindow(hit);
      const ref = db.doc(`${COLLECTIONS.ratelimit}/${key}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        const count = snap.exists && toMillis(data?.expireAt) > hit.now ? num(data?.count) : 0;
        const result = decideRate(count, hit);
        // `expireAt` is a Date so the TTL policy on ratelimit.expireAt can delete the document.
        tx.set(ref, { count: result.count, expireAt: new Date(expireAt) });
        return result;
      });
    },

    async peekRate(hit) {
      assertSafeId(hit.ipHash, "ip hash");
      const ref = db.doc(`${COLLECTIONS.ratelimit}/${rateWindow(hit).key}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        return snap.exists && toMillis(data?.expireAt) > hit.now ? num(data?.count) : 0;
      });
    },

    async bindPrediction(predictionId, info, expireAt) {
      const ref = db.doc(`${COLLECTIONS.predictions}/${predictionKey(predictionId)}`);
      const label = assertSafeId(info.passcodeLabel, "passcode label");
      return db.runTransaction(async (tx) => {
        tx.set(ref, {
          passcodeLabel: label,
          reservationId: info.reservationId,
          uploadDerived: info.uploadDerived,
          expireAt: new Date(expireAt),
        });
      });
    },

    async recordOutcome(passcodeLabel, ok, now, predictionId) {
      const keys = budgetKeys({ passcodeLabel, now });
      const passcodeRef = db.doc(`${COLLECTIONS.budget}/${keys.passcode}`);
      const siteRef = db.doc(`${COLLECTIONS.budget}/${keys.site}`);
      const predictionRef =
        predictionId === undefined ? null : db.doc(`${COLLECTIONS.predictions}/${predictionKey(predictionId)}`);
      return db.runTransaction(async (tx) => {
        const [prediction, passcode, site] = await Promise.all([
          predictionRef ? tx.get(predictionRef) : Promise.resolve(null),
          tx.get(passcodeRef),
          tx.get(siteRef),
        ]);
        if (prediction?.exists && prediction.data()?.outcome) return; // counted already
        if (predictionRef && prediction?.exists) tx.set(predictionRef, { ...prediction.data(), outcome: ok ? "ok" : "failed" });
        const field = ok ? "succeeded" : "failed";
        for (const [ref, snap] of [
          [passcodeRef, passcode],
          [siteRef, site],
        ] as const) {
          const data = snap.data() ?? {};
          const c = countsOf(data);
          tx.set(ref, { ...data, ...c, [field]: c[field] + 1, updatedAt: new Date(now) });
        }
      });
    },

    async predictionInfo(predictionId, now) {
      const ref = db.doc(`${COLLECTIONS.predictions}/${predictionKey(predictionId)}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!snap.exists || toMillis(data?.expireAt) <= now || typeof data?.passcodeLabel !== "string") return null;
        return {
          passcodeLabel: data.passcodeLabel,
          reservationId: typeof data.reservationId === "string" ? data.reservationId : null,
          uploadDerived: data.uploadDerived === true,
        };
      });
    },

    async markUploadDerived(urls, expireAt) {
      if (urls.length === 0) return;
      return db.runTransaction(async (tx) => {
        for (const url of urls) tx.set(db.doc(`${COLLECTIONS.uploads}/${urlKey(url)}`), { expireAt: new Date(expireAt) });
      });
    },

    async isUploadDerived(url, now) {
      const ref = db.doc(`${COLLECTIONS.uploads}/${urlKey(url)}`);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        return snap.exists && toMillis(snap.data()?.expireAt) > now;
      });
    },
  };
}

/**
 * Real client (stage 3). Uses the Cloud Run service account through Application Default
 * Credentials: no key file, no connection string. Never called by tests or in mock mode.
 */
export async function createFirestoreDb(projectId: string): Promise<FirestoreLike> {
  const { Firestore } = await import("@google-cloud/firestore");
  // The project is always explicit; nothing is inferred from the environment (see runtime.ts).
  const db = new Firestore({ projectId, databaseId: "(default)", ignoreUndefinedProperties: true });
  type Ref = ReturnType<typeof db.doc>;
  const adapted: FirestoreLike<Ref> = {
    doc: (path) => db.doc(path),
    runTransaction: (fn) =>
      db.runTransaction((tx) =>
        fn({
          get: (ref) => tx.get(ref),
          set: (ref, data) => {
            tx.set(ref, data);
          },
        }),
      ),
  };
  return adapted as FirestoreLike;
}
