/**
 * Ola 18 — Paridad Warp P1.6 (benchmarks + scorers por trial, lado E2).
 * node:test + tsx. Juez del reviewer Y jueces de scorers mockeados
 * (cero llamadas LLM reales), sin daemon (engine + file helpers + puras).
 * No muta jobs productivos: los runs van a `factory/.benchmark-results/`
 * (se borran en test.after, precedente de measure-benchmark) y los trials
 * usan jobs EFÍMEROS que el engine borra del store en `finally`.
 *
 * - Trial con scorers mockeados → `trial.scores` con label+passing.
 * - Scorer que falla → trial sigue con ese scorer unscored + Correctness intacto.
 * - `scorers` ausente → TODOS los cargados vía loader (nombres solo desde el
 *   loader: este archivo los descubre dinámico, el engine jamás los hardcodea).
 * - Stats `scorePassRate` por scorer y config (unscored excluidos).
 * - Cap 50 trials intacto (cuenta solo trials, no scorers).
 * - Aviso de costo = trials × (1 + scorers).
 * - 409 manual fuera de alcance con mensaje exacto (helper puro del server).
 * - `agents` expuesto en la respuesta de scorers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeBenchmarkStats,
  countBenchmarkTrials,
  estimateBenchmarkCalls,
  validateBenchmarkDefinition,
  type BenchmarkDefinition,
  type TrialResult,
} from "../shared/types/benchmark.ts";
import {
  createPendingBenchmarkRun,
  deleteBenchmarkRun,
  readBenchmarkRunFile,
  resolveBenchmarkScorers,
  runBenchmark,
} from "../headless-runtime/measure/benchmarkEngine.ts";
import { listScorers } from "../headless-runtime/measure/scorerLoader.ts";
import { checkManualScoreApplicability } from "../headless-runtime/measure/scorerHttp.ts";
import {
  collectScorerInputs,
  scorerAppliesTo,
  scorerRequiredStages,
  setScorerPromptMock,
  stagesForInputs,
} from "../headless-runtime/measure/scorerEngine.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import {
  filterScorersByRole,
  groupScorersByRole,
  parseJobScores,
  parseScorersList,
  scorerRolesPresent,
  type ScorerDef,
} from "../src/features/factoryLab/components/scorersUi.ts";
import {
  formatScoreRateValue,
  parseRunDetail,
  parseScorersField,
  totalCallsWithScorers,
  validateDefinitionInput,
} from "../src/features/factoryLab/components/benchmarksUi.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const trackedRuns: string[] = [];
const trackedJobs: Array<{ id: string; dir: string }> = [];
let jobSeq = 0;

function trackRun(id: string): void {
  trackedRuns.push(id);
}

/** Nombres de scorers cargados: SIEMPRE desde el loader, jamás literales. */
function loadedScorerNames(): string[] {
  return listScorers().map((d) => d.name);
}

/** Label con score ≥ passingScore (dinámico: vale para cualquier scorer). */
function passLabelFor(scorerName: string): string {
  const def = listScorers().find((d) => d.name === scorerName);
  assert.ok(def, `scorer cargado esperado: ${scorerName}`);
  const found = def.labels.find((l) => l.score >= def.passingScore);
  return (found ?? def.labels[0]).value;
}

function mockReviewAccept(): void {
  setReviewPromptMock(async () =>
    JSON.stringify({
      verdict: "accept",
      confidence: 0.9,
      summary: "cambio correcto y acotado",
      findings: [],
    }),
  );
}

/** Juez mockeado por scorer; los de `failScorers` responden null (= falla). */
function mockJudgePass(failScorers: string[] = []): Map<string, number> {
  const calls = new Map<string, number>();
  setScorerPromptMock(async (input) => {
    calls.set(input.scorerName, (calls.get(input.scorerName) ?? 0) + 1);
    if (failScorers.includes(input.scorerName)) return null;
    return JSON.stringify({
      label: passLabelFor(input.scorerName),
      reason: `evidencia citada para ${input.scorerName}`,
    });
  });
  return calls;
}

