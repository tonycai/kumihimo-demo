import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as liveChat } from "@/app/api/atlas/chat/route";
import { POST as liveImage } from "@/app/api/atlas/generate-image/route";
import { POST as liveVideo } from "@/app/api/atlas/generate-video/route";
import { GET as livePrediction } from "@/app/api/atlas/prediction/[id]/route";
import { POST as liveUpload } from "@/app/api/atlas/upload/route";
import { GET as getMode } from "@/app/api/mode/route";
import { DELETE as logout, POST as login } from "@/app/api/session/route";
import { modelsFor } from "@/atlas/models";
import { issueSession, SESSION_COOKIE } from "@/server/session";
import { setUsageStoreForTests } from "@/server/usage/runtime";
import { jstDay } from "@/server/usage/rules";
import { createMemoryUsageStore } from "@/server/usage/store";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const BASE = "http://127.0.0.1";
const PASSCODE = "correct-horse-battery-staple-0123";
const OTHER = "another-long-random-passcode-4567";
const SECRET = "s".repeat(40);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const t2i = modelsFor("textToImage")[0];
const upscaler = modelsFor("imageTool").find((m) => m.hostedByAtlas)!;
const otherTool = modelsFor("imageTool").find((m) => !m.hostedByAtlas)!;
const video = modelsFor("imageToVideo")[0];
const llm = modelsFor("llm")[0];

function liveEnv(extra: Record<string, string> = {}) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LIVE_MODE", "on");
  vi.stubEnv("ATLASCLOUD_API_KEY", "fake-key-for-tests-0123456789");
  vi.stubEnv("KUMIHIMO_SESSION_SECRET", SECRET);
  vi.stubEnv("KUMIHIMO_IP_SALT", "salt-for-tests-0123");
  vi.stubEnv(
    "KUMIHIMO_PASSCODES",
    JSON.stringify([
      { label: "atlas", sha256: sha(PASSCODE), expiresAt: "2099-01-01T00:00:00Z", dailyBudgetUsd: 3 },
      { label: "tony", sha256: sha(OTHER), expiresAt: "2099-01-01T00:00:00Z", dailyBudgetUsd: 3 },
      { label: "old", sha256: sha("an-expired-passcode-0000000"), expiresAt: "2020-01-01T00:00:00Z", dailyBudgetUsd: 1 },
    ]),
  );
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

const cookieFor = (label: string) =>
  `${SESSION_COOKIE}=${issueSession({ label, expiresAt: Date.now() + 3_600_000 }, SECRET)}`;

function req(path: string, init: { body?: unknown; cookie?: string; ip?: string; method?: string; form?: FormData } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": init.ip ?? "203.0.113.7" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${BASE}${path}`, {
    method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const pngForm = () => {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array(100)], "a.png", { type: "image/png" }));
  return fd;
};

/** Fake Atlas: submissions get ids, predictions complete with a URL, uploads return a URL. */
function fakeAtlas() {
  let n = 0;
  const calls: string[] = [];
  const fetchSpy = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/uploadMedia")) return Response.json({ url: "https://files.atlas.test/u.png" });
    if (u.includes("/prediction/")) {
      return Response.json({ data: { status: "completed", outputs: [`https://cdn.atlas.test/${u.split("/").pop()}.png`] } });
    }
    if (u.endsWith("/chat/completions")) return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    return Response.json({ data: { id: `pred-${++n}` } });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return { fetchSpy, calls };
}

beforeEach(() => setUsageStoreForTests(createMemoryUsageStore()));

