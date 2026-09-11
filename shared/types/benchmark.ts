/**
 * Benchmark domain types — Ola 12 Measure.
 * Contrato daemon ↔ renderer para benchmarks estilo Warp: comparar CONFIGS DE
 * REVIEWER (modelos) sobre TASKS FIJAS, con Correctness built-in y SIN ganador
 * automático (el humano pondera costo/calidad).
 *
 * Reglas honestas:
 * - Correctness = `verdict === expectedVerdict` por trial.
 * - Costo honesto: NO hay tokens ni USD inventados. Cada trial registra
 *   `durationMs` y el run cuenta `llmCalls` (= trials ejecutados).
 * - SIN `winner` ni `recommendation` en ningún shape: el sistema reporta
 *   stats por config, el humano decide.
 * - Jobs/pacts nunca tocan benchmarks: nadie los invoca salvo POST humano.
 *
 * Zod schemas + TypeScript types + helpers puros.
 */

import { z } from "zod";

// ── Constants ──

/** Protección de cuota: una definition que exceda este total → 400. */
export const BENCHMARK_MAX_TRIALS = 50;
/** Tope de archivos por task (el engine escribe como máximo estos). */
export const BENCHMARK_TASK_MAX_FILES = 5;
/** Tope de bytes por archivo de fixture que escribe el engine. */
export const BENCHMARK_FILE_MAX_BYTES = 2048;
/** Tope del snippet de raw persistido por trial (diagnóstico, no el raw). */
export const BENCHMARK_RAW_SNIPPET_MAX = 2048;
/** Ids de task/config válidos: igual que agentes/skills/scorers (anti-traversal). */
export const BENCHMARK_ID_PATTERN = /^[a-z0-9-]+$/i;
/** Ids de run generados por el engine. */
export const BENCHMARK_RUN_ID_PATTERN = /^bench-[a-z0-9-]+$/;

// ── BenchmarkTaskFile ──

export const BenchmarkTaskFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(256)
    .refine(
      (p) => {
        const t = p.trim();
        if (t.length === 0) return false;
        if (t.includes("\0")) return false;
        if (t.includes("..")) return false;
        if (t.startsWith("/") || t.startsWith("\\")) return false;
        if (/^[a-zA-Z]:[\\/]/.test(t)) return false;
        if (t.includes("\\")) return false;
        return true;
      },
      { message: "path debe ser relativo, sin .. ni absolutos" },
    ),
  content: z.string().max(8192),
});
export type BenchmarkTaskFile = z.infer<typeof BenchmarkTaskFileSchema>;

// ── BenchmarkTask ──

export const BenchmarkExpectedVerdictSchema = z.enum(["accept", "revise"]);
export type BenchmarkExpectedVerdict = z.infer<
  typeof BenchmarkExpectedVerdictSchema
>;

export const BenchmarkTaskSchema = z.object({
  id: z.string().min(1).max(64).regex(BENCHMARK_ID_PATTERN),
  prompt: z.string().min(1).max(8000),
  files: z.array(BenchmarkTaskFileSchema).min(1).max(BENCHMARK_TASK_MAX_FILES),
  verification: z
    .object({ overall: z.literal("pass") })
    .strict(),
  expectedVerdict: BenchmarkExpectedVerdictSchema,
});
export type BenchmarkTask = z.infer<typeof BenchmarkTaskSchema>;

// ── BenchmarkConfig ──

export const BenchmarkReviewerModelSchema = z.object({
  providerID: z.string().min(1).max(100),
  modelID: z.string().min(1).max(100),
  variant: z.string().max(100).optional(),
});
export type BenchmarkReviewerModel = z.infer<
  typeof BenchmarkReviewerModelSchema
>;

export const BenchmarkConfigSchema = z.object({
  id: z.string().min(1).max(64).regex(BENCHMARK_ID_PATTERN),
  reviewerModel: BenchmarkReviewerModelSchema,
});
export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;

// ── BenchmarkDefinition ──

