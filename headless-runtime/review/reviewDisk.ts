/**
 * ReviewDisk — Ola 4.
 * Persiste review.json (último) + review-{attempt}.json (historial) atómico tmp→rename.
 * Layout: {worktree}/.agents/factory/{id}/review.json
 */

import fs from "node:fs";
import path from "node:path";
import { ReviewResultSchema, type ReviewResult } from "../../shared/types/review";

function writeAtomicJson(target: string, payload: unknown): void {
  const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

/**
 * Escribe review.json + historial. Valida con zod antes de escribir.
 */
export function writeReviewJsonAtomic(dir: string, result: ReviewResult): ReviewResult {
  const validated = ReviewResultSchema.parse(result);
  writeAtomicJson(path.join(dir, "review.json"), validated);
  try {
    writeAtomicJson(path.join(dir, `review-${validated.reviewAttempt}.json`), validated);
  } catch {}
  return validated;
}

/**
 * Lee review.json. Null si no existe o inválido.
 */
export function readReviewJson(dir: string): ReviewResult | null {
  const target = path.join(dir, "review.json");
  if (!fs.existsSync(target)) return null;
  try {
    const raw = fs.readFileSync(target, "utf-8");
    return ReviewResultSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Lee historial review-{attempt}.json si existe.
 */
export function readReviewAttemptJson(dir: string, attempt: number): ReviewResult | null {
  const target = path.join(dir, `review-${attempt}.json`);
  if (!fs.existsSync(target)) return null;
  try {
    const raw = fs.readFileSync(target, "utf-8");
    return ReviewResultSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Tope del raw persistido: 64KB (diagnóstico sin inflar disco). */
export const REVIEW_RAW_MAX_BYTES = 64 * 1024;

/**
 * Persiste la respuesta cruda del revisor para diagnóstico (Ola 5 Review blindado).
 * Escribe `review-raw-{attempt}.txt` acotado a 64KB, atómico tmp→rename.
 * Best-effort: si raw es null o falla el disco, NO lanza.
 */
export function writeReviewRawAtomic(dir: string, attempt: number, raw: string | null): void {
  if (raw == null) return;
  try {
    const safeAttempt = Math.min(Math.max(1, Math.floor(attempt)), 3);
    const capped = raw.length > REVIEW_RAW_MAX_BYTES ? raw.slice(0, REVIEW_RAW_MAX_BYTES) : raw;
    const target = path.join(dir, `review-raw-${safeAttempt}.txt`);
    const tmp = `${target}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(tmp, capped, "utf-8");
      fs.renameSync(tmp, target);
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  } catch {}
}
