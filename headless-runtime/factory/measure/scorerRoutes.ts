/**
 * factory/measure/scorerRoutes — FASE 3 E1: dominio measure/scorers.
 *
 * Dueño E1 en FASE 3 (§2+§3+§4 de docs/MASTER-PLAN-MODULARIDAD.md): este módulo
 * es la puerta del cascarón (`factoryServer.ts`, bloque Rutas measure) hacia
 * scorers: parsers/guards puros + lecturas + scoring manual. El server conserva
 * formas/handlers/respuestas; solo el MATCH, los guards y la lectura delegan.
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`, sin loops ni timers nuevos (solo
 *   composición de llamadas acotadas; el sampling/cap viven en los engines).
 * - C2 puras fail-safe: cada export con try/catch; el scoring manual ante
 *   imprevisto de aplicabilidad cae al flujo existente (fail-open, como hoy).
 * - C3 un escritor: este módulo SOLO LEE la tienda (`workItemStore.get`) y
 *   delega el scoring en `scorerEngine.scoreJob` (dueño de `scores.json` +
 *   evento). Jamás escribe job.json/result.json/verify.json ni transiciona.
 * - C4 disco best-effort: heredado de los engines (nunca lanza hacia el server).
 * - C5 aditivo: códigos, textos y mensajes idénticos a los handlers actuales
 *   (pacts F01–F14, thresholds 0.5, sampling 25 y polling intactos).
 * - C6/C7 vocabulario único, nada duplicado: parsers/guards se RE-EXPORTAN
 *   desde `measure/scorerHttp` y la lógica desde `measure/scorerLoader`,
 *   `measure/scorerEngine` y `measure/sampler` (cero nombres de
 *   modelos/scorers en este archivo: todo sale de loaders/yaml).
 * - C8 rutas en tabla: cubre los dominios scorers-list, scores-summary,
 *   job-scores-get y job-scores-manual de `factory/routing/routeTable.ts`.
 * - C10 trazabilidad: cada helper cita su bloque espejo del cascarón.
 *
 * Lista blanca de imports (reparto FASE 3 E1): measure/scorerEngine,
 * measure/scorerLoader, measure/scorerHttp, measure/sampler, workItem
 * (SOLO lectura: `get`), shared/types/scorer, shared/roles.
 * PROHIBIDO: review/triage/spec/runner/notify/definition y sus stores.
 */

import { workItemStore } from "../../workItem/workItemStore";
import {
  checkManualScoreApplicability,
  checkManualScoreGuards,
  isScorersListPath,
  isScoresSummaryPath,
  parseManualScorePath,
  parseScoresGetPath,
} from "../../measure/scorerHttp";
import type {
  ManualScoreApplicability,
  ManualScoreGuard,
  ManualScorePathErr,
  ManualScorePathOk,
  ScoresGetPathErr,
  ScoresGetPathOk,
} from "../../measure/scorerHttp";
import { listScorers, loadScorer } from "../../measure/scorerLoader";
import {
  collectScorerInputs,
  getScoresSummary,
  hasMinimumScorerInputs,
  readScores,
  scoreJob,
  scorerAppliesTo,
  scorerRequiredStages,
  stagesForInputs,
} from "../../measure/scorerEngine";
import type { ScorerJobInputs } from "../../measure/scorerEngine";
import { shouldSampleJob } from "../../measure/sampler";

export {
  checkManualScoreApplicability,
  checkManualScoreGuards,
  collectScorerInputs,
  getScoresSummary,
  hasMinimumScorerInputs,
  isScorersListPath,
  isScoresSummaryPath,
  listScorers,
  loadScorer,
  parseManualScorePath,
  parseScoresGetPath,
  readScores,
  scoreJob,
  scorerAppliesTo,
  scorerRequiredStages,
  shouldSampleJob,
  stagesForInputs,
};
export type {
  ManualScoreApplicability,
  ManualScoreGuard,
  ManualScorePathErr,
  ManualScorePathOk,
  ScorerJobInputs,
  ScoresGetPathErr,
  ScoresGetPathOk,
};

/**
 * Existencia de un job para GET .../scores (espejo del bloque Ola 11 del
 * server: la tienda manda; el Map legacy lo sigue OR-eando el cascarón).
 * SOLO lectura (`workItemStore.get`). Nunca lanza.
 */
export function jobExistsForScores(id: unknown): boolean {
  try {
    if (typeof id !== "string" || id.length === 0) return false;
    return workItemStore.get(id) !== undefined;
  } catch {
    return false;
  }
}

export interface ManualScoreRequestInput {
  readonly jobId: string;
  readonly jobExists: unknown;
  readonly scorer: string;
  readonly scorerExists: unknown;
  readonly scorerAgents: readonly string[] | null | undefined;
  readonly inputs: ScorerJobInputs | null | undefined;
}

export type ManualScoreRequestOk = { ok: true };
export type ManualScoreRequestErr = {
  ok: false;
  code: 404 | 409;
  error: string;
};
export type ManualScoreRequest =
  | ManualScoreRequestOk
  | ManualScoreRequestErr;

/**
 * Guards compuestos de POST .../scores/:name (espejo del bloque Ola 11 +
 * Ola 18 P1.6 del server, mismo orden y mismos textos):
 * 1. `checkManualScoreGuards`: 404 job/scorer inexistente, 409 sin inputs
 *    mínimos (sin createdFiles ni verification).
 * 2. Gate de aplicabilidad P1.5: 409 honesto si el scorer no aplica todavía
 *    al job (fail-open ante imprevisto: sigue el flujo manual, como hoy).
 * Puro salvo lecturas ya hechas por el caller. Nunca lanza.
 */
export function checkManualScoreRequest(
  input: ManualScoreRequestInput,
): ManualScoreRequest {
  try {
    const jobId = typeof input?.jobId === "string" ? input.jobId : "";
    const scorer = typeof input?.scorer === "string" ? input.scorer : "";
    const agents = Array.isArray(input?.scorerAgents)
      ? input.scorerAgents
      : null;
    const guard: ManualScoreGuard = checkManualScoreGuards(
      input?.jobExists,
      input?.scorerExists,
      !!input?.inputs && hasMinimumScorerInputs(input.inputs),
      jobId,
      scorer,
    );
    if (!guard.ok) return guard;
    try {
      const stages = stagesForInputs(input?.inputs);
      if (agents && !scorerAppliesTo(stages, [...agents])) {
        const applicability: ManualScoreApplicability =
          checkManualScoreApplicability(
            false,
            scorerRequiredStages([...agents]),
          );
        if (!applicability.ok) return applicability;
      }
    } catch {
      // Fail-open al flujo manual existente (el scoring decide igual).
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 409, error: "manual score failed" };
  }
}