export const BenchmarkDefinitionSchema = z
  .object({
    name: z.string().min(1).max(120),
    tasks: z.array(BenchmarkTaskSchema).min(1).max(20),
    configs: z.array(BenchmarkConfigSchema).min(1).max(10),
    repetitions: z.number().int().min(1).max(3),
    // Ola 18 P1.6 (E2): scorers opcionales a correr por trial, ADEMÁS de
    // Correctness. Ausente → TODOS los cargados vía loader (el engine lo
    // resuelve dinámico, jamás hardcodea nombres). Vacío explícito → ninguno
    // (solo Correctness). Nombres con el mismo charset que los scorers
    // (BENCHMARK_ID_PATTERN == SCORER_NAME_PATTERN); el server rechaza con
    // 400 los desconocidos. Cap 10 (espejo del tope de `agents` en scorers).
    scorers: z
      .array(z.string().min(1).max(64).regex(BENCHMARK_ID_PATTERN))
      .max(10)
      .optional(),
  })
  // Cap de cuota a nivel schema (además del engine/server/UI): nadie que
  // valide por acá puede planear más trials de los permitidos.
  .superRefine((d, ctx) => {
    const total = d.tasks.length * d.configs.length * d.repetitions;
    if (total > BENCHMARK_MAX_TRIALS) {
      ctx.addIssue({
        code: "custom",
        message: `cap: ${total} trials supera BENCHMARK_MAX_TRIALS (${BENCHMARK_MAX_TRIALS}): reducí tasks, configs o repetitions`,
      });
    }
  });
export type BenchmarkDefinition = z.infer<typeof BenchmarkDefinitionSchema>;

/**
 * Valida una definition (schema zod + ids únicos). Lanza si es inválida —
 * el engine y el endpoint la convierten en 400 con la razón visible.
 */
export function validateBenchmarkDefinition(
  payload: unknown,
): BenchmarkDefinition {
  const parsed = BenchmarkDefinitionSchema.parse(payload);
  const taskIds = new Set<string>();
  for (const task of parsed.tasks) {
    if (taskIds.has(task.id)) {
      throw new Error(`benchmark inválido: task duplicada "${task.id}"`);
    }
    taskIds.add(task.id);
  }
  const configIds = new Set<string>();
  for (const config of parsed.configs) {
    if (configIds.has(config.id)) {
      throw new Error(`benchmark inválido: config duplicada "${config.id}"`);
    }
    configIds.add(config.id);
  }
  // Ola 18 P1.6 (E2, aditivo): scorers duplicados → 400 accionable.
  // Solo rechaza lo que antes era ambiguo (el engine corría dupes de más).
  const scorerIds = new Set<string>();
  for (const name of parsed.scorers ?? []) {
    if (scorerIds.has(name)) {
      throw new Error(`benchmark inválido: scorer duplicado "${name}"`);
    }
    scorerIds.add(name);
  }
  return parsed;
}

/**
 * Total de trials planeados (tasks × configs × repetitions).
 * 0 si la definition no tiene forma válida. Puro, nunca lanza.
 */
export function countBenchmarkTrials(definition: unknown): number {
  try {
    const d = definition as {
      tasks?: unknown;
      configs?: unknown;
      repetitions?: unknown;
    };
    if (!d || typeof d !== "object") return 0;
    const tasks = Array.isArray(d.tasks) ? d.tasks.length : 0;
    const configs = Array.isArray(d.configs) ? d.configs.length : 0;
    const reps =
      typeof d.repetitions === "number" && Number.isInteger(d.repetitions)
        ? d.repetitions
        : 0;
    if (tasks <= 0 || configs <= 0 || reps <= 0) return 0;
    return tasks * configs * reps;
  } catch {
    return 0;
  }
}

// ── TrialResult ──

export const TrialVerdictSchema = z.enum(["accept", "revise", "ask_human"]);
export type TrialVerdict = z.infer<typeof TrialVerdictSchema>;

/**
 * Score de UN scorer en UN trial (Ola 18 P1.6, E2): evidencia persistida por
 * trial. Solo `{label, passing}` (el `score` crudo vive en `scores.json` del
 * job efímero del trial, si lo hubo; el trial guarda lo que la tabla muestra).
 * Scorer no scored (falló el juez o no aplicaba) → AUSENTE de este mapa
 * (nunca `{passing:false}` inventado: unscored no cuenta ni como pass ni
 * como fail en `scorePassRates`).
 */
