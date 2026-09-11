/**
 * BenchmarkHttp — Ola 12 Measure.
 * Parseo puro de las 3 rutas globales de benchmarks (testeable sin server
 * vivo). Espejo del estilo de `scorerHttp`/`reviewRaw`: match exacto para las
 * globales, split("/").filter(Boolean) para la parametrizada, `isSafe…`
 * contra traversal. Sin alias work-items: son rutas globales. Nunca lanzan.
 */

/** Ids reservados que nunca son un run válido en la ruta parametrizada. */
const BENCHMARK_RESERVED_IDS = new Set(["benchmarks"]);

/**
 * Verifica que un id de run sea seguro para usar en rutas y en path.join.
 * Espejo de `isSafeJobId`: rechaza vacío, `.`, `..`, `/`, `\`, NUL,
 * traversal codificado y reservados. No exige prefijo `bench-`: un id seguro
 * pero inexistente es 404, no 400.
 */
export function isSafeBenchmarkRunId(id: unknown): boolean {
  try {
    if (typeof id !== "string") return false;
    if (id.length === 0 || id.length > 128) return false;
    if (id.trim().length === 0) return false;
    if (id === "." || id === "..") return false;
    if (id.includes("..")) return false;
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
    if (BENCHMARK_RESERVED_IDS.has(id)) return false;
    try {
      const decoded = decodeURIComponent(id);
      if (decoded !== id) {
        if (decoded.includes("..")) return false;
        if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return false;
        if (decoded === "." || decoded === "..") return false;
        if (BENCHMARK_RESERVED_IDS.has(decoded)) return false;
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
 * True si es GET /factory/benchmarks exacto (lista global, últimos 20).
 * Puro, nunca lanza.
 */
export function isBenchmarksListPath(pathname: unknown, method: unknown): boolean {
  try {
    return method === "GET" && pathname === "/factory/benchmarks";
  } catch {
    return false;
  }
}

/**
 * True si es POST /factory/benchmarks exacto (crea run, fire-and-forget).
 * Puro, nunca lanza.
 */
export function isBenchmarkCreatePath(pathname: unknown, method: unknown): boolean {
  try {
    return method === "POST" && pathname === "/factory/benchmarks";
  } catch {
    return false;
  }
}

export type BenchmarkGetPathOk = { id: string };
export type BenchmarkGetPathErr = { error: string };

/**
 * Parsea el pathname de GET /factory/benchmarks/:id (run completo).
 * - Exactamente 3 segmentos (`factory/benchmarks/:id`); `/factory/benchmarks`
 *   solo (len 2) NO matchea — es la lista.
 * - Rechaza traversal como id inválido.
 */
export function parseBenchmarkGetPath(
  pathname: unknown,
): BenchmarkGetPathOk | BenchmarkGetPathErr {
  if (typeof pathname !== "string") return { error: "invalid pathname" };
  if (!pathname.startsWith("/factory/benchmarks/")) {
    return { error: "not benchmark route" };
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 3) {
    return { error: "unexpected path length for benchmark" };
  }
  if (parts[0] !== "factory" || parts[1] !== "benchmarks") {
    return { error: "not benchmark route" };
  }
  const id = parts[2];
  if (!id) {
    return { error: "missing id for benchmark" };
  }
  if (!isSafeBenchmarkRunId(id)) {
    return { error: `invalid id: ${String(id).slice(0, 60)}` };
  }
  return { id };
}
