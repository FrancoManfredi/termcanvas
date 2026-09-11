/**
 * factory/loaders/loadSpec — FASE 3 E2: cargador generico de specs.
 *
 * Dueno E2 en FASE 3 (apartado 2 + apartado 3 + apartado 4 de
 * docs/MASTER-PLAN-MODULARIDAD.md): carga generica de archivos de spec
 * (`factory.yaml` y cualquier spec por ruta) con cache acotada, TTL y
 * fallback en codigo SOLO avisado ante yaml ausente o invalido. El cascaron
 * y `agentLoader` conservan sus formas; este modulo no los redefine, ofrece
 * la primitiva generica que los runners por nombre reutilizan. El bloque
 * Rutas measure de E1 queda intacto.
 *
 * Contrato:
 * - `loadSpecFile` nunca lanza: ante archivo ausente, ilegible o con parse
 *   que lanza, avisa por consola y devuelve el fallback (copia fresca si es
 *   funcion). Retorna `{value, fromFallback}` para que el caller lo haga
 *   VISIBLE (badge o warn), nunca degradacion silenciosa.
 * - Cache con TTL y cap (cotas C1): max 50 entradas, TTL 60s por defecto
 *   (inyectable para tests). La expiracion se chequea en lectura (sin
 *   temporizadores nuevos).
 * - Validacion inyectada: el caller pasa `parse` (puro, lanza ante forma
 *   invalida) y `fallback` (valor o fabrica). Este modulo no conoce schemas
 *   concretos: cero puertos, modelos o imagenes literales aca.
 *
 * Reglas que honra (las 8 de los master plans + C1-C10):
 * - C1 ESM y cotas: ESM puro, cero llamadas dinamicas con cadena, sin
 *   temporizadores, sin recorridos escritos a mano (Map con eviccion de la
 *   primera clave, O(1)).
 * - C2 puras fail-safe: try y catch en cada paso; nunca lanza.
 * - C3 un escritor: no escribe specs (solo LEE); la escritura sigue en los
 *   duenos (motores y escritor unico).
 * - C4 disco best-effort: leer nunca rompe al caller (ausente o corrupto
 *   equivale a fallback avisado).
 * - C5 aditivo: no cambia formas existentes (primitiva nueva, nada se quita).
 * - C6 y C7 vocabulario unico, nada duplicado: no copia parsers concretos
 *   (los inyecta el caller); tipos genericos con `unknown` donde toca.
 * - C8 rutas en tabla: no aplica (loaders, no rutas).
 * - C9 builders puros testeables: la carga es funcion de ruta mas parse mas
 *   fallback, testeable con tmpdirs reales.
 * - C10 trazabilidad: cada helper cita su uso (runners por nombre y yaml).
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
export const LOAD_SPEC_CACHE_MAX = 50;

/** TTL por defecto de la cache en ms (cota C1: sin relecturas calientes). */
export const LOAD_SPEC_DEFAULT_TTL_MS = 60_000;

export interface LoadSpecOptions<T> {
  readonly filePath: unknown;
  readonly parse: (text: string) => T;
  readonly fallback: T | (() => T);
  readonly ttlMs?: unknown;
  readonly warnPrefix?: unknown;
}

export interface LoadSpecResult<T> {
  readonly value: T;
  readonly fromFallback: boolean;
}

interface LoadSpecCacheEntry {
  value: unknown;
  loadedAt: number;
  fromFallback: boolean;
}

const loadSpecCache = new Map<string, LoadSpecCacheEntry>();

function loadSpecTtlOf(ttlMs: unknown): number {
  try {
    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) return LOAD_SPEC_DEFAULT_TTL_MS;
    const n = Math.floor(ttlMs);
    if (n <= 0) return LOAD_SPEC_DEFAULT_TTL_MS;
    return Math.min(n, 600_000);
  } catch {
    return LOAD_SPEC_DEFAULT_TTL_MS;
  }
}

function loadSpecWarnPrefixOf(warnPrefix: unknown): string {
  try {
    if (typeof warnPrefix === "string" && warnPrefix.trim().length > 0) return warnPrefix.trim();
    return "[loaders/loadSpec]";
  } catch {
    return "[loaders/loadSpec]";
  }
}

function loadSpecFallbackOf<T>(fallback: T | (() => T)): T {
  try {
    if (typeof fallback === "function") return (fallback as () => T)();
    return fallback;
  } catch {
    return fallback as T;
  }
}

