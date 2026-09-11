/**
 * Wave 14 T04 (Track B) — definition validator automations/integrations rules.
 * `npx tsx --test tests/definition-validate-automations.test.ts` (offline).
 *
 * Covers the T04 done criteria:
 * - 8 new rules fire with `{file, line, rule, message, severity: error}`
 *   (forms intact: `validateDefinition`/`getDefinitionStatus` signatures
 *   unchanged, old rules untouched)
 * - absent sections stay valid (old yaml files keep working on defaults)
 * - the real `factory/factory.yaml` yields zero A/I issues
 * - `validateDefinition` on a sandbox factory reports the new rules while
 *   the daemon keeps serving (fallback visible: validation never throws)
 *
 * ESM only, zero `require()`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFINITION_RULES,
  validateAutomationsBlock,
  validateDefinition,
  validateIntegrationsBlock,
} from "../headless-runtime/factory/definitionValidate.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

const NEW_RULES = [
  "automations-schema",
  "automations-triggers-cap",
  "automations-schedule-xor",
  "automations-prompt-ref",
  "integrations-schema",
  "integrations-mode",
  "integrations-provider",
  "integrations-secret",
];

const VALID_AUTOMATIONS = [
  "automations:",
  "  enabled: true",
  "  tickMs: 30000",
  "  triggers:",
  '    - name: "nightly-trivial"',
  '      kind: "schedule"',
  "      enabled: true",
  "      intervalMs: 86400000",
  '      promptRef: "factory/prompts/nightly.md"',
  "      maxFires: 5",
  "      cooldownMs: 3600000",
  '    - name: "announce-ask-human"',
  '      kind: "event"',
  "      enabled: true",
  '      on: "ask_human"',
  '      action: "notify-integration"',
  "      maxFires: 20",
  "      cooldownMs: 60000",
  "",
].join("\n");

const VALID_INTEGRATIONS = [
  "integrations:",
  "  enabled: true",
  '  mode: "mock-local"',
  '  provider: "linear"',
  "",
].join("\n");

function rulesOf(issues: Array<{ rule: string }>): string[] {
  return issues.map((i) => i.rule);
}

function assertErrorShape(issue: unknown, rule: string): void {
  const r = issue as Record<string, unknown>;
  assert.equal(r.rule, rule);
  assert.equal(r.severity, "error");
  assert.ok(typeof r.file === "string" && (r.file as string).length > 0);
  assert.ok(typeof r.message === "string" && (r.message as string).length > 0);
  assert.ok(
    typeof r.line === "number" && Number.isInteger(r.line) && (r.line as number) > 0,
    `rule ${rule} must carry an approximate file:line`,
  );
}

// ── registry ──

test("the 8 A/I rule ids exist and old ids are intact", () => {
  for (const rule of NEW_RULES) {
    assert.ok((DEFINITION_RULES as readonly string[]).includes(rule), `missing ${rule}`);
  }
  assert.ok((DEFINITION_RULES as readonly string[]).includes("yaml-parse"));
  assert.ok((DEFINITION_RULES as readonly string[]).includes("validate-crashed"));
});

// ── absent / valid ──

test("absent sections are valid (old yaml keeps working on defaults)", () => {
  assert.deepEqual(validateAutomationsBlock("ports:\n  factoryDefault: 17680\n"), []);
  assert.deepEqual(validateIntegrationsBlock("ports:\n  factoryDefault: 17680\n"), []);
  assert.deepEqual(validateAutomationsBlock("", "f"), []);
  assert.deepEqual(validateIntegrationsBlock(null, "f"), []);
});

test("valid sections yield zero issues", () => {
  assert.deepEqual(validateAutomationsBlock(VALID_AUTOMATIONS, "factory/factory.yaml"), []);
  assert.deepEqual(validateIntegrationsBlock(VALID_INTEGRATIONS, "factory/factory.yaml"), []);
});

test("the real factory.yaml yields zero A/I issues", () => {
  const text = fs.readFileSync(path.join(REPO, "factory", "factory.yaml"), "utf-8");
  const auto = validateAutomationsBlock(text, "factory/factory.yaml");
  const integ = validateIntegrationsBlock(text, "factory/factory.yaml");
  assert.deepEqual(auto, []);
  assert.deepEqual(integ, []);
});

// ── automations rules ──

test("schedule without exactly one of intervalMs|cron shouts schedule-xor", () => {
  const text = [
    "automations:",
    "  enabled: true",
    "  tickMs: 30000",
    "  triggers:",
    '    - name: "broken-both-missing"',
    '      kind: "schedule"',
    '      promptRef: "factory/prompts/x.md"',
    "",
  ].join("\n");
  const issues = validateAutomationsBlock(text, "factory/factory.yaml");
  assert.ok(rulesOf(issues).includes("automations-schedule-xor"));
  assertErrorShape(
    issues.find((i) => i.rule === "automations-schedule-xor"),
    "automations-schedule-xor",
  );
});

test("schedule with both intervalMs and cron shouts schedule-xor", () => {
  const text = [
    "automations:",
    "  triggers:",
    '    - name: "both-set"',
    '      kind: "schedule"',
    "      intervalMs: 60000",
    '      cron: "0 3 * * *"',
    '      promptRef: "factory/prompts/x.md"',
    "",
  ].join("\n");
  assert.ok(rulesOf(validateAutomationsBlock(text, "f")).includes("automations-schedule-xor"));
});

test("malformed cron shouts schedule-xor with file:line", () => {
  const text = [
    "automations:",
    "  triggers:",
    '    - name: "bad-cron"',
    '      kind: "schedule"',
    '      cron: "not-a-cron"',
    '      promptRef: "factory/prompts/x.md"',
    "",
  ].join("\n");
  const issues = validateAutomationsBlock(text, "factory/factory.yaml");
  assert.ok(rulesOf(issues).includes("automations-schedule-xor"));
  assertErrorShape(
    issues.find((i) => i.rule === "automations-schedule-xor"),
    "automations-schedule-xor",
  );
});

test("traversal promptRef shouts prompt-ref", () => {
  const text = [
    "automations:",
    "  triggers:",
    '    - name: "evil-ref"',
    '      kind: "schedule"',
    "      intervalMs: 60000",
    '      promptRef: "../outside.md"',
    "",
  ].join("\n");
  const issues = validateAutomationsBlock(text, "factory/factory.yaml");
  assert.ok(rulesOf(issues).includes("automations-prompt-ref"));
  assertErrorShape(
    issues.find((i) => i.rule === "automations-prompt-ref"),
    "automations-prompt-ref",
  );
});

test("more than 20 triggers shouts triggers-cap", () => {
  const lines = ["automations:", "  triggers:"];
  Array.from({ length: 21 }).forEach((_, i) => {
    lines.push(`    - name: "t-${i}"`);
    lines.push('      kind: "event"');
    lines.push('      on: "ask_human"');
    lines.push('      action: "notify-integration"');
  });
  lines.push("");
  const issues = validateAutomationsBlock(lines.join("\n"), "factory/factory.yaml");
  assert.ok(rulesOf(issues).includes("automations-triggers-cap"));
  assertErrorShape(
    issues.find((i) => i.rule === "automations-triggers-cap"),
    "automations-triggers-cap",
  );
});

test("bad top-level tickMs shouts automations-schema", () => {
  const text = ["automations:", "  tickMs: -5", "  triggers:", ""].join("\n");
  const issues = validateAutomationsBlock(text, "factory/factory.yaml");
  assert.ok(rulesOf(issues).includes("automations-schema"));
});

// ── integrations rules ──

test("mode beyond mock-local shouts integrations-mode", () => {
  const issues = validateIntegrationsBlock(
    VALID_INTEGRATIONS.replace('"mock-local"', '"live"'),
    "factory/factory.yaml",
  );
  assert.ok(rulesOf(issues).includes("integrations-mode"));
  assertErrorShape(
    issues.find((i) => i.rule === "integrations-mode"),
    "integrations-mode",
  );
});

test("provider beyond linear shouts integrations-provider", () => {
  const issues = validateIntegrationsBlock(
    VALID_INTEGRATIONS.replace('"linear"', '"slack"'),
    "factory/factory.yaml",
  );
  assert.ok(rulesOf(issues).includes("integrations-provider"));
  assertErrorShape(
    issues.find((i) => i.rule === "integrations-provider"),
    "integrations-provider",
  );
});

test("secret fields shout integrations-secret (fail-closed)", () => {
  const issues = validateIntegrationsBlock(
    VALID_INTEGRATIONS.replace('  provider: "linear"', '  provider: "linear"\n  webhook: "x"'),
    "factory/factory.yaml",
  );
  assert.ok(rulesOf(issues).includes("integrations-secret"));
  assertErrorShape(
    issues.find((i) => i.rule === "integrations-secret"),
    "integrations-secret",
  );
});

test("nested lists shout integrations-schema", () => {
  const text = ["integrations:", "  enabled: true", "  hooks:", '    - name: "x"', ""].join("\n");
  const issues = validateIntegrationsBlock(text, "factory/factory.yaml");
  assert.ok(rulesOf(issues).includes("integrations-schema"));
});

// ── end to end through validateDefinition (fallback visible, never throws) ──

test("validateDefinition reports new rules on a sandbox factory and never throws", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "defval-auto-test-"));
  const factoryDir = path.join(sandbox, "factory");
  fs.mkdirSync(factoryDir, { recursive: true });
  const yaml = [
    "ports:",
    "  factoryDefault: 17680",
    "  factoryMax: 17690",
    "timeouts:",
    "  verifyMs: 120000",
    "defaultModels:",
    '  foreman: "opencode-go/muse-spark-1.2-contributor"',
    '  implement: "opencode-go/muse-spark-1.2-contributor"',
    '  review: "auto-disjoint"',
    "reviewerPairs:",
    '  - match: "a"',
    '    reviewer: "opencode/big-pickle"',
    "scorers:",
    "  samplingRate: 25",
    "automations:",
    "  triggers:",
    '    - name: "bad-cron"',
    '      kind: "schedule"',
    '      cron: "nope"',
    '      promptRef: "factory/prompts/x.md"',
    "integrations:",
    "  enabled: true",
    '  mode: "live"',
    '  provider: "linear"',
    "",
  ].join("\n");
  fs.writeFileSync(path.join(factoryDir, "factory.yaml"), yaml, "utf-8");
  let issues: Array<{ file: string; line?: number; rule: string; severity: string }> = [];
  try {
    issues = validateDefinition({ factoryDir }) as typeof issues;
  } catch {
    assert.fail("validateDefinition must never throw (visible fallback instead)");
  }
  const byRule = new Set(issues.map((i) => i.rule));
  assert.ok(byRule.has("automations-schedule-xor"), "sandbox must shout the A rule");
  assert.ok(byRule.has("integrations-mode"), "sandbox must shout the I rule");
  const mode = issues.find((i) => i.rule === "integrations-mode");
  assert.ok(mode !== undefined && typeof mode.line === "number" && mode.line > 0);
  assert.ok(String(mode.file).includes("factory.yaml"));
});
