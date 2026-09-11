/**
 * scorersUi — Ola 11 (Measure: Scorers).
 * Helpers puros (sin React) para el ScorersPanel: tonos de badge, formatos,
 * builders de URLs/payloads y parsers defensivos del contrato del backend.
 *
 * Contrato (lo implementa otro ingeniero en paralelo; programar defensivo):
 * - GET /factory/scorers → {scorers: [{name, description, agents, labels,
 *   passingScore, samplingRate, model, selfImprovement}]}
 * - GET /factory/jobs/:id/scores → {workItemId, scores: {[name]: {label,
 *   score, passing, reason, model, origin: "sampled"|"manual", at}}}
 * - POST /factory/jobs/:id/scores/:name (body {}) → scoring manual {ok:true}
 * - GET /factory/scores/summary → {scorers: {[name]: {scored, passing,
 *   failing, passRate}}}
 *
 * Todo campo ausente o forma inesperada → fallbacks ("sin datos"/"—"),
 * nunca throw. Tipos locales mínimos: NO importar tipos del backend que
 * todavía no existen en esta rama.
 */

// ---------------------------------------------------------------------------
// Tipos locales mínimos (espejo del contrato, sin dependencia del backend)
// ---------------------------------------------------------------------------

export type ScoreBadgeTone = "green" | "red" | "zinc";

export interface ScorerLabelDef {
  value: string;
  score: number;
  description?: string;
}

export interface ScorerDef {
  name: string;
  description: string;
  agents: string[];
  labels: ScorerLabelDef[];
  passingScore: number;
  samplingRate: number;
  model: string;
  selfImprovement: boolean;
}

export interface ScorerSummaryStat {
  scored: number;
  passing: number;
  failing: number;
  passRate: number;
}

export interface JobScoreEntry {
  label: string;
  score: number;
  passing: boolean;
  reason: string;
  model: string;
  origin: string;
  at: string;
}

export interface JobScores {
  workItemId: string;
  scores: Record<string, JobScoreEntry>;
}

// ---------------------------------------------------------------------------
// Presentación pura
// ---------------------------------------------------------------------------

/**
 * Tono del badge de un score: passing→green, fail→red, sin score
 * (null/undefined) → zinc. Nunca throw.
 */
export function scoreBadgeTone(passing: boolean | null | undefined): ScoreBadgeTone {
  if (passing === true) return "green";
  if (passing === false) return "red";
  return "zinc";
}

/**
 * "NN% (p/scored)". "—" si null o scored=0/inválido. Nunca throw.
 */
export function formatPassRate(
  s: { scored: number; passing: number } | null | undefined,
): string {
  if (!s || typeof s !== "object") return "—";
  const scored = (s as { scored?: unknown }).scored;
  const passing = (s as { passing?: unknown }).passing;
  if (typeof scored !== "number" || !Number.isFinite(scored) || scored <= 0) return "—";
  const p = typeof passing === "number" && Number.isFinite(passing) && passing >= 0 ? passing : 0;
  const pct = Math.round((p / scored) * 100);
  return `${pct}% (${p}/${scored})`;
}

/**
 * "muestra" para sampled, "manual" para manual, "—" para el resto.
 * Acepta unknown porque el backend puede traer cualquier cosa.
 */
export function originLabel(origin: unknown): string {
  if (origin === "sampled") return "muestra";
  if (origin === "manual") return "manual";
  return "—";
}

/**
 * "modelo · sample N% · umbral X", con "—" por campo ausente/inválido.
 */
export function scorerSubtitle(
  scorer: { model?: unknown; samplingRate?: unknown; passingScore?: unknown } | null | undefined,
): string {
  const model =
    scorer && typeof scorer.model === "string" && scorer.model.trim().length > 0
      ? scorer.model.trim()
      : "—";
  const rate =
    scorer && typeof scorer.samplingRate === "number" && Number.isFinite(scorer.samplingRate)
      ? `${scorer.samplingRate}%`
      : "—";
  const threshold =
    scorer && typeof scorer.passingScore === "number" && Number.isFinite(scorer.passingScore)
      ? String(scorer.passingScore)
      : "—";
  return `${model} · sample ${rate} · umbral ${threshold}`;
}

export const SCORE_REASON_MAX = 160;

/**
 * Recorta el reason a `max` chars con "…". Vacío/no-string → "—".
 */
