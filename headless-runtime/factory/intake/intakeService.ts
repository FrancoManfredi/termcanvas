/**
 * factory/intake/intakeService — FASE 3 E2: guards de ingesta MVP.
 *
 * Dueno E2 en FASE 3 (apartado 2 + apartado 3 + apartado 4 de
 * docs/MASTER-PLAN-MODULARIDAD.md): guards puros de la ingesta MVP (jamas
 * prompt crudo) mas nota de la variante C. Los builders viven en
 * `./mvpBuilders` (dueno de los payloads); este modulo no los redefine, los
 * IMPORTA para los guards. El cascaron conserva el dispatch fire-and-forget;
 * solo los guards y la documentacion delegan aca. El bloque Rutas measure de
 * E1 queda intacto.
 *
 * Nota variante C (decision intacta): la forma session.chat anomala no tiene
 * slot `tools` en ningun caller del repo, asi que ahi solo rige el ping
 * inocuo. No se inventa un slot que el SDK no honra; el ping es su unica
 * proteccion por decision documentada (carry-over H-010).
 *
 * Reglas que honra (las 8 de los master plans + C1-C10):
 * - C1 ESM y cotas: ESM puro, cero llamadas dinamicas con cadena, sin
 *   temporizadores, sin recorridos escritos a mano (solo comparaciones y
 *   predicados acotados).
 * - C2 puras fail-safe: cada export con try y catch; nunca lanza.
 * - C3 un escritor: no escribe nada; solo valida en memoria.
 * - C4 disco best-effort: no aplica (cero disco aca).
 * - C5 aditivo: no cambia formas del dispatch (el ping sigue componiendose
 *   de las consts mas job id; la allowlist sigue readonly).
 * - C6 y C7 vocabulario unico, nada duplicado: el ping se IMPORTA de
 *   `./mvpBuilders`, el predicado de rol de `shared/roles`, la seguridad de
 *   ids de `reviewRaw` (utils). Nada se copia.
 * - C8 rutas en tabla: no aplica (ingesta, no ruta nueva).
 * - C9 builders puros testeables: los guards son funciones puras del texto
 *   mas job id, testeables sin server vivo.
 * - C10 trazabilidad: cada guard cita su uso en el dispatch del cascaron.
 *
 * Lista blanca de imports (reparto FASE 3 E2): mismo dominio
 * (`./mvpBuilders`), runner/toolPolicy via el builder, shared/roles y utils
 * (`../reviewRaw` para ids seguros).
 * PROHIBIDO: review, triage, spec, measure, runner-executor y sus stores,
 * notify, definitionValidate, agentLoader, VerificationPanel, package.json.
 */

import { buildMvpTrackingPing } from "./mvpBuilders";
import { isSafeJobId } from "../reviewRaw";
import { isToolRole } from "../../../shared/roles";

/**
 * Nota de la variante C (ping-only por decision): la forma session.chat no
 * tiene slot `tools`, asi que el ping inocuo es su unica proteccion. Los
 * tests la asertan (sin `tools` en sus parts) y este texto la documenta para
 * QA y futuros lectores.
 */
export const MVP_VARIANT_C_NOTE =
  "Variante C (session.chat anómalo) sin slot tools por decisión: solo rige el ping inocuo.";

/**
 * True si el texto es exactamente el ping inocuo del job (espejo del dispatch
 * del cascaron: `const promptText = buildMvpTrackingPing(job.id)`). Sirve
 * para asertar que la ingesta jamas porta el prompt crudo. Puro, nunca lanza.
 */
export function isMvpPingForJob(text: unknown, jobId: unknown): boolean {
  try {
    if (typeof text !== "string" || typeof jobId !== "string") return false;
    if (text.length === 0 || jobId.length === 0) return false;
    return text === buildMvpTrackingPing(jobId);
  } catch {
    return false;
  }
}

/**
 * True si el id es seguro para la ingesta (delega en el helper de ids
 * seguros del cascaron, utils). Puro, nunca lanza.
 */
export function isSafeIntakeJobId(id: unknown): boolean {
  try {
    return isSafeJobId(id);
  } catch {
    return false;
  }
}

/**
 * True si el rol es el de seguimiento MVP (canonico via `shared/roles`).
 * Puro, nunca lanza.
 */
export function isIntakeTrackingRole(role: unknown): boolean {
  try {
    return role === "mvp-tracking" && isToolRole(role);
  } catch {
    return false;
  }
}
