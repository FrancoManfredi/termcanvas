import test from "node:test";
import assert from "node:assert/strict";
import { buildIssueFixPrompt } from "../src/canvas/issueFixPrompt.ts";
import { buildIssueReviewPrompt } from "../src/canvas/issueReviewPrompt.ts";
import { buildIssueResolvePrompt } from "../src/canvas/issueResolvePrompt.ts";
import { buildResolveConflictPrompt } from "../src/canvas/resolveConflictPrompt.ts";

const REPO_CONTEXT_TEXT = `Plataforma de juegos educativos de matemática.
Misión: que las escuelas públicas usen la netbook que ya tienen.
Alcance mínimo: 5 juegos para 3ro a 6to, offline.`;

const REQUIREMENTS_TEXT = `Síntesis de requerimientos usada: entrevista-1786862000000-sintesis.json (2026-08-16) — selección activa del dueño.

REQUERIMIENTOS FUNCIONALES:
- [Must have] RF-001: El sistema debe permitir a la maestra asignar un juego.

ATRIBUTOS DE CALIDAD Y ASR (obligan decisiones estructurales):
- [ASR-001] Rendimiento: Correr en netbooks de 2012 obliga una decisión estructural.

RESTRICCIONES GLOBALES:
- [CON-001] Stack Tecnológico: Web liviana (PWA).

GLOSARIO:
- Netbook: Dispositivo del Plan Ceibal.`;

const builders: Array<{ name: string; build: () => string }> = [
  {
    name: "resolve",
    build: () =>
      buildIssueResolvePrompt(
        {
          issueNumber: 1,
          title: "Issue title",
          body: "Body",
          repoContextText: REPO_CONTEXT_TEXT,
          requirementsText: REQUIREMENTS_TEXT,
        },
        "new",
      ),
  },
  {
    name: "fix",
    build: () =>
      buildIssueFixPrompt({
        issueNumber: 1,
        title: "Issue title",
        body: "Body",
        prNumber: 12,
        branch: "issue-1",
        repoContextText: REPO_CONTEXT_TEXT,
        requirementsText: REQUIREMENTS_TEXT,
      }),
  },
  {
    name: "review",
    build: () =>
      buildIssueReviewPrompt({
        issueNumber: 1,
        title: "Issue title",
        prNumber: 12,
        branch: "issue-1",
        repoContextText: REPO_CONTEXT_TEXT,
        requirementsText: REQUIREMENTS_TEXT,
      }),
  },
  {
    name: "conflict",
    build: () =>
      buildResolveConflictPrompt({
        issueNumber: 1,
        title: "Issue title",
        prNumber: 12,
        branch: "issue-1",
        repoContextText: REPO_CONTEXT_TEXT,
        requirementsText: REQUIREMENTS_TEXT,
      }),
  },
];

test("all orchestrator prompts are multiline markdown with the context section before the task", () => {
  // Cada prompt arranca con un header (# ... issue #N) que menciona el issue
  // ANTES que el contexto: la sección de contexto debe venir después del
  // header pero antes de la primera sección de tarea (## ALCANCE / ## TAREA).
  const taskSectionByBuilder: Record<string, string> = {
    resolve: "## ALCANCE",
    fix: "## ALCANCE",
    review: "## LECTURA OBLIGATORIA DEL ISSUE",
    conflict: "## ARCHIVOS EN CONFLICTO",
  };
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(
      prompt.includes("CONTEXTO DEL REPOSITORIO"),
      `${name} prompt must include the repo context section`,
    );
    assert.ok(
      prompt.includes("Plataforma de juegos educativos de matemática."),
      `${name} prompt must inline the active context text`,
    );
    const ctxPos = prompt.indexOf("CONTEXTO DEL REPOSITORIO");
    const taskPos = prompt.indexOf(taskSectionByBuilder[name]);
    assert.ok(
      taskPos > -1 && ctxPos < taskPos,
      `${name} prompt must put the repo context before the task section`,
    );
  }
});

test("orchestrator prompts use real newlines and markdown headers (no one-line pipe join)", () => {
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(
      prompt.includes("\n"),
      `${name} prompt must be multiline`,
    );
    assert.ok(
      prompt.includes("##"),
      `${name} prompt must use markdown section headers`,
    );
    assert.ok(
      !prompt.includes(" | "),
      `${name} prompt must not use the old one-line pipe separator`,
    );
  }
});

test("multiline context text keeps its original line breaks inside the section", () => {
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(
      prompt.includes(
        "Plataforma de juegos educativos de matemática.\nMisión: que las escuelas públicas usen la netbook que ya tienen.",
      ),
      `${name} prompt must preserve the context text line breaks`,
    );
  }
});