export function truncateReason(reason: unknown, max: number = SCORE_REASON_MAX): string {
  if (typeof reason !== "string" || reason.trim().length === 0) return "—";
  const t = reason.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/**
 * Fecha del score en formato local. Inválida/ausente → "—".
 */
export function formatScoreDate(at: unknown): string {
  if (typeof at !== "string" || at.trim().length === 0) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Builders de URLs/payloads (testeables, sin puertos hardcodeados: el port
// siempre viene de discoverFactoryPort en el componente)
// ---------------------------------------------------------------------------

export function scorersUrl(port: number): string {
  return `http://127.0.0.1:${port}/factory/scorers`;
}

export function scoresSummaryUrl(port: number): string {
  return `http://127.0.0.1:${port}/factory/scores/summary`;
}

export function jobScoresUrl(port: number, workItemId: string): string {
  return `http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(workItemId)}/scores`;
}

export function manualScoreUrl(port: number, workItemId: string, scorerName: string): string {
  return `http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(workItemId)}/scores/${encodeURIComponent(scorerName)}`;
}

/** Body del scoring manual: siempre `{}` (fire-and-forget). */
export function manualScorePayload(): Record<string, unknown> {
  return {};
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

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function parseScorerLabel(v: unknown): ScorerLabelDef | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.value !== "string" || r.value.trim().length === 0) return null;
  if (typeof r.score !== "number" || !Number.isFinite(r.score)) return null;
  const out: ScorerLabelDef = { value: r.value.trim(), score: r.score };
  if (typeof r.description === "string" && r.description.trim().length > 0) {
    out.description = r.description.trim().slice(0, 300);
  }
  return out;
}

/** Lista de scorers o [] si la forma es inesperada. */
export function parseScorersList(input: unknown): ScorerDef[] {
  if (!input || typeof input !== "object") return [];
  const raw = (input as { scorers?: unknown }).scorers;
  if (!Array.isArray(raw)) return [];
  const out: ScorerDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name.trim().length === 0) continue;
    const labels: ScorerLabelDef[] = [];
    if (Array.isArray(r.labels)) {
      for (const l of r.labels) {
        const parsed = parseScorerLabel(l);
        if (parsed) labels.push(parsed);
      }
    }
    out.push({
      name: r.name.trim(),
      description: asString(r.description, ""),
      agents: asStringList(r.agents),
      labels,
      passingScore: asNumber(r.passingScore, NaN),
      samplingRate: asNumber(r.samplingRate, NaN),
      model: asString(r.model, ""),
      selfImprovement: r.selfImprovement === true,
    });
  }
  return out;
}

function parseJobScoreEntry(v: unknown): JobScoreEntry {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    label: asString(r.label, ""),
    score: asNumber(r.score, NaN),
    passing: r.passing === true,
    reason: asString(r.reason, ""),
    model: asString(r.model, ""),
    origin: asString(r.origin, ""),
    at: asString(r.at, ""),
  };
}

/** Scores de un job; forma inesperada → {workItemId: "", scores: {}}. */
export function parseJobScores(input: unknown): JobScores {
  if (!input || typeof input !== "object") return { workItemId: "", scores: {} };
  const r = input as Record<string, unknown>;
  const scores: Record<string, JobScoreEntry> = {};
  if (r.scores && typeof r.scores === "object" && !Array.isArray(r.scores)) {
    for (const [k, v] of Object.entries(r.scores as Record<string, unknown>)) {
      if (typeof k === "string" && k.length > 0) scores[k] = parseJobScoreEntry(v);
    }
  }
  return { workItemId: asString(r.workItemId, ""), scores };
}