function nextJobId(): string {
  jobSeq += 1;
  return `job-e2b18-${Date.now().toString(36)}-${jobSeq}`;
}

function makeJob(prompt = "hacer algo util en el repo"): string {
  const id = nextJobId();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "benchscorer-job-"));
  workItemStore.create({ id, prompt: `${prompt} ${id}`, worktree, phase: "diagnosisLlm" });
  // Se trackea el worktree COMPLETO (incluye .agents/factory/<id>): el after
  // lo borra entero (más thorough que el precedente E1, que borraba el subdir).
  trackedJobs.push({ id, dir: worktree });
  return id;
}

function addVerification(
  id: string,
  createdFiles: string[] = ["src/cambio.ts"],
  overall: "pass" | "fail" = "pass",
): void {
  const now = new Date().toISOString();
  workItemStore.appendEvent(id, "runner", `verification ${overall}`, {
    verification: {
      steps: [
        {
          name: "test",
          command: "pnpm test",
          exitCode: overall === "pass" ? 0 : 1,
          durationMs: 5,
          status: overall === "pass" ? "pass" : "fail",
          logPath: "logs/build.log",
        },
      ],
      overall,
      startedAt: now,
      finishedAt: now,
      durationMs: 5,
    },
    createdFiles,
    runnerId: "linux-build",
  } as unknown as Record<string, unknown>);
}

function addReview(id: string, verdict = "accept"): void {
  workItemStore.appendEvent(id, "system", `review ${verdict} (semilla de test)`, {
    review: { verdict, summary: "cambio pertinente con evidencia citada" },
  } as unknown as Record<string, unknown>);
}

function makeBenchDef(opts: {
  tasks?: number;
  configs?: number;
  reps?: number;
  scorers?: string[];
  skipValidate?: boolean;
}): BenchmarkDefinition {
  const raw: Record<string, unknown> = {
    name: "bench-e2-p16",
    tasks: Array.from({ length: opts.tasks ?? 1 }, (_, i) => ({
      id: `t${i + 1}`,
      prompt: `prompt neutro ${i + 1}`,
      files: [{ path: `notes/t${i + 1}.txt`, content: `contenido neutro ${i + 1}\n` }],
      verification: { overall: "pass" },
      expectedVerdict: "accept",
    })),
    configs: Array.from({ length: opts.configs ?? 1 }, (_, i) => ({
      id: `c${i + 1}`,
      reviewerModel: { providerID: "test-provider", modelID: `model-${i + 1}` },
    })),
    repetitions: opts.reps ?? 1,
  };
  if (opts.scorers !== undefined) raw.scorers = opts.scorers;
  if (opts.skipValidate) return raw as unknown as BenchmarkDefinition;
  return validateBenchmarkDefinition(raw);
}

function trialResult(
  over: Partial<TrialResult> & { taskId: string; configId: string },
): TrialResult {
  return {
    repetition: 1,
    verdict: "accept",
    confidence: 1,
    findingsCount: 0,
    parseOk: true,
    durationMs: 10,
    pass: true,
    ...over,
  };
}

