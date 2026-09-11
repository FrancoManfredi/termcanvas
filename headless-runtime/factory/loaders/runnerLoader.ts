/**
 * factory/loaders/runnerLoader — FASE 3 E2: cargador generico de runners.
 *
 * Dueno E2 en FASE 3 (apartado 2 + apartado 3 + apartado 4 de
 * docs/MASTER-PLAN-MODULARIDAD.md): carga generica de
 * `factory/runners/<name>.yaml` por nombre con cache acotada, TTL,
 * validacion y fallback en codigo SOLO avisado ante yaml ausente o invalido.
 * Un runner nuevo con yaml valido se acepta sin tocar codigo (cero literales
 * de nombres aca). El cascaron y `agentLoader` conservan sus formas; este
 * modulo no los redefine. El bloque Rutas measure de E1 queda intacto.
 *
 * Contrato:
 * - `loadRunnerByName` nunca lanza: nombre inseguro equivale a null sin
 *   leer disco; yaml ausente o invalido con fallback conocido equivale al
 *   fallback con aviso visible; sin fallback conocido equivale a null.
 * - Nombres: `/^[a-z0-9-]+$/i` tras trim, sin `..`, `/`, `\` ni NUL
 *   (rechazo de traversal antes de unir rutas).
 * - Cache por `dir::name` con TTL y cap (cotas C1): max 50 entradas, TTL
 *   60s por defecto (inyectable para tests). Sin temporizadores nuevos.
 * - Validacion inyectada: el caller pasa `parse(text, name)` (puro, lanza
 *   ante forma invalida) y `fallbackFor(name)` (retorna fallback o null).
 *   Este modulo no conoce schemas concretos: cero puertos, modelos o
 *   imagenes literales aca.
 *
 * Reglas que honra (las 8 de los master plans + C1-C10):
 * - C1 ESM y cotas: ESM puro, cero llamadas dinamicas con cadena, sin
 *   temporizadores, sin recorridos escritos a mano.
 * - C2 puras fail-safe: try y catch en cada paso; nunca lanza.
 * - C3 un escritor: no escribe runners (solo LEE); la ejecucion sigue en el
 *   runner dueno.
 * - C4 disco best-effort: leer nunca rompe al caller.
 * - C5 aditivo: primitiva nueva, nada existente se quita ni se renombra.
 * - C6 y C7 vocabulario unico, nada duplicado: no copia el parser concreto
 *   (lo inyecta el caller).
 * - C8 rutas en tabla: no aplica (loaders, no rutas).
 * - C9 builders puros testeables: la carga es funcion de nombre mas dir mas
 *   parse mas fallback, testeable con tmpdirs reales.
 * - C10 trazabilidad: cada helper cita su uso (runners por nombre).
 *
 * Lista blanca de imports (reparto FASE 3 E2): fs (node:fs mas node:path
 * como familia de archivos) mas tipos y roles (reservados; este nucleo
 * generico no necesita importarlos hoy y no arrastra duenos concretos).
 * PROHIBIDO: review, triage, spec, measure, runner-executor y sus stores,
 * notify, definitionValidate, agentLoader, VerificationPanel, package.json.
 */

import fs from "node:fs";
import path from "node:path";

/** Cap dura de entradas en cache (cota C1: nunca crecer sin cota). */
export const RUNNER_LOADER_CACHE_MAX = 50;

/** TTL por defecto de la cache en ms (cota C1). */
export const RUNNER_LOADER_DEFAULT_TTL_MS = 60_000;

export interface RunnerLoaderOptions<T> {
  readonly name: unknown;
  readonly runnersDir: unknown;
  readonly parse: (text: string, name: string) => T;
  readonly fallbackFor: (name: string) => T | null;
  readonly ttlMs?: unknown;
  readonly warnPrefix?: unknown;
}

export interface RunnerLoaderResult<T> {
  readonly value: T | null;
  readonly fromFallback: boolean;
}

interface RunnerLoaderCacheEntry {
  value: unknown;
  loadedAt: number;
  fromFallback: boolean;
}

const runnerLoaderCache = new Map<string, RunnerLoaderCacheEntry>();

/**
 * True si el nombre de runner es seguro para unir rutas (letras, digitos y
 * guion; sin traversal). Puro, nunca lanza.
 */
export function isSafeRunnerName(name: unknown): boolean {
  try {
    if (typeof name !== "string") return false;
    const clean = name.trim();
    if (clean.length === 0 || clean.length > 64) return false;
    if (!/^[a-z0-9-]+$/i.test(clean)) return false;
    if (clean.includes("..")) return false;
    return true;
  } catch {
    return false;
  }
}

function runnerLoaderTtlOf(ttlMs: unknown): number {
  try {
    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) return RUNNER_LOADER_DEFAULT_TTL_MS;
    const n = Math.floor(ttlMs);
    if (n <= 0) return RUNNER_LOADER_DEFAULT_TTL_MS;
    return Math.min(n, 600_000);
  } catch {
    return RUNNER_LOADER_DEFAULT_TTL_MS;
  }
}

function runnerLoaderWarnPrefixOf(warnPrefix: unknown): string {
  try {
    if (typeof warnPrefix === "string" && warnPrefix.trim().length > 0) return warnPrefix.trim();
    return "[loaders/runnerLoader]";
  } catch {
    return "[loaders/runnerLoader]";
  }
}

