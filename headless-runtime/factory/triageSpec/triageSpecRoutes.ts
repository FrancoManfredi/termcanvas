/**
 * triageSpec/triageSpecRoutes — FASE 2 E2: matchers puros del dominio triageSpec.
 *
 * Dueño E2 en FASE 2 (§2+§3 de docs/MASTER-PLAN-MODULARIDAD.md): este módulo
 * es dueño del MATCH de POST .../triage/respond y POST .../spec/approve
 * (alias dual factory/jobs ↔ work-items). El parse de spec/approve se
 * re-exporta desde spec/specFlow.ts (implementación única, C7: este dominio
 * NO lo duplica); el parse de triage/respond se muda acá (su único hogar
 * previo era el server, que ahora delega). Todo puro, fail-safe, nunca lanza.
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`, sin loops ni timers (split y
 *   filter acotados por la propia longitud del pathname).
 * - C2 puras fail-safe: try/catch en cada export, `{error}` fail-closed.
 * - C5 aditivo: textos y semántica idénticos a los parsers actuales (el
 *   server delega acá; pacts F01–F14 y polling intactos).
 * - C6/C7 vocabulario único, nada duplicado: el SET de ids seguros es espejo
 *   documentado del helper del server (este dominio NO importa helpers de
 *   revisión ni routing/ por reparto F2 §3; la paridad con los exports
 *   delegados del cascarón se demuestra en
 *   tests/triage-spec-domain.test.ts).
 * - C8 rutas en tabla: cubre los dominios job-triage-respond,
 *   job-spec-approve y job-spec-reject.
 * - C10 trazabilidad: cada parser cita su handler espejo.
 *
 * Lista blanca de imports (ver tests/import-sweep-domains-f2e2.test.ts):
 * specFlow SOLO para re-exportar el parse de approve (implementación única).
 * PROHIBIDO: todo el resto.
 */

export { parseSpecApprovePath } from "../../spec/specFlow";
export type { SpecApprovePathErr, SpecApprovePathOk } from "../../spec/specFlow";
export { parseSpecRejectPath } from "../../spec/specFlow";
export type { SpecRejectPathErr, SpecRejectPathOk } from "../../spec/specFlow";

/**
 * Ids que nunca son un job en rutas de este dominio: espejo del helper de
 * ids seguros del cascarón más los segmentos propios (`triage`, `respond`,
 * `spec`, `approve`) y los de dominios vecinos que comparten prefijo
 * (ver C7 en el header). Los sufijos de verificación viven en el dominio
 * de E1 y acá no confunden (los sufijos propios mandan), así que no se
 * listan: paridad con el helper actual, que los acepta como id (404 por
 * lookup).
 */
const TRIAGE_SPEC_RESERVED_IDS: ReadonlySet<string> = new Set([
  "review",
  "raw",
  "result",
  "build-log",
  "build.log",
  "cancel",
  "accept",
  "retry",
  "retry-review",
  "triage",
  "respond",
  "spec",
  "approve",
  "reject",
]);

/** Longitud máxima de un id en ruta (espejo de los parsers existentes; cota C1). */
const MAX_TRIAGE_SPEC_ROUTE_ID_LEN = 128;

/**
 * True si un id es seguro para match. Espejo de `isSafeJobId` del cascarón
 * (ver C7 en el header). Puro, nunca lanza.
 */
function isSafeTriageSpecId(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > MAX_TRIAGE_SPEC_ROUTE_ID_LEN) return false;
    if (id.trim().length === 0) return false;
    if (id === "." || id === "..") return false;
    if (id.includes("..")) return false;
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
    if (TRIAGE_SPEC_RESERVED_IDS.has(id)) return false;
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) {
        if (decoded.includes("..")) return false;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return false;
        if (decoded === "." || decoded === "..") return false;
        if (TRIAGE_SPEC_RESERVED_IDS.has(decoded)) return false;
      }
    } catch {
      if (id.includes("%")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type TriageRespondPathOk = { id: string; isWorkItemsAlias: boolean };
export type TriageRespondPathErr = { error: string };

/**
 * Parsea el pathname de POST .../triage/respond (espejo del handler H-002
 * del server: factory len 5 vs alias work-items len 4, rechaza traversal).
 * Nunca lanza.
 */
export function parseTriageRespondPath(pathname: unknown): TriageRespondPathOk | TriageRespondPathErr {
  try {
    if (typeof pathname !== "string") return { error: "invalid pathname" };
    const isFactory = pathname.startsWith("/factory/jobs/");
    const isAlias = pathname.startsWith("/work-items/");
    if (!isFactory && !isAlias) return { error: "not triage-respond route" };
    if (!pathname.endsWith("/triage/respond")) return { error: "not triage-respond route" };
    const parts = pathname.split("/").filter(Boolean);
    const expectedLen = isAlias ? 4 : 5;
    if (parts.length !== expectedLen) return { error: "unexpected path length for triage respond" };
    if (parts[expectedLen - 2] !== "triage" || parts[expectedLen - 1] !== "respond") {
      return { error: "not triage-respond route" };
    }
    const id = isAlias ? parts[1] : parts[2];
    if (!id || id === "triage" || id === "respond") {
      return { error: "missing id for triage respond" };
    }
    if (!isSafeTriageSpecId(id)) {
      return { error: `invalid id: ${String(id).slice(0, 60)}` };
    }
    return { id, isWorkItemsAlias: isAlias };
  } catch {
    return { error: "invalid pathname" };
  }
}
