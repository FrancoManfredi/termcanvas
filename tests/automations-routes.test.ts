/**
 * Wave 14 T02 (Track A) — automationRoutes R1-R2 handlers.
 * node:test + tsx, offline, sandbox factory dir (TERMCANVAS_FACTORY_DIR).
 * Covers route predicates (exact match, method, traversal rejection),
 * the list payload mirror, and the manual tick handler.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "auto-routes-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

import {
  AUTOMATIONS_LIST_PATH,
  AUTOMATIONS_TICK_PATH,
  buildListResponse,
  handleAutomationsListRoute,
  handleAutomationsTickRoute,
  isAutomationsListRoute,
  isAutomationsRoute,
  isAutomationsTickRoute,
  tick,
} from "../headless-runtime/factory/automations/automationRoutes.ts";
import {
  resetAutomationServiceForTests,
  setAutomationsConfigForTests,
  type AutomationsConfig,
} from "../headless-runtime/factory/automations/automationService.ts";
import { resetAutomationStoreForTests } from "../headless-runtime/factory/automations/automationStore.ts";

function freshSandbox(): void {
  try {
    fs.rmSync(SANDBOX_FACTORY, { recursive: true, force: true });
  } catch {
    // first run: nothing to clear
  }
  resetAutomationStoreForTests();
  resetAutomationServiceForTests();
}

function twoTriggerCfg(): AutomationsConfig {
  return {
    enabled: true,
    tickMs: 30000,
    triggers: [
      {
        kind: "schedule",
        name: "nightly",
        enabled: true,
        maxFires: 5,
        cooldownMs: 3600000,
        intervalMs: 86400000,
        promptRef: "factory/prompts/nightly.md",
      },
      {
        kind: "event",
        name: "announce",
        enabled: true,
        maxFires: 20,
        cooldownMs: 60000,
        on: "ask_human",
        action: "notify-integration",
      },
    ],
  };
}

test("route constants match the route table rows R1-R2", { timeout: 15000 }, () => {
  assert.equal(AUTOMATIONS_LIST_PATH, "/factory/automations");
  assert.equal(AUTOMATIONS_TICK_PATH, "/factory/automations/tick");
});

test("R1 predicate matches exactly (method plus path)", { timeout: 15000 }, () => {
  assert.equal(isAutomationsListRoute("GET", "/factory/automations"), true);
  assert.equal(isAutomationsListRoute("POST", "/factory/automations"), false);
  assert.equal(isAutomationsListRoute("GET", "/factory/automations/tick"), false);
  assert.equal(isAutomationsListRoute("GET", "/factory/automations/evil"), false);
  assert.equal(isAutomationsListRoute("GET", "/factory/automations/../jobs"), false);
  assert.equal(isAutomationsListRoute(null, "/factory/automations"), false);
});

test("R2 predicate matches exactly (method plus path)", { timeout: 15000 }, () => {
  assert.equal(isAutomationsTickRoute("POST", "/factory/automations/tick"), true);
  assert.equal(isAutomationsTickRoute("GET", "/factory/automations/tick"), false);
  assert.equal(isAutomationsTickRoute("POST", "/factory/automations"), false);
  assert.equal(isAutomationsTickRoute("POST", "/factory/automations/tick/extra"), false);
  assert.equal(isAutomationsTickRoute("POST", "/factory/automations/tick%2f.."), false);
});

test("combined predicate covers both routes and nothing else", { timeout: 15000 }, () => {
  assert.equal(isAutomationsRoute("GET", "/factory/automations"), true);
  assert.equal(isAutomationsRoute("POST", "/factory/automations/tick"), true);
  assert.equal(isAutomationsRoute("GET", "/factory/notifications"), false);
  assert.equal(isAutomationsRoute("GET", "/factory/definition/status"), false);
  assert.equal(isAutomationsRoute("POST", "/factory/jobs"), false);
});

test("list response mirrors the notifications-list envelope", { timeout: 15000 }, () => {
  freshSandbox();
  setAutomationsConfigForTests(twoTriggerCfg());
  const res = buildListResponse();
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.enabled, true);
  assert.equal(res.data.tickMs, 30000);
  assert.equal(res.data.triggers.length, 2);
  assert.deepEqual(
    res.data.triggers.map((t) => t.trigger.name),
    ["nightly", "announce"],
  );
  assert.ok(Array.isArray(res.data.recent));
  res.data.triggers.forEach((t) => {
    assert.equal(typeof t.state.fires, "number");
    assert.ok(t.state.lastFireAt === null || typeof t.state.lastFireAt === "string");
  });
});

test("list response degrades honestly when disabled", { timeout: 15000 }, () => {
  freshSandbox();
  setAutomationsConfigForTests({ ...twoTriggerCfg(), enabled: false });
  const res = buildListResponse();
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.enabled, false);
  assert.equal(res.data.triggers.length, 2);
});

test("list response never throws and always carries the envelope", { timeout: 15000 }, () => {
  freshSandbox();
  const res = buildListResponse();
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(typeof res.data.enabled, "boolean");
    assert.equal(typeof res.data.tickMs, "number");
  }
});

test("manual tick runs one bounded pass and reports", { timeout: 15000 }, () => {
  freshSandbox();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "auto-tick-"));
  setAutomationsConfigForTests({
    enabled: true,
    tickMs: 0,
    triggers: [
      {
        kind: "schedule",
        name: "nightly",
        enabled: true,
        maxFires: 5,
        cooldownMs: 0,
        intervalMs: 1000,
        promptRef: "factory/prompts/nightly.md",
      },
    ],
  });
  const res = tick(Date.UTC(2026, 8, 5, 3, 0, 0), { worktree });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.fired, 1);
  assert.equal(res.data.fires[0]?.result, "created");
});

test("manual tick on a disabled center fires nothing but stays ok", { timeout: 15000 }, () => {
  freshSandbox();
  setAutomationsConfigForTests({ ...twoTriggerCfg(), enabled: false });
  const res = tick(Date.UTC(2026, 8, 5, 3, 0, 0));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.data.fired, 0);
});

interface FakeRes {
  statusCode: number;
  body: string;
  writeHead(code: number): void;
  end(text: string): void;
}

function makeRes(): FakeRes {
  return {
    statusCode: 0,
    body: "",
    writeHead(code: number): void {
      this.statusCode = code;
    },
    end(text: string): void {
      this.body = String(text ?? "");
    },
  };
}

function parseBody(res: FakeRes): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

test("list handler answers 200 with the {ok,data} envelope", { timeout: 15000 }, async () => {
  freshSandbox();
  setAutomationsConfigForTests(twoTriggerCfg());
  const res = makeRes();
  await handleAutomationsListRoute(res as never);
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.ok, true);
  const data = body.data as Record<string, unknown>;
  assert.equal(data.enabled, true);
  assert.equal(data.tickMs, 30000);
  assert.equal((data.triggers as unknown[]).length, 2);
  assert.ok(Array.isArray(data.recent));
});

test("tick handler answers 200 with the {ok,data} envelope via (req,res)", { timeout: 15000 }, async () => {
  freshSandbox();
  setAutomationsConfigForTests({ ...twoTriggerCfg(), enabled: false });
  const res = makeRes();
  await handleAutomationsTickRoute({} as never, res as never);
  assert.equal(res.statusCode, 200);
  const body = parseBody(res);
  assert.equal(body.ok, true);
  const data = body.data as Record<string, unknown>;
  assert.equal(data.fired, 0);
});

test("tick handler tolerates single-arg (res) shorthand and never throws", { timeout: 15000 }, async () => {
  freshSandbox();
  setAutomationsConfigForTests({ ...twoTriggerCfg(), enabled: false });
  const res = makeRes();
  await handleAutomationsTickRoute(res as never);
  assert.equal(res.statusCode, 200);
  assert.equal(parseBody(res).ok, true);
  await handleAutomationsListRoute(null as never);
  await handleAutomationsTickRoute(null as never, null as never);
});