function runnerLoaderCacheKey(name: string, runnersDir: string): string {
  try {
    return `${path.resolve(runnersDir)}::${name.trim().toLowerCase()}`;
  } catch {
    return `${String(runnersDir)}::${String(name).trim().toLowerCase()}`;
  }
}

function runnerLoaderEvictIfNeeded(): void {
  try {
    if (runnerLoaderCache.size < RUNNER_LOADER_CACHE_MAX) return;
    const first = runnerLoaderCache.keys().next().value as string | undefined;
    if (typeof first === "string") runnerLoaderCache.delete(first);
  } catch {
    // nunca lanza
  }
}

/**
 * Carga generica de un runner por nombre con cache, TTL, validacion y
 * fallback avisado (espejo del comportamiento de `agentLoader.getRunner`:
 * ausente o invalido con nombre conocido equivale a fallback en codigo con
 * aviso; desconocido sin fallback equivale a null). Nunca lanza.
 */
export function loadRunnerByName<T>(opts: RunnerLoaderOptions<T>): RunnerLoaderResult<T> {
  try {
    const prefix = runnerLoaderWarnPrefixOf(opts?.warnPrefix);
    const ttlMs = runnerLoaderTtlOf(opts?.ttlMs);
    const rawName = opts?.name;
    if (!isSafeRunnerName(rawName)) return { value: null, fromFallback: false };
    const name = (rawName as string).trim();
    const rawDir = opts?.runnersDir;
    if (typeof rawDir !== "string" || rawDir.trim().length === 0) return { value: null, fromFallback: false };
    const runnersDir = path.resolve((rawDir as string).trim());
    const parse = opts?.parse;
    const fallbackFor = opts?.fallbackFor;
    if (typeof parse !== "function" || typeof fallbackFor !== "function") {
      return { value: null, fromFallback: false };
    }
    const key = runnerLoaderCacheKey(name, runnersDir);
    const now = Date.now();
    const cached = runnerLoaderCache.get(key);
    if (cached && typeof cached.loadedAt === "number" && now - cached.loadedAt < ttlMs) {
      return { value: cached.value as T | null, fromFallback: cached.fromFallback === true };
    }
    const filePath = path.join(runnersDir, `${name}.yaml`);
    let text: string | null = null;
    try {
      if (!fs.existsSync(filePath)) {
        let fallback: T | null = null;
        try {
          fallback = (fallbackFor as (n: string) => T | null)(name);
        } catch {
          fallback = null;
        }
        if (fallback) {
          try {
            console.warn(`${prefix} runner "${name}" ausente, uso fallback en código`);
          } catch {
            // noop
          }
          runnerLoaderEvictIfNeeded();
          runnerLoaderCache.set(key, { value: fallback, loadedAt: now, fromFallback: true });
          return { value: fallback, fromFallback: true };
        }
        runnerLoaderEvictIfNeeded();
        runnerLoaderCache.set(key, { value: null, loadedAt: now, fromFallback: false });
        return { value: null, fromFallback: false };
      }
      text = fs.readFileSync(filePath, "utf-8");
    } catch (e) {
      let fallback: T | null = null;
      try {
        fallback = (fallbackFor as (n: string) => T | null)(name);
      } catch {
        fallback = null;
      }
      if (fallback) {
        try {
          console.warn(
            `${prefix} runner "${name}" ilegible, uso fallback en código: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`,
          );
        } catch {
          // noop
        }
        runnerLoaderEvictIfNeeded();
        runnerLoaderCache.set(key, { value: fallback, loadedAt: now, fromFallback: true });
        return { value: fallback, fromFallback: true };
      }
      runnerLoaderEvictIfNeeded();
      runnerLoaderCache.set(key, { value: null, loadedAt: now, fromFallback: false });
      return { value: null, fromFallback: false };
    }
    try {
      const value = (parse as (t: string, n: string) => T)(text as string, name);
      runnerLoaderEvictIfNeeded();
      runnerLoaderCache.set(key, { value, loadedAt: now, fromFallback: false });
      return { value, fromFallback: false };
    } catch (e) {
      let fallback: T | null = null;
      try {
        fallback = (fallbackFor as (n: string) => T | null)(name);
      } catch {
        fallback = null;
      }
      if (fallback) {
        try {
          console.warn(
            `${prefix} runner "${name}" inválido, uso fallback en código: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`,
          );
        } catch {
          // noop
        }
        runnerLoaderEvictIfNeeded();
        runnerLoaderCache.set(key, { value: fallback, loadedAt: now, fromFallback: true });
        return { value: fallback, fromFallback: true };
      }
      runnerLoaderEvictIfNeeded();
      runnerLoaderCache.set(key, { value: null, loadedAt: now, fromFallback: false });
      return { value: null, fromFallback: false };
    }
  } catch {
    return { value: null, fromFallback: false };
  }
}

/** Limpia la cache en memoria (solo para tests). Nunca lanza. */
export function clearRunnerLoaderCacheForTests(): void {
  try {
    runnerLoaderCache.clear();
  } catch {
    // noop
  }
}

/** Tamano actual de la cache (solo para tests). Nunca lanza. */
export function runnerLoaderCacheSizeForTests(): number {
  try {
    return runnerLoaderCache.size;
  } catch {
    return 0;
  }
}
