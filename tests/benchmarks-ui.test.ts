import test from "node:test";
import assert from "node:assert/strict";
import {
  BENCHMARK_MAX_TRIALS,
  benchmarkRunUrl,
  benchmarksUrl,
  formatDuration,
  formatPassRate,
  formatRunDate,
  isRunningStatus,
  normalizeBenchmarkDefinition,
  normalizeReviewerModel,
  parseRunDetail,
  parseRunsList,
  statusLabel,
  totalCalls,
  trialBadge,
  validateDefinitionInput,
} from "../src/features/factoryLab/components/benchmarksUi.ts";

// Helpers puros del BenchmarksPanel (Ola 12). El .tsx NO se testea sin harness:
// requiere React + fetch + discoverFactoryPort contra el daemon real, así que
// se verifica por lectura (defensivo: parsers nunca throw, "sin datos"/"—"
// ante cualquier forma inesperada; polling lista 15s, detalle 5s solo si
// running; sin ningún campo de ganador/sugerencia en ningún lado).

const TFILE = [{ path: "demo/nota.md", content: "# Demo" }];

const VALID_DEF = JSON.stringify({
  name: "demo",
  tasks: [
    {
      id: "t1",
      prompt: "crear nota demo",
      files: TFILE,
      verification: { overall: "pass" },
      expectedVerdict: "accept",
    },
  ],
  configs: [{ id: "c1", reviewerModel: "opencode/big-pickle" }],
  repetitions: 2,
});

// ── formatPassRate ──

test("null o trials=0 → —", () => {
  assert.equal(formatPassRate(null), "—");
  assert.equal(formatPassRate(undefined), "—");
  assert.equal(formatPassRate({ trials: 0, pass: 0 }), "—");
});

test("normal → NN% (p/N)", () => {
  assert.equal(formatPassRate({ trials: 4, pass: 3 }), "75% (3/4)");
  assert.equal(formatPassRate({ trials: 2, pass: 2 }), "100% (2/2)");
  assert.equal(formatPassRate({ trials: 2, pass: 0 }), "0% (0/2)");
});

test("redondea el porcentaje", () => {
  assert.equal(formatPassRate({ trials: 3, pass: 1 }), "33% (1/3)");
  assert.equal(formatPassRate({ trials: 3, pass: 2 }), "67% (2/3)");
});

// ── formatDuration ──

test("null/inválido/negativo → —", () => {
  assert.equal(formatDuration(null), "—");
  assert.equal(formatDuration(undefined), "—");
  assert.equal(formatDuration(Number.NaN), "—");
  assert.equal(formatDuration(-5), "—");
});

test("<1000ms → Nms", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(250), "250ms");
  assert.equal(formatDuration(999), "999ms");
});

test(">=1000ms → Ns (1 decimal si hace falta)", () => {
  assert.equal(formatDuration(1000), "1s");
  assert.equal(formatDuration(2000), "2s");
  assert.equal(formatDuration(1500), "1.5s");
});

// ── trialBadge ──

test("parseOk false → error aunque pass sea true", () => {
  assert.equal(trialBadge({ pass: true, parseOk: false }), "error");
  assert.equal(trialBadge({ pass: false, parseOk: false }), "error");
});

test("pass true (parse ok) → pass", () => {
  assert.equal(trialBadge({ pass: true, parseOk: true }), "pass");
});

test("resto → fail (incluido null)", () => {
  assert.equal(trialBadge({ pass: false, parseOk: true }), "fail");
  assert.equal(trialBadge(null), "fail");
  assert.equal(trialBadge(undefined), "fail");
});

// ── totalCalls ──

test("tasks × configs × reps", () => {
  assert.equal(
    totalCalls({ tasks: [{}, {}], configs: [{}, {}, {}], repetitions: 2 }),
    12,
  );
});

test("forma inválida → 0, nunca throw", () => {
  assert.equal(totalCalls(null), 0);
  assert.equal(totalCalls(undefined), 0);
  assert.equal(totalCalls({}), 0);
  assert.equal(totalCalls({ tasks: [], configs: [{}], repetitions: 1 }), 0);
  assert.equal(totalCalls({ tasks: [{}], configs: [{}], repetitions: 0 }), 0);
});

// ── validateDefinitionInput: válido ──

test("definition válida → ok con summary y trials", () => {
  const v = validateDefinitionInput(VALID_DEF);
  assert.equal(v.ok, true);
  assert.deepEqual(v.ok ? v.summary : null, {
    name: "demo",
    tasks: 1,
    configs: 1,
    repetitions: 2,
    trials: 2,
  });
});

// ── validateDefinitionInput: inválidos ──

test("string vacío → error en español", () => {
  const v = validateDefinitionInput("   ");
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /pegá/i);
});

test("JSON roto → error accionable", () => {
  const v = validateDefinitionInput('{"name":');
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /JSON inválido/i);
});

test("sin name → error", () => {
  const v = validateDefinitionInput(JSON.stringify({ tasks: [], configs: [], repetitions: 1 }));
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /name/i);
});

