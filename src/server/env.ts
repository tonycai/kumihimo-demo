import "server-only";

export interface ServerEnv {
  /** Atlas Cloud key. Only ever read here and passed to the live adapter. */
  apiKey: string | undefined;
  /** LIVE_MODE=on allows live mode; anything else (including unset) forces mock mode (DP-08). */
  liveModeOn: boolean;
  isDevelopment: boolean;
  /** Demo-mode delays × this (0.01–1). Only for fast E2E runs; never affects live mode. */
  mockDelayScale: number;
}

/** Read on every request so an env change on a new Cloud Run revision applies without a rebuild. */
export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const apiKey = source.ATLASCLOUD_API_KEY?.trim();
  return {
    apiKey: apiKey ? apiKey : undefined,
    liveModeOn: source.LIVE_MODE?.trim().toLowerCase() === "on",
    isDevelopment: source.NODE_ENV === "development",
    mockDelayScale: clampScale(Number(source.MOCK_DELAY_SCALE ?? "1")),
  };
}

function clampScale(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0.01, value)) : 1;
}
