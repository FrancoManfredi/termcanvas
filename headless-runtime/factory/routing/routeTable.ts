/**
 * Tabla canónica de rutas factory (FASE 1 E1 — routing/).
 *
 * Lista levantada POR LECTURA de `headless-runtime/factory/factoryServer.ts`
 * (handleRequest, líneas ~2613–4429): ningún dominio inventado. Cada fila
 * declara método + path canónico + alias dual + longitud exacta de segmentos
 * + nombre de dominio. El MATCH (`matchRoute`) es la única operación pura
 * método+path→{dominio,id}|no-ruta y nunca lanza.
 *
 * Reglas (MASTER-PLAN-MODULARIDAD.md):
 * - C8 rutas en tabla: el server delega el MATCH en esta tabla; los handlers
 *   siguen donde están (F1 solo mueve el MATCH, C5 aditivo, formas intactas,
 *   pacts F01–F14 intactos).
 * - C2 puras fail-safe: `matchRoute` nunca lanza (try/catch, null = no-ruta).
 * - C1 cotas: UN solo `for` acotado a ROUTE_TABLE.length (≤64 filas) con
 *   retorno temprano; cero while/polling.
 * - C6/C7: dominios en vocabulario único, sin duplicar parsers (usa
 *   `routeParsers.ts`; no importa negocio/disco/red).
 * - ESM puro, cero `require()`.
 */

// ── F3-T3 human-in-the-measure (wiring +0, 2026-09-05) ──
// Cobertura de los 2 seams candidatos, verificada ANTES de agregar filas:
// - proposal-decide-link: CUBIERTO. Decidir desde una notificación compone
//   seams existentes: `improve-proposal-get` (leer), `improve-proposal-adopt` /
//   `improve-proposal-discard` (decidir, humano, 2 clics) y `notifications-ack`
//   (acusar). El enlace id-desde-notificación vive en el engine
//   (`adoptProposalFromNotification` / `discardProposalFromNotification`) y en
//   el panel (SelfImprovementPanel, sin polling nuevo). +0 filas.
// - benchmark-decide-record: SIN cubrir (create/list/get no aceptan una
//   BenchmarkDecision). +0 filas igual en esta tarea: los guards
//   `tests/route-table.test.ts` + `tests/dispatch-table.test.ts` fijan 42
//   filas / 41 dominios (fuera de scope) y el budget God admite +2 líneas sin
//   hogar para cuerpos (sin archivo [N] para cuerpos y engines en
//   solo-lectura). Carry-over declarado: `POST
//   /factory/benchmarks/:id/decision` → `recordBenchmarkDecision` (+1 fila +
//   1 caso + 1 op + lectura en benchmark-get), a ejecutar con su archivo de
//   cuerpos. El panel compone y valida el JSON (BenchmarksPanel, copiado).
// La tabla sigue en 42 filas / 41 dominios; `matchRoute` intacto.
//
// ── P4c retry-analysis (+1, 2026-09-05) ──
// `POST /factory/improve/proposals/:id/retry-analysis` →
// `improve-proposal-retry-analysis` (+1 fila, 43 filas / 42 dominios). El
// cuerpo vive en el dominio (`improvementRoutes.
// handleProposalRetryAnalysisRoute`); el server solo suma 1 `case` (God +1).
// Precedente `retry-review-only`: re-corre SOLO la etapa flakeada (análisis)
// y solo si `status=failed` (resto → 409); tope 1 retry-analysis por
// propuesta (`RETRY_ANALYSIS_MAX`, fila M09 de LOOPS.md).

import {
  hasExactSegmentLength,
  isSafeRouteId,
  isSafeScorerName,
  splitRouteSegments,
} from "./routeParsers";

/** Métodos HTTP que la tabla distingue (el server solo usa GET/POST + OPTIONS aparte). */
export type RouteMethod = "GET" | "POST";

/**
 * Dominios canónicos (uno por handler del server; `job-build-log` cubre los
 * dos sufijos `build-log` + `build.log` del mismo handler).
 */
