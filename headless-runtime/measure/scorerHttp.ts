/**
 * ScorerHttp — Ola 11 Measure.
 * Parseo y guards puros de los 4 endpoints de scorers (testeables sin server
 * vivo). Espejo del estilo de `reviewRaw`/`specFlow`/`factoryServer`:
 * split("/").filter(Boolean), alias work-items (len distinto) vs factory,
 * `isSafeJobId` contra traversal. Nunca lanzan.
 */

import { isSafeJobId } from "../factory/reviewRaw";

export type ScoresGetPathOk = { id: string; isWorkItemsAlias: boolean };
export type ScoresGetPathErr = { error: string };

/**
 * Parsea el pathname de GET .../scores (lista scores de un job).
 * - `/factory/jobs/:id/scores` (len 4) + alias `/work-items/:id/scores` (len 3).
 * - NO matchea POST `.../scores/:name` (contiene `/scores/` intermedio).
 */
export function parseScoresGetPath(
  pathname: unknown,
): ScoresGetPathOk | ScoresGetPathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  const isFactory = pathname.startsWith("/factory/jobs/");
  const isAlias = pathname.startsWith("/work-items/");
  if (!isFactory && !isAlias) return { error: "not scores route" };
  if (!pathname.endsWith("/scores")) return { error: "not scores route" };
  if (pathname.includes("/scores/")) return { error: "not scores route" };
  const parts = pathname.split("/").filter(Boolean);
  const expectedLen = isAlias ? 3 : 4;
  if (parts.length !== expectedLen) {
    return { error: "unexpected path length for scores" };
  }
  if (parts[expectedLen - 1] !== "scores") {
    return { error: "not scores route" };
  }
  const id = isAlias ? parts[1] : parts[2];
  if (!id || id === "scores") {
    return { error: "missing id for scores" };
  }
  if (!isSafeJobId(id)) {
    return { error: `invalid id: ${String(id).slice(0, 60)}` };
  }
  return { id, isWorkItemsAlias: isAlias };
}

export type ManualScorePathOk = {
  id: string;
  scorer: string;
  isWorkItemsAlias: boolean;
};
export type ManualScorePathErr = { error: string };

function isSafeScorerName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 64) return false;
  if (!/^[a-z0-9-]+$/i.test(value)) return false;
  if (value.includes("..")) return false;
  return true;
}

/**
 * Parsea el pathname de POST .../scores/:name (scoring manual).
 * - `/factory/jobs/:id/scores/:name` (len 5) + alias `/work-items/:id/scores/:name` (len 4).
 * - Rechaza traversal tanto en id como en scorer.
 */
export function parseManualScorePath(
  pathname: unknown,
): ManualScorePathOk | ManualScorePathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  const isFactory = pathname.startsWith("/factory/jobs/");
  const isAlias = pathname.startsWith("/work-items/");
  if (!isFactory && !isAlias) return { error: "not manual-score route" };
  if (!pathname.includes("/scores/")) return { error: "not manual-score route" };
  const parts = pathname.split("/").filter(Boolean);
  const expectedLen = isAlias ? 4 : 5;
  if (parts.length !== expectedLen) {
    return { error: "unexpected path length for manual score" };
  }
  const scoresIdx = expectedLen - 2;
  if (parts[scoresIdx] !== "scores") {
    return { error: "not manual-score route" };
  }
  const id = isAlias ? parts[1] : parts[2];
  const scorer = parts[expectedLen - 1];
  if (!id || id === "scores") {
    return { error: "missing id for manual score" };
  }
  if (!scorer || scorer === "scores") {
    return { error: "missing scorer for manual score" };
  }
  if (!isSafeJobId(id)) {
    return { error: `invalid id: ${String(id).slice(0, 60)}` };
  }
  if (!isSafeScorerName(scorer)) {
    return { error: `invalid scorer: ${String(scorer).slice(0, 60)}` };
  }
  return { id, scorer, isWorkItemsAlias: isAlias };
}

export type ManualScoreGuardOk = { ok: true };
export type ManualScoreGuardErr = {
  ok: false;
  code: 404 | 409;
  error: string;
};
export type ManualScoreGuard = ManualScoreGuardOk | ManualScoreGuardErr;

/**
 * Guards puros de POST .../scores/:name:
 * - 404 si no existe el job.
 * - 404 si el scorer no existe o es inválido.
 * - 409 si el job no tiene inputs mínimos (sin createdFiles ni verification).
 */
export function checkManualScoreGuards(
  jobExists: unknown,
  scorerExists: unknown,
  hasMinimumInputs: unknown,
  idForMsg = "",
  scorerForMsg = "",
): ManualScoreGuard {
  const suffix = idForMsg ? `: ${idForMsg}` : "";
  if (!jobExists) {
    return { ok: false, code: 404, error: `job not found${suffix}` };
  }
  if (!scorerExists) {
    const sSuffix = scorerForMsg ? `: ${scorerForMsg}` : suffix;
    return { ok: false, code: 404, error: `scorer not found${sSuffix}` };
  }
  if (hasMinimumInputs !== true) {
    return {
      ok: false,
      code: 409,
      error: `job sin inputs mínimos para scoring (sin createdFiles ni verification)${suffix}`,
    };
  }
  return { ok: true };
}

/**
 * True si es GET /factory/scorers (lista global, sin alias work-items).
 * Puro, nunca lanza.
 */
export function isScorersListPath(pathname: unknown, method: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/scorers";
  } catch {
    return false;
  }
}

/**
 * True si es GET /factory/scores/summary (global, sin alias).
 * Puro, nunca lanza.
 */
export function isScoresSummaryPath(pathname: unknown, method: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/scores/summary";
  } catch {
    return false;
  }
}

export type ManualScoreApplicabilityOk = { ok: true };
export type ManualScoreApplicabilityErr = {
  ok: false;
  code: 409;
  error: string;
};
export type ManualScoreApplicability =
  | ManualScoreApplicabilityOk
  | ManualScoreApplicabilityErr;

/**
 * Guard puro del 409 honesto de scoring manual fuera de alcance
 * (Ola 18 P1.5/P1.6, E2): el job todavía no alcanzó la etapa de ninguno de
 * los roles del scorer. El server lo alimenta con `scorerAppliesTo` +
 * `scorerRequiredStages` de scorerEngine (mapeo job→stages vía
 * `stagesForInputs` sobre los inputs ya colectados: review = tiene
 * lastReview/review.json, implement = createdFiles no vacío, verification =
 * tiene verification). Nunca lanza.
 */
export function checkManualScoreApplicability(
  applies: unknown,
  requiredStages: unknown,
): ManualScoreApplicability {
  try {
    if (applies === true) return { ok: true };
    const stages = (
      Array.isArray(requiredStages) ? requiredStages : []
    ).filter((s): s is string => typeof s === "string" && s.length > 0);
    const need = stages.length > 0 ? stages.join("+") : "su etapa";
    return {
      ok: false,
      code: 409,
      error: `este scorer no aplica a este job todavía (requiere etapa: ${need})`,
    };
  } catch {
    return {
      ok: false,
      code: 409,
      error: "este scorer no aplica a este job todavía (requiere etapa: su etapa)",
    };
  }
}
