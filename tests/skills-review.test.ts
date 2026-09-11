/**
 * Ola 10 — Skills para agentes: loader versionado + integración reviewer.
 * node:test + tsx. No toca el daemon ni muta disco productivo (los worktrees
 * son temporales; factory/skills se lee, no se escribe).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILL_MAX_BYTES,
  getSkillOrNull,
  loadSkill,
  parseSkillFile,
  resetSkillCache,
  resolveSkillPath,
  truncateSkillBody,
} from "../headless-runtime/factory/agentLoader.ts";
import { buildReviewPrompt } from "../headless-runtime/review/reviewPrompt.ts";
import {
  hasVisualSurface,
  loadRepoConventionsSkill,
  resolveReviewSkills,
  reviewAgent,
  setReviewPromptMock,
} from "../headless-runtime/review/reviewAgent.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import type { VerificationReport } from "../shared/types/implement.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tmpWorktree(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function reportWithEvidence(): VerificationReport {
  const now = new Date().toISOString();
  return {
    steps: [],
    overall: "pass",
    startedAt: now,
    finishedAt: now,
    durationMs: 5,
    evidence: [
      {
        kind: "visual",
        status: "pending-human",
        ref: "src/Panel.tsx",
        summary: "cambio con superficie visual",
      },
    ],
  };
}

// ── Loader: válido ──

test("loadSkill carga las 3 skills con name y cuerpo no vacío", () => {
  for (const name of ["code-review", "repo-conventions", "ui-verification"] as const) {
    const def = loadSkill(name);
    assert.ok(def, `${name} debe cargar`);
    assert.equal(def.frontmatter.name, name);
    assert.ok(def.frontmatter.description.length > 0, `${name}: description no vacía`);
    assert.ok(def.body.length > 0, `${name}: body no vacío`);
    assert.equal(def.truncated, false);
    assert.ok(def.body.length <= SKILL_MAX_BYTES, `${name}: body dentro del cap`);
  }
});

test("contenido derivado: code-review trae pasadas y mapeo; repo-conventions trae override; ui trae playwright-verify", () => {
  const cr = loadSkill("code-review")?.body ?? "";
  assert.match(cr, /Orient/);
  assert.match(cr, /Critical/);
  assert.match(cr, /Specialist/);
  assert.match(cr, /Verdict/);
  assert.match(cr, /ask_human/);
  assert.match(cr, /revise/);
  assert.doesNotMatch(cr, /Hydra/);
  const rc = loadSkill("repo-conventions")?.body ?? "";
  assert.match(rc, /Project override/);
  assert.match(rc, /\.agents\/skills\/repo-conventions\.md/);
  const ui = loadSkill("ui-verification")?.body ?? "";
  assert.match(ui, /playwright-verify\.mjs/);
  assert.match(ui, /pending-human/);
});

// ── Loader: faltante / traversal (nunca lanza) ──

test("loadSkill null ante faltante o nombre vacío, sin lanzar", () => {
  assert.equal(loadSkill("no-existe-ola10-xyz"), null);
  assert.equal(loadSkill(""), null);
  assert.equal(loadSkill("   "), null);
});

test("loadSkill anti-traversal: ../x y rutas con slash/puntos → null", () => {
  assert.equal(loadSkill("../x"), null);
  assert.equal(loadSkill(".."), null);
  assert.equal(loadSkill("code-review/../../etc"), null);
  assert.equal(loadSkill("a/b"), null);
  assert.equal(loadSkill("code-review/SKILL.md"), null);
});

test("resolveSkillPath apunta a factory/skills/<name>/SKILL.md", () => {
  const p = resolveSkillPath("code-review");
  assert.ok(p.endsWith(path.join("factory", "skills", "code-review", "SKILL.md")));
});

// ── Cap 8KB ──

test("truncateSkillBody: cuerpo corto intacto, cuerpo largo acotado con nota", () => {
  const short = truncateSkillBody("abc");
  assert.equal(short.truncated, false);
  assert.equal(short.body, "abc");
  const long = truncateSkillBody("y".repeat(SKILL_MAX_BYTES + 100));
  assert.equal(long.truncated, true);
  assert.ok(long.body.length < SKILL_MAX_BYTES + 100);
  assert.match(long.body, /truncada a 8KB/);
});

// ── Parser ──

test("parseSkillFile exige name y cuerpo no vacío; soporta description >-", () => {
  assert.throws(() => parseSkillFile("---\ndescription: x\n---\nbody\n"), /skill parse error/);
  assert.throws(() => parseSkillFile("---\nname: x\n---\n   \n"), /skill parse error/);
  assert.throws(() => parseSkillFile("sin frontmatter"), /skill parse error/);
  const parsed = parseSkillFile("---\nname: demo\ndescription: >-\n  linea uno\n  linea dos\n---\ncuerpo\n");
  assert.equal(parsed.frontmatter.name, "demo");
  assert.match(parsed.frontmatter.description, /linea uno/);
  assert.match(parsed.frontmatter.description, /linea dos/);
  assert.equal(parsed.body, "cuerpo");
});

// ── Cache ──

test("getSkillOrNull con cache + resetSkillCache para tests", () => {
  resetSkillCache();
  const a = getSkillOrNull("code-review");
  const b = getSkillOrNull("code-review");
  assert.ok(a);
  assert.ok(a === b, "segunda lectura sale del cache");
  assert.equal(getSkillOrNull("no-existe-ola10-xyz"), null);
  resetSkillCache();
  assert.ok(getSkillOrNull("code-review"), "tras reset vuelve a cargar");
});

// ── Prompt: nunca renderiza skills (turno de datos, reglas en el espejo) ──

test("buildReviewPrompt ignora skills aunque se pasen (sin sección)", () => {
  const prompt = buildReviewPrompt(
    { id: "job-skills-01", prompt: "agregar panel", worktree: "/tmp/wt" },
    {
      createdFiles: ["src/Panel.tsx"],
      reviewAttempt: 1,
    },
  );
  assert.doesNotMatch(prompt, /## Skills aplicadas/);
  assert.doesNotMatch(prompt, /### code-review/);
  assert.ok(!prompt.includes("src/Panel.tsx"), "turno flaco: sin lista servida");
  assert.ok(prompt.includes("agregar panel"), "el issue viaja igual");
});

test("buildReviewPrompt sin skills ni cuerpos: solo datos flacos", () => {
  const prompt = buildReviewPrompt(
    { id: "job-skills-03", prompt: "x", worktree: "/tmp/wt" },
    { createdFiles: ["src/auth.ts"] },
  );
  assert.doesNotMatch(prompt, /## Skills aplicadas/);
  assert.ok(!prompt.includes("src/auth.ts"), "turno flaco: sin lista servida");
  assert.ok(!prompt.includes("Revisá el diff y los archivos"), "sin cierre (vive en el espejo)");
});

// ── Override por proyecto antepuesto (worktree temporal real) ──

test("override por proyecto se antepone al default del factory", () => {
  const wt = tmpWorktree("skills-override-");
  try {
    const skillDir = path.join(wt, ".agents", "skills");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "repo-conventions.md"),
      "OVERRIDE-OLA10-MARKER: este proyecto exige captura siempre.",
      "utf-8",
    );
    const combined = loadRepoConventionsSkill(wt);
    assert.ok(combined);
    assert.match(combined, /OVERRIDE-OLA10-MARKER/);
    assert.match(combined, /Evidence over narrative/);
    assert.ok(
      combined.indexOf("OVERRIDE-OLA10-MARKER") < combined.indexOf("Evidence over narrative"),
      "el override va primero",
    );
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

test("sin override, repo-conventions es el default del factory", () => {
  const wt = tmpWorktree("skills-nooverride-");
  try {
    const combined = loadRepoConventionsSkill(wt);
    assert.ok(combined);
    assert.match(combined, /Evidence over narrative/);
    assert.doesNotMatch(combined, /OVERRIDE-OLA10-MARKER/);
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

// ── ui-verification condicional ──

test("hasVisualSurface reutiliza el predicado existente (archivos o evidence)", () => {
  assert.equal(hasVisualSurface(["src/Panel.tsx"]), true);
  assert.equal(hasVisualSurface(["src/auth.ts"]), false);
  assert.equal(hasVisualSurface([]), false);
  assert.equal(hasVisualSurface(["src/auth.ts"], reportWithEvidence()), true);
  assert.equal(hasVisualSurface(undefined, undefined), false);
});

test("resolveReviewSkills: ui-verification solo con superficie visual", () => {
  const wt = tmpWorktree("skills-cond-");
  try {
    const withUi = resolveReviewSkills({ worktreePath: wt, createdFiles: ["src/Panel.tsx"] });
    assert.ok(withUi.names.includes("code-review"));
    assert.ok(withUi.names.includes("repo-conventions"));
    assert.ok(withUi.names.includes("ui-verification"));
    assert.ok((withUi.skills.uiVerification ?? "").length > 0);

    const withoutUi = resolveReviewSkills({ worktreePath: wt, createdFiles: ["src/auth.ts"] });
    assert.ok(withoutUi.names.includes("code-review"));
    assert.ok(withoutUi.names.includes("repo-conventions"));
    assert.ok(!withoutUi.names.includes("ui-verification"));
    assert.equal(withoutUi.skills.uiVerification, undefined);

    const viaEvidence = resolveReviewSkills({
      worktreePath: wt,
      createdFiles: ["src/auth.ts"],
      verification: reportWithEvidence(),
    });
    assert.ok(viaEvidence.names.includes("ui-verification"));
  } finally {
    fs.rmSync(wt, { recursive: true, force: true });
  }
});

// ── agent.md cablea skills vía frontmatter ──

test("factory/agents/review/agent.md cablea skills con su cuándo", () => {
  const md = fs.readFileSync(path.join(REPO_ROOT, "factory", "agents", "review", "agent.md"), "utf-8");
  assert.match(md, /^skills: \{[^}]*code-review[^}]*\}/m, "frontmatter declara code-review");
  assert.match(md, /^skills: \{[^}]*repo-conventions[^}]*\}/m, "frontmatter declara repo-conventions");
  assert.doesNotMatch(md, /ui-verification/, "ui-verification removida");
  assert.match(md, /`code-review` — always/, "code-review siempre");
  assert.match(md, /`repo-conventions` — always/, "repo-conventions siempre");
  assert.match(md, /Load them with the `skill` tool/, "carga vía tool skill");
});

// ── Traza: evento timeline con meta skills al consumir ──

test("consume no emite evento timeline 'review skills:' (sin resolución)", async () => {
  const worktree = tmpWorktree("skills-event-");
  const id = "job-skills-ola10";
  workItemStore.clear();
  setReviewPromptMock(async () =>
    JSON.stringify({
      verdict: "accept",
      confidence: 0.9,
      summary: "Cambio mínimo correcto",
      findings: [],
    }),
  );
  try {
    workItemStore.create({ id, prompt: "ajuste menor", worktree, phase: "diagnosisLlm" });
    const out = await reviewAgent.consume({
      workItemId: id,
      worktreePath: worktree,
      reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
      reviewAttempt: 1,
      prompt: "ajuste menor",
      createdFiles: ["src/auth.ts"],
    });
    assert.equal(out.result.verdict, "accept");
    const item = workItemStore.get(id);
    assert.ok(item);
    const evt = (item.timeline ?? []).find((e) => e.message.startsWith("review skills:"));
    assert.equal(evt, undefined, "sin evento de skills (nada se resuelve)");
  } finally {
    setReviewPromptMock(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("consume con superficie visual tampoco emite evento de skills", async () => {
  const worktree = tmpWorktree("skills-event-ui-");
  const id = "job-skills-ola10ui";
  workItemStore.clear();
  setReviewPromptMock(async () =>
    JSON.stringify({
      verdict: "accept",
      confidence: 0.85,
      summary: "Panel correcto",
      findings: [],
    }),
  );
  try {
    workItemStore.create({ id, prompt: "agregar panel", worktree, phase: "diagnosisLlm" });
    await reviewAgent.consume({
      workItemId: id,
      worktreePath: worktree,
      reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
      reviewAttempt: 1,
      prompt: "agregar panel",
      createdFiles: ["src/Panel.tsx"],
    });
    const item = workItemStore.get(id);
    const evt = (item?.timeline ?? []).find((e) => e.message.startsWith("review skills:"));
    assert.equal(evt, undefined, "ni con superficie visual hay evento de skills");
  } finally {
    setReviewPromptMock(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});
