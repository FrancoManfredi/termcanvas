/**
 * F4-T1 — cost rates + USD math (offline, zero network).
 *
 * Covers (PLAN-100 PARIDAD section 4.4, F4-T1):
 * - rates shape: CostRateSchema accepts zero/positive entries and rejects
 *   negative, non-finite, mistyped, unknown-key and missing-field shapes.
 * - USD math: exact per-1M formula on both legs; honest zero only with a
 *   real rate and zero usage; null without a (valid) rate.
 * - rates lookup: exact trimmed-key hit; blanks, unknowns and broken
 *   entries yield null rate + null ref.
 * - basis string: every estimate carries "estimated-chars/4".
 * - no-USD-without-rate: without a rate the estimate is null USD + null
 *   ref (NEVER 0.00 as data); CostSummarySchema pins USD <-> ratesRef
 *   together in both directions.
 * - validator: the repo factory.yaml yields zero yaml-cost-rates errors;
 *   a broken entry shouts with file:line.
 *
 * FU-4: the repo factory.yaml now ships 27 user-confirmed tariffs
 * (source https://opencode.ai/docs/go/, base-tier only) + ratesAsOf /
 * ratesSource seals. New pins: spark math, grok base-tier, the exact
 * 27-key set, seal formats, and malformed-seal shouting. Tests that
 * assumed `costRates:{}` were evolved, not deleted (see notes inline).
 *
 * Offline: reads only the repo factory.yaml plus synthetic tables. Every
 * test declares an explicit timeout. ESM, zero require().
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COST_ESTIMATE_BASIS,
  calcUSD,
  estimateCostForModel,
  getCostSummary,
  lookupCostRate,
  pickCostRate,
  recordLlmCall,
  resetCostTracker,
  resetCostTrackingOverrideForTests,
  resolveSingleCostRate,
} from "../headless-runtime/cost/costTracker.ts";
import {
  CostRateSchema,
  validateCostRateEntry,
  validateDefinition,
} from "../headless-runtime/factory/definitionValidate.ts";
import {
  FactoryConfigError,
  getFactoryConfig,
  parseFactoryYaml,
  resetFactoryConfigCache,
} from "../headless-runtime/factory/agentLoader.ts";
import { CostSummarySchema } from "../shared/types/workItem.ts";

function freshJobId(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `job-f4-rates-${tag}-${rand}`.toLowerCase().replace(/[^a-z0-9-]/g, "x");
}

// ── Rates shape ──

test("rates shape: zero and positive entries pass CostRateSchema", { timeout: 15000 }, () => {
  assert.doesNotThrow(() =>
    CostRateSchema.parse({ inputUSDper1M: 0, outputUSDper1M: 0 }),
  );
  assert.doesNotThrow(() =>
    CostRateSchema.parse({ inputUSDper1M: 2.5, outputUSDper1M: 10 }),
  );
});

test("rates shape: negative, non-finite, mistyped, unknown or missing fields fail", { timeout: 15000 }, () => {
  const badShapes: unknown[] = [
    { inputUSDper1M: -1, outputUSDper1M: 2 },
    { inputUSDper1M: 1, outputUSDper1M: -0.5 },
    { inputUSDper1M: 1, outputUSDper1M: Number.NaN },
    { inputUSDper1M: Number.POSITIVE_INFINITY, outputUSDper1M: 0 },
    { inputUSDper1M: "2", outputUSDper1M: 1 },
    { inputUSDper1M: 1, outputUSDper1M: 1, perCall: 5 },
    { inputUSDper1M: 1 },
    {},
    null,
  ];
  for (const bad of badShapes) {
    assert.equal(
      CostRateSchema.safeParse(bad).success,
      false,
      `must reject ${String(JSON.stringify(bad))}`,
    );
  }
});

// ── USD math ──

test("USD math: exact per-1M formula on both legs", { timeout: 15000 }, () => {
  const usd = calcUSD(250_000, 100_000, { inputUSDper1M: 3, outputUSDper1M: 12 });
  assert.ok(typeof usd === "number", "a real rate must produce a number");
  assert.ok(
    Math.abs(usd - 1.95) < 1e-9,
    `expected ~1.95 (0.25*3 + 0.1*12), got ${String(usd)}`,
  );
  assert.equal(
    calcUSD(0, 0, { inputUSDper1M: 3, outputUSDper1M: 12 }),
    0,
    "zero usage with a real rate is an honest zero, not invented data",
  );
  assert.equal(calcUSD(100, 100, null), null);
  assert.equal(calcUSD(100, 100, undefined), null);
  assert.equal(
    calcUSD(100, 100, { inputUSDper1M: -1, outputUSDper1M: 1 }),
    null,
    "broken rate yields null, never 0.00",
  );
});

// ── Rates lookup ──

test("pickCostRate: exact trimmed key wins; blanks, unknowns and broken entries yield nulls", { timeout: 15000 }, () => {
  const table = {
    "prov-a/model-a": { inputUSDper1M: 2, outputUSDper1M: 8 },
    "prov-b/broken": { inputUSDper1M: -1, outputUSDper1M: 1 },
  };
  const hit = pickCostRate(table, "prov-a/model-a");
  assert.deepEqual(hit.rate, { inputUSDper1M: 2, outputUSDper1M: 8 });
  assert.equal(hit.ref, "prov-a/model-a");
  const trimmed = pickCostRate(table, "  prov-a/model-a  ");
  assert.equal(trimmed.ref, "prov-a/model-a");
  assert.deepEqual(trimmed.rate, { inputUSDper1M: 2, outputUSDper1M: 8 });
  const misses: Array<[unknown, unknown]> = [
    [{}, "prov-a/model-a"],
    [table, ""],
    [table, "   "],
    [table, "nope/none"],
    [table, "prov-b/broken"],
    [null, "prov-a/model-a"],
    [table, null],
  ];
  for (const [t, k] of misses) {
    assert.deepEqual(pickCostRate(t, k), { rate: null, ref: null });
  }
});

test("lookupCostRate: repo yaml ships 27 confirmed tariffs (FU-4: spark resolves)", { timeout: 15000 }, () => {
  resetCostTrackingOverrideForTests();
  try {
    // FU-4 evolved (was: costRates:{} → null). The spark key is a confirmed
    // tariff now, so the live lookup must hit with the exact user numbers.
    const found = lookupCostRate("opencode-go/muse-spark-1.2-contributor");
    assert.deepEqual(found.rate, { inputUSDper1M: 0.1, outputUSDper1M: 0.2 });
    assert.equal(found.ref, "opencode-go/muse-spark-1.2-contributor");
    const missing = lookupCostRate("opencode-go/no-existe-xyz");
    assert.equal(missing.rate, null, "unknown keys stay honestly null");
    assert.equal(missing.ref, null);
    // resolveSingleCostRate still refuses: 27 rates are ambiguous by design
    // (picking one at random would invent data; per-model USD wiring via
    // lookupCostRate + modelRef is a later follow-up, see REPORT-FU4).
    const single = resolveSingleCostRate();
    assert.equal(single.rate, null);
    assert.equal(single.ref, null);
  } finally {
    resetCostTrackingOverrideForTests();
  }
});

// ── Estimate + basis + no-USD-without-rate ──

test("estimateCostForModel without a rate: null USD + null ref + basis (never 0.00)", { timeout: 15000 }, () => {
  resetCostTrackingOverrideForTests();
  try {
    // FU-4 evolved: the spark key now HAS a confirmed rate, so the
    // no-rate case uses a genuinely unknown key (same null contract).
    const est = estimateCostForModel(
      4000,
      2000,
      "opencode-go/no-existe-xyz",
    );
    assert.equal(est.estimatedUSD, null);
    assert.ok(
      est.estimatedUSD === null && est.estimatedUSD !== 0,
      "USD must be null, never 0.00 as data",
    );
    assert.equal(est.ratesRef, null);
    assert.equal(est.basis, "estimated-chars/4");
    assert.equal(est.basis, COST_ESTIMATE_BASIS);
  } finally {
    resetCostTrackingOverrideForTests();
  }
});

test("basis string: summaries carry estimated-chars/4 with and without a rate", { timeout: 15000 }, () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  try {
    const id = freshJobId("basis");
    recordLlmCall(id, 800, 400);
    const bare = getCostSummary(id);
    assert.ok(bare, "recorded job must have a summary");
    assert.equal(bare.basis, "estimated-chars/4");
    assert.equal(bare.estimatedUSD, null);
    assert.equal(bare.ratesRef, null);
    const rated = getCostSummary(
      id,
      { inputUSDper1M: 2, outputUSDper1M: 8 },
      "prov-a/model-a",
    );
    assert.ok(rated, "rated summary must exist");
    assert.equal(rated.basis, "estimated-chars/4");
    assert.equal(rated.ratesRef, "prov-a/model-a");
    assert.equal(typeof rated.estimatedUSD, "number");
    assert.doesNotThrow(() => CostSummarySchema.parse(bare));
    assert.doesNotThrow(() => CostSummarySchema.parse(rated));
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
  }
});

test("no-USD-without-rate: CostSummarySchema pins USD and ratesRef together both ways", { timeout: 15000 }, () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  try {
    const id = freshJobId("pin");
    recordLlmCall(id, 400, 200);
    const bare = getCostSummary(id);
    assert.ok(bare);
    assert.doesNotThrow(() => CostSummarySchema.parse(bare));
    assert.throws(() => CostSummarySchema.parse({ ...bare, estimatedUSD: 1.5 }));
    assert.throws(() =>
      CostSummarySchema.parse({ ...bare, ratesRef: "prov-a/model-a" }),
    );
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
  }
});

// ── Validator: shape rules with file:line ──

test("validator: repo factory.yaml yields zero yaml-cost-rates errors", { timeout: 15000 }, () => {
  const issues = validateDefinition();
  const rateIssues = issues.filter((i) => i?.rule === "yaml-cost-rates");
  assert.deepEqual(
    rateIssues,
    [],
    `expected no rate issues, got ${JSON.stringify(rateIssues).slice(0, 300)}`,
  );
});

test("validateCostRateEntry: broken entry shouts yaml-cost-rates with file:line", { timeout: 15000 }, () => {
  const text = [
    "costRates:",
    '  "prov-a/model-a":',
    "    inputUSDper1M: -1",
    "    outputUSDper1M: 2",
  ].join("\n");
  const issues = validateCostRateEntry(
    "prov-a/model-a",
    { inputUSDper1M: -1, outputUSDper1M: 2 },
    text,
    "factory/factory.yaml",
  );
  assert.equal(issues.length, 1);
  const first = issues.at(0);
  assert.ok(first);
  assert.equal(first.rule, "yaml-cost-rates");
  assert.equal(first.severity, "error");
  assert.equal(first.file, "factory/factory.yaml");
  assert.equal(first.line, 3, "line must point at the offending field");
});

test("validateCostRateEntry: unknown keys and missing fields shout too", { timeout: 15000 }, () => {
  const extra = validateCostRateEntry(
    "prov-a/model-a",
    { inputUSDper1M: 1, outputUSDper1M: 1, perCall: 5 },
    "costRates:\n",
    "factory/factory.yaml",
  );
  assert.equal(extra.length, 1);
  const extraFirst = extra.at(0);
  assert.ok(extraFirst);
  assert.equal(extraFirst.rule, "yaml-cost-rates");
  const missing = validateCostRateEntry(
    "prov-a/model-a",
    { inputUSDper1M: 1 },
    undefined,
    "factory/factory.yaml",
  );
  assert.equal(missing.length, 1);
  const missingFirst = missing.at(0);
  assert.ok(missingFirst);
  assert.equal(missingFirst.line, undefined, "no text means honestly no line");
  const ok = validateCostRateEntry(
    "prov-a/model-a",
    { inputUSDper1M: 0, outputUSDper1M: 0 },
  );
  assert.deepEqual(ok, []);
});

// ── FU-4: 27 confirmed tariffs + seals (offline pins, zero network) ──

const FU4_SPARK = "opencode-go/muse-spark-1.2-contributor";
const FU4_GROK = "opencode-go/grok-4.6";

/**
 * Exact live key set (27 user-confirmed ids, provider prefix verified on
 * disk via defaultModels). The brief said "28" but lists 27 ids: this set
 * is the source of truth and NO 28th key was invented. Any tariff add/remove
 * must update this list deliberately (same commit as the yaml).
 */
