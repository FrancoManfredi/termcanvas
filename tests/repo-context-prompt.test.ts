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

// Bloque que arma formatDecisionsForPrompt desde decisiones-activo.json
// (mismo shape que viaja por IPC interview:activeDecisionsText).
const DECISIONS_TEXT = `DECISIONES DE ARQUITECTURA YA TOMADAS (ADRs activos):

- **ADR-001** (ASR-001): En el contexto de Rendimiento (ASR-001), decidimos optar por Cache, aceptando memoria extra.
  Detalle completo: .agents/architecture/decisions/ADR-001-asr-001-rendimiento.md

Instrucciones OBLIGATORIAS sobre estas decisiones:
- Cada línea resume UNA decisión completa. Si tu implementación podría interactuar con matices no cubiertos por el resumen (restricciones colaterales, consecuencias aceptadas, riesgos ya identificados), LEÉ el archivo completo del ADR antes de continuar — no asumas que el resumen alcanza.
- NO propongas una táctica alternativa sin justificar explícitamente por qué la ya decidida no aplica a este caso puntual.`;

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
          decisionsText: DECISIONS_TEXT,
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
        decisionsText: DECISIONS_TEXT,
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
        decisionsText: DECISIONS_TEXT,
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
        decisionsText: DECISIONS_TEXT,
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

// ─── Sección DECISIONES DE ARQUITECTURA (ADRs activos) ────────────────────

test("all orchestrator prompts inject the ADR decisions block with the read-the-full-file instruction", () => {
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(
      prompt.includes("DECISIONES DE ARQUITECTURA YA TOMADAS"),
      `${name} prompt must include the architecture decisions block`,
    );
    assert.ok(
      prompt.includes("**ADR-001** (ASR-001): En el contexto de Rendimiento"),
      `${name} prompt must inline the y_statement of each active ADR`,
    );
    assert.ok(
      prompt.includes("LEÉ el archivo completo del ADR antes de continuar"),
      `${name} prompt must explicitly order reading the full ADR — '¿esto alcanza?' is never left to the model without seeing it`,
    );
    assert.ok(
      prompt.includes("NO propongas una táctica alternativa sin justificar"),
      `${name} prompt must forbid silently proposing alternative tactics`,
    );
  }
});

test("decisions block sits right after the requirements section and before the task", () => {
  const taskSectionByBuilder: Record<string, string> = {
    resolve: "## ALCANCE",
    fix: "## ALCANCE",
    review: "## LECTURA OBLIGATORIA DEL ISSUE",
    conflict: "## ARCHIVOS EN CONFLICTO",
  };
  for (const { name, build } of builders) {
    const prompt = build();
    const reqPos = prompt.indexOf("## REQUERIMIENTOS RELEVADOS");
    const decPos = prompt.indexOf("DECISIONES DE ARQUITECTURA YA TOMADAS");
    const taskPos = prompt.indexOf(taskSectionByBuilder[name]);
    assert.ok(
      reqPos > -1 && decPos > reqPos && taskPos > decPos,
      `${name} prompt must order: requirements < decisions < task`,
    );
  }
});

test("without decisions text no ADR block is emitted (projects without ADRs keep identical prompts)", () => {
  const without = {
    resolve: buildIssueResolvePrompt(
      { issueNumber: 1, title: "Issue title", body: "Body", requirementsText: REQUIREMENTS_TEXT },
      "new",
    ),
    fix: buildIssueFixPrompt({
      issueNumber: 1,
      title: "Issue title",
      body: "Body",
      prNumber: 12,
      branch: "issue-1",
      requirementsText: REQUIREMENTS_TEXT,
    }),
    review: buildIssueReviewPrompt({
      issueNumber: 1,
      title: "Issue title",
      prNumber: 12,
      branch: "issue-1",
      requirementsText: REQUIREMENTS_TEXT,
    }),
    conflict: buildResolveConflictPrompt({
      issueNumber: 1,
      title: "Issue title",
      prNumber: 12,
      branch: "issue-1",
      requirementsText: REQUIREMENTS_TEXT,
    }),
  };
  for (const [name, prompt] of Object.entries(without)) {
    assert.ok(
      !prompt.includes("DECISIONES DE ARQUITECTURA YA TOMADAS"),
      `${name} prompt must not emit the decisions block without ADR text`,
    );
  }
});
