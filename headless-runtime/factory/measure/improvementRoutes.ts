/**
 * factory/measure/improvementRoutes — FASE 3 E1: dominio measure/improvement.
 *
 * Dueño E1 en FASE 3 (§2+§3+§4 de docs/MASTER-PLAN-MODULARIDAD.md): este módulo
 * es la puerta del cascarón (`factoryServer.ts`, bloque Rutas measure) hacia
 * self-improvement: parsers/guards puros + failures + propuestas + adopt con
 * backup-antes-de-escribir + discard. El server conserva formas/handlers/
 * respuestas; solo el MATCH, los guards y la lectura delegan.
 *
 * Regla 4 (jamás auto-adoptar): el ÚNICO writer a `factory/skills|agents` es
 * `adoptProposal`, invocado SOLO por POST .../adopt (el POST humano ES la
 * confirmación; este módulo no inventa ningún flujo de confirmación nuevo).
 * El auto-propose (`maybeAutoProposeForScorer`, en scorerEngine) crea como
 * máximo una propuesta `pending` que el análisis deja en `ready`/`failed`:
 * nunca adopta. El análisis y los GETs no escriben targets.
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`, sin loops ni timers nuevos. El
 *   cooldown de propuestas (`improveProposalCooldown`) vive en el engine.
 * - C2 puras fail-safe: cada export con try/catch; ante fallo LLM/parse/
 *   allowlist la propuesta queda `failed` con razón visible (nunca contenido
 *   inventado).
 * - C3 un escritor validado+atómico: `adoptProposal` revalida el allowlist,
 *   hace backup a `.proposals/<id>.bak` ANTES de escribir (si el backup falla
 *   ABORTA sin escribir) y escribe tmp→rename. Toda lectura/escritura bajo
 *   `factory/` pasa por el resolver testeable del engine (sandbox vía
 *   `TERMCANVAS_FACTORY_DIR` en tests).
 * - C4 disco best-effort: heredado del engine.
 * - C5 aditivo: códigos, textos y formas idénticos a los handlers actuales
 *   (pacts F01–F14 y polling intactos).
 * - C6/C7 vocabulario único, nada duplicado: parsers/guards desde
 *   `measure/improvementHttp`, allowlist desde `shared/types/improvement`,
 *   propuestas desde `measure/improvementEngine`, existencia de scorers desde
 *   el loader (cero nombres de modelos/scorers en este archivo).
 * - C8 rutas en tabla: cubre improve-failures, improve-proposals-create,
 *   improve-proposals-list, improve-proposal-get, improve-proposal-adopt,
 *   improve-proposal-discard e improve-proposal-retry-analysis (P4c:
 *   re-análisis humano de `failed`; globales, sin alias).
 * - C10 trazabilidad: cada helper cita su bloque espejo del cascarón.
 *
 * Lista blanca de imports (reparto FASE 3 E1): measure/improvementEngine,
 * measure/scorerLoader, shared/types/improvement. (Parsers vía
 * measure/improvementHttp, también measure. Sin workItem: las propuestas no
 * tocan jobs salvo lectura de failures vía el engine.)
 * PROHIBIDO: review/triage/spec/runner/notify/definition y sus stores.
 */

import {
  checkAdoptGuards,
  checkCreateProposalBody,
  checkDiscardGuards,
  checkRetryAnalysisGuards,
  isFailuresPath,
  isProposalsCreatePath,
  isProposalsListPath,
  isSafeProposalId,
  parseProposalActionPath,
  parseProposalGetPath,
  parseProposalRetryAnalysisPath,
  validateImproveScorerParam,
  RETRY_ANALYSIS_MAX,
} from "../../measure/improvementHttp";
import type {
  CreateProposalBodyErr,
  CreateProposalBodyOk,
  ImproveScorerParamErr,
  ImproveScorerParamOk,
  ProposalActionPathErr,
  ProposalActionPathOk,
  ProposalGetPathErr,
  ProposalGetPathOk,
  ProposalGuard,
  ProposalRetryAnalysisPathErr,
  ProposalRetryAnalysisPathOk,
} from "../../measure/improvementHttp";
import {
  ImprovementError,
  adoptProposal,
  collectFailures,
  createPendingProposal,
  discardProposal,
  getFactoryBaseDir,
  isImprovementError,
  listProposalSummaries,
  listProposals,
  readProposal,
  resolveFactoryPath,
  retryAnalysisForProposal,
  runAnalysisForProposal,
} from "../../measure/improvementEngine";
import type { AdoptResult } from "../../measure/improvementEngine";
import { loadScorer } from "../../measure/scorerLoader";
import { isAdoptableTarget } from "../../../shared/types/improvement";
import type {
  FailureCase,
  ImprovementProposal,
  ProposalSummary,
} from "../../../shared/types/improvement";

