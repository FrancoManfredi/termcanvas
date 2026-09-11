/**
 * Parsers puros de rutas factory (FASE 1 E1 — routing/).
 *
 * Reglas (MASTER-PLAN-MODULARIDAD.md):
 * - C2 funciones puras fail-safe: todo es puro, nunca lanza (try/catch +
 *   fail-closed a null/false/{error}).
 * - C8 rutas en tabla: estos parsers son los únicos que tocan segmentos/ids;
 *   la tabla (`routeTable.ts`) los usa para el MATCH.
 * - C1 ESM/cotas: ESM puro, cero `require()`, cero loops nuevos (split/filter
 *   acotados a ≤6 segmentos; sin while/for de reintento).
 * - Cero negocio: solo forma (método+path→segmentos+id), jamás lee disco/red.
 */

/**
 * Ids reservados que nunca son un job válido en rutas (fuente:
 * headless-runtime/factory/reviewRaw.ts `RESERVED_IDS`; se duplica el SET
 * acá a propósito para que `routing/` sea autocontenido y cero-negocio:
 * `routing/` NUNCA importa `../reviewRaw` —ese módulo vive fuera de routing
 * y atarlo acá acoplaría dominios. Migra a importar roles/tipos shared en
 * F2; hoy el sweep lo registra como espejo documentado, no como violación).
 */
const RESERVED_ROUTE_IDS: ReadonlySet<string> = new Set([
  "review",
  "raw",
  "result",
  "build-log",
  "build.log",
  "cancel",
  "accept",
  "retry",
  "retry-review",
]);

/** Longitud máxima de un id en ruta (espejo de isSafeJobId; cota C1). */
const MAX_ROUTE_ID_LEN = 128;

/**
 * True si un id de ruta es seguro para usar en match + path.join.
 * Rechaza: no-string, vacío/blancos, `.`/`..`, cualquier `..`, `/`, `\`,
 * NUL, `%` sospechoso, traversal codificado (%2e/%2f/%5c), reservados y
 * longitud >128. Puro, nunca lanza.
 */
export function isSafeRouteId(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > MAX_ROUTE_ID_LEN) return false;
    if (id.trim().length === 0) return false;
    if (id === "." || id === "..") return false;
    if (id.includes("..")) return false;
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
    if (RESERVED_ROUTE_IDS.has(id)) return false;
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) {
        if (decoded.includes("..")) return false;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return false;
        if (decoded === "." || decoded === "..") return false;
        if (RESERVED_ROUTE_IDS.has(decoded)) return false;
      }
    } catch {
      if (id.includes("%")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Segmentos de un pathname (`/a/b` → ["a","b"]). Null si la entrada no es un
 * pathname absoluto válido (no-string, sin `/` inicial, con query/hash).
 * Puro, nunca lanza. Cota: ≤6 segmentos útiles (las rutas reales tienen ≤5).
 */
export function splitRouteSegments(pathname: unknown): string[] | null {
  try {
    if (typeof pathname !== "string") return null;
    if (pathname.length === 0 || pathname[0] !== "/") return null;
    if (pathname.includes("?") || pathname.includes("#")) return null;
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length > 6) return null;
    return parts;
  } catch {
    return null;
  }
}

/**
 * True si los segmentos tienen la longitud exacta esperada. Puro, nunca lanza.
 */
export function hasExactSegmentLength(parts: unknown, expected: number): boolean {
  try {
    if (!Array.isArray(parts)) return false;
    if (typeof expected !== "number" || !Number.isInteger(expected)) return false;
    return parts.length === expected;
  } catch {
    return false;
  }
}

/** Resultado ok/err de extracción de id (nunca lanza; el caller mapea a 400/404). */
export type RouteIdOk = { id: string };
export type RouteIdErr = { error: string };

/**
 * Extrae y valida el id en `parts[index]`. Rechaza traversal/longitud
 * indirectamente vía `isSafeRouteId`. Puro, nunca lanza.
 */
export function parseIdAt(parts: unknown, index: number): RouteIdOk | RouteIdErr {
  try {
    if (!Array.isArray(parts)) return { error: "invalid path segments" };
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      return { error: "invalid id index" };
    }
    const raw: unknown = (parts as unknown[])[index];
    if (typeof raw !== "string" || raw.length === 0) return { error: "missing id" };
    if (!isSafeRouteId(raw)) return { error: `invalid id: ${String(raw).slice(0, 60)}` };
    return { id: raw };
  } catch {
    return { error: "invalid id" };
  }
}

/**
 * Nombre de scorer en ruta (`:scorer` de POST .../scores/:name).
 * Patrón espejo de shared/types/scorer.ts SCORER_NAME_PATTERN /^[a-z0-9-]+$/i
 * (sin importar scorer: routing/ es cero-negocio; el loader valida de nuevo).
 * Puro, nunca lanza.
 */
export function isSafeScorerName(value: unknown): boolean {
  try {
    if (typeof value !== "string") return false;
    if (value.length === 0 || value.length > 64) return false;
    if (!/^[a-z0-9-]+$/i.test(value)) return false;
    if (value.includes("..") || value.includes("/") || value.includes("\\")) return false;
    return true;
  } catch {
    return false;
  }
}
