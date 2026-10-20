import { describe, expect, it } from "vitest";

import { readLiveConfig } from "./config";
import { readServerEnv } from "./env";
import { sessionFor } from "./live-gate";
import { liveAdapter, modeForRequest, resolveMode } from "./mode";

const noSession = { valid: false };

describe("readServerEnv", () => {
  it("treats only LIVE_MODE=on as on and ignores blank keys", () => {
    expect(readServerEnv({ NODE_ENV: "production" }).liveModeOn).toBe(false);
    expect(readServerEnv({ NODE_ENV: "production", LIVE_MODE: "ON " }).liveModeOn).toBe(true);
    expect(readServerEnv({ NODE_ENV: "production", LIVE_MODE: "true" }).liveModeOn).toBe(false);
    expect(readServerEnv({ NODE_ENV: "production", ATLASCLOUD_API_KEY: "  " }).apiKey).toBe(
      undefined,
    );
  });
});

describe("resolveMode", () => {
  const key = "test-key-not-real";

  it("defaults to mock when nothing is configured (DM-04)", () => {
    expect(resolveMode(readServerEnv({ NODE_ENV: "development" }), noSession)).toEqual({
      mode: "mock",
      reason: "live_mode_off",
      signedIn: false,
    });
  });

  it("emergency switch wins even with a key and a session (DP-08)", () => {
    const env = readServerEnv({ NODE_ENV: "production", ATLASCLOUD_API_KEY: key, LIVE_MODE: "off" });
    expect(resolveMode(env, { valid: true })).toEqual({ mode: "mock", reason: "live_mode_off", signedIn: true });
  });

  it("needs a key", () => {
    const env = readServerEnv({ NODE_ENV: "development", LIVE_MODE: "on" });
    expect(resolveMode(env, noSession)).toMatchObject({ mode: "mock", reason: "no_api_key" });
  });

  it("is live only with a passcode session", () => {
    const env = readServerEnv({ NODE_ENV: "production", ATLASCLOUD_API_KEY: key, LIVE_MODE: "on" });
    expect(resolveMode(env, noSession)).toEqual({ mode: "mock", reason: "no_session", signedIn: false });
    expect(resolveMode(env, { valid: true })).toEqual({ mode: "live", reason: "live", signedIn: true });
  });

  it("hands out the live adapter only with a key", () => {
    const env = readServerEnv({ NODE_ENV: "development", ATLASCLOUD_API_KEY: key, LIVE_MODE: "on" });
    expect(liveAdapter(env).mode).toBe("live");
    expect(() => liveAdapter(readServerEnv({ NODE_ENV: "development" }))).toThrow();
  });

  it("tells the in-browser demo how fast results arrive", () => {
    const env = readServerEnv({ NODE_ENV: "production", MOCK_DELAY_SCALE: "0.25" });
    expect(modeForRequest(new Request("http://127.0.0.1/"), env)).toMatchObject({ mode: "mock", demoDelayScale: 0.25 });
  });
});

describe("sessionFor (local AT-03 path)", () => {
  const request = new Request("http://127.0.0.1/");
  const key = "test-key-not-real";

  it("lets next dev with no passcodes configured act as signed in", () => {
    const env = readServerEnv({ NODE_ENV: "development", ATLASCLOUD_API_KEY: key, LIVE_MODE: "on" });
    expect(sessionFor(request, env, readLiveConfig({}), 0)?.label).toBe("dev");
  });

  it("never does so in production, nor once passcodes exist", () => {
    const prod = readServerEnv({ NODE_ENV: "production", ATLASCLOUD_API_KEY: key, LIVE_MODE: "on" });
    expect(sessionFor(request, prod, readLiveConfig({}), 0)).toBeNull();
    const dev = readServerEnv({ NODE_ENV: "development", ATLASCLOUD_API_KEY: key, LIVE_MODE: "on" });
    const withPasscodes = readLiveConfig({
      KUMIHIMO_PASSCODES: JSON.stringify([{ label: "atlas", sha256: "a".repeat(64), expiresAt: "2099-01-01T00:00:00Z", dailyBudgetUsd: 3 }]),
    });
    expect(sessionFor(request, dev, withPasscodes, 0)).toBeNull();
  });
});
