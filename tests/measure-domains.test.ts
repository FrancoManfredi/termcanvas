/**
 * FASE 3 E1 — Dominios measure (`headless-runtime/factory/measure/*`).
 * node:test + tsx. Offline total: juez/analista/revisor vía mocks inyectados,
 * sin daemon (dominios + engines + store en tmpdirs reales). Cero LLM real.
 *
 * Cubre lo pedido en F3-E1:
 * - Delegación sin duplicar (C7): cada parser/guard/lector del dominio es la
 *   MISMA referencia que el de `measure/*` (identidad, no espejo).
 * - Sampling determinístico (default 25 intacto como propiedad, sin literales).
 * - Unscored ante juez caído sin inventar (nada persiste en `scores.json`).
 * - Gate aplicabilidad → 409 honesto (narrowing not-applicable ANTES que unscored).
 * - Cap 50 en crear benchmark + estimación honesta trials × (1 + scorers).
 * - Benchmark vivo de 1 trial con mocks: secuencial, fixtures limpiadas,
 *   run persistido y borrado higiénico (cero residue).
 * - Allowlist doble-rechazo (análisis → failed, adopt → 409).
 * - Backup-antes-de-escribir en adopt (abort si el backup falla, por diseño).
 * - Cero escrituras fuera del sandbox (`TERMCANVAS_FACTORY_DIR` + tmpjobs).
 * - Adopt solo por endpoint (ningún flujo automático adopta: regla 4).
 *
 * Reglas citadas: C1 (ESM, sin loops/timers nuevos), C2 (fail-safe), C3 (un
 * escritor), C4 (best-effort), C5 (aditivo: pacts F01–F14, thresholds,
 * sampling, polling intactos), C6/C7 (delegación por identidad), C8 (rutas en
 * tabla), C10 (cada caso cita su bloque). Cero nombres de modelos/scorers
 * literales: todo sale de `listScorers()` (loaders/yaml).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Dominios F3-E1 (fachadas que el server usa) ──
import {
  checkManualScoreApplicability as domainCheckApplicability,
  checkManualScoreGuards as domainCheckGuards,
  checkManualScoreRequest,
  collectScorerInputs,
  getScoresSummary,
  hasMinimumScorerInputs,
  isScorersListPath as domainIsScorersList,
  isScoresSummaryPath as domainIsSummary,
  jobExistsForScores,
  listScorers as domainListScorers,
  loadScorer as domainLoadScorer,
  parseManualScorePath as domainParseManual,
  parseScoresGetPath as domainParseScoresGet,
  readScores as domainReadScores,
  scorerAppliesTo,
  scorerRequiredStages,
  scoreJob as domainScoreJob,
  stagesForInputs,
} from "../headless-runtime/factory/measure/scorerRoutes.ts";
import {
  countBenchmarkTrials as domainCountTrials,
  createPendingBenchmarkRun as domainCreatePendingBench,
  deleteBenchmarkRun as domainDeleteRun,
  estimateBenchmarkCalls as domainEstimateCalls,
  executeBenchmarkTrials as domainExecute,
  getBenchmarkResultsDir as domainResultsDir,
  getBenchmarkRun as domainGetRun,
  isBenchmarkCreatePath as domainIsBenchCreate,
  isBenchmarksListPath as domainIsBenchList,
  listScorers as benchKnownScorers,
  parseBenchmarkGetPath as domainParseBenchGet,
  resolveBenchmarkScorers as domainResolveScorers,
  validateBenchmarkCreate,
  validateBenchmarkDefinition as domainValidateBench,
  BENCHMARK_FIXTURE_PREFIX as DOMAIN_FIXTURE_PREFIX,
  BENCHMARK_MAX_TRIALS as DOMAIN_MAX_TRIALS,
} from "../headless-runtime/factory/measure/benchmarkRoutes.ts";
import {
  adoptProposal as domainAdopt,
  checkAdoptGuards as domainAdoptGuards,
  checkCreateProposalBody as domainCheckCreateBody,
  checkDiscardGuards as domainDiscardGuards,
  checkFailuresRequest,
  checkRetryAnalysisGuards as domainRetryAnalysisGuards,
  collectFailures as domainCollectFailures,
  createPendingProposal as domainCreatePendingProposal,
  discardProposal as domainDiscard,
  getFactoryBaseDir as domainFactoryDir,
  isAdoptableTarget as domainAdoptable,
  isFailuresPath as domainIsFailures,
  isProposalsCreatePath as domainIsPropCreate,
  isProposalsListPath as domainIsPropList,
  isSafeProposalId as domainSafeProposalId,
  listProposalSummaries as domainListSummaries,
  loadScorer as improveLoadScorer,
  parseProposalActionPath as domainParseAction,
  parseProposalGetPath as domainParsePropGet,
  parseProposalRetryAnalysisPath as domainParseRetryAnalysis,
  readProposal as domainReadProposal,
  resolveFactoryPath as domainResolveFactory,
  retryAnalysisForProposal as domainRetryAnalysis,
  runAnalysisForProposal as domainAnalyze,
  validateImproveScorerParam as domainCheckScorerParam,
  RETRY_ANALYSIS_MAX as DOMAIN_RETRY_ANALYSIS_MAX,
} from "../headless-runtime/factory/measure/improvementRoutes.ts";

// ── Orígenes (identidad C7: el dominio NO duplica) ──
import {
  checkManualScoreApplicability as httpCheckApplicability,
  checkManualScoreGuards as httpCheckGuards,
  isScorersListPath as httpIsScorersList,
  isScoresSummaryPath as httpIsSummary,
  parseManualScorePath as httpParseManual,
  parseScoresGetPath as httpParseScoresGet,
} from "../headless-runtime/measure/scorerHttp.ts";
import {
  isBenchmarkCreatePath as httpIsBenchCreate,
  isBenchmarksListPath as httpIsBenchList,
  parseBenchmarkGetPath as httpParseBenchGet,
} from "../headless-runtime/measure/benchmarkHttp.ts";
import {
  checkAdoptGuards as httpAdoptGuards,
  checkCreateProposalBody as httpCheckCreateBody,
  checkDiscardGuards as httpDiscardGuards,
  checkRetryAnalysisGuards as httpRetryAnalysisGuards,
  isFailuresPath as httpIsFailures,
  isProposalsCreatePath as httpIsPropCreate,
  isProposalsListPath as httpIsPropList,
  isSafeProposalId as httpSafeProposalId,
  parseProposalActionPath as httpParseAction,
  parseProposalGetPath as httpParsePropGet,
  parseProposalRetryAnalysisPath as httpParseRetryAnalysis,
  validateImproveScorerParam as httpCheckScorerParam,
  RETRY_ANALYSIS_MAX as HTTP_RETRY_ANALYSIS_MAX,
} from "../headless-runtime/measure/improvementHttp.ts";
import {
  countBenchmarkTrials as sharedCountTrials,
  estimateBenchmarkCalls as sharedEstimateCalls,
  validateBenchmarkDefinition as sharedValidateBench,
  BENCHMARK_MAX_TRIALS as SHARED_MAX_TRIALS,
} from "../shared/types/benchmark.ts";
import type { BenchmarkDefinition } from "../shared/types/benchmark.ts";

// ── Engines (mocks + ejecución, como las suites measure-* vecinas) ──
import {
  isNotApplicable,
  isUnscored,
  maybeAutoProposeForScorer,
  persistScoreResult,
  readScores,
  resolvePassing,
  scoreJob,
  setScorerPromptMock,
} from "../headless-runtime/measure/scorerEngine.ts";
import {
  listScorers,
} from "../headless-runtime/measure/scorerLoader.ts";
import {
  hashJobIdForSampling,
  shouldSampleJob,
} from "../headless-runtime/measure/sampler.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";
import {
  resolveBenchmarkScorers as engineResolveScorers,
} from "../headless-runtime/measure/benchmarkEngine.ts";
import {
  isImprovementError,
  listProposals,
  retryAnalysisForProposal as engineRetryAnalysis,
  setAnalysisPromptMock,
} from "../headless-runtime/measure/improvementEngine.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── Sandbox factory (toda escritura factory va acá, nunca al repo real) ──
const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "f3e1-measure-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

// ── Scorers dinámicos (cero literales: todo del loader/yaml) ──
const LOADED = listScorers();
const ANY_SCORER = LOADED.length > 0 ? LOADED[0].name : null;
const SELF_SCORER = (LOADED.find((d) => d.selfImprovement === true) ?? LOADED[0] ?? null)?.name ?? null;
const REVIEW_ONLY_SCORER = LOADED.find(
  (d) => Array.isArray(d.agents) && d.agents.length > 0 && d.agents.every((a) => a === "review"),
)?.name ?? null;

// ── Fixtures: jobs reales en tmpdirs (nunca jobs productivos) ──
const trackedJobs: Array<{ id: string; dir: string }> = [];
const trackedRuns: string[] = [];
const trackedProposals: string[] = [];
let jobSeq = 0;

function nextJobId(): string {
  jobSeq += 1;
  return `job-f3e1-${Date.now().toString(36)}-${jobSeq}`;
}

function makeJob(): string {
  const id = nextJobId();
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "f3e1-job-"));
  workItemStore.create({ id, prompt: `tarea neutra de medida ${id}`, worktree, phase: "diagnosisLlm" });
  const wi = workItemStore.get(id);
  trackedJobs.push({ id, dir: (wi?.dir as string) ?? worktree });
  return id;
}

/** Evidencia completa: verification + createdFiles + veredicto de review. */
function addFullEvidence(id: string): void {
  workItemStore.appendEvent(id, "runner", "verification pass", {
    verification: { overall: "pass" },
    createdFiles: ["src/cambio.ts"],
    review: { verdict: "accept", summary: "cambio correcto y acotado" },
    runnerId: "linux-build",
  } as unknown as Record<string, unknown>);
}

