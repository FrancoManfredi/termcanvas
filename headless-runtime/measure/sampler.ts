/**
 * Sampler — Ola 11 Measure.
 * Elegibilidad + muestreo determinístico estilo Warp (default 25%).
 * Todo puro salvo `isJobEligibleForScoring` (lee store+disco best-effort).
 * Nunca lanza.
 */

import fs from "node:fs";
import path from "node:path";
import { workItemStore } from "../workItem/workItemStore";

/**
 * Hash FNV-1a 32-bit de un id, reducido a 0..99.
 * Determinístico entre procesos: el mismo id siempre da el mismo bucket,
 * así el sampling es estable y testeable.
 */
export function hashJobIdForSampling(id: string): number {
  try {
    const s = String(id ?? "");
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) % 100;
  } catch {
    return 0;
  }
}

/**
 * ¿Este job cae en la muestra para este samplingRate?
 * - rate <= 0 → false siempre (solo scoring manual).
 * - rate >= 100 → true siempre.
 * - si no: `hash(id) % 100 < rate`.
 * Rate inválido → false (nunca auto-scoring por duda). Nunca lanza.
 */
export function shouldSampleJob(id: string, samplingRate: number): boolean {
  try {
    if (typeof id !== "string" || id.length === 0) return false;
    if (typeof samplingRate !== "number" || !Number.isInteger(samplingRate)) {
      return false;
    }
    if (samplingRate <= 0) return false;
    if (samplingRate >= 100) return true;
    return hashJobIdForSampling(id) < samplingRate;
  } catch {
    return false;
  }
}

export interface ScoringEligibilityInputs {
  hasResultJson: boolean;
  hasVerification: boolean;
}

/**
 * Elegible = el job tiene `result.json` o verificación en el timeline.
 * Sin evidencia no hay nada que juzgar. Puro, nunca lanza.
 */
export function isEligibleScoringInputs(
  input: ScoringEligibilityInputs | null | undefined,
): boolean {
  try {
    if (!input || typeof input !== "object") return false;
    return input.hasResultJson === true || input.hasVerification === true;
  } catch {
    return false;
  }
}

/**
 * Elegibilidad real de un job (store + disco, best-effort):
 * `result.json` existe en el dir del job o hay `verification` en la meta
 * del timeline. False si el job no existe. Nunca lanza.
 */
export function isJobEligibleForScoring(workItemId: string): boolean {
  try {
    if (typeof workItemId !== "string" || workItemId.length === 0) {
      return false;
    }
    const wi = workItemStore.get(workItemId);
    if (!wi) return false;
    try {
      const dir = wi.dir as string | null | undefined;
      if (typeof dir === "string" && dir.length > 0) {
        if (fs.existsSync(path.join(dir, "result.json"))) return true;
      }
    } catch {
      // sigue a timeline
    }
    try {
      const timeline = Array.isArray(wi.timeline) ? wi.timeline : [];
      for (let i = timeline.length - 1; i >= 0; i--) {
        const meta = timeline[i]?.meta as Record<string, unknown> | undefined;
        if (!meta || typeof meta !== "object") continue;
        const verification = meta.verification as
          | Record<string, unknown>
          | undefined;
        if (
          verification &&
          typeof verification === "object" &&
          (verification.overall === "pass" || verification.overall === "fail")
        ) {
          return true;
        }
      }
    } catch {
      // sin verificación legible
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * ¿Corre el auto-scoring para este job? Elegible Y dentro de la muestra.
 * El scoring manual SIEMPRE corre aunque esto diga que no (lo decide el
 * engine con `opts.manual`). Nunca lanza.
 */
export function shouldAutoScore(
  workItemId: string,
  samplingRate: number,
): boolean {
  try {
    if (!isJobEligibleForScoring(workItemId)) return false;
    return shouldSampleJob(workItemId, samplingRate);
  } catch {
    return false;
  }
}
