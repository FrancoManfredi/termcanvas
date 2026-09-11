/**
 * review/reviewRoutes — FASE 2 E2: matchers puros del dominio review.
 *
 * Dueño E2 en FASE 2 (§2+§3 de docs/MASTER-PLAN-MODULARIDAD.md): este módulo
 * es dueño del MATCH de lectura de review por id, accept igual, reintento a
 * Building y reintento solo-review (rutas POST/GET con alias dual
 * factory/jobs ↔ work-items). La lectura del raw por id sigue en
 * factory/reviewRaw.ts (dueño previo, se reutiliza sin duplicar). Todo puro,
 * fail-safe, nunca lanza (ok, `{error}` o null).
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`, sin loops ni timers (split y
 *   filter acotados por la propia longitud del pathname, como
 *   routing/routeParsers y jobs/jobRoutes de E1).
 * - C2 puras fail-safe: try/catch en cada export; null = no-ruta (el caller
 *   cae a los handlers siguientes), `{error}` = ruta con id ausente.
 * - C5 aditivo: réplica exacta de la semántica de los handlers actuales del
 *   server (mismo gate prefijo+sufijo, misma extracción de id, mismos textos
 *   de 400; pacts F01–F14 y polling intactos). A propósito NO valida ids
 *   seguros ni longitudes más allá del gate: los handlers de hoy tampoco lo
 *   hacen y el id solo se usa para lookup en tienda (jamás path.join).
 * - C6/C7 vocabulario único, nada duplicado: el parse del raw NO se duplica
 *   (vive en factory/reviewRaw.ts); estos matchers cubren solo lo que ningún
 *   otro módulo parsea.
 * - C8 rutas en tabla: cubre los dominios job-review, job-review-accept,
 *   job-review-retry y job-review-retry-review.
 * - C10 trazabilidad: cada matcher cita su handler espejo en el cascarón.
 *
 * Lista blanca de imports de este archivo: NINGUNA (cero imports, solo
 * string ops). Ver tests/import-sweep-domains-f2e2.test.ts.
 */

/** Match ok de ruta de review (el caller responde 404 honesto si la tienda no tiene el id). */
export interface ReviewRouteOk {
  readonly id: string;
  readonly isWorkItemsAlias: boolean;
}

/** Ruta con forma válida pero sin id utilizable (el caller responde 400 con este texto). */
export type ReviewPathErr = { error: string };

/**
 * Gate compartido: prefijo factory/jobs o work-items + sufijo exacto.
 * Null ante método erróneo, prefijo ajeno o sufijo ausente (no-ruta: el
 * caller cae a los handlers siguientes). Puro, nunca lanza.
 */
function splitReviewPath(
  method: unknown,
  pathname: unknown,
  expectedMethod: string,
  suffix: string,
): { parts: string[]; isWorkItemsAlias: boolean } | null {
  try {
    if (method !== expectedMethod) return null;
    if (typeof pathname !== "string") return null;
    const isFactory = pathname.startsWith("/factory/jobs/");
    const isAlias = pathname.startsWith("/work-items/");
    if (!isFactory && !isAlias) return null;
    if (!pathname.endsWith(suffix)) return null;
    const parts = pathname.split("/").filter(Boolean);
    const isWorkItemsAlias = parts[0] === "work-items";
    return { parts, isWorkItemsAlias };
  } catch {
    return null;
  }
}

/**
 * Núcleo compartido de las rutas POST por id con longitud exacta
 * (factory len 5 / alias len 4). Null ante longitud inexacta: el handler
 * actual cae a los siguientes sin responder (paridad C5). Puro, nunca lanza.
 */
function parseReviewPostById(
  method: unknown,
  pathname: unknown,
  suffix: string,
): ReviewRouteOk | null {
  try {
    const gate = splitReviewPath(method, pathname, "POST", suffix);
    if (!gate) return null;
    const expectedLen = gate.isWorkItemsAlias ? 4 : 5;
    if (gate.parts.length !== expectedLen) return null;
    const id = gate.isWorkItemsAlias ? gate.parts[1] : gate.parts[2];
    if (typeof id !== "string" || id.length === 0) return null;
    return { id, isWorkItemsAlias: gate.isWorkItemsAlias };
  } catch {
    return null;
  }
}

/**
 * GET .../:id/review (espejo del bloque Ola 4 del server).
 * Null si no es esta ruta; `{error: "missing id for review"}` si la forma
 * calza pero el segmento de id falta o es literalmente "review" (400 actual).
 * Puro, nunca lanza.
 */
export function parseReviewPath(method: unknown, pathname: unknown): ReviewRouteOk | ReviewPathErr | null {
  try {
    const gate = splitReviewPath(method, pathname, "GET", "/review");
    if (!gate) return null;
    const id = gate.isWorkItemsAlias ? gate.parts[1] : gate.parts[2];
    if (!id || id === "review") {
      return { error: "missing id for review" };
    }
    return { id, isWorkItemsAlias: gate.isWorkItemsAlias };
  } catch {
    return null;
  }
}

/**
 * POST .../:id/review/accept — humano acepta igual (espejo del bloque
 * Ola 4 P1 del server). Null ante método erróneo o longitud inexacta
 * (el handler actual cae a los siguientes). Puro, nunca lanza.
 */
export function parseReviewAcceptPath(method: unknown, pathname: unknown): ReviewRouteOk | null {
  try {
    return parseReviewPostById(method, pathname, "/review/accept");
  } catch {
    return null;
  }
}

/**
 * POST .../:id/review/retry — humano manda a Building (espejo del bloque
 * Ola 4 P1 del server). Null ante método erróneo o longitud inexacta.
 * Puro, nunca lanza.
 */
export function parseReviewRetryPath(method: unknown, pathname: unknown): ReviewRouteOk | null {
  try {
    return parseReviewPostById(method, pathname, "/review/retry");
  } catch {
    return null;
  }
}

/**
 * POST .../:id/review/retry-review — reintenta SOLO review sin re-correr
 * implement (espejo del bloque Ola 5 del server). Null ante método erróneo
 * o longitud inexacta. Puro, nunca lanza.
 */
export function parseReviewRetryReviewPath(method: unknown, pathname: unknown): ReviewRouteOk | null {
  try {
    return parseReviewPostById(method, pathname, "/review/retry-review");
  } catch {
    return null;
  }
}
