import test from "node:test";
import assert from "node:assert/strict";
import {
  DIAGNOSIS_CATEGORIES,
  LEGACY_CATEGORY_ID,
  categoryLabel,
  diagnosisFileName,
  legacyDiagnosisFileName,
  parseDiagnosisFileName,
} from "../src/types/diagnosisCategories.ts";
import {
  CATEGORY_TOOLS,
} from "../scripts/run-diagnostico-tools.mjs";

// El registro de categorías es la fuente de verdad compartida por UI, prompt
// y store; el orquestador (scripts/run-diagnostico-tools.mjs) tiene su espejo
// EJECUTABLE (CATEGORY_TOOLS). Estos tests fijan la integridad del registro
// y la sincronización entre ambos lados.

const LLM_ONLY = new Set(["proteccion", "rendimiento", "requerimientos"]);

test("registro: ids únicos y slug seguro para filenames", () => {
  const ids = DIAGNOSIS_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    // Sin dígitos: garantiza que diagnostico-<slug>-<ts>.json no sea
    // ambiguo con el legacy diagnostico-<ts>.json.
    assert.match(id, /^[a-z][a-z-]*$/, `id inválido: ${id}`);
    assert.ok(!/\d/.test(id), `el id ${id} no debe contener dígitos`);
  }
});

test("registro: categoría con herramientas ⇔ no LLM-only (y las 8 existen)", () => {
  assert.equal(DIAGNOSIS_CATEGORIES.length, 8);
  for (const cat of DIAGNOSIS_CATEGORIES) {
    if (LLM_ONLY.has(cat.id)) {
      assert.deepEqual(cat.tools, [], `${cat.id} debe ser LLM-only`);
    } else {
      assert.ok(cat.tools.length > 0, `${cat.id} debe tener herramientas`);
    }
    assert.ok(cat.scopeIn.trim().length > 0);
    assert.ok(cat.scopeOut.trim().length > 0);
    assert.ok(cat.description.trim().length > 0);
  }
});

test("sincronización: CATEGORY_TOOLS del orquestador refleja el registro TS", () => {
  assert.deepEqual(
    Object.keys(CATEGORY_TOOLS).sort(),
    DIAGNOSIS_CATEGORIES.map((c) => c.id).sort(),
  );
  for (const cat of DIAGNOSIS_CATEGORIES) {
    assert.deepEqual(
      [...CATEGORY_TOOLS[cat.id]].sort(),
      [...cat.tools].sort(),
      `las herramientas de ${cat.id} divergen entre el registro y el orquestador`,
    );
  }
});

test("labels: categoría válida → label; legacy/desconocida → General", () => {
  assert.equal(categoryLabel("seguridad"), "Seguridad");
  assert.equal(categoryLabel(null), "General");
  assert.equal(categoryLabel(undefined), "General");
  assert.equal(categoryLabel("categoria-inexistente"), "General");
  assert.notEqual(categoryLabel(LEGACY_CATEGORY_ID), "");
});

test("filenames de diagnóstico: roundtrip con y sin categoría", () => {
  assert.equal(diagnosisFileName("seguridad", 1756), "diagnostico-seguridad-1756.json");
  assert.equal(legacyDiagnosisFileName(1756), "diagnostico-1756.json");

  assert.deepEqual(parseDiagnosisFileName("diagnostico-seguridad-1756.json"), {
    category: "seguridad",
    ts: 1756,
  });

  // Slug compuesto con guiones: no se confunde ni trunca contra el timestamp.
  assert.deepEqual(parseDiagnosisFileName("diagnostico-buenas-practicas-42.json"), {
    category: "buenas-practicas",
    ts: 42,
  });

  assert.deepEqual(parseDiagnosisFileName("diagnostico-1756.json"), {
    category: null,
    ts: 1756,
  });

  // Nombres de otros artefactos NO matchean.
  assert.equal(parseDiagnosisFileName("plan-1756.json"), null);
  assert.equal(parseDiagnosisFileName("tool-findings-1.json"), null);
  assert.equal(parseDiagnosisFileName("tool-findings-seguridad-1.json"), null);
});
