/**
 * factory/dependencies/depsRoutes — pure matchers for the dependencies domain.
 *
 * Two exact global routes (same shape as definition-status, no alias):
 * GET /factory/dependencies/status and POST
 * /factory/dependencies/pr-agent/install. Zero imports (string ops only),
 * never throws (match object or null).
 */

/** Match ok (the caller answers; unknown jobs get an honest 404 there). */
export interface DepsRouteOk {
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
 * GET /factory/dependencies/status — machine-global tool status for the
 * Dependencies section. Non-null only on the exact shape.
 */
export function parseDependenciesStatusPath(
  method: unknown,
  pathname: unknown,
): DepsRouteOk | null {
  try {
    return splitExact(method, pathname, "GET", "/factory/dependencies/status")
      ? { ok: true }
      : null;
  } catch {
    return null;
  }
}

/**
 * POST /factory/dependencies/pr-agent/install — explicit human install
 * action (never automatic). Non-null only on the exact shape.
 */
export function parseDependenciesInstallPath(
  method: unknown,
  pathname: unknown,
): DepsRouteOk | null {
  try {
    return splitExact(method, pathname, "POST", "/factory/dependencies/pr-agent/install")
      ? { ok: true }
      : null;
  } catch {
    return null;
  }
}
