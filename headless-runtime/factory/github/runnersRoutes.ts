/**
 * factory/github/runnersRoutes — pure matchers for the runners domain.
 *
 * One exact global route (same shape as dependencies-status, no alias):
 * GET /factory/github/runners/status (query: repo=owner/name, folder?).
 * Read-only on purpose: installs are manual (step-by-step guide in the
 * Dependencies panel). Zero imports (string ops only), never throws
 * (match object or null).
 */

/** Match ok (the caller answers; unknown paths get an honest 404 there). */
export interface RunnersRouteOk {
  readonly ok: true;
}

function splitExact(
  method: unknown,
  pathname: unknown,
  expectedMethod: string,
  exact: string,
): boolean {
  try {
    if (method !== expectedMethod) return false;
    return pathname === exact;
  } catch {
    return false;
  }
}

/**
 * GET /factory/github/runners/status — this PC + registered runners for
 * the repo. Non-null only on the exact shape.
 */
export function parseRunnersStatusPath(
  method: unknown,
  pathname: unknown,
): RunnersRouteOk | null {
  try {
    return splitExact(method, pathname, "GET", "/factory/github/runners/status")
      ? { ok: true }
      : null;
  } catch {
    return null;
  }
}