const FU4_EXPECTED_KEYS: readonly string[] = [
  "opencode-go/grok-4.6",
  "opencode-go/gpt-5.6-luna",
  "opencode-go/glm-5.3-flash",
  "opencode-go/glm-5.3",
  "opencode-go/glm-5.2",
  "opencode-go/glm-5.1",
  "opencode-go/kimi-k3",
  "opencode-go/kimi-k2.7-code",
  "opencode-go/kimi-k2.6",
  "opencode-go/longcat-2.0",
  "opencode-go/mimo-v2.5",
  "opencode-go/mimo-v2.5-pro",
  "opencode-go/minimax-m2.7",
  "opencode-go/minimax-m3",
  "opencode-go/muse-spark-1.2-contributor",
  "opencode-go/muse-spark-1.3-contributor",
  "opencode-go/omen-alpha",
  "opencode-go/qwen3.6-plus",
  "opencode-go/qwen3.7-max",
  "opencode-go/qwen3.7-plus",
  "opencode-go/qwen3.8-flash",
  "opencode-go/qwen3.8-max",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/deepseek-v4-flash",
  "opencode-go/deepseek-v4-flash-vision-exp",
  "opencode-go/hy4-preview",
  "opencode-go/hy3",
];

test("FU-4: spark pin — 1M in + 1M out = 0.10 + 0.20 USD with live ref", { timeout: 15000 }, () => {
  resetCostTrackingOverrideForTests();
  try {
    const est = estimateCostForModel(1_000_000, 1_000_000, FU4_SPARK);
    assert.ok(typeof est.estimatedUSD === "number", "confirmed tariff must produce a number");
    assert.ok(
      Math.abs((est.estimatedUSD as number) - 0.3) < 1e-9,
      `expected ~0.30 (0.10 + 0.20), got ${String(est.estimatedUSD)}`,
    );
    assert.equal(est.ratesRef, FU4_SPARK);
    assert.equal(est.basis, COST_ESTIMATE_BASIS);
  } finally {
    resetCostTrackingOverrideForTests();
  }
});

