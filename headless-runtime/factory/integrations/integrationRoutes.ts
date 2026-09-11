/**
 * integrations/integrationRoutes — Wave 14 T03 (Track B): R3-R4 handlers.
 *
 * Mirror of `factory/notifications/notificationRoutes.ts` and
 * `factory/definition/definitionRoutes.ts` (C5 additive): same response
 * envelope `{ok, data, ...}`, same honest codes (404/400/409/413/500 with
 * the historic shapes), zero business logic in `factoryServer.ts` (the
 * server only delegates one line per route via `routeTable` + `matchRoute`).
 * Every export is total toward the server (try/catch, never throws).
 * Globals only (no `/work-items` dual alias, like `notifications-list` and
 * `definition-status`). ESM only, zero `require()`.
 */

import type http from "node:http";
import {
  getLiveConfig,
  getStatus,
  postNotification,
} from "./integrationService";
import type { IntegrationsStatusData } from "./integrationService";
import { hasLiveCredentials } from "./vault";
import {
  handlePostBackBody,
  handleWebhookInBody,
} from "./intakeRoutes";
import { listMockPosts } from "./mockAdapter";
import type { MockPostRecord } from "./integrationTypes";

/** Cap of the request body for POST test-post (413 beyond it). */
export const INTEGRATION_TEST_POST_MAX_BODY_BYTES = 65536;

/** How many recent posts ride along the status payload (panel needs them). */
export const INTEGRATION_STATUS_POSTS_LIMIT = 20;

/**
 * True for GET /factory/integrations/status (mirror of
 * `isDefinitionStatusRoute`). Pure, never throws.
 */
export function isIntegrationsStatusRoute(method: unknown, pathname: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/integrations/status";
  } catch {
    return false;
  }
}

/**
 * True for POST /factory/integrations/test-post. Pure, never throws.
 */
export function isIntegrationsTestPostRoute(method: unknown, pathname: unknown): boolean {
  try {
    return method === "POST" && pathname === "/factory/integrations/test-post";
  } catch {
    return false;
  }
}

export interface IntegrationsStatusResponse {
  ok: true;
  data: IntegrationsStatusData & { posts: MockPostRecord[]; live: IntegrationsLiveView | null };
}

/**
 * Live snapshot for the status payload (F1-T3 wiring, read-only over the
 * service + vault gate). Booleans and the provider NAME only — secret
 * values never leave the vault (the view carries no credential). Never
 * throws (null when the live block is absent or unreadable).
 */
export interface IntegrationsLiveView {
  liveMode: boolean;
  provider: string;
  hasCredentials: boolean;
  allowPostBack: boolean;
  filterPresent: boolean;
}

export function buildLiveView(): IntegrationsLiveView | null {
  try {
    const cfg = getLiveConfig();
    if (!cfg.ok) return null;
    const live = cfg.live;
    let hasCredentials = false;
    try {
      hasCredentials = hasLiveCredentials(live);
    } catch {
      hasCredentials = false;
    }
    return {
      liveMode: live.liveMode === true,
      provider: typeof live.provider === "string" ? live.provider : "linear",
      hasCredentials,
      allowPostBack: live.allowPostBack === true,
      filterPresent: live.filter !== undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Payload of GET /factory/integrations/status (mirror of the
 * definition-status shape: status fields plus evidence). Never throws.
 */
export function buildIntegrationsStatusResponse(limit?: unknown): IntegrationsStatusResponse {
  try {
    const status = getStatus();
    let posts: MockPostRecord[] = [];
    try {
      posts = listMockPosts(
        typeof limit === "number" ? limit : INTEGRATION_STATUS_POSTS_LIMIT,
      );
    } catch {
      posts = [];
    }
    return { ok: true, data: { ...status, posts, live: buildLiveView() } };
  } catch {
    return {
      ok: true,
      data: {
        enabled: false,
        mode: "",
        provider: "",
        count: 0,
        lastPostAt: null,
        lastAckedAt: null,
        configError: "integrations status unavailable",
        posts: [],
        live: null,
      },
    };
  }
}

type ReadBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; code: 400 | 413; error: string };

/**
 * Reads a JSON body with a hard byte cap (event-driven, no polling, no
 * unbounded buffering). Never throws.
 */
function readJsonBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<ReadBodyResult> {
  return new Promise<ReadBodyResult>((resolve) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      const finish = (r: ReadBodyResult): void => {
        if (done) return;
        done = true;
        resolve(r);
      };
      req.on("data", (chunk: unknown) => {
        try {
          if (done) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ""));
          size += buf.length;
          if (size > maxBytes) {
            finish({ ok: false, code: 413, error: `body exceeds ${maxBytes} bytes` });
            try {
              req.pause();
            } catch {
              // noop
            }
            return;
          }
          chunks.push(buf);
        } catch {
          finish({ ok: false, code: 400, error: "unreadable request body" });
        }
      });
      req.on("end", () => {
        try {
          if (done) return;
          if (chunks.length === 0) {
            finish({ ok: true, body: {} });
            return;
          }
          const text = Buffer.concat(chunks).toString("utf-8");
          if (text.trim().length === 0) {
            finish({ ok: true, body: {} });
            return;
          }
          try {
            finish({ ok: true, body: JSON.parse(text) as unknown });
          } catch {
            finish({ ok: false, code: 400, error: "invalid JSON body" });
          }
        } catch {
          finish({ ok: false, code: 400, error: "unreadable request body" });
        }
      });
      req.on("error", () => {
        finish({ ok: false, code: 400, error: "unreadable request body" });
      });
    } catch {
      resolve({ ok: false, code: 400, error: "unreadable request body" });
    }
  });
}

