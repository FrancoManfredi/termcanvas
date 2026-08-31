// Tests del contrato de routing de modelos por fase (shared/phaseModels.ts).
// Puros: sin server, sin modelo, sin fs. Cubren fidelidad de defaults,
// precedencia de resolución, formato/parseo "provider/model" y sanitización
// de la config persistida.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PHASE_IDS,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PROVIDER_ID,
  DEFAULT_MODEL_ID,
  HEAVY_MODEL_ID,
  SYNTHESIS_VARIANT,
  isPhaseId,
  isModelRef,
  resolveModelForPhase,
  formatModelRef,
  parseModelRef,
  sanitizePhaseModels,
  type PhaseId,
} from "../shared/phaseModels.ts";

test("PHASE_IDS cubre las 7 fases del plan y no tiene duplicados", () => {
  assert.equal(PHASE_IDS.length, 7);
  assert.equal(new Set(PHASE_IDS).size, PHASE_IDS.length);
});

test("isPhaseId acepta solo claves del contrato", () => {
  for (const id of PHASE_IDS) assert.equal(isPhaseId(id), true);
  assert.equal(isPhaseId("noExiste"), false);
  assert.equal(isPhaseId("__proto__"), false);
  assert.equal(isPhaseId(42), false);
  assert.equal(isPhaseId(null), false);
});

test("defaults fieles a la conducta actual del motor (SDK)", () => {
  // Turnos: opencode-go/hy3 sin variant.
  for (const fase of ["brief", "requirements", "asrReview", "tactics"] as PhaseId[]) {
    const ref = DEFAULT_PHASE_MODELS[fase];
    assert.deepEqual(ref, { providerID: DEFAULT_PROVIDER_ID, modelID: DEFAULT_MODEL_ID });
    assert.equal(ref?.variant, undefined);
  }
  // Síntesis: heavy + variant max.
  assert.deepEqual(DEFAULT_PHASE_MODELS.synthesis, {
    providerID: DEFAULT_PROVIDER_ID,
    modelID: HEAVY_MODEL_ID,
    variant: SYNTHESIS_VARIANT,
  });
  // Gap-check: heavy SIN variant.
  assert.deepEqual(DEFAULT_PHASE_MODELS.gapCheck, {
    providerID: DEFAULT_PROVIDER_ID,
    modelID: HEAVY_MODEL_ID,
  });
});

test("default de diagnóstico: null = sin pin (usa default global de opencode)", () => {
  assert.equal(DEFAULT_PHASE_MODELS.diagnosisLlm, null);
});

test("resolveModelForPhase: el override del usuario gana al default", () => {
  const override = { providerID: "anthropic", modelID: "claude-sonnet-4-6" };
  const resolved = resolveModelForPhase("requirements", {
    requirements: override,
  });
  assert.deepEqual(resolved, override);
});

test("resolveModelForPhase: sin overrides devuelve el default de la fase", () => {
  assert.deepEqual(resolveModelForPhase("synthesis"), DEFAULT_PHASE_MODELS.synthesis);
  assert.deepEqual(resolveModelForPhase("gapCheck"), DEFAULT_PHASE_MODELS.gapCheck);
});

test("resolveModelForPhase: diagnóstico sin override resuelve null", () => {
  assert.equal(resolveModelForPhase("diagnosisLlm"), null);
});

test("resolveModelForPhase: overrides null/undefined se tratan igual", () => {
  assert.deepEqual(
    resolveModelForPhase("brief", null),
    resolveModelForPhase("brief"),
  );
  assert.deepEqual(
    resolveModelForPhase("brief", undefined),
    resolveModelForPhase("brief"),
  );
});

test("formatModelRef produce provider/model y descarta variant del formato", () => {
  assert.equal(formatModelRef({ providerID: "opencode-go", modelID: "hy3" }), "opencode-go/hy3");
  assert.equal(
    formatModelRef({ providerID: "opencode-go", modelID: HEAVY_MODEL_ID, variant: "max" }),
    `opencode-go/${HEAVY_MODEL_ID}`,
  );
});

test("parseModelRef acepta provider/model y rechaza basura sin lanzar", () => {
  assert.deepEqual(parseModelRef("opencode-go/hy3"), {
    providerID: "opencode-go",
    modelID: "hy3",
  });
  assert.equal(parseModelRef("sin-barra"), null);
  assert.equal(parseModelRef("/hy3"), null);
  assert.equal(parseModelRef("opencode-go/"), null);
  assert.equal(parseModelRef("a/b/c"), null);
  assert.equal(parseModelRef(""), null);
});

test("parseModelRef y formatModelRef hacen round-trip", () => {
  const original = { providerID: "anthropic", modelID: "claude-sonnet-4-6" };
  assert.deepEqual(parseModelRef(formatModelRef(original)), original);
});

test("isModelRef valida forma completa", () => {
  assert.equal(isModelRef({ providerID: "p", modelID: "m" }), true);
  assert.equal(isModelRef({ providerID: "p", modelID: "m", variant: "max" }), true);
  assert.equal(isModelRef({ providerID: "", modelID: "m" }), false);
  assert.equal(isModelRef({ providerID: "p", modelID: "" }), false);
  assert.equal(isModelRef({ providerID: "p" }), false);
  assert.equal(isModelRef({ providerID: "p", modelID: "m", variant: 42 }), false);
  assert.equal(isModelRef(null), false);
  assert.equal(isModelRef("opencode-go/hy3"), false);
});

test("sanitizePhaseModels conserva entradas válidas y descarta el resto", () => {
  const sanitized = sanitizePhaseModels({
    requirements: { providerID: "openai", modelID: "gpt-5.2" },
    synthesis: { providerID: "opencode-go", modelID: HEAVY_MODEL_ID, variant: "max" },
    // Clave desconocida: fuera.
    inventada: { providerID: "x", modelID: "y" },
    // Entrada malformada: fuera.
    brief: { providerID: "", modelID: "hy3" },
    gapCheck: "opencode-go/deepseek-v4-flash",
    asrReview: null,
    // Clave computada: simula la propia-property "__proto__" que produce
    // JSON.parse (el literal con __proto__: setearía el prototipo, no la
    // crearía, y el caso real nunca se ejercitaría).
    ["__proto__"]: { providerID: "evil", modelID: "evil" },
  });
  assert.deepEqual(sanitized, {
    requirements: { providerID: "openai", modelID: "gpt-5.2" },
    synthesis: {
      providerID: "opencode-go",
      modelID: HEAVY_MODEL_ID,
      variant: "max",
    },
  });
});

test("sanitizePhaseModels con basura no-lanza y devuelve vacío", () => {
  assert.deepEqual(sanitizePhaseModels(null), {});
  assert.deepEqual(sanitizePhaseModels(undefined), {});
  assert.deepEqual(sanitizePhaseModels("texto"), {});
  assert.deepEqual(sanitizePhaseModels(42), {});
  assert.deepEqual(sanitizePhaseModels([]), {});
});
