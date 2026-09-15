/**
 * Ola 8 — Cableado yaml + carry-over: consumidores de config y selector by-match.
 * node:test + tsx. No toca el daemon ni muta disco productivo.
 *
 * Cubre:
 * - getTimeouts()/getDefaultModels(): yaml válido → valores del yaml;
 *   ausente/inválido → constantes (vía coerce* puros + parse estricto).
 * - Paridad con las constantes actuales (cero cambios de semántica con yaml default).
 * - Selector by-match: tabla reordenada (inyectada por parámetro vía
 *   resolveRefsFromPairs, y vía parseFactoryYaml + lookup) → mismos refs.
 * - fallbackFor intacto (los 5 casos).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FACTORY_DEFAULTS,
  coerceDefaultModels,
  coerceTimeouts,
  getDefaultModels,
  getFactoryPorts,
  getTimeouts,
  parseFactoryYaml,
  parseModelRef,
  resetFactoryConfigCache,
} from "../headless-runtime/factory/agentLoader.ts";
import {
  REVIEWER_ANTHROPIC,
  REVIEWER_DEFAULT,
  REVIEWER_GPT4O,
  REVIEWER_MUSE_SPARK,
  REVIEWER_PAIRS,
  classifyPairRole,
  fallbackFor,
  resolveRefsFromPairs,
  selectReviewerModel,
} from "../headless-runtime/review/reviewModelSelector.ts";
import { IMPLEMENT_VERIFY_TIMEOUT_MS } from "../shared/types/implement.ts";

// ── Config válida: yaml real → valores efectivos ──

test("getTimeouts con yaml válido devuelve los valores del yaml (solo verifyMs: doctrina sin-límites)", () => {
  resetFactoryConfigCache();
  assert.deepEqual(getTimeouts(), {
    verifyMs: 120000,
  });
});

test("getDefaultModels con yaml válido devuelve builder/foreman del yaml", () => {
  resetFactoryConfigCache();
  assert.deepEqual(getDefaultModels(), {
    builder: "opencode-go/muse-spark-1.3-contributor",
    foreman: "opencode-go/muse-spark-1.3-contributor",
  });
});

// ── Paridad con constantes: cero cambios de semántica con yaml default ──

test("timeouts efectivos = constantes actuales con yaml default", () => {
  resetFactoryConfigCache();
  const t = getTimeouts();
  assert.equal(t.verifyMs, IMPLEMENT_VERIFY_TIMEOUT_MS);
});

// ── Config ausente/inválida: coerción por campo cae a defaults ──

test("coerceTimeouts ausente (undefined/null/{}): cae a defaults", () => {
  assert.deepEqual(coerceTimeouts(undefined), FACTORY_DEFAULTS.timeouts);
  assert.deepEqual(coerceTimeouts(null), FACTORY_DEFAULTS.timeouts);
  assert.deepEqual(coerceTimeouts({}), FACTORY_DEFAULTS.timeouts);
});

test("coerceTimeouts inválido por campo: fallback solo del campo roto", () => {
  const coerced = coerceTimeouts({
    verifyMs: 0,
  });
  assert.equal(coerced.verifyMs, FACTORY_DEFAULTS.timeouts.verifyMs);
  assert.deepEqual(coerceTimeouts({ verifyMs: 9000 }), { verifyMs: 9000 });
});

test("coerceDefaultModels ausente o con strings vacíos: cae a defaults", () => {
  const expected = {
    builder: FACTORY_DEFAULTS.defaultModels.implement,
    foreman: FACTORY_DEFAULTS.defaultModels.foreman,
  };
  assert.deepEqual(coerceDefaultModels(undefined), expected);
  assert.deepEqual(coerceDefaultModels({}), expected);
  assert.deepEqual(coerceDefaultModels({ implement: "  ", foreman: "" }), expected);
});

test("coerceDefaultModels recorta y mapea implement→builder", () => {
  const coerced = coerceDefaultModels({
    implement: "  custom/builder-1  ",
    foreman: "custom/foreman-1",
  });
  assert.deepEqual(coerced, { builder: "custom/builder-1", foreman: "custom/foreman-1" });
});

test("parseFactoryYaml inválido lanza (timeouts no positivos, reviewer sin provider/model)", () => {
  assert.throws(
    () =>
      parseFactoryYaml(
        "ports:\n  factoryDefault: 17680\n  factoryMax: 17690\n" +
          "timeouts:\n  verifyMs: 0\n" +
          'defaultModels:\n  foreman: "a/b"\n  implement: "a/b"\n  review: "auto-disjoint"\n' +
          'reviewerPairs:\n  - match: "x"\n    reviewer: "a/b"\n' +
          "scorers:\n  samplingRate: 25\n",
      ),
    /factory\.yaml parse error/,
  );
  assert.throws(
    () =>
      parseFactoryYaml(
        "ports:\n  factoryDefault: 17680\n  factoryMax: 17690\n" +
          "timeouts:\n  verifyMs: 120000\n" +
          'defaultModels:\n  foreman: "a/b"\n  implement: "a/b"\n  review: "auto-disjoint"\n' +
          'reviewerPairs:\n  - match: "x"\n    reviewer: "sin-separador"\n' +
          "scorers:\n  samplingRate: 25\n",
      ),
    /factory\.yaml parse error/,
  );
});

// ── parseModelRef ──

test("parseModelRef válido e inválidos", () => {
  assert.deepEqual(parseModelRef("opencode-go/muse-spark-1.2-contributor"), {
    providerID: "opencode-go",
    modelID: "muse-spark-1.2-contributor",
  });
  assert.equal(parseModelRef("sin-separador"), null);
  assert.equal(parseModelRef("/vacio"), null);
  assert.equal(parseModelRef("vacio/"), null);
  assert.equal(parseModelRef(""), null);
});

// ── Selector by-match: tabla default → mismos refs que las constantes ──

test("resolveRefsFromPairs con tabla default = constantes REVIEWER_*", () => {
  const refs = resolveRefsFromPairs(REVIEWER_PAIRS);
  assert.deepEqual(refs, {
    def: REVIEWER_DEFAULT,
    spark: REVIEWER_MUSE_SPARK,
    gpt: REVIEWER_GPT4O,
    anth: REVIEWER_ANTHROPIC,
  });
});

test("classifyPairRole distingue dirección sin depender del orden", () => {
  assert.equal(classifyPairRole("muse-spark → big-pickle"), "def");
  assert.equal(classifyPairRole("big-pickle → muse-spark"), "spark");
  assert.equal(classifyPairRole("anthropic/* → gpt-4o"), "gpt");
  assert.equal(classifyPairRole("openai/* → anthropic"), "anth");
  assert.equal(classifyPairRole("cualquier otra cosa"), "default");
});

test("resolveRefsFromPairs robusto a reordenamientos del yaml", () => {
  const expected = resolveRefsFromPairs(REVIEWER_PAIRS);
  const reversed = [...REVIEWER_PAIRS].reverse();
  assert.deepEqual(resolveRefsFromPairs(reversed), expected);
  const rotated = [REVIEWER_PAIRS[2], REVIEWER_PAIRS[3], REVIEWER_PAIRS[0], REVIEWER_PAIRS[1]];
  assert.deepEqual(resolveRefsFromPairs(rotated), expected);
});

test("parseFactoryYaml con pares reordenados + lookup puro → mismos refs", () => {
  const text =
    "ports:\n  factoryDefault: 17680\n  factoryMax: 17690\n" +
    "timeouts:\n  verifyMs: 120000\n" +
    'defaultModels:\n  foreman: "opencode-go/muse-spark-1.3-contributor"\n' +
    '  implement: "opencode-go/muse-spark-1.3-contributor"\n  review: "auto-disjoint"\n' +
    "reviewerPairs:\n" +
    '  - match: "openai/* → anthropic"\n    reviewer: "anthropic/claude-sonnet-4-20250514"\n' +
    '  - match: "anthropic/* → gpt-4o"\n    reviewer: "openai/gpt-4o"\n' +
    '  - match: "big-pickle → muse-spark"\n    reviewer: "opencode-go/muse-spark-1.3-contributor"\n' +
    '  - match: "muse-spark → big-pickle"\n    reviewer: "opencode/big-pickle"\n' +
    "scorers:\n  samplingRate: 25\n";
  const cfg = parseFactoryYaml(text);
  const refs = resolveRefsFromPairs(cfg.reviewerPairs);
  assert.deepEqual(refs, {
    def: REVIEWER_DEFAULT,
    spark: REVIEWER_MUSE_SPARK,
    gpt: REVIEWER_GPT4O,
    anth: REVIEWER_ANTHROPIC,
  });
});

test("resolveRefsFromPairs con tabla parcial: roles libres caen a constantes", () => {
  const refs = resolveRefsFromPairs([{ match: "muse-spark → big-pickle", reviewer: "opencode/big-pickle" }]);
  assert.deepEqual(refs.def, REVIEWER_DEFAULT);
  assert.deepEqual(refs.spark, REVIEWER_MUSE_SPARK);
  assert.deepEqual(refs.gpt, REVIEWER_GPT4O);
  assert.deepEqual(refs.anth, REVIEWER_ANTHROPIC);
  assert.deepEqual(resolveRefsFromPairs(null), resolveRefsFromPairs(REVIEWER_PAIRS));
});

// ── Comportamiento idéntico del selector con tabla default ──

test("selectReviewerModel con yaml default: pares clásicos intactos", () => {
  resetFactoryConfigCache();
  const spark = selectReviewerModel({ providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" });
  assert.equal(spark.reviewerModel.providerID, "opencode");
  assert.equal(spark.reviewerModel.modelID, "big-pickle");
  const pickle = selectReviewerModel({ providerID: "opencode", modelID: "big-pickle" });
  assert.equal(pickle.reviewerModel.providerID, "opencode-go");
  assert.ok(pickle.reviewerModel.modelID.includes("muse-spark"));
  const anth = selectReviewerModel({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" });
  assert.deepEqual(anth.reviewerModel, { ...REVIEWER_GPT4O });
  const open = selectReviewerModel({ providerID: "openai", modelID: "gpt-4o" });
  assert.deepEqual(open.reviewerModel, { ...REVIEWER_ANTHROPIC });
});

// ── fallbackFor intacto ──

test("fallbackFor intacto: los 5 casos", () => {
  assert.deepEqual(fallbackFor({ providerID: "opencode", modelID: "big-pickle" }), {
    ...REVIEWER_MUSE_SPARK,
  });
  assert.deepEqual(
    fallbackFor({ providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" }),
    { ...REVIEWER_DEFAULT },
  );
  assert.deepEqual(fallbackFor({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }), {
    ...REVIEWER_GPT4O,
  });
  assert.deepEqual(fallbackFor({ providerID: "openai", modelID: "gpt-4o" }), {
    ...REVIEWER_ANTHROPIC,
  });
  assert.deepEqual(fallbackFor({ providerID: "desconocido", modelID: "foo-123" }), {
    ...REVIEWER_DEFAULT,
  });
});

// ——— Puertos efectivos (Ola 8, cierre H5) ———

test("getFactoryPorts con yaml válido devuelve el rango del yaml", () => {
  resetFactoryConfigCache();
  assert.deepEqual(getFactoryPorts(), { factoryDefault: 17680, factoryMax: 17690 });
});

test("getFactoryPorts nunca lanza y garantiza default <= max", () => {
  resetFactoryConfigCache();
  const p = getFactoryPorts();
  assert.ok(Number.isInteger(p.factoryDefault) && p.factoryDefault >= 1 && p.factoryDefault <= 65535);
  assert.ok(Number.isInteger(p.factoryMax) && p.factoryMax >= 1 && p.factoryMax <= 65535);
  assert.ok(p.factoryDefault <= p.factoryMax);
});
