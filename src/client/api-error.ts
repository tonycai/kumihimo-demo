import type { ApiErrorCode } from "@/atlas/types";

/** An error from our own API, or from the in-browser demo adapter in the same shape. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | "network",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
