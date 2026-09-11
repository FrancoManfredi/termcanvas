/**
 * jobs/jobRoutes — FASE 2 E1: matchers puros del dominio jobs.
 *
 * Dueño E1 en FASE 2 (§2+§3 de docs/MASTER-PLAN-MODULARIDAD.md): este módulo
 * es dueño del MATCH de lista/detalle/salud + logs/eventos/resultado/build-log
 * por id (rutas GET con alias dual factory/jobs ↔ work-items). Todo puro,
 * fail-safe, nunca lanza (ok o null).
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`, sin loops (split/filter
 *   acotados a ≤6 segmentos, como routing/routeParsers).
 * - C2 puras fail-safe: try/catch en cada export, null = no-ruta.
 * - C5 aditivo: replica la semántica del server actual (mismo match que
 *   `matchRoute` para estas rutas; pacts F01–F14 y polling intactos).
 * - C6/C7 vocabulario único, nada duplicado: el SET reservado es espejo
 *   documentado del parser de rutas existente (este dominio NO importa
 *   routing/ ni helpers del server por reparto F2 §3 — E1 no toca nada de
 *   E2; la paridad contra `matchRoute` se demuestra en tests/jobs-domain.test.ts).
 * - C8 rutas en tabla: estos matchers cubren exactamente los dominios
 *   health, jobs-list, job-detail, job-logs, job-events, job-result y
 *   job-build-log de la tabla (los dos sufijos build-log/build.log comparten
 *   dominio, igual que la tabla).
 * - C10 trazabilidad: cada matcher cita su handler espejo en el cascarón.
 *
 * Lista blanca de imports de este archivo: NINGUNA (cero imports, solo
 * string ops). Ver tests/import-sweep-domains-f2.test.ts.
 */

