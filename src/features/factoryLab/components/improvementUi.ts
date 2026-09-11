/**
 * improvementUi — Ola 13 (Measure: Self-improvement).
 * Helpers puros (sin React) para el SelfImprovementPanel: badge de status,
 * gate de decisión, resúmenes defensivos, builders de URLs y parsers
 * defensivos del contrato del backend.
 *
 * Contrato (lo implementa otro ingeniero en paralelo; programar defensivo):
 * - GET /factory/improve/failures?scorer=NAME → {scorer, failures: [{workItemId,
 *   scorer, label, reason, at, promptPreview}]}; 400/404 con {error}.
 * - POST /factory/improve/proposals (body {scorer}) → 201 {id}.
 * - GET /factory/improve/proposals → {proposals: [{id, scorer, status, pattern,
 *   rationale, target, regressionsAddressed, createdAt, decidedAt?}]} (sin newContent).
 * - GET /factory/improve/proposals/:id → propuesta completa (+ newContent?,
 *   failureReason?, backupPath?).
 * - POST /factory/improve/proposals/:id/adopt → {ok:true, target, backup} (404/409).
 * - POST /factory/improve/proposals/:id/discard → {ok:true} (404/409).
 * - POST /factory/improve/proposals/:id/retry-analysis → {ok:true, proposal}
 *   solo si status=failed (resto → 409; 1 retry-analysis por propuesta).
 * - Status: pending|ready|failed|adopted|discarded.
 *
 * Todo campo ausente o forma inesperada → fallbacks ("sin datos"/"—"),
 * nunca throw. Tipos locales mínimos: NO importar tipos del backend que
 * todavía no existen en esta rama. CERO auto-adopt: este módulo solo
 * construye URLs/payloads, jamás dispara fetch.
 */

// ---------------------------------------------------------------------------
// Tipos locales mínimos (espejo del contrato, sin dependencia del backend)
// ---------------------------------------------------------------------------

/** Tono del badge de una propuesta según su status. */
export type ProposalBadgeTone = "blue" | "green" | "red" | "zinc" | "amber";

export interface ProposalStatusBadge {
  tone: ProposalBadgeTone;
  label: string;
}

export interface ProposalSummary {
  id: string;
  scorer: string;
  status: string;
  pattern: string;
  rationale: string;
  target: string;
  regressionsAddressed: string[];
  createdAt: string;
  decidedAt: string;
}

export interface ProposalDetail extends ProposalSummary {
  newContent: string;
  failureReason: string;
  backupPath: string;
}

export interface FailureItem {
  workItemId: string;
  scorer: string;
  label: string;
  reason: string;
  at: string;
  promptPreview: string;
}

/**
 * Scorers reales con failures analizables (espejo de `factory/scorers/`).
 * Solo sugerencias clickeables del selector (input libre): NO es lógica de
 * negocio, el backend valida el scorer y responde 400/404 si no existe.
 */
export const KNOWN_SCORERS: readonly string[] = [
  "review-formato-valido",
  "implement-scope-1-3",
  "verification-honesta",
];

/** Largo máximo de `regressionsSummary` (incluye el "…" de recorte). */
export const REGRESSIONS_SUMMARY_MAX = 120;

// ---------------------------------------------------------------------------
// Presentación pura
// ---------------------------------------------------------------------------

/**
 * Badge del status de una propuesta. Desconocido → zinc "—". Nunca throw.
 */
export function proposalStatusBadge(status: unknown): ProposalStatusBadge {
  if (status === "pending") return { tone: "blue", label: "analizando" };
  if (status === "ready") return { tone: "amber", label: "lista para revisar" };
  if (status === "failed") return { tone: "red", label: "falló" };
  if (status === "adopted") return { tone: "green", label: "adoptada" };
  if (status === "discarded") return { tone: "zinc", label: "descartada" };
  return { tone: "zinc", label: "—" };
}

/**
 * Solo una propuesta `ready` se puede adoptar o descartar (NADA sin review
 * humano, §2.4). Cualquier otro valor → false. Nunca throw.
 */
export function canDecide(status: unknown): boolean {
  return status === "ready";
}

/**
 * "N runs: id1, id2…". Vacío/inválido/sin ids útiles → "—". Acotado a
 * REGRESSIONS_SUMMARY_MAX chars (recorte con "…"). Nunca throw.
 */
export function regressionsSummary(ids: unknown): string {
  if (!Array.isArray(ids)) return "—";
  const clean: string[] = [];
  for (const v of ids) {
    if (typeof v === "string" && v.trim().length > 0) clean.push(v.trim());
  }
  if (clean.length === 0) return "—";
  const full = `${clean.length} ${clean.length === 1 ? "run" : "runs"}: ${clean.join(", ")}`;
  if (full.length <= REGRESSIONS_SUMMARY_MAX) return full;
  return `${full.slice(0, REGRESSIONS_SUMMARY_MAX - 1)}…`;
}