export const TrialScoreEntrySchema = z.object({
  label: z.string().min(1).max(64),
  passing: z.boolean(),
});
export type TrialScoreEntry = z.infer<typeof TrialScoreEntrySchema>;

export const TrialResultSchema = z.object({
  taskId: z.string().min(1).max(64),
  configId: z.string().min(1).max(64),
  repetition: z.number().int().min(1),
  verdict: TrialVerdictSchema,
  confidence: z.number().min(0).max(1),
  findingsCount: z.number().int().min(0),
  parseOk: z.boolean(),
  durationMs: z.number().int().min(0),
  pass: z.boolean(),
  rawSnippet: z.string().max(BENCHMARK_RAW_SNIPPET_MAX).optional(),
  // Ola 18 P1.6 (E2, aditivo): ausente en runs viejos y en trials sin
  // scorers resueltos (forma vieja intacta).
  scores: z.record(z.string(), TrialScoreEntrySchema).optional(),
});
export type TrialResult = z.infer<typeof TrialResultSchema>;

/** Valida un TrialResult y lanza si es inválido. */
export function validateTrialResult(payload: unknown): TrialResult {
  return TrialResultSchema.parse(payload);
}

// ── BenchmarkRun ──

export const BenchmarkRunStatusSchema = z.enum(["running", "done", "error"]);
export type BenchmarkRunStatus = z.infer<typeof BenchmarkRunStatusSchema>;

export const BenchmarkConfigStatsSchema = z.object({
  trials: z.number().int().min(0),
  pass: z.number().int().min(0),
  passRate: z.number().min(0).max(1),
  avgDurationMs: z.number().min(0),
  parseErrors: z.number().int().min(0),
  // Ola 18 P1.6 (E2, aditivo): `{[scorer]: scorePassRate 0..1}` por config.
  // Opcional para que runs viejos sigan validando; el engine la AGREGA solo
  // cuando hay ≥1 trial scored (pactos de forma intactos: sin scorers, el
  // objeto serializado es byte a byte el de antes).
  scorePassRates: z.record(z.string(), z.number().min(0).max(1)).optional(),
});
export type BenchmarkConfigStats = z.infer<typeof BenchmarkConfigStatsSchema>;

export const BenchmarkRunSchema = z.object({
  id: z.string().regex(BENCHMARK_RUN_ID_PATTERN),
  name: z.string().min(1).max(120),
  status: BenchmarkRunStatusSchema,
  createdAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  trials: z.array(TrialResultSchema),
  stats: z.record(z.string(), BenchmarkConfigStatsSchema),
  llmCalls: z.number().int().min(0),
});
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;

/** Valida un BenchmarkRun y lanza si es inválido. */
export function validateBenchmarkRun(payload: unknown): BenchmarkRun {
  return BenchmarkRunSchema.parse(payload);
}

// ── Resumen para GET /factory/benchmarks (lista liviana, últimos 20) ──

export const BenchmarkRunSummarySchema = z.object({
  id: z.string().regex(BENCHMARK_RUN_ID_PATTERN),
  name: z.string().min(1).max(120),
  status: BenchmarkRunStatusSchema,
  createdAt: z.string().min(1),
  trials: z.number().int().min(0),
  configs: z.number().int().min(0),
});
export type BenchmarkRunSummary = z.infer<typeof BenchmarkRunSummarySchema>;

// ── Stats (puro, sin ganador: solo agregación por config) ──

/**
 * Agrega stats por config desde los trials. `configIds` fija el orden y
 * garantiza entrada (en ceros) aun sin trials. passRate redondeado a 4
 * decimales, avgDurationMs redondeado a ms entero. Puro, nunca lanza.
 * No calcula ganador: el humano pondera costo/calidad.
 *
 * Ola 18 P1.6 (E2, aditivo): agrega `scorePassRates` por config cuando hay
 * trials scored (`trial.scores[scorer] = {passing}`): proporción de trials
 * con `passing === true` ENTRE LOS SCORED. Trials unscored (scorer ausente
 * del mapa) no cuentan ni como pass ni como fail. La key se OMITE si ningún
 * scorer scored (forma vieja intacta).
 */