describe("live endpoints without a session (DP-01)", () => {
  it("all five return 401 and nothing reaches Atlas", async () => {
    liveEnv();
    const { fetchSpy } = fakeAtlas();
    const results = await Promise.all([
      liveChat(req("/api/atlas/chat", { body: { model: llm.id, prompt: "x" } })),
      liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "x" } })),
      liveVideo(req("/api/atlas/generate-video", { body: { model: video.id, image: "https://x.test/a.png", prompt: "x" } })),
      liveUpload(req("/api/atlas/upload", { form: pngForm() })),
      livePrediction(req("/api/atlas/prediction/pred-1") as never, params("pred-1")),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forged or foreign cookies do not count", async () => {
    liveEnv();
    const { fetchSpy } = fakeAtlas();
    const forged = `${SESSION_COOKIE}=${issueSession({ label: "atlas", expiresAt: Date.now() + 1e6 }, "x".repeat(40))}`;
    const unknownLabel = cookieFor("nobody");
    const expiredPasscode = cookieFor("old");
    for (const cookie of [forged, unknownLabel, expiredPasscode, `${SESSION_COOKIE}=garbage`]) {
      expect((await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "x" }, cookie }))).status).toBe(401);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the emergency switch closes live mode even with a session (DP-08)", async () => {
    liveEnv({ LIVE_MODE: "off" });
    const { fetchSpy } = fakeAtlas();
    const res = await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "x" }, cookie: cookieFor("atlas") }));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    const mode = await (await getMode(req("/api/mode", { cookie: cookieFor("atlas") }))).json();
    expect(mode).toMatchObject({ mode: "mock", reason: "live_mode_off", signedIn: true });
  });
});

describe("passcode login (DP-01, DP-03)", () => {
  it("issues an HttpOnly session for the right passcode and reports live mode", async () => {
    liveEnv();
    const res = await login(req("/api/session", { body: { passcode: PASSCODE } }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).not.toContain(PASSCODE);
    const cookie = setCookie.split(";")[0];
    expect(await (await getMode(req("/api/mode", { cookie }))).json()).toMatchObject({ mode: "live", reason: "live", signedIn: true });
    const out = await logout();
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("refuses expired passcodes with a pointer to demo mode", async () => {
    liveEnv();
    const res = await login(req("/api/session", { body: { passcode: "an-expired-passcode-0000000" } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toMatch(/expired.*demo/i);
  });

  it("the 6th wrong attempt in a minute is 429, even with a forged X-Forwarded-For", async () => {
    liveEnv();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      // The client controls everything left of the last hop; the front end appends the real address.
      const ip = `10.0.0.${i}, 198.51.100.9`;
      statuses.push((await login(req("/api/session", { body: { passcode: `wrong-guess-${i}` }, ip }))).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429]);
    // Even the right passcode waits out the window from that address.
    expect((await login(req("/api/session", { body: { passcode: PASSCODE }, ip: "198.51.100.9" }))).status).toBe(429);
  });
});

describe("budgets, concurrency and rate limits (DP-03, DP-04)", () => {
  it("refuses the submission that would exceed the passcode budget, other passcodes unaffected", async () => {
    liveEnv({
      KUMIHIMO_PASSCODES: JSON.stringify([
        { label: "atlas", sha256: sha(PASSCODE), expiresAt: "2099-01-01T00:00:00Z", dailyBudgetUsd: 0.006 },
        { label: "tony", sha256: sha(OTHER), expiresAt: "2099-01-01T00:00:00Z", dailyBudgetUsd: 3 },
      ]),
    });
    const { calls } = fakeAtlas();
    const body = { model: t2i.id, prompt: "x" };
    expect((await liveImage(req("/api/atlas/generate-image", { body, cookie: cookieFor("atlas") }))).status).toBe(200);
    const second = await liveImage(req("/api/atlas/generate-image", { body, cookie: cookieFor("atlas") }));
    expect(second.status).toBe(429);
    expect((await second.json()).error.code).toBe("budget_exhausted");
    expect(calls.filter((c) => c.endsWith("/generateImage"))).toHaveLength(1);
    expect((await liveImage(req("/api/atlas/generate-image", { body, cookie: cookieFor("tony"), ip: "203.0.113.8" }))).status).toBe(200);
  });

  it("caps global concurrency across sessions; a finished prediction frees its slot", async () => {
    liveEnv({ KUMIHIMO_MAX_CONCURRENT: "1" });
    const { calls } = fakeAtlas();
    const body = { model: t2i.id, prompt: "x" };
    const first = await (await liveImage(req("/api/atlas/generate-image", { body, cookie: cookieFor("atlas") }))).json();
    expect((await liveImage(req("/api/atlas/generate-image", { body, cookie: cookieFor("tony"), ip: "203.0.113.8" }))).status).toBe(429);
    // Polling it to completion releases the slot.
    expect((await livePrediction(req(`/api/atlas/prediction/${first.id}`, { cookie: cookieFor("atlas") }) as never, params(first.id))).status).toBe(200);
    expect((await liveImage(req("/api/atlas/generate-image", { body, cookie: cookieFor("tony"), ip: "203.0.113.8" }))).status).toBe(200);
    expect(calls.filter((c) => c.endsWith("/generateImage"))).toHaveLength(2);
  });

  it("the 11th submission from one address in a minute is 429", async () => {
    liveEnv({ KUMIHIMO_MAX_CONCURRENT: "10" });
    fakeAtlas();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: `x${i}` }, cookie: cookieFor("atlas") }))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("streams chat and frees the slot when the stream ends", async () => {
    liveEnv({ KUMIHIMO_MAX_CONCURRENT: "1" });
    fakeAtlas();
    const res = await liveChat(req("/api/atlas/chat", { body: { model: llm.id, prompt: "crane" }, cookie: cookieFor("atlas") }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("[DONE]");
    await new Promise((r) => setTimeout(r, 0));
    expect((await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "x" }, cookie: cookieFor("atlas") }))).status).toBe(200);
  });
});

describe("prediction ownership", () => {
  it("another passcode gets 404 and Atlas is not asked", async () => {
    liveEnv();
    const { calls } = fakeAtlas();
    const { id } = await (await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "x" }, cookie: cookieFor("atlas") }))).json();
    const foreign = await livePrediction(req(`/api/atlas/prediction/${id}`, { cookie: cookieFor("tony") }) as never, params(id));
    expect(foreign.status).toBe(404);
    const unknown = await livePrediction(req("/api/atlas/prediction/never-made", { cookie: cookieFor("atlas") }) as never, params("never-made"));
    expect(unknown.status).toBe(404);
    expect(calls.filter((c) => c.includes("/prediction/"))).toHaveLength(0);
  });
});