/**
 * Últimos 2 segmentos del path ("factory/scorers/x/scorer.md" → "x/scorer.md").
 * Acepta "/" y "\\". Vacío/inválido → "—". Nunca throw.
 */
export function targetShort(target: unknown): string {
  if (typeof target !== "string") return "—";
  const trimmed = target.trim();
  if (trimmed.length === 0) return "—";
  const parts = trimmed
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0];
  return parts.slice(-2).join("/");
}

/**
 * Fecha de la propuesta en formato local. Inválida/ausente → "—". Nunca throw.
 */
export function formatProposalDate(at: unknown): string {
  if (typeof at !== "string" || at.trim().length === 0) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Builders de URLs y payload (testeables, sin puertos hardcodeados: el port
// siempre viene de discoverFactoryPort en el componente)
// ---------------------------------------------------------------------------

export function proposalsUrl(port: number): string {
  return `http://127.0.0.1:${port}/factory/improve/proposals`;
}

export function proposalUrl(port: number, id: string): string {
  return `http://127.0.0.1:${port}/factory/improve/proposals/${encodeURIComponent(id)}`;
}

export function failuresUrl(port: number, scorer: string): string {
  return `http://127.0.0.1:${port}/factory/improve/failures?scorer=${encodeURIComponent(scorer)}`;
}

export function adoptUrl(port: number, id: string): string {
  return `${proposalUrl(port, id)}/adopt`;
}

export function discardUrl(port: number, id: string): string {
  return `${proposalUrl(port, id)}/discard`;
}

/** URL del POST de re-análisis (P4c; solo `failed` reintenta, resto 409). */
export function retryAnalysisUrl(port: number, id: string): string {
  return `${proposalUrl(port, id)}/retry-analysis`;
}

/** Body del POST de generación. Nunca throw (no-string → ""). */
export function proposePayload(scorer: unknown): { scorer: string } {
  return { scorer: typeof scorer === "string" ? scorer.trim() : "" };
}

// ---------------------------------------------------------------------------
// Parsers defensivos (nunca throw; lo desconocido → vacío)
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item.trim().length > 0) out.push(item.trim());
  }
  return out;
}

function parseProposalSummary(v: unknown): ProposalSummary | null {
  const rec = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!rec || typeof rec.id !== "string" || rec.id.trim().length === 0) return null;
  return {
    id: rec.id.trim(),
    scorer: asString(rec.scorer, "—"),
    status: asString(rec.status, ""),
    pattern: asString(rec.pattern, ""),
    rationale: asString(rec.rationale, ""),
    target: asString(rec.target, ""),
    regressionsAddressed: asStringArray(rec.regressionsAddressed),
    createdAt: asString(rec.createdAt, ""),
    decidedAt: asString(rec.decidedAt, ""),
  };
}

/** Lista de propuestas o [] si la forma es inesperada. */
export function parseProposalsList(input: unknown): ProposalSummary[] {
  if (!input || typeof input !== "object") return [];
  const raw = (input as { proposals?: unknown }).proposals;
  if (!Array.isArray(raw)) return [];
  const out: ProposalSummary[] = [];
  for (const item of raw) {
    const parsed = parseProposalSummary(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * Propuesta completa o null si la forma es inesperada (el panel muestra
 * "sin datos" en ese caso).
 */
export function parseProposalDetail(input: unknown): ProposalDetail | null {
  const base = parseProposalSummary(input);
  if (!base) return null;
  const rec = input as Record<string, unknown>;
  return {
    ...base,
    newContent: asString(rec.newContent, ""),
    failureReason: asString(rec.failureReason, ""),
    backupPath: asString(rec.backupPath, ""),
  };
}

/** Lista de failures o [] si la forma es inesperada. */
export function parseFailuresList(input: unknown): FailureItem[] {
  if (!input || typeof input !== "object") return [];
  const raw = (input as { failures?: unknown }).failures;
  if (!Array.isArray(raw)) return [];
  const out: FailureItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.workItemId !== "string" || rec.workItemId.trim().length === 0) continue;
    out.push({
      workItemId: rec.workItemId.trim(),
      scorer: asString(rec.scorer, "—"),
      label: asString(rec.label, "—"),
      reason: asString(rec.reason, "—"),
      at: asString(rec.at, ""),
      promptPreview: asString(rec.promptPreview, ""),
    });
  }
  return out;
}