test("FU-4: grok base-tier pin — 2.00/6.00 (tier ≤, cache ignored)", { timeout: 15000 }, () => {
  resetCostTrackingOverrideForTests();
  try {
    const hit = lookupCostRate(FU4_GROK);
    assert.deepEqual(hit.rate, { inputUSDper1M: 2, outputUSDper1M: 6 });
    assert.equal(hit.ref, FU4_GROK);
  } finally {
    resetCostTrackingOverrideForTests();
  }
});

test("FU-4: repo yaml carries exactly the 27 confirmed keys + dated seals", { timeout: 15000 }, () => {
  resetFactoryConfigCache();
  try {
    const cfg = getFactoryConfig();
    const keys = Object.keys(cfg.costRates).slice().sort();
    assert.deepEqual(keys, FU4_EXPECTED_KEYS.slice().sort());
    assert.equal(keys.length, 27);
    // Every entry re-validates against the single-vocabulary schema.
    for (const [name, rate] of Object.entries(cfg.costRates)) {
      assert.equal(
        CostRateSchema.safeParse(rate).success,
        true,
        `live rate ${name} must satisfy CostRateSchema`,
      );
    }
    // Seals: date format (not a frozen value — the ritual bumps it weekly),
    // source pinned to the documented URL.
    assert.ok(
      typeof cfg.ratesAsOf === "string" &&
        /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(cfg.ratesAsOf),
      `ratesAsOf must be YYYY-MM-DD, got ${String(cfg.ratesAsOf)}`,
    );
    assert.equal(cfg.ratesSource, "https://opencode.ai/docs/go/");
  } finally {
    resetFactoryConfigCache();
  }
});

