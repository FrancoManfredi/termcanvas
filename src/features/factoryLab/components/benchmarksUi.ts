/**
 * benchmarksUi — Ola 12 (Measure: Benchmarks).
 * Helpers puros (sin React) para el BenchmarksPanel: formatos, badge de
 * trial, estimación de costo, validador de la definition pegada, builders de
 * URLs y parsers defensivos del contrato del backend.
 *
 * Contrato (lo implementa otro ingeniero en paralelo; programar defensivo):
 * - POST /factory/benchmarks (body BenchmarkDefinition) → 201 {id, trials, llmCalls}; 400 si inválido/cap.
 * - GET /factory/benchmarks → {runs: [{id,name,status,createdAt,trials,configs}]} (últimos 20).
 * - GET /factory/benchmarks/:id → run completo {id,name,status,createdAt,finishedAt?,
 *   trials: [{taskId,configId,repetition,verdict,confidence,findingsCount,parseOk,durationMs,pass}],
 *   stats: {[configId]: {trials,pass,passRate,avgDurationMs,parseErrors}}}.
 *
 * Todo campo ausente o forma inesperada → fallbacks ("sin datos"/"—"),
 * nunca throw. Tipos locales mínimos: NO importar tipos del backend que
 * todavía no existen en esta rama. NUNCA hay campo de ganador ni de
 * sugerencia automática: el humano pondera pass rate vs duración (§2.4).
 */

// ---------------------------------------------------------------------------
// Tipos locales mínimos (espejo del contrato, sin dependencia del backend)
// ---------------------------------------------------------------------------

/** Tono del badge de un trial: pass→pass, fail→fail, parse roto→error. */
export type TrialBadgeTone = "pass" | "fail" | "error";

export interface BenchmarkRunSummary {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  trials: number;
  configs: number;
}

export interface BenchmarkTrial {
  taskId: string;
  configId: string;
  repetition: number;
  verdict: string;
  confidence: number;
  findingsCount: number;
  parseOk: boolean;
  durationMs: number;
  pass: boolean;
  /** Ola 18 P1.6 (E2, aditivo): scores del trial por scorer ({label, passing}). Ausente en trials viejos → {}. */
  scores: Record<string, BenchmarkTrialScore>;
}

/** Score de un scorer dentro de un trial (espejo del `TrialScoreEntry` del backend). */
export interface BenchmarkTrialScore {
  label: string;
  passing: boolean;
}

export interface BenchmarkConfigStat {
  trials: number;
  pass: number;
  passRate: number;
  avgDurationMs: number;
  parseErrors: number;
  /** Ola 18 P1.6 (E2, aditivo): `{[scorer]: scorePassRate 0..1}` (solo scorers scored; ausente en stats viejas → {}). */
  scorePassRates: Record<string, number>;
}

export interface BenchmarkRunDetail {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  finishedAt: string;
  trials: BenchmarkTrial[];
  stats: Record<string, BenchmarkConfigStat>;
}

export interface BenchmarkDefinitionSummary {
  name: string;
  tasks: number;
  configs: number;
  repetitions: number;
  /** trials totales = tasks × configs × repetitions (== llamadas LLM al revisor). */
  trials: number;
}

export type ValidateDefinitionResult =
  | { ok: true; summary: BenchmarkDefinitionSummary }
  | { ok: false; error: string };

/** Cap del backend: un benchmark no puede superar estos trials. */
export const BENCHMARK_MAX_TRIALS = 50;

/** Veredictos que el backend acepta como expected (schema estricto). */
const VALID_EXPECTED_VERDICTS = ["accept", "revise"] as const;

// ---------------------------------------------------------------------------
// Presentación pura
// ---------------------------------------------------------------------------

/**
 * "NN% (p/N)". "—" si null o trials=0/inválido. Nunca throw.
 */
export function formatPassRate(
  s: { trials: number; pass: number } | null | undefined,
): string {
  if (!s || typeof s !== "object") return "—";
  const trials = (s as { trials?: unknown }).trials;
  const pass = (s as { pass?: unknown }).pass;
  if (typeof trials !== "number" || !Number.isFinite(trials) || trials <= 0) return "—";
  const p =
    typeof pass === "number" && Number.isFinite(pass) && pass >= 0 ? Math.floor(pass) : 0;
  const pct = Math.round((p / trials) * 100);
  return `${pct}% (${p}/${trials})`;
}

