import { afterEach, describe, expect, it, vi } from "vitest";

const createFirestoreDb = vi.fn();
vi.mock("./firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./firestore")>()),
  createFirestoreDb: (...args: unknown[]) => createFirestoreDb(...args),
}));

const { firestoreProject, setUsageStoreForTests, sharedStoreAvailable, usageStore } = await import("./runtime");

afterEach(() => {
  setUsageStoreForTests(null);
  createFirestoreDb.mockReset();
});

describe("usage store selection never uses ambient Google credentials", () => {
  it("a production build without KUMIHIMO_FIRESTORE_PROJECT stays in memory, whatever GOOGLE_CLOUD_PROJECT says", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "some-other-project");
    vi.stubEnv("KUMIHIMO_FIRESTORE_PROJECT", "");
    const store = await usageStore();
    expect(createFirestoreDb).not.toHaveBeenCalled();
    expect(await store.hitRateLimit({ bucket: "demo", ipHash: "abc", windowMs: 60_000, limit: 1, now: 0 })).toEqual({
      allowed: true,
      count: 1,
    });
    // ...and live mode refuses to run on per-instance counters.
    expect(sharedStoreAvailable()).toBe(false);
  });

  it("uses exactly the project it is told to", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KUMIHIMO_FIRESTORE_PROJECT", "solanalink-kumihimo");
    createFirestoreDb.mockResolvedValue({ doc: () => "", runTransaction: async () => null });
    await usageStore();
    expect(createFirestoreDb).toHaveBeenCalledWith("solanalink-kumihimo");
    expect(sharedStoreAvailable()).toBe(true);
  });

  it("ignores malformed project ids", () => {
    vi.stubEnv("KUMIHIMO_FIRESTORE_PROJECT", "Bad Project!");
    expect(firestoreProject()).toBeNull();
  });
});