function loadSpecEvictIfNeeded(): void {
  try {
    if (loadSpecCache.size < LOAD_SPEC_CACHE_MAX) return;
    const first = loadSpecCache.keys().next().value as string | undefined;
    if (typeof first === "string") loadSpecCache.delete(first);
  } catch {
    // nunca lanza
  }
}

/**
 * Carga generica de un archivo de spec con cache, TTL y fallback avisado
 * (espejo del comportamiento de `agentLoader`: ausente o invalido equivale
 * a fallback en codigo con aviso visible). Nunca lanza.
 */
export function loadSpecFile<T>(opts: LoadSpecOptions<T>): LoadSpecResult<T> {
  try {
    const rawPath = opts?.filePath;
    const parse = opts?.parse;
    const ttlMs = loadSpecTtlOf(opts?.ttlMs);
    const prefix = loadSpecWarnPrefixOf(opts?.warnPrefix);
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      try {
        console.warn(`${prefix} ruta ausente, uso fallback en código`);
      } catch {
        // noop
      }
      return { value: loadSpecFallbackOf(opts?.fallback as T | (() => T)), fromFallback: true };
    }
    if (typeof parse !== "function") {
      try {
        console.warn(`${prefix} sin parser válido para ${rawPath}, uso fallback en código`);
      } catch {
        // noop
      }
      return { value: loadSpecFallbackOf(opts?.fallback as T | (() => T)), fromFallback: true };
    }
    const filePath = path.resolve(rawPath.trim());
    const now = Date.now();
    const cached = loadSpecCache.get(filePath);
    if (cached && typeof cached.loadedAt === "number" && now - cached.loadedAt < ttlMs) {
      return { value: cached.value as T, fromFallback: cached.fromFallback === true };
    }
    let text: string | null = null;
    try {
      if (!fs.existsSync(filePath)) {
        try {
          console.warn(`${prefix} ${filePath} ausente, uso fallback en código`);
        } catch {
          // noop
        }
        const value = loadSpecFallbackOf(opts?.fallback as T | (() => T));
        loadSpecEvictIfNeeded();
        loadSpecCache.set(filePath, { value, loadedAt: now, fromFallback: true });
        return { value, fromFallback: true };
      }
      text = fs.readFileSync(filePath, "utf-8");
    } catch (e) {
      try {
        console.warn(
          `${prefix} no se pudo leer ${filePath}, uso fallback en código: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`,
        );
      } catch {
        // noop
      }
      const value = loadSpecFallbackOf(opts?.fallback as T | (() => T));
      loadSpecEvictIfNeeded();
      loadSpecCache.set(filePath, { value, loadedAt: now, fromFallback: true });
      return { value, fromFallback: true };
    }
    try {
      const value = (parse as (text: string) => T)(text as string);
      loadSpecEvictIfNeeded();
      loadSpecCache.set(filePath, { value, loadedAt: now, fromFallback: false });
      return { value, fromFallback: false };
    } catch (e) {
      try {
        console.warn(
          `${prefix} ${filePath} inválido, uso fallback en código: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`,
        );
      } catch {
        // noop
      }
      const value = loadSpecFallbackOf(opts?.fallback as T | (() => T));
      loadSpecEvictIfNeeded();
      loadSpecCache.set(filePath, { value, loadedAt: now, fromFallback: true });
      return { value, fromFallback: true };
    }
  } catch {
    try {
      return { value: loadSpecFallbackOf(opts?.fallback as T | (() => T)), fromFallback: true };
    } catch {
      return { value: opts?.fallback as T, fromFallback: true };
    }
  }
}

/**
 * Resuelve `factory/factory.yaml` bajo un base sin literales de maquina
 * (el caller pasa el base; por defecto jamas se usa aca). Puro, nunca lanza.
 */
export function resolveFactoryYamlPathFrom(baseDir: unknown): string | null {
  try {
    if (typeof baseDir !== "string" || baseDir.trim().length === 0) return null;
    return path.join(path.resolve(baseDir.trim()), "factory", "factory.yaml");
  } catch {
    return null;
  }
}

/** Limpia la cache en memoria (solo para tests). Nunca lanza. */
export function clearLoadSpecCacheForTests(): void {
  try {
    loadSpecCache.clear();
  } catch {
    // noop
  }
}

/** Tamano actual de la cache (solo para tests). Nunca lanza. */
export function loadSpecCacheSizeForTests(): number {
  try {
    return loadSpecCache.size;
  } catch {
    return 0;
  }
}
