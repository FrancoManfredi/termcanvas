/**
 * promptWithCost — Ola 15 E2 (único punto de instrumentación).
 *
 * Wrapper que ejecuta un `session.prompt` (o cualquier promptFn), mide
 * chars in/out y llama a `recordLlmCall`. Los 7 agentes
 * (foreman/triage/spec/implement/review/judge/analysis) NO se tocan a mano:
 * el orquestador cablea este wrapper en sus 7 call-sites (ver resumen de
 * entrega). Así hay UN solo punto de conteo (riesgo §2.5: key por jobId,
 * no global).
 *
 * Best-effort: el conteo nunca rompe el flujo (try/catch interno).
 * Si `costTracking: false`, `recordLlmCall` es no-op y el prompt corre igual.
 *
 * ESM puro, TypeScript estricto, cero require().
 */

import { isCostTrackingEnabled, recordLlmCall } from "./costTracker";

/**
 * Extrae chars de salida de un resultado de prompt desconocido.
 * - string → length (chars JS, no bytes).
 * - null/undefined → 0.
 * - object → JSON.stringify length (tolerante a circulares).
 * - otro → String(...) length.
 * Nunca lanza.
 */
export function extractOutputChars(res: unknown): number {
  try {
    if (res === null || res === undefined) return 0;
    if (typeof res === "string") return res.length;
    if (typeof res === "object") {
      try {
        const text = JSON.stringify(res);
        return typeof text === "string" ? text.length : 0;
      } catch {
        try {
          return String(res).length;
        } catch {
          return 0;
        }
      }
    }
    try {
      return String(res).length;
    } catch {
      return 0;
    }
  } catch {
    return 0;
  }
}

/**
 * Ola 15 cierre: lleva el contador en memoria a `costSummary` + `job.json` +
 * timeline vía `workItemStore.refreshCostSummary` (NO `incrementCost`: ese
 * método re-graba con `recordLlmCall` y contaría DOBLE, además de retornar
 * null sin grabar si el job no está en el store).
 * Dynamic import para evitar un ciclo estático cost→workItemStore (el store
 * ya importa `costTracker`). Singleton verificado: `workItemStore`
 * (`headless-runtime/workItem/workItemStore.ts`).
 * Best-effort: nunca lanza (el import queda cacheado tras la primera
 * llamada). Job inexistente en el store → no-op (el contador en memoria
 * igual queda). Con `costTracking: false` no persiste nada (apagado total).
 */
async function refreshStoreCostSummaryBestEffort(
  jobId: string,
  modelRefOrKey?: unknown,
): Promise<void> {
  try {
    if (!isCostTrackingEnabled()) return;
    if (typeof jobId !== "string" || jobId.trim().length === 0) return;
    const mod = await import("../workItem/workItemStore");
    try {
      mod.workItemStore?.refreshCostSummary?.(jobId, modelRefOrKey);
    } catch {
      // best-effort: persistir nunca rompe el prompt
    }
  } catch {
    // best-effort: import/store ausente nunca rompe el prompt
  }
}

/**
 * Ejecuta `promptFn`, mide `inputText.length` + chars de salida y registra.
 * Ante fallo del prompt: registra input con 0 out (la llamada se intentó)
 * y relanza el error original (el caller aplica su fallo-sano actual).
 * FU-4b: `modelRefOrKey` opcional (ModelRef o "provider/model") se hila a
 * `refreshCostSummary`; omitido → el store usa el modelRef del job; sin
 * modelo o sin tarifa → null honesto (nunca se inventa).
 */
export async function promptInSessionWithCost<T>(
  jobId: string,
  promptFn: () => Promise<T>,
  inputText: string,
  modelRefOrKey?: unknown,
): Promise<T> {
  const inputChars =
    typeof inputText === "string" ? inputText.length : 0;
  try {
    const res = await promptFn();
    let outChars = 0;
    try {
      outChars = extractOutputChars(res);
    } catch {
      outChars = 0;
    }
    try {
      recordLlmCall(jobId, inputChars, outChars);
    } catch {
      // best-effort: el conteo nunca rompe el flujo
    }
    await refreshStoreCostSummaryBestEffort(jobId, modelRefOrKey);
    return res;
  } catch (err) {
    try {
      recordLlmCall(jobId, inputChars, 0);
    } catch {
      // noop
    }
    await refreshStoreCostSummaryBestEffort(jobId, modelRefOrKey);
    throw err;
  }
}