test("FU-4: parseFactoryYaml accepts seals, rejects malformed ones", { timeout: 15000 }, () => {
  const base = [
    "ports:",
    "  factoryDefault: 17680",
    "  factoryMax: 17690",
    "timeouts:",
    "  verifyMs: 120000",
    "defaultModels:",
    '  foreman: "opencode-go/muse-spark-1.2-contributor"',
    '  implement: "opencode-go/muse-spark-1.2-contributor"',
    '  review: "auto-disjoint"',
    "reviewerPairs:",
    '  - match: "a → b"',
    '    reviewer: "opencode/big-pickle"',
    "scorers:",
    "  samplingRate: 25",
    "costRates: {}",
  ].join("\n");
  const good = parseFactoryYaml(
    `${base}\nratesAsOf: "2026-09-05"\nratesSource: "https://opencode.ai/docs/go/"\n`,
  );
  assert.equal(good.ratesAsOf, "2026-09-05");
  assert.equal(good.ratesSource, "https://opencode.ai/docs/go/");
  const bare = parseFactoryYaml(`${base}\n`);
  assert.equal(bare.ratesAsOf, null, "old yaml without seals stays valid (null)");
  assert.equal(bare.ratesSource, null);
  assert.throws(
    () => parseFactoryYaml(`${base}\nratesAsOf: "05/09/2026"\n`),
    FactoryConfigError,
  );
  assert.throws(
    () => parseFactoryYaml(`${base}\nratesSource: "not-a-url"\n`),
    FactoryConfigError,
  );
  assert.throws(
    () => parseFactoryYaml(`${base}\nratesAsOf:\n  nested: true\n`),
    FactoryConfigError,
  );
});

test("FU-4: malformed ratesAsOf in a factory dir shouts yaml-cost-rates with file:line", { timeout: 15000 }, () => {
  const repoYaml = fs.readFileSync(
    new URL("../factory/factory.yaml", import.meta.url),
    "utf-8",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fu4-rates-"));
  try {
    fs.writeFileSync(
      path.join(dir, "factory.yaml"),
      repoYaml.replace('ratesAsOf: "2026-09-05"', 'ratesAsOf: "yesterday"'),
      "utf-8",
    );
    const issues = validateDefinition({ factoryDir: dir });
    const found = issues.filter((i) => i?.rule === "yaml-cost-rates");
    assert.ok(found.length >= 1, "malformed seal must shout yaml-cost-rates");
    const first = found.at(0);
    assert.ok(first);
    assert.equal(first.severity, "error");
    assert.ok(
      typeof first.line === "number" && first.line > 0,
      "seal issue carries an honest file:line",
    );
    assert.ok(String(first.message).includes("ratesAsOf"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