export type RouteDomain =
  | "health"
  | "jobs-list"
  | "foreman-logs"
  | "jobs-create"
  | "job-detail"
  | "job-logs"
  | "job-events"
  | "job-result"
  | "job-build-log"
  | "job-review"
  | "job-review-raw"
  | "job-review-accept"
  | "job-merge-notify"
  | "job-review-retry"
  | "job-review-retry-review"
  | "job-review-stale"
  | "job-triage-respond"
  | "job-spec-approve"
  | "job-spec-reject"
  | "job-resume"
  | "job-discard"
  | "job-review-rerun"
  | "job-verify-retry"
  | "job-verify"
  | "job-cancel"
  | "job-scores-get"
  | "job-scores-manual"
  | "scorers-list"
  | "scores-summary"
  | "benchmarks-create"
  | "benchmarks-list"
  | "benchmark-get"
  | "improve-failures"
  | "improve-proposals-create"
  | "improve-proposals-list"
  | "improve-proposal-get"
  | "improve-proposal-adopt"
  | "improve-proposal-discard"
  | "improve-proposal-retry-analysis"
  | "notifications-list"
  | "notifications-ack"
  | "definition-status"
  | "dependencies-status"
  | "dependencies-install"
  | "automations-list"
  | "automations-tick"
  | "integrations-status"
  | "integrations-test-post"
  | "integrations-webhook-in"
  | "integrations-post-back";

export type RouteKind = "exact" | "job" | "named" | "ack" | "manual-score";

/**
 * Una fila de la tabla. Para `exact`: `canonical` es el path completo y
 * `canonicalLen` sus segmentos. Para el resto: `canonicalPrefix` (+
 * `aliasPrefix` cuando hay dual) y `suffix` describen la forma; `canonicalLen`
 * / `aliasLen` son las longitudes exactas exigidas (el MATCH las verifica).
 */
export interface RouteTableEntry {
  readonly method: RouteMethod;
  readonly domain: RouteDomain;
  readonly kind: RouteKind;
  /** Path exacto (solo kind=exact) o ejemplo documentado (resto). */
  readonly canonical: string;
  /** Alias dual (solo filas con dual: jobs-list, foreman-logs y las 23 job-*). */
  readonly alias?: string;
  readonly canonicalLen: number;
  readonly aliasLen?: number;
  readonly canonicalPrefix?: string;
  readonly aliasPrefix?: string;
  readonly suffix?: string;
}

/**
 * Tabla completa: 51 filas → 50 dominios (job-build-log comparte dominio en
 * dos filas). Orden: exactas primero, luego sufijos largos antes que cortos
 * (defensa, aunque el MATCH exige sufijo+longitud exactos y el orden no
 * cambia el resultado).
 */
