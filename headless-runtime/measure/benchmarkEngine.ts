/**
 * BenchmarkEngine — Ola 12 Measure.
 * Compara CONFIGS DE REVIEWER (modelos) sobre TASKS FIJAS con Correctness
 * built-in (`verdict === expectedVerdict`) y SIN ganador automático: reporta
 * stats por config, el humano decide.
 *
 * Espeja el ESTILO del módulo measure (scorerEngine: nunca lanza salvo
 * validación, best-effort, mocks inyectables vía reviewAgent):
 * - `runBenchmark(definition)`: valida (zod + cap, esos SÍ lanzan → 400 con
 *   razón) y corre los trials SECUENCIALES (nunca en paralelo: evita tormenta
 *   de servers) vía `reviewAgent.consume` con `reviewerModel=config`,
 *   `reviewAttempt: 1` y el prompt de la task.
 * - Fallo LLM en un trial → trial con `parseOk: false, pass: false` y sigue
 *   con el siguiente (un trial roto no mata el run). `consume` nunca lanza
 *   (convierte todo a `ask_human`); un `ask_human` cuenta como no-parseable:
 *   el revisor no pudo juzgar, así que Correctness no puede pasar.
 * - Costo honesto: sin tokens ni USD inventados. Cada trial registra
 *   `durationMs`; el run cuenta `llmCalls` (= trials ejecutados).
 * - Fixture por task: worktree en `os.tmpdir()` donde se escriben `files`
 *   (contenido acotado 2KB/archivo, máx 5 archivos, anti-traversal). Se
 *   limpia al final best-effort.
 * - Persiste `factory/.benchmark-results/<runId>.json` (tmp→rename,
 *   best-effort) al crear (snapshot `running`) y al terminar (`done`/`error`).
 * - Jobs/pacts nunca tocan benchmarks: nadie invoca este engine salvo POST
 *   humano a /factory/benchmarks (sin gate necesario).
 *
 * Ola 18 P1.6 (E2): cada trial, además de Correctness, corre los scorers
 * resueltos (`BenchmarkDefinition.scorers`, ausente = TODOS los cargados vía
 * loader, dinámico) contra el trial reutilizando el juez de scorerEngine
 * (seam de mock en tests, real en vivo) y guarda `trial.scores`. Scorer que
 * falla → unscored en ese trial, el trial sigue (Correctness manda). Stats
 * agregan `scorePassRate` por scorer (vía computeBenchmarkStats; unscored
 * excluidos). SIN ganador. Costo: 1 llamada revisor + 1 por scorer por trial
 * (el cap 50 sigue contando SOLO trials).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BENCHMARK_FILE_MAX_BYTES,
  BENCHMARK_MAX_TRIALS,
  BENCHMARK_RAW_SNIPPET_MAX,
  computeBenchmarkStats,
  countBenchmarkTrials,
  validateBenchmarkDefinition,
  type BenchmarkConfig,
  type BenchmarkDefinition,
  type BenchmarkRun,
  type BenchmarkRunSummary,
  type BenchmarkTask,
  type TrialResult,
  type TrialVerdict,
} from "../../shared/types/benchmark";
import { reviewAgent } from "../review/reviewAgent";
import { notify } from "../notify/notifications";
import { listScorers, loadScorer } from "./scorerLoader";
import {
  isNotApplicable,
  isUnscored,
  resolvePassing,
  scoreJob,
} from "./scorerEngine";
import { workItemStore } from "../workItem/workItemStore";
import {
  parseBenchmarkDecision,
  type BenchmarkDecision,
} from "../factory/measure/decisionRecord";

/** Re-export del estimador canónico (fórmula trials × (1 + scorers)). */
export { estimateBenchmarkCalls } from "../../shared/types/benchmark";

/** Prefijo de los fixture worktrees en os.tmpdir() (para verificar limpieza). */
export const BENCHMARK_FIXTURE_PREFIX = "termcanvas-bench-";
/** Nombre del directorio de resultados bajo el repo root. */
export const BENCHMARK_RESULTS_DIR = ".benchmark-results";

/** Registro en memoria de runs (el daemon los sirve sin releer disco). */
const benchmarkRuns = new Map<string, BenchmarkRun>();

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "");
}

// ── Repo root & resultados en disco ──

function getRepoRoot(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(currentFile), "../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {}
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "headless-runtime"))
    ) {
      return cwd;
    }
  } catch {}
  return process.cwd();
}

/**
 * Directorio de resultados: `<repo>/factory/.benchmark-results`.
 * Nunca lanza (fallback a cwd).
 */