/**
 * Duración legible: <1000ms → "Nms", si no → "Ns" (1 decimal si hace falta).
 * null/inválido/negativo → "—". Nunca throw.
 */
export function formatDuration(ms: number | null | undefined | unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`;
}

/**
 * Tono del badge de un trial: parseOk false → "error"; pass true → "pass";
 * cualquier otro caso (incluido null/inválido) → "fail". Nunca throw.
 */
export function trialBadge(
  trial: { pass?: unknown; parseOk?: unknown } | null | undefined,
): TrialBadgeTone {
  if (trial && typeof trial === "object" && trial.parseOk === false) return "error";
  if (trial && typeof trial === "object" && trial.pass === true) return "pass";
  return "fail";
}

/**
 * trials totales = tasks × configs × repetitions (== llamadas LLM al
 * revisor, para el aviso de costo). Forma inválida → 0. Nunca throw.
 */
export function totalCalls(
  def: { tasks?: unknown; configs?: unknown; repetitions?: unknown } | null | undefined,
): number {
  if (!def || typeof def !== "object") return 0;
  const tasks = Array.isArray(def.tasks) ? def.tasks.length : 0;
  const configs = Array.isArray(def.configs) ? def.configs.length : 0;
  const reps =
    typeof def.repetitions === "number" &&
    Number.isInteger(def.repetitions) &&
    def.repetitions > 0
      ? def.repetitions
      : 0;
  if (tasks <= 0 || configs <= 0 || reps <= 0) return 0;
  return tasks * configs * reps;
}

/** Tope de scorers por benchmark (espejo del schema del backend). */
export const BENCHMARK_MAX_SCORERS = 10;

/** Nombres de scorer válidos (mismo charset que el backend). */
const SCORER_NAME_PATTERN = /^[a-z0-9-]+$/i;

export type ParseScorersFieldResult =
  | { ok: true; scorers: string[] }
  | { ok: false; error: string };

/**
 * Valida el campo opcional `scorers` de una definition ya parseada
 * (Ola 18 P1.6, E2).
 * - Ausente/null → `{ok: true, scorers: []}` que significa "TODOS los
 *   cargados" (el backend los resuelve vía loader, dinámico).
 * - Array (incluso vacío = opt-out explícito) → saneado (no vacíos, sin
 *   dupes, cap 10, charset válido) o error accionable en español.
 * Comparte reglas con `resolveBenchmarkScorers` del backend. Nunca throw.
 */
export function parseScorersField(parsed: unknown): ParseScorersFieldResult {
  try {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: true, scorers: [] };
    }
    const raw = (parsed as Record<string, unknown>).scorers;
    if (raw === undefined || raw === null) return { ok: true, scorers: [] };
    if (!Array.isArray(raw)) {
      return { ok: false, error: '"scorers" tiene que ser un array de nombres (o ausente = todos los cargados)' };
    }
    if (raw.length > BENCHMARK_MAX_SCORERS) {
      return { ok: false, error: `"scorers": máximo ${BENCHMARK_MAX_SCORERS} por benchmark (pediste ${raw.length})` };
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i];
      if (typeof s !== "string" || s.trim().length === 0) {
        return { ok: false, error: `scorers[${i}]: tiene que ser un nombre no vacío` };
      }
      const t = s.trim();
      if (t.length > 64 || !SCORER_NAME_PATTERN.test(t)) {
        return { ok: false, error: `scorers[${i}] "${t.slice(0, 40)}": nombre inválido (solo letras, números y guiones)` };
      }
      if (seen.has(t)) {
        return { ok: false, error: `scorer duplicado "${t}"` };
      }
      seen.add(t);
      out.push(t);
    }
    return { ok: true, scorers: out };
  } catch {
    return { ok: false, error: '"scorers" ilegible (tiene que ser un array de nombres o ausente)' };
  }
}

/**
 * Llamadas LLM estimadas = trials × (1 + scorers) — 1 al revisor + 1 por
 * scorer por trial (Ola 18 P1.6, E2). `scorers` explícito en la definition
 * manda; si está ausente se usa `loadedScorerCount` (los que el backend
 * correría); sin dato → solo el revisor. Espejo de `estimateBenchmarkCalls`
 * del backend. Nunca throw.
 */
export function totalCallsWithScorers(
  def: { tasks?: unknown; configs?: unknown; repetitions?: unknown; scorers?: unknown } | null | undefined,
  loadedScorerCount?: unknown,
): number {
  try {
    const trials = totalCalls(def);
    if (trials <= 0) return 0;
    let s = 0;
    if (def && typeof def === "object" && Array.isArray(def.scorers)) {
      s = def.scorers.length;
    } else if (
      typeof loadedScorerCount === "number" &&
      Number.isInteger(loadedScorerCount) &&
      (loadedScorerCount as number) > 0
    ) {
      s = loadedScorerCount as number;
    }
    return trials * (1 + s);
  } catch {
    return 0;
  }
}

/**
 * Tasa 0..1 → "NN%". null/inválida/fuera de rango → "—". Para las
 * `scorePassRates` por scorer (el `passRate` de Correctness ya tiene su
 * `formatPassRate` con conteos). Nunca throw.
 */
export function formatScoreRateValue(rate: unknown): string {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) return "—";
  return `${Math.round(rate * 100)}%`;
}

/**
 * Fecha del run en formato local. Inválida/ausente → "—". Nunca throw.
 */
export function formatRunDate(at: unknown): string {
  if (typeof at !== "string" || at.trim().length === 0) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

/**
 * Etiqueta en español del status. Desconocido → "sin datos". Nunca throw.
 */
export function statusLabel(status: unknown): string {
  if (status === "running") return "en curso";
  if (status === "done") return "listo";
  if (typeof status === "string" && status.trim().length > 0) return status.trim();
  return "sin datos";
}

/** true solo si el run sigue corriendo (para el polling del detalle). */
export function isRunningStatus(status: unknown): boolean {
  return status === "running";
}

// ---------------------------------------------------------------------------
// Validador de la definition pegada (JSON en el lanzador)
// ---------------------------------------------------------------------------

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Normaliza reviewerModel a la forma del backend ({providerID, modelID}):
 * acepta string "provider/model" (UX del lanzador) u objeto. null si inválido.
 * Nunca throw.
 */
export function normalizeReviewerModel(v: unknown): { providerID: string; modelID: string } | null {
  if (typeof v === "string") {
    const t = v.trim();
    const slash = t.indexOf("/");
    if (slash <= 0 || slash >= t.length - 1) return null;
    const providerID = t.slice(0, slash).trim();
    const modelID = t.slice(slash + 1).trim();
    if (!providerID || !modelID) return null;
    return { providerID, modelID };
  }
  if (v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    if (typeof r.providerID === "string" && r.providerID.trim() && typeof r.modelID === "string" && r.modelID.trim()) {
      return { providerID: r.providerID.trim(), modelID: r.modelID.trim() };
    }
  }
  return null;
}

/**
 * Normaliza una definition ya parseada a la forma exacta del backend
 * (reviewerModel objeto). Retorna null si la forma base es inválida.
 * Nunca throw.
 */
export function normalizeBenchmarkDefinition(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const r = parsed as Record<string, unknown>;
  if (!Array.isArray(r.configs)) return null;
  const configs: Array<Record<string, unknown>> = [];
  for (const c of r.configs) {
    if (!c || typeof c !== "object") return null;
    const rec = c as Record<string, unknown>;
    const norm = normalizeReviewerModel(rec.reviewerModel);
    if (typeof rec.id !== "string" || !rec.id.trim() || !norm) return null;
    configs.push({ id: (rec.id as string).trim(), reviewerModel: norm });
  }
  return { ...(r as Record<string, unknown>), configs };
}

/**
 * Parsea el JSON pegado en el lanzador y valida la forma mínima.
 * ok → summary con conteos (trials == llamadas LLM). Mensajes en español
 * accionables. Nunca throw.
 */
export function validateDefinitionInput(json: string): ValidateDefinitionResult {
  if (typeof json !== "string" || json.trim().length === 0) {
    return { ok: false, error: "pegá la definition JSON del benchmark primero" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `JSON inválido (${msg.slice(0, 120)}): revisá comas y comillas` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "la definition debe ser un objeto JSON con name, tasks, configs y repetitions" };
  }
  const r = parsed as Record<string, unknown>;

  const name = nonEmptyString(r.name);
  if (!name) {
    return { ok: false, error: 'falta "name": poné un nombre no vacío para el benchmark' };
  }

  if (!Array.isArray(r.tasks) || r.tasks.length === 0) {
    return {
      ok: false,
      error: 'faltan "tasks": agregá al menos 1 task con id, prompt y expectedVerdict',
    };
  }
  for (let i = 0; i < r.tasks.length; i++) {
    const t = r.tasks[i] as Record<string, unknown> | null;
    const where = `task #${i + 1}`;
    if (!t || typeof t !== "object") {
      return { ok: false, error: `${where}: tiene que ser un objeto con id, prompt y expectedVerdict` };
    }
    if (!nonEmptyString(t.id)) {
      return { ok: false, error: `${where}: falta "id" (poné un id no vacío)` };
    }
    if (!nonEmptyString(t.prompt)) {
      return { ok: false, error: `${where}: falta "prompt" (poné el prompt a evaluar)` };
    }
    // El backend exige ≥1 archivo por task (fixtures del trial).
    if (!Array.isArray(t.files) || t.files.length === 0) {
      return { ok: false, error: `${where}: faltan "files" (agregá al menos 1 {path, content})` };
    }
    for (let j = 0; j < (t.files as unknown[]).length; j++) {
      const f = (t.files as unknown[])[j] as Record<string, unknown> | null;
      if (!f || typeof f !== "object" || !nonEmptyString(f.path) || typeof f.content !== "string") {
        return { ok: false, error: `${where}: files[${j}] tiene que ser {path, content}` };
      }
    }
    // Espejo del tope del backend (máx 5 archivos por task): error temprano.
    if ((t.files as unknown[]).length > 5) {
      return { ok: false, error: `${where}: máximo 5 archivos por task (el backend lo exige)` };
    }
    if (
      typeof t.expectedVerdict !== "string" ||
      !(VALID_EXPECTED_VERDICTS as readonly string[]).includes(t.expectedVerdict)
    ) {
      return {
        ok: false,
        error: `${where}: "expectedVerdict" tiene que ser uno de: ${VALID_EXPECTED_VERDICTS.join(", ")}`,
      };
    }
  }

  if (!Array.isArray(r.configs) || r.configs.length === 0) {
    return {
      ok: false,
      error: 'faltan "configs": agregá al menos 1 config con id y reviewerModel',
    };
  }
  for (let i = 0; i < r.configs.length; i++) {
    const c = r.configs[i] as Record<string, unknown> | null;
    const where = `config #${i + 1}`;
    if (!c || typeof c !== "object") {
      return { ok: false, error: `${where}: tiene que ser un objeto con id y reviewerModel` };
    }
    if (!nonEmptyString(c.id)) {
      return { ok: false, error: `${where}: falta "id" (poné un id no vacío)` };
    }
    if (!normalizeReviewerModel(c.reviewerModel)) {
      return { ok: false, error: `${where}: "reviewerModel" tiene que ser "provider/model" o {providerID, modelID} (p. ej. "opencode/big-pickle")` };
    }
  }

  if (typeof r.repetitions !== "number" || !Number.isInteger(r.repetitions)) {
    return { ok: false, error: '"repetitions" tiene que ser un entero entre 1 y 3' };
  }
  if (r.repetitions < 1 || r.repetitions > 3) {
    return { ok: false, error: '"repetitions" tiene que ser un entero entre 1 y 3' };
  }

  const trials = (r.tasks as unknown[]).length * (r.configs as unknown[]).length * r.repetitions;
  if (trials > BENCHMARK_MAX_TRIALS) {
    return {
      ok: false,
      error: `el benchmark supera el cap de ${BENCHMARK_MAX_TRIALS} trials (${trials} = tasks × configs × repetitions): reducí tasks, configs o repetitions`,
    };
  }

  return {
    ok: true,
    summary: {
      name,
      tasks: (r.tasks as unknown[]).length,
      configs: (r.configs as unknown[]).length,
      repetitions: r.repetitions,
      trials,
    },
  };
}

