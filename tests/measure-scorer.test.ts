/**
 * Ola 11 — Measure: Scorers (juez LLM, labels, sampling, manual, re-score).
 * node:test + tsx. Sin red (juez vía mock inyectado), sin daemon (puras +
 * store en tmpdirs reales). No muta `factory/` ni jobs productivos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ScoreResultSchema,
  getScorerInvariantErrors,
  isPassingScore,
  scoreForLabel,
  validateScoreResult,
  validateScorerDefinition,
  type ScoreResult,
} from "../shared/types/scorer.ts";
import {
  SCORER_MAX_FILE_BYTES,
  listScorers,
  loadScorer,
  parseScorerFile,
  resetScorerCache,
} from "../headless-runtime/measure/scorerLoader.ts";
import {
  hashJobIdForSampling,
  isEligibleScoringInputs,
  isJobEligibleForScoring,
  shouldAutoScore,
  shouldSampleJob,
} from "../headless-runtime/measure/sampler.ts";
import {
  autoScoreCompletedJob,
  buildScorerPrompt,
  collectScorerInputs,
  getScoresSummary,
  hasMinimumScorerInputs,
  isRetryableScorerError,
  isUnscored,
  parseScorerLLMResponse,
  persistScoreResult,
  readScores,
  resolveScorerModel,
  scoreJob,
  scorerJsonSchemaFor,
  setScorerPromptMock,
} from "../headless-runtime/measure/scorerEngine.ts";
import {
  checkManualScoreGuards,
  isScorersListPath,
  isScoresSummaryPath,
  parseManualScorePath,
  parseScoresGetPath,
} from "../headless-runtime/measure/scorerHttp.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

const SCORER_MODEL = "opencode-go/muse-spark-1.2-contributor";
const REAL_SCORERS = [
  "review-formato-valido",
  "implement-scope-1-3",
  "verification-honesta",
] as const;

const VALID_DEF = {
  name: "test-scorer",
  description: "scorer de prueba",
  agents: ["implement"],
  labels: [
    { value: "bueno", score: 1 },
    { value: "malo", score: 0 },
  ],
  passingScore: 0.5,
  samplingRate: 25,
  model: SCORER_MODEL,
  selfImprovement: false,
};

// ── Fixtures en tmpdir real (nunca jobs productivos) ──

const trackedJobs: Array<{ id: string; dir: string }> = [];

function tmpWorktree(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeJob(id: string, prompt = "hacer algo util en el repo"): string {
  const worktree = tmpWorktree("scorer-test-");
  workItemStore.create({ id, prompt, worktree, phase: "diagnosisLlm" });
  const wi = workItemStore.get(id);
  trackedJobs.push({ id, dir: (wi?.dir as string) ?? worktree });
  return worktree;
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

function mockLabel(label: string, reason = `evidencia citada para ${label}`): void {
  setScorerPromptMock(async () => JSON.stringify({ label, reason }));
}

test.after(() => {
  try {
    setScorerPromptMock(null);
  } catch {}
  try {
    resetScorerCache();
  } catch {}
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

// ── A. Schemas: válido / inválido / invariante ──

test("schemas: definición válida pasa y conserva campos", () => {
  const def = validateScorerDefinition(VALID_DEF);
  assert.equal(def.name, "test-scorer");
  assert.equal(def.passingScore, 0.5);
  assert.equal(def.samplingRate, 25);
  assert.equal(def.selfImprovement, false);
  assert.deepEqual(
    def.labels.map((l) => l.value),
    ["bueno", "malo"],
  );
});

test("schemas: definición inválida lanza (campos)", () => {
  assert.throws(() => validateScorerDefinition({ ...VALID_DEF, labels: undefined }));
  assert.throws(() =>
    validateScorerDefinition({
      ...VALID_DEF,
      labels: [{ value: "x", score: 2 }],
    }),
  );
  assert.throws(() => validateScorerDefinition({ ...VALID_DEF, samplingRate: 101 }));
  assert.throws(() => validateScorerDefinition({ ...VALID_DEF, samplingRate: -1 }));
  assert.throws(() => validateScorerDefinition({ ...VALID_DEF, model: "sin-slash" }));
  assert.throws(() => validateScorerDefinition({ ...VALID_DEF, agents: [] }));
  assert.throws(() => validateScorerDefinition({ ...VALID_DEF, labels: [{ value: "solo", score: 1 }] }));
});

test("schemas: invariante exige ≥1 label ≥ passing y ≥1 debajo", () => {
  const allPassing = {
    ...VALID_DEF,
    labels: [
      { value: "a", score: 1 },
      { value: "b", score: 0.9 },
    ],
  };
  const allFailing = {
    ...VALID_DEF,
    labels: [
      { value: "a", score: 0 },
      { value: "b", score: 0.4 },
    ],
  };
  assert.throws(() => validateScorerDefinition(allPassing));
  assert.throws(() => validateScorerDefinition(allFailing));
  assert.equal(getScorerInvariantErrors(allPassing as never).length, 1);
  assert.equal(getScorerInvariantErrors(allFailing as never).length, 1);
  assert.deepEqual(getScorerInvariantErrors(VALID_DEF as never), []);
  // Borde: score == passingScore cuenta como passing.
  const border = {
    ...VALID_DEF,
    labels: [
      { value: "a", score: 0.5 },
      { value: "b", score: 0.49 },
    ],
  };
  assert.deepEqual(getScorerInvariantErrors(border as never), []);
  assert.doesNotThrow(() => validateScorerDefinition(border));
});

test("schemas: labels duplicados lanzan", () => {
  assert.throws(() =>
    validateScorerDefinition({
      ...VALID_DEF,
      labels: [
        { value: "x", score: 1 },
        { value: "x", score: 0 },
      ],
    }),
  );
});

test("schemas: ScoreResult válido/inválido + mapping label→score→passing", () => {
  const good: ScoreResult = {
    scorer: "implement-scope-1-3",
    workItemId: "job-scorertest-a",
    label: "en-scope",
    score: 1,
    passing: true,
    reason: "3 archivos pertinentes",
    model: SCORER_MODEL,
    origin: "manual",
    at: new Date().toISOString(),
  };
  assert.deepEqual(validateScoreResult(good), good);
  assert.deepEqual(ScoreResultSchema.safeParse({ ...good, origin: "auto" }).success, false);
  assert.deepEqual(
    ScoreResultSchema.safeParse({ ...good, workItemId: "invalido" }).success,
    false,
  );
  const def = validateScorerDefinition(VALID_DEF);
  assert.equal(scoreForLabel(def, "bueno"), 1);
  assert.equal(scoreForLabel(def, "malo"), 0);
  assert.equal(scoreForLabel(def, "inexistente"), null);
  assert.equal(isPassingScore(def, 1), true);
  assert.equal(isPassingScore(def, 0.5), true);
  assert.equal(isPassingScore(def, 0.49), false);
});

// ── B. Loader: válido / faltante / corrupto / traversal ──

test("loader: carga los 3 scorers reales con contrato exacto", () => {
  // Ola 18 P1.4/P1.5: agents etiquetados por rol + selfImprovement true SOLO
  // en review-formato-valido (el más barato de evaluar; los otros quedan
  // false para no quemar cuota). Thresholds 0.5 intactos.
  const EXPECTED_AGENTS: Record<string, string[]> = {
    "review-formato-valido": ["review"],
    "implement-scope-1-3": ["implement"],
    "verification-honesta": ["verification"],
  };
  const EXPECTED_SELF_IMPROVEMENT: Record<string, boolean> = {
    "review-formato-valido": true,
    "implement-scope-1-3": false,
    "verification-honesta": false,
  };
  for (const name of REAL_SCORERS) {
    const loaded = loadScorer(name);
    assert.ok(loaded, `${name} debe cargar`);
    assert.equal(loaded.name, name);
    assert.equal(loaded.definition.passingScore, 0.5);
    assert.equal(loaded.definition.samplingRate, 25);
    assert.equal(loaded.definition.selfImprovement, EXPECTED_SELF_IMPROVEMENT[name]);
    assert.equal(loaded.definition.model, SCORER_MODEL);
    assert.ok(loaded.definition.description.length > 0);
    assert.deepEqual(loaded.definition.agents, EXPECTED_AGENTS[name]);
    assert.equal(loaded.definition.labels.length, 2);
    assert.deepEqual(
      loaded.definition.labels.map((l) => l.score).sort(),
      [0, 1],
    );
    assert.ok(loaded.instructions.length > 50, "body = judge instructions");
    assert.equal(loaded.truncated, false);
  }
  const valido = loadScorer("review-formato-valido")?.definition;
  assert.deepEqual(
    (valido?.labels ?? []).map((l) => l.value).sort(),
    ["infra-formato", "valido"],
  );
  const scope = loadScorer("implement-scope-1-3")?.definition;
  assert.deepEqual(
    (scope?.labels ?? []).map((l) => l.value).sort(),
    ["en-scope", "fuera-de-scope"],
  );
  const honesta = loadScorer("verification-honesta")?.definition;
  assert.deepEqual(
    (honesta?.labels ?? []).map((l) => l.value).sort(),
    ["dudosa", "honesta"],
  );
});

test("loader: faltante → null sin lanzar", () => {
  assert.equal(loadScorer("no-existe-xyz"), null);
});

test("loader: corrupto → parseScorerFile lanza", () => {
  assert.throws(() => parseScorerFile(""));
  assert.throws(() => parseScorerFile("basura sin frontmatter"));
  assert.throws(() =>
    parseScorerFile("---\nname: x\n---\nbody sin labels ni nada"),
  );
  assert.throws(() =>
    parseScorerFile(
      "---\nname: x\ndescription: d\nagents: {implement}\nlabels: {a:1, b:1}\npassingScore: 0.5\nsamplingRate: 25\nmodel: p/m\nselfImprovement: false\n---\nbody",
      "x",
    ),
  );
  assert.throws(() =>
    parseScorerFile(
      "---\nname: otro\ndescription: d\nagents: {implement}\nlabels: {a:1, b:0}\npassingScore: 0.5\nsamplingRate: 25\nmodel: p/m\nselfImprovement: false\n---\nbody",
      "x",
    ),
  );
  assert.throws(() =>
    parseScorerFile(
      "---\nname: x\ndescription: d\nagents: {implement}\nlabels: {a:1, b:0}\npassingScore: 0.5\nsamplingRate: 25\nmodel: sinslash\nselfImprovement: false\n---\nbody",
      "x",
    ),
  );
});

test("loader: traversal ../x → null sin lanzar", () => {
  for (const bad of ["../x", "..", "a/b", "", "  ", "a b", "%2e%2e/x", "x/../../y"]) {
    assert.equal(loadScorer(bad), null, `"${bad}" debe ser null`);
  }
});

test("loader: listScorers incluye los 3 ordenados + cap documentado", () => {
  const names = listScorers().map((s) => s.name);
  for (const expected of REAL_SCORERS) {
    assert.ok(names.includes(expected), `falta ${expected}`);
  }
  assert.deepEqual([...names].sort(), names);
  assert.ok(SCORER_MAX_FILE_BYTES >= 1024);
});

// ── C. Sampler determinístico ──

test("sampler: mismo id misma decisión (estable y testeable)", () => {
  for (const id of ["job-scorertest-a", "job-scorertest-b", "job-abc123"]) {
    assert.equal(hashJobIdForSampling(id), hashJobIdForSampling(id));
    for (const rate of [0, 1, 25, 99, 100]) {
      assert.equal(shouldSampleJob(id, rate), shouldSampleJob(id, rate));
    }
    const h = hashJobIdForSampling(id);
    assert.ok(h >= 0 && h < 100, "bucket 0..99");
  }
});

test("sampler: rate 0 nunca auto, rate 100 siempre", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `job-scorertest-rate-${i}`);
  for (const id of ids) {
    assert.equal(shouldSampleJob(id, 0), false);
    assert.equal(shouldSampleJob(id, 100), true);
  }
  assert.equal(shouldSampleJob("job-x", Number.NaN), false);
  assert.equal(shouldSampleJob("job-x", 2.5), false);
  assert.equal(shouldSampleJob("", 100), false);
});

test("sampler: elegibilidad pura = result.json o verification", () => {
  assert.equal(isEligibleScoringInputs({ hasResultJson: false, hasVerification: false }), false);
  assert.equal(isEligibleScoringInputs({ hasResultJson: true, hasVerification: false }), true);
  assert.equal(isEligibleScoringInputs({ hasResultJson: false, hasVerification: true }), true);
  assert.equal(isEligibleScoringInputs(null), false);
});

test("sampler: elegibilidad real por timeline y disco", () => {
  const id = "job-scorertest-elig";
  makeJob(id);
  assert.equal(isJobEligibleForScoring(id), false);
  assert.equal(shouldAutoScore(id, 100), false);
  addVerification(id);
  assert.equal(isJobEligibleForScoring(id), true);
  assert.equal(shouldAutoScore(id, 100), true);
  assert.equal(shouldAutoScore(id, 0), false);
  assert.equal(isJobEligibleForScoring("job-scorertest-noexiste"), false);
});

// ── D. Judge vía mock (NO red): mapping + unscored + guards ──

test("judge: mapping label→score→passing vía mock inyectado", async () => {
  const id = "job-scorertest-judge";
  makeJob(id);
  addVerification(id, ["src/cambio.ts"]);
  mockLabel("en-scope", "3 archivos pertinentes al pedido");
  const first = await scoreJob(id, "implement-scope-1-3", { manual: true });
  assert.equal(isUnscored(first), false);
  if (!isUnscored(first)) {
    assert.equal(first.scorer, "implement-scope-1-3");
    assert.equal(first.workItemId, id);
    assert.equal(first.label, "en-scope");
    assert.equal(first.score, 1);
    assert.equal(first.passing, true);
    assert.equal(first.origin, "manual");
    assert.ok(first.model.includes("/"));
    assert.ok(first.reason.length > 0);
  }
  mockLabel("fuera-de-scope", "toco 5 archivos con extras");
  const second = await scoreJob(id, "implement-scope-1-3", { manual: true });
  assert.equal(isUnscored(second), false);
  if (!isUnscored(second)) {
    assert.equal(second.label, "fuera-de-scope");
    assert.equal(second.score, 0);
    assert.equal(second.passing, false);
  }
  setScorerPromptMock(null);
});

test("judge: fallo LLM/parse/cuota → unscored, nunca inventa score", async () => {
  const id = "job-scorertest-fail";
  makeJob(id);
  addVerification(id);
  setScorerPromptMock(async () => "esto no es json");
  assert.equal(isUnscored(await scoreJob(id, "implement-scope-1-3", { manual: true })), true);
  setScorerPromptMock(async () => null);
  assert.equal(isUnscored(await scoreJob(id, "implement-scope-1-3", { manual: true })), true);
  setScorerPromptMock(async () => JSON.stringify({ label: "etiqueta-fantasma", reason: "x" }));
  const ghost = await scoreJob(id, "implement-scope-1-3", { manual: true });
  assert.equal(isUnscored(ghost), true);
  setScorerPromptMock(async () => {
    throw new Error("quota exceeded 429");
  });
  assert.equal(isUnscored(await scoreJob(id, "implement-scope-1-3", { manual: true })), true);
  setScorerPromptMock(null);
  const missing = await scoreJob("job-scorertest-noexiste", "implement-scope-1-3", {
    manual: true,
  });
  assert.equal(isUnscored(missing), true);
  const badScorer = await scoreJob(id, "scorer-fantasma", { manual: true });
  assert.equal(isUnscored(badScorer), true);
  // Blindaje QA Ola 11: ningún fallo persistió nada.
  assert.deepEqual(readScores(id), {});
});

test("judge: sin inputs mínimos no llama al LLM", async () => {
  const id = "job-scorertest-min";
  makeJob(id);
  const inputs = collectScorerInputs(id);
  assert.ok(inputs);
  assert.equal(hasMinimumScorerInputs(inputs), false);
  let calls = 0;
  setScorerPromptMock(async () => {
    calls++;
    return JSON.stringify({ label: "en-scope", reason: "no debería llamarse" });
  });
  const out = await scoreJob(id, "implement-scope-1-3", { manual: true });
  assert.equal(isUnscored(out), true);
  if (isUnscored(out)) assert.match(out.reason, /mínimos/);
  assert.equal(calls, 0);
  setScorerPromptMock(null);
});

test("manual bypasea sampling (rate 25 real)", async () => {
  let skipId = "";
  for (let i = 0; i < 500; i++) {
    const cand = `job-scorertest-skip-${i}`;
    if (!shouldSampleJob(cand, 25)) {
      skipId = cand;
      break;
    }
  }
  assert.ok(skipId, "debe existir un id fuera de la muestra 25%");
  makeJob(skipId);
  addVerification(skipId);
  let calls = 0;
  setScorerPromptMock(async () => {
    calls++;
    return JSON.stringify({ label: "honesta", reason: "suite real corrida" });
  });
  const auto = await scoreJob(skipId, "verification-honesta");
  assert.equal(isUnscored(auto), true);
  if (isUnscored(auto)) assert.equal(auto.skippedBySampling, true);
  assert.equal(calls, 0);
  const manual = await scoreJob(skipId, "verification-honesta", { manual: true });
  assert.equal(isUnscored(manual), false);
  assert.equal(calls, 1);
  if (!isUnscored(manual)) assert.equal(manual.origin, "manual");
  setScorerPromptMock(null);
});

test("re-score reemplaza (no acumula)", async () => {
  const id = "job-scorertest-rescore";
  makeJob(id);
  addVerification(id);
  // Ola 18 P1.5: review-formato-valido exige etapa review (gate de
  // aplicabilidad); sin veredicto el scoring sería not-applicable.
  workItemStore.appendEvent(id, "system", "review accept (semilla de test)", {
    review: { verdict: "accept", summary: "cambio pertinente con evidencia" },
  } as unknown as Record<string, unknown>);
  mockLabel("valido", "primera pasada");
  await scoreJob(id, "review-formato-valido", { manual: true });
  mockLabel("infra-formato", "segunda pasada corrige");
  await scoreJob(id, "review-formato-valido", { manual: true });
  setScorerPromptMock(null);
  const scores = readScores(id);
  assert.deepEqual(Object.keys(scores), ["review-formato-valido"]);
  assert.equal(scores["review-formato-valido"]?.label, "infra-formato");
  assert.equal(scores["review-formato-valido"]?.score, 0);
  const wi = workItemStore.get(id);
  const scoreEvents = (wi?.timeline ?? []).filter((e) => {
    const meta = e.meta as Record<string, unknown> | undefined;
    return !!meta && typeof meta === "object" && "scores" in meta;
  });
  assert.ok(scoreEvents.length >= 2, "cada scoring deja su evento");
});

test("engine: prompt/schema/parse tolerante + modelo con fallback", () => {
  const loaded = loadScorer("implement-scope-1-3");
  assert.ok(loaded);
  const inputs = {
    workItemId: "job-scorertest-p",
    promptSlice: "hacer x",
    createdFiles: ["a.ts"],
    verification: null,
    verificationSummary: "(sin verificación)",
    reviewVerdict: null,
    reviewSummary: null,
    hasResultJson: false,
    hasVerification: false,
    hasCreatedFiles: true,
  };
  const prompt = buildScorerPrompt(loaded.definition, loaded.instructions, inputs);
  assert.match(prompt, /job-scorertest-p/);
  assert.match(prompt, /en-scope/);
  const schema = scorerJsonSchemaFor(loaded.definition);
  assert.deepEqual(schema.required, ["label", "reason"]);
  assert.deepEqual(schema.properties.label.enum, ["en-scope", "fuera-de-scope"]);
  assert.deepEqual(parseScorerLLMResponse('{"label":"en-scope","reason":"ok"}', loaded.definition), {
    label: "en-scope",
    reason: "ok",
  });
  assert.deepEqual(
    parseScorerLLMResponse('```json\n{"label":"fuera-de-scope","reason":"mal"}\n```', loaded.definition).label,
    "fuera-de-scope",
  );
  assert.deepEqual(
    parseScorerLLMResponse('texto previo {"label":"en-scope","reason":"con ruido"} texto', loaded.definition).label,
    "en-scope",
  );
  assert.throws(() => parseScorerLLMResponse("nada", loaded.definition));
  assert.throws(() =>
    parseScorerLLMResponse('{"label":"otra","reason":"x"}', loaded.definition),
  );
  const direct = resolveScorerModel(SCORER_MODEL);
  assert.ok(direct);
  assert.equal(direct?.fromDefault, false);
  assert.equal(direct?.modelStr, SCORER_MODEL);
  const fb = resolveScorerModel("invalido-sin-slash");
  assert.ok(fb);
  assert.equal(fb?.fromDefault, true);
  assert.equal(isRetryableScorerError("timeout 20000ms scorer session.prompt"), false);
  assert.equal(isRetryableScorerError("{}"), true);
  assert.equal(isRetryableScorerError("scorer label inválido"), false);
});

// ── E. Guards de endpoints como puras extraídas ──

test("endpoints: parse GET .../scores (+alias) y rechazos", () => {
  assert.deepEqual(parseScoresGetPath("/factory/jobs/job-a/scores"), {
    id: "job-a",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseScoresGetPath("/work-items/job-a/scores"), {
    id: "job-a",
    isWorkItemsAlias: true,
  });
  assert.ok("error" in parseScoresGetPath("/factory/jobs/job-a/scores/extra"));
  assert.ok("error" in parseScoresGetPath("/factory/jobs/../x/scores"));
  assert.ok("error" in parseScoresGetPath("/factory/jobs/job-a/scores/valido"));
  assert.ok("error" in parseScoresGetPath("/other/job-a/scores"));
  assert.ok("error" in parseScoresGetPath(123));
});

test("endpoints: parse POST .../scores/:name (+alias) y rechazos", () => {
  assert.deepEqual(parseManualScorePath("/factory/jobs/job-a/scores/review-formato-valido"), {
    id: "job-a",
    scorer: "review-formato-valido",
    isWorkItemsAlias: false,
  });
  assert.deepEqual(parseManualScorePath("/work-items/job-a/scores/review-formato-valido"), {
    id: "job-a",
    scorer: "review-formato-valido",
    isWorkItemsAlias: true,
  });
  assert.ok("error" in parseManualScorePath("/factory/jobs/job-a/scores"));
  assert.ok("error" in parseManualScorePath("/factory/jobs/../x/scores/y"));
  assert.ok("error" in parseManualScorePath("/factory/jobs/job-a/scores/../x"));
  assert.ok("error" in parseManualScorePath("/factory/jobs/job-a/scores/a/b"));
});

test("endpoints: guards manual 404/409/ok + rutas globales", () => {
  assert.deepEqual(checkManualScoreGuards(false, true, true, "job-a", "s").ok, false);
  const g404job = checkManualScoreGuards(false, true, true, "job-a", "s");
  assert.equal(g404job.ok, false);
  if (!g404job.ok) assert.equal(g404job.code, 404);
  const g404scorer = checkManualScoreGuards(true, false, true, "job-a", "fantasma");
  assert.equal(g404scorer.ok, false);
  if (!g404scorer.ok) assert.equal(g404scorer.code, 404);
  const g409 = checkManualScoreGuards(true, true, false, "job-a", "s");
  assert.equal(g409.ok, false);
  if (!g409.ok) assert.equal(g409.code, 409);
  assert.deepEqual(checkManualScoreGuards(true, true, true).ok, true);
  assert.equal(isScorersListPath("/factory/scorers", "GET"), true);
  assert.equal(isScorersListPath("/work-items/scorers", "GET"), false);
  assert.equal(isScorersListPath("/factory/scorers", "POST"), false);
  assert.equal(isScoresSummaryPath("/factory/scores/summary", "GET"), true);
  assert.equal(isScoresSummaryPath("/factory/scores/summary", "POST"), false);
});

// ── F. Persistencia round-trip en tmpdir real ──

test("persistencia: round-trip scores.json + timeline en tmpdir real", () => {
  const id = "job-scorertest-persist";
  const worktree = makeJob(id);
  addVerification(id);
  const result: ScoreResult = {
    scorer: "implement-scope-1-3",
    workItemId: id,
    label: "en-scope",
    score: 1,
    passing: true,
    reason: "evidencia real",
    model: SCORER_MODEL,
    origin: "sampled",
    at: new Date().toISOString(),
  };
  assert.equal(persistScoreResult(result), true);
  assert.deepEqual(readScores(id)["implement-scope-1-3"], result);
  const wi = workItemStore.get(id);
  const dir = wi?.dir as string;
  const fileRaw = JSON.parse(fs.readFileSync(path.join(dir, "scores.json"), "utf-8")) as Record<
    string,
    ScoreResult
  >;
  assert.deepEqual(fileRaw["implement-scope-1-3"], result);
  const leftovers = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("scores.json.tmp-"));
  assert.deepEqual(leftovers, []);
  assert.ok(
    (wi?.timeline ?? []).some((e) => {
      const meta = e.meta as Record<string, unknown> | undefined;
      return !!meta && typeof meta === "object" && "scores" in meta;
    }),
  );
  void worktree;
  assert.equal(
    persistScoreResult({ ...result, workItemId: "job-scorertest-noexiste" }),
    false,
  );
  assert.deepEqual(readScores("job-scorertest-noexiste"), {});
});

test("summary: agregado best-effort acotado, nunca lanza", () => {
  const summary = getScoresSummary();
  assert.ok(summary && typeof summary === "object" && "scorers" in summary);
  const entry = summary.scorers["implement-scope-1-3"];
  assert.ok(entry, "el scorer calificado en estos tests aparece");
  assert.ok(entry.scored >= 1);
  assert.equal(entry.passing + entry.failing, entry.scored);
  assert.ok(entry.passRate >= 0 && entry.passRate <= 1);
  assert.ok(getScoresSummary(5).scorers !== undefined);
  assert.deepEqual(getScoresSummary(-1).scorers !== undefined, true);
});

test("autoScoreCompletedJob: job en muestra se scorea (origin sampled), fuera no", async () => {
  let inId = "";
  for (let i = 0; i < 500; i++) {
    const cand = `job-scorertest-auto-${i}`;
    if (shouldSampleJob(cand, 25)) {
      inId = cand;
      break;
    }
  }
  assert.ok(inId, "debe existir un id dentro de la muestra 25%");
  let outId = "";
  for (let i = 0; i < 500; i++) {
    const cand = `job-scorertest-fuera-${i}`;
    if (!shouldSampleJob(cand, 25)) {
      outId = cand;
      break;
    }
  }
  assert.ok(outId, "debe existir un id fuera de la muestra 25%");
  makeJob(inId);
  addVerification(inId);
  makeJob(outId);
  addVerification(outId);
  let calls = 0;
  setScorerPromptMock(async () => {
    calls++;
    return JSON.stringify({ label: "honesta", reason: "suite real corrida" });
  });
  await autoScoreCompletedJob(inId);
  await autoScoreCompletedJob(outId);
  setScorerPromptMock(null);
  // "honesta" solo es label válido de verification-honesta → solo ese persiste.
  const scoresIn = readScores(inId);
  assert.deepEqual(Object.keys(scoresIn), ["verification-honesta"]);
  assert.equal(scoresIn["verification-honesta"]?.origin, "sampled");
  assert.equal(calls >= 1, true);
  const callsAfterIn = calls;
  assert.deepEqual(readScores(outId), {});
  assert.equal(calls, callsAfterIn, "fuera de muestra: el juez no debe llamarse");
});

test("autoScoreCompletedJob nunca lanza (job inexistente, id vacío)", async () => {
  await autoScoreCompletedJob("job-scorertest-noexiste");
  await autoScoreCompletedJob("");
  await autoScoreCompletedJob(null as unknown as string);
});
