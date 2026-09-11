/**
 * integrations/intakeRoutes — F1-T3 wiring: webhook-in + post-back bodies.
 *
 * Pure body layer over `integrationService` (C5 additive): the two new F1
 * routes translate a parsed JSON body into a `{status, payload}` value and
 * never throw toward the server. The HTTP envelope (body cap, status codes,
 * `{ok, ...}` shapes) stays in `integrationRoutes.ts`, which calls these
 * bodies; `factoryServer.ts` keeps one delegation line per route via
 * `routeTable` + `matchRoute`.
 *
 * - `handleWebhookInBody` accepts an `IntakeEvent` body: 201 created,
 *   200 continued | skipped-dedupe | skipped-filter, 400 invalid event,
 *   409 live intake off (mock-local intact, zero jobs).
 * - `handlePostBackBody` accepts a `PostBack` body: 200 posted (live
 *   remoteId or mock-local record), 400 invalid input, 409 post-back off,
 *   500 honest failure after the capped attempts.
 *
 * Bounds: zero loops, zero timers, zero network in this file (the attempt
 * cap lives in `liveAdapter`, the dedupe ring in the service — see LOOPS
 * L-IN-01/L-IN-02). ESM only, zero `require()`.
 */

import {
  handleIntakeEvent,
  postBackToThread,
} from "./integrationService";

/** One route-body outcome: HTTP status plus the JSON payload to send. */
export interface IntakeBodyResult {
  readonly status: number;
  readonly payload: Record<string, unknown>;
}

function bodyError(e: unknown): string {
  try {
    return e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
  } catch {
    return "intake body failed";
  }
}

/**
 * Webhook-in body: `event -> created | continued | skipped-* | honest refuse`.
 * Never throws (every failure is a `{status, payload}` value).
 */
export async function handleWebhookInBody(body: unknown): Promise<IntakeBodyResult> {
  try {
    const result = await handleIntakeEvent(body);
    if (!result.ok) {
      return { status: result.code, payload: { error: result.error } };
    }
    return {
      status: result.outcome === "created" ? 201 : 200,
      payload: {
        ok: true,
        outcome: result.outcome,
        jobId: result.jobId,
        explain: result.explain,
      },
    };
  } catch (e) {
    return { status: 500, payload: { error: bodyError(e) } };
  }
}

/**
 * Post-back body: `post-back -> posted (live | mock) | honest refuse`.
 * Never throws (every failure is a `{status, payload}` value).
 */
export async function handlePostBackBody(body: unknown): Promise<IntakeBodyResult> {
  try {
    const result = await postBackToThread(body);
    if (!result.ok) {
      return {
        status: result.code,
        payload: { error: result.error, attempts: result.attempts },
      };
    }
    return {
      status: 200,
      payload: {
        ok: true,
        via: result.via,
        remoteId: result.remoteId,
        note: result.note,
        attempts: result.attempts,
      },
    };
  } catch (e) {
    return { status: 500, payload: { error: bodyError(e), attempts: 0 } };
  }
}