/**
 * POST /factory/integrations/webhook-in handler (F1, live intake seam).
 * Body parsed by `intakeRoutes` (201 created, 200 continued/skipped,
 * 400 invalid, 409 live off). Never throws toward the server.
 */
export async function handleIntegrationsWebhookInRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const read = await readJsonBody(req, INTEGRATION_TEST_POST_MAX_BODY_BYTES);
    if (!read.ok) {
      res.writeHead(read.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: read.error }));
      return;
    }
    const out = await handleWebhookInBody(read.body);
    res.writeHead(out.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out.payload));
    return;
  } catch (e) {
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `failed to handle integration webhook: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
        }),
      );
    } catch {
      // last resort: headers already sent
    }
    return;
  }
}

/**
 * POST /factory/integrations/post-back handler (F1, terminal-state updates).
 * Body parsed by `intakeRoutes` (200 posted via live|mock, 400 invalid,
 * 409 post-back off, 500 honest failure past the attempt cap). Never
 * throws toward the server.
 */
export async function handleIntegrationsPostBackRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const read = await readJsonBody(req, INTEGRATION_TEST_POST_MAX_BODY_BYTES);
    if (!read.ok) {
      res.writeHead(read.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: read.error }));
      return;
    }
    const out = await handlePostBackBody(read.body);
    res.writeHead(out.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out.payload));
    return;
  } catch (e) {
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `failed to post integration update: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
        }),
      );
    } catch {
      // last resort: headers already sent
    }
    return;
  }
}
/**
 * GET /factory/integrations/status handler (R3, one-line delegation from
 * the server switch). Mirror of `handleDefinitionStatusRoute`. Never throws
 * toward the server (500 envelope on catastrophe).
 */
export async function handleIntegrationsStatusRoute(res: http.ServerResponse): Promise<void> {
  try {
    const payload = buildIntegrationsStatusResponse();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  } catch (e) {
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `failed to read integrations status: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
        }),
      );
    } catch {
      // last resort: headers already sent
    }
    return;
  }
}

/**
 * POST /factory/integrations/test-post handler (R4, mock only). Disabled
 * integrations refuse with an honest 409; bad input/mode refuse with 400.
 * Never throws toward the server.
 */
export async function handleIntegrationsTestPostRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const read = await readJsonBody(req, INTEGRATION_TEST_POST_MAX_BODY_BYTES);
    if (!read.ok) {
      res.writeHead(read.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: read.error }));
      return;
    }
    const result = postNotification(read.body);
    if (!result.ok) {
      res.writeHead(result.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, post: result.post }));
    return;
  } catch (e) {
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `failed to create integration test post: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
        }),
      );
    } catch {
      // last resort: headers already sent
    }
    return;
  }
}