test("without repo context the prompts are unchanged (no empty section)", () => {
  const without = {
    resolve: buildIssueResolvePrompt(
      { issueNumber: 1, title: "Issue title", body: "Body" },
      "new",
    ),
    fix: buildIssueFixPrompt({
      issueNumber: 1,
      title: "Issue title",
      body: "Body",
      prNumber: 12,
      branch: "issue-1",
    }),
    review: buildIssueReviewPrompt({
      issueNumber: 1,
      title: "Issue title",
      prNumber: 12,
      branch: "issue-1",
    }),
    conflict: buildResolveConflictPrompt({
      issueNumber: 1,
      title: "Issue title",
      prNumber: 12,
      branch: "issue-1",
    }),
  };
  for (const [name, prompt] of Object.entries(without)) {
    assert.ok(
      !prompt.includes("CONTEXTO DEL REPOSITORIO"),
      `${name} prompt must not emit the section without repo context`,
    );
  }
});

test("whitespace-only context text is treated as absent", () => {
  const prompt = buildIssueResolvePrompt(
    { issueNumber: 1, title: "Issue title", body: "Body", repoContextText: " \n  " },
    "new",
  );
  assert.ok(
    !prompt.includes("CONTEXTO DEL REPOSITORIO"),
    "whitespace-only context must not emit the section",
  );
});

// ─── Sección REQUERIMIENTOS RELEVADOS ─────────────────────────────────────

test("all orchestrator prompts inject the requirements section with its traceability line", () => {
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(
      prompt.includes("## REQUERIMIENTOS RELEVADOS"),
      `${name} prompt must include the requirements section`,
    );
    assert.ok(
      prompt.includes("Síntesis de requerimientos usada: entrevista-1786862000000-sintesis.json"),
      `${name} prompt must carry the provenance line for the agent summary`,
    );
    assert.ok(
      prompt.includes("[ASR-001] Rendimiento"),
      `${name} prompt must inline the ASRs (they obligate technical decisions)`,
    );
    assert.ok(
      prompt.includes('Mencioná en tu resumen final la línea exacta "Síntesis de requerimientos usada'),
      `${name} prompt must ask the agent to repeat the provenance in its summary`,
    );
  }
});

test("requirements section comes after the repo context and before the task", () => {
  const taskSectionByBuilder: Record<string, string> = {
    resolve: "## ALCANCE",
    fix: "## ALCANCE",
    review: "## LECTURA OBLIGATORIA DEL ISSUE",
    conflict: "## ARCHIVOS EN CONFLICTO",
  };
  for (const { name, build } of builders) {
    const prompt = build();
    const ctxPos = prompt.indexOf("## CONTEXTO DEL REPOSITORIO");
    const reqPos = prompt.indexOf("## REQUERIMIENTOS RELEVADOS");
    const taskPos = prompt.indexOf(taskSectionByBuilder[name]);
    assert.ok(
      ctxPos > -1 && reqPos > ctxPos && taskPos > reqPos,
      `${name} prompt must order: context < requirements < task`,
    );
  }
});

test("without requirements text the section is not emitted (no empty section)", () => {
  const without = {
    resolve: buildIssueResolvePrompt(
      { issueNumber: 1, title: "Issue title", body: "Body", repoContextText: REPO_CONTEXT_TEXT },
      "new",
    ),
    fix: buildIssueFixPrompt({
      issueNumber: 1,
      title: "Issue title",
      body: "Body",
      prNumber: 12,
      branch: "issue-1",
      repoContextText: REPO_CONTEXT_TEXT,
    }),
    review: buildIssueReviewPrompt({
      issueNumber: 1,
      title: "Issue title",
      prNumber: 12,
      branch: "issue-1",
      repoContextText: REPO_CONTEXT_TEXT,
    }),
    conflict: buildResolveConflictPrompt({
      issueNumber: 1,
      title: "Issue title",
      prNumber: 12,
      branch: "issue-1",
      repoContextText: REPO_CONTEXT_TEXT,
    }),
  };
  for (const [name, prompt] of Object.entries(without)) {
    assert.ok(
      !prompt.includes("REQUERIMIENTOS RELEVADOS"),
      `${name} prompt must not emit the section without requirements text`,
    );
  }
});

test("whitespace-only requirements text is treated as absent", () => {
  const prompt = buildIssueResolvePrompt(
    { issueNumber: 1, title: "Issue title", body: "Body", requirementsText: " \n  " },
    "new",
  );
  assert.ok(
    !prompt.includes("REQUERIMIENTOS RELEVADOS"),
    "whitespace-only requirements must not emit the section",
  );
});
