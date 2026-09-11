/**
 * Wave 14 T02 (Track A) — automationService bounded effects.
 * node:test + tsx, offline, sandbox factory dir (TERMCANVAS_FACTORY_DIR).
 * Covers kill-switches (3 levels of 0 = off), quota/cooldown/dedupe,
 * triggerRef evidence, pact-id refusal, and the single-ticker lifecycle.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "auto-svc-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

import {
  fireEvent,
  getEffectiveAutomationsConfig,
  isAutomationTickerRunning,
  isPactAutomationId,
  resetAutomationServiceForTests,
  setAutomationsConfigForTests,
  setDefaultAutomationDeps,
  startAutomationTicker,
  stopAutomationTicker,
  tickOnce,
  type AutomationsConfig,
  type AutomationDeps,
} from "../headless-runtime/factory/automations/automationService.ts";
import {
  appendFire,
  readFires,
  resetAutomationStoreForTests,
} from "../headless-runtime/factory/automations/automationStore.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

const T0 = Date.UTC(2026, 8, 5, 3, 0, 0);

function freshSandbox(): void {
  try {
    fs.rmSync(SANDBOX_FACTORY, { recursive: true, force: true });
  } catch {
    // first run: nothing to clear
  }
  resetAutomationStoreForTests();
  resetAutomationServiceForTests();
}

function scheduleCfg(
  over: Partial<AutomationsConfig> = {},
  triggerOver: Record<string, unknown> = {},
): AutomationsConfig {
  return {
    enabled: true,
    tickMs: 30000,
    triggers: [
      {
        kind: "schedule",
        name: "nightly",
        enabled: true,
        maxFires: 5,
        cooldownMs: 0,
        intervalMs: 1000,
        promptRef: "factory/prompts/nightly.md",
        ...triggerOver,
      },
    ],
    ...over,
  };
}

function fakeDeps(over: Partial<AutomationDeps> = {}): AutomationDeps {
  const calls: Array<{ prompt: string; worktree: string }> = [];
  return {
    worktree: fs.mkdtempSync(path.join(os.tmpdir(), "auto-job-")),
    createJob: (input) => {
      calls.push({ prompt: input.prompt, worktree: input.worktree });
      (fakeDeps as unknown as Record<string, unknown>).lastCalls = calls;
      return { ok: true, jobId: `job-fake-${calls.length}` };
    },
    notifyTrigger: () => {},
    postIntegration: () => ({ ok: true, id: "mock-post-1" }),
    ...over,
  };
}

test("global kill-switch stops all ticks", { timeout: 15000 }, () => {
  freshSandbox();
  setAutomationsConfigForTests(scheduleCfg({ enabled: false }));
  const report = tickOnce(T0, fakeDeps());
  assert.equal(report.fired, 0);
  assert.equal(report.skipped[0]?.reason, "global-disabled");
  assert.equal(readFires().length, 0);
});

test("per-trigger off switch skips only that trigger", { timeout: 15000 }, () => {
  freshSandbox();
  setAutomationsConfigForTests(scheduleCfg({}, { enabled: false }));
  const report = tickOnce(T0, fakeDeps());
  assert.equal(report.fired, 0);
  assert.equal(report.skipped[0]?.reason, "trigger-disabled");
});

test("maxFires 0 never fires and never calls the job creator", { timeout: 15000 }, () => {
  freshSandbox();
  let called = 0;
  const deps = fakeDeps({ createJob: () => {
    called += 1;
    return { ok: true, jobId: "job-fake-1" };
  } });
  setAutomationsConfigForTests(scheduleCfg({}, { maxFires: 0 }));
  const report = tickOnce(T0, deps);
  assert.equal(report.fired, 0);
  assert.equal(report.skipped[0]?.reason, "quota");
  assert.equal(called, 0);
});

test("quota exhausts after maxFires and then skips", { timeout: 15000 }, () => {
  freshSandbox();
  const at = new Date(T0 - 10000).toISOString();
  appendFire({
    triggerName: "nightly",
    kind: "schedule",
    at,
    action: "create-job",
    jobId: "job-old-1",
    eventId: null,
    result: "created",
  });
  appendFire({
    triggerName: "nightly",
    kind: "schedule",
    at,
    action: "create-job",
    jobId: "job-old-2",
    eventId: null,
    result: "created",
  });
  setAutomationsConfigForTests(scheduleCfg({}, { maxFires: 2 }));
  const report = tickOnce(T0 + 60000, fakeDeps());
  assert.equal(report.fired, 0);
  assert.equal(report.skipped[0]?.reason, "quota");
});

test("cooldown blocks a due schedule trigger", { timeout: 15000 }, () => {
  freshSandbox();
  const at = new Date(T0 - 1000).toISOString();
  appendFire({
    triggerName: "nightly",
    kind: "schedule",
    at,
    action: "create-job",
    jobId: "job-old-1",
    eventId: null,
    result: "created",
  });
  setAutomationsConfigForTests(scheduleCfg({}, { intervalMs: 1000, cooldownMs: 3600000 }));
  const report = tickOnce(T0, fakeDeps());
  assert.equal(report.fired, 0);
  assert.equal(report.skipped[0]?.reason, "cooldown");
});

test("schedule happy path creates one job, notifies and records evidence", { timeout: 15000 }, () => {
  freshSandbox();
  let notified = 0;
  const deps = fakeDeps({ notifyTrigger: () => {
    notified += 1;
  } });
  setAutomationsConfigForTests(scheduleCfg());
  const report = tickOnce(T0, deps);
  assert.equal(report.fired, 1);
  assert.equal(notified, 1);
  assert.equal(report.fires[0]?.result, "created");
  assert.equal(report.fires[0]?.jobId, "job-fake-1");
  assert.equal(readFires().length, 1);
});

test("created job carries triggerRef in its timeline", { timeout: 15000 }, () => {
  freshSandbox();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "auto-real-"));
  setAutomationsConfigForTests(scheduleCfg());
  const report = tickOnce(T0, { worktree });
  assert.equal(report.fired, 1);
  const jobId = report.fires[0]?.jobId;
  assert.ok(typeof jobId === "string" && jobId.length > 0);
  const item = workItemStore.get(jobId as string);
  assert.ok(item);
  const ref = (item?.timeline ?? []).find((e) => e.message.includes("trigger-fired nightly"));
  assert.ok(ref);
  const meta = (ref as unknown as { meta?: Record<string, unknown> }).meta as
    | { triggerRef?: { triggerName?: string; firedAt?: string; eventId?: null } }
    | undefined;
  assert.equal(meta?.triggerRef?.triggerName, "nightly");
  assert.equal(typeof meta?.triggerRef?.firedAt, "string");
});

test("pact-id chaining is refused and recorded", { timeout: 15000 }, () => {
  freshSandbox();
  assert.equal(isPactAutomationId("job-abc123"), true);
  assert.equal(isPactAutomationId("job-f04-cancel01"), true);
  assert.equal(isPactAutomationId("job-auto-xyz"), false);
  let called = 0;
  const deps = fakeDeps({ createJob: () => {
    called += 1;
    return { ok: true, jobId: "job-fake-1" };
  } });
  setAutomationsConfigForTests({
    enabled: true,
    tickMs: 30000,
    triggers: [
      {
        kind: "event",
        name: "chain",
        enabled: true,
        maxFires: 5,
        cooldownMs: 0,
        on: "job-complete",
        action: "create-job",
        promptRef: "factory/prompts/chain.md",
      },
    ],
  });
  const report = fireEvent({ id: "evt-pact-1", kind: "job-complete", jobId: "job-abc123" }, T0, deps);
  assert.equal(report.fired, 1);
  assert.equal(called, 0);
  assert.equal(report.fires[0]?.result, "skipped-quota");
  assert.ok((report.fires[0]?.note ?? "").includes("pact-id rejected"));
});

test("event dedupe fires once per source event id", { timeout: 15000 }, () => {
  freshSandbox();
  let posts = 0;
  const deps = fakeDeps({ postIntegration: () => {
    posts += 1;
    return { ok: true, id: `mock-${posts}` };
  } });
  setAutomationsConfigForTests({
    enabled: true,
    tickMs: 30000,
    triggers: [
      {
        kind: "event",
        name: "announce",
        enabled: true,
        maxFires: 20,
        cooldownMs: 0,
        on: "ask_human",
        action: "notify-integration",
      },
    ],
  });
  const first = fireEvent({ id: "evt-dedupe-1", kind: "ask_human" }, T0, deps);
  assert.equal(first.fired, 1);
  assert.equal(first.dedupe, false);
  assert.equal(first.fires[0]?.result, "notified");
  const second = fireEvent({ id: "evt-dedupe-1", kind: "ask_human" }, T0 + 1000, deps);
  assert.equal(second.fired, 0);
  assert.equal(second.dedupe, true);
  assert.equal(posts, 1);
});

test("event create-job records the event id", { timeout: 15000 }, () => {
  freshSandbox();
  setAutomationsConfigForTests({
    enabled: true,
    tickMs: 30000,
    triggers: [
      {
        kind: "event",
        name: "chain",
        enabled: true,
        maxFires: 5,
        cooldownMs: 0,
        on: "job-complete",
        action: "create-job",
        promptRef: "factory/prompts/chain.md",
      },
    ],
  });
  const report = fireEvent({ id: "evt-chain-9", kind: "job-complete", jobId: "job-real-1" }, T0, fakeDeps());
  assert.equal(report.fired, 1);
  assert.equal(report.fires[0]?.eventId, "evt-chain-9");
  assert.equal(report.fires[0]?.result, "created");
});

test("invalid events are rejected without effects", { timeout: 15000 }, () => {
  freshSandbox();
  setAutomationsConfigForTests(scheduleCfg());
  const bad = fireEvent({ id: "", kind: "ask_human" }, T0, fakeDeps());
  assert.equal(bad.ok, false);
  assert.equal(bad.fired, 0);
  const unknown = fireEvent({ id: "e1", kind: "webhook-in" }, T0, fakeDeps());
  assert.equal(unknown.ok, false);
});

test("tickMs 0 equals ticker fully off; positive tickMs arms one timer", { timeout: 15000 }, () => {
  freshSandbox();
  try {
    setAutomationsConfigForTests(scheduleCfg({ tickMs: 0 }));
    assert.equal(startAutomationTicker(), false);
    assert.equal(isAutomationTickerRunning(), false);
    setAutomationsConfigForTests(scheduleCfg({ tickMs: 50 }));
    assert.equal(startAutomationTicker(), true);
    assert.equal(isAutomationTickerRunning(), true);
    assert.equal(startAutomationTicker(), true);
    assert.equal(isAutomationTickerRunning(), true);
    assert.equal(stopAutomationTicker(), true);
    assert.equal(isAutomationTickerRunning(), false);
    assert.equal(stopAutomationTicker(), false);
  } finally {
    stopAutomationTicker();
    resetAutomationServiceForTests();
  }
});

test("yaml fallback degrades to safe defaults (no triggers)", { timeout: 15000 }, () => {
  freshSandbox();
  const cfg = getEffectiveAutomationsConfig();
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.triggers, []);
});

test("module default deps seam composes without per-call deps", { timeout: 15000 }, () => {
  freshSandbox();
  let created = 0;
  setDefaultAutomationDeps(fakeDeps({ createJob: () => {
    created += 1;
    return { ok: true, jobId: "job-seam-1" };
  } }));
  try {
    setAutomationsConfigForTests(scheduleCfg());
    const report = tickOnce(T0);
    assert.equal(report.fired, 1);
    assert.equal(created, 1);
  } finally {
    resetAutomationServiceForTests();
  }
});