export function computeBenchmarkStats(
  trials: TrialResult[] | null | undefined,
  configIds: string[] | null | undefined,
): Record<string, BenchmarkConfigStats> {
  const out: Record<string, BenchmarkConfigStats> = {};
  try {
    const ids = Array.isArray(configIds)
      ? configIds.filter((c): c is string => typeof c === "string")
      : [];
    for (const id of ids) {
      out[id] = { trials: 0, pass: 0, passRate: 0, avgDurationMs: 0, parseErrors: 0 };
    }
    const list = Array.isArray(trials) ? trials : [];
    const durations: Record<string, number[]> = {};
    const scoreScored: Record<string, Record<string, number>> = {};
    const scorePassing: Record<string, Record<string, number>> = {};
    for (const t of list) {
      if (!t || typeof t !== "object") continue;
      const cid = (t as TrialResult).configId;
      if (typeof cid !== "string" || !(cid in out)) continue;
      out[cid].trials += 1;
      if ((t as TrialResult).pass === true) out[cid].pass += 1;
      if ((t as TrialResult).parseOk === false) out[cid].parseErrors += 1;
      const d = (t as TrialResult).durationMs;
      if (typeof d === "number" && Number.isFinite(d) && d >= 0) {
        if (!durations[cid]) durations[cid] = [];
        durations[cid].push(d);
      }
      // Ola 18 P1.6: solo las entradas PRESENTES cuentan (unscored = ausente).
      const tScores = (t as TrialResult).scores;
      if (tScores && typeof tScores === "object" && !Array.isArray(tScores)) {
        for (const [sname, entry] of Object.entries(
          tScores as Record<string, TrialScoreEntry>,
        )) {
          if (typeof sname !== "string" || sname.length === 0) continue;
          if (!entry || typeof entry !== "object") continue;
          if (!scoreScored[cid]) {
            scoreScored[cid] = {};
            scorePassing[cid] = {};
          }
          scoreScored[cid][sname] = (scoreScored[cid][sname] ?? 0) + 1;
          if ((entry as TrialScoreEntry).passing === true) {
            scorePassing[cid][sname] = (scorePassing[cid][sname] ?? 0) + 1;
          }
        }
      }
    }
    for (const id of Object.keys(out)) {
      const entry = out[id];
      entry.passRate =
        entry.trials === 0
          ? 0
          : Math.round((entry.pass / entry.trials) * 10000) / 10000;
      const ds = durations[id] ?? [];
      entry.avgDurationMs =
        ds.length === 0
          ? 0
          : Math.round(ds.reduce((a, b) => a + b, 0) / ds.length);
      const perScorer = scoreScored[id];
      if (perScorer) {
        const rates: Record<string, number> = {};
        for (const [sname, n] of Object.entries(perScorer)) {
          if (typeof n !== "number" || n <= 0) continue;
          const p = scorePassing[id]?.[sname] ?? 0;
          rates[sname] = Math.round((p / n) * 10000) / 10000;
        }
        // Solo si hubo ≥1 scored: sin scorers la forma es la de antes.
        if (Object.keys(rates).length > 0) entry.scorePassRates = rates;
      }
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * Llamadas LLM estimadas de un benchmark (Ola 18 P1.6, E2):
 * `trials × (1 + scorers)` — cada trial = 1 llamada al revisor + 1 por scorer.
 * `scorers` explícito en la definition manda; si está ausente se usa
 * `scorerCountFallback` (los scorers cargados que el engine correría); sin
 * dato → solo el revisor. El cap 50 sigue contando SOLO trials.
 * Comparte fórmula con `totalCallsWithScorers` de benchmarksUi. Pura, nunca
 * lanza.
 */
export function estimateBenchmarkCalls(
  definition: unknown,
  scorerCountFallback?: unknown,
): number {
  try {
    const trials = countBenchmarkTrials(definition);
    if (trials <= 0) return 0;
    let s = 0;
    const d = definition as { scorers?: unknown } | null | undefined;
    if (d && typeof d === "object" && Array.isArray(d.scorers)) {
      s = d.scorers.length;
    } else if (
      typeof scorerCountFallback === "number" &&
      Number.isInteger(scorerCountFallback) &&
      (scorerCountFallback as number) > 0
    ) {
      s = scorerCountFallback as number;
    }
    return trials * (1 + s);
  } catch {
    return 0;
  }
}