test.after(() => {
  try {
    setReviewPromptMock(null);
  } catch {}
  try {
    setScorerPromptMock(null);
  } catch {}
  for (const id of trackedRuns) {
    try {
      deleteBenchmarkRun(id);
    } catch {}
  }
  trackedRuns.length = 0;
  for (const { id, dir } of trackedJobs) {
    try {
      workItemStore.delete(id);
    } catch {}
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  trackedJobs.length = 0;
});

// ── resolveBenchmarkScorers (default dinámico, saneo) ──

test("resolveBenchmarkScorers: ausente → todos los cargados vía loader", () => {
  const all = loadedScorerNames();
  assert.ok(all.length >= 1, "se necesita ≥1 scorer cargado");
  assert.deepEqual(
    resolveBenchmarkScorers({ name: "x", tasks: [], configs: [], repetitions: 1 }),
    all,
  );
  assert.deepEqual(resolveBenchmarkScorers(null), all);
  assert.deepEqual(resolveBenchmarkScorers(undefined), all);
});

test("resolveBenchmarkScorers: explícito manda, vacío = opt-out, sanea", () => {
  const all = loadedScorerNames();
  assert.deepEqual(resolveBenchmarkScorers({ scorers: [all[0]] }), [all[0]]);
  assert.deepEqual(resolveBenchmarkScorers({ scorers: [] }), []);
  assert.deepEqual(
    resolveBenchmarkScorers({ scorers: ["", "  ", all[0], all[0], "??", all[0]] }),
    [all[0]],
  );
  const many = Array.from({ length: 15 }, (_, i) => `s${i}-x`);
  assert.equal(resolveBenchmarkScorers({ scorers: many }).length, 10);
});

test("cero hardcodeos: engine y tipos no nombran scorers concretos", () => {
  const names = loadedScorerNames();
  assert.ok(names.length >= 1);
  for (const rel of [
    "../headless-runtime/measure/benchmarkEngine.ts",
    "../shared/types/benchmark.ts",
    "../headless-runtime/factory/factoryServer.ts",
  ]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), "utf-8");
    for (const n of names) {
      assert.ok(!src.includes(n), `${rel} hardcodea el scorer "${n}"`);
    }
  }
  void HERE;
});

// ── Trial con scorers (juez mockeado) ──

test("trial con scorers mockeados → trial.scores con label+passing", async () => {
  const names = loadedScorerNames();
  mockReviewAccept();
  const calls = mockJudgePass();
  const def = makeBenchDef({ scorers: [names[0]] });
  const run = await runBenchmark(def);
  trackRun(run.id);
  assert.equal(run.status, "done");
  assert.equal(run.trials.length, 1);
  const t = run.trials[0];
  assert.equal(t.pass, true, "Correctness del trial intacto");
  assert.deepEqual(Object.keys(t.scores ?? {}), [names[0]]);
  assert.equal(t.scores?.[names[0]].label, passLabelFor(names[0]));
  assert.equal(t.scores?.[names[0]].passing, true);
  assert.equal(calls.get(names[0]), 1, "1 llamada al juez por scorer por trial");
  assert.equal(run.llmCalls, 2, "1 revisor + 1 juez");
  assert.equal(run.stats["c1"]?.scorePassRates?.[names[0]], 1);
  assert.equal("winner" in run.stats, false, "sin ganador automático");
  const disk = readBenchmarkRunFile(run.id);
  assert.ok(disk, "run persistido en disco");
  assert.deepEqual(disk?.trials[0].scores, t.scores, "scores por trial en disco");
});

test("scorer que falla → trial sigue con ese scorer unscored + Correctness intacto", async () => {
  const names = loadedScorerNames();
  assert.ok(names.length >= 2, "se necesitan ≥2 scorers cargados");
  mockReviewAccept();
  const calls = mockJudgePass([names[1]]);
  const def = makeBenchDef({ scorers: [names[0], names[1]] });
  const run = await runBenchmark(def);
  trackRun(run.id);
  assert.equal(run.status, "done");
  const t = run.trials[0];
  assert.equal(t.pass, true, "Correctness manda aunque un scorer falle");
  assert.ok(t.scores?.[names[0]], "el scorer sano scored");
  assert.ok(
    !(names[1] in (t.scores ?? {})),
    "el scorer fallido queda ausente (unscored, no fail)",
  );
  assert.equal(calls.get(names[1]), 1, "se intentó igual (1 llamada)");
  assert.equal(run.llmCalls, 3, "1 revisor + 2 intentos de juez");
  assert.equal(run.stats["c1"]?.scorePassRates?.[names[0]], 1);
  assert.ok(
    !(names[1] in (run.stats["c1"]?.scorePassRates ?? {})),
    "el fallido no entra al scorePassRate",
  );
});