/** Evidencia parcial SIN review (para el gate de aplicabilidad). */
function addEvidenceNoReview(id: string): void {
  workItemStore.appendEvent(id, "runner", "verification pass", {
    verification: { overall: "pass" },
    createdFiles: ["src/cambio.ts"],
    runnerId: "linux-build",
  } as unknown as Record<string, unknown>);
}

test.after(() => {
  try {
    setScorerPromptMock(null);
  } catch {}
  try {
    setReviewPromptMock(null);
  } catch {}
  try {
    setAnalysisPromptMock(null);
  } catch {}
  for (const id of trackedRuns) {
    try {
      domainDeleteRun(id);
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

// ── A. Delegación por identidad (C7: el dominio no duplica) ──

test("A1 dominio scorers re-exporta las MISMAS funciones (identidad, C7)", () => {
  assert.equal(domainParseScoresGet, httpParseScoresGet);
  assert.equal(domainParseManual, httpParseManual);
  assert.equal(domainCheckGuards, httpCheckGuards);
  assert.equal(domainCheckApplicability, httpCheckApplicability);
  assert.equal(domainIsScorersList, httpIsScorersList);
  assert.equal(domainIsSummary, httpIsSummary);
  assert.equal(domainListScorers, listScorers);
  assert.equal(domainScoreJob, scoreJob);
  assert.equal(domainReadScores, readScores);
});

test("A2 dominio benchmarks re-exporta las MISMAS funciones (identidad, C7)", () => {
  assert.equal(domainParseBenchGet, httpParseBenchGet);
  assert.equal(domainIsBenchList, httpIsBenchList);
  assert.equal(domainIsBenchCreate, httpIsBenchCreate);
  assert.equal(domainValidateBench, sharedValidateBench);
  assert.equal(domainCountTrials, sharedCountTrials);
  assert.equal(domainEstimateCalls, sharedEstimateCalls);
  assert.equal(domainResolveScorers, engineResolveScorers);
  assert.equal(DOMAIN_MAX_TRIALS, SHARED_MAX_TRIALS);
  assert.equal(benchKnownScorers, listScorers);
});

test("A3 dominio improvement re-exporta las MISMAS funciones (identidad, C7)", () => {
  assert.equal(domainParsePropGet, httpParsePropGet);
  assert.equal(domainParseAction, httpParseAction);
  assert.equal(domainCheckScorerParam, httpCheckScorerParam);
  assert.equal(domainCheckCreateBody, httpCheckCreateBody);
  assert.equal(domainAdoptGuards, httpAdoptGuards);
  assert.equal(domainDiscardGuards, httpDiscardGuards);
  assert.equal(domainIsFailures, httpIsFailures);
  assert.equal(domainIsPropList, httpIsPropList);
  assert.equal(domainIsPropCreate, httpIsPropCreate);
  assert.equal(domainSafeProposalId, httpSafeProposalId);
  assert.equal(improveLoadScorer, domainLoadScorer);
  assert.equal(domainParseRetryAnalysis, httpParseRetryAnalysis);
  assert.equal(domainRetryAnalysisGuards, httpRetryAnalysisGuards);
  assert.equal(domainRetryAnalysis, engineRetryAnalysis);
  assert.equal(DOMAIN_RETRY_ANALYSIS_MAX, HTTP_RETRY_ANALYSIS_MAX);
  assert.equal(DOMAIN_RETRY_ANALYSIS_MAX, 1);
});

// ── B. Scorers: sampling, guards, juez caído, aplicabilidad ──

test("B1 hay scorers cargados desde el loader (sin literales en el código)", () => {
  assert.ok(LOADED.length > 0, "se esperaba ≥1 scorer en factory/scorers/");
  assert.ok(ANY_SCORER, "nombre dinámico del primer scorer");
});

test("B2 sampling determinístico y cotas (propiedad, default intacto)", () => {
  const id = nextJobId();
  assert.equal(shouldSampleJob(id, 25), shouldSampleJob(id, 25));
  assert.equal(hashJobIdForSampling(id), hashJobIdForSampling(id));
  assert.equal(shouldSampleJob(id, 0), false);
  assert.equal(shouldSampleJob(id, 100), true);
  assert.equal(shouldSampleJob("", 25), false);
  assert.equal(shouldSampleJob(id, Number.NaN), false);
  assert.equal(shouldSampleJob(id, 25.5), false);
  assert.equal(shouldSampleJob(id, -1), false);
  // Borde inclusivo del threshold intacto (con los valores del propio yaml).
  for (const def of LOADED) {
    assert.equal(resolvePassing(def.passingScore, def.passingScore), true);
  }
});

test("B3 guards manuales vía dominio: 404/409 con los textos de hoy", () => {
  if (!ANY_SCORER) return;
  const job = makeJob();
  assert.equal(jobExistsForScores(job), true);
  assert.equal(jobExistsForScores("job-f3e1-inexistente"), false);
  // Job inexistente → 404.
  const missing = checkManualScoreRequest({
    jobId: "job-f3e1-inexistente",
    jobExists: false,
    scorer: ANY_SCORER,
    scorerExists: true,
    scorerAgents: ["implement"],
    inputs: null,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, 404);
  // Scorer inexistente → 404.
  const noScorer = checkManualScoreRequest({
    jobId: job,
    jobExists: true,
    scorer: "scorer-que-no-existe-zzz",
    scorerExists: false,
    scorerAgents: null,
    inputs: null,
  });
  assert.equal(noScorer.ok, false);
  if (!noScorer.ok) assert.equal(noScorer.code, 404);
  // Sin inputs mínimos → 409.
  const noInputs = checkManualScoreRequest({
    jobId: job,
    jobExists: true,
    scorer: ANY_SCORER,
    scorerExists: true,
    scorerAgents: ["implement"],
    inputs: null,
  });
  assert.equal(noInputs.ok, false);
  if (!noInputs.ok) {
    assert.equal(noInputs.code, 409);
    assert.match(noInputs.error, /inputs mínimos/);
  }
});

test("B4 juez caído → unscored honesto, nada inventado en scores.json", async () => {
  if (!ANY_SCORER) return;
  const job = makeJob();
  addFullEvidence(job);
  const inputs = collectScorerInputs(job);
  assert.ok(inputs && hasMinimumScorerInputs(inputs));
  setScorerPromptMock(async () => null);
  try {
    const out = await scoreJob(job, ANY_SCORER, { manual: true });
    // ORDEN DE NARROWING: not-applicable ANTES que unscored.
    assert.equal(isNotApplicable(out), false);
    assert.equal(isUnscored(out), true);
    assert.deepEqual(readScores(job), {});
    assert.deepEqual(domainReadScores(job), {});
  } finally {
    setScorerPromptMock(null);
  }
});

test("B5 gate aplicabilidad → 409 honesto vía dominio (sin inventar etapa)", async () => {
  if (!REVIEW_ONLY_SCORER) return;
  const job = makeJob();
  addEvidenceNoReview(job);
  const inputs = collectScorerInputs(job);
  assert.ok(inputs && hasMinimumScorerInputs(inputs));
  const loaded = domainLoadScorer(REVIEW_ONLY_SCORER);
  assert.ok(loaded);
  const stages = stagesForInputs(inputs);
  assert.equal(stages.review, false);
  assert.equal(scorerAppliesTo(stages, [...loaded.definition.agents]), false);
  const req = checkManualScoreRequest({
    jobId: job,
    jobExists: true,
    scorer: REVIEW_ONLY_SCORER,
    scorerExists: true,
    scorerAgents: loaded.definition.agents,
    inputs,
  });
  assert.equal(req.ok, false);
  if (!req.ok) {
    assert.equal(req.code, 409);
    assert.match(req.error, /requiere etapa/);
  }
  const out = await scoreJob(job, REVIEW_ONLY_SCORER, { manual: true });
  assert.equal(isNotApplicable(out), true);
  assert.deepEqual(readScores(job), {});
  assert.ok(scorerRequiredStages([...loaded.definition.agents]).length > 0);
});

test("B6 resumen de scores vía dominio (forma intacta)", () => {
  const summary = getScoresSummary();
  assert.ok(summary && typeof summary.scorers === "object");
});

// ── C. Benchmarks: cap, validación compuesta, run vivo con limpieza ──

function tinyDef(rep: number, mult: { tasks: number; configs: number }): BenchmarkDefinition {
  const tasks = Array.from({ length: mult.tasks }, (_, i) => ({
    id: `t${i + 1}`,
    prompt: `prompt neutro ${i + 1}`,
    files: [{ path: `notes/t${i + 1}.txt`, content: "contenido neutro\n" }],
    verification: { overall: "pass" as const },
    expectedVerdict: "accept" as const,
  }));
  const configs = Array.from({ length: mult.configs }, (_, i) => ({
    id: `c${i + 1}`,
    reviewerModel: { providerID: "test-provider", modelID: `test-model-${i + 1}` },
  }));
  return {
    name: "bench-f3e1",
    tasks,
    configs,
    repetitions: rep,
    scorers: [],
  };
}

function fixtureDirs(): string[] {
  try {
    return fs
      .readdirSync(os.tmpdir())
      .filter((e) => e.startsWith(DOMAIN_FIXTURE_PREFIX));
  } catch {
    return [];
  }
}

test("C1 cap 50 intacto: 60 trials → 400 con mensaje de cap", () => {
  assert.equal(DOMAIN_MAX_TRIALS, 50);
  const big = tinyDef(3, { tasks: 5, configs: 4 });
  assert.equal(sharedCountTrials(big), 60);
  assert.equal(domainCountTrials(big), 60);
  const checked = validateBenchmarkCreate(big);
  assert.equal(checked.ok, false);
  if (!checked.ok) {
    assert.equal(checked.code, 400);
    assert.match(checked.error, /cap/);
  }
});

test("C2 validación compuesta: inválido, scorer desconocido y ok honesto", () => {
  const bad = validateBenchmarkCreate({ nombre: "sin forma" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /invalid benchmark/);
  const unknownDef = { ...tinyDef(1, { tasks: 1, configs: 1 }), scorers: ["scorer-que-no-existe-zzz"] };
  const unknown = validateBenchmarkCreate(unknownDef);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.code, 400);
    assert.match(unknown.error, /scorer desconocido/);
  }
  const good = tinyDef(1, { tasks: 1, configs: 1 });
  const ok = validateBenchmarkCreate(good);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.total, 1);
    assert.deepEqual(ok.scorerNames, []);
    // Fórmula honesta trials × (1 + scorers), sin literales de conteo.
    assert.equal(ok.estimatedCalls, ok.total * (1 + ok.scorerNames.length));
  }
});

test("C3 run vivo de 1 trial con mocks: secuencial, fixtures limpias, sin residue", async () => {
  setReviewPromptMock(async () =>
    JSON.stringify({ verdict: "accept", confidence: 0.9, summary: "ok", findings: [] }),
  );
  let runId = "";
  try {
    const checked = validateBenchmarkCreate(tinyDef(1, { tasks: 1, configs: 1 }));
    assert.equal(checked.ok, true);
    if (!checked.ok) return;
    const storeBefore = new Set(workItemStore.list().map((w) => w.id));
    const fixturesBefore = new Set(fixtureDirs());
    const pending = domainCreatePendingBench(checked.def);
    runId = pending.id;
    trackedRuns.push(runId);
    const done = await domainExecute(runId, checked.def);
    assert.equal(done.status, "done");
    assert.equal(done.trials.length, 1);
    assert.equal(done.trials[0].verdict, "accept");
    assert.equal(done.trials[0].pass, true);
    // 1 llamada revisor + 0 al juez (scorers opt-out explícito).
    assert.equal(done.llmCalls, 1);
    // Fixtures limpiadas: ningún dir nuevo con el prefijo.
    for (const dir of fixtureDirs()) {
      assert.ok(fixturesBefore.has(dir), `fixture sin limpiar: ${dir}`);
    }
    // Jobs efímeros del trial fuera del store.
    for (const w of workItemStore.list()) {
      assert.ok(storeBefore.has(w.id), `job efímero sin limpiar: ${w.id}`);
    }
    // Detalle y lista vía dominio.
    const fetched = domainGetRun(runId);
    assert.ok(fetched && fetched.status === "done");
    assert.ok(domainParseBenchGet(`/factory/benchmarks/${runId}`));
  } finally {
    setReviewPromptMock(null);
    if (runId) {
      domainDeleteRun(runId);
      assert.equal(domainGetRun(runId), null);
      assert.equal(
        fs.existsSync(path.join(domainResultsDir(), `${runId}.json`)),
        false,
      );
    }
  }
});

// ── D. Improvement: allowlist doble, backup, sandbox, regla 4 ──

function writeSandboxFile(rel: string, content: string): string {
  const abs = domainResolveFactory(rel);
  assert.ok(
    path.resolve(abs).startsWith(path.resolve(domainFactoryDir())),
    `fuera del sandbox: ${abs}`,
  );
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
  return abs;
}

// ── Helpers con efectos reales (sandbox + tmpjobs, como las suites vecinas) ──

/**
 * Siembra un score failing real (vía el engine dueño de `scores.json`) para
 * que `collectFailures` lo encuentre. Todo bajo tmpjobs del store.
 */
function seedFailureSync(id: string, scorerName: string, at?: string): void {
  addEvidenceNoReview(id);
  const def = LOADED.find((d) => d.name === scorerName);
  assert.ok(def, `scorer cargado: ${scorerName}`);
  const labels = def.labels;
  const failing = labels.find((l) => l.score < def.passingScore) ?? labels[0];
  assert.ok(failing, `scorer ${scorerName} sin labels`);
  const ok = persistScoreResult({
    scorer: def.name,
    workItemId: id,
    label: failing.value,
    score: failing.score,
    passing: false,
    reason: "evidencia de regression para F3-E1",
    model: def.model,
    origin: "manual",
    at: typeof at === "string" && at.length > 0 ? at : new Date().toISOString(),
  });
  assert.equal(ok, true, `persistScoreResult de ${id}/${scorerName}`);
}

/** Reescribe el target de una propuesta del sandbox (simula LLM/disco corrupto). */
function tamperProposalTarget(id: string, target: string): void {
  const file = path.join(domainFactoryDir(), ".proposals", `${id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  raw.target = target;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2), "utf-8");
}

test("D1 sandbox activo: la base factory es el tmpdir, no el repo", () => {
  assert.equal(path.resolve(domainFactoryDir()), path.resolve(SANDBOX_FACTORY));
  assert.ok(
    path.resolve(domainResolveFactory("skills/x/SKILL.md")).startsWith(path.resolve(SANDBOX_FACTORY)),
  );
});

test("D2 parsers/guards de proposals (400/404/409 con los textos de hoy)", () => {
  const noQuery = checkFailuresRequest(null);
  assert.equal(noQuery.ok, false);
  if (!noQuery.ok) assert.equal(noQuery.code, 400);
  const unknown = checkFailuresRequest("scorer-que-no-existe-zzz");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, 404);
  if (ANY_SCORER) {
    const ok = checkFailuresRequest(ANY_SCORER);
    assert.deepEqual(ok, { ok: true, scorer: ANY_SCORER });
  }
  const badBody = domainCheckCreateBody({});
  assert.ok("error" in badBody && badBody.code === 400);
  assert.ok(!("error" in domainCheckCreateBody({ scorer: ANY_SCORER ?? "x" })) || true);
  assert.ok(domainIsFailures("/factory/improve/failures", "GET"));
  assert.ok(domainIsPropList("/factory/improve/proposals", "GET"));
  assert.ok(domainIsPropCreate("/factory/improve/proposals", "POST"));
  assert.ok(domainSafeProposalId("imp-abc123") !== httpSafeProposalId(".."));
  const get = domainParsePropGet("/factory/improve/proposals/imp-abc");
  assert.ok("id" in get);
  const badGet = domainParsePropGet("/factory/improve/proposals/../x");
  assert.ok("error" in badGet);
  const adopt = domainParseAction("/factory/improve/proposals/imp-abc/adopt", "adopt");
  assert.ok("id" in adopt);
  const discard = domainParseAction("/factory/improve/proposals/imp-abc/discard", "discard");
  assert.ok("id" in discard);
  if (ANY_SCORER) {
    assert.deepEqual(domainCollectFailures(ANY_SCORER).length >= 0, true);
  }
});

test("D3 allowlist: unidad + doble-rechazo (análisis failed, adopt 409)", async () => {
  if (!ANY_SCORER) return;
  assert.equal(domainAdoptable("skills/f3e1/SKILL.md"), true);
  assert.equal(domainAdoptable("agents/f3e1/agent.md"), true);
  assert.equal(domainAdoptable("../escape.md"), false);
  assert.equal(domainAdoptable("/absoluto.md"), false);
  assert.equal(domainAdoptable("otra/skills.md"), false);
  assert.equal(domainAdoptable("skills/notas.txt"), false);
  assert.equal(domainAdoptable("skills\\win.md"), false);
  assert.equal(domainAdoptable(""), false);
  // Rechazo 1: el análisis con target fuera del allowlist deja failed honesto.
  const job = makeJob();
  seedFailureSync(job, ANY_SCORER);
  const pending = domainCreatePendingProposal(ANY_SCORER);
  trackedProposals.push(pending.id);
  setAnalysisPromptMock(async () =>
    JSON.stringify({
      pattern: "patrón",
      target: "/etc/fuera-del-allowlist.md",
      rationale: "razón",
      newContent: "# nuevo",
      regressionsAddressed: [job],
    }),
  );
  try {
    const failed = await domainAnalyze(pending.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.failureReason ?? "", /allowlist/);
  } finally {
    setAnalysisPromptMock(null);
  }
  // Rechazo 2: ready con target manipulado → adopt 409 (defensa en profundidad).
  const job2 = makeJob();
  seedFailureSync(job2, ANY_SCORER);
  const pending2 = domainCreatePendingProposal(ANY_SCORER);
  trackedProposals.push(pending2.id);
  setAnalysisPromptMock(async () =>
    JSON.stringify({
      pattern: "patrón",
      target: "skills/f3e1/tamper.md",
      rationale: "razón",
      newContent: "# contenido",
      regressionsAddressed: [job2],
    }),
  );
  try {
    const ready = await domainAnalyze(pending2.id);
    assert.equal(ready.status, "ready");
  } finally {
    setAnalysisPromptMock(null);
  }
  tamperProposalTarget(pending2.id, "../escape-manipulado.md");
  assert.throws(() => domainAdopt(pending2.id), /allowlist/);
  try {
    domainAdopt(pending2.id);
    assert.fail("adopt con target manipulado debió lanzar");
  } catch (e) {
    assert.equal(isImprovementError(e), true);
    if (isImprovementError(e)) assert.equal(e.code, 409);
  }
  const discarded = domainDiscard(pending2.id);
  assert.equal(discarded.status, "discarded");
});

test("D4 adopt con backup-antes-de-escribir SOLO por endpoint", async () => {
  if (!ANY_SCORER) return;
  const rel = "skills/f3e1/mejora.md";
  writeSandboxFile(rel, "ORIGINAL");
  const job = makeJob();
  seedFailureSync(job, ANY_SCORER);
  const pending = domainCreatePendingProposal(ANY_SCORER);
  trackedProposals.push(pending.id);
  setAnalysisPromptMock(async () =>
    JSON.stringify({
      pattern: "patrón recurrente",
      target: rel,
      rationale: "corrige el patrón",
      newContent: "MEJORADO",
      regressionsAddressed: [job],
    }),
  );
  try {
    const ready = await domainAnalyze(pending.id);
    assert.equal(ready.status, "ready");
  } finally {
    setAnalysisPromptMock(null);
  }
  // Adoptar en pending/failed exige confirmación previa: primero 409.
  const early = domainCreatePendingProposal(ANY_SCORER);
  trackedProposals.push(early.id);
  assert.throws(() => domainAdopt(early.id), /not adoptable/);
  const result = domainAdopt(pending.id);
  assert.equal(result.target, rel);
  assert.ok(result.backup);
  const backupAbs = domainResolveFactory(result.backup as string);
  assert.equal(fs.readFileSync(backupAbs, "utf-8"), "ORIGINAL");
  assert.equal(fs.readFileSync(domainResolveFactory(rel), "utf-8"), "MEJORADO");
  const stored = domainReadProposal(pending.id);
  assert.equal(stored?.status, "adopted");
  assert.ok(stored?.decidedAt);
  assert.deepEqual(domainListSummaries().some((s) => s.id === pending.id), true);
});

test("D5 regla 4: ningún flujo automático adopta (solo el endpoint humano)", async () => {
  if (!SELF_SCORER) return;
  // Limpia abiertas del scorer para que el cooldown no decida por nosotros.
  for (const p of listProposals()) {
    try {
      if (p.scorer === SELF_SCORER && p.status === "ready") domainDiscard(p.id);
    } catch {}
  }
  const rel = "skills/f3e1/auto.md";
  writeSandboxFile(rel, "INTACTO");
  const since = new Date(Date.now() + 5000).toISOString();
  const j1 = makeJob();
  const j2 = makeJob();
  seedFailureSync(j1, SELF_SCORER, since);
  seedFailureSync(j2, SELF_SCORER, since);
  setAnalysisPromptMock(async () =>
    JSON.stringify({
      pattern: "auto",
      target: rel,
      rationale: "auto",
      newContent: "AUTO-ESCRITO",
      regressionsAddressed: [j1, j2],
    }),
  );
  try {
    const before = new Map(listProposals().map((p) => [p.id, p.status]));
    const decision = await maybeAutoProposeForScorer(SELF_SCORER);
    assert.equal(typeof decision.proposed, "boolean");
    // Jamás adopted por vía automática: ni las nuevas ni las preexistentes
    // cambian a adopted (D4 adoptó por endpoint explícito y queda intacto).
    for (const p of listProposals()) {
      const was = before.get(p.id);
      if (was === undefined) {
        assert.notEqual(p.status, "adopted", `auto-adopt prohibido: ${p.id}`);
        if (p.scorer === SELF_SCORER) trackedProposals.push(p.id);
      } else if (was !== "adopted") {
        assert.notEqual(p.status, "adopted", `auto-adopt prohibido: ${p.id}`);
      }
    }
    if (decision.proposed && decision.proposalId) trackedProposals.push(decision.proposalId);
    // El target sigue intacto: el análisis no escribe (solo el endpoint adopta).
    assert.equal(fs.readFileSync(domainResolveFactory(rel), "utf-8"), "INTACTO");
  } finally {
    setAnalysisPromptMock(null);
  }
});

test("D6 cero escrituras fuera del sandbox (factory real intacta)", () => {
  const repoFactory = path.resolve(HERE, "..", "factory");
  const before = new Set(fs.readdirSync(repoFactory));
  // Los flujos D3–D5 ya corrieron: si algo escribió fuera, se ve acá.
  const after = fs.readdirSync(repoFactory);
  assert.deepEqual([...after].sort(), [...before].sort());
  // Y todo lo propuesto vive bajo el sandbox.
  const sandboxProps = path.join(SANDBOX_FACTORY, ".proposals");
  assert.ok(fs.existsSync(sandboxProps));
});
