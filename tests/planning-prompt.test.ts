import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanningPrompt,
  planningOutputPath,
} from "../src/planner/planningPrompt.ts";
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

test("buildPlanningPrompt: las decisiones ADR activas viajan al planner tras los requerimientos", () => {
  const without = buildPlanningPrompt(BASE);
  assert.doesNotMatch(without, /DECISIONES DE ARQUITECTURA YA TOMADAS/);

  const withAdrs = buildPlanningPrompt({
    ...BASE,
    requirementsText: "## REQUERIMIENTOS RELEVADOS\n### RF-001 …",
    decisionsText:
      "DECISIONES DE ARQUITECTURA YA TOMADAS (ADRs activos):\n\n- **ADR-001** (ASR-001): En el contexto de Rendimiento, decidimos Cache.\n\nInstrucciones OBLIGATORIAS sobre estas decisiones:\n- LEÉ el archivo completo del ADR antes de continuar.",
  });
  assert.match(withAdrs, /DECISIONES DE ARQUITECTURA YA TOMADAS/);
  assert.match(withAdrs, /\*\*ADR-001\*\* \(ASR-001\)/);
  // El planner no debe proponer issues que contradigan una decisión aceptada.
  assert.match(withAdrs, /LEÉ el archivo completo del ADR antes de continuar/);

  const reqPos = withAdrs.indexOf("## REQUERIMIENTOS RELEVADOS");
  const decPos = withAdrs.indexOf("DECISIONES DE ARQUITECTURA YA TOMADAS");
  assert.ok(decPos > reqPos, "la sección de decisiones va inmediatamente después de requerimientos");
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

// ─── Diagnóstico por categorías ───────────────────────────────────────────

const AUDIT_BASE = { ...BASE, mode: "audit" as const };

test("categoría con hallazgos: agrega la regla de foco y mantiene la sección de herramientas", () => {
  const prompt = buildPlanningPrompt({
    ...AUDIT_BASE,
    category: "documentacion",
    toolFindingsText: "### eslint (root) — 2 hallazgo(s)",
  });
  assert.match(prompt, /REGLA DE FOCO \(categoría «Documentación»\)/);
  assert.match(prompt, /FUERA DE ALCANCE/);
  assert.match(prompt, /otro diagnóstico por categoría los cubre/);
  assert.match(prompt, /HALLAZGOS DE HERRAMIENTAS DETERMINISTICAS/);
});

test("categoría LLM-only: exploración dirigida reemplaza a la auditoría clásica", () => {
  const prompt = buildPlanningPrompt({
    ...AUDIT_BASE,
    category: "proteccion",
  });
  assert.match(prompt, /DIAGNÓSTICO SIN HERRAMIENTAS DETERMINISTICAS/);
  assert.match(prompt, /tolerancia a fallos/i);
  // El camino clásico de "leé todo el repo" NO debe aparecer: sin foco sería
  // exactamente el ruido que el feature elimina.
  assert.doesNotMatch(prompt, /TAREA: AUDITORÍA DE REPOSITORIO/);
});

test("veredicto por categoría: SOLO requerimientos lo emite; roadmap queda igual", () => {
  const requirementsText = "## REQUERIMIENTOS RELEVADOS\n### RF-001 …";

  const seguridad = buildPlanningPrompt({
    ...AUDIT_BASE,
    category: "seguridad",
    requirementsText,
  });
  assert.doesNotMatch(seguridad, /## VEREDICTO DE REQUERIMIENTOS/);

  const requerimientos = buildPlanningPrompt({
    ...AUDIT_BASE,
    category: "requerimientos",
    requirementsText,
  });
  assert.match(requerimientos, /## VEREDICTO DE REQUERIMIENTOS \(OBLIGATORIO\)/);
});

test("metodología inyectada: el cuerpo de diag-<id> viaja INLINE en ambas ramas con categoría", () => {
  // Rama pipeline (con herramientas): la metodología va junto a la regla de foco.
  const withTools = buildPlanningPrompt({
    ...AUDIT_BASE,
    category: "seguridad",
    toolFindingsText: "### gitleaks (root) — 1 hallazgo(s)",
  });
  assert.match(withTools, /## METODOLOGÍA DE LA CATEGORÍA/);
  assert.match(withTools, /skill diag-seguridad/);
  // Contenido DISTINTIVO del body real (no un placeholder): garantiza que se
  // inyecta el cuerpo del registro y no un stub.
  assert.match(withTools, /Hardening del BrowserWindow/);
  assert.match(withTools, /Estándar de evidencia/);

  // Rama LLM-only: misma inyección.
  const llmOnly = buildPlanningPrompt({
    ...AUDIT_BASE,
    category: "proteccion",
  });
  assert.match(llmOnly, /## METODOLOGÍA DE LA CATEGORÍA/);
  assert.match(llmOnly, /skill diag-proteccion/);
  assert.match(llmOnly, /Idempotencia del retry/);

  // Sin categoría (roadmap o audit legacy) la sección NO existe.
  assert.doesNotMatch(buildPlanningPrompt(BASE), /METODOLOGÍA DE LA CATEGORÍA/);
  assert.doesNotMatch(
    buildPlanningPrompt({ ...AUDIT_BASE }),
    /METODOLOGÍA DE LA CATEGORÍA/,
  );
});

test("skills vendor: anuncio por nombre SOLO cuando la corrida las descubrió", () => {
  const withVendor = buildPlanningPrompt({
    ...AUDIT_BASE,
    category: "rendimiento",
    vendorSkillNames: ["accelint-ts-performance", "mi-checklist"],
  });
  assert.match(withVendor, /## SKILLS ADICIONALES DE LA CATEGORÍA/);
  assert.match(withVendor, /accelint-ts-performance, mi-checklist/);
  assert.match(withVendor, /Cargá TODAS con tu herramienta skill ANTES de comenzar/);
  // El cuerpo vendor NO se inyecta al prompt (van como skills scopeadas).
  assert.ok(!withVendor.includes("frontmatter crudo"));

  // Sin vendor: ni rastro de la sección.
  const withoutVendor = buildPlanningPrompt({
    ...AUDIT_BASE,
    category: "rendimiento",
  });
  assert.doesNotMatch(withoutVendor, /SKILLS ADICIONALES DE LA CATEGORÍA/);
});

test("planningOutputPath: audit con categoría escribe diagnostico-<categoria>-<ts>.json", () => {
  const byCategory = planningOutputPath("C:/repo", "audit", "seguridad");
  assert.ok(/diagnostico-seguridad-\d+\.json$/.test(byCategory));

  const roadmap = planningOutputPath("C:/repo", "roadmap");
  assert.ok(/plan-\d+\.json$/.test(roadmap));

  // Defensivo: audit sin categoría cae al nombre legacy.
  const legacy = planningOutputPath("C:/repo", "audit");
  assert.ok(/diagnostico-\d+\.json$/.test(legacy));
});