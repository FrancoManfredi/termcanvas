/**
 * ImprovementHttp — Ola 13 Self-improvement.
 * Parseo y guards puros de los 6 endpoints de improve (testeables sin server
 * vivo). Espejo del estilo de `scorerHttp`/`benchmarkHttp`: match exacto para
 * las globales, split("/").filter(Boolean) para las parametrizadas,
 * allowlist anti-traversal. Rutas globales, sin alias work-items.
 * Nunca lanzan (devuelven `{ error }` o `{ ok: false }`).
 */

import type { ImprovementProposal } from "../../shared/types/improvement";

/** Ids reservados que nunca son una propuesta válida en ruta. */
const PROPOSAL_RESERVED_IDS = new Set([
  "proposals",
  "adopt",
  "discard",
  "retry-analysis",
  "failures",
]);

/**
 * Tope de re-análisis por propuesta (P4c retry-analysis, fila M09 de
 * docs/LOOPS.md): 1 retry-analysis por propuesta. Solo `status=failed`
 * reintenta; el resto → 409 sin tocar el análisis.
 */
export const RETRY_ANALYSIS_MAX = 1;

/**
 * Verifica que un id de propuesta sea seguro para rutas y path.join.
 * Espejo de `isSafeBenchmarkRunId`: rechaza vacío, `.`, `..`, `/`, `\`,
 * NUL, traversal codificado y reservados. Un id seguro pero inexistente
 * es 404, no 400.
 */
export function isSafeProposalId(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > 128) return false;
    if (id.trim().length === 0) return false;
    if (id === "." || id === "..") return false;
    if (id.includes("..")) return false;
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
    if (PROPOSAL_RESERVED_IDS.has(id)) return false;
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) {
        if (decoded.includes("..")) return false;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return false;
        if (decoded === "." || decoded === "..") return false;
        if (PROPOSAL_RESERVED_IDS.has(decoded)) return false;
      }
    } catch {
      if (id.includes("%")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * True si es GET /factory/improve/failures exacto (el scorer viaja en query).
 * Puro, nunca lanza.
 */
export function isFailuresPath(pathname: unknown, method: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/improve/failures";
  } catch {
    return false;
  }
}

/**
 * True si es GET /factory/improve/proposals exacto (lista de resúmenes).
 * Puro, nunca lanza.
 */
export function isProposalsListPath(pathname: unknown, method: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/improve/proposals";
  } catch {
    return false;
  }
}

/**
 * True si es POST /factory/improve/proposals exacto (crea + analiza async).
 * Puro, nunca lanza.
 */
export function isProposalsCreatePath(pathname: unknown, method: unknown): boolean {
  try {
    return method === "POST" && pathname === "/factory/improve/proposals";
  } catch {
    return false;
  }
}

export type ProposalGetPathOk = { id: string };
export type ProposalGetPathErr = { error: string };

/**
 * Parsea el pathname de GET /factory/improve/proposals/:id (completa).
 * Exactamente 4 segmentos; la lista (len 3) NO matchea.
 */
export function parseProposalGetPath(
  pathname: unknown,
): ProposalGetPathOk | ProposalGetPathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  if (!pathname.startsWith("/factory/improve/proposals/")) {
    return { error: "not proposal route" };
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 4) {
    return { error: "unexpected path length for proposal" };
  }
  if (parts[0] !== "factory" || parts[1] !== "improve" || parts[2] !== "proposals") {
    return { error: "not proposal route" };
  }
  const id = parts[3];
  if (!id) return { error: "missing id for proposal" };
  if (!isSafeProposalId(id)) {
    return { error: `invalid id: ${String(id).slice(0, 60)}` };
  }
  return { id };
}

export type ProposalActionPathOk = { id: string; action: "adopt" | "discard" };
export type ProposalActionPathErr = { error: string };

/**
 * Parsea el pathname de POST .../proposals/:id/adopt|discard.
 * Exactamente 5 segmentos con la acción al final.
 */
export function parseProposalActionPath(
  pathname: unknown,
  action: "adopt" | "discard",
): ProposalActionPathOk | ProposalActionPathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  if (!pathname.startsWith("/factory/improve/proposals/")) {
    return { error: "not proposal action route" };
  }
  if (!pathname.endsWith(`/${action}`)) {
    return { error: "not proposal action route" };
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 5) {
    return { error: "unexpected path length for proposal action" };
  }
  if (parts[0] !== "factory" || parts[1] !== "improve" || parts[2] !== "proposals") {
    return { error: "not proposal action route" };
  }
  const id = parts[3];
  if (!id || !isSafeProposalId(id)) {
    return { error: `invalid id: ${String(id ?? "").slice(0, 60)}` };
  }
  return { id, action };
}

// ── Validación de query/body (400) ──

export type ImproveScorerParamOk = { scorer: string };
export type ImproveScorerParamErr = { error: string; code: 400 };

/**
 * Valida el query `?scorer=NAME`: ausente/vacío/malformado → 400.
 * Un nombre bien formado pero inexistente es 404 (lo decide el endpoint
 * vía loadScorer, no esta pura).
 */
export function validateImproveScorerParam(
  scorer: unknown,
): ImproveScorerParamOk | ImproveScorerParamErr {
  try {
    if (typeof scorer !== "string" || scorer.trim().length === 0) {
      return { error: "query scorer requerido (?scorer=NAME)", code: 400 };
    }
    const clean = scorer.trim();
    if (clean.length > 64 || !/^[a-z0-9-]+$/i.test(clean)) {
      return { error: `scorer inválido: ${clean.slice(0, 60)}`, code: 400 };
    }
    return { scorer: clean };
  } catch {
    return { error: "query scorer inválido", code: 400 };
  }
}