test("scorers ausente → corre TODOS los cargados (sin nombres en código)", async () => {
  const names = loadedScorerNames();
  mockReviewAccept();
  mockJudgePass();
  const def = makeBenchDef({});
  assert.ok(!("scorers" in def), "la definition no trae scorers");
  const run = await runBenchmark(def);
  trackRun(run.id);
  assert.deepEqual(Object.keys(run.trials[0].scores ?? {}).sort(), [...names].sort());
  assert.equal(run.llmCalls, 1 + names.length);
  for (const n of names) {
    assert.equal(run.stats["c1"]?.scorePassRates?.[n], 1);
  }
});

// ── scorePassRate unitario (unscored excluidos) ──

test("computeBenchmarkStats: scorePassRate excluye unscored", () => {
  const stats = computeBenchmarkStats(
    [
      trialResult({ taskId: "t1", configId: "c1", scores: { s1: { label: "a", passing: true } } }),
      trialResult({
        taskId: "t2",
        configId: "c1",
        scores: { s1: { label: "b", passing: true }, s2: { label: "x", passing: false } },
      }),
      trialResult({ taskId: "t3", configId: "c1" }),
      trialResult({ taskId: "t4", configId: "c1", scores: {} }),
      trialResult({
        taskId: "t5",
        configId: "c1",
        pass: false,
        scores: { s1: { label: "c", passing: false } },
      }),
    ],
    ["c1"],
  );
  assert.equal(stats["c1"].scorePassRates?.["s1"], 0.6667, "2 pass / 3 scored (2 ausentes no cuentan)");
  assert.equal(stats["c1"].scorePassRates?.["s2"], 0, "0 pass / 1 scored");
});

test("computeBenchmarkStats: sin scores no hay key scorePassRates (pacto intacto)", () => {
  const stats = computeBenchmarkStats(
    [trialResult({ taskId: "t1", configId: "a" })],
    ["a"],
  );
  assert.deepEqual(stats["a"], {
    trials: 1,
    pass: 1,
    passRate: 1,
    avgDurationMs: 10,
    parseErrors: 0,
  });
  assert.ok(!("scorePassRates" in stats["a"]));
});

// ── Cap 50 + costo ──

test("cap 50 trials intacto (cuenta trials, no scorers)", () => {
  const names = loadedScorerNames();
  const big = makeBenchDef({ tasks: 10, configs: 2, reps: 3, skipValidate: true });
  assert.equal(countBenchmarkTrials(big), 60);
  assert.throws(() => validateBenchmarkDefinition(big), /cap/);
  assert.throws(
    () => validateBenchmarkDefinition({ ...big, scorers: [names[0]] }),
    /cap/,
  );
  assert.throws(() => createPendingBenchmarkRun(big), /cap/);
  const edge = makeBenchDef({ tasks: 10, configs: 5, reps: 1, scorers: [names[0]] });
  assert.equal(countBenchmarkTrials(edge), 50, "50 exactos pasan con scorers");
});

test("aviso de costo = trials × (1 + scorers)", () => {
  const names = loadedScorerNames();
  const explicit = makeBenchDef({ tasks: 2, configs: 2, reps: 1, scorers: [names[0]], skipValidate: true });
  assert.equal(countBenchmarkTrials(explicit), 4);
  assert.equal(estimateBenchmarkCalls(explicit), 8, "4 trials × (1 + 1 scorer)");
  assert.equal(totalCallsWithScorers(explicit, 99), 8, "explícito manda sobre el fallback");
  const implicit = makeBenchDef({ tasks: 2, configs: 2, reps: 1, skipValidate: true });
  assert.equal(estimateBenchmarkCalls(implicit), 4, "sin dato = solo revisor");
  assert.equal(estimateBenchmarkCalls(implicit, 3), 16, "ausente + 3 cargados = 4 × 4");
  assert.equal(totalCallsWithScorers(implicit, 3), 16);
  assert.equal(totalCallsWithScorers(implicit), 4);
  assert.equal(totalCallsWithScorers(null), 0);
  assert.equal(estimateBenchmarkCalls(null), 0);
});

