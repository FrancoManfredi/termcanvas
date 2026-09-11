/**
 * cost-actual-usage — T4: el costo MEDIDO por opencode (skills, MCPs y
 * contexto inicial incluidos) viaja del `data.info` del SDK al costSummary.
 *
 * Contrato bajo test (offline: contadores en memoria + tmp, sin daemon,
 * sin LLM, sin red):
 * - `extractSessionUsage`: forma `session.prompt` (`data.info.tokens` +
 *   `cost`, la del export real del usuario), forma desenvuelta (`info`),
 *   forma `session.get` (`data` con tokens/cost); junk → null; números
 *   raros se clampenan, costo inválido → null.
 * - `recordRealUsage` + `getCostSummary`: columna separada del estimado
 *   (sin doble conteo); USD prefiere el del server; sin costo del server,
 *   fallback a rates con reasoning como output; tracking apagado → no-op.
 * - `buildActualSummary`/`asValidActual`: matemática del fallback y
 *   validación tolerante.
 * - Store: `refreshCostSummary` persiste `actual` en memoria + job.json y
 *   sobrevive al restore de disco; sin turnos medidos la forma queda
 *   intacta (sin `actual`).
 * - `attemptPromptOnce` con `jobId` registra el uso y lo expone en
 *   `PromptAttempt.usage`; sin `jobId` no registra.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  asValidActual,
  buildActualSummary,
  extractSessionUsage,
  getActualSummaryForJob,
  getCostSummary,
  recordLlmCall,
  recordRealUsage,
  resetCostTracker,
  setCostTrackingOverrideForTests,
  resetCostTrackingOverrideForTests,
} from "../headless-runtime/cost/costTracker.ts";
import { attemptPromptOnce } from "../headless-runtime/llm/agentTransport.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { readWorkItemFromDir } from "../headless-runtime/workItem/workItemDisk.ts";
import { CostSummarySchema } from "../shared/types/workItem.ts";

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const createdIds: string[] = [];
const createdDirs: string[] = [];

function mkJob(id: string): string {
  const dir = mkTmp("cost-actual-job-");
  createdDirs.push(dir);
  workItemStore.create({ id, prompt: `prompt de prueba ${id}`, worktree: dir });
  createdIds.push(id);
  return dir;
}

function cleanup(): void {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {
      // noop
    }
  }
  for (const dir of createdDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

test.beforeEach(() => {
  resetCostTracker();
  setCostTrackingOverrideForTests(true);
});

test.afterEach(() => {
  resetCostTracker();
  resetCostTrackingOverrideForTests();
  cleanup();
});

// ─── Extractor ───

function foremanInfo() {
  return {
    data: {
      info: {
        tokens: {
          total: 28631,
          input: 28014,
          output: 106,
          reasoning: 270,
          cache: { read: 241, write: 0 },
        },
        cost: 0.002877082,
      },
    },
  };
}

test("cost actual: extrae la forma session.prompt del export real", () => {
  assert.deepEqual(extractSessionUsage(foremanInfo()), {
    input: 28014,
    output: 106,
    reasoning: 270,
    cacheRead: 241,
    cacheWrite: 0,
    cost: 0.002877082,
  });
});

test("cost actual: formas desenvuelta y session.get + junk", () => {
  const info = (foremanInfo().data as { info: unknown }).info;
  assert.deepEqual(extractSessionUsage({ info })?.input, 28014);
  assert.deepEqual(
    extractSessionUsage({ data: { id: "ses_x", ...(info as object) } })?.cost,
    0.002877082,
  );
  for (const junk of [null, undefined, 42, "x", [], {}, { data: {} }, { data: { info: {} } }, { info: { tokens: null } }]) {
    assert.equal(extractSessionUsage(junk), null, String(junk));
  }
  // Costo sin tokens igual sirve; números raros se clampenan.
  assert.deepEqual(extractSessionUsage({ data: { info: { cost: 0.5 } } }), {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.5,
  });
  assert.deepEqual(
    extractSessionUsage({ data: { info: { tokens: { input: -5, output: NaN, cache: { read: 2.9 } }, cost: -1 } } }),
    { input: 0, output: 0, reasoning: 0, cacheRead: 2, cacheWrite: 0, cost: null },
  );
});

// ─── Contadores y resumen ───

const RATE = { inputUSDper1M: 0.1, outputUSDper1M: 0.2 };

test("cost actual: columna separada, USD del server manda", () => {
  recordLlmCall("job-cost-a", 4000, 400);
  recordRealUsage("job-cost-a", {
    input: 28014,
    output: 106,
    reasoning: 270,
    cacheRead: 241,
    cacheWrite: 0,
    cost: 0.002877082,
  });
  const summary = getCostSummary("job-cost-a", RATE, "prov/model");
  assert.ok(summary);
  // Estimado intacto (1 llamada lógica).
  assert.equal(summary.llmCalls, 1);
  assert.equal(summary.estimatedInputTokens, 1000);
  assert.equal(summary.estimatedOutputTokens, 100);
  assert.ok(summary.actual);
  assert.equal(summary.actual.inputTokens, 28014);
  assert.equal(summary.actual.outputTokens, 106);
  assert.equal(summary.actual.reasoningTokens, 270);
  assert.equal(summary.actual.cacheReadTokens, 241);
  assert.equal(summary.actual.calls, 1);
  assert.equal(summary.actual.usd, 0.002877082);
  assert.equal(summary.actual.usdSource, "server");
  assert.equal(summary.actual.basis, "opencode-session");
  // Zod lo acepta con y sin actual.
  CostSummarySchema.parse(summary);
  CostSummarySchema.parse({ ...summary, actual: undefined });
});

test("cost actual: sin costo del server, fallback a rates con reasoning como output", () => {
  recordRealUsage("job-cost-b", {
    input: 1000000,
    output: 500000,
    reasoning: 500000,
    cacheRead: 0,
    cacheWrite: 0,
    cost: null,
  });
  const summary = getCostSummary("job-cost-b", RATE, "prov/model");
  assert.ok(summary?.actual);
  // (1.0M in × 0.10 + 1.0M out+rea × 0.20) = 0.30 (tolerancia float).
  assert.ok(
    summary.actual.usd !== null && Math.abs(summary.actual.usd - 0.3) < 1e-9,
    String(summary.actual.usd),
  );
  assert.equal(summary.actual.usdSource, "rates");
});

test("cost actual: sin turnos medidos no hay actual (forma intacta)", () => {
  recordLlmCall("job-cost-c", 4000, 400);
  const summary = getCostSummary("job-cost-c", RATE, "prov/model");
  assert.ok(summary);
  assert.equal("actual" in summary, false);
});

test("cost actual: tracking apagado no registra ni resume", () => {
  setCostTrackingOverrideForTests(false);
  recordRealUsage("job-cost-d", {
    input: 10,
    output: 10,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.1,
  });
  assert.equal(getCostSummary("job-cost-d", RATE, "r"), null);
  assert.equal(getActualSummaryForJob("job-cost-d"), undefined);
});

test("cost actual: buildActualSummary y asValidActual", () => {
  assert.equal(
    buildActualSummary(
      { calls: 0, input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0, serverUsd: null },
      RATE,
    ),
    undefined,
  );
  const built = buildActualSummary(
    { calls: 2, input: 100, output: 50, reasoning: 10, cacheRead: 5, cacheWrite: 0, serverUsd: null },
    null,
  );
  assert.ok(built);
  assert.equal(built.usd, null);
  assert.equal(built.usdSource, null);
  assert.deepEqual(asValidActual(built), built);
  assert.equal(asValidActual(null), undefined);
  assert.equal(asValidActual({}), undefined);
  assert.equal(asValidActual({ ...built, usd: 1 }), undefined);
  assert.equal(asValidActual({ ...built, basis: "estimated-chars/4" }), undefined);
});

// ─── Transporte ───

test("cost actual: attemptPromptOnce registra con jobId y expone usage", async () => {
  const out = await attemptPromptOnce(
    async () => foremanInfo(),
    { label: "t", jobId: "job-cost-e" },
  );
  assert.ok(out.usage);
  assert.equal(out.usage.input, 28014);
  const summary = getActualSummaryForJob("job-cost-e");
  assert.ok(summary);
  assert.equal(summary.inputTokens, 28014);
  assert.equal(summary.usd, 0.002877082);
});

test("cost actual: attemptPromptOnce sin jobId no registra", async () => {
  const out = await attemptPromptOnce(async () => foremanInfo(), { label: "t" });
  assert.ok(out.usage);
  assert.equal(getActualSummaryForJob("job-cost-e"), undefined);
});

// ─── Store + disco ───

test("cost actual: refresh persiste actual y sobrevive al restore", () => {
  const dir = mkJob("job-cost-f");
  recordLlmCall("job-cost-f", 8000, 800);
  recordRealUsage("job-cost-f", {
    input: 28014,
    output: 106,
    reasoning: 270,
    cacheRead: 241,
    cacheWrite: 0,
    cost: 0.002877082,
  });
  const updated = workItemStore.refreshCostSummary("job-cost-f", "opencode-go/muse-spark-1.2-contributor");
  assert.ok(updated?.costSummary?.actual);
  assert.equal(updated.costSummary.actual.inputTokens, 28014);
  const jobDir = workItemStore.get("job-cost-f")?.dir as string;
  assert.ok(jobDir);
  assert.ok(jobDir.startsWith(dir));
  const onDisk = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf-8")) as {
    costSummary?: unknown;
  };
  assert.equal((onDisk.costSummary as { actual?: { inputTokens?: unknown } }).actual?.inputTokens, 28014);
  const restored = readWorkItemFromDir(jobDir);
  assert.equal(restored?.costSummary?.actual?.inputTokens, 28014);
  assert.equal(restored?.costSummary?.actual?.usd, 0.002877082);
});