/** Ids que nunca son un job en rutas (espejo de routing/routeParsers; ver C7 arriba). */
const RESERVED_JOB_ROUTE_IDS: ReadonlySet<string> = new Set([
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

/** Longitud máxima de un id en ruta (espejo de routing/; cota C1). */
const MAX_JOB_ROUTE_ID_LEN = 128;

/**
 * True si un id de ruta es seguro para match + path.join.
 * Espejo de `isSafeRouteId` de routing/ (ver C7 en el header). Puro, nunca lanza.
 */
function isSafeJobRouteId(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > MAX_JOB_ROUTE_ID_LEN) return false;
    if (id.trim().length === 0) return false;
    if (id === "." || id === "..") return false;
    if (id.includes("..")) return false;
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
    if (RESERVED_JOB_ROUTE_IDS.has(id)) return false;
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) {
        if (decoded.includes("..")) return false;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return false;
        if (decoded === "." || decoded === "..") return false;
        if (RESERVED_JOB_ROUTE_IDS.has(decoded)) return false;
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
 * Segmentos de un pathname (`/a/b` → ["a","b"]). Null si no es un pathname
 * absoluto válido (con query/hash, sin `/` inicial, >6 segmentos).
 * Puro, nunca lanza. Cota C1: ≤6 segmentos útiles.
 */
function splitJobPath(pathname: unknown): string[] | null {
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
 * GET /factory/health (espejo del bloque HEALTH del server). Puro, nunca lanza.
 */
export function isHealthRoute(method: unknown, pathname: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/health";
  } catch {
    return false;
  }
}

/**
 * GET /factory/jobs o GET /work-items (espejo del bloque LIST JOBS).
 * Puro, nunca lanza.
 */
export function isJobsListRoute(method: unknown, pathname: unknown): boolean {
  try {
    return method === "GET" && (pathname === "/factory/jobs" || pathname === "/work-items");
  } catch {
    return false;
  }
}

/** Match ok de detalle (el caller responde 404 honesto si la tienda no tiene el id). */
export interface JobDetailRoute {
  readonly id: string;
  readonly isWorkItemsAlias: boolean;
}

/**
 * GET /factory/jobs/:id o /work-items/:id (espejo del bloque SINGLE JOB).
 * Null ante método erróneo, longitud inexacta o id inseguro/reservado.
 * Puro, nunca lanza.
 */
export function parseJobDetailRoute(method: unknown, pathname: unknown): JobDetailRoute | null {
  try {
    if (method !== "GET") return null;
    const parts = splitJobPath(pathname);
    if (!parts) return null;
    if (parts[0] === "factory") {
      if (parts.length !== 3 || parts[1] !== "jobs") return null;
      const id = parts[2] as string;
      if (!isSafeJobRouteId(id)) return null;
      return { id, isWorkItemsAlias: false };
    }
    if (parts[0] === "work-items") {
      if (parts.length !== 2) return null;
      const id = parts[1] as string;
      if (!isSafeJobRouteId(id)) return null;
      return { id, isWorkItemsAlias: true };
    }
    return null;
  } catch {
    return null;
  }
}

/** Match ok de ruta por id con sufijo (logs/eventos/resultado/build-log). */
export interface JobScopedRoute {
  readonly id: string;
  readonly isWorkItemsAlias: boolean;
}

/**
 * Núcleo compartido: GET + prefijo factory/jobs o work-items + sufijo exacto
 * + longitud exacta (4 factory / 3 alias). El id NO se valida como seguro
 * acá a propósito (paridad con los handlers actuales: el lookup devuelve
 * 404 honesto ante id desconocido). Puro, nunca lanza.
 */
function parseJobScopedSuffix(
  method: unknown,
  pathname: unknown,
  suffix: string,
): JobScopedRoute | null {
  try {
    if (method !== "GET") return null;
    if (typeof pathname !== "string" || !pathname.endsWith(suffix)) return null;
    const want = suffix.slice(1);
    const parts = splitJobPath(pathname);
    if (!parts) return null;
    if (parts[0] === "factory") {
      if (parts.length !== 4 || parts[1] !== "jobs") return null;
      if (parts[3] !== want) return null;
      const id = parts[2] as string;
      if (typeof id !== "string" || id.length === 0) return null;
      return { id, isWorkItemsAlias: false };
    }
    if (parts[0] === "work-items") {
      if (parts.length !== 3) return null;
      if (parts[2] !== want) return null;
      const id = parts[1] as string;
      if (typeof id !== "string" || id.length === 0) return null;
      return { id, isWorkItemsAlias: true };
    }
    return null;
  } catch {
    return null;
  }
}

/** GET .../:id/logs (espejo del bloque LOGS JSON). Puro, nunca lanza. */
export function parseJobLogsRoute(method: unknown, pathname: unknown): JobScopedRoute | null {
  try {
    return parseJobScopedSuffix(method, pathname, "/logs");
  } catch {
    return null;
  }
}

/** GET .../:id/events SSE (espejo del bloque SSE). Puro, nunca lanza. */
export function parseJobEventsRoute(method: unknown, pathname: unknown): JobScopedRoute | null {
  try {
    return parseJobScopedSuffix(method, pathname, "/events");
  } catch {
    return null;
  }
}

/** GET .../:id/result (espejo del bloque Ola 3, rama result). Puro, nunca lanza. */
export function parseJobResultRoute(method: unknown, pathname: unknown): JobScopedRoute | null {
  try {
    return parseJobScopedSuffix(method, pathname, "/result");
  } catch {
    return null;
  }
}

/**
 * GET .../:id/build-log o .../:id/build.log (espejo del bloque Ola 3, rama
 * build-log; los dos sufijos comparten dominio, igual que la tabla).
 * Puro, nunca lanza.
 */
export function parseJobBuildLogRoute(method: unknown, pathname: unknown): JobScopedRoute | null {
  try {
    return (
      parseJobScopedSuffix(method, pathname, "/build-log") ??
      parseJobScopedSuffix(method, pathname, "/build.log")
    );
  } catch {
    return null;
  }
}
