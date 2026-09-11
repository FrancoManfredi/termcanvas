/**
 * Ola 15 E2 — suite de costo real (medición honesta, sin mocks productivos).
 *
 * Cubre (diseño §2.4 + scope E2):
 * - estimador `chars/4` bordes (vacío→0, multibyte por chars JS, 1000→250)
 * - contador 3 prompts→3 (key por jobId, no global)
 * - costo sin tarifa = sin USD (null, NUNCA 0 inventado)
 * - `costTracking:false` → null / UI "—" (vía seam de tests, sin tocar yaml)
 * - cap 10000 con evicción FIFO (Regla 7)
 * - restore tolerante de job viejo sin costSummary (aditivo, no rompe)
 * - wrapper `promptInSessionWithCost` mide in/out
 * - `incrementCost` best-effort persiste en job.json + timeline
 * - CIERRE Ola 15: wrapper persiste vía `refreshCostSummary` (sin doble
 *   conteo), job fantasma no rompe, null story definida, 3 prompts→3,
 *   `costTracking:false` no registra ni persiste, clave de análisis y guarda
 *   de cableado de los 7 agentes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  estimateTokensFromChars,
  calcUSD,
  recordLlmCall,
  getCostSummary,
  resolveSingleCostRate,
  isCostTrackingEnabled,
  resetCostTracker,
  getCostTrackerSize,
  setCostTrackingOverrideForTests,
  resetCostTrackingOverrideForTests,
  COST_TRACKER_MAX_ENTRIES,
} from "../headless-runtime/cost/costTracker.ts";
import {
  promptInSessionWithCost,
  extractOutputChars,
} from "../headless-runtime/cost/promptWithCost.ts";
import { CostSummarySchema } from "../shared/types/workItem.ts";
import type { FailureCase } from "../shared/types/improvement.ts";
import { WorkItemStore, workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { resolveAnalysisCostKey } from "../headless-runtime/measure/improvementEngine.ts";
import { readWorkItemFromDir } from "../headless-runtime/workItem/workItemDisk.ts";

function freshJobId(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `job-cost-${tag}-${rand}`.toLowerCase().replace(/[^a-z0-9-]/g, "x");
}

// ── Estimador bordes ──

test("estimador: vacío→0, 1000 chars→250, multibyte por chars JS", () => {
  assert.equal(estimateTokensFromChars(0), 0);
  assert.equal(estimateTokensFromChars(-5), 0);
  assert.equal(estimateTokensFromChars(Number.NaN), 0);
  assert.equal(estimateTokensFromChars(Number.POSITIVE_INFINITY), 0);
  assert.equal(estimateTokensFromChars(1), 0, "floor(1/4)=0");
  assert.equal(estimateTokensFromChars(3), 0);
  assert.equal(estimateTokensFromChars(4), 1);
  assert.equal(estimateTokensFromChars(1000), 250);
  // Multibyte: "😀".length === 2 en JS (code units, no bytes que serían 4).
  const emoji = "😀";
  assert.equal(emoji.length, 2, "precondición: JS cuenta el emoji como 2 chars");
  assert.equal(estimateTokensFromChars(emoji.length), 0);
  const hundredEmoji = "😀".repeat(100);
  assert.equal(hundredEmoji.length, 200);
  assert.equal(estimateTokensFromChars(hundredEmoji.length), 50);
  assert.equal(estimateTokensFromChars("a".repeat(1000).length), 250);
});

test("calcUSD: sin tarifa→null (NUNCA 0 inventado), con tarifa calcula", () => {
  assert.equal(calcUSD(250, 100, null), null);
  assert.equal(calcUSD(250, 100, undefined), null);
  assert.equal(
    calcUSD(250, 100, { inputUSDper1M: 1, outputUSDper1M: 2 }),
    250 / 1_000_000 + (100 / 1_000_000) * 2,
  );
  // 0 tokens con tarifa válida → 0 honesto (no es inventado: no hubo uso).
  assert.equal(calcUSD(0, 0, { inputUSDper1M: 1, outputUSDper1M: 1 }), 0);
  // Tarifas inválidas → null, no 0.
  assert.equal(calcUSD(10, 10, { inputUSDper1M: -1, outputUSDper1M: 1 } as never), null);
});

// ── Contador por jobId ──

test("contador: 3 prompts→3, key por jobId (no global)", () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  try {
    const a = freshJobId("a");
    const b = freshJobId("b");
    recordLlmCall(a, 400, 200);
    recordLlmCall(a, 400, 200);
    recordLlmCall(a, 400, 200);
    recordLlmCall(b, 4000, 0);
    const sa = getCostSummary(a);
    const sb = getCostSummary(b);
    assert.ok(sa, "job A debe tener resumen");
    assert.equal(sa.llmCalls, 3);
    assert.equal(sa.estimatedInputTokens, estimateTokensFromChars(1200));
    assert.equal(sa.estimatedOutputTokens, estimateTokensFromChars(600));
    assert.equal(sa.basis, "estimated-chars/4");
    assert.ok(sb, "job B debe tener resumen propio");
    assert.equal(sb.llmCalls, 1, "el contador es por jobId, no global");
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
  }
});

test("costo sin tarifa = sin USD (null + ratesRef null, schema válido)", () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  try {
    // El yaml real tiene costRates:{} → modo sin tarifa (honesto).
    const { rate, ref } = resolveSingleCostRate();
    assert.equal(rate, null);
    assert.equal(ref, null);
    const id = freshJobId("notariff");
    recordLlmCall(id, 800, 400);
    const s = getCostSummary(id, rate, ref);
    assert.ok(s);
    assert.equal(s.estimatedUSD, null);
    assert.equal(s.ratesRef, null);
    assert.doesNotThrow(() => CostSummarySchema.parse(s), "sin tarifa debe ser schema válido");
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
  }
});

test("con tarifa explícita: USD número + ratesRef requerido (superRefine)", () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  try {
    const id = freshJobId("tariff");
    recordLlmCall(id, 4000, 2000);
    const s = getCostSummary(
      id,
      { inputUSDper1M: 2, outputUSDper1M: 8 },
      "test/prov",
    );
    assert.ok(s);
    assert.equal(typeof s.estimatedUSD, "number");
    assert.equal(s.ratesRef, "test/prov");
    assert.doesNotThrow(() => CostSummarySchema.parse(s));
    // Sin ref con USD → rechaza (honestidad enforceada por schema).
    assert.throws(() =>
      CostSummarySchema.parse({ ...s, ratesRef: null }),
    );
    // Ref sin USD → rechaza.
    assert.throws(() =>
      CostSummarySchema.parse({ ...s, estimatedUSD: null, ratesRef: "x" }),
    );
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
  }
});

// ── Interruptor (Regla 8) ──

test("costTracking:false → getCostSummary null (UI muestra '—')", () => {
  resetCostTracker();
  try {
    setCostTrackingOverrideForTests(false);
    assert.equal(isCostTrackingEnabled(), false);
    const id = freshJobId("off");
    recordLlmCall(id, 4000, 4000);
    assert.equal(getCostSummary(id), null, "apagado total: ni siquiera lo registrado se expone");
    assert.equal(getCostTrackerSize(), 0, "apagado total: no se registra nada");
  } finally {
    resetCostTrackingOverrideForTests();
    resetCostTracker();
  }
  assert.equal(isCostTrackingEnabled(), true, "sin override lee el yaml real (true)");
});

// ── Cota FIFO (Regla 7) ──

test("cap 10000 con evicción FIFO (termina, sin loops)", () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  try {
    assert.equal(COST_TRACKER_MAX_ENTRIES, 10_000);
    const first = "job-cost-fifo-first-0000";
    recordLlmCall(first, 40, 40);
    for (let i = 0; i < COST_TRACKER_MAX_ENTRIES; i++) {
      recordLlmCall(`job-cost-fifo-${String(i).padStart(5, "0")}`, 40, 40);
    }
    assert.equal(getCostTrackerSize(), COST_TRACKER_MAX_ENTRIES);
    assert.equal(
      getCostSummary(first),
      null,
      "la entrada más vieja fue evictada (FIFO)",
    );
    const last = `job-cost-fifo-${String(COST_TRACKER_MAX_ENTRIES - 1).padStart(5, "0")}`;
    const sLast = getCostSummary(last);
    assert.ok(sLast, "la más nueva sigue");
    assert.equal(sLast.llmCalls, 1);
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
  }
});

// ── Restore tolerante ──

test("restore tolerante: job viejo sin costSummary no rompe (undefined)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cost-restore-"));
  try {
    const jobDir = path.join(dir, ".agents", "factory", "job-old-abc123");
    fs.mkdirSync(jobDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(jobDir, "job.json"),
      JSON.stringify({
        id: "job-old-abc123",
        prompt: "hola",
        worktree: dir,
        phase: "diagnosisLlm",
        status: "Intake",
        createdAt: now,
        updatedAt: now,
        timeline: [
          { id: "job-old-abc123-t0", from: "Intake", to: "Intake", at: now, actor: "user", message: "created Intake" },
        ],
        cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
        dir: jobDir,
        dotDonePath: path.join(jobDir, ".done"),
        runnerId: "linux-build",
      }),
      "utf-8",
    );
    const item = readWorkItemFromDir(jobDir);
    assert.ok(item, "job viejo debe restaurar");
    assert.equal(
      (item as unknown as { costSummary?: unknown }).costSummary,
      undefined,
      "sin costSummary → undefined (sin datos todavía), no throw",
    );
    // costSummary null explícito se preserva ("—").
    const jobDir2 = path.join(dir, ".agents", "factory", "job-off-abc123");
    fs.mkdirSync(jobDir2, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir2, "job.json"),
      JSON.stringify({
        id: "job-off-abc123",
        prompt: "hola",
        worktree: dir,
        phase: "diagnosisLlm",
        status: "Intake",
        createdAt: now,
        updatedAt: now,
        timeline: [
          { id: "job-off-abc123-t0", from: "Intake", to: "Intake", at: now, actor: "user", message: "created Intake" },
        ],
        cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
        costSummary: null,
        dir: jobDir2,
        dotDonePath: path.join(jobDir2, ".done"),
        runnerId: "linux-build",
      }),
      "utf-8",
    );
    const item2 = readWorkItemFromDir(jobDir2);
    assert.ok(item2);
    assert.equal(
      (item2 as unknown as { costSummary?: unknown }).costSummary,
      null,
      "null explícito se preserva (tracking apagado)",
    );
    // costSummary inválido → undefined tolerante (no throw, no dato roto).
    const jobDir3 = path.join(dir, ".agents", "factory", "job-bad-abc123");
    fs.mkdirSync(jobDir3, { recursive: true });
    fs.writeFileSync(
      path.join(jobDir3, "job.json"),
      JSON.stringify({
        id: "job-bad-abc123",
        prompt: "hola",
        worktree: dir,
        phase: "diagnosisLlm",
        status: "Intake",
        createdAt: now,
        updatedAt: now,
        timeline: [
          { id: "job-bad-abc123-t0", from: "Intake", to: "Intake", at: now, actor: "user", message: "created Intake" },
        ],
        cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
        costSummary: { llmCalls: -1, estimatedUSD: 5, basis: "x", ratesRef: null },
        dir: jobDir3,
        dotDonePath: path.join(jobDir3, ".done"),
        runnerId: "linux-build",
      }),
      "utf-8",
    );
    const item3 = readWorkItemFromDir(jobDir3);
    assert.ok(item3);
    assert.equal(
      (item3 as unknown as { costSummary?: unknown }).costSummary,
      undefined,
      "inválido → undefined tolerante",
    );
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ── Wrapper único ──

test("wrapper mide in/out y cuenta 1 llamada (éxito y fallo)", async () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  try {
    const id = freshJobId("wrap");
    const input = "input de prueba (24 chars)";
    const out = await promptInSessionWithCost(id, async () => "respuesta-12345", input);
    assert.equal(out, "respuesta-12345");
    const s = getCostSummary(id);
    assert.ok(s);
    assert.equal(s.llmCalls, 1);
    assert.equal(s.estimatedInputTokens, estimateTokensFromChars(input.length));
    assert.equal(
      s.estimatedOutputTokens,
      estimateTokensFromChars("respuesta-12345".length),
    );
    // Fallo: registra el intento y relanza el error original.
    const id2 = freshJobId("wrapfail");
    await assert.rejects(
      () => promptInSessionWithCost(id2, async () => { throw new Error("boom-test"); }, "abcd"),
      /boom-test/,
    );
    const s2 = getCostSummary(id2);
    assert.ok(s2, "el intento fallido también cuenta (llamada intentada)");
    assert.equal(s2.llmCalls, 1);
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
  }
});

test("extractOutputChars: string/objeto/nulo sin lanzar", () => {
  assert.equal(extractOutputChars(null), 0);
  assert.equal(extractOutputChars(undefined), 0);
  assert.equal(extractOutputChars("abcd"), 4);
  assert.equal(extractOutputChars("😀"), 2, "chars JS, no bytes");
  const obj = { text: "hola", n: 1 };
  assert.equal(extractOutputChars(obj), JSON.stringify(obj).length);
});

// ── incrementCost best-effort (job.json + timeline) ──

test("incrementCost persiste costSummary en memoria + job.json + timeline (best-effort)", () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cost-incr-"));
  try {
    const created = store.create({
      id: `job-costincr-${Date.now().toString(36)}`,
      prompt: "probar costo",
      worktree: tmp,
    });
    // Mueve el dir al tmp para no ensuciar el repo (best-effort).
    void created;
    const updated = store.incrementCost(created.id, 400, 200);
    assert.ok(updated, "incrementCost retorna el item");
    const s = getCostSummary(created.id);
    assert.ok(s);
    assert.equal(s.llmCalls, 1);
    const mem = store.get(created.id);
    assert.ok(mem);
    const memSummary = (mem as unknown as { costSummary?: unknown }).costSummary as {
      llmCalls: number;
    };
    assert.equal(memSummary.llmCalls, 1);
    // Evidencia en disco: job.json trae costSummary + timeline con evento cost.
    const jobJson = JSON.parse(
      fs.readFileSync(path.join(tmp, ".agents", "factory", created.id, "job.json"), "utf-8"),
    ) as Record<string, unknown>;
    assert.ok(jobJson.costSummary, "job.json debe traer costSummary");
    const tl = (mem.timeline ?? []) as Array<{ message?: string }>;
    assert.ok(
      tl.some((e) => typeof e.message === "string" && e.message.startsWith("cost:")),
      "timeline debe traer evento cost (Regla 5)",
    );
    // toJSON lo expone (GETs existentes).
    const json = store.toJSON(mem) as Record<string, unknown>;
    assert.ok("costSummary" in json);
    // Nunca rompe: job inexistente → null, no throw.
    assert.equal(store.incrementCost("job-no-existe-xyz", 10, 10), null);
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

// ── Cierre Ola 15: wrapper persiste vía refreshCostSummary ──

function freshCloseJobId(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `job-close-${tag}-${Date.now().toString(36)}${rand}`.toLowerCase().replace(/[^a-z0-9-]/g, "x");
}

function readDiskJobJson(worktree: string, id: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(worktree, ".agents", "factory", id, "job.json"), "utf-8"),
  ) as Record<string, unknown>;
}

function diskCostEvents(jobJson: Record<string, unknown>): Array<{ message?: string }> {
  const tl = (jobJson.timeline ?? []) as Array<{ message?: string }>;
  return tl.filter((e) => typeof e.message === "string" && e.message.startsWith("cost:"));
}

test("cierre: wrapper + job real en store → costSummary 1 + evento cost: en job.json", async () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cost-close-"));
  const id = freshCloseJobId("a");
  try {
    workItemStore.create({ id, prompt: "cierre ola 15", worktree: tmp });
    const out = await promptInSessionWithCost(id, async () => "ok-cierre", "input-cierre-1234");
    assert.equal(out, "ok-cierre", "el wrapper retorna lo del prompt intacto");
    const mem = workItemStore.get(id);
    assert.ok(mem, "el job sigue en el store");
    assert.equal(
      (mem.costSummary as { llmCalls: number } | null | undefined)?.llmCalls,
      1,
      "memoria del store: 1 llamada",
    );
    const jobJson = readDiskJobJson(tmp, id);
    assert.equal(
      (jobJson.costSummary as { llmCalls: number } | null | undefined)?.llmCalls,
      1,
      "job.json en disco: 1 llamada (evidencia Regla 5)",
    );
    assert.ok(
      diskCostEvents(jobJson).length >= 1,
      "job.json debe traer evento timeline cost:",
    );
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

test("cierre: 3 prompts vía wrapper → costSummary 3 (sin doble conteo)", async () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cost-close3-"));
  const id = freshCloseJobId("b");
  try {
    workItemStore.create({ id, prompt: "tres llamadas", worktree: tmp });
    await promptInSessionWithCost(id, async () => "r1", "aaaa");
    await promptInSessionWithCost(id, async () => "r2", "bbbb");
    await promptInSessionWithCost(id, async () => "r3", "cccc");
    // Si el wrapper usara incrementCost (que re-graba) habría 6, no 3.
    assert.equal(workItemStore.get(id)?.costSummary?.llmCalls, 3);
    const jobJson = readDiskJobJson(tmp, id);
    assert.equal((jobJson.costSummary as { llmCalls: number }).llmCalls, 3);
    assert.equal(diskCostEvents(jobJson).length, 3, "un evento cost: por llamada");
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

test("cierre: wrapper con job inexistente → memoria cuenta, no rompe (no regresión)", async () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  try {
    const id = freshJobId("ghost");
    const out = await promptInSessionWithCost(id, async () => ({ text: "hola" }), "input-fantasma");
    assert.deepEqual(out, { text: "hola" });
    const s = getCostSummary(id);
    assert.ok(s, "el contador en memoria igual queda");
    assert.equal(s.llmCalls, 1);
    // Rama de fallo: el intento también cuenta y el error original se relanza.
    const id2 = freshJobId("ghostfail");
    await assert.rejects(
      () => promptInSessionWithCost(id2, async () => { throw new Error("boom-ghost"); }, "zz"),
      /boom-ghost/,
    );
    assert.equal(getCostSummary(id2)?.llmCalls, 1);
  } finally {
    resetCostTracker();
    resetCostTrackingOverrideForTests();
  }
});

test("cierre: refreshCostSummary sin llamadas → deja como está (null story definida)", () => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cost-nullstory-"));
  try {
    const created = store.create({ id: freshCloseJobId("c"), prompt: "sin llamadas", worktree: tmp });
    const tlLen = (store.get(created.id)?.timeline ?? []).length;
    const out = store.refreshCostSummary(created.id);
    assert.ok(out, "retorna el item");
    assert.equal(
      out.costSummary,
      undefined,
      "0 llamadas + tracking ON: no se inventa resumen (undefined = sin datos todavía)",
    );
    assert.equal(
      (out.timeline ?? []).length,
      tlLen,
      "sin evento cost: falso (un 'seguimiento apagado' sería mentira)",
    );
    // Job inexistente → null, no throw.
    assert.equal(store.refreshCostSummary("job-no-existe-cierre"), null);
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

test("cierre: refreshCostSummary con tracking OFF persiste null honesto (igual que incrementCost)", () => {
  resetCostTracker();
  const store = new WorkItemStore();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cost-off-"));
  try {
    setCostTrackingOverrideForTests(false);
    const created = store.create({ id: freshCloseJobId("d"), prompt: "apagado", worktree: tmp });
    const out = store.refreshCostSummary(created.id);
    assert.ok(out);
    assert.equal(out.costSummary, null, "apagado: null explícito ('—')");
    const jobJson = readDiskJobJson(tmp, created.id);
    assert.equal(jobJson.costSummary, null);
    assert.ok(
      diskCostEvents(jobJson).some((e) => (e.message ?? "").includes("seguimiento apagado")),
      "el evento dice apagado (honesto, no inventa números)",
    );
  } finally {
    resetCostTrackingOverrideForTests();
    resetCostTracker();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test("cierre: costTracking:false → wrapper corre el prompt pero no registra ni persiste", async () => {
  resetCostTracker();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cost-wrapof-"));
  const id = freshCloseJobId("e");
  try {
    setCostTrackingOverrideForTests(false);
    workItemStore.create({ id, prompt: "wrapper apagado", worktree: tmp });
    const tlLen = (workItemStore.get(id)?.timeline ?? []).length;
    const out = await promptInSessionWithCost(id, async () => "sigue-andando", "input-off-1234");
    assert.equal(out, "sigue-andando", "el prompt corre igual");
    assert.equal(getCostTrackerSize(), 0, "apagado total: no se registra nada");
    assert.equal(getCostSummary(id), null);
    const mem = workItemStore.get(id);
    assert.ok(mem);
    assert.equal(mem.costSummary, undefined, "apagado: no se persiste nada");
    assert.equal((mem.timeline ?? []).length, tlLen, "sin eventos cost: con tracking OFF");
    const jobJson = readDiskJobJson(tmp, id);
    assert.ok(!("costSummary" in jobJson), "job.json sin costSummary cuando está apagado");
  } finally {
    try {
      workItemStore.delete(id);
    } catch {
      // best-effort
    }
    resetCostTrackingOverrideForTests();
    resetCostTracker();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test("cierre: resolveAnalysisCostKey unánime→job, mixto/vacío→analysis/<scorer>", () => {
  const mk = (workItemId: string): FailureCase => ({
    workItemId,
    scorer: "s",
    label: "fail",
    reason: "r",
    at: "t",
    promptPreview: "p",
  });
  assert.equal(
    resolveAnalysisCostKey([mk("job-a-1"), mk("job-a-1")], "mi-scorer"),
    "job-a-1",
  );
  assert.equal(
    resolveAnalysisCostKey([mk("job-a-1"), mk("job-b-2")], "mi-scorer"),
    "analysis/mi-scorer",
  );
  assert.equal(resolveAnalysisCostKey([], "mi-scorer"), "analysis/mi-scorer");
  assert.equal(
    resolveAnalysisCostKey([mk("job-a-1")], "  "),
    "job-a-1",
    "unánime manda aunque el scorer venga vacío",
  );
});

test("cierre: los 7 agentes importan y llaman al wrapper único (cableado vivo)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = [
    "headless-runtime/foreman/foreman.ts",
    "headless-runtime/triage/triageAgent.ts",
    "headless-runtime/spec/specAgent.ts",
    "headless-runtime/implement/implementAgent.ts",
    "headless-runtime/review/reviewAgent.ts",
    "headless-runtime/measure/scorerEngine.ts",
    "headless-runtime/measure/improvementEngine.ts",
  ];
  assert.equal(files.length, 7);
  for (const rel of files) {
    const text = fs.readFileSync(path.join(here, "..", rel), "utf-8");
    assert.ok(
      text.includes("../cost/promptWithCost"),
      `${rel} debe importar el wrapper único`,
    );
    assert.ok(
      text.includes("promptInSessionWithCost"),
      `${rel} debe llamar promptInSessionWithCost`,
    );
  }
});