export const ROUTE_TABLE: readonly RouteTableEntry[] = [
  // ── Exactas globales ──
  { method: "GET", domain: "health", kind: "exact", canonical: "/factory/health", canonicalLen: 2 },
  { method: "GET", domain: "jobs-list", kind: "exact", canonical: "/factory/jobs", alias: "/work-items", canonicalLen: 2, aliasLen: 1 },
  { method: "GET", domain: "foreman-logs", kind: "exact", canonical: "/factory/foreman/logs", alias: "/foreman/logs", canonicalLen: 3, aliasLen: 2 },
  { method: "POST", domain: "jobs-create", kind: "exact", canonical: "/factory/jobs", canonicalLen: 2 },
  { method: "GET", domain: "scorers-list", kind: "exact", canonical: "/factory/scorers", canonicalLen: 2 },
  { method: "GET", domain: "scores-summary", kind: "exact", canonical: "/factory/scores/summary", canonicalLen: 3 },
  { method: "POST", domain: "benchmarks-create", kind: "exact", canonical: "/factory/benchmarks", canonicalLen: 2 },
  { method: "GET", domain: "benchmarks-list", kind: "exact", canonical: "/factory/benchmarks", canonicalLen: 2 },
  { method: "GET", domain: "improve-failures", kind: "exact", canonical: "/factory/improve/failures", canonicalLen: 3 },
  { method: "POST", domain: "improve-proposals-create", kind: "exact", canonical: "/factory/improve/proposals", canonicalLen: 3 },
  { method: "GET", domain: "improve-proposals-list", kind: "exact", canonical: "/factory/improve/proposals", canonicalLen: 3 },
  { method: "GET", domain: "notifications-list", kind: "exact", canonical: "/factory/notifications", canonicalLen: 2 },
  { method: "GET", domain: "definition-status", kind: "exact", canonical: "/factory/definition/status", canonicalLen: 3 },
  { method: "GET", domain: "dependencies-status", kind: "exact", canonical: "/factory/dependencies/status", canonicalLen: 3 },
  { method: "POST", domain: "dependencies-install", kind: "exact", canonical: "/factory/dependencies/pr-agent/install", canonicalLen: 4 },
  { method: "GET", domain: "automations-list", kind: "exact", canonical: "/factory/automations", canonicalLen: 2 },
  { method: "POST", domain: "automations-tick", kind: "exact", canonical: "/factory/automations/tick", canonicalLen: 3 },
  { method: "GET", domain: "integrations-status", kind: "exact", canonical: "/factory/integrations/status", canonicalLen: 3 },
  { method: "POST", domain: "integrations-test-post", kind: "exact", canonical: "/factory/integrations/test-post", canonicalLen: 3 },
  { method: "POST", domain: "integrations-webhook-in", kind: "exact", canonical: "/factory/integrations/webhook-in", canonicalLen: 3 },
  { method: "POST", domain: "integrations-post-back", kind: "exact", canonical: "/factory/integrations/post-back", canonicalLen: 3 },
  // ── Nombradas sin alias ──
  { method: "GET", domain: "benchmark-get", kind: "named", canonical: "/factory/benchmarks/:id", canonicalLen: 3, canonicalPrefix: "/factory/benchmarks/", suffix: "" },
  { method: "GET", domain: "improve-proposal-get", kind: "named", canonical: "/factory/improve/proposals/:id", canonicalLen: 4, canonicalPrefix: "/factory/improve/proposals/", suffix: "" },
  { method: "POST", domain: "improve-proposal-adopt", kind: "named", canonical: "/factory/improve/proposals/:id/adopt", canonicalLen: 5, canonicalPrefix: "/factory/improve/proposals/", suffix: "/adopt" },
  { method: "POST", domain: "improve-proposal-discard", kind: "named", canonical: "/factory/improve/proposals/:id/discard", canonicalLen: 5, canonicalPrefix: "/factory/improve/proposals/", suffix: "/discard" },
  { method: "POST", domain: "improve-proposal-retry-analysis", kind: "named", canonical: "/factory/improve/proposals/:id/retry-analysis", canonicalLen: 5, canonicalPrefix: "/factory/improve/proposals/", suffix: "/retry-analysis" },
  { method: "POST", domain: "notifications-ack", kind: "ack", canonical: "/factory/notifications/:id/ack", canonicalLen: 4, canonicalPrefix: "/factory/notifications/", suffix: "/ack" },
  // ── Job-scoped con alias dual factory/jobs ↔ work-items ──
  { method: "POST", domain: "job-verify-retry", kind: "job", canonical: "/factory/jobs/:id/review/verify-retry", alias: "/work-items/:id/review/verify-retry", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/review/verify-retry" },
  { method: "POST", domain: "job-review-retry-review", kind: "job", canonical: "/factory/jobs/:id/review/retry-review", alias: "/work-items/:id/review/retry-review", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/review/retry-review" },
  { method: "GET", domain: "job-review-stale", kind: "job", canonical: "/factory/jobs/:id/review/stale", alias: "/work-items/:id/review/stale", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/review/stale" },
  { method: "POST", domain: "job-triage-respond", kind: "job", canonical: "/factory/jobs/:id/triage/respond", alias: "/work-items/:id/triage/respond", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/triage/respond" },
  { method: "POST", domain: "job-spec-approve", kind: "job", canonical: "/factory/jobs/:id/spec/approve", alias: "/work-items/:id/spec/approve", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/spec/approve" },
  { method: "POST", domain: "job-spec-reject", kind: "job", canonical: "/factory/jobs/:id/spec/reject", alias: "/work-items/:id/spec/reject", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/spec/reject" },
  { method: "POST", domain: "job-resume", kind: "job", canonical: "/factory/jobs/:id/resume", alias: "/work-items/:id/resume", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/resume" },
  { method: "POST", domain: "job-discard", kind: "job", canonical: "/factory/jobs/:id/discard", alias: "/work-items/:id/discard", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/discard" },
  { method: "POST", domain: "job-review-rerun", kind: "job", canonical: "/factory/jobs/:id/review/rerun", alias: "/work-items/:id/review/rerun", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/review/rerun" },
  { method: "GET", domain: "job-review-raw", kind: "job", canonical: "/factory/jobs/:id/review/raw", alias: "/work-items/:id/review/raw", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/review/raw" },
  { method: "POST", domain: "job-review-accept", kind: "job", canonical: "/factory/jobs/:id/review/accept", alias: "/work-items/:id/review/accept", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/review/accept" },
  { method: "POST", domain: "job-merge-notify", kind: "job", canonical: "/factory/jobs/:id/merge-notify", alias: "/work-items/:id/merge-notify", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/merge-notify" },
  { method: "POST", domain: "job-review-retry", kind: "job", canonical: "/factory/jobs/:id/review/retry", alias: "/work-items/:id/review/retry", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/review/retry" },
  { method: "POST", domain: "job-scores-manual", kind: "manual-score", canonical: "/factory/jobs/:id/scores/:scorer", alias: "/work-items/:id/scores/:scorer", canonicalLen: 5, aliasLen: 4, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/scores/" },
  { method: "GET", domain: "job-logs", kind: "job", canonical: "/factory/jobs/:id/logs", alias: "/work-items/:id/logs", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/logs" },
  { method: "GET", domain: "job-events", kind: "job", canonical: "/factory/jobs/:id/events", alias: "/work-items/:id/events", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/events" },
  { method: "GET", domain: "job-result", kind: "job", canonical: "/factory/jobs/:id/result", alias: "/work-items/:id/result", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/result" },
  { method: "GET", domain: "job-build-log", kind: "job", canonical: "/factory/jobs/:id/build-log", alias: "/work-items/:id/build-log", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/build-log" },
  { method: "GET", domain: "job-build-log", kind: "job", canonical: "/factory/jobs/:id/build.log", alias: "/work-items/:id/build.log", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/build.log" },
  { method: "GET", domain: "job-review", kind: "job", canonical: "/factory/jobs/:id/review", alias: "/work-items/:id/review", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/review" },
  { method: "GET", domain: "job-verify", kind: "job", canonical: "/factory/jobs/:id/verify", alias: "/work-items/:id/verify", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/verify" },
  { method: "POST", domain: "job-cancel", kind: "job", canonical: "/factory/jobs/:id/cancel", alias: "/work-items/:id/cancel", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/cancel" },
  { method: "GET", domain: "job-scores-get", kind: "job", canonical: "/factory/jobs/:id/scores", alias: "/work-items/:id/scores", canonicalLen: 4, aliasLen: 3, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "/scores" },
  { method: "GET", domain: "job-detail", kind: "job", canonical: "/factory/jobs/:id", alias: "/work-items/:id", canonicalLen: 3, aliasLen: 2, canonicalPrefix: "/factory/jobs/", aliasPrefix: "/work-items/", suffix: "" },
] as const;

/** MATCH ok: dominio + id/scorer opcionales + marca de alias. */
export interface RouteMatch {
  readonly domain: RouteDomain;
  readonly id?: string;
  readonly scorer?: string;
  readonly isWorkItemsAlias?: boolean;
}

function isMethod(value: unknown): value is RouteMethod {
  try {
    return value === "GET" || value === "POST";
  } catch {
    return false;
  }
}

function tryMatchExact(entry: RouteTableEntry, pathname: string): boolean {
  if (pathname === entry.canonical) return true;
  if (typeof entry.alias === "string" && pathname === entry.alias) return true;
  return false;
}

function extractJobId(parts: string[], isAlias: boolean): string | null {
  try {
    const idx = isAlias ? 1 : 2;
    const raw = parts[idx];
    if (typeof raw !== "string" || raw.length === 0) return null;
    if (!isSafeRouteId(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Operación pura método+path→{dominio,id?}|no-ruta. Nunca lanza: cualquier
 * entrada inválida, método erróneo, longitud inexacta, traversal o sufijo
 * ausente retorna null (no-ruta, el caller responde 404). Cota C1: un solo
 * `for` sobre ≤64 filas con retorno temprano.
 */
export function matchRoute(method: unknown, pathname: unknown): RouteMatch | null {
  try {
    if (!isMethod(method)) return null;
    if (typeof pathname !== "string" || pathname.length === 0 || pathname[0] !== "/") return null;
    if (pathname.includes("?") || pathname.includes("#")) return null;

    // Cota C1: tabla cerrada, iteración acotada con retorno temprano.
    for (const entry of ROUTE_TABLE) {
      if (entry.method !== method) continue;

      if (entry.kind === "exact") {
        if (!tryMatchExact(entry, pathname)) continue;
        // Longitud exacta declarada (defensa: el === ya la garantiza, se verifica igual).
        const parts = splitRouteSegments(pathname);
        if (parts === null) continue;
        const isAlias = typeof entry.alias === "string" && pathname === entry.alias;
        const expected = isAlias ? (entry.aliasLen ?? entry.canonicalLen) : entry.canonicalLen;
        if (!hasExactSegmentLength(parts, expected)) continue;
        return { domain: entry.domain, ...(isAlias ? { isWorkItemsAlias: true as const } : {}) };
      }

      const cPre = entry.canonicalPrefix ?? "";
      const aPre = entry.aliasPrefix;
      const suffix = entry.suffix ?? "";
      const isFactory = cPre.length > 0 && pathname.startsWith(cPre);
      const isAlias = typeof aPre === "string" && aPre.length > 0 && pathname.startsWith(aPre);
      if (!isFactory && !isAlias) continue;

      const parts = splitRouteSegments(pathname);
      if (parts === null) continue;
      const expectedLen = isAlias ? (entry.aliasLen ?? entry.canonicalLen) : entry.canonicalLen;
      if (!hasExactSegmentLength(parts, expectedLen)) continue;

      if (entry.kind === "manual-score") {
        // /factory/jobs/:id/scores/:scorer (len 5) o alias (len 4).
        const segs = "/scores/";
        if (!pathname.includes(segs)) continue;
        const id = extractJobId(parts, isAlias);
        if (id === null) continue;
        const scorerRaw = parts[parts.length - 1];
        // Defensa: el segmento previo debe ser "scores" (longitud ya exacta, pero explícito).
        const scoresIdx = parts.length - 2;
        if (parts[scoresIdx] !== "scores") continue;
        if (!isSafeScorerName(scorerRaw)) continue;
        // No confundir con GET .../scores (ese es otro dominio con len 4/3).
        return { domain: entry.domain, id, scorer: scorerRaw, ...(isAlias ? { isWorkItemsAlias: true as const } : {}) };
      }

      if (entry.kind === "named" || entry.kind === "ack") {
        if (suffix.length > 0 && !pathname.endsWith(suffix)) continue;
        // id = último segmento (named sin sufijo) o anteúltimo (con sufijo /adopt//discard//ack).
        const idx = suffix.length > 0 ? parts.length - 2 : parts.length - 1;
        const raw = parts[idx];
        if (!isSafeRouteId(raw)) continue;
        // Defensa estructural: el último segmento debe ser el sufijo cuando hay.
        if (suffix.length > 0) {
          const last = parts[parts.length - 1];
          const want = suffix.slice(1);
          if (last !== want) continue;
        }
        return { domain: entry.domain, id: raw };
      }

      // kind === "job"
      if (suffix.length === 0) {
        // Detalle: sin sufijo; el id es el último segmento.
        const id = extractJobId(parts, isAlias);
        if (id === null) continue;
        return { domain: entry.domain, id, ...(isAlias ? { isWorkItemsAlias: true as const } : {}) };
      }
      if (!pathname.endsWith(suffix)) continue;
      const id = extractJobId(parts, isAlias);
      if (id === null) continue;
      return { domain: entry.domain, id, ...(isAlias ? { isWorkItemsAlias: true as const } : {}) };
    }
    return null;
  } catch {
    return null;
  }
}

/** Helper pura para tests/vecinas: longitud declarada de un dominio (null si desconocido). */
export function declaredLengthFor(domain: RouteDomain, alias: boolean): number | null {
  try {
    for (const entry of ROUTE_TABLE) {
      if (entry.domain !== domain) continue;
      if (alias && typeof entry.aliasLen === "number") return entry.aliasLen;
      if (!alias) return entry.canonicalLen;
    }
    return null;
  } catch {
    return null;
  }
}
