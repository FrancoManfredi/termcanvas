import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanningPrompt } from "../src/planner/planningPrompt.ts";
import { parsePlanningPlan } from "../src/planner/parsePlanResult.ts";

const BASE = {
  mode: "roadmap" as const,
  repoPath: "C:/repo",
  outputPath: "C:/repo/.agents/planning/plan-1.json",
};

test("buildPlanningPrompt: schema incluye los campos de deduplicación", () => {
  const prompt = buildPlanningPrompt(BASE);
  assert.match(prompt, /duplicateOf/);
  assert.match(prompt, /existingIssueNumber/);
  assert.match(prompt, /DEDUPLICACIÓN ENTRE ITEMS DEL PLAN/);
  assert.match(prompt, /DEDUPLICACIÓN CONTRA EL REPO/);
});

test("buildPlanningPrompt: la sección de issues abiertos solo aparece cuando hay issues", () => {
  const without = buildPlanningPrompt(BASE);
  assert.doesNotMatch(without, /ISSUES YA ABIERTOS EN EL REPO/);

  const withIssues = buildPlanningPrompt({
    ...BASE,
    openIssues: [
      { number: 41, title: "Sidebar colapsable: el estado se pierde" },
      { number: 42, title: "Crasheo al abrir detalles" },
    ],
  });
  assert.match(withIssues, /ISSUES YA ABIERTOS EN EL REPO/);
  assert.match(withIssues, /#41 Sidebar colapsable: el estado se pierde/);
  assert.match(withIssues, /#42 Crasheo al abrir detalles/);
  assert.match(withIssues, /marcá existingIssueNumber/);
  assert.match(withIssues, /NO lo propongas como tema nuevo/);
});

test("buildPlanningPrompt: el veredicto de requerimientos solo aparece con síntesis inyectada", () => {
  const without = buildPlanningPrompt(BASE);
  assert.doesNotMatch(without, /## VEREDICTO DE REQUERIMIENTOS/);
  assert.doesNotMatch(without, /requisito-no-cumplido/);

  const withRequirements = buildPlanningPrompt({
    ...BASE,
    requirementsText: "## REQUERIMIENTOS RELEVADOS\n### RF-001 …",
  });
  assert.match(withRequirements, /## VEREDICTO DE REQUERIMIENTOS \(OBLIGATORIO\)/);
  assert.match(withRequirements, /NO_VERIFICABLE/);
  assert.match(withRequirements, /"requisito-no-cumplido"/);
  assert.match(withRequirements, /"requisitos"/);
});

test("buildPlanningPrompt: las historias de usuario son contexto, no ítems de veredicto", () => {
  const withStories = buildPlanningPrompt({
    ...BASE,
    requirementsText: "## REQUERIMIENTOS RELEVADOS\nHISTORIAS DE USUARIO\n### HS-001 …",
  });
  assert.match(withStories, /HISTORIAS DE USUARIO/);
  assert.match(withStories, /NO se evalúan como ítems de veredicto/);

  const compact = buildPlanningPrompt({
    ...BASE,
    requirementsText: "## REQUERIMIENTOS RELEVADOS\n### RF-001 …",
  });
  assert.doesNotMatch(compact, /NO se evalúan como ítems de veredicto/);
});

test("parsePlanningPlan: parsea requisitos tolerante (estados válidos, descarta inválidos)", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({
      mode: "audit",
      repo: "owner/repo",
      findings: [],
      requisitos: [
        { id: "RF-001", estado: "CUMPLE", justificacion: "implementado en src/x.ts" },
        { id: "ASR-001", estado: "NO_VERIFICABLE", justificacion: "requiere medir runtime" },
        { id: "CON-001", estado: "PARCIAL", justificacion: "falta service worker" },
        { id: "RF-999", estado: "INVENTADO", justificacion: "estado fuera de norma" },
        { id: "", estado: "CUMPLE", justificacion: "id vacío" },
      ],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.result.requisitos?.length, 3);
  assert.equal(parsed.result.requisitos?.[0].estado, "CUMPLE");
  assert.equal(parsed.result.requisitos?.[1].estado, "NO_VERIFICABLE");
  assert.equal(parsed.result.requisitos?.[2].estado, "PARCIAL");
});

test("parsePlanningPlan: planes sin requisitos no rompen (campo ausente)", () => {
  const parsed = parsePlanningPlan(
    JSON.stringify({ mode: "audit", repo: "owner/repo", findings: [] }),
  );
  assert.ok(parsed);
  assert.equal(parsed.result.requisitos, undefined);
});