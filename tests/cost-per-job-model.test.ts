/**
 * FU-4b — per-job USD by the job's real model (offline, zero network).
 *
 * Carry-over closed from REPORT-FU4-tariffs.md §Carry-overs(1): with 27
 * tariffs `resolveSingleCostRate()` stays honestly null (ambiguous), so
 * `incrementCost`/`refreshCostSummary` now resolve the rate per job via
 * `resolveCostRateForModelRef` (exact trimmed `provider/model` key from
 * the job's real modelRef, or an explicit caller model). No model or no
 * tariff → null USD + null ref (honest "sin tarifa", NEVER 0.00 as data).
 *
 * Covers:
 * - modelKeyForModelRef: object/string/trimmed/variant-ignored pins;
 *   blanks and odd shapes → null.
 * - resolveCostRateForModelRef: spark live hit; unknown/null → nulls.
 * - store per-model USD: spark job 4M+4M chars (1M+1M tokens) ≈ 0.30 USD
 *   with the spark ratesRef (via the job's own modelRef, no explicit arg).
 * - explicit model wins over the job modelRef (param threading).
 * - fallback null: unknown-model job and model-less (old) job stay
 *   schema-valid with null USD + null ref (restore-tolerant).
 * - wrapper `promptInSessionWithCost` threads the model (explicit arg and
 *   job-modelRef fallback) into the persisted costSummary.
 *
 * Offline: reads only the repo factory.yaml. Every test declares an
 * explicit timeout. ESM, zero require(). No live jobs created (QA owns
 * the live badge assert afterwards).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COST_ESTIMATE_BASIS,
  modelKeyForModelRef,
  recordLlmCall,
  resolveCostRateForModelRef,
  resetCostTracker,
  resetCostTrackingOverrideForTests,
} from "../headless-runtime/cost/costTracker.ts";
import { promptInSessionWithCost } from "../headless-runtime/cost/promptWithCost.ts";
import {
  WorkItemStore,
  workItemStore,
} from "../headless-runtime/workItem/workItemStore.ts";
import { CostSummarySchema } from "../shared/types/workItem.ts";

const FU4B_SPARK = "opencode-go/muse-spark-1.2-contributor";
const FU4B_GROK = "opencode-go/grok-4.6";
const FU4B_UNKNOWN = "opencode-go/no-existe-xyz";

function freshJobId(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `job-fu4b-${tag}-${rand}`.toLowerCase().replace(/[^a-z0-9-]/g, "x");
}

// ── modelKeyForModelRef ──

test("modelKeyForModelRef: object and string pin to provider/model, trimmed", { timeout: 15000 }, () => {
  assert.equal(
    modelKeyForModelRef({ providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" }),
    FU4B_SPARK,
  );
  assert.equal(modelKeyForModelRef(`  ${FU4B_SPARK}  `), FU4B_SPARK);
  assert.equal(
    modelKeyForModelRef({ providerID: "  opencode-go ", modelID: " grok-4.6 " }),
    FU4B_GROK,
  );
  assert.equal(
    modelKeyForModelRef({ providerID: "opencode-go", modelID: "muse-spark-1.2-contributor", variant: "default" }),
    FU4B_SPARK,
    "variant is not part of the live key",
  );
});

test("modelKeyForModelRef: blanks and odd shapes yield null (never invented)", { timeout: 15000 }, () => {
  const bad: unknown[] = [
    null,
    undefined,
    "",
    "   ",
    "noslash",
    "/model",
    "provider/",
    42,
    ["opencode-go/muse-spark-1.2-contributor"],
    {},
    { providerID: "opencode-go" },
    { modelID: "grok-4.6" },
    { providerID: "", modelID: "grok-4.6" },
    { providerID: "opencode-go", modelID: "   " },
    { providerID: 1, modelID: "grok-4.6" },
  ];
  for (const b of bad) {
    assert.equal(modelKeyForModelRef(b), null, `must be null for ${String(JSON.stringify(b))}`);
  }
});

// ── resolveCostRateForModelRef (live yaml) ──

test("resolveCostRateForModelRef: spark object hits the live tariff", { timeout: 15000 }, () => {
  resetCostTrackingOverrideForTests();
  try {
    const hit = resolveCostRateForModelRef({ providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" });
    assert.deepEqual(hit.rate, { inputUSDper1M: 0.1, outputUSDper1M: 0.2 });
    assert.equal(hit.ref, FU4B_SPARK);
  } finally {
    resetCostTrackingOverrideForTests();
  }
});

test("resolveCostRateForModelRef: unknown model or no model stays honestly null", { timeout: 15000 }, () => {
  resetCostTrackingOverrideForTests();
  try {
    assert.deepEqual(resolveCostRateForModelRef({ providerID: "opencode-go", modelID: "no-existe-xyz" }), {
      rate: null,
      ref: null,
    });
    assert.deepEqual(resolveCostRateForModelRef(null), { rate: null, ref: null });
    assert.deepEqual(resolveCostRateForModelRef(undefined), { rate: null, ref: null });
  } finally {
    resetCostTrackingOverrideForTests();
  }
});

// ── store per-model USD ──

test("FU-4b: spark job 4M+4M chars (1M+1M tokens) ≈ USD 0.30 with spark ref", { timeout: 15000 }, () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4b-spark-"));
  try {
    const created = store.create({
      id: freshJobId("spark"),
      prompt: "fu4b spark usd",
      worktree: tmp,
      modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    });
    const updated = store.incrementCost(created.id, 4_000_000, 4_000_000);
    assert.ok(updated, "incrementCost returns the item");
    const summary = updated.costSummary;
    assert.ok(summary && typeof summary === "object", "job carries a costSummary");
    assert.equal(summary.llmCalls, 1);
    assert.equal(summary.estimatedInputTokens, 1_000_000);
    assert.equal(summary.estimatedOutputTokens, 1_000_000);
    assert.ok(typeof summary.estimatedUSD === "number", "confirmed tariff must produce a number");
    assert.ok(
      Math.abs((summary.estimatedUSD as number) - 0.3) < 1e-9,
      `expected ~0.30 (0.10 + 0.20), got ${String(summary.estimatedUSD)}`,
    );
    assert.equal(summary.ratesRef, FU4B_SPARK);
    assert.equal(summary.basis, COST_ESTIMATE_BASIS);
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
    // Evidence on disk: job.json carries the rated summary.
    const jobJson = JSON.parse(
      fs.readFileSync(path.join(tmp, ".agents", "factory", created.id, "job.json"), "utf-8"),
    ) as Record<string, unknown>;
    const disk = jobJson.costSummary as { estimatedUSD: unknown; ratesRef: unknown };
    assert.ok(disk && typeof disk === "object", "job.json must carry costSummary");
    assert.ok(Math.abs((disk.estimatedUSD as number) - 0.3) < 1e-9);
    assert.equal(disk.ratesRef, FU4B_SPARK);
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test("FU-4b: explicit model wins over the job modelRef (param threading)", { timeout: 15000 }, () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4b-explicit-"));
  try {
    const created = store.create({
      id: freshJobId("explicit"),
      prompt: "fu4b explicit wins",
      worktree: tmp,
      modelRef: { providerID: "opencode-go", modelID: "grok-4.6" },
    });
    const updated = store.incrementCost(created.id, 4_000_000, 4_000_000, FU4B_SPARK);
    assert.ok(updated);
    const summary = updated.costSummary;
    assert.ok(summary && typeof summary === "object");
    assert.equal(summary.ratesRef, FU4B_SPARK, "explicit spark key wins over the grok job model");
    assert.ok(Math.abs(((summary as { estimatedUSD: number }).estimatedUSD) - 0.3) < 1e-9);
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test("FU-4b: fallback null — unknown-model job stays schema-valid, never 0.00", { timeout: 15000 }, () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4b-norate-"));
  try {
    const created = store.create({
      id: freshJobId("norate"),
      prompt: "fu4b no rate",
      worktree: tmp,
      modelRef: { providerID: "opencode-go", modelID: "no-existe-xyz" },
    });
    const updated = store.incrementCost(created.id, 4000, 2000);
    assert.ok(updated);
    const summary = updated.costSummary;
    assert.ok(summary && typeof summary === "object");
    assert.equal(summary.llmCalls, 1);
    assert.equal(summary.estimatedUSD, null);
    assert.ok(
      (summary as { estimatedUSD: unknown }).estimatedUSD === null &&
        (summary as { estimatedUSD: unknown }).estimatedUSD !== 0,
      "USD must be null, never 0.00 as data",
    );
    assert.equal(summary.ratesRef, null);
    assert.equal(summary.basis, COST_ESTIMATE_BASIS);
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test("FU-4b: old jobs stay valid — model-less job gets honest sin-tarifa (restore-tolerant)", { timeout: 15000 }, () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4b-old-"));
  try {
    const created = store.create({
      id: freshJobId("old"),
      prompt: "fu4b old job without model",
      worktree: tmp,
    });
    const updated = store.incrementCost(created.id, 4000, 2000);
    assert.ok(updated, "model-less job still records cost");
    const summary = updated.costSummary;
    assert.ok(summary && typeof summary === "object");
    assert.equal(summary.llmCalls, 1, "calls still counted without a model");
    assert.equal(summary.estimatedUSD, null, "no model means no invented USD");
    assert.equal(summary.ratesRef, null);
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
    // And an explicit model still rates a model-less job (caller had it handy).
    const rerated = store.incrementCost(created.id, 4_000_000, 4_000_000, {
      providerID: "opencode-go",
      modelID: "muse-spark-1.2-contributor",
    });
    assert.ok(rerated);
    const summary2 = rerated.costSummary;
    assert.ok(summary2 && typeof summary2 === "object");
    assert.equal(summary2.ratesRef, FU4B_SPARK);
    assert.ok(typeof summary2.estimatedUSD === "number");
    assert.doesNotThrow(() => CostSummarySchema.parse(summary2));
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ── wrapper threads the model ──

test("FU-4b: wrapper persists rated USD via the job modelRef (no explicit arg)", { timeout: 15000 }, async () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4b-wrap-"));
  const id = freshJobId("wrap");
  try {
    workItemStore.create({
      id,
      prompt: "fu4b wrapper fallback",
      worktree: tmp,
      modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    });
    const out = await promptInSessionWithCost(id, async () => "ok-fu4b", "x".repeat(4000));
    assert.equal(out, "ok-fu4b", "wrapper returns the prompt result intact");
    const mem = workItemStore.get(id);
    assert.ok(mem, "job stays in the store");
    const summary = mem.costSummary;
    assert.ok(summary && typeof summary === "object");
    assert.equal((summary as { llmCalls: number }).llmCalls, 1);
    // 4000 in-chars → 1000 tokens; 7 out-chars → 1 token:
    // 0.001*0.10 + 0.000001*0.20 = 0.0001002
    assert.equal((summary as { ratesRef: unknown }).ratesRef, FU4B_SPARK);
    assert.ok(
      Math.abs(((summary as { estimatedUSD: number }).estimatedUSD) - 0.0001002) < 1e-12,
      `expected ~0.0001002, got ${String((summary as { estimatedUSD: unknown }).estimatedUSD)}`,
    );
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test("FU-4b: wrapper explicit model rates a model-less job", { timeout: 15000 }, async () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4b-wrapexp-"));
  const id = freshJobId("wrapexp");
  try {
    workItemStore.create({ id, prompt: "fu4b wrapper explicit", worktree: tmp });
    const out = await promptInSessionWithCost(id, async () => "ok-explicit", "abcd", FU4B_SPARK);
    assert.equal(out, "ok-explicit");
    const mem = workItemStore.get(id);
    assert.ok(mem);
    const summary = mem.costSummary;
    assert.ok(summary && typeof summary === "object");
    assert.equal((summary as { ratesRef: unknown }).ratesRef, FU4B_SPARK);
    assert.ok(typeof (summary as { estimatedUSD: unknown }).estimatedUSD === "number");
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test("FU-4b: wrapper without any model stays honestly sin-tarifa (unknown key)", { timeout: 15000 }, async () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4b-wrapnull-"));
  const id = freshJobId("wrapnull");
  try {
    workItemStore.create({
      id,
      prompt: "fu4b wrapper null",
      worktree: tmp,
      modelRef: { providerID: "opencode-go", modelID: "no-existe-xyz" },
    });
    await promptInSessionWithCost(id, async () => "ok-null", "abcd");
    const mem = workItemStore.get(id);
    assert.ok(mem);
    const summary = mem.costSummary;
    assert.ok(summary && typeof summary === "object");
    assert.equal((summary as { estimatedUSD: unknown }).estimatedUSD, null);
    assert.equal((summary as { ratesRef: unknown }).ratesRef, null);
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
    void FU4B_UNKNOWN;
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ── FU-4d: reviewer sin tarifa no pisa el USD acumulado (bug FU-4c, job-mtolopvi-2ffu) ──
//
// Shape del job live: modelRef spark rateado (0.10/0.20) + reviewer
// `opencode/big-pickle` (sin rate en yaml). Calls 1-3 rateadas (~USD 0.0006
// mid-run) y la 4ª del reviewer SOBRESCRIBÍA a null/null. El fix acumula
// USD por llamada: la call sin rate suma 0 y preserva lo acumulado (NUNCA
// null sobre número, NUNCA 0.00 como dato). Offline, cero quota.

const FU4D_REVIEWER_UNRATED = "opencode/big-pickle";

test("FU-4d: implement spark x3 + reviewer sin rate (incrementCost) → USD preservado, 4 calls", { timeout: 15000 }, () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4d-mixed-"));
  try {
    const created = store.create({
      id: freshJobId("mixed"),
      prompt: "fu4d mixed implement + reviewer",
      worktree: tmp,
      modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    });
    // 3 implement calls rateadas: 4000 in + 2000 out → 1000/500 tokens → 0.0002 c/u.
    store.incrementCost(created.id, 4000, 2000);
    store.incrementCost(created.id, 4000, 2000);
    const third = store.incrementCost(created.id, 4000, 2000);
    assert.ok(third?.costSummary && typeof third.costSummary === "object");
    const usdAfterImplement = (third.costSummary as { estimatedUSD: unknown }).estimatedUSD;
    assert.ok(typeof usdAfterImplement === "number", "mid-run rated USD must be a number");
    assert.ok(
      Math.abs((usdAfterImplement as number) - 0.0006) < 1e-12,
      `3 rated calls ≈ 0.0006, got ${String(usdAfterImplement)}`,
    );
    // 4ª call del reviewer (sin tarifa): antes del fix pisaba a null/null (FU-4c).
    const final = store.incrementCost(created.id, 8000, 4000, FU4D_REVIEWER_UNRATED);
    assert.ok(final, "incrementCost returns the item");
    const summary = final.costSummary;
    assert.ok(summary && typeof summary === "object");
    assert.equal(summary.llmCalls, 4, "calls sumadas (3 implement + 1 review)");
    assert.equal(summary.estimatedInputTokens, 5000, "tokens in totales (3000 + 2000 review)");
    assert.equal(summary.estimatedOutputTokens, 2500, "tokens out totales (1500 + 1000 review)");
    assert.ok(typeof summary.estimatedUSD === "number", "USD preservado: NUNCA null sobre número");
    assert.notEqual(summary.estimatedUSD, 0, "NUNCA 0.00 como dato");
    assert.ok(
      Math.abs((summary.estimatedUSD as number) - (usdAfterImplement as number)) < 1e-12,
      "la call sin rate suma 0: USD idéntico al mid-run",
    );
    assert.equal(summary.ratesRef, FU4B_SPARK, "ratesRef del modelo rateado preservado");
    assert.equal(summary.basis, COST_ESTIMATE_BASIS);
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
    // Timeline: el 4º evento cost muestra ~USD (no regresa a "sin tarifa").
    const costEvents = (final.timeline ?? []).filter(
      (e) => typeof e.message === "string" && e.message.startsWith("cost:"),
    );
    assert.equal(costEvents.length, 4, "un evento cost: por llamada");
    const lastMsg = costEvents[3]?.message ?? "";
    assert.ok(lastMsg.includes("~USD"), `4º evento debe mostrar ~USD, got: ${lastMsg}`);
    assert.ok(!lastMsg.includes("sin tarifa"), `4º evento no debe decir sin tarifa, got: ${lastMsg}`);
    // Disco: job.json idéntico a memoria (GET == disco, como el assert QA).
    const jobJson = JSON.parse(
      fs.readFileSync(path.join(tmp, ".agents", "factory", created.id, "job.json"), "utf-8"),
    ) as Record<string, unknown>;
    const disk = jobJson.costSummary as { estimatedUSD: unknown; ratesRef: unknown; llmCalls: unknown };
    assert.ok(disk && typeof disk === "object", "job.json must carry costSummary");
    assert.equal(disk.llmCalls, 4);
    assert.ok(Math.abs((disk.estimatedUSD as number) - (usdAfterImplement as number)) < 1e-12);
    assert.equal(disk.ratesRef, FU4B_SPARK);
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test("FU-4d: refreshCostSummary con reviewer model (reviewAgent.ts:627) no nulifica USD", { timeout: 15000 }, () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fu4d-refresh-"));
  try {
    const created = store.create({
      id: freshJobId("refresh"),
      prompt: "fu4d reviewer threading",
      worktree: tmp,
      modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" },
    });
    // 3 implement calls vía el camino del wrapper: record + refresh con el
    // modelRef del job (spark). El wrapper ya contó; refresh solo persiste.
    for (let i = 0; i < 3; i++) {
      recordLlmCall(created.id, 4000, 2000);
      const persisted = store.refreshCostSummary(created.id);
      assert.ok(persisted, "refreshCostSummary returns the item");
    }
    const mid = store.get(created.id);
    assert.ok(mid?.costSummary && typeof mid.costSummary === "object");
    const midUSD = (mid.costSummary as { estimatedUSD: unknown }).estimatedUSD;
    assert.ok(typeof midUSD === "number", "mid-run rated USD must be a number");
    assert.ok(Math.abs((midUSD as number) - 0.0006) < 1e-12);
    assert.equal((mid.costSummary as { ratesRef: unknown }).ratesRef, FU4B_SPARK);
    // Review call: el reviewer graba y refresca con SU modelo (big-pickle,
    // sin tarifa) — el threading exacto de reviewAgent.ts:627.
    recordLlmCall(created.id, 8000, 4000);
    const final = store.refreshCostSummary(created.id, FU4D_REVIEWER_UNRATED);
    assert.ok(final, "refreshCostSummary returns the item");
    const summary = final.costSummary;
    assert.ok(summary && typeof summary === "object");
    assert.equal(summary.llmCalls, 4, "calls sumadas (3 implement + 1 review)");
    assert.equal(summary.estimatedInputTokens, 5000);
    assert.equal(summary.estimatedOutputTokens, 2500);
    assert.ok(typeof summary.estimatedUSD === "number", "USD preservado: NUNCA null sobre número");
    assert.notEqual(summary.estimatedUSD, 0, "NUNCA 0.00 como dato");
    assert.ok(
      Math.abs((summary.estimatedUSD as number) - (midUSD as number)) < 1e-12,
      "la call del reviewer suma 0: USD idéntico al mid-run",
    );
    assert.equal(summary.ratesRef, FU4B_SPARK);
    assert.equal(summary.basis, COST_ESTIMATE_BASIS);
    assert.doesNotThrow(() => CostSummarySchema.parse(summary));
    const costEvents = (final.timeline ?? []).filter(
      (e) => typeof e.message === "string" && e.message.startsWith("cost:"),
    );
    assert.equal(costEvents.length, 4, "un evento cost: por llamada");
    const lastMsg = costEvents[3]?.message ?? "";
    assert.ok(lastMsg.includes("~USD"), `4º evento debe mostrar ~USD, got: ${lastMsg}`);
    assert.ok(!lastMsg.includes("sin tarifa"), `4º evento no debe decir sin tarifa, got: ${lastMsg}`);
    const jobJson = JSON.parse(
      fs.readFileSync(path.join(tmp, ".agents", "factory", created.id, "job.json"), "utf-8"),
    ) as Record<string, unknown>;
    const disk = jobJson.costSummary as { estimatedUSD: unknown; ratesRef: unknown; llmCalls: unknown };
    assert.ok(disk && typeof disk === "object");
    assert.equal(disk.llmCalls, 4);
    assert.ok(Math.abs((disk.estimatedUSD as number) - (midUSD as number)) < 1e-12);
    assert.equal(disk.ratesRef, FU4B_SPARK);
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});
