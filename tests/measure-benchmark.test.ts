/**
 * Ola 12 — Measure: Benchmarks (configs de reviewer × tasks fijas,
 * Correctness built-in, sin ganador automático).
 * node:test + tsx. Sin red (reviewer vía setReviewPromptMock de reviewAgent),
 * sin daemon (engine + file helpers + puras). No muta jobs productivos ni
 * `factory/` salvo `factory/.benchmark-results/<runId>.json` propios, que se
 * borran en test.after.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BENCHMARK_MAX_TRIALS,
  BenchmarkDefinitionSchema,
  BenchmarkTaskSchema,
  TrialResultSchema,
  computeBenchmarkStats,
  countBenchmarkTrials,
  validateBenchmarkDefinition,
  type BenchmarkDefinition,
} from "../shared/types/benchmark.ts";
import {
  BENCHMARK_FIXTURE_PREFIX,
  createPendingBenchmarkRun,
  deleteBenchmarkRun,
  executeBenchmarkTrials,
  getBenchmarkResultsDir,
  getBenchmarkRun,
  listBenchmarkRuns,
  makeBenchmarkRunId,
  readBenchmarkRunFile,
  runBenchmark,
} from "../headless-runtime/measure/benchmarkEngine.ts";
import {
  isBenchmarkCreatePath,
  isBenchmarksListPath,
  isSafeBenchmarkRunId,
  parseBenchmarkGetPath,
} from "../headless-runtime/measure/benchmarkHttp.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";
import { setScorerPromptMock } from "../headless-runtime/measure/scorerEngine.ts";
import { listScorers } from "../headless-runtime/measure/scorerLoader.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const trackedRuns: string[] = [];
function track(id: string): void {
  trackedRuns.push(id);
}

function acceptMock(summary = "cambio correcto y acotado"): void {
  setReviewPromptMock(async () =>
    JSON.stringify({ verdict: "accept", confidence: 0.9, summary, findings: [] }),
  );
}

function reviseMock(): void {
  setReviewPromptMock(async () =>
    JSON.stringify({
      verdict: "revise",
      confidence: 0.8,
      summary: "hay un problema mayor",
      findings: [
        {
          id: "f1",
          axis: "requirements",
          severity: "major",
          message: "falta un caso",
        },
      ],
    }),
  );
}

// ── Ola 18 P1.6 (extensión E2): juez de scorers mockeado ──
// Desde P1.6 cada trial corre los scorers cargados (definition sin `scorers`
// = TODOS) ADEMÁS de Correctness. Sin este mock, cada trial intentaría el
// juez LLM real (cuota + decenas de segundos por trial): en tests el juez va
// mockeado, cero LLM real. Labels descubiertos del loader (nada hardcodeado).
function mockAllScorersPass(): void {
  setScorerPromptMock(async (input) => {
    const def = listScorers().find((d) => d.name === input.scorerName);
    const label = def
      ? ((def.labels.find((l) => l.score >= def.passingScore) ?? def.labels[0])?.value ?? null)
      : null;
    if (!label) return null;
    return JSON.stringify({ label, reason: "mock de extension Ola 18 (todos pasan)" });
  });
}
mockAllScorersPass();

function makeTask(id: string, prompt: string): BenchmarkDefinition["tasks"][number] {
  return {
    id,
    prompt,
    files: [{ path: `notes/${id}.txt`, content: `contenido neutro de ${id}\n` }],
    verification: { overall: "pass" },
    expectedVerdict: "accept",
  };
}

function makeConfig(id: string, modelID: string): BenchmarkDefinition["configs"][number] {
  return { id, reviewerModel: { providerID: "test-provider", modelID } };
}

function makeDef(
  tasks: number,
  configs: number,
  repetitions: number,
): BenchmarkDefinition {
  return {
    name: `bench-test-${tasks}x${configs}x${repetitions}`,
    tasks: Array.from({ length: tasks }, (_, i) => makeTask(`task-${i + 1}`, `prompt neutro ${i + 1}`)),
    configs: Array.from({ length: configs }, (_, i) => makeConfig(`cfg-${i + 1}`, `model-${i + 1}`)),
    repetitions,
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
});

// ── Schemas ──

test("schemas: definition válida + inválidas (tasks/configs/reps/verdict/overall)", () => {
  const good = makeDef(2, 2, 1);
  assert.deepEqual(validateBenchmarkDefinition(good), good);
  assert.equal(BenchmarkDefinitionSchema.safeParse(good).success, true);

  assert.throws(() => validateBenchmarkDefinition({ ...good, tasks: [] }));
  assert.throws(() => validateBenchmarkDefinition({ ...good, configs: [] }));
  assert.throws(() => validateBenchmarkDefinition({ ...good, repetitions: 0 }));
  assert.throws(() => validateBenchmarkDefinition({ ...good, repetitions: 4 }));
  assert.throws(() => validateBenchmarkDefinition({ ...good, name: "" }));
  assert.throws(() =>
    validateBenchmarkDefinition({
      ...good,
      tasks: [{ ...good.tasks[0], expectedVerdict: "maybe" }],
    }),
  );
  assert.throws(() =>
    validateBenchmarkDefinition({
      ...good,
      tasks: [{ ...good.tasks[0], verification: { overall: "fail" } }],
    }),
  );
  assert.throws(() =>
    validateBenchmarkDefinition({
      ...good,
      tasks: [good.tasks[0], { ...good.tasks[1], id: good.tasks[0].id }],
    }),
  );
  assert.throws(() =>
    validateBenchmarkDefinition({
      ...good,
      configs: [good.configs[0], { ...good.configs[1], id: good.configs[0].id }],
    }),
  );
  assert.throws(() =>
    validateBenchmarkDefinition({
      ...good,
      tasks: [
        {
          ...good.tasks[0],
          files: Array.from({ length: 6 }, (_, i) => ({
            path: `f${i}.txt`,
            content: "x",
          })),
        },
      ],
    }),
  );
  assert.throws(() =>
    validateBenchmarkDefinition({
      ...good,
      tasks: [
        { ...good.tasks[0], files: [{ path: "../evil.txt", content: "x" }] },
      ],
    }),
  );
  assert.equal(countBenchmarkTrials(good), 4);
  assert.equal(countBenchmarkTrials(null), 0);
  assert.equal(countBenchmarkTrials({}), 0);
});

test("cap: definition que excede BENCHMARK_MAX_TRIALS lanza (400 con razón)", async () => {
  assert.equal(BENCHMARK_MAX_TRIALS, 50);
  const big = makeDef(5, 4, 3);
  assert.equal(countBenchmarkTrials(big), 60);
  await assert.rejects(runBenchmark(big), /cap/);
  assert.throws(() => createPendingBenchmarkRun(big), /cap/);
});

test("puras: computeBenchmarkStats agrega por config sin ganador", () => {
  const stats = computeBenchmarkStats(
    [
      { taskId: "t1", configId: "a", repetition: 1, verdict: "accept", confidence: 0.9, findingsCount: 0, parseOk: true, durationMs: 10, pass: true },
      { taskId: "t2", configId: "a", repetition: 1, verdict: "revise", confidence: 0.8, findingsCount: 1, parseOk: true, durationMs: 30, pass: false },
      { taskId: "t1", configId: "b", repetition: 1, verdict: "ask_human", confidence: 0.5, findingsCount: 0, parseOk: false, durationMs: 5, pass: false },
    ],
    ["a", "b", "c"],
  );
  assert.deepEqual(stats.a, { trials: 2, pass: 1, passRate: 0.5, avgDurationMs: 20, parseErrors: 0 });
  assert.deepEqual(stats.b, { trials: 1, pass: 0, passRate: 0, avgDurationMs: 5, parseErrors: 1 });
  assert.deepEqual(stats.c, { trials: 0, pass: 0, passRate: 0, avgDurationMs: 0, parseErrors: 0 });
  assert.equal("winner" in stats, false);
  assert.deepEqual(computeBenchmarkStats(null, null), {});
});

// ── Run con mock accept → passRate 1 (4 tasks × 2 configs × 1 rep = 8) ──

test("run con mock accept: 8 trials, passRate 1, sin winner/recommendation", async () => {
  acceptMock();
  try {
    const run = await runBenchmark(makeDef(4, 2, 1));
    track(run.id);
    assert.equal(run.status, "done");
    assert.equal(run.trials.length, 8);
    // Ola 18 P1.6 (extensión E2): 1 llamada al revisor + 1 al juez por scorer
    // por trial (definition sin `scorers` = todos los cargados, mockeados).
    assert.equal(run.llmCalls, run.trials.length * (1 + listScorers().length));
    assert.ok(run.finishedAt);
    const scorerNames = listScorers().map((d) => d.name);
    for (const t of run.trials) {
      assert.equal(TrialResultSchema.safeParse(t).success, true);
      assert.equal(t.pass, true);
      assert.equal(t.parseOk, true);
      assert.equal(t.verdict, "accept");
      assert.ok(t.durationMs >= 0);
      assert.deepEqual(Object.keys(t.scores ?? {}).sort(), [...scorerNames].sort());
    }
    for (const cfg of ["cfg-1", "cfg-2"]) {
      assert.deepEqual(run.stats[cfg]?.trials, 4);
      assert.deepEqual(run.stats[cfg]?.pass, 4);
      assert.deepEqual(run.stats[cfg]?.passRate, 1);
      assert.deepEqual(run.stats[cfg]?.parseErrors, 0);
      // Ola 18 P1.6 (extensión E2): con el mock todos pasan en todos los trials.
      for (const n of scorerNames) assert.equal(run.stats[cfg]?.scorePassRates?.[n], 1);
    }
    assert.equal("winner" in run, false);
    assert.equal("recommendation" in run, false);
    assert.equal(JSON.stringify(run).includes("winner"), false);
  } finally {
    setReviewPromptMock(null);
  }
});

test("reference-tasks.json: 4 tasks accept que pasan con mock accept", async () => {
  const raw = fs.readFileSync(
    path.join(HERE, "..", "factory", "benchmarks", "reference-tasks.json"),
    "utf-8",
  );
  const file = JSON.parse(raw) as { tasks: unknown[] };
  assert.equal(file.tasks.length, 4);
  const tasks = file.tasks.map((t) => BenchmarkTaskSchema.parse(t));
  for (const t of tasks) {
    assert.equal(t.expectedVerdict, "accept");
    assert.equal(t.verification.overall, "pass");
  }
  const def: BenchmarkDefinition = {
    name: "reference-tasks",
    tasks,
    configs: [makeConfig("cfg-a", "model-a"), makeConfig("cfg-b", "model-b")],
    repetitions: 1,
  };
  acceptMock();
  try {
    const run = await runBenchmark(def);
    track(run.id);
    assert.equal(run.trials.length, 8);
    assert.equal(run.stats["cfg-a"]?.passRate, 1);
    assert.equal(run.stats["cfg-b"]?.passRate, 1);
  } finally {
    setReviewPromptMock(null);
  }
});

test("run con mock revise: Correctness honesta, passRate 0 con pass=false", async () => {
  reviseMock();
  try {
    const run = await runBenchmark(makeDef(2, 2, 1));
    track(run.id);
    assert.equal(run.status, "done");
    assert.equal(run.trials.length, 4);
    for (const t of run.trials) {
      assert.equal(t.verdict, "revise");
      assert.equal(t.parseOk, true);
      assert.equal(t.pass, false);
      assert.equal(t.findingsCount, 1);
    }
    assert.equal(run.stats["cfg-1"]?.passRate, 0);
    assert.equal(run.stats["cfg-2"]?.passRate, 0);
  } finally {
    setReviewPromptMock(null);
  }
});

test("trial con mock que lanza: parseOk false y el run SIGUE", async () => {
  setReviewPromptMock(async () => {
    throw new Error("boom red");
  });
  try {
    const run = await runBenchmark(makeDef(2, 2, 1));
    track(run.id);
    assert.equal(run.status, "done");
    assert.equal(run.trials.length, 4);
    // Ola 18 P1.6: consume convierte el throw en ask_human → Correctness
    // falla, pero implement/verification SÍ califican (review queda
    // not-applicable: el trial no llegó a Review). Dinámico, sin hardcodeos.
    const nonReview = listScorers().filter((d) => !d.agents.includes("review")).length;
    assert.equal(run.llmCalls, run.trials.length * (1 + nonReview));
    for (const t of run.trials) {
      assert.equal(t.parseOk, false);
      assert.equal(t.pass, false);
      assert.equal(t.verdict, "ask_human");
    }
    assert.equal(run.stats["cfg-1"]?.parseErrors, 2);
  } finally {
    setReviewPromptMock(null);
  }
});

test("trial con mock inválido (no-JSON): parseOk false sin matar el run", async () => {
  setReviewPromptMock(async () => "esto no es json");
  try {
    const run = await runBenchmark(makeDef(1, 1, 2));
    track(run.id);
    assert.equal(run.status, "done");
    assert.equal(run.trials.length, 2);
    for (const t of run.trials) assert.equal(t.parseOk, false);
  } finally {
    setReviewPromptMock(null);
  }
});

test("secuencialidad: orden de trials = orden definido (tasks→configs→reps)", async () => {
  const seen: string[] = [];
  const workItemIds: string[] = [];
  setReviewPromptMock(async (input) => {
    seen.push(`${input.prompt}||${input.reviewerModel.providerID}/${input.reviewerModel.modelID}`);
    workItemIds.push(input.workItemId);
    return JSON.stringify({ verdict: "accept", confidence: 0.9, summary: "ok", findings: [] });
  });
  try {
    const run = await runBenchmark(makeDef(2, 2, 2));
    track(run.id);
    assert.equal(run.trials.length, 8);
    const expected: string[] = [];
    for (let t = 1; t <= 2; t++) {
      for (let c = 1; c <= 2; c++) {
        for (let r = 0; r < 2; r++) {
          expected.push(`prompt neutro ${t}||test-provider/model-${c}`);
        }
      }
    }
    assert.deepEqual(seen, expected);
    assert.equal(new Set(workItemIds).size, 8);
    assert.deepEqual(
      run.trials.map((t) => `${t.taskId}/${t.configId}/${t.repetition}`),
      [
        "task-1/cfg-1/1", "task-1/cfg-1/2",
        "task-1/cfg-2/1", "task-1/cfg-2/2",
        "task-2/cfg-1/1", "task-2/cfg-1/2",
        "task-2/cfg-2/1", "task-2/cfg-2/2",
      ],
    );
  } finally {
    setReviewPromptMock(null);
  }
});

test("raw acotado: rawSnippet ≤ 2KB aunque el raw sea enorme", async () => {
  const accept = JSON.stringify({ verdict: "accept", confidence: 0.9, summary: "ok", findings: [] });
  setReviewPromptMock(async () => `${accept} ${"x".repeat(10000)}`);
  try {
    const run = await runBenchmark(makeDef(1, 1, 1));
    track(run.id);
    assert.equal(run.trials.length, 1);
    assert.equal(run.trials[0].pass, true);
    assert.ok((run.trials[0].rawSnippet ?? "").length <= 2048);
  } finally {
    setReviewPromptMock(null);
  }
});

test("persistencia: run en disco + relectura idéntica", async () => {
  acceptMock();
  try {
    const run = await runBenchmark(makeDef(1, 1, 1));
    track(run.id);
    const target = path.join(getBenchmarkResultsDir(), `${run.id}.json`);
    assert.equal(fs.existsSync(target), true);
    const reread = readBenchmarkRunFile(run.id);
    assert.deepEqual(reread, run);
    assert.deepEqual(getBenchmarkRun(run.id), run);
    assert.equal(readBenchmarkRunFile("bench-no-existe-xyz"), null);
    assert.equal(readBenchmarkRunFile("../evil"), null);
  } finally {
    setReviewPromptMock(null);
  }
});

test("fixtures limpiadas: tmpdir sin restos del prefijo tras el run", async () => {
  acceptMock();
  try {
    const before = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith(BENCHMARK_FIXTURE_PREFIX))
      .sort();
    const run = await runBenchmark(makeDef(2, 2, 1));
    track(run.id);
    const after = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith(BENCHMARK_FIXTURE_PREFIX))
      .sort();
    assert.deepEqual(after, before);
  } finally {
    setReviewPromptMock(null);
  }
});

test("create+execute por piezas: pending running, luego done con stats", async () => {
  acceptMock();
  try {
    const def = makeDef(1, 2, 1);
    const pending = createPendingBenchmarkRun(def);
    track(pending.id);
    assert.equal(pending.status, "running");
    assert.match(pending.id, /^bench-[a-z0-9]+$/);
    assert.deepEqual(Object.keys(pending.stats).sort(), ["cfg-1", "cfg-2"]);
    const done = await executeBenchmarkTrials(pending.id, def);
    assert.equal(done.id, pending.id);
    assert.equal(done.status, "done");
    assert.equal(done.trials.length, 2);
    // Ola 18 P1.6 (extensión E2): 1 revisor + 1 juez por scorer por trial.
    assert.equal(done.llmCalls, done.trials.length * (1 + listScorers().length));
    assert.equal(makeBenchmarkRunId() === makeBenchmarkRunId(), false);
  } finally {
    setReviewPromptMock(null);
  }
});

// ── HTTP helpers puras ──

test("benchmarkHttp: rutas globales exactas + parse :id + traversal", () => {
  assert.equal(isBenchmarksListPath("/factory/benchmarks", "GET"), true);
  assert.equal(isBenchmarksListPath("/factory/benchmarks", "POST"), false);
  assert.equal(isBenchmarksListPath("/work-items/benchmarks", "GET"), false);
  assert.equal(isBenchmarkCreatePath("/factory/benchmarks", "POST"), true);
  assert.equal(isBenchmarkCreatePath("/factory/benchmarks", "GET"), false);

  assert.deepEqual(parseBenchmarkGetPath("/factory/benchmarks/bench-abc123"), {
    id: "bench-abc123",
  });
  assert.ok("error" in parseBenchmarkGetPath("/factory/benchmarks"));
  assert.ok("error" in parseBenchmarkGetPath("/factory/benchmarks/"));
  assert.ok("error" in parseBenchmarkGetPath("/factory/benchmarks/a/b"));
  assert.ok("error" in parseBenchmarkGetPath("/work-items/bench-x"));
  assert.ok("error" in parseBenchmarkGetPath("/factory/benchmarks/../x"));
  assert.ok("error" in parseBenchmarkGetPath("/factory/benchmarks/%2e%2e"));
  assert.equal(isSafeBenchmarkRunId("bench-abc-123"), true);
  assert.equal(isSafeBenchmarkRunId("../x"), false);
  assert.equal(isSafeBenchmarkRunId(""), false);
  assert.equal(isSafeBenchmarkRunId(null), false);
});

test("listBenchmarkRuns: summaries livianas con trials/configs como conteos", async () => {
  acceptMock();
  try {
    const run = await runBenchmark(makeDef(2, 2, 1));
    track(run.id);
    const list = listBenchmarkRuns(20);
    const found = list.find((s) => s.id === run.id);
    assert.ok(found, "el run creado aparece en la lista");
    assert.equal(found?.name, run.name);
    assert.equal(found?.status, "done");
    assert.equal(found?.trials, 4);
    assert.equal(found?.configs, 2);
    assert.equal(typeof found?.createdAt, "string");
    assert.equal(list.length <= 20, true);
    assert.equal(listBenchmarkRuns(0).length <= 20, true);
  } finally {
    setReviewPromptMock(null);
  }
});
