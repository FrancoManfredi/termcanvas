import { MatchersV3 } from "@pact-foundation/pact";

/**
 * Re-export Pact MatchersV3 plus playground-specific helpers.
 * Keeps consumer specs DRY and ensures regexes are consistent across Fs.
 */

export const { like, integer, regex, eachLike, decimal, boolean } = MatchersV3;

export { MatchersV3 };

/**
 * ISO-8601 UTC with milliseconds, e.g. 2026-05-13T14:22:10.123Z
 * Simple calendar-agnostic, sufficient for contract.
 */
export const ISO8601 = regex(
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
  "2026-05-13T14:22:10.123Z",
);

/**
 * Generic ISO-8601 flexible (any valid T...Z)
 */
export const ISO8601_FLEX = regex(
  "^\\d{4}-\\d{2}-\\d{2}T.*Z$",
  "2026-05-13T14:22:10.123Z",
);

/**
 * Windows path for job dir: e.g. C:\tmp\playground-F02-abc\.agents\factory\job-...
 */
export const windowsPathRegex = regex(
  "^[A-Z]:\\\\.*\\.agents\\\\factory\\\\job-.*",
  "C:\\tmp\\playground-F02-abc123\\.agents\\factory\\job-m4n5o6p7",
);

/**
 * Job id format: job-<alphanumeric+dash>
 */
export const jobIdRegex = regex("^job-[a-z0-9\\-]+$", "job-m4n5o6p7-q8r9");

/**
 * Helper to build a content-type application/json matcher tolerant to charset.
 */
export function jsonContentTypeMatcher() {
  return regex("application/json;?.*", "application/json");
}
