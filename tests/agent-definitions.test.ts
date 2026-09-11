/**
 * Ola 7 — Agents as code: definiciones versionadas + loader + cableado.
 * node:test + tsx. No toca el daemon ni muta disco productivo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
import {
  REVIEWER_PAIRS,
  fallbackFor,
  getActiveReviewerPairs,
  selectReviewerModel,
} from "../headless-runtime/review/reviewModelSelector.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACTORY_DIR = path.join(REPO_ROOT, "factory");
const AGENT_NAMES = ["foreman", "implement", "review", "triage", "spec"] as const;

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

test("tools espejan los contratos actuales por agente", () => {
  const foreman = loadAgentDef("foreman");
  const implement = loadAgentDef("implement");
  const review = loadAgentDef("review");
  assert.ok(foreman && implement && review);
  const asList = (tools: unknown): string[] =>
    Array.isArray(tools) ? (tools as string[]) : Object.keys((tools ?? {}) as Record<string, unknown>);
  assert.deepEqual(asList(foreman.frontmatter.tools), []);
  assert.deepEqual(asList(implement.frontmatter.tools).sort(), ["bash", "edit", "glob", "grep", "read", "webfetch", "write"]);
  assert.deepEqual(asList(review.frontmatter.tools).sort(), ["glob", "grep", "read", "webfetch"]);
});

test("model default efectivo: foreman e implement con el fallback actual, review auto-disjoint", () => {
  assert.equal(loadAgentDef("foreman")?.frontmatter.model, "opencode-go/muse-spark-1.2-contributor");
  assert.equal(loadAgentDef("implement")?.frontmatter.model, "opencode-go/muse-spark-1.2-contributor");
  assert.equal(loadAgentDef("review")?.frontmatter.model, "auto-disjoint");
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
  assert.equal(cfg.defaultModels.foreman, "opencode-go/muse-spark-1.2-contributor");
  assert.equal(cfg.defaultModels.implement, "opencode-go/muse-spark-1.2-contributor");
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
    else if (stat.isFile()) out.push(full);
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