export function getBenchmarkResultsDir(): string {
  try {
    return path.join(getRepoRoot(), "factory", BENCHMARK_RESULTS_DIR);
  } catch {
    return path.join(process.cwd(), "factory", BENCHMARK_RESULTS_DIR);
  }
}

/**
 * Persiste un run (tmp→rename atómico, best-effort). Nunca lanza.
 * Devuelve false si no pudo (el run sigue vivo en memoria).
 */
export function persistBenchmarkRun(run: BenchmarkRun): boolean {
  try {
    if (!run || typeof run !== "object" || typeof run.id !== "string") return false;
    const dir = getBenchmarkResultsDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return false;
    }
    const target = path.join(dir, `${run.id}.json`);
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(run, null, 2), "utf-8");
    } catch {
      return false;
    }
    try {
      fs.renameSync(tmp, target);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {}
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Relee un run desde disco (valida id seguro + zod tolerante).
 * Null si no existe o es ilegible. Nunca lanza.
 */
export function readBenchmarkRunFile(id: string): BenchmarkRun | null {
  try {
    if (typeof id !== "string" || id.length === 0 || id.length > 128) return null;
    if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
      return null;
    }
    const target = path.join(getBenchmarkResultsDir(), `${id}.json`);
    if (!fs.existsSync(target)) return null;
    const raw = fs.readFileSync(target, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || parsed.id !== id) return null;
    if (
      typeof parsed.name !== "string" ||
      (parsed.status !== "running" && parsed.status !== "done" && parsed.status !== "error") ||
      !Array.isArray(parsed.trials) ||
      typeof parsed.stats !== "object" ||
      typeof parsed.llmCalls !== "number"
    ) {
      return null;
    }
    return parsed as unknown as BenchmarkRun;
  } catch {
    return null;
  }
}

/**
 * Obtiene un run: memoria primero, disco como fallback (y lo registra).
 * Null si no existe. Nunca lanza.
 */