export type CreateProposalBodyOk = { scorer: string };
export type CreateProposalBodyErr = { error: string; code: 400 };

/**
 * Valida el body `{scorer}` de POST /factory/improve/proposals.
 * Body no-objeto o scorer ausente/malformado → 400.
 */
export function checkCreateProposalBody(
  body: unknown,
): CreateProposalBodyOk | CreateProposalBodyErr {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { error: "body debe ser JSON {scorer}", code: 400 };
    }
    const scorer = (body as Record<string, unknown>).scorer;
    if (typeof scorer !== "string" || scorer.trim().length === 0) {
      return { error: "body.scorer requerido", code: 400 };
    }
    const clean = scorer.trim();
    if (clean.length > 64 || !/^[a-z0-9-]+$/i.test(clean)) {
      return { error: `body.scorer inválido: ${clean.slice(0, 60)}`, code: 400 };
    }
    return { scorer: clean };
  } catch {
    return { error: "body inválido", code: 400 };
  }
}

// ── Guards de estado (404/409, los usa el engine y el server) ──

export type ProposalGuardOk = { ok: true };
export type ProposalGuardErr = { ok: false; code: 404 | 409; error: string };
export type ProposalGuard = ProposalGuardOk | ProposalGuardErr;

/**
 * Guards puros de POST .../:id/adopt: 404 si no existe, 409 si no está ready.
 */
export function checkAdoptGuards(
  proposal: Pick<ImprovementProposal, "status"> | null | undefined,
  idForMsg = "",
): ProposalGuard {
  const suffix = idForMsg ? `: ${idForMsg}` : "";
  if (!proposal) {
    return { ok: false, code: 404, error: `proposal not found${suffix}` };
  }
  const status = typeof proposal.status === "string" ? proposal.status : "";
  if (status !== "ready") {
    return {
      ok: false,
      code: 409,
      error: `proposal not adoptable (status=${status || "?"})${suffix}`,
    };
  }
  return { ok: true };
}

/**
 * Guards puros de POST .../:id/discard: 404 si no existe, 409 si no está ready.
 */
export function checkDiscardGuards(
  proposal: Pick<ImprovementProposal, "status"> | null | undefined,
  idForMsg = "",
): ProposalGuard {
  const suffix = idForMsg ? `: ${idForMsg}` : "";
  if (!proposal) {
    return { ok: false, code: 404, error: `proposal not found${suffix}` };
  }
  const status = typeof proposal.status === "string" ? proposal.status : "";
  if (status !== "ready") {
    return {
      ok: false,
      code: 409,
      error: `proposal not discardable (status=${status || "?"})${suffix}`,
    };
  }
  return { ok: true };
}

export type ProposalRetryAnalysisPathOk = { id: string };
export type ProposalRetryAnalysisPathErr = { error: string };

/**
 * Parsea el pathname de POST /factory/improve/proposals/:id/retry-analysis.
 * Exactamente 5 segmentos con el sufijo `retry-analysis` al final (espejo de
 * `parseProposalActionPath`, acción fija en vez de parámetro).
 * Puro, nunca lanza.
 */
export function parseProposalRetryAnalysisPath(
  pathname: unknown,
): ProposalRetryAnalysisPathOk | ProposalRetryAnalysisPathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  if (!pathname.startsWith("/factory/improve/proposals/")) {
    return { error: "not proposal retry-analysis route" };
  }
  if (!pathname.endsWith("/retry-analysis")) {
    return { error: "not proposal retry-analysis route" };
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 5) {
    return { error: "unexpected path length for proposal retry-analysis" };
  }
  if (parts[0] !== "factory" || parts[1] !== "improve" || parts[2] !== "proposals") {
    return { error: "not proposal retry-analysis route" };
  }
  const id = parts[3];
  if (!id || !isSafeProposalId(id)) {
    return { error: `invalid id: ${String(id ?? "").slice(0, 60)}` };
  }
  return { id };
}

/**
 * Guards puros de POST .../:id/retry-analysis (P4c, espejo de
 * `checkRetryReviewGuards`: solo re-corre el análisis, nunca decide):
 * - 404 si no existe la propuesta.
 * - 409 si status !== "failed" (ready/adopted/discarded/pending jamás se
 *   re-analizan: un re-análisis sobre una propuesta decidida inventaría
 *   historia).
 * - 409 si ya consumió `RETRY_ANALYSIS_MAX` (1 retry-analysis por propuesta).
 * Nunca lanza.
 */
export function checkRetryAnalysisGuards(
  proposal: (Pick<ImprovementProposal, "status"> & { retryCount?: unknown }) | null | undefined,
  idForMsg = "",
): ProposalGuard {
  const suffix = idForMsg ? `: ${idForMsg}` : "";
  if (!proposal) {
    return { ok: false, code: 404, error: `proposal not found${suffix}` };
  }
  const status = typeof proposal.status === "string" ? proposal.status : "";
  if (status !== "failed") {
    return {
      ok: false,
      code: 409,
      error: `proposal not retryable (status=${status || "?"})${suffix}`,
    };
  }
  let used = 0;
  try {
    const raw = (proposal as { retryCount?: unknown }).retryCount;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) used = raw;
  } catch {
    used = 0;
  }
  if (used >= RETRY_ANALYSIS_MAX) {
    return {
      ok: false,
      code: 409,
      error: `proposal retry-analysis budget reached (retryCount=${used})${suffix}`,
    };
  }
  return { ok: true };
}
