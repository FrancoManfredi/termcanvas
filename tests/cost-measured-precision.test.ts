/**
 * cost-measured-precision — fix #69 (tokens precisos + anti-acumulado).
 *
 * - `recordRealUsage` con reportes ACUMULADOS (monótonos) registra el delta,
 *   no suma el acumulado entero (inflaba ~2x el total del job).
 * - Deltas reales (no monótonos) se suman tal cual.
 * - `buildActualSummary` sin costo del server: fallback a rates SIN caché
 *   (el yaml no tiene columnas de caché; sumarla inventaba USD).
 * - Display: el total medido es in+out+reasoning; la caché va aparte
 *   (cubierto en CostBadge/ActivityPanel por construcción; acá se fija la
 *   fórmula con los números del caso #69).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildActualSummary,
  getActualSummaryForJob,
  recordRealUsage,
  resetCostTracker,
  setCostTrackingOverrideForTests,
  resetCostTrackingOverrideForTests,
} from "../headless-runtime/cost/costTracker.ts";

test.beforeEach(() => {
  resetCostTracker();
  setCostTrackingOverrideForTests(true);
});

test.afterEach(() => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
});

test("precision: reportes acumulados registran el delta (no N*acumulado)", () => {
  // Turno 1 (acumulado == delta la primera vez).
  recordRealUsage("job-prec-a", {
    input: 27479,
    output: 153,
    reasoning: 0,
    cacheRead: 1792,
    cacheWrite: 0,
    cost: 0.001,
  });
  // Turno 2 llega como ACUMULADO de sesión (todo no-decrece, algo crece).
  recordRealUsage("job-prec-a", {
    input: 31173,
    output: 435,
    reasoning: 0,
    cacheRead: 31040,
    cacheWrite: 0,
    cost: 0.0025,
  });
  const s = getActualSummaryForJob("job-prec-a");
  assert.ok(s);
  assert.equal(s.calls, 2);
  assert.equal(s.inputTokens, 31173);
  assert.equal(s.outputTokens, 435);
  assert.equal(s.cacheReadTokens, 31040);
  // Costo acumulado también por delta: 0.0025 total, no 0.0035.
  assert.ok(s.usd !== null && Math.abs(s.usd - 0.0025) < 1e-12, String(s.usd));
  assert.equal(s.usdSource, "server");
});

test("precision: el anti-acumulado es por sesión, no por job", () => {
  // Dos sesiones del mismo job informan sus propios acumulados: la sesión B
  // NO se descuenta contra la A (eso corrompía el cálculo multi-sesión).
  recordRealUsage("job-prec-sess", {
    input: 50000,
    output: 1000,
    reasoning: 100,
    cacheRead: 200000,
    cacheWrite: 0,
    cost: 0.005,
  }, "ses_A");
  recordRealUsage("job-prec-sess", {
    input: 30000,
    output: 500,
    reasoning: 50,
    cacheRead: 100000,
    cacheWrite: 0,
    cost: 0.003,
  }, "ses_B");
  const s = getActualSummaryForJob("job-prec-sess");
  assert.ok(s);
  assert.equal(s.calls, 2);
  assert.equal(s.inputTokens, 80000);
  assert.equal(s.cacheReadTokens, 300000);
  assert.ok(s.usd !== null && Math.abs(s.usd - 0.008) < 1e-12, String(s.usd));
});

test("precision: misma sesión con acumulados descuenta el delta", () => {
  recordRealUsage("job-prec-sess2", {
    input: 10000,
    output: 200,
    reasoning: 20,
    cacheRead: 50000,
    cacheWrite: 0,
    cost: 0.001,
  }, "ses_X");
  recordRealUsage("job-prec-sess2", {
    input: 25000,
    output: 400,
    reasoning: 40,
    cacheRead: 120000,
    cacheWrite: 0,
    cost: 0.0025,
  }, "ses_X");
  const s = getActualSummaryForJob("job-prec-sess2");
  assert.ok(s);
  assert.equal(s.calls, 2);
  assert.equal(s.inputTokens, 25000);
  assert.equal(s.outputTokens, 400);
  assert.equal(s.cacheReadTokens, 120000);
  assert.ok(s.usd !== null && Math.abs(s.usd - 0.0025) < 1e-12, String(s.usd));
});

test("precision: sin sessionId se mantiene la compat por job", () => {
  recordRealUsage("job-prec-legacy", {
    input: 1000,
    output: 100,
    reasoning: 10,
    cacheRead: 5000,
    cacheWrite: 0,
    cost: 0.001,
  });
  recordRealUsage("job-prec-legacy", {
    input: 200,
    output: 50,
    reasoning: 5,
    cacheRead: 100,
    cacheWrite: 0,
    cost: 0.0005,
  });
  const s = getActualSummaryForJob("job-prec-legacy");
  assert.ok(s);
  assert.equal(s.inputTokens, 1200);
});

test("precision: deltas reales se suman tal cual", () => {
  recordRealUsage("job-prec-b", {
    input: 1000,
    output: 100,
    reasoning: 10,
    cacheRead: 5000,
    cacheWrite: 0,
    cost: 0.001,
  });
  // No monótono (input baja) → es un delta, se suma entero.
  recordRealUsage("job-prec-b", {
    input: 200,
    output: 50,
    reasoning: 5,
    cacheRead: 100,
    cacheWrite: 0,
    cost: 0.0005,
  });
  const s = getActualSummaryForJob("job-prec-b");
  assert.ok(s);
  assert.equal(s.inputTokens, 1200);
  assert.equal(s.outputTokens, 150);
  assert.equal(s.cacheReadTokens, 5100);
  assert.ok(s.usd !== null && Math.abs(s.usd - 0.0015) < 1e-12, String(s.usd));
});

test("precision: fallback a rates excluye la caché", () => {
  const built = buildActualSummary(
    {
      calls: 1,
      input: 158126,
      output: 9938,
      reasoning: 2008,
      cacheRead: 918291,
      cacheWrite: 0,
      serverUsd: null,
    },
    { inputUSDper1M: 1, outputUSDper1M: 1 },
  );
  assert.ok(built);
  // (158126 in + (9938+2008) out) / 1M = 0.170072. Con caché sumada daría
  // ~1.088, el bug que inflaba el USD del caso #69.
  assert.ok(
    built.usd !== null && Math.abs(built.usd - 0.170072) < 1e-9,
    String(built.usd),
  );
  assert.equal(built.usdSource, "rates");
});

test("precision: caso #69, total sin caché ≈170k (no ~1M ni ~432k inflado)", () => {
  recordRealUsage("job-prec-69", {
    input: 158126,
    output: 9938,
    reasoning: 2008,
    cacheRead: 918291,
    cacheWrite: 0,
    cost: 0.006694666,
  });
  const s = getActualSummaryForJob("job-prec-69");
  assert.ok(s);
  const totalSinCache = s.inputTokens + s.outputTokens + s.reasoningTokens;
  assert.equal(totalSinCache, 170072);
  const totalConCache =
    totalSinCache + s.cacheReadTokens + s.cacheWriteTokens;
  assert.equal(totalConCache, 1088363);
  // El display debe usar totalSinCache con la caché aparte; el server USD
  // manda igual (0.006694666, el del export real del reviewer).
  assert.equal(s.usd, 0.006694666);
});
