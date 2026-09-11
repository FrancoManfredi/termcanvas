/**
 * verify/verifyRoutes — FASE 2 E1: matchers puros del dominio verify.
 *
 * Dueño E1 en FASE 2 (§2 de docs/MASTER-PLAN-MODULARIDAD.md): parseo de
 * GET .../verify (sirve verify.json) y POST .../review/verify-retry, con
 * alias dual factory/jobs ↔ work-items. Todo puro, fail-safe, nunca lanza
 * (ok o `{error}` con los mismos textos que el server actual).
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`, sin loops.
 * - C2 puras fail-safe: try/catch en cada export, `{error}` fail-closed.
 * - C5 aditivo: textos y semántica idénticos a `parseVerifyRetryPath` /
 *   `parseVerifyGetPath` del server (el server delega acá; formas intactas).
 * - C6/C7: el SET de ids reservados es espejo documentado del helper de
 *   ids seguros del server más el agregado `verify`/`verify-retry` del
 *   propio server (este dominio NO importa esos helpers ni routing/ por
 *   reparto F2 §3; la paridad se demuestra en tests/verify-domain.test.ts).
 * - C8 rutas en tabla: cubre los dominios job-verify y job-verify-retry.
 * - C10 trazabilidad: cada parser cita su handler espejo.
 *
 * Lista blanca de imports de este archivo: NINGUNA (cero imports).
 * Ver tests/import-sweep-domains-f2.test.ts.
 */

/**
 * Ids que nunca son un job en rutas de este dominio: espejo del helper de
 * ids seguros del cascarón más `verify`/`verify-retry` (ver C7 en el header).
 */
const VERIFY_RESERVED_IDS: ReadonlySet<string> = new Set([
  "review",
  "raw",
  "result",
  "build-log",
  "build.log",
  "cancel",
  "accept",
  "retry",
  "retry-review",
  "verify",
  "verify-retry",
]);

/** Longitud máxima de un id en ruta (espejo de los parsers existentes; cota C1). */
const MAX_VERIFY_ROUTE_ID_LEN = 128;

/**
 * True si un id es seguro para match + path.join. Espejo de `isSafeJobId`
 * (ver C7 en el header). Puro, nunca lanza.
 */
function isSafeVerifyId(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > MAX_VERIFY_ROUTE_ID_LEN) return false;
    if (id.trim().length === 0) return false;
    if (id === "." || id === "..") return false;
    if (id.includes("..")) return false;
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
    if (VERIFY_RESERVED_IDS.has(id)) return false;
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) {
        if (decoded.includes("..")) return false;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return false;
        if (decoded === "." || decoded === "..") return false;
        if (VERIFY_RESERVED_IDS.has(decoded)) return false;
      }
    } catch {
      if (id.includes("%")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type VerifyRetryPathOk = { id: string; isWorkItemsAlias: boolean };
export type VerifyRetryPathErr = { error: string };

/**
 * Parsea el pathname de POST .../review/verify-retry (espejo del handler
 * Ola 9 del server: factory len 5 vs alias work-items len 4, rechaza
 * traversal). Nunca lanza.
 */
export function parseVerifyRetryPath(pathname: unknown): VerifyRetryPathOk | VerifyRetryPathErr {
  try {
    if (typeof pathname !== "string") return { error: "invalid pathname" };
    const isFactory = pathname.startsWith("/factory/jobs/");
    const isAlias = pathname.startsWith("/work-items/");
    if (!isFactory && !isAlias) return { error: "not verify-retry route" };
    if (!pathname.endsWith("/review/verify-retry")) return { error: "not verify-retry route" };
    const parts = pathname.split("/").filter(Boolean);
    const expectedLen = isAlias ? 4 : 5;
    if (parts.length !== expectedLen) return { error: "unexpected path length for verify retry" };
    if (parts[expectedLen - 2] !== "review" || parts[expectedLen - 1] !== "verify-retry") {
      return { error: "not verify-retry route" };
    }
    const id = isAlias ? parts[1] : parts[2];
    if (!id || id === "review" || id === "verify-retry") {
      return { error: "missing id for verify retry" };
    }
    if (!isSafeVerifyId(id)) {
      return { error: `invalid id: ${String(id).slice(0, 60)}` };
    }
    return { id, isWorkItemsAlias: isAlias };
  } catch {
    return { error: "invalid pathname" };
  }
}

export type VerifyGetPathOk = { id: string; isWorkItemsAlias: boolean };
export type VerifyGetPathErr = { error: string };

/**
 * Parsea el pathname de GET .../verify (espejo del handler Ola 9 del server:
 * alias work-items len 3 vs factory len 4; nunca confunde
 * /review/verify-retry porque ese no termina en "/verify"). Nunca lanza.
 */
export function parseVerifyGetPath(pathname: unknown): VerifyGetPathOk | VerifyGetPathErr {
  try {
    if (typeof pathname !== "string") return { error: "invalid pathname" };
    const isFactory = pathname.startsWith("/factory/jobs/");
    const isAlias = pathname.startsWith("/work-items/");
    if (!isFactory && !isAlias) return { error: "not verify route" };
    if (!pathname.endsWith("/verify")) return { error: "not verify route" };
    const parts = pathname.split("/").filter(Boolean);
    const expectedLen = isAlias ? 3 : 4;
    if (parts.length !== expectedLen) return { error: "unexpected path length for verify" };
    if (parts[expectedLen - 1] !== "verify") {
      return { error: "not verify route" };
    }
    const id = isAlias ? parts[1] : parts[2];
    if (!id || id === "verify") {
      return { error: "missing id for verify" };
    }
    if (!isSafeVerifyId(id)) {
      return { error: `invalid id: ${String(id).slice(0, 60)}` };
    }
    return { id, isWorkItemsAlias: isAlias };
  } catch {
    return { error: "invalid pathname" };
  }
}
