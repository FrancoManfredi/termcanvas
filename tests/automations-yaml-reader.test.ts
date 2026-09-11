/**
 * D18 loader fix — fresh automations yaml reader (offline, no daemon).
 * `npx tsx --test tests/automations-yaml-reader.test.ts`
 *
 * Proves the daemon no longer depends on the cached getFactoryConfig for
 * triggers (REPORT-D18-followup5-gap.md §2): the effective config is read
 * FRESH from the `automations:` block of factory.yaml on every call, in a
 * sandbox factory dir (TERMCANVAS_FACTORY_DIR). Covers: example yaml
 * triggers parse, disk rewrite visible with no reset (the D18 regression),
 * tickOnce with a due yaml trigger creating one job through mock deps,
 * the three kill-switches via yaml (enabled:false, maxFires:0, tickMs:0),
 * pact-id refusal via a yaml event trigger, and fail-safe defaults on
 * missing/malformed yaml. ESM only, zero require().
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "auto-yaml-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

import {
  fireEvent,
  getEffectiveAutomationsConfig,
  isAutomationTickerRunning,
  parseAutomationsBlock,
  parseAutomationsYamlText,
  resetAutomationServiceForTests,
  sliceAutomationsSection,
  startAutomationTicker,
  stopAutomationTicker,
  tickOnce,
  type AutomationDeps,
} from "../headless-runtime/factory/automations/automationService.ts";
import {
  readFires,
  resetAutomationStoreForTests,
} from "../headless-runtime/factory/automations/automationStore.ts";

const T0 = Date.UTC(2026, 8, 5, 3, 0, 0);

const DUE_SCHEDULE_YAML = [
  "# sandbox factory (D18 probe, never the real factory.yaml)",
  "ports:",
  "  factoryDefault: 17680",
  "automations:",
  "  enabled: true",
  "  tickMs: 30000",
  "  triggers:",
  '    - name: "yaml-due"',
  '      kind: "schedule"',
  "      enabled: true",
  "      intervalMs: 1000",
  '      promptRef: "factory/prompts/nightly.md"',
  "      maxFires: 5",
  "      cooldownMs: 0",
  "integrations:",
  "  enabled: true",
  "",
].join("\n");

function freshSandbox(): void {
  try {
    fs.rmSync(SANDBOX_FACTORY, { recursive: true, force: true });
  } catch {
    // first run: nothing to clear
  }
  resetAutomationStoreForTests();
  resetAutomationServiceForTests();
}

function writeYaml(text: string): void {
  fs.mkdirSync(SANDBOX_FACTORY, { recursive: true });
  fs.writeFileSync(path.join(SANDBOX_FACTORY, "factory.yaml"), text, "utf-8");
}

function mockDeps(): { deps: AutomationDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: AutomationDeps = {
    worktree: fs.mkdtempSync(path.join(os.tmpdir(), "auto-yaml-job-")),
    createJob: (input) => {
      calls.push(input.prompt);
      return { ok: true, jobId: `job-yaml-${calls.length}` };
    },
    notifyTrigger: () => {},
    postIntegration: () => ({ ok: true, id: "mock-post-1" }),
  };
  return { deps, calls };
}

test("example yaml triggers parse (slice + block + schema)", { timeout: 15000 }, () => {
  const lines = sliceAutomationsSection(DUE_SCHEDULE_YAML);
  assert.ok(lines.length > 0);
  const block = parseAutomationsBlock(lines);
  assert.equal(block.malformed, false);
  assert.equal(block.triggers.length, 1);
  assert.equal(block.triggers[0]?.name, "yaml-due");
  const cfg = parseAutomationsYamlText(DUE_SCHEDULE_YAML);
  assert.ok(cfg !== null);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.tickMs, 30000);
  assert.equal(cfg.triggers.length, 1);
  assert.equal(cfg.triggers[0]?.name, "yaml-due");
});

test("effective config reads the yaml block fresh from disk", { timeout: 15000 }, () => {
  freshSandbox();
  writeYaml(DUE_SCHEDULE_YAML);
  const cfg = getEffectiveAutomationsConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.triggers.length, 1);
  assert.equal(cfg.triggers[0]?.name, "yaml-due");
});

test("disk rewrites are visible on the next read with no reset (D18 regression)", { timeout: 15000 }, () => {
  freshSandbox();
  writeYaml(DUE_SCHEDULE_YAML);
  assert.equal(getEffectiveAutomationsConfig().triggers[0]?.name, "yaml-due");
  writeYaml(DUE_SCHEDULE_YAML.replaceAll("yaml-due", "yaml-due-v2"));
  const cfg = getEffectiveAutomationsConfig();
  assert.equal(cfg.triggers.length, 1);
  assert.equal(cfg.triggers[0]?.name, "yaml-due-v2");
});

test("tickOnce with a due yaml trigger creates one job through mock deps", { timeout: 15000 }, () => {
  freshSandbox();
  writeYaml(DUE_SCHEDULE_YAML);
  const { deps, calls } = mockDeps();
  const report = tickOnce(T0, deps);
  assert.equal(report.fired, 1);
  assert.equal(calls.length, 1);
  assert.equal(report.fires[0]?.result, "created");
  assert.equal(report.fires[0]?.jobId, "job-yaml-1");
  assert.equal(readFires().length, 1);
});

test("yaml enabled:false stops the tick (global-disabled, zero jobs)", { timeout: 15000 }, () => {
  freshSandbox();
  writeYaml(DUE_SCHEDULE_YAML.replace("  enabled: true", "  enabled: false"));
  const { deps, calls } = mockDeps();
  const report = tickOnce(T0, deps);
  assert.equal(report.fired, 0);
  assert.equal(calls.length, 0);
  assert.equal(report.skipped[0]?.reason, "global-disabled");
});

test("yaml maxFires:0 never fires (quota, zero jobs)", { timeout: 15000 }, () => {
  freshSandbox();
  writeYaml(DUE_SCHEDULE_YAML.replace("      maxFires: 5", "      maxFires: 0"));
  const { deps, calls } = mockDeps();
  const report = tickOnce(T0, deps);
  assert.equal(report.fired, 0);
  assert.equal(calls.length, 0);
  assert.equal(report.skipped[0]?.reason, "quota");
});

test("yaml per-trigger enabled:false skips only that trigger", { timeout: 15000 }, () => {
  freshSandbox();
  writeYaml(DUE_SCHEDULE_YAML.replace('      enabled: true\n      intervalMs', "      enabled: false\n      intervalMs"));
  const { deps, calls } = mockDeps();
  const report = tickOnce(T0, deps);
  assert.equal(report.fired, 0);
  assert.equal(calls.length, 0);
  assert.equal(report.skipped[0]?.reason, "trigger-disabled");
});

test("yaml tickMs:0 keeps the ticker off", { timeout: 15000 }, () => {
  freshSandbox();
  try {
    writeYaml(DUE_SCHEDULE_YAML.replace("  tickMs: 30000", "  tickMs: 0"));
    assert.equal(getEffectiveAutomationsConfig().tickMs, 0);
    assert.equal(startAutomationTicker(), false);
    assert.equal(isAutomationTickerRunning(), false);
  } finally {
    stopAutomationTicker();
    resetAutomationServiceForTests();
  }
});

test("yaml event trigger refuses pact ids and records it", { timeout: 15000 }, () => {
  freshSandbox();
  writeYaml(
    [
      "automations:",
      "  enabled: true",
      "  tickMs: 30000",
      "  triggers:",
      '    - name: "yaml-chain"',
      '      kind: "event"',
      "      enabled: true",
      "      maxFires: 5",
      "      cooldownMs: 0",
      '      on: "job-complete"',
      '      action: "create-job"',
      '      promptRef: "factory/prompts/chain.md"',
      "",
    ].join("\n"),
  );
  const { deps, calls } = mockDeps();
  const report = fireEvent({ id: "evt-yaml-pact-1", kind: "job-complete", jobId: "job-abc123" }, T0, deps);
  assert.equal(report.fired, 1);
  assert.equal(calls.length, 0);
  assert.equal(report.fires[0]?.result, "skipped-quota");
  assert.ok((report.fires[0]?.note ?? "").includes("pact-id rejected"));
});

test("missing or malformed yaml degrades to safe defaults (daemon never dies)", { timeout: 15000 }, () => {
  freshSandbox();
  assert.deepEqual(getEffectiveAutomationsConfig().triggers, []);
  writeYaml("automations:\n  enabled: true\n  tickMs: 30000\n  triggers:\n    - name: \"bad\"\n      kind: \"schedule\"\n");
  const cfg = getEffectiveAutomationsConfig();
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.triggers, []);
  const report = tickOnce(T0, mockDeps().deps);
  assert.equal(report.fired, 0);
});
