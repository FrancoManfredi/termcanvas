/**
 * Ola 7 — Agents as code: definiciones versionadas + loader + cableado.
 * node:test + tsx. No toca el daemon ni muta disco productivo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FACTORY_DEFAULTS,
  getFactoryConfig,
  loadAgentDef,
  parseAgentFile,
  parseFactoryYaml,
  resetFactoryConfigCache,
  validateAgentSet,
} from "../headless-runtime/factory/agentLoader.ts";
import { buildForemanPrompt } from "../headless-runtime/foreman/foremanPrompt.ts";
import { buildImplementPrompt } from "../headless-runtime/implement/implementPrompt.ts";
import { buildReviewPrompt } from "../headless-runtime/review/reviewPrompt.ts";
import { buildTriagePrompt } from "../headless-runtime/triage/triagePrompt.ts";
import { buildSpecPrompt } from "../headless-runtime/spec/specPrompt.ts";
import {
  REVIEWER_PAIRS,
  fallbackFor,
  getActiveReviewerPairs,
  selectReviewerModel,
} from "../headless-runtime/review/reviewModelSelector.ts";
import { buildFactoryAgentsConfig } from "../headless-runtime/factory/opencodeAgentSync.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACTORY_DIR = path.join(REPO_ROOT, "factory");
const AGENT_NAMES = ["foreman", "implement", "review", "triage", "spec"] as const;

/**
 * Fixture de agentes en un root temporal: los agent.md del repo son
 * configurables por el usuario (la UI los edita en vivo), así que los tests
 * de contratos usan contenido propio, nunca el archivo real.
 */
function encodeFmValue(value: unknown): string {
  if (Array.isArray(value)) return `{${value.join(", ")}}`;
  if (typeof value === "string" && value.length > 0 && !/[\s:{}\[\],]/.test(value)) return value;
  return JSON.stringify(value);
}

