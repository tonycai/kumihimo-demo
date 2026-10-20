/**
 * How long Atlas keeps generated outputs, as shown to visitors (AT-08). Follows the
 * X-AtlasCloud-Object-Expiration-Hours value in `src/atlas/live.ts` (24 hours; Atlas's
 * default without the header is 14 days, https://www.atlascloud.ai/docs/data-retention, checked
 * 2026-10-17). The privacy notice says the same.
 */
export const ATLAS_OUTPUT_RETENTION = "24 hours";
