/**
 * automations/automationRoutes — Wave 14 T02 (Track A): handlers R1-R2.
 *
 * Thin delegation surface for the daemon shell (T04 wires the two cases in
 * factoryServer via routeTable domains automations-list / automations-tick):
 * pure route predicates plus fail-safe builders. Shapes mirror
 * notifications-list (same envelope style: {ok, data} with the payload
 * nested, additive over the legacy bare-payload GETs).
 *
 * - R1 GET /factory/automations → {ok, data: {enabled, tickMs, triggers,
 *   recent}} (triggers pair each definition with its live runtime state).
 * - R2 POST /factory/automations/tick → {ok, data: TickReport} (one bounded
 *   manual pass; used by tests, the ticker-manual path and the future UI
 *   button; never schedules anything).
 *
 * No dual /work-items alias (global routes, like notifications-list and
 * definition-status). ESM only, zero require(). Every export never throws.
 */

import type http from "node:http";
import {
  getEffectiveAutomationsConfig,
  tickOnce,
  type AutomationsConfig,
  type AutomationDeps,
  type TickReport,
} from "./automationService";
import {
  getState,
  listRecentFires,
} from "./automationStore";
import type {
  AutomationFireRecord,
  TriggerRuntimeState,
} from "./automationTypes";

export const AUTOMATIONS_LIST_PATH = "/factory/automations";
export const AUTOMATIONS_TICK_PATH = "/factory/automations/tick";

/** True for R1 GET /factory/automations (exact, len 2). Pure, never throws. */
export function isAutomationsListRoute(method: unknown, pathname: unknown): boolean {
  try {
    return method === "GET" && pathname === AUTOMATIONS_LIST_PATH;
  } catch {
    return false;
  }
}

/** True for R2 POST /factory/automations/tick (exact, len 3). Pure, never throws. */
export function isAutomationsTickRoute(method: unknown, pathname: unknown): boolean {
  try {
    return method === "POST" && pathname === AUTOMATIONS_TICK_PATH;
  } catch {
    return false;
  }
}

/** True for either automations route (R1 or R2). Pure, never throws. */
export function isAutomationsRoute(method: unknown, pathname: unknown): boolean {
  try {
    return isAutomationsListRoute(method, pathname) || isAutomationsTickRoute(method, pathname);
  } catch {
    return false;
  }
}

export interface AutomationsTriggerView {
  readonly trigger: AutomationsConfig["triggers"][number];
  readonly state: TriggerRuntimeState;
}

export interface AutomationsListData {
  readonly enabled: boolean;
  readonly tickMs: number;
  readonly triggers: AutomationsTriggerView[];
  readonly recent: AutomationFireRecord[];
}

export type AutomationsListResponse =
  | { readonly ok: true; readonly data: AutomationsListData }
  | { readonly ok: false; readonly error: string };

export type AutomationsTickResponse =
  | { readonly ok: true; readonly data: TickReport }
  | { readonly ok: false; readonly error: string };

/**
 * Payload for R1 (mirror of buildNotificationsResponse: flags plus store
 * read, center-off degrades to empty rather than throwing). Never throws.
 */
export function buildListResponse(): AutomationsListResponse {
  try {
    const cfg = getEffectiveAutomationsConfig();
    const triggers: AutomationsTriggerView[] = cfg.triggers.map((trigger) => {
      try {
        return { trigger, state: getState(trigger.name) };
      } catch {
        return {
          trigger,
          state: {
            fires: 0,
            lastFireAt: null,
            lastEventId: null,
            nextTickAt: null,
            disabledReason: null,
          } satisfies TriggerRuntimeState,
        };
      }
    });
    let recent: AutomationFireRecord[] = [];
    try {
      recent = listRecentFires(20);
    } catch {
      recent = [];
    }
    return {
      ok: true,
      data: {
        enabled: cfg.enabled === true,
        tickMs: cfg.tickMs,
        triggers,
        recent,
      },
    };
  } catch {
    return { ok: false, error: "failed to list automations" };
  }
}

/**
 * Runs R2: one bounded manual tick (same single pass as the ticker, never
 * arms a timer). Never throws.
 */
export function tick(nowMs?: number, deps?: AutomationDeps): AutomationsTickResponse {
  try {
    const report = tickOnce(nowMs, deps);
    return { ok: true, data: report };
  } catch {
    return { ok: false, error: "failed to tick automations" };
  }
}

/**
 * R1 handler GET /factory/automations (domain automations-list, one-line
 * delegation from the server switch). Mirror of
 * `handleIntegrationsStatusRoute`: thin wrapper over `buildListResponse`,
 * zero duplicated logic. Never throws toward the server (500 envelope on
 * catastrophe).
 */
export async function handleAutomationsListRoute(res: http.ServerResponse): Promise<void> {
  try {
    const payload = buildListResponse();
    if (!payload.ok) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: payload.error }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  } catch (e) {
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `failed to list automations: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
        }),
      );
    } catch {
      // last resort: headers already sent
    }
    return;
  }
}

/**
 * R2 handler POST /factory/automations/tick (domain automations-tick,
 * one-line delegation from the server switch). Mirror of
 * `handleIntegrationsTestPostRoute` in form: thin wrapper over `tick()`
 * (one bounded manual pass with default clock and deps; the body-less tick
 * needs no request body, so `req` is accepted and ignored for delegation
 * symmetry). Never throws toward the server (500 envelope on catastrophe).
 *
 * Signature is `(req, res)` per DESIGN §4.3 delegation
 * `handleAutomationsTickRoute(req, res)`; it also tolerates the single-arg
 * shorthand `handleAutomationsTickRoute(res)` by treating a missing `res`
 * as the response.
 */
export async function handleAutomationsTickRoute(
  req: http.IncomingMessage | http.ServerResponse,
  res?: http.ServerResponse,
): Promise<void> {
  try {
    const actualRes = (res ?? req) as http.ServerResponse;
    const payload = tick();
    if (!payload.ok) {
      actualRes.writeHead(500, { "Content-Type": "application/json" });
      actualRes.end(JSON.stringify({ error: payload.error }));
      return;
    }
    actualRes.writeHead(200, { "Content-Type": "application/json" });
    actualRes.end(JSON.stringify(payload));
    return;
  } catch (e) {
    try {
      const actualRes = (res ?? req) as http.ServerResponse;
      actualRes.writeHead(500, { "Content-Type": "application/json" });
      actualRes.end(
        JSON.stringify({
          error: `failed to tick automations: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
        }),
      );
    } catch {
      // last resort: headers already sent
    }
    return;
  }
}