function makeFixtureRoot(
  agents: Record<string, Record<string, unknown>>,
): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "agents-defs-"));
  for (const [name, fm] of Object.entries(agents)) {
    const dir = path.join(root, "factory", "agents", name);
    mkdirSync(dir, { recursive: true });
    const lines = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${encodeFmValue(v)}`), "---", "", `Cuerpo de ${name}.`, ""];
    writeFileSync(path.join(dir, "agent.md"), lines.join("\n"), "utf-8");
  }
  return root;
}

// ── Frontmatter válido de los 5 md ──

test("los 5 agent.md existen con frontmatter válido (sin maxRetries: doctrina sin-límites)", () => {
  const expectations: Record<string, { agentType: string }> = {
    foreman: { agentType: "FOREMAN" },
    implement: { agentType: "IMPLEMENT" },
    review: { agentType: "REVIEW" },
    triage: { agentType: "TRIAGE" },
    spec: { agentType: "SPEC" },
  };
  for (const name of AGENT_NAMES) {
    const def = loadAgentDef(name);
    assert.ok(def, `factory/agents/${name}/agent.md debe cargar`);
    assert.ok(def.frontmatter.description.length > 0, `${name}: description no vacía`);
    assert.equal(def.frontmatter.agentType, expectations[name].agentType);
    assert.equal(def.frontmatter.maxRetries, undefined, `${name}: sin maxRetries (lo decide el transporte)`);
    assert.ok(def.body.length > 0, `${name}: body no vacío`);
  }
});

test("tools espejan los contratos actuales por agente (fixtures, no el contenido editable del repo)", () => {
  const root = makeFixtureRoot({
    foreman: { description: "F.", agentType: "FOREMAN", tools: [] },
    implement: {
      description: "I.",
      agentType: "IMPLEMENT",
      tools: ["read", "edit", "bash", "glob", "grep", "webfetch"],
    },
    review: {
      description: "R.",
      agentType: "REVIEW",
      tools: ["read", "glob", "grep", "webfetch"],
    },
  });
  try {
    const agents = buildFactoryAgentsConfig(root);
    const permOf = (name: string): Record<string, unknown> =>
      (agents[name]?.permission ?? {}) as Record<string, unknown>;
    assert.deepEqual(Object.keys(permOf("foreman")).sort(), ["*", "task"]);
    const implementPerm = permOf("implement");
    for (const key of ["read", "edit", "bash", "glob", "grep", "webfetch"]) {
      assert.ok(key in implementPerm, `implement permite ${key}`);
    }
    assert.ok(!("write" in implementPerm), "sin key legacy duplicada");
    const reviewPerm = permOf("review");
    assert.deepEqual(Object.keys(reviewPerm).sort(), ["*", "glob", "grep", "read", "task", "webfetch"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("model default efectivo: foreman/implement con el fallback actual, review fijo", () => {
  const root = makeFixtureRoot({
    foreman: {
      description: "F.",
      agentType: "FOREMAN",
      model: "opencode-go/muse-spark-1.3-contributor",
    },
    implement: {
      description: "I.",
      agentType: "IMPLEMENT",
      model: "opencode-go/muse-spark-1.3-contributor",
    },
    review: { description: "R.", agentType: "REVIEW", model: "opencode/big-pickle" },
  });
  try {
    const agents = buildFactoryAgentsConfig(root);
    assert.equal(agents.foreman?.model, "opencode-go/muse-spark-1.3-contributor");
    assert.equal(agents.implement?.model, "opencode-go/muse-spark-1.3-contributor");
    assert.equal(agents.review?.model, "opencode/big-pickle");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("triage/spec reales Ola 8: sin stub, con Input/Output/Procedure y tools de lectura", () => {
  for (const name of ["triage", "spec"] as const) {
    const def = loadAgentDef(name);
    assert.ok(def);
    assert.notEqual(def.frontmatter.status, "stub");
    assert.doesNotMatch(def.body, /se implementa en Ola 8/i);
    assert.doesNotMatch(def.body, /sin comportamiento todavía/i);
    assert.match(def.body, /## Input/);
    assert.match(def.body, /## Output/);
    assert.match(def.body, /## Procedure/);
    const tools = def.frontmatter.tools;
    const asList = Array.isArray(tools) ? (tools as string[]) : Object.keys((tools ?? {}) as Record<string, unknown>);
    assert.deepEqual([...asList].sort(), ["glob", "grep", "read", "webfetch"]);
  }
});

// ── Exactamente un FOREMAN ──

test("exactamente un FOREMAN en el conjunto y validateAgentSet verde", () => {
  const defs = AGENT_NAMES.map((n) => loadAgentDef(n));
  assert.ok(defs.every(Boolean));
  const foremans = defs.filter((d) => d?.frontmatter.agentType === "FOREMAN");
  assert.equal(foremans.length, 1);
  assert.deepEqual(validateAgentSet(defs), []);
});

test("validateAgentSet detecta cero o más de un FOREMAN y tipos inválidos", () => {
  assert.ok(validateAgentSet([]).length > 0, "cero agentes debe fallar");
  const implement = loadAgentDef("implement");
  assert.ok(implement);
  assert.ok(validateAgentSet([implement]).length > 0, "sin FOREMAN debe fallar");
  const foreman = loadAgentDef("foreman");
  assert.ok(foreman);
  assert.ok(validateAgentSet([foreman, foreman]).length > 0, "dos FOREMAN debe fallar");
  const bad = {
    name: "raro",
    frontmatter: { ...(foreman.frontmatter as object), agentType: "JEFECITO" },
    body: "x",
  };
  assert.ok(validateAgentSet([bad as never]).length > 0, "agentType inválido debe fallar");
});

// ── Loader null ante faltante/corrupto (nunca lanza) ──

test("loadAgentDef null ante archivo faltante o nombre inválido, sin lanzar", () => {
  assert.equal(loadAgentDef("no-existe-ola7-xyz"), null);
  assert.equal(loadAgentDef(""), null);
  assert.equal(loadAgentDef("../foreman"), null);
});

test("parseAgentFile lanza tipado ante frontmatter faltante, corrupto o tipo inválido", () => {
  assert.throws(() => parseAgentFile("sin frontmatter"), /agent parse error/);
  assert.throws(() => parseAgentFile("---\ndescription: x\n"), /agent parse error/);
  assert.throws(
    () => parseAgentFile('---\ndescription: x\nagentType: JEFECITO\n---\nbody\n'),
    /agentType inválido/,
  );
  assert.throws(
    () => parseAgentFile('---\nagentType: FOREMAN\n---\nbody\n'),
    /description/,
  );
});

// ── Turnos de datos: sin header ni baked aunque el md falte ──

test("prompts llevan solo datos: el md vive en el espejo, nunca en el turno", () => {
  const foremanOut = buildForemanPrompt({ prompt: "fix auth bug", worktree: "" });
  assert.ok(foremanOut.includes("fix auth bug"));
  assert.ok(foremanOut.includes("Decidí ahora en JSON"));
  assert.ok(!foremanOut.includes("factory/agents/foreman/agent.md"), "sin header");

  const implementOut = buildImplementPrompt({ prompt: "fix auth bug", worktreePath: "/tmp/wt" } as never);
  assert.ok(implementOut.includes("fix auth bug"));
  assert.ok(!implementOut.includes('"files"'), "contrato JSON en el espejo, no en el turno");
  assert.ok(!implementOut.includes("factory/agents/implement/agent.md"), "sin header");

  const reviewOut = buildReviewPrompt(
    { id: "job-ola7-test01", prompt: "agregar login con tests", worktree: "/tmp/wt" },
    { createdFiles: ["src/auth.ts"] },
  );
  assert.ok(!reviewOut.includes("src/auth.ts"), "turno flaco: sin lista servida");
  assert.ok(reviewOut.includes("agregar login con tests"), "el issue viaja");
  assert.ok(!reviewOut.includes("factory/agents/review/agent.md"), "sin header");
  assert.ok(!reviewOut.includes("Ejes obligatorios"), "sin reglas");
});

test("turnos legacy declaran su shape: el body es identidad, no contrato", () => {
  const reviewOut = buildReviewPrompt(
    { id: "job-shape-1", prompt: "x", worktree: "/tmp/wt" },
    {},
  );
  assert.ok(reviewOut.includes('"verdict"'), "legacy review declara su contrato en el turno");
  const triageOut = buildTriagePrompt({ id: "job-shape-1", prompt: "x", worktree: "/tmp/wt" });
  assert.ok(triageOut.includes('"decision"'), "legacy triage declara su contrato en el turno");
  const specOut = buildSpecPrompt({ id: "job-shape-1", prompt: "x", worktree: "/tmp/wt" });
  assert.ok(
    specOut.includes('"acceptanceCriteria"'),
    "legacy spec declara su contrato en el turno",
  );
});

test("loader ante nombre inexistente devuelve null (gate intacto)", () => {
  // El loader ante nombre inexistente devuelve null: ese es el gate del fallback.
  assert.equal(loadAgentDef("ola7-no-existe"), null);
});

// ── factory.yaml: parse válido + inválido→defaults ──

test("factory.yaml parsea válido con puertos, timeouts, modelos, pares y scorers", () => {
  resetFactoryConfigCache();
  const text = readFileSync(path.join(FACTORY_DIR, "factory.yaml"), "utf-8");
  const cfg = parseFactoryYaml(text);
  assert.deepEqual(cfg.ports, { factoryDefault: 17680, factoryMax: 17690 });
  assert.deepEqual(cfg.timeouts, {
    verifyMs: 120000,
  });
  assert.equal(cfg.defaultModels.foreman, "opencode-go/muse-spark-1.3-contributor");
  assert.equal(cfg.defaultModels.implement, "opencode-go/muse-spark-1.3-contributor");
  assert.equal(cfg.defaultModels.review, "auto-disjoint");
  assert.deepEqual(cfg.reviewerPairs, REVIEWER_PAIRS);
  assert.equal(cfg.scorers.samplingRate, 25);
});

test("parseFactoryYaml estricto: yaml inválido lanza y getFactoryConfig nunca lanza", () => {
  assert.throws(() => parseFactoryYaml("::: no es yaml válido"), /factory\.yaml parse error/);
  assert.throws(() => parseFactoryYaml(""), /factory\.yaml parse error/);
  assert.throws(
    () => parseFactoryYaml('ports:\n  factoryDefault: 17680\n'),
    /factory\.yaml parse error/,
  );
  resetFactoryConfigCache();
  const cfg = getFactoryConfig();
  assert.deepEqual(cfg.ports, FACTORY_DEFAULTS.ports);
  assert.deepEqual(cfg.timeouts, FACTORY_DEFAULTS.timeouts);
});

test("pares desde yaml inválido caen a constantes: semántica del selector intacta", () => {
  assert.deepEqual(FACTORY_DEFAULTS.reviewerPairs, REVIEWER_PAIRS);
  resetFactoryConfigCache();
  assert.deepEqual(getActiveReviewerPairs(), REVIEWER_PAIRS);
  const sel = selectReviewerModel({ providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" });
  assert.equal(sel.reviewerModel.providerID, "opencode");
  assert.equal(sel.reviewerModel.modelID, "big-pickle");
  const fb = fallbackFor({ providerID: "opencode", modelID: "big-pickle" });
  assert.ok(fb.modelID.includes("muse-spark"));
});

// ── Cero literales de máquina / saludos en factory/ ──

function collectFactoryFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...collectFactoryFiles(full));
    else if (stat.isFile() && !path.basename(full).startsWith(".job-index.json")) out.push(full);
  }
  return out;
}

test("factory/ sin literales de máquina ni saludos (refuerza el candado)", () => {
  const files = collectFactoryFiles(FACTORY_DIR);
  assert.ok(files.length >= 6, `factory/ debe tener al menos 6 archivos (hay ${files.length})`);
  const banned: Array<{ label: string; pattern: RegExp }> = [
    { label: "ruta de máquina", pattern: /c:\\users/i },
    { label: "usuario de máquina", pattern: /estudiante ucu/i },
    { label: "nombre propio de test", pattern: /\bhola mundo\b/i },
    { label: "saludo", pattern: /Hola/ },
  ];
  const violations: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const b of banned) {
      if (b.pattern.test(content)) violations.push(`${path.relative(REPO_ROOT, file)} → ${b.label}`);
    }
  }
  assert.deepEqual(violations, []);
});