describe("upload rule on the server", () => {
  it("refuses upload → video and upload → upscale → video; lets the Atlas-run upscaler take uploads", async () => {
    liveEnv();
    const { calls } = fakeAtlas();
    const cookie = cookieFor("atlas");
    const { url } = await (await liveUpload(req("/api/atlas/upload", { form: pngForm(), cookie }))).json();
    expect(url).toBe("https://files.atlas.test/u.png");

    const direct = await liveVideo(req("/api/atlas/generate-video", { body: { model: video.id, image: url, prompt: "x" }, cookie }));
    expect(direct.status).toBe(403);
    expect((await direct.json()).error.code).toBe("upload_not_allowed");
    expect((await liveImage(req("/api/atlas/generate-image", { body: { model: otherTool.id, image: url }, cookie }))).status).toBe(403);

    const up = await liveImage(req("/api/atlas/generate-image", { body: { model: upscaler.id, image: url }, cookie }));
    expect(up.status).toBe(200);
    const { id } = await up.json();
    const done = await (await livePrediction(req(`/api/atlas/prediction/${id}`, { cookie }) as never, params(id))).json();
    const upscaled = done.outputs[0];

    const indirect = await liveVideo(req("/api/atlas/generate-video", { body: { model: video.id, image: upscaled, prompt: "x" }, cookie }));
    expect(indirect.status).toBe(403);
    expect(calls.filter((c) => c.endsWith("/generateVideo"))).toHaveLength(0);

    // A generated (not uploaded) image still goes to video.
    const fresh = await liveVideo(req("/api/atlas/generate-video", { body: { model: video.id, image: "https://cdn.atlas.test/t2i.png", prompt: "x" }, cookie }));
    expect(fresh.status).toBe(200);
  });
});