export function getBenchmarkRun(id: string): BenchmarkRun | null {
  try {
    if (typeof id !== "string" || id.length === 0) return null;
    const mem = benchmarkRuns.get(id);
    if (mem) return mem;
    const disk = readBenchmarkRunFile(id);
    if (disk) {
      benchmarkRuns.set(id, disk);
      return disk;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Lista liviana de runs (memoria + disco), ordenados por createdAt desc,
 * acotada a `limit` (default 20). Nunca lanza.
 */
export function listBenchmarkRuns(limit = 20): BenchmarkRunSummary[] {
  const out: BenchmarkRunSummary[] = [];
  try {
    const cap =
      Number.isInteger(limit) && (limit as number) > 0
        ? Math.min(limit as number, 100)
        : 20;
    const merged = new Map<string, BenchmarkRun>();
    try {
      const dir = getBenchmarkResultsDir();
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir).slice(0, 100);
        for (const entry of entries) {
          try {
            if (!entry.endsWith(".json") || entry.includes(".tmp-")) continue;
            const id = entry.slice(0, -".json".length);
            if (merged.has(id)) continue;
            const run = readBenchmarkRunFile(id);
            if (run) merged.set(id, run);
          } catch {
            // archivo ilegible: se saltea
          }
        }
      }
    } catch {
      // sin disco: vale la memoria
    }
    for (const [id, run] of benchmarkRuns) {
      merged.set(id, run);
    }
    const sorted = [...merged.values()].sort((a, b) => {
      const at = Date.parse(a.createdAt);
      const bt = Date.parse(b.createdAt);
      const an = Number.isFinite(at) ? at : 0;
      const bn = Number.isFinite(bt) ? bt : 0;
      if (bn !== an) return bn - an;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    for (const run of sorted.slice(0, cap)) {
      try {
        const trials = Array.isArray(run.trials) ? run.trials.length : 0;
        const configs =
          run.stats && typeof run.stats === "object" ? Object.keys(run.stats).length : 0;
        out.push({
          id: run.id,
          name: run.name,
          status: run.status,
          createdAt: run.createdAt,
          trials,
          configs,
        });
      } catch {
        // run corrupto en memoria: se saltea
      }
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * Borra un run de memoria y disco (higiene para tests; NO expuesto vía HTTP).
 * Nunca lanza.
 */
export function deleteBenchmarkRun(id: string): boolean {
  try {
    if (typeof id !== "string" || id.length === 0) return false;
    benchmarkRuns.delete(id);
    try {
      const target = path.join(getBenchmarkResultsDir(), `${id}.json`);
      if (
        id.includes("..") ||
        id.includes("/") ||
        id.includes("\\") ||
        id.includes("\0")
      ) {
        return true;
      }
      fs.rmSync(target, { force: true });
    } catch {}
    return true;
  } catch {
    return false;
  }
}

// ── Creación (valida: lanza → 400 con razón) ──

function sanitizeIdSegment(value: string): string {
  try {
    return (
      String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "x"
    );
  } catch {
    return "x";
  }
}

/** Genera un id de run único (`bench-…`). Puro salvo reloj/azar. */
export function makeBenchmarkRunId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `bench-${Date.now().toString(36)}${rand}`;
}

/**
 * Valida la definition (zod + cap de cuota) y registra el run en estado
 * `running` (memoria + snapshot best-effort en disco). Lanza si es inválida
 * o excede `BENCHMARK_MAX_TRIALS` — el endpoint lo convierte en 400.
 */
export function createPendingBenchmarkRun(definition: unknown): BenchmarkRun {
  // Cap de cuota PRIMERO (sobre la forma cruda): el mensaje de error debe
  // decir "cap" aunque el schema también lo rechace después.
  const rawTotal = countBenchmarkTrials(definition);
  if (rawTotal > BENCHMARK_MAX_TRIALS) {
    throw new Error(
      `benchmark excede el cap (${rawTotal} trials > ${BENCHMARK_MAX_TRIALS}): reducí tasks × configs × repetitions`,
    );
  }
  const def = validateBenchmarkDefinition(definition);
  const total =
    def.tasks.length * def.configs.length * def.repetitions;
  if (total > BENCHMARK_MAX_TRIALS) {
    throw new Error(
      `benchmark excede el cap (${total} trials > ${BENCHMARK_MAX_TRIALS}): reducí tasks × configs × repetitions`,
    );
  }
  const now = new Date().toISOString();
  const configIds = def.configs.map((c) => c.id);
  const run: BenchmarkRun = {
    id: makeBenchmarkRunId(),
    name: def.name,
    status: "running",
    createdAt: now,
    trials: [],
    stats: computeBenchmarkStats([], configIds),
    llmCalls: 0,
  };
  benchmarkRuns.set(run.id, run);
  persistBenchmarkRun(run);
  return run;
}

// ── Fixtures (tmpdir por task, best-effort, anti-traversal) ──

function isSafeFixtureRelPath(rel: string): boolean {
  try {
    if (typeof rel !== "string" || rel.length === 0 || rel.length > 256) return false;
    const t = rel.trim();
    if (t.length === 0 || t.includes("\0") || t.includes("..")) return false;
    if (t.startsWith("/") || t.startsWith("\\")) return false;
    if (/^[a-zA-Z]:[\\/]/.test(t)) return false;
    if (t.includes("\\")) return false;
    if (path.isAbsolute(t)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Escribe los `files` de la task en el fixture dir (contenido acotado a
 * 2KB/archivo). Entradas inseguras se omiten. Nunca lanza.
 */
function writeFixtureFiles(
  fixtureDir: string,
  files: BenchmarkTask["files"],
): void {
  try {
    const list = Array.isArray(files) ? files.slice(0, 5) : [];
    for (const file of list) {
      try {
        const rel = typeof file?.path === "string" ? file.path : "";
        if (!isSafeFixtureRelPath(rel)) continue;
        const target = path.resolve(fixtureDir, rel);
        if (
          target !== fixtureDir &&
          !target.startsWith(fixtureDir + path.sep)
        ) {
          continue;
        }
        const content =
          typeof file?.content === "string"
            ? file.content.slice(0, BENCHMARK_FILE_MAX_BYTES)
            : "";
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf-8");
      } catch {
        // un archivo roto no mata el trial
      }
    }
  } catch {
    // fixture parcial: el trial corre igual
  }
}

function cleanupFixtureDir(dir: string | null): void {
  try {
    if (typeof dir !== "string" || dir.length === 0) return;
    const resolved = path.resolve(dir);
    const tmpRoot = path.resolve(os.tmpdir());
    if (resolved !== tmpRoot && !resolved.startsWith(tmpRoot + path.sep)) return;
    if (!path.basename(resolved).startsWith(BENCHMARK_FIXTURE_PREFIX)) return;
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch {
    // limpieza best-effort
  }
}

// ── Scorers por trial (Ola 18 P1.6, E2) ──

/**
 * Scorers a correr por trial.
 * - `scorers` explícito en la definition (incluso `[]` = opt-out explícito,
 *   solo Correctness) → copia saneada (sin vacíos/inválidos/dupes, cap 10).
 * - Ausente/null → TODOS los scorers cargados vía loader (DINÁMICO: jamás se
 *   hardcodea ningún nombre acá; si mañana hay 5 scorers, corren los 5).
 * - Loader roto → `[]` (Correctness-only, honesto).
 * Puro salvo la lectura del loader. Nunca lanza.
 */
export function resolveBenchmarkScorers(
  definition: BenchmarkDefinition | unknown,
): string[] {
  try {
    const d = definition as { scorers?: unknown } | null | undefined;
    if (d && typeof d === "object" && Array.isArray(d.scorers)) {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const s of d.scorers) {
        if (typeof s !== "string") continue;
        const t = s.trim();
        if (t.length === 0 || t.length > 64) continue;
        if (!/^[a-z0-9-]+$/i.test(t)) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
        if (out.length >= 10) break;
      }
      return out;
    }
    try {
      return listScorers()
        .map((s) => s.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0);
    } catch {
      return [];
    }
  } catch {
    return [];
  }
}

/**
 * Corre los scorers resueltos contra UN trial reutilizando el juez de
 * scorerEngine (`scoreJob` con `manual: true`, que bypasea sampling):
 * - En tests, el juez sale del seam de mock (`setScorerPromptMock`); en vivo,
 *   del LLM real. Este engine no distingue: solo consume el outcome.
 * - El trial se materializa como job EFÍMERO en el store con su evidencia
 *   (createdFiles de la task + verification `pass` declarada + review SOLO si
 *   el veredicto del trial fue parseable). Un trial `ask_human` deja a los
 *   scorers de review como not-applicable (honesto: el job-trial no llegó a
 *   Review) mientras implement/verification sí califican.
 * - ORDEN DE NARROWING (contrato E1): `isNotApplicable()` ANTES que
 *   `isUnscored()` (el not-applicable lleva `unscored: true` por diseño).
 * - Scorer que falla (juez roto, label inválido, scorer desconocido) → ese
 *   scorer queda AUSENTE de `scores` y el trial sigue (Correctness manda).
 * - `passing` SIEMPRE vía `resolvePassing` de E1 (nunca comparación local).
 * - El job efímero se borra del store en `finally` (haya scored o no) y su
 *   dir se limpia (vive bajo el fixture, o bajo tmpdir con guard si no hubo
 *   fixture). Cotas Regla 7: 1 llamada al juez por scorer por trial,
 *   secuencial (nunca en paralelo), ≤10 scorers.
 * Nunca lanza: cualquier imprevisto es `{scores: {}, judgeCalls: 0}`.
 */
async function runTrialScorers(opts: {
  runId: string;
  task: BenchmarkTask;
  configId: string;
  repetition: number;
  verdict: TrialVerdict;
  confidence: number;
  findingsCount: number;
  fixtureDir: string | null;
  scorerNames: string[];
}): Promise<{
  scores: Record<string, { label: string; passing: boolean }>;
  judgeCalls: number;
}> {
  const empty: {
    scores: Record<string, { label: string; passing: boolean }>;
    judgeCalls: number;
  } = { scores: {}, judgeCalls: 0 };
  try {
    const names = (
      Array.isArray(opts.scorerNames) ? opts.scorerNames : []
    ).filter((n): n is string => typeof n === "string" && n.length > 0);
    if (names.length === 0) return empty;
    const ephemeralId =
      `job-benchscore-${sanitizeIdSegment(opts.runId.replace(/^bench-/, ""))}` +
      `-${sanitizeIdSegment(opts.task.id)}-${sanitizeIdSegment(opts.configId)}-r${opts.repetition}`;
    let ephemeralDir: string | null = null;
    try {
      const created = workItemStore.create({
        id: ephemeralId,
        prompt: String(opts.task.prompt ?? "").slice(0, 2000),
        worktree: opts.fixtureDir ?? os.tmpdir(),
        phase: "diagnosisLlm",
      });
      const dir = (created as unknown as { dir?: unknown }).dir;
      ephemeralDir = typeof dir === "string" ? dir : null;
    } catch {
      return empty;
    }
    try {
      const now = new Date().toISOString();
      const createdFiles = (
        Array.isArray(opts.task.files) ? opts.task.files : []
      )
        .map((f) => (typeof f?.path === "string" ? f.path.trim() : ""))
        .filter((p) => p.length > 0)
        .slice(0, 5);
      const meta: Record<string, unknown> = {
        createdFiles,
        verification: {
          overall: "pass",
          steps: [],
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
        },
      };
      if (opts.verdict === "accept" || opts.verdict === "revise") {
        meta.review = {
          verdict: opts.verdict,
          summary:
            `benchmark trial ${opts.configId} verdict=${opts.verdict} ` +
            `confidence=${opts.confidence} findings=${opts.findingsCount} ` +
            `expected=${opts.task.expectedVerdict}`.slice(0, 500),
        };
      }
      try {
        workItemStore.appendEvent(
          ephemeralId,
          "system",
          `benchmark trial seed (task ${opts.task.id}, config ${opts.configId})`,
          meta as unknown as Record<string, unknown>,
        );
      } catch {
        // seed parcial: el juez decide con lo que haya (o queda unscored)
      }
      const scores: Record<string, { label: string; passing: boolean }> = {};
      let judgeCalls = 0;
      for (const name of names) {
        let outcome: unknown = null;
        try {
          outcome = await scoreJob(ephemeralId, name, { manual: true });
        } catch {
          continue;
        }
        try {
          if (isNotApplicable(outcome)) continue;
          judgeCalls += 1;
          if (
            isUnscored(
              outcome as Parameters<typeof isUnscored>[0],
            )
          ) {
            continue;
          }
          const scored = outcome as {
            label: unknown;
            score: unknown;
            passing: unknown;
          };
          if (
            typeof scored.label !== "string" ||
            scored.label.length === 0 ||
            typeof scored.score !== "number"
          ) {
            continue;
          }
          let passing = scored.passing === true;
          try {
            const loaded = loadScorer(name);
            if (loaded) {
              passing = resolvePassing(
                scored.score,
                loaded.definition.passingScore,
              );
            }
          } catch {
            // vale el passing que ya trajo el engine
          }
          scores[name] = { label: scored.label, passing };
        } catch {
          continue;
        }
      }
      return { scores, judgeCalls };
    } finally {
      try {
        workItemStore.delete(ephemeralId);
      } catch {
        // memoria efímera: best-effort
      }
      try {
        if (ephemeralDir) {
          const resolved = path.resolve(ephemeralDir);
          const tmpRoot = path.resolve(os.tmpdir());
          if (
            resolved !== tmpRoot &&
            resolved.startsWith(tmpRoot + path.sep) &&
            resolved.includes(
              `${path.sep}.agents${path.sep}factory${path.sep}job-benchscore-`,
            )
          ) {
            fs.rmSync(resolved, { recursive: true, force: true });
          }
        }
      } catch {
        // limpieza best-effort (el fixture lo borra su propio cleanup)
      }
    }
  } catch {
    return empty;
  }
}

// ── Trial único (nunca lanza: el fallo es un trial, no una excepción) ──

function failedTrial(
  taskId: string,
  configId: string,
  repetition: number,
  durationMs: number,
): TrialResult {
  return {
    taskId,
    configId,
    repetition,
    verdict: "ask_human",
    confidence: 0,
    findingsCount: 0,
    parseOk: false,
    durationMs: Math.max(0, Math.round(durationMs)),
    pass: false,
  };
}

/**
 * Corre un trial SECUENCIAL (el caller itera con await, nunca en paralelo):
 * fixture tmpdir → `reviewAgent.consume` → Correctness → scorers del trial
 * (Ola 18 P1.6, E2) vía `runTrialScorers`. Nunca lanza.
 * Devuelve el trial + las llamadas al juez que consumió (para `llmCalls`).
 */
async function runSingleTrial(
  runId: string,
  task: BenchmarkTask,
  config: BenchmarkConfig,
  repetition: number,
  scorerNames: string[],
): Promise<{ trial: TrialResult; judgeCalls: number }> {
  const started = Date.now();
  let fixtureDir: string | null = null;
  const noJudge = (trial: TrialResult): { trial: TrialResult; judgeCalls: number } => ({
    trial,
    judgeCalls: 0,
  });
  try {
    try {
      fixtureDir = fs.mkdtempSync(
        path.join(os.tmpdir(), BENCHMARK_FIXTURE_PREFIX),
      );
    } catch {
      fixtureDir = null;
    }
    if (fixtureDir) {
      writeFixtureFiles(fixtureDir, task.files);
    }
    const worktreePath = fixtureDir ?? os.tmpdir();
    const workItemId = `job-bench-${sanitizeIdSegment(runId.replace(/^bench-/, ""))}-${sanitizeIdSegment(task.id)}-${sanitizeIdSegment(config.id)}-r${repetition}`;
    let verdict: TrialVerdict = "ask_human";
    let confidence = 0;
    let findingsCount = 0;
    let rawSnippet: string | undefined;
    try {
      const out = await reviewAgent.consume({
        workItemId,
        worktreePath,
        reviewerModel: {
          providerID: config.reviewerModel.providerID,
          modelID: config.reviewerModel.modelID,
          ...(config.reviewerModel.variant !== undefined
            ? { variant: config.reviewerModel.variant }
            : {}),
        },
        reviewAttempt: 1,
        prompt: task.prompt,
      });
      const v = out?.result?.verdict;
      verdict = v === "accept" || v === "revise" ? v : "ask_human";
      const c = out?.result?.confidence;
      confidence =
        typeof c === "number" && Number.isFinite(c)
          ? Math.min(1, Math.max(0, c))
          : 0;
      findingsCount = Array.isArray(out?.result?.findings)
        ? out.result.findings.length
        : 0;
      if (typeof out?.raw === "string" && out.raw.length > 0) {
        rawSnippet = out.raw.slice(0, BENCHMARK_RAW_SNIPPET_MAX);
      }
    } catch {
      // Ola 18 P1.6: si el review ni siquiera respondió (infra), no se gasta
      // cuota del juez en un trial ya roto: sin scorers, Correctness manda.
      return noJudge(failedTrial(task.id, config.id, repetition, Date.now() - started));
    }
    const parseOk = verdict !== "ask_human";
    // Ola 18 P1.6: scorers del trial (best-effort: si todo falla, el trial
    // sigue solo con Correctness).
    let trialScores: Record<string, { label: string; passing: boolean }> | undefined;
    let trialJudgeCalls = 0;
    if (scorerNames.length > 0) {
      try {
        const res = await runTrialScorers({
          runId,
          task,
          configId: config.id,
          repetition,
          verdict,
          confidence,
          findingsCount,
          fixtureDir,
          scorerNames,
        });
        trialScores = res.scores;
        trialJudgeCalls = res.judgeCalls;
      } catch {
        trialScores = {};
        trialJudgeCalls = 0;
      }
    }
    const trial: TrialResult = {
      taskId: task.id,
      configId: config.id,
      repetition,
      verdict,
      confidence,
      findingsCount,
      parseOk,
      durationMs: Math.max(0, Math.round(Date.now() - started)),
      pass: verdict === task.expectedVerdict,
      ...(rawSnippet !== undefined ? { rawSnippet } : {}),
      // Ola 18 P1.6 (aditivo): ausente si no se resolvieron scorers (runs
      // viejos y defs con `scorers: []` conservan la forma exacta de antes).
      ...(scorerNames.length > 0 ? { scores: trialScores ?? {} } : {}),
    };
    return { trial, judgeCalls: trialJudgeCalls };
  } catch {
    return noJudge(failedTrial(task.id, config.id, repetition, Date.now() - started));
  } finally {
    cleanupFixtureDir(fixtureDir);
  }
}

// ── Ejecución (solo errores de validación lanzan; el resto es trial fallido) ──

/**
 * Ejecuta los trials de un run pendiente en ORDEN definido
 * (tasks → configs → repetitions, siempre secuencial con await) y cierra el
 * run como `done` (o `error` ante un imprevisto interno: los trials rotos ya
 * quedaron como `parseOk: false`). Actualiza memoria + disco. Nunca lanza.
 */
export async function executeBenchmarkTrials(
  runId: string,
  definition: BenchmarkDefinition,
): Promise<BenchmarkRun> {
  const fallback: BenchmarkRun = {
    id: typeof runId === "string" ? runId : "bench-unknown",
    name: "benchmark",
    status: "error",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    trials: [],
    stats: {},
    llmCalls: 0,
  };
  try {
    const stored = benchmarkRuns.get(runId);
    const run: BenchmarkRun = stored ?? {
      id: runId,
      name: definition.name,
      status: "running",
      createdAt: new Date().toISOString(),
      trials: [],
      stats: computeBenchmarkStats(
        [],
        definition.configs.map((c) => c.id),
      ),
      llmCalls: 0,
    };
    if (!stored) benchmarkRuns.set(runId, run);
    const configIds = definition.configs.map((c) => c.id);
    // Ola 18 P1.6: scorers resueltos UNA vez por run (ausente = todos los
    // cargados, dinámico). Cada trial suma 1 (revisor) + sus llamadas al juez.
    const scorerNames = resolveBenchmarkScorers(definition);
    for (const task of definition.tasks) {
      for (const config of definition.configs) {
        for (let rep = 1; rep <= definition.repetitions; rep++) {
          try {
            const { trial, judgeCalls } = await runSingleTrial(
              runId,
              task,
              config,
              rep,
              scorerNames,
            );
            run.trials.push(trial);
            run.llmCalls += 1 + judgeCalls;
          } catch {
            run.trials.push(failedTrial(task.id, config.id, rep, 0));
            run.llmCalls += 1;
          }
        }
      }
    }
    run.stats = computeBenchmarkStats(run.trials, configIds);
    run.status = "done";
    run.finishedAt = new Date().toISOString();
    persistBenchmarkRun(run);
    // Ola 19 (d) benchmark done → centro de notificaciones (1 línea
    // best-effort, sin workItemId: el run no es un job, jamás bloquea).
    try { notify({ kind: "benchmark-done", title: "Benchmark terminado", body: `benchmark "${run.name}" ${run.id} listo: ${run.trials.length} trials, ${run.llmCalls} llamadas`.slice(0, 500) }); } catch {}
    return run;
  } catch (e) {
    try {
      const stored = benchmarkRuns.get(runId);
      if (stored && stored.status === "running") {
        stored.status = "error";
        stored.finishedAt = new Date().toISOString();
        stored.stats = computeBenchmarkStats(
          stored.trials,
          definition.configs.map((c) => c.id),
        );
        persistBenchmarkRun(stored);
        return stored;
      }
      if (stored) return stored;
    } catch {}
    try {
      persistBenchmarkRun({ ...fallback, id: runId });
    } catch {}
    return { ...fallback, id: runId };
  }
}

/**
 * Valida (lanza si inválida o excede el cap → 400 con razón) y corre el
 * benchmark completo hasta `done`. Trials secuenciales, fixtures limpiadas,
 * run persistido y devuelto.
 */
export async function runBenchmark(definition: unknown): Promise<BenchmarkRun> {
  // Cap primero (mismo motivo que createPendingBenchmarkRun): mensaje "cap".
  const rawTotal = countBenchmarkTrials(definition);
  if (rawTotal > BENCHMARK_MAX_TRIALS) {
    throw new Error(
      `benchmark excede el cap (${rawTotal} trials > ${BENCHMARK_MAX_TRIALS}): reducí tasks × configs × repetitions`,
    );
  }
  const def = validateBenchmarkDefinition(definition);
  const total = def.tasks.length * def.configs.length * def.repetitions;
  if (total > BENCHMARK_MAX_TRIALS) {
    throw new Error(
      `benchmark excede el cap (${total} trials > ${BENCHMARK_MAX_TRIALS}): reducí tasks × configs × repetitions`,
    );
  }
  const pending = createPendingBenchmarkRun(def);
  return executeBenchmarkTrials(pending.id, def);
}

// ── F3-T2 — Human benchmark-decision record link (additive, never auto) ──
//
// A benchmark run reports per-config stats with NO winner (plan §4.3): the
// human weighs cost against quality and records a BenchmarkDecision pointing
// at the trials on disk (trialsRef). This block links that human record to
// the run it decides about. Additive only:
// - No auto-winner: nothing here picks, ranks, or recommends a config. Any
//   payload carrying winner-like keys is rejected by the decisionRecord
//   schema (strict + forbidden-key rule) before it can be stored.
// - No threshold change: stats, passing resolution, and the trial cap are
//   untouched. Recording a decision never rewrites the run file.
// - Evidence on disk: the decision persists next to its run as
//   `factory/.benchmark-results/<runId>.decision.json` (tmp->rename atomic).
//   If it is not on disk, it did not happen: persist failure throws.
// - The run file itself is never modified by this block.

/** Suffix of the human decision sidecar next to its benchmark run file. */
export const BENCHMARK_DECISION_FILE_SUFFIX = ".decision.json";

/** Outcome of the never-throw decision record attempt. */
export type BenchmarkDecisionRecordOutcome =
  | { ok: true; data: BenchmarkDecision }
  | { ok: false; error: string };

function isSafeBenchmarkDecisionRunId(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > 128) return false;
    if (id.trim().length === 0) return false;
    if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute path of the decision sidecar for a run id.
 * Null for unsafe ids. Never throws.
 */
export function getBenchmarkDecisionFilePath(id: string): string | null {
  try {
    if (!isSafeBenchmarkDecisionRunId(id)) return null;
    return path.join(getBenchmarkResultsDir(), `${id}${BENCHMARK_DECISION_FILE_SUFFIX}`);
  } catch {
    return null;
  }
}

/**
 * Rereads the recorded human decision for a run id.
 * Null when absent, unreadable, schema-invalid, or filed under the wrong
 * run id (benchmarkId must equal the sidecar id). Never throws.
 */
export function readBenchmarkDecision(id: string): BenchmarkDecision | null {
  try {
    const target = getBenchmarkDecisionFilePath(id);
    if (!target) return null;
    if (!fs.existsSync(target)) return null;
    const raw = fs.readFileSync(target, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const checked = parseBenchmarkDecision(parsed);
    if (!checked.ok) return null;
    if (checked.data.benchmarkId !== id) return null;
    return checked.data;
  } catch {
    return null;
  }
}

/**
 * True when a valid human decision is on disk for the run. Never throws.
 */
export function hasBenchmarkDecision(id: string): boolean {
  try {
    return readBenchmarkDecision(id) !== null;
  } catch {
    return false;
  }
}

function writeDecisionFileAtomic(target: string, decision: BenchmarkDecision): void {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch {
    throw new Error(`could not persist benchmark decision for "${decision.benchmarkId}": results dir unavailable`);
  }
  const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(decision, null, 2), "utf-8");
  } catch {
    throw new Error(`could not persist benchmark decision for "${decision.benchmarkId}": write failed`);
  }
  try {
    fs.renameSync(tmp, target);
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    throw new Error(`could not persist benchmark decision for "${decision.benchmarkId}": rename failed`);
  }
}

/**
 * Records the human decision for a finished (or running) benchmark run.
 *
 * - Validates the payload through the shared decisionRecord schema
 *   (decidedBy must be exactly "human"; winner-like keys rejected).
 * - Requires `payload.benchmarkId === runId` (no cross-run misfiling).
 * - Requires the run to exist (memory or disk via getBenchmarkRun).
 * - Requires `trialsRef` to reference the run id (honest pointer to the
 *   trials on disk that the human weighed).
 * - Persists the sidecar atomically and returns the stored decision.
 *
 * Throws with a visible reason on invalid input or persist failure (the
 * endpoint maps it to 400/500). Never computes a winner, never touches
 * stats or thresholds.
 */
export function recordBenchmarkDecision(runId: string, payload: unknown): BenchmarkDecision {
  const checked = parseBenchmarkDecision(payload);
  if (!checked.ok) {
    throw new Error(checked.error.slice(0, 500));
  }
  const decision = checked.data;
  if (typeof runId !== "string" || decision.benchmarkId !== runId) {
    throw new Error(
      `benchmark decision benchmarkId mismatch: "${String(decision.benchmarkId).slice(0, 60)}" !== run "${String(runId).slice(0, 60)}"`,
    );
  }
  const run = getBenchmarkRun(runId);
  if (!run) {
    throw new Error(`benchmark run not found: ${runId.slice(0, 128)}`);
  }
  if (!decision.trialsRef.includes(runId)) {
    throw new Error(
      `benchmark decision trialsRef must reference run "${runId.slice(0, 60)}": got "${decision.trialsRef.slice(0, 120)}"`,
    );
  }
  const target = getBenchmarkDecisionFilePath(runId);
  if (!target) {
    throw new Error(`invalid benchmark run id: ${String(runId).slice(0, 60)}`);
  }
  writeDecisionFileAtomic(target, decision);
  return decision;
}

/**
 * Never-throw variant of recordBenchmarkDecision for scripts and tests.
 * Returns ok:true with the stored decision, or ok:false with the reason.
 */
export function tryRecordBenchmarkDecision(
  runId: string,
  payload: unknown,
): BenchmarkDecisionRecordOutcome {
  try {
    return { ok: true, data: recordBenchmarkDecision(runId, payload) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error ?? "").slice(0, 500) || "invalid benchmark decision",
    };
  }
}

/**
 * Deletes a decision sidecar from disk (hygiene for tests; NOT exposed via
 * HTTP). Never throws. Returns true when nothing remains for the id.
 */
export function deleteBenchmarkDecision(id: string): boolean {
  try {
    if (!isSafeBenchmarkDecisionRunId(id)) return false;
    try {
      const target = path.join(getBenchmarkResultsDir(), `${id}${BENCHMARK_DECISION_FILE_SUFFIX}`);
      fs.rmSync(target, { force: true });
    } catch {}
    return true;
  } catch {
    return false;
  }
}
