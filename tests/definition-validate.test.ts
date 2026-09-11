/**
 * Ola 20 E1 — validación de definition (backend: validador puro + endpoint + CLI).
 * node:test + tsx. Sin daemon (offline), sin red, sin LLM.
 * Fixtures en tmpdir (jamás se toca la factory real salvo el test explícito
 * "definition actual del repo" que es solo lectura).
 *
 * Cubre (contrato inamovible):
 * - cada regla con caso bueno/malo; línea aproximada correcta en ≥3 casos
 * - definition ACTUAL del repo valida `valid:true`
 * - `getDefinitionStatus` forma exacta (+ buildId passthrough)
 * - endpoint helper `buildDefinitionStatusResponse` sin daemon (forma + buildId
 *   igual al de /factory/health)
 * - `factory.mjs validate` por invocación real (daemon caído → camino local tsx)
 * - `validateDefinition` nunca lanza (factoryDir roto → issues, no throw)
 * - DEFINITION_RULES estables sin duplicados
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFINITION_RULES,
  getDefinitionStatus,
  validateDefinition,
  type DefinitionIssue,
} from "../headless-runtime/factory/definitionValidate.ts";
import { buildDefinitionStatusResponse } from "../headless-runtime/factory/factoryServer.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

// ── Fixture factory mínima válida (todo en tmpdir) ──

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

function agentMd(opts: {
  description?: string;
  agentType?: string;
  tools?: string;
  model?: string | null;
  body?: string;
}): string {
  const d = opts.description ?? "Hace algo útil.";
  const t = opts.agentType ?? "IMPLEMENT";
  const tools = opts.tools ?? "{read,glob,grep}";
  const modelLine = opts.model === null ? "" : `model: ${opts.model ?? "prov-a/model-a"}\n`;
  const body = opts.body ?? "# Agente\n\nCuerpo con instrucciones.\n";
  const descLine = opts.description === "" ? "description: \n" : `description: ${d}\n`;
  return `---\n${descLine}agentType: ${t}\n${modelLine}tools: ${tools}\nmaxRetries: 1\n---\n${body}`;
}

function scorerMd(opts: {
  name: string;
  labels?: string;
  samplingRate?: string;
  model?: string | null;
  agents?: string | null;
  passingScore?: string;
  body?: string;
}): string {
  const lines = ["---", `name: ${opts.name}`, "description: Juez de prueba."];
  lines.push(`agents: ${opts.agents === null ? "" : (opts.agents ?? "{review}")}`);
  lines.push(`labels: ${opts.labels ?? '[{"value":"ok","score":1},{"value":"mal","score":0}]'}`);
  lines.push(`passingScore: ${opts.passingScore ?? "0.5"}`);
  lines.push(`samplingRate: ${opts.samplingRate ?? "25"}`);
  if (opts.model !== null) lines.push(`model: ${opts.model ?? "prov-a/model-a"}`);
  lines.push("selfImprovement: false", "---", opts.body ?? "# Juez\n\nPregunta y procedimiento.\n");
  return lines.join("\n");
}

function skillMd(opts: { name?: string; body?: string }): string {
  return `---\nname: ${opts.name ?? "k"}\ndescription: Rúbrica de prueba.\n---\n${opts.body ?? "# K\n\nContenido útil.\n"}`;
}

function runnerYaml(opts: {
  isolation?: string;
  setupCommands?: string[] | null;
  vcpus?: number;
  memoryGb?: number;
  dockerImage?: string | null;
}): string {
  const cmds = opts.setupCommands === null
    ? "setupCommands:\n"
    : `setupCommands:\n${(opts.setupCommands ?? ["corepack enable"]).map((c) => `  - "${c}"`).join("\n")}\n`;
  const image = opts.dockerImage === null || opts.dockerImage === undefined
    ? ""
    : `  dockerImage: "${opts.dockerImage}"\n`;
  return `description: "Runner de prueba"\n${cmds}instanceShape:\n  vcpus: ${opts.vcpus ?? 4}\n  memoryGb: ${opts.memoryGb ?? 8}\nisolation: "${opts.isolation ?? "none"}"\nplatform:\n  os: "windows"\n  arch: "x64"\n${image}`;
}

const VALID_TASK = {
  id: "t1",
  prompt: "Haz algo mínimo.",
  files: [{ path: "a.txt", content: "x\n" }],
  verification: { overall: "pass" },
  expectedVerdict: "accept",
};

interface Fixture {
  root: string;
  factory: string;
}

// Nota: toda escritura de fixture asegura padres (mkdir recursive).

const PROPOSALS = ".proposals";

function writeFixtureFile(factory: string, rel: string, content: string): void {
  const abs = path.join(factory, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

function issuesByRule(issues: DefinitionIssue[], rule: string): DefinitionIssue[] {
  return issues.filter((i) => i.rule === rule);
}

function hasError(issues: DefinitionIssue[], rule: string): boolean {
  return issues.some((i) => i.rule === rule && i.severity === "error");
}

function makeFixtureSafe(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "defval-"));
  const factory = path.join(root, "factory");
  writeFixtureFile(factory, "agents/foreman/agent.md", agentMd({ agentType: "FOREMAN", tools: "{}" }));
  writeFixtureFile(factory, "agents/triage/agent.md", agentMd({ agentType: "TRIAGE" }));
  writeFixtureFile(factory, "agents/spec/agent.md", agentMd({ agentType: "SPEC" }));
  writeFixtureFile(factory, "agents/implement/agent.md", agentMd({ tools: "{read,write,edit,bash,glob,grep}" }));
  writeFixtureFile(factory, "agents/review/agent.md", agentMd({ agentType: "REVIEW", model: "auto-disjoint" }));
  writeFixtureFile(factory, "factory.yaml", VALID_YAML);
  writeFixtureFile(factory, "scorers/s1/scorer.md", scorerMd({ name: "s1" }));
  writeFixtureFile(factory, "skills/k1/SKILL.md", skillMd({}));
  writeFixtureFile(factory, "runners/r1.yaml", runnerYaml({}));
  writeFixtureFile(
    factory,
    "benchmarks/reference-tasks.json",
    JSON.stringify({ version: 1, tasks: [VALID_TASK] }, null, 2),
  );
  fs.mkdirSync(path.join(factory, PROPOSALS), { recursive: true });
  return { root, factory };
}

// ── Contrato: rules estables ──

test("DEFINITION_RULES: ids estables esperados, sin duplicados", () => {
  const expected = [
    "agents-frontmatter", "agents-tools", "agents-exactly-one-foreman", "agents-model-shape",
    "yaml-parse", "yaml-ports", "yaml-timeouts", "yaml-models", "yaml-cost-rates",
    "yaml-sampling-rate", "yaml-cooldown", "yaml-flags", "yaml-triage-mode",
    "scorers-parse", "scorers-labels", "scorers-sampling-rate", "scorers-model",
    "scorers-agents", "scorers-passing-score",
    "skills-frontmatter", "skills-body", "skills-size",
    "runners-parse", "runners-isolation", "runners-setup-commands", "runners-shape",
    "runners-docker-image",
    "benchmarks-parse", "benchmarks-task-schema",
    "proposals-writable", "validate-crashed",
  ];
  for (const id of expected) assert.ok((DEFINITION_RULES as readonly string[]).includes(id), `falta rule ${id}`);
  assert.equal(new Set(DEFINITION_RULES).size, DEFINITION_RULES.length, "rules duplicadas");
});

// ── Fixture válida → valid:true ──

test("fixture válida: valid:true sin issues", () => {
  const fx = makeFixtureSafe();
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.deepEqual(issues, [], `esperaba 0 issues, hubo: ${JSON.stringify(issues, null, 1).slice(0, 800)}`);
});

// ── a) agents ──

test("agents: cero FOREMAN → error agents-exactly-one-foreman", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "agents/foreman/agent.md", agentMd({ agentType: "REVIEW", model: "auto-disjoint" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "agents-exactly-one-foreman"));
  assert.equal(issues.some((i) => i.severity === "error"), true);
});

test("agents: dos FOREMAN → error agents-exactly-one-foreman", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "agents/triage/agent.md", agentMd({ agentType: "FOREMAN" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "agents-exactly-one-foreman");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "error");
  assert.ok(found[0].message.includes("triage"));
});

test("agents: description vacía → error agents-frontmatter con file", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "agents/triage/agent.md", agentMd({ description: "" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "agents-frontmatter");
  assert.ok(found.length >= 1);
  assert.ok(found.every((i) => i.severity === "error"));
  assert.ok(found.some((i) => i.file.includes("agents/triage/agent.md")));
});

test("agents: tool desconocida → error agents-tools con línea aproximada", () => {
  const fx = makeFixtureSafe();
  // tools en línea 5 del frontmatter (---,description,agentType,model,tools,...)
  writeFixtureFile(fx.factory, "agents/triage/agent.md", agentMd({ tools: "{read,rayos-x}" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "agents-tools");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "error");
  assert.equal(found[0].line, 5);
  assert.ok(found[0].message.includes("rayos-x"));
});

test("agents: model con forma rara → warn agents-model-shape (no bloquea)", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "agents/triage/agent.md", agentMd({ model: "sinnobarra" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "agents-model-shape");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warn");
  assert.equal(found[0].line, 4);
  assert.equal(issues.some((i) => i.severity === "error"), false);
});

test("agents: auto-disjoint en foreman → warn; en review → ok", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "agents/foreman/agent.md", agentMd({ agentType: "FOREMAN", tools: "{}", model: "auto-disjoint" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(issues.some((i) => i.rule === "agents-model-shape" && i.severity === "warn"));
});

// ── b) yaml ──

test("yaml: puerto fuera de rango → error yaml-ports con línea", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "factory.yaml", VALID_YAML.replace("factoryMax: 17690", "factoryMax: 99999"));
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "yaml-ports");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "error");
  assert.equal(found[0].line, 3);
  assert.ok(!issues.some((i) => i.rule === "yaml-parse")), "pinpointer evita el yaml-parse genérico";
});

test("yaml: timeout 0 → error yaml-timeouts", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "factory.yaml", VALID_YAML.replace("verifyMs: 120000", "verifyMs: 0"));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "yaml-timeouts"));
});

test("yaml: defaultModel sin barra → error yaml-models", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "factory.yaml", VALID_YAML.replace('foreman: "prov-a/model-a"', 'foreman: "sinnobarra"'));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "yaml-models"));
});

test("yaml: costRates negativo → error yaml-cost-rates", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(
    fx.factory,
    "factory.yaml",
    VALID_YAML.replace("costRates: {}", 'costRates:\n  "prov-a/model-a":\n    inputUSDper1M: -1\n    outputUSDper1M: 2'),
  );
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "yaml-cost-rates"));
});

test("yaml: samplingRate 200 → error yaml-sampling-rate", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "factory.yaml", VALID_YAML.replace("samplingRate: 25", "samplingRate: 200"));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "yaml-sampling-rate"));
});

test("yaml: cooldown -1 → error yaml-cooldown", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "factory.yaml", VALID_YAML.replace("improveProposalCooldown: 1", "improveProposalCooldown: -1"));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "yaml-cooldown"));
});

test("yaml: flag no booleano → error yaml-flags", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "factory.yaml", VALID_YAML.replace("costTracking: true", "costTracking: yes"));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "yaml-flags"));
});

test("yaml: basura estructural → error yaml-parse genérico", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "factory.yaml", "esto no es yaml válido: [sin cerrar\n  - lista suelta\n");
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "yaml-parse"));
});

test("yaml: ausente → error yaml-parse", () => {
  const fx = makeFixtureSafe();
  fs.rmSync(path.join(fx.factory, "factory.yaml"));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "yaml-parse"));
});

// ── c) scorers ──

test("scorers: labels sin discriminar → error scorers-labels con línea", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(
    fx.factory,
    "scorers/s1/scorer.md",
    scorerMd({ name: "s1", labels: '[{"value":"a","score":1},{"value":"b","score":1}]' }),
  );
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "scorers-labels");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "error");
  assert.equal(found[0].line, 5);
});

test("scorers: un solo label → error scorers-labels", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "scorers/s1/scorer.md", scorerMd({ name: "s1", labels: '[{"value":"a","score":1}]' }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "scorers-labels"));
});

test("scorers: samplingRate 101 → error scorers-sampling-rate", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "scorers/s1/scorer.md", scorerMd({ name: "s1", samplingRate: "101" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "scorers-sampling-rate"));
});

test("scorers: model sin forma → warn scorers-model (no bloquea)", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "scorers/s1/scorer.md", scorerMd({ name: "s1", model: "zzz" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "scorers-model");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warn");
  assert.equal(issues.some((i) => i.severity === "error"), false);
});

test("scorers: agents fuera de vocabulario → error scorers-agents", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "scorers/s1/scorer.md", scorerMd({ name: "s1", agents: "{jefecito}" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "scorers-agents"));
});

test("scorers: passingScore no numérico → error scorers-passing-score", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "scorers/s1/scorer.md", scorerMd({ name: "s1", passingScore: "abc" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "scorers-passing-score"));
});

test("scorers: archivo roto → error scorers-parse", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "scorers/s1/scorer.md", "sin frontmatter, solo texto\n");
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "scorers-parse"));
});

// ── d) skills (cap real 8KB) ──

test("skills: sin name → error skills-frontmatter", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "skills/k1/SKILL.md", "---\ndescription: Sin nombre.\n---\n# K\n\nAlgo.\n");
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "skills-frontmatter"));
});

test("skills: cuerpo vacío → warn skills-body (no bloquea)", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "skills/k1/SKILL.md", "---\nname: k1\ndescription: Vacía.\n---\n   \n");
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "skills-body");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warn");
  assert.equal(issues.some((i) => i.severity === "error"), false);
});

test("skills: cuerpo > 8KB → warn skills-size (cap real del loader)", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "skills/k1/SKILL.md", skillMd({ body: `# K\n\n${"x".repeat(9 * 1024)}\n` }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "skills-size");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warn");
  assert.ok(found[0].message.includes("8192"));
});

// ── e) runners (espejo schema E1-Ola15) ──

test("runners: isolation inválida → error runners-isolation", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "runners/r1.yaml", runnerYaml({ isolation: "vm" }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "runners-isolation"));
});

test("runners: setupCommands vacía → error runners-setup-commands", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "runners/r1.yaml", runnerYaml({ setupCommands: [] }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "runners-setup-commands"));
});

test("runners: vcpus 0 → error runners-shape", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "runners/r1.yaml", runnerYaml({ vcpus: 0 }));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "runners-shape"));
});

test("runners: docker sin imagen → error runners-docker-image; con imagen → ok", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "runners/r1.yaml", runnerYaml({ isolation: "docker", dockerImage: null }));
  assert.ok(hasError(validateDefinition({ factoryDir: fx.factory }), "runners-docker-image"));
  writeFixtureFile(
    fx.factory,
    "runners/r1.yaml",
    runnerYaml({ isolation: "docker", dockerImage: "ubuntu:22.04" }),
  );
  assert.ok(!hasError(validateDefinition({ factoryDir: fx.factory }), "runners-docker-image"));
});

// ── f) benchmarks ──

test("benchmarks: task inválida → error benchmarks-task-schema", () => {
  const fx = makeFixtureSafe();
  const bad = { ...VALID_TASK, prompt: "" };
  writeFixtureFile(fx.factory, "benchmarks/reference-tasks.json", JSON.stringify({ version: 1, tasks: [bad] }, null, 2));
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "benchmarks-task-schema"));
});

test("benchmarks: JSON roto → error benchmarks-parse", () => {
  const fx = makeFixtureSafe();
  writeFixtureFile(fx.factory, "benchmarks/reference-tasks.json", "{ roto");
  const issues = validateDefinition({ factoryDir: fx.factory });
  assert.ok(hasError(issues, "benchmarks-parse"));
});

// ── g) proposals ──

test("proposals: .proposals como archivo (no dir) → warn proposals-writable", () => {
  const fx = makeFixtureSafe();
  fs.rmSync(path.join(fx.factory, PROPOSALS), { recursive: true, force: true });
  fs.writeFileSync(path.join(fx.factory, PROPOSALS), "bloqueo", "utf-8");
  const issues = validateDefinition({ factoryDir: fx.factory });
  const found = issuesByRule(issues, "proposals-writable");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warn");
});

test("proposals: dir existente y escribible → sin issues", () => {
  const fx = makeFixtureSafe();
  assert.deepEqual(validateDefinition({ factoryDir: fx.factory }), []);
});

// ── Robustez: nunca lanza ──

test("validateDefinition nunca lanza (factoryDir inexistente o archivo)", () => {
  const a = validateDefinition({ factoryDir: path.join(os.tmpdir(), `defval-noexiste-${Date.now()}`) });
  assert.ok(Array.isArray(a) && a.length > 0);
  assert.ok(a.some((i) => i.severity === "error"));
  const tmpFile = path.join(os.tmpdir(), `defval-archivo-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, "x", "utf-8");
  const b = validateDefinition({ factoryDir: tmpFile });
  assert.ok(Array.isArray(b) && b.length > 0);
});

// ── Definition real del repo ──

test("definition ACTUAL del repo valida valid:true (solo lectura)", () => {
  const issues = validateDefinition();
  assert.equal(
    issues.filter((i) => i.severity === "error").length,
    0,
    `la definition real tiene errores: ${JSON.stringify(issues, null, 1).slice(0, 1500)}`,
  );
});

// ── getDefinitionStatus forma exacta ──

test("getDefinitionStatus: forma exacta {valid, issues, checkedAt} + buildId opcional", () => {
  const s = getDefinitionStatus();
  assert.equal(typeof s.valid, "boolean");
  assert.ok(Array.isArray(s.issues));
  assert.equal(typeof s.checkedAt, "string");
  assert.ok(!Number.isNaN(Date.parse(s.checkedAt)), "checkedAt ISO");
  assert.ok(!("buildId" in s), "sin buildId si no se pasa");
  const withBuild = getDefinitionStatus("abc123");
  assert.equal(withBuild.buildId, "abc123");
  assert.equal(typeof withBuild.valid, "boolean");
});

// ── Endpoint helper sin daemon ──

test("buildDefinitionStatusResponse: forma + buildId igual al de /factory/health", () => {
  const payload = buildDefinitionStatusResponse();
  assert.equal(typeof payload.valid, "boolean");
  assert.ok(Array.isArray(payload.issues));
  assert.ok(!Number.isNaN(Date.parse(payload.checkedAt)));
  assert.equal(typeof payload.buildId, "string");
  assert.ok(payload.buildId.length > 0);
  // MISMO cálculo que GET /factory/health (ensureFactoryBuildId: git short
  // HEAD, fallback dev-<base36>). Se replica acá sin importar exec de más:
  let expected: string;
  try {
    expected = String(execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, timeout: 3000, encoding: "utf-8" } as never)).trim();
    if (!expected || /\s/.test(expected)) throw new Error("bad git output");
  } catch {
    expected = payload.buildId.startsWith("dev-") ? payload.buildId : "dev-fallback";
  }
  assert.equal(payload.buildId, expected);
});

// ── CLI factory.mjs validate (invocación real, daemon caído → local tsx) ──

test("factory.mjs validate: exit 0 + resumen con la definition real", () => {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "factory.mjs"), "validate"], {
    cwd: REPO_ROOT,
    timeout: 28000,
    encoding: "utf-8",
  });
  const out = String(r.stdout ?? "") + String(r.stderr ?? "");
  assert.equal(r.status, 0, `exit ${r.status}: ${out.slice(0, 600)}`);
  assert.ok(out.includes("definition válida"), `sin resumen de válida: ${out.slice(0, 400)}`);
});

// Cómo probar a mano un caso roto (documentado acá porque el CLI no acepta
// --factory-dir a propósito: scope mínimo, cero flags nuevos):
//   1. Copiá factory/ a un tmp, rompé un scorer (labels con un solo label).
//   2. `node scripts/factory.mjs validate` sobre el repo con ese scorer roto
//      temporalmente → exit 1 + línea `factory/scorers/<n>/scorer.md:<línea>
//      scorers-labels [error] ...`; revertí con git checkout.