test("sin tasks → error", () => {
  const v = validateDefinitionInput(
    JSON.stringify({
      name: "x",
      tasks: [],
      configs: [{ id: "c1", reviewerModel: "m" }],
      repetitions: 1,
    }),
  );
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /tasks/i);
});

test("task sin expectedVerdict válido → error", () => {
  const v = validateDefinitionInput(
    JSON.stringify({
      name: "x",
      tasks: [{ id: "t1", prompt: "p", files: TFILE, expectedVerdict: "maybe" }],
      configs: [{ id: "c1", reviewerModel: "m" }],
      repetitions: 1,
    }),
  );
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /expectedVerdict/i);
});

test("sin configs → error", () => {
  const v = validateDefinitionInput(
    JSON.stringify({
      name: "x",
      tasks: [{ id: "t1", prompt: "p", files: TFILE, expectedVerdict: "accept" }],
      configs: [],
      repetitions: 1,
    }),
  );
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /configs/i);
});

test("config sin reviewerModel → error", () => {
  const v = validateDefinitionInput(
    JSON.stringify({
      name: "x",
      tasks: [{ id: "t1", prompt: "p", files: TFILE, expectedVerdict: "accept" }],
      configs: [{ id: "c1" }],
      repetitions: 1,
    }),
  );
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /reviewerModel/i);
});

test("repetitions fuera de 1..3 → error", () => {
  for (const reps of [0, 4, 1.5]) {
    const v = validateDefinitionInput(
      JSON.stringify({
        name: "x",
      tasks: [{ id: "t1", prompt: "p", files: TFILE, expectedVerdict: "accept" }],
      configs: [{ id: "c1", reviewerModel: "opencode/big-pickle" }],
        repetitions: reps,
      }),
    );
    assert.equal(v.ok, false);
    assert.match(v.ok ? "" : v.error, /repetitions/i);
  }
});

test("cap 50 trials → error que dice cómo reducir", () => {
  const tasks = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`,
    prompt: "p",
    files: TFILE,
    expectedVerdict: "accept",
  }));
  const configs = Array.from({ length: 3 }, (_, i) => ({
    id: `c${i}`,
    reviewerModel: "opencode/big-pickle",
  }));
  const v = validateDefinitionInput(
    JSON.stringify({ name: "big", tasks, configs, repetitions: 2 }),
  );
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, new RegExp(String(BENCHMARK_MAX_TRIALS)));
  assert.match(v.ok ? "" : v.error, /reducí/i);
});

// ── parsers/URLs/status (soporte del panel, defensivos) ──

test("parseRunsList: forma inesperada → []", () => {
  assert.deepEqual(parseRunsList(null), []);
  assert.deepEqual(parseRunsList({}), []);
  assert.deepEqual(parseRunsList({ runs: "no" }), []);
});

test("parseRunDetail: sin id → null; válido → detalle", () => {
  assert.equal(parseRunDetail(null), null);
  assert.equal(parseRunDetail({}), null);
  const d = parseRunDetail({ id: "b1", name: "n", status: "running", trials: [], stats: {} });
  assert.equal(d?.id, "b1");
  assert.equal(d?.trials.length, 0);
});

test("statusLabel e isRunningStatus", () => {
  assert.equal(statusLabel("running"), "en curso");
  assert.equal(statusLabel("done"), "listo");
  assert.equal(statusLabel(null), "sin datos");
  assert.equal(isRunningStatus("running"), true);
  assert.equal(isRunningStatus("done"), false);
});

test("urls usan el port dado (sin hardcodeo)", () => {
  assert.equal(benchmarksUrl(17681), "http://127.0.0.1:17681/factory/benchmarks");
  assert.equal(benchmarkRunUrl(17681, "b1"), "http://127.0.0.1:17681/factory/benchmarks/b1");
});

test("formatRunDate inválida → —", () => {
  assert.equal(formatRunDate(null), "—");
  assert.equal(formatRunDate("no-fecha"), "—");
});

test("normalizeReviewerModel: string y objeto → {providerID, modelID}", () => {
  assert.deepEqual(normalizeReviewerModel("opencode/big-pickle"), {
    providerID: "opencode",
    modelID: "big-pickle",
  });
  assert.deepEqual(
    normalizeReviewerModel({ providerID: "opencode", modelID: "big-pickle" }),
    { providerID: "opencode", modelID: "big-pickle" },
  );
  assert.equal(normalizeReviewerModel("m"), null);
  assert.equal(normalizeReviewerModel(""), null);
  assert.equal(normalizeReviewerModel(null), null);
});

test("normalizeBenchmarkDefinition: string → objeto, inválido → null", () => {
  const norm = normalizeBenchmarkDefinition(JSON.parse(VALID_DEF));
  assert.ok(norm);
  assert.deepEqual(
    (norm?.configs as Array<Record<string, unknown>>)[0]?.reviewerModel,
    { providerID: "opencode", modelID: "big-pickle" },
  );
  assert.equal(normalizeBenchmarkDefinition(null), null);
  assert.equal(normalizeBenchmarkDefinition({ configs: [{ id: "c1" }] }), null);
});