// ── 409 fuera de alcance (helper del server + gate, sin daemon) ──

test("409: helper puro con el mensaje exacto", () => {
  assert.deepEqual(checkManualScoreApplicability(true, ["review"]), { ok: true });
  const g1 = checkManualScoreApplicability(false, ["review"]);
  assert.equal(g1.ok, false);
  if (!g1.ok) {
    assert.equal(g1.code, 409);
    assert.equal(g1.error, "este scorer no aplica a este job todavía (requiere etapa: review)");
  }
  const g2 = checkManualScoreApplicability(false, ["implement", "verification"]);
  if (!g2.ok) {
    assert.equal(
      g2.error,
      "este scorer no aplica a este job todavía (requiere etapa: implement+verification)",
    );
  }
  // El orden canónico lo pone el caller (scorerRequiredStages), no el helper.
  assert.deepEqual(scorerRequiredStages(["verification", "implement"]), [
    "implement",
    "verification",
  ]);
});

test("409: job sin review + scorer de review → no aplica; con review → aplica", () => {
  const reviewScorer = listScorers().find((d) => d.agents.includes("review"));
  assert.ok(reviewScorer, "se necesita un scorer de review cargado");
  const id = makeJob();
  addVerification(id, ["src/cambio.ts"], "pass");
  const inputs = collectScorerInputs(id);
  assert.ok(inputs, "inputs colectados sin daemon");
  const stages = stagesForInputs(inputs);
  assert.deepEqual(stages, { review: false, implement: true, verification: true });
  assert.equal(scorerAppliesTo(stages, reviewScorer.agents), false);
  assert.deepEqual(scorerRequiredStages(reviewScorer.agents), ["review"]);
  addReview(id);
  const inputs2 = collectScorerInputs(id);
  assert.ok(inputs2);
  assert.equal(
    scorerAppliesTo(stagesForInputs(inputs2), reviewScorer.agents),
    true,
    "con review el scorer aplica",
  );
});

// ── agents expuesto ──

test("agents expuesto: las definitions serializadas traen agents", () => {
  const defs = listScorers();
  assert.ok(defs.length >= 1);
  for (const d of defs) {
    assert.ok(d.agents.length >= 1, `${d.name} sin agents`);
  }
  const parsed = parseScorersList({ scorers: defs });
  assert.deepEqual(
    parsed.map((p) => p.agents),
    defs.map((d) => [...d.agents]),
    "el parser conserva agents",
  );
});

// ── UI: passing del summary, agrupación, campo scorers ──

test("UI: el panel usa el passing del backend verbatim (no recomputa)", () => {
  const js = parseJobScores({
    workItemId: "job-x",
    scores: {
      s: { label: "v", score: 0, passing: true, reason: "r", model: "m", origin: "manual", at: "2026-01-01" },
    },
  });
  assert.equal(js.scores["s"].passing, true, "score 0 + passing true se conserva (lo decide el server)");
  const js2 = parseJobScores({
    workItemId: "job-x",
    scores: {
      s: { label: "v", score: 1, passing: false, reason: "r", model: "m", origin: "manual", at: "2026-01-01" },
    },
  });
  assert.equal(js2.scores["s"].passing, false);
});

