/**
 * triage-ondemand — T2: el Triage-agent corre on-demand (foreman primero),
 * no siempre (caso "cada issue gasta triage sin sentido").
 *
 * Contrato bajo test (offline: puros + yaml en tmp, sin daemon, sin LLM):
 * - `resolveTriageMode`: explícito válido manda; junk/ausente → "auto".
 * - `shouldRunPreTriage`: solo "always" sin skip ni pact; "auto"/"never"
 *   jamás pre-triagean.
 * - `needsOnDemandTriage`: solo "auto" + needs_triage/needs_input.
 * - `parseFactoryYaml`: triageMode always/never parsean; valor inválido,
 *   forma sección o duplicado → FactoryConfigError; ausente → "auto".
 * - `validateDefinition`: triageMode inválido → issue yaml-triage-mode;
 *   válido → sin issues de esa regla.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  needsOnDemandTriage,
  resolveTriageMode,
  shouldRunPreTriage,
} from "../headless-runtime/triage/triageFlow.ts";
import {
  FactoryConfigError,
  parseFactoryYaml,
} from "../headless-runtime/factory/agentLoader.ts";
import { validateDefinition } from "../headless-runtime/factory/definitionValidate.ts";

const VALID_YAML = `ports:
  factoryDefault: 17680
  factoryMax: 17690
timeouts:
  verifyMs: 120000
defaultModels:
  foreman: "prov-a/model-a"
  implement: "prov-a/model-a"
  review: "auto-disjoint"
reviewerPairs:
  - match: "x"
    reviewer: "prov-a/model-b"
scorers:
  samplingRate: 25
runners:
  default: "windows-local"
costTracking: true
costRates: {}
agentSessions: true
reviewerReverify: true
improveProposalCooldown: 1
notificationsEnabled: true
osNotifications: true
`;

// ─── Modo ───

test("triage on-demand: resolveTriageMode respeta explícito y cae a auto", () => {
  assert.equal(resolveTriageMode("auto"), "auto");
  assert.equal(resolveTriageMode("always"), "always");
  assert.equal(resolveTriageMode("never"), "never");
  assert.equal(resolveTriageMode("Always"), "always");
  assert.equal(resolveTriageMode("  NEVER  "), "never");
  for (const junk of [undefined, null, "", "  ", "aveces", 42, {}, []]) {
    assert.equal(resolveTriageMode(junk), "auto", String(junk));
  }
});

test("triage on-demand: pre-triage solo en always sin skip ni pact", () => {
  assert.equal(shouldRunPreTriage("always", false, false), true);
  assert.equal(shouldRunPreTriage("always", true, false), false);
  assert.equal(shouldRunPreTriage("always", false, true), false);
  assert.equal(shouldRunPreTriage("auto", false, false), false);
  assert.equal(shouldRunPreTriage("never", false, false), false);
  assert.equal(shouldRunPreTriage("aveces", false, false), false);
  assert.equal(shouldRunPreTriage(undefined, false, false), false);
});

test("triage on-demand: on-demand solo en auto con needs_triage/needs_input", () => {
  assert.equal(needsOnDemandTriage("auto", "needs_triage"), true);
  assert.equal(needsOnDemandTriage("auto", "needs_input"), true);
  assert.equal(needsOnDemandTriage("auto", "building"), false);
  assert.equal(needsOnDemandTriage("auto", "error"), false);
  assert.equal(needsOnDemandTriage("always", "needs_triage"), false);
  assert.equal(needsOnDemandTriage("never", "needs_triage"), false);
  assert.equal(needsOnDemandTriage("auto", "building-ish"), false);
  assert.equal(needsOnDemandTriage("auto", null), false);
  // Sin modo explícito manda la config viva (el yaml real trae auto):
  // nunca lanza y respeta el default.
  assert.equal(
    needsOnDemandTriage(undefined, "needs_triage"),
    resolveTriageMode() === "auto",
  );
});

// ─── Yaml ───

test("triage on-demand: parseFactoryYaml acepta el enum y defaultea auto", () => {
  assert.equal(parseFactoryYaml(`${VALID_YAML}triageMode: always\n`).triageMode, "always");
  assert.equal(parseFactoryYaml(`${VALID_YAML}triageMode: never\n`).triageMode, "never");
  assert.equal(parseFactoryYaml(`${VALID_YAML}triageMode: auto\n`).triageMode, "auto");
  assert.equal(parseFactoryYaml(VALID_YAML).triageMode, "auto");
});

test("triage on-demand: parseFactoryYaml rechaza valor, sección y duplicado", () => {
  assert.throws(
    () => parseFactoryYaml(`${VALID_YAML}triageMode: aveces\n`),
    /triageMode debe ser auto, always o never/,
  );
  assert.throws(
    () => parseFactoryYaml(`${VALID_YAML}triageMode:\n  mode: auto\n`),
    /triageMode es escalar/,
  );
  assert.throws(
    () => parseFactoryYaml(`${VALID_YAML}triageMode: auto\ntriageMode: never\n`),
    /clave duplicada/,
  );
});

// ─── Validate ───

function writeFile(factory: string, rel: string, content: string): void {
  const target = path.join(factory, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf-8");
}

function agentMd(agentType: string): string {
  return `---\ndescription: Hace algo útil.\nagentType: ${agentType}\ntools: "{read,glob,grep}"\nmaxRetries: 1\n---\n# Agente\n\nCuerpo.\n`;
}

function makeFactory(yaml: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "triage-mode-"));
  const factory = path.join(root, "factory");
  writeFile(factory, "agents/foreman/agent.md", agentMd("FOREMAN"));
  writeFile(factory, "agents/triage/agent.md", agentMd("TRIAGE"));
  writeFile(factory, "agents/spec/agent.md", agentMd("SPEC"));
  writeFile(
    factory,
    "agents/implement/agent.md",
    agentMd("IMPLEMENT").replace('"{read,glob,grep}"', '"{read,write,edit,bash,glob,grep}"'),
  );
  writeFile(factory, "agents/review/agent.md", agentMd("REVIEW"));
  writeFile(factory, "factory.yaml", yaml);
  writeFile(
    factory,
    "scorers/s1/scorer.md",
    '---\nname: s1\ndescription: Juez.\nagents: "{review}"\nlabels: [{"value":"ok","score":1},{"value":"mal","score":0}]\npassingScore: "0.5"\nsamplingRate: "25"\nmodel: "prov-a/model-a"\nselfImprovement: false\n---\n# Juez\n\nPregunta.\n',
  );
  writeFile(factory, "skills/k1/SKILL.md", "---\nname: k1\ndescription: Rúbrica.\n---\n# K\n\nContenido.\n");
  writeFile(factory, "runners/r1.yaml", "default: windows-local\n");
  writeFile(
    factory,
    "benchmarks/reference-tasks.json",
    JSON.stringify({ version: 1, tasks: [] }, null, 2),
  );
  fs.mkdirSync(path.join(factory, ".proposals"), { recursive: true });
  return factory;
}

function rmRecursive(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

test("triage on-demand: validate marca triageMode inválido y acepta el enum", () => {
  const badRoot = path.dirname(makeFactory(`${VALID_YAML}triageMode: never\n`));
  const badFactory = path.join(badRoot, "factory");
  try {
    // Reescribo con valor inválido (el loader caería a defaults: el validate
    // pinpointea sobre el texto crudo).
    fs.writeFileSync(path.join(badFactory, "factory.yaml"), `${VALID_YAML}triageMode: aveces\n`, "utf-8");
    const issues = validateDefinition({ factoryDir: badFactory });
    const hit = issues.filter((i) => i.rule === "yaml-triage-mode");
    assert.equal(hit.length, 1);
    assert.equal(hit[0].severity, "error");
    assert.match(hit[0].message, /auto, always o never/);
  } finally {
    rmRecursive(badRoot);
  }

  const goodRoot = path.dirname(makeFactory(`${VALID_YAML}triageMode: never\n`));
  try {
    const issues = validateDefinition({ factoryDir: path.join(goodRoot, "factory") });
    assert.equal(
      issues.filter((i) => i.rule === "yaml-triage-mode").length,
      0,
      JSON.stringify(issues.slice(0, 3)),
    );
  } finally {
    rmRecursive(goodRoot);
  }
});
