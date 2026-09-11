/**
 * factory/measure/benchmarkRoutes — FASE 3 E1: dominio measure/benchmarks.
 *
 * Dueño E1 en FASE 3 (§2+§3+§4 de docs/MASTER-PLAN-MODULARIDAD.md): este módulo
 * es la puerta del cascarón (`factoryServer.ts`, bloque Rutas measure) hacia
 * benchmarks: parsers puros + validación compuesta de creación + lecturas +
 * ejecución delegada. El server conserva formas/handlers/respuestas; solo el
 * MATCH, la validación y la lectura delegan. Trials siempre secuenciales y
 * fixtures limpiadas: lo garantiza el engine (este dominio no reimplementa).
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`, sin loops ni timers nuevos. El
 *   cap 50 (`BENCHMARK_MAX_TRIALS`) se chequea acá Y en el engine/schema;
 *   1 llamada revisor + 1 por scorer por trial (fórmula `estimateBenchmarkCalls`).
 * - C2 puras fail-safe: cada export con try/catch; loader roto →
 *   Correctness-only honesto (como hoy).
 * - C3 un escritor: la creación/ejecución/persistencia viven en
 *   `measure/benchmarkEngine` (dueño de `.benchmark-results/` + memoria).
 *   Este módulo no escribe nada propio.
 * - C4 disco best-effort: heredado del engine.
 * - C5 aditivo: códigos, textos y formas idénticos a los handlers actuales
 *   (pacts F01–F14 y polling intactos; `scorers` desconocidos → 400 honesto).
 * - C6/C7 vocabulario único, nada duplicado: parsers desde
 *   `measure/benchmarkHttp`, schemas/cotas desde `shared/types/benchmark`,
 *   ejecución desde `measure/benchmarkEngine`, nombres conocidos desde el
 *   loader (cero nombres de modelos/scorers en este archivo).
 * - C8 rutas en tabla: cubre benchmarks-create, benchmarks-list y
 *   benchmark-get de `factory/routing/routeTable.ts` (globales, sin alias).
 * - C10 trazabilidad: cada helper cita su bloque espejo del cascarón.
 *
 * Lista blanca de imports (reparto FASE 3 E1): measure/benchmarkEngine,
 * measure/scorerLoader, shared/types/benchmark. (Parsers vía
 * measure/benchmarkHttp, también measure. Sin workItem: los benchmarks no
 * tocan jobs.)
 * PROHIBIDO: review/triage/spec/runner/notify/definition y sus stores.
 */

import {
  isBenchmarkCreatePath,
  isBenchmarksListPath,
  isSafeBenchmarkRunId,
  parseBenchmarkGetPath,
} from "../../measure/benchmarkHttp";
import type {
  BenchmarkGetPathErr,
  BenchmarkGetPathOk,
} from "../../measure/benchmarkHttp";
import {
  BENCHMARK_FIXTURE_PREFIX,
  createPendingBenchmarkRun,
  deleteBenchmarkRun,
  executeBenchmarkTrials,
  getBenchmarkRun,
  getBenchmarkResultsDir,
  listBenchmarkRuns,
  resolveBenchmarkScorers,
  runBenchmark,
} from "../../measure/benchmarkEngine";
import { listScorers } from "../../measure/scorerLoader";
import {
  BENCHMARK_MAX_TRIALS,
  countBenchmarkTrials,
  estimateBenchmarkCalls,
  validateBenchmarkDefinition,
} from "../../../shared/types/benchmark";
import type { BenchmarkDefinition } from "../../../shared/types/benchmark";

export {
  BENCHMARK_FIXTURE_PREFIX,
  BENCHMARK_MAX_TRIALS,
  countBenchmarkTrials,
  createPendingBenchmarkRun,
  deleteBenchmarkRun,
  estimateBenchmarkCalls,
  executeBenchmarkTrials,
  getBenchmarkResultsDir,
  getBenchmarkRun,
  isBenchmarkCreatePath,
  isBenchmarksListPath,
  isSafeBenchmarkRunId,
  listBenchmarkRuns,
  listScorers,
  parseBenchmarkGetPath,
  resolveBenchmarkScorers,
  runBenchmark,
  validateBenchmarkDefinition,
};
export type { BenchmarkDefinition, BenchmarkGetPathErr, BenchmarkGetPathOk };

export interface BenchmarkCreateOk {
  ok: true;
  def: BenchmarkDefinition;
  total: number;
  scorerNames: string[];
  estimatedCalls: number;
}
export interface BenchmarkCreateErr {
  ok: false;
  code: 400;
  error: string;
}
export type BenchmarkCreate = BenchmarkCreateOk | BenchmarkCreateErr;

/**
 * Validación compuesta de POST /factory/benchmarks (espejo del bloque Ola 12
 * + Ola 18 P1.6 del server, mismo orden y mismos textos):
 * 1. Schema zod + ids únicos → 400 `invalid benchmark: …`.
 * 2. Cap de cuota 50 trials → 400 con el mensaje de cap.
 * 3. Scorers por trial resueltos del loader (nunca hardcodeados); nombres
 *    explícitos desconocidos → 400 honesto que lista los cargados.
 * 4. Estimación honesta trials × (1 + scorers).
 * Nunca lanza (imprevisto → 400 con razón visible).
 */
export function validateBenchmarkCreate(
  body: unknown,
): BenchmarkCreate {
  try {
    let def: BenchmarkDefinition;
    try {
      def = validateBenchmarkDefinition(body);
    } catch (e) {
      return {
        ok: false,
        code: 400,
        error: `invalid benchmark: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
      };
    }
    const total = countBenchmarkTrials(def);
    if (total > BENCHMARK_MAX_TRIALS) {
      return {
        ok: false,
        code: 400,
        error: `benchmark excede el cap (${total} trials > ${BENCHMARK_MAX_TRIALS}): reducí tasks × configs × repetitions`,
      };
    }
    let scorerNames: string[] = [];
    try {
      scorerNames = resolveBenchmarkScorers(def);
    } catch {
      scorerNames = [];
    }
    if (Array.isArray((def as { scorers?: unknown }).scorers)) {
      try {
        const known = new Set(listScorers().map((d) => d.name));
        const unknown = scorerNames.filter((n) => !known.has(n));
        if (unknown.length > 0) {
          return {
            ok: false,
            code: 400,
            error: `scorer desconocido "${unknown[0].slice(0, 60)}" (scorers cargados: ${[...known].join("|") || "ninguno"})`,
          };
        }
      } catch {
        // Loader roto: el engine corre Correctness-only (honesto).
      }
    }
    let estimatedCalls = total;
    try {
      estimatedCalls = estimateBenchmarkCalls(def, scorerNames.length);
    } catch {
      estimatedCalls = total;
    }
    return { ok: true, def, total, scorerNames, estimatedCalls };
  } catch (e) {
    return {
      ok: false,
      code: 400,
      error: `invalid benchmark: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
    };
  }
}