export {
  ImprovementError,
  adoptProposal,
  checkAdoptGuards,
  checkCreateProposalBody,
  checkDiscardGuards,
  checkRetryAnalysisGuards,
  collectFailures,
  createPendingProposal,
  discardProposal,
  getFactoryBaseDir,
  isAdoptableTarget,
  isFailuresPath,
  isImprovementError,
  isProposalsCreatePath,
  isProposalsListPath,
  isSafeProposalId,
  listProposalSummaries,
  listProposals,
  loadScorer,
  parseProposalActionPath,
  parseProposalGetPath,
  parseProposalRetryAnalysisPath,
  readProposal,
  resolveFactoryPath,
  retryAnalysisForProposal,
  runAnalysisForProposal,
  validateImproveScorerParam,
  RETRY_ANALYSIS_MAX,
};
export type {
  AdoptResult,
  CreateProposalBodyErr,
  CreateProposalBodyOk,
  FailureCase,
  ImproveScorerParamErr,
  ImproveScorerParamOk,
  ImprovementProposal,
  ProposalActionPathErr,
  ProposalActionPathOk,
  ProposalGetPathErr,
  ProposalGetPathOk,
  ProposalGuard,
  ProposalRetryAnalysisPathErr,
  ProposalRetryAnalysisPathOk,
  ProposalSummary,
};

export type FailuresRequestOk = { ok: true; scorer: string };
export type FailuresRequestErr = {
  ok: false;
  code: 400 | 404;
  error: string;
};
export type FailuresRequest = FailuresRequestOk | FailuresRequestErr;

/**
 * Guards compuestos de GET /factory/improve/failures?scorer=NAME (espejo del
 * bloque Ola 13 del server, mismo orden y mismos textos):
 * 1. Query `?scorer=NAME` ausente/malformado → 400.
 * 2. Nombre bien formado pero inexistente (vía loader) → 404.
 * Nunca lanza.
 */
export function checkFailuresRequest(
  scorerParam: unknown,
): FailuresRequest {
  try {
    const checked = validateImproveScorerParam(scorerParam);
    if ("error" in checked) {
      return { ok: false, code: checked.code, error: checked.error };
    }
    let loaded: unknown = null;
    try {
      loaded = loadScorer(checked.scorer);
    } catch {
      loaded = null;
    }
    if (!loaded) {
      return { ok: false, code: 404, error: `scorer not found: ${checked.scorer}` };
    }
    return { ok: true, scorer: checked.scorer };
  } catch {
    return { ok: false, code: 400, error: "query scorer inválido" };
  }
}

/** Respuesta HTTP mínima que necesita el handler de retry-analysis. */
export interface RetryAnalysisHttpResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
}

/**
 * Handler de dominio de POST /factory/improve/proposals/:id/retry-analysis
 * (P4c; el server solo delega con 1 línea —God +1— y este cuerpo vive acá).
 * Espejo de `handleProposalAdoptRoute` del cascarón, misma forma:
 * - Path malformado → 400. Propuesta inexistente → 404.
 * - status !== "failed" o presupuesto de retry-analysis agotado → 409
 *   (vía `checkRetryAnalysisGuards`; jamás re-analiza ready/adopted/
 *   discarded/pending).
 * - Re-análisis OK → 200 `{ok:true, proposal}` (ready o failed honesto).
 * - Sin `decidedBy`: re-analizar no es decidir (igual que el create);
 *   el humano decide después vía adopt/discard (human-only intacto).
 * Nunca lanza (imprevistos no-tipados → 500 honesto).
 */
export async function handleProposalRetryAnalysisRoute(
  pathname: string,
  res: RetryAnalysisHttpResponse,
): Promise<void> {
  try {
    const parsed = parseProposalRetryAnalysisPath(pathname);
    if ("error" in parsed) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsed.error }));
      return;
    }
    const guards = checkRetryAnalysisGuards(readProposal(parsed.id) ?? null, parsed.id);
    if (!guards.ok) {
      res.writeHead(guards.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: guards.error }));
      return;
    }
    try {
      const retried = await retryAnalysisForProposal(parsed.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, proposal: retried }));
    } catch (e) {
      if (isImprovementError(e)) {
        res.writeHead(e.code, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message.slice(0, 300) }));
        return;
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `retry-analysis failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`,
        }),
      );
    }
    return;
  } catch {
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "retry-analysis failed" }));
    } catch {}
  }
}
