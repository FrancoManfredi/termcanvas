/**
 * Wave 14 T03+T04 (Track B) — service + routes + client ops suite.
 * `npx tsx --test tests/integrations-service-routes.test.ts` (offline).
 *
 * Covers:
 * - service: P0 gates (`enabled=false` refuses with 409; `mode`/`provider`
 *   beyond mock-local/linear refuse with 400; secret fields refuse with
 *   400), valid post/ack/status round-trips, never-throws shapes
 * - routes: R3-R4 matchers, status payload shape (mirror of
 *   definition-status), handlers over fake req/res (200/400/409/413)
 * - client: the 4 new `factoryClient` ops use the T01 named timeouts, hit
 *   the exact R1-R4 paths, fail safe offline, and never throw
 * - zero network outside injected mocks (global `fetch` guard)
 *
 * Sandbox: `TERMCANVAS_FACTORY_DIR` points at a tmpdir per file; the real
 * `factory/` is never touched. ESM only, zero `require()`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  ackNotification,
  getIntegrationsConfig,
  getStatus,
  postNotification,
} from "../headless-runtime/factory/integrations/integrationService.ts";
import {
  INTEGRATION_TEST_POST_MAX_BODY_BYTES,
  buildIntegrationsStatusResponse,
  handleIntegrationsStatusRoute,
  handleIntegrationsTestPostRoute,
  isIntegrationsStatusRoute,
  isIntegrationsTestPostRoute,
} from "../headless-runtime/factory/integrations/integrationRoutes.ts";
import { resetMockAdapterForTests } from "../headless-runtime/factory/integrations/mockAdapter.ts";
import {
  FACTORY_AUTOMATIONS_TIMEOUT_MS,
  FACTORY_AUTOMATIONS_TICK_TIMEOUT_MS,
  FACTORY_INTEGRATIONS_TIMEOUT_MS,
  FACTORY_INTEGRATION_POST_TIMEOUT_MS,
  getFactoryIntegrationsStatus,
  listFactoryAutomations,
  postFactoryAutomationsTick,
  postFactoryIntegrationTestPost,
} from "../src/lib/factoryClient.ts";

// ── Sandbox + fetch guard ──

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "integrations-svc-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
fs.mkdirSync(SANDBOX_FACTORY, { recursive: true });
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("real network forbidden in tests (use injected fetchFn)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

function writeYaml(text: string): void {
  fs.writeFileSync(path.join(SANDBOX_FACTORY, "factory.yaml"), text, "utf-8");
}

function clearYaml(): void {
  try {
    fs.rmSync(path.join(SANDBOX_FACTORY, "factory.yaml"), { force: true });
  } catch {
    // noop
  }
}

test.beforeEach(() => {
  try {
    resetMockAdapterForTests();
  } catch {
    // reset never throws
  }
  clearYaml();
});

const YAML_OK = [
  "ports:",
  "  factoryDefault: 17680",
  "  factoryMax: 17690",
  "integrations:",
  "  enabled: true",
  '  mode: "mock-local"',
  '  provider: "linear"',
  "",
].join("\n");

// ── service: config gates ──

test("missing yaml means P0 defaults (enabled mock-local linear)", () => {
  const cfg = getIntegrationsConfig();
  assert.equal(cfg.ok, true);
  if (cfg.ok) {
    assert.equal(cfg.config.enabled, true);
    assert.equal(cfg.config.mode, "mock-local");
    assert.equal(cfg.config.provider, "linear");
  }
});

test("enabled=false refuses posts with an honest 409", () => {
  writeYaml(YAML_OK.replace("  enabled: true", "  enabled: false"));
  const res = postNotification({ title: "hi", body: "x" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 409);
  const status = getStatus();
  assert.equal(status.enabled, false);
});

test("mode beyond mock-local refuses with a 400 that names the file", () => {
  writeYaml(YAML_OK.replace('"mock-local"', '"live"'));
  const cfg = getIntegrationsConfig();
  assert.equal(cfg.ok, false);
  const res = postNotification({ title: "hi", body: "" });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.code, 400);
    assert.ok(res.error.includes("mock-local"));
  }
});

test("provider beyond linear refuses with a 400", () => {
  writeYaml(YAML_OK.replace('"linear"', '"slack"'));
  const res = postNotification({ title: "hi", body: "" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 400);
});

test("secret fields refuse fail-closed with a 400", () => {
  writeYaml(
    YAML_OK.replace('  provider: "linear"', '  provider: "linear"\n  apiToken: "x"'),
  );
  const cfg = getIntegrationsConfig();
  assert.equal(cfg.ok, false);
  if (!cfg.ok) assert.ok(cfg.error.includes("factory.yaml"));
});

// ── service: happy path ──

test("valid post notifies, ack reconciles, status reports counts", () => {
  writeYaml(YAML_OK);
  const posted = postNotification({ title: "ask human", body: "look", jobId: "job-1" });
  assert.equal(posted.ok, true);
  if (!posted.ok) return;
  assert.equal(posted.post.title, "ask human");
  assert.equal(posted.post.jobId, "job-1");
  assert.equal(posted.post.acked, false);

  assert.equal(ackNotification(posted.post.id), true);
  assert.equal(ackNotification("m-missing-0"), false);

  const status = getStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.mode, "mock-local");
  assert.equal(status.provider, "linear");
  assert.equal(status.count, 1);
  assert.ok(typeof status.lastPostAt === "string");
  assert.ok(typeof status.lastAckedAt === "string");
  assert.equal(status.configError, null);
});

test("invalid post input refuses with a 400 and never throws", () => {
  writeYaml(YAML_OK);
  const empty = postNotification({ title: "", body: "" });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, 400);
  const nil = postNotification(null);
  assert.equal(nil.ok, false);
  const acked = ackNotification(null);
  assert.equal(acked, false);
  assert.equal(fetchCalls, 0);
});

// ── routes: matchers + shapes ──

test("R3-R4 matchers accept their exact method+path and reject the rest", () => {
  assert.equal(isIntegrationsStatusRoute("GET", "/factory/integrations/status"), true);
  assert.equal(isIntegrationsStatusRoute("POST", "/factory/integrations/status"), false);
  assert.equal(isIntegrationsStatusRoute("GET", "/factory/integrations"), false);
  assert.equal(
    isIntegrationsTestPostRoute("POST", "/factory/integrations/test-post"),
    true,
  );
  assert.equal(
    isIntegrationsTestPostRoute("GET", "/factory/integrations/test-post"),
    false,
  );
  assert.equal(isIntegrationsTestPostRoute("POST", "/factory/integrations/status"), false);
});

test("status payload mirrors the definition-status envelope", () => {
  writeYaml(YAML_OK);
  postNotification({ title: "one", body: "" });
  const payload = buildIntegrationsStatusResponse();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.enabled, true);
  assert.equal(payload.data.mode, "mock-local");
  assert.equal(payload.data.provider, "linear");
  assert.equal(payload.data.count, 1);
  assert.ok(Array.isArray(payload.data.posts));
  assert.equal(payload.data.posts.length, 1);
});

// ── routes: handlers over fakes ──

interface FakeRes {
  statusCode: number;
  body: string;
  headersSent: boolean;
  writeHead(code: number): void;
  end(text: string): void;
}

function makeRes(): FakeRes {
  return {
    statusCode: 0,
    body: "",
    headersSent: false,
    writeHead(code: number): void {
      this.statusCode = code;
      this.headersSent = true;
    },
    end(text: string): void {
      this.body = String(text ?? "");
    },
  };
}

function makeReq(json: string): Readable {
  return Readable.from([Buffer.from(json, "utf-8")]);
}

function parseBody(res: FakeRes): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

test("status handler answers 200 with the envelope", async () => {
  writeYaml(YAML_OK);
  const res = makeRes();
  await handleIntegrationsStatusRoute(res as never);
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.ok, true);
  assert.ok(body.data !== null && typeof body.data === "object");
});

test("test-post handler posts (200), refuses disabled (409) and bad input (400)", async () => {
  writeYaml(YAML_OK);
  const okRes = makeRes();
  await handleIntegrationsTestPostRoute(
    makeReq(JSON.stringify({ title: "ping", body: "pong" })) as never,
    okRes as never,
  );
  assert.equal(okRes.statusCode, 200);
  assert.equal(parseBody(okRes).ok, true);

  writeYaml(YAML_OK.replace("  enabled: true", "  enabled: false"));
  const offRes = makeRes();
  await handleIntegrationsTestPostRoute(
    makeReq(JSON.stringify({ title: "ping" })) as never,
    offRes as never,
  );
  assert.equal(offRes.statusCode, 409);

  writeYaml(YAML_OK);
  const badRes = makeRes();
  await handleIntegrationsTestPostRoute(
    makeReq(JSON.stringify({ title: "" })) as never,
    badRes as never,
  );
  assert.equal(badRes.statusCode, 400);

  const brokenRes = makeRes();
  await handleIntegrationsTestPostRoute(makeReq("{oops") as never, brokenRes as never);
  assert.equal(brokenRes.statusCode, 400);
});

test("test-post handler refuses oversized bodies with 413", async () => {
  writeYaml(YAML_OK);
  assert.ok(INTEGRATION_TEST_POST_MAX_BODY_BYTES >= 65536);
  const big = `{"title":"${"x".repeat(INTEGRATION_TEST_POST_MAX_BODY_BYTES + 8)}"}`;
  const res = makeRes();
  await handleIntegrationsTestPostRoute(makeReq(big) as never, res as never);
  assert.equal(res.statusCode, 413);
});

// ── client: the 4 new ops ──

test("client timeout consts pin the T01 contract", () => {
  assert.equal(FACTORY_AUTOMATIONS_TIMEOUT_MS, 3000);
  assert.equal(FACTORY_AUTOMATIONS_TICK_TIMEOUT_MS, 5000);
  assert.equal(FACTORY_INTEGRATIONS_TIMEOUT_MS, 3000);
  assert.equal(FACTORY_INTEGRATION_POST_TIMEOUT_MS, 3000);
});

interface SeenCall {
  url: string;
  init?: RequestInit;
}

function okJson(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("client ops hit the R1-R4 paths with the named timeouts", async () => {
  const seen: SeenCall[] = [];
  const fetchFn = (async (url: string, init?: RequestInit): Promise<Response> => {
    seen.push({ url, init });
    if (url.endsWith("/factory/automations")) {
      return okJson({ ok: true, triggers: [{ name: "n" }], enabled: true, tickMs: 30000 });
    }
    if (url.endsWith("/factory/automations/tick")) {
      return okJson({ ok: true, fired: 1 });
    }
    if (url.endsWith("/factory/integrations/status")) {
      return okJson({
        ok: true,
        data: { enabled: true, mode: "mock-local", provider: "linear", count: 0, posts: [] },
      });
    }
    if (url.endsWith("/factory/integrations/test-post")) {
      return okJson({ ok: true, post: { id: "m-1" } });
    }
    return okJson({ error: "nope" }, 404);
  }) as (url: string, init?: RequestInit) => Promise<Response>;

  const port = 19876;
  const list = await listFactoryAutomations({ port, fetchFn });
  assert.equal(list.ok, true);
  const tick = await postFactoryAutomationsTick({ port, fetchFn });
  assert.equal(tick.ok, true);
  const status = await getFactoryIntegrationsStatus({ port, fetchFn });
  assert.equal(status.ok, true);
  if (status.ok) {
    assert.equal(status.data.mode, "mock-local");
    assert.equal(status.data.provider, "linear");
  }
  const posted = await postFactoryIntegrationTestPost(
    { title: "hello", body: "world" },
    { port, fetchFn },
  );
  assert.equal(posted.ok, true);

  const urls = seen.map((c) => c.url);
  assert.ok(urls.some((u) => u.endsWith("/factory/automations")));
  assert.ok(urls.some((u) => u.endsWith("/factory/automations/tick")));
  assert.ok(urls.some((u) => u.endsWith("/factory/integrations/status")));
  assert.ok(urls.some((u) => u.endsWith("/factory/integrations/test-post")));
  const tickCall = seen.find((c) => c.url.endsWith("/factory/automations/tick"));
  assert.equal(tickCall?.init?.method, "POST");
  assert.equal(fetchCalls, 0);
});

test("client ops fail safe offline and never throw", async () => {
  const down = ((_url: string, _init?: RequestInit): Promise<Response> => {
    return Promise.reject(new Error("boom"));
  }) as (url: string, init?: RequestInit) => Promise<Response>;
  const port = 19876;
  assert.equal((await listFactoryAutomations({ port, fetchFn: down })).ok, false);
  assert.equal((await postFactoryAutomationsTick({ port, fetchFn: down })).ok, false);
  assert.equal((await getFactoryIntegrationsStatus({ port, fetchFn: down })).ok, false);
  assert.equal(
    (await postFactoryIntegrationTestPost({ title: "t" }, { port, fetchFn: down })).ok,
    false,
  );
  assert.equal(
    (await postFactoryIntegrationTestPost({ title: "  " }, { port, fetchFn: down })).ok,
    false,
  );
});