describe("request validation on live routes (DP-05)", () => {
  it("rejects unknown models, extra fields, malformed and oversized bodies; nothing reaches Atlas", async () => {
    liveEnv();
    const { fetchSpy } = fakeAtlas();
    const cookie = cookieFor("atlas");
    const raw = (body: string) => {
      const r = req("/api/atlas/generate-image", { cookie });
      return new Request(r.url, { method: "POST", headers: r.headers, body });
    };
    const statuses = [
      (await liveImage(req("/api/atlas/generate-image", { body: { model: "x/y", prompt: "hi" }, cookie }))).status,
      (await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "hi", mode: "live" }, cookie }))).status,
      (await liveImage(raw("{not json"))).status,
      (await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "" }, cookie }))).status,
      (await liveImage(req("/api/atlas/generate-image", { body: { model: "x/y", prompt: "a".repeat(20_000) }, cookie }))).status,
    ];
    expect(statuses).toEqual([400, 400, 400, 400, 413]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("usage counts and alert events (DP-10)", () => {
  const today = (label: string) => `${jstDay(Date.now())}_${label}`;
  const events = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('"event"'));

  it("counts submissions and successes per passcode; polling again does not count twice", async () => {
    const store = createMemoryUsageStore();
    setUsageStoreForTests(store);
    liveEnv({ KUMIHIMO_MAX_CONCURRENT: "5" });
    fakeAtlas();
    const { id } = await (await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "x" }, cookie: cookieFor("atlas") }))).json();
    for (let i = 0; i < 2; i++) {
      expect((await livePrediction(req(`/api/atlas/prediction/${id}`, { cookie: cookieFor("atlas") }) as never, params(id))).status).toBe(200);
    }
    const chat = await liveChat(req("/api/atlas/chat", { body: { model: llm.id, prompt: "x" }, cookie: cookieFor("atlas") }));
    await chat.text(); // the stream ends normally
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.counts[today("atlas")]).toMatchObject({ submits: 2, succeeded: 2, failed: 0, limitMicroUsd: 3_000_000 });
    expect(store.state.counts[today("site")]).toMatchObject({ submits: 2, succeeded: 2 });
    expect(store.state.counts[today("tony")]).toBeUndefined();
  });

  it("logs upstream_402, budget_exhausted and passcode_rate_limited, with nothing else in the line", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    liveEnv({
      KUMIHIMO_PASSCODES: JSON.stringify([
        { label: "atlas", sha256: sha(PASSCODE), expiresAt: "2099-01-01T00:00:00Z", dailyBudgetUsd: 3 },
        { label: "tony", sha256: sha(OTHER), expiresAt: "2099-01-01T00:00:00Z", dailyBudgetUsd: 0.000001 },
      ]),
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 402, message: "Insufficient balance" }, { status: 402 })));
    expect((await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "x" }, cookie: cookieFor("atlas") }))).status).toBe(402);
    expect((await liveImage(req("/api/atlas/generate-image", { body: { model: t2i.id, prompt: "x" }, cookie: cookieFor("tony"), ip: "203.0.113.9" }))).status).toBe(429);
    for (let i = 0; i < 6; i++) await login(req("/api/session", { body: { passcode: `wrong-${i}` }, ip: "198.51.100.4" }));
    expect(events(log)).toEqual([
      JSON.stringify({ severity: "INFO", event: "upstream_402" }),
      JSON.stringify({ severity: "INFO", event: "budget_exhausted" }),
      JSON.stringify({ severity: "INFO", event: "passcode_rate_limited" }),
    ]);
    log.mockRestore();
  });
});
