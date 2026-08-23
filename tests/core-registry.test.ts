// Validación del registro de secciones del modal unificado.
//
// El registry es EL punto de extensión del modal (agregar fase = una entrada
// acá): estos tests garantizan que toda entrada esté completa y que los ids
// no colisionen, además de verificar el fallback de sectionById y las badges
// derivadas de la síntesis.

import test from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_GROUPS,
  SECTION_REGISTRY,
  sectionBadge,
  sectionById,
} from "../src/components/core/registry.tsx";
import type { SynthesisResult } from "../headless-runtime/interview/index.ts";

test("SECTION_REGISTRY cubre exactamente las 11 subcategorías sin duplicados", () => {
  const ids = SECTION_REGISTRY.map((def) => def.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, "ids duplicados en el registro");

  const EXPECTED = [
    "repo_context",
    "requirements_interview",
    "user_stories",
    "functional_requirements",
    "quality_attributes",
    "architecture_tactics",
    "constraints",
    "glossary",
    "planning_diagnosis",
    "planning_roadmap",
    "github_issues",
  ] as const;
  for (const expected of EXPECTED) {
    assert.ok(
      uniqueIds.has(expected),
      `falta la sección "${expected}" en el registro`,
    );
  }
  assert.equal(ids.length, EXPECTED.length, "el registro tiene secciones inesperadas");
});

test("toda entrada del registro está completa (grupo, label, icono, componente, badge)", () => {
  const validGroups = new Set(SECTION_GROUPS.map((g) => g.id));
  for (const def of SECTION_REGISTRY) {
    assert.ok(
      validGroups.has(def.group),
      `"${def.id}" pertenece al grupo inválido "${String(def.group)}"`,
    );
    assert.ok(def.label.trim().length > 0, `"${def.id}" sin label`);
    assert.equal(typeof def.Component, "function", `"${def.id}" sin Component`);
    assert.ok(
      typeof def.badge === "string" || typeof def.badge === "function",
      `"${def.id}" con badge inválido`,
    );
  }
});

test("cada grupo declarado tiene al menos una sección asignada", () => {
  for (const group of SECTION_GROUPS) {
    const count = SECTION_REGISTRY.filter((def) => def.group === group.id).length;
    assert.ok(count > 0, `el grupo "${group.id}" quedó sin secciones`);
  }
});

test("sectionById resuelve cada id y cae a functional_requirements ante desconocidos", () => {
  for (const def of SECTION_REGISTRY) {
    assert.equal(sectionById(def.id).id, def.id);
  }
  // Fallback deliberado: la subcategoría inicial de la capucha es
  // funcional_requirements (índice 3 del registro).
  const fallback = sectionById("no_existe" as never);
  assert.equal(fallback.id, "functional_requirements");
});

test("badges estáticos y derivados de síntesis devuelven strings", () => {
  for (const def of SECTION_REGISTRY) {
    const value = sectionBadge(def, { synthesis: null });
    assert.equal(typeof value, "string", `badge de "${def.id}" no es string`);
    assert.ok(value.trim().length > 0);
  }

  const synthesis = {
    historias_de_usuario: [{}, {}, {}],
    requerimientos_funcionales: [{}],
    atributos_de_calidad_y_asrs: [{ es_asr_genuino: true }, { es_asr_genuino: false }],
    restricciones_globales: [],
    glosario_de_terminos: { termino_a: "def", termino_b: "def" },
  } as unknown as SynthesisResult;

  const byId = (id: string) => sectionBadge(sectionById(id as never), { synthesis });
  assert.equal(byId("user_stories"), "3");
  assert.equal(byId("functional_requirements"), "1");
  assert.equal(byId("quality_attributes"), "2");
  // El badge de tácticas cuenta SOLO los ASR genuinos (los únicos que
  // disparan el análisis).
  assert.equal(byId("architecture_tactics"), "1");
  assert.equal(byId("constraints"), "0");
  assert.equal(byId("glossary"), "2");

  // Sin síntesis activa, las badges derivadas muestran 0 y las estáticas
  // conservan su etiqueta de fase.
  const byIdNull = (id: string) => sectionBadge(sectionById(id as never), { synthesis: null });
  assert.equal(byIdNull("user_stories"), "0");
  assert.equal(byIdNull("repo_context"), "Fase 0");
});
