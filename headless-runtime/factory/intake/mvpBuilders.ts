/**
 * factory/intake/mvpBuilders — FASE 3 E2: builders MVP de ingesta.
 *
 * Dueno E2 en FASE 3 (apartado 2 + apartado 3 + apartado 4 de
 * docs/MASTER-PLAN-MODULARIDAD.md): este modulo es dueno del ping inocuo de
 * visibilidad, de la allowlist read-only y de los 7 builders MVP de la sesion
 * de seguimiento. El cascaron (`factoryServer.ts`, bloque ingesta MVP) los
 * re-exporta por identidad y los usa en el dispatch sin cambiar formas ni
 * handlers. El bloque Rutas measure de E1 queda intacto.
 *
 * Decision documentada (origen H-010): la sesion MVP de seguimiento NUNCA
 * recibe el prompt crudo del usuario. El texto enviado es SIEMPRE el ping
 * inocuo de visibilidad (`buildMvpTrackingPing(job.id)`), jamas `job.prompt`.
 * `job.prompt` sigue persistido donde ya vive (prompt.md mas job.json).
 * Texto elegido: frase declarativa de estado, sin verbo en imperativo ni
 * tarea interpretable ("lista" mas estado; "sin accion requerida" mas no-op
 * explicito), con el job id para trazabilidad (espeja el title).
 * Cinturon: `toolsetFor("mvp-tracking")` (politica unica en
 * `headless-runtime/runner/toolPolicy.ts`, readonly con read, glob y grep;
 * `tools:{}` NO niega nada: con objeto vacio igual escribio).
 * Limite conocido: la variante C (session.chat anomalo) no tiene slot
 * `tools` en su forma, asi que ahi solo rige el ping (ver carry-over en la
 * suite y nota en `intakeService.ts`).
 * Sin recorridos nuevos, sin cambios de flujo (fire-and-forget, visibilidad,
 * sessionId, title y timeouts intactos; pacts F01-F14 intactos).
 *
 * Reglas que honra (las 8 de los master plans + C1-C10):
 * - C1 ESM y cotas: ESM puro, cero llamadas dinamicas con cadena, sin
 *   temporizadores, sin recorridos escritos a mano (solo composicion de
 *   objetos acotados).
 * - C2 puras fail-safe: cada builder con try y catch; nunca lanza.
 * - C3 un escritor: no escribe nada (ni jobs ni disco); solo construye
 *   payloads que el cascaron envia.
 * - C4 disco best-effort: no aplica (cero disco aca).
 * - C5 aditivo: formas identicas a las actuales (mismos campos, mismos
 *   nombres `sessionID` legacy y `variant` opcional).
 * - C6 y C7 vocabulario unico, nada duplicado: la allowlist sale de la
 *   politica unica (`toolsetFor`), no de literales; el cascaron no redefine.
 * - C8 rutas en tabla: no aplica (estos builders no son rutas; los usa la
 *   ingesta MVP tras POST /factory/jobs).
 * - C9 builders puros testeables: todo export es funcion pura del modelo mas
 *   texto mas variante, testeable sin server vivo y sin red.
 * - C10 trazabilidad: cada builder cita su uso en el dispatch del cascaron.
 *
 * Lista blanca de imports (reparto FASE 3 E2): runner/toolPolicy (politica
 * unica de toolsets) mas shared/roles (predicado canonico de rol).
 * PROHIBIDO: review, triage, spec, measure, runner-executor y sus stores,
 * notify, definitionValidate, agentLoader, VerificationPanel, package.json.
 * Cero puertos, modelos o imagenes literales: el modelo llega por parametro
 * (seleccion del usuario o fallbacks del dispatch), nunca como constante aca.
 */

import { toolsetFor } from "../../runner/toolPolicy";
import { isToolRole } from "../../../shared/roles";

/** Prefijo del ping inocuo (contrato H-010; el job id va en el medio). */
export const MVP_TRACKING_PING_PREFIX = "sesión de seguimiento del job";

/** Sufijo del ping inocuo (no-op explicito; sin imperativo). */
export const MVP_TRACKING_PING_SUFFIX = "lista — sin acción requerida";

/**
 * Ping inocuo de visibilidad para la sesion MVP (usado en el dispatch del
 * cascaron como `const promptText = buildMvpTrackingPing(job.id)`).
 * Puro, nunca lanza.
 */
export function buildMvpTrackingPing(jobId: string): string {
  try {
    return `${MVP_TRACKING_PING_PREFIX} ${jobId} ${MVP_TRACKING_PING_SUFFIX}`;
  } catch {
    try {
      return `${MVP_TRACKING_PING_PREFIX} unknown ${MVP_TRACKING_PING_SUFFIX}`;
    } catch {
      return "sesión de seguimiento lista — sin acción requerida";
    }
  }
}

