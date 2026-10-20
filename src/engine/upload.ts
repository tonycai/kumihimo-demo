/** Upload limits (ND-06): checked in the browser before any request, and again on the server. */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type UploadProblem = "too-large" | "bad-type" | "empty";

export function checkUpload(file: { size: number; type: string }): UploadProblem | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return "bad-type";
  if (file.size === 0) return "empty";
  if (file.size > MAX_UPLOAD_BYTES) return "too-large";
  return null;
}
