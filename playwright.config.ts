import { defineConfig, devices, type Project } from "@playwright/test";

/**
 * E2E never reaches Atlas (CLAUDE.md). The server gets a fake key and a test-only passcode so the
 * sign-in flow can be exercised; no test runs a graph while signed in, and every spec asserts that
 * /api/atlas/* is never called during demo runs.
 */
const PORT = 3071;
/** Test-only values for this suite (not a real passcode; the hash is what the server holds). */
export const E2E_PASSCODE = "e2e-only-passcode-2c61d202a17b6755172bd641";
const E2E_PASSCODES = JSON.stringify([
  { label: "e2e", sha256: "8fde1ed3c54a5be0c820d35a8e322a241bd2a170a9eaa8b094a077d3906ba70b", expiresAt: "2099-01-01T00:00:00Z", dailyBudgetUsd: 0.01 },
]);

/**
 * PF-07 numbers (`pnpm perf`): the installed Google Chrome in a visible window, at the MacBook's
 * Retina pixel ratio. Only listed when asked for, so `pnpm e2e` never opens a window.
 */
const perfProject: Project = {
  name: "perf",
  testMatch: /perf\.spec\.ts/,
  use: {
    channel: "chrome",
    headless: false,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    // Trace recording snapshots the DOM after every action and screencasts frames: with it on,
    // even 11 nodes measured 30 fps. Measurements run without it.
    trace: "off",
    video: "off",
    screenshot: "off",
    // The built-in display is the main one (origin 0,0). A window on an external screen follows
    // that screen's refresh rate: on a 30 Hz monitor every frame measures 33 ms whatever the page does.
    launchOptions: { args: ["--window-position=0,0"] },
  },
};

/**
 * The README's demo GIF (`KUMIHIMO_DEMO=1 playwright test --project=demo`, then scripts/make-demo-gif.sh):
 * the same visible window as perf, recorded as video, with demo delays at half the real pace.
 */
const demoProject: Project = {
  name: "demo",
  testMatch: /demo\.spec\.ts/,
  use: { ...perfProject.use, video: { mode: "on", size: { width: 1440, height: 900 } } },
};

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /(perf|demo)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    ...(process.env.KUMIHIMO_PERF === "1" ? [perfProject] : []),
    ...(process.env.KUMIHIMO_DEMO === "1" ? [demoProject] : []),
  ],
  webServer: {
    // The standalone server is what the Cloud Run image runs (stage 3); static assets are copied
    // next to it the same way.
    command: [
      "pnpm build",
      "cp -R public .next/standalone/",
      "cp -R .next/static .next/standalone/.next/",
      "node .next/standalone/server.js",
    ].join(" && "),
    url: `http://127.0.0.1:${PORT}/api/mode`,
    reuseExistingServer: false,
    timeout: 240_000,
    // Shorter demo delays keep the suite quick; live mode is forced off.
    env: {
      MOCK_DELAY_SCALE: process.env.KUMIHIMO_DEMO === "1" ? "0.5" : "0.25",
      // The README recording shows the demo as it is presented: live mode off, no passcode button.
      LIVE_MODE: process.env.KUMIHIMO_DEMO === "1" ? "off" : "on",
      ATLASCLOUD_API_KEY: "e2e-fake-key-never-valid",
      KUMIHIMO_PASSCODES: E2E_PASSCODES,
      KUMIHIMO_SESSION_SECRET: "e2e-session-secret-not-used-anywhere-else",
      KUMIHIMO_IP_SALT: "e2e-ip-salt-0000",
      // Counters stay in memory: never a real Firestore, and no ambient Google project or credentials.
      KUMIHIMO_FIRESTORE_PROJECT: "",
      GOOGLE_CLOUD_PROJECT: "",
      GCLOUD_PROJECT: "",
      GOOGLE_APPLICATION_CREDENTIALS: "/dev/null",
      HOSTNAME: "127.0.0.1",
      PORT: String(PORT),
    },
  },
});