// ---------------------------------------------------------------------------
// Builders de URLs (testeables, sin puertos hardcodeados: el port siempre
// viene de discoverFactoryPort en el componente)
// ---------------------------------------------------------------------------

export function benchmarksUrl(port: number): string {
  return `http://127.0.0.1:${port}/factory/benchmarks`;
}

export function benchmarkRunUrl(port: number, id: string): string {
  return `http://127.0.0.1:${port}/factory/benchmarks/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Parsers defensivos (nunca throw; lo desconocido → vacío)
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Lista de runs o [] si la forma es inesperada. */
export function parseRunsList(input: unknown): BenchmarkRunSummary[] {
  if (!input || typeof input !== "object") return [];
  const raw = (input as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return [];
  const out: BenchmarkRunSummary[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== "string" || rec.id.trim().length === 0) continue;
    out.push({
      id: rec.id.trim(),
      name: asString(rec.name, "sin nombre"),
      status: asString(rec.status, ""),
      createdAt: asString(rec.createdAt, ""),
      trials: asNumber(rec.trials, 0),
      configs: asNumber(rec.configs, 0),
    });
  }
  return out;
}

function parseTrial(v: unknown): BenchmarkTrial {
  const rec = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const scores: Record<string, BenchmarkTrialScore> = {};
  try {
    const raw = rec.scores;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, e] of Object.entries(raw as Record<string, unknown>)) {
        if (k.length === 0) continue;
        const er = e && typeof e === "object" ? (e as Record<string, unknown>) : null;
        if (!er || typeof er.label !== "string" || er.label.length === 0) continue;
        scores[k] = { label: er.label, passing: er.passing === true };
      }
    }
  } catch {
    // scores parciales: vale lo parseado
  }
  return {
    taskId: asString(rec.taskId, "—"),
    configId: asString(rec.configId, "—"),
    repetition: asNumber(rec.repetition, 0),
    verdict: asString(rec.verdict, "—"),
    confidence: asNumber(rec.confidence, NaN),
    findingsCount: asNumber(rec.findingsCount, 0),
    parseOk: rec.parseOk !== false,
    durationMs: asNumber(rec.durationMs, NaN),
    pass: rec.pass === true,
    scores,
  };
}

function parseConfigStat(v: unknown): BenchmarkConfigStat {
  const rec = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const scorePassRates: Record<string, number> = {};
  try {
    const raw = rec.scorePassRates;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, rate] of Object.entries(raw as Record<string, unknown>)) {
        if (k.length === 0) continue;
        if (typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 1) {
          scorePassRates[k] = rate;
        }
      }
    }
  } catch {
    // tasas parciales: vale lo parseado
  }
  return {
    trials: asNumber(rec.trials, 0),
    pass: asNumber(rec.pass, 0),
    passRate: asNumber(rec.passRate, NaN),
    avgDurationMs: asNumber(rec.avgDurationMs, NaN),
    parseErrors: asNumber(rec.parseErrors, 0),
    scorePassRates,
  };
}

/**
 * Run completo o null si la forma es inesperada (el panel muestra
 * "sin datos" en ese caso).
 */
export function parseRunDetail(input: unknown): BenchmarkRunDetail | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  if (typeof rec.id !== "string" || rec.id.trim().length === 0) return null;
  const trials: BenchmarkTrial[] = Array.isArray(rec.trials)
    ? rec.trials.map(parseTrial)
    : [];
  const stats: Record<string, BenchmarkConfigStat> = {};
  if (rec.stats && typeof rec.stats === "object" && !Array.isArray(rec.stats)) {
    for (const [k, v] of Object.entries(rec.stats as Record<string, unknown>)) {
      if (k.length > 0) stats[k] = parseConfigStat(v);
    }
  }
  return {
    id: rec.id.trim(),
    name: asString(rec.name, "sin nombre"),
    status: asString(rec.status, ""),
    createdAt: asString(rec.createdAt, ""),
    finishedAt: asString(rec.finishedAt, ""),
    trials,
    stats,
  };
}