/** Baseline por scorer; forma inesperada → {}. */
export function parseScoresSummary(input: unknown): Record<string, ScorerSummaryStat> {
  if (!input || typeof input !== "object") return {};
  const raw = (input as { scorers?: unknown }).scorers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ScorerSummaryStat> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    out[k] = {
      scored: asNumber(r.scored, 0),
      passing: asNumber(r.passing, 0),
      failing: asNumber(r.failing, 0),
      passRate: asNumber(r.passRate, NaN),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agrupación/filtrado por rol (Ola 18 P1.5/P1.6, E2 — aditivo)
// ---------------------------------------------------------------------------

/**
 * Orden canónico de roles para agrupar (espejo del vocabulario CERRADO de
 * `shared/types/scorer.ts`, NO son nombres de scorers: ningún default depende
 * de cuántos scorers haya ni de cómo se llamen). Nunca throw.
 */
export const SCORER_ROLE_ORDER: readonly string[] = [
  "implement",
  "review",
  "verification",
  "triage",
  "spec",
  "foreman",
];

/** Rol primario de un scorer: su primer agent, o "sin rol" si no declara. */
export function primaryScorerRole(
  scorer: { agents?: unknown } | null | undefined,
): string {
  try {
    const agents = scorer?.agents;
    if (Array.isArray(agents)) {
      for (const a of agents) {
        if (typeof a === "string" && a.trim().length > 0) return a.trim();
      }
    }
    return "sin rol";
  } catch {
    return "sin rol";
  }
}

/**
 * Roles presentes (unión de `agents`) en orden canónico; los roles fuera del
 * vocabulario (el backend hoy es cerrado, pero programar defensivo) van al
 * final en alfa, y "sin rol" último si algún scorer no declara agents.
 * [] si no hay scorers. Nunca throw.
 */
export function scorerRolesPresent(
  scorers: ScorerDef[] | null | undefined,
): string[] {
  try {
    if (!Array.isArray(scorers)) return [];
    const seen = new Set<string>();
    for (const s of scorers) {
      if (!s || typeof s !== "object") continue;
      const agents = Array.isArray(s.agents) ? s.agents : [];
      if (agents.length === 0) {
        seen.add("sin rol");
        continue;
      }
      for (const a of agents) {
        if (typeof a === "string" && a.trim().length > 0) seen.add(a.trim());
      }
    }
    const order = new Map(SCORER_ROLE_ORDER.map((r, i) => [r, i]));
    return [...seen].sort((a, b) => {
      const ai = order.has(a) ? (order.get(a) as number) : SCORER_ROLE_ORDER.length;
      const bi = order.has(b) ? (order.get(b) as number) : SCORER_ROLE_ORDER.length;
      if (a === "sin rol") return 1;
      if (b === "sin rol") return -1;
      if (ai !== bi) return ai - bi;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  } catch {
    return [];
  }
}

/**
 * Filtra scorers por rol (`"todos"` → copia tal cual). Matchea CUALQUIER
 * agent del scorer (un scorer multi-rol aparece en cada uno de sus roles).
 * Rol vacío/desconocido (que no sea "todos") → []. Nunca throw.
 */
export function filterScorersByRole(
  scorers: ScorerDef[] | null | undefined,
  role: unknown,
): ScorerDef[] {
  try {
    if (!Array.isArray(scorers)) return [];
    if (role === "todos") return [...scorers];
    if (typeof role !== "string" || role.trim().length === 0) return [];
    const want = role.trim();
    return scorers.filter(
      (s) =>
        s &&
        typeof s === "object" &&
        Array.isArray(s.agents) &&
        (s.agents as unknown[]).includes(want),
    );
  } catch {
    return [];
  }
}

/**
 * Agrupa scorers por rol primario (ver `primaryScorerRole`): cada scorer
 * aparece en UN solo grupo (el filtro, en cambio, matchea cualquier agent).
 * Grupos en orden canónico (`scorerRolesPresent` sobre los primarios).
 * Nunca throw.
 */
export function groupScorersByRole(
  scorers: ScorerDef[] | null | undefined,
): Array<{ role: string; scorers: ScorerDef[] }> {
  try {
    if (!Array.isArray(scorers) || scorers.length === 0) return [];
    const buckets = new Map<string, ScorerDef[]>();
    for (const s of scorers) {
      if (!s || typeof s !== "object") continue;
      const role = primaryScorerRole(s);
      if (!buckets.has(role)) buckets.set(role, []);
      (buckets.get(role) as ScorerDef[]).push(s);
    }
    const order = new Map(SCORER_ROLE_ORDER.map((r, i) => [r, i]));
    const rank = (r: string): number =>
      r === "sin rol" ? Number.MAX_SAFE_INTEGER : (order.has(r) ? (order.get(r) as number) : SCORER_ROLE_ORDER.length);
    return [...buckets.entries()]
      .sort((a, b) => {
        const ra = rank(a[0]);
        const rb = rank(b[0]);
        if (ra !== rb) return ra - rb;
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      })
      .map(([role, list]) => ({ role, scorers: list }));
  } catch {
    return [];
  }
}