test("UI: agrupación y filtrado de scorers por rol", () => {
  const base = {
    description: "",
    labels: [],
    passingScore: 0.5,
    samplingRate: 0,
    model: "",
    selfImprovement: false,
  } as const;
  const fake: ScorerDef[] = [
    { name: "a", agents: ["review"], ...base },
    { name: "b", agents: ["implement", "review"], ...base },
    { name: "c", agents: [], ...base },
  ];
  assert.deepEqual(scorerRolesPresent(fake), ["implement", "review", "sin rol"]);
  assert.deepEqual(
    filterScorersByRole(fake, "todos").map((s) => s.name),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    filterScorersByRole(fake, "review").map((s) => s.name),
    ["a", "b"],
  );
  assert.deepEqual(
    filterScorersByRole(fake, "implement").map((s) => s.name),
    ["b"],
  );
  assert.deepEqual(filterScorersByRole(fake, "nada"), []);
  assert.deepEqual(filterScorersByRole(null, "review"), []);
  const groups = groupScorersByRole(fake);
  assert.deepEqual(
    groups.map((g) => g.role),
    ["implement", "review", "sin rol"],
  );
  assert.deepEqual(groups[0].scorers.map((s) => s.name), ["b"], "b va en su rol primario");
  assert.deepEqual(groups[1].scorers.map((s) => s.name), ["a"]);
  assert.deepEqual(groupScorersByRole(null), []);
  assert.deepEqual(scorerRolesPresent(null), []);
});

test("UI: campo scorers, costo con scorers y tasas de score", () => {
  assert.deepEqual(parseScorersField({}), { ok: true, scorers: [] });
  assert.deepEqual(parseScorersField({ scorers: ["a-b"] }), { ok: true, scorers: ["a-b"] });
  assert.deepEqual(parseScorersField({ scorers: [] }), { ok: true, scorers: [] });
  assert.equal(parseScorersField({ scorers: "x" }).ok, false);
  assert.equal(parseScorersField({ scorers: [""] }).ok, false);
  assert.equal(parseScorersField({ scorers: ["a", "a"] }).ok, false);
  assert.equal(
    parseScorersField({ scorers: Array.from({ length: 11 }, (_, i) => `s${i}`) }).ok,
    false,
  );
  const v = validateDefinitionInput(
    JSON.stringify({
      name: "demo",
      tasks: [
        {
          id: "t1",
          prompt: "p",
          files: [{ path: "a/b.md", content: "x" }],
          expectedVerdict: "accept",
        },
      ],
      configs: [{ id: "c1", reviewerModel: "opencode/big-pickle" }],
      repetitions: 1,
      scorers: ["un-scorer"],
    }),
  );
  assert.equal(v.ok, true, "validateDefinitionInput ignora scorers (pacto intacto)");
  assert.equal(formatScoreRateValue(0.6667), "67%");
  assert.equal(formatScoreRateValue(1), "100%");
  assert.equal(formatScoreRateValue(0), "0%");
  assert.equal(formatScoreRateValue(null), "—");
  assert.equal(formatScoreRateValue(2), "—");
  assert.equal(formatScoreRateValue(Number.NaN), "—");
  const d = parseRunDetail({
    id: "b1",
    name: "n",
    status: "done",
    createdAt: "x",
    trials: [
      {
        taskId: "t",
        configId: "c",
        repetition: 1,
        verdict: "accept",
        confidence: 1,
        findingsCount: 0,
        parseOk: true,
        durationMs: 5,
        pass: true,
        scores: { s1: { label: "ok", passing: true } },
      },
    ],
    stats: {
      c: { trials: 1, pass: 1, passRate: 1, avgDurationMs: 5, parseErrors: 0, scorePassRates: { s1: 1 } },
    },
  });
  assert.deepEqual(d?.trials[0].scores, { s1: { label: "ok", passing: true } });
  assert.deepEqual(d?.stats["c"].scorePassRates, { s1: 1 });
  const d2 = parseRunDetail({
    id: "b1",
    trials: [],
    stats: { c: { trials: 0, pass: 0, passRate: 0, avgDurationMs: 0, parseErrors: 0 } },
  });
  assert.deepEqual(d2?.trials, []);
  assert.deepEqual(d2?.stats["c"].scorePassRates, {}, "stats viejas → mapa vacío");
});

// ── Higiene (último: verifica que el engine no dejó rastros) ──

test("higiene: el engine borró sus jobs efímeros del store", () => {
  const leftovers = workItemStore
    .list()
    .filter((j) => j.id.startsWith("job-benchscore-"))
    .map((j) => j.id);
  assert.deepEqual(leftovers, []);
});