/**
 * Allowlist read-only via politica unica (`toolsetFor("mvp-tracking")`
 * equivale a readonly). Se exporta como valor congelado en el uso: cada
 * builder esparce una copia fresca para que el caller pueda mutar su copia
 * sin afectar a otros.
 */
export const MVP_TRACKING_TOOLS = toolsetFor("mvp-tracking");

export interface MvpTrackingModel {
  providerID: string;
  modelID: string;
}

/**
 * True si el rol es el de seguimiento MVP (canonico via `shared/roles`).
 * Puro, nunca lanza. Existe para que este modulo use la fuente unica de
 * roles ademas de la politica (reparto intake: toolPolicy mas roles).
 */
export function isMvpTrackingRole(role: unknown): boolean {
  try {
    return role === "mvp-tracking" && isToolRole(role);
  } catch {
    return false;
  }
}

/**
 * Variante A sync, forma path y body (usada en el dispatch sync vivo del
 * cascaron). Pura, nunca lanza.
 */
export function buildMvpSyncBody(
  model: MvpTrackingModel,
  text: string,
  variant?: string,
): Record<string, unknown> {
  try {
    const body: Record<string, unknown> = {
      model,
      tools: { ...toolsetFor("mvp-tracking") },
      parts: [{ type: "text", text }],
    };
    if (variant) body.variant = variant;
    return body;
  } catch {
    return { model, parts: [{ type: "text", text }] };
  }
}

/**
 * Variante A sync, forma legacy plana (usada en el dispatch sync vivo del
 * cascaron). Pura, nunca lanza.
 */
export function buildMvpSyncLegacy(
  sessionId: string,
  model: MvpTrackingModel,
  text: string,
  variant?: string,
): Record<string, unknown> {
  try {
    const payload: Record<string, unknown> = {
      sessionID: sessionId,
      model,
      tools: { ...toolsetFor("mvp-tracking") },
      parts: [{ type: "text", text }],
    };
    if (variant) payload.variant = variant;
    return payload;
  } catch {
    return { sessionID: sessionId, model, parts: [{ type: "text", text }] };
  }
}

/**
 * Variante A fallback async, forma path y body (usada en el fallback async
 * del cascaron). Pura, nunca lanza.
 */
export function buildMvpAsyncBody(
  model: MvpTrackingModel,
  text: string,
  variant?: string,
): Record<string, unknown> {
  try {
    const body: Record<string, unknown> = {
      model,
      tools: { ...toolsetFor("mvp-tracking") },
      parts: [{ type: "text", text }],
    };
    if (variant) body.variant = variant;
    return body;
  } catch {
    return { model, parts: [{ type: "text", text }] };
  }
}

/**
 * Variante A fallback async, forma legacy plana (usada en el fallback async
 * del cascaron). Pura, nunca lanza.
 */
export function buildMvpAsyncLegacy(
  sessionId: string,
  model: MvpTrackingModel,
  text: string,
  variant?: string,
): Record<string, unknown> {
  try {
    const payload: Record<string, unknown> = {
      sessionID: sessionId,
      model,
      tools: { ...toolsetFor("mvp-tracking") },
      parts: [{ type: "text", text }],
    };
    if (variant) payload.variant = variant;
    return payload;
  } catch {
    return { sessionID: sessionId, model, parts: [{ type: "text", text }] };
  }
}

/**
 * Variante B (noReply), forma path y body (usada en la variante B del
 * cascaron). Pura, nunca lanza.
 */
export function buildMvpNoReplyBody(text: string): Record<string, unknown> {
  try {
    return {
      tools: { ...toolsetFor("mvp-tracking") },
      parts: [{ type: "text", text }],
      noReply: true,
    };
  } catch {
    return { parts: [{ type: "text", text }], noReply: true };
  }
}

/**
 * Variante B (noReply), forma legacy plana (usada en la variante B del
 * cascaron). Pura, nunca lanza.
 */
export function buildMvpNoReplyLegacy(sessionId: string, text: string): Record<string, unknown> {
  try {
    return {
      sessionID: sessionId,
      tools: { ...toolsetFor("mvp-tracking") },
      parts: [{ type: "text", text }],
      noReply: true,
    };
  } catch {
    return { sessionID: sessionId, parts: [{ type: "text", text }], noReply: true };
  }
}

/**
 * Variante C (session.chat anomalo): portador del texto (usada en la variante
 * C del cascaron). Solo ping por decision (esta forma no tiene slot `tools`;
 * ver nota en `intakeService.ts`). Pura, nunca lanza.
 */
export function buildMvpChatParts(text: string): Array<Record<string, unknown>> {
  try {
    return [{ type: "text", text }];
  } catch {
    return [{ type: "text", text: String(text ?? "") }];
  }
}
