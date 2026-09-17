/**
 * factory/health/healthRoutes — FASE 3 E2: dominio health.
 *
 * Dueno E2 en FASE 3 (apartado 2 + apartado 3 + apartado 4 de
 * docs/MASTER-PLAN-MODULARIDAD.md): este modulo construye el snapshot de
 * salud que expone GET /factory/health: pendiente y corriendo, uptime,
 * buildId y puertos. El server conserva formas y handlers y respuestas;
 * solo la construccion del payload delega (los conteos los sigue leyendo el
 * cascaron de sus tiendas hasta FASE 4; este dominio no toca stores).
 * El bloque Rutas measure de E1 queda intacto.
 *
 * Reglas que honra (las 8 de los master plans + C1-C10):
 * - C1 ESM y cotas: ESM puro, cero llamadas dinamicas con cadena, sin
 *   temporizadores nuevos, sin recorridos escritos a mano (cero iteracion:
 *   los conteos llegan ya calculados como numeros).
 * - C2 puras fail-safe: cada export con try y catch; ante entrada rota
 *   retorna ceros mas marcas honestas, nunca lanza hacia el server.
 * - C3 un escritor: este modulo no escribe nada (ni jobs, ni disco, ni
 *   puertos). Solo compone el payload con los valores que le pasa el
 *   cascaron.
 * - C4 disco best-effort: no aplica (cero disco aca; el buildId lo calcula
 *   el cascaron con su helper existente).
 * - C5 aditivo: formas identicas a los handlers actuales (pacts F01-F14 y
 *   polling intactos; ningun campo se quita ni se renombra).
 * - C6 y C7 vocabulario unico, nada duplicado: el payload se construye ACA
 *   y el cascaron lo reenvia tal cual (sin re-mapeos parciales en el server).
 * - C8 rutas en tabla: cubre health de `factory/routing/routeTable.ts`.
 * - C9 builders puros testeables: el snapshot es funcion pura de sus
 *   entradas, testeable sin server vivo y sin red.
 * - C10 trazabilidad: cada helper cita su bloque espejo del cascaron.
 *
 * Lista blanca de imports (reparto FASE 3 E2): utils (aca solo
 * `reviewRaw` para el fallback honesto de buildId cuando el cascaron no
 * puede pasar uno valido).
 * PROHIBIDO: review, triage, spec, measure, runner-executor y sus stores,
 * notify, definitionValidate, agentLoader, VerificationPanel, package.json.
 * Cero puertos, modelos o imagenes literales: todo puerto llega por
 * discovery del cascaron (parametros), nunca como constante aca.
 */

import { buildFallbackBuildId } from "../reviewRaw";

export interface HealthSnapshotInput {
  readonly pending: unknown;
  readonly running: unknown;
  readonly uptime: unknown;
  readonly buildId: unknown;
  readonly version: unknown;
  readonly startedAt: unknown;
  readonly factoryPort: unknown;
  readonly opencodeUrl: unknown;
  readonly opencodeStatus: unknown;
  readonly opencodePort: unknown;
  readonly opencodeUptime: unknown;
  readonly opencodeError?: unknown;
  /** P1: gate efectivo de la ronda post-bot (`resolveBotReconcileGate`). */
  readonly botReconcile?: unknown;
  readonly ts?: unknown;
}

export interface HealthPayload {
  queue: { pending: number; running: number };
  uptime: number;
  version: string;
  ts: string;
  buildId: string;
  startedAt: number;
  factoryPort: number;
  opencode: {
    url: string;
    status: string;
    port: unknown;
    uptime: number;
    error?: string;
  };
  opencodeUrl: string;
  opencodeStatus: string;
  ports: { factory: number; opencode: unknown };
  /** P1: `{enabled, source: "env"|"setting"|"default"|"unknown"}`. */
  botReconcile: { enabled: boolean; source: string };
}

function toCount(value: unknown): number {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    const n = Math.floor(value);
    return n < 0 ? 0 : n;
  } catch {
    return 0;
  }
}

function toUptime(value: unknown): number {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    const n = Math.floor(value);
    return n < 0 ? 0 : n;
  } catch {
    return 0;
  }
}

/** P1: sanitiza el gate recibido (forma `{enabled, source}`); default honesto. */
function toBotReconcileGate(value: unknown): { enabled: boolean; source: string } {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { enabled: false, source: "unknown" };
    }
    const rec = value as Record<string, unknown>;
    const source =
      typeof rec.source === "string" && rec.source.trim().length > 0
        ? rec.source.trim().slice(0, 20)
        : "unknown";
    return { enabled: rec.enabled === true, source };
  } catch {
    return { enabled: false, source: "unknown" };
  }
}

/**
 * Snapshot de salud para GET /factory/health (espejo del bloque HEALTH del
 * cascaron). Recibe conteos ya calculados mas buildId y puertos por
 * discovery del cascaron; no lee stores ni disco ni red. Nunca lanza.
 */
export function buildHealthPayload(input: HealthSnapshotInput): HealthPayload {
  try {
    const pending = toCount(input?.pending);
    const running = toCount(input?.running);
    const uptime = toUptime(input?.uptime);
    const version = typeof input?.version === "string" && input.version.length > 0 ? input.version : "local";
    const ts =
      typeof input?.ts === "string" && input.ts.length > 0 && !Number.isNaN(Date.parse(input.ts))
        ? input.ts
        : new Date().toISOString();
    let buildId = "";
    try {
      buildId = typeof input?.buildId === "string" ? input.buildId.trim() : "";
    } catch {
      buildId = "";
    }
    if (!buildId) {
      try {
        buildId = buildFallbackBuildId(Date.now());
      } catch {
        buildId = "dev-unknown";
      }
    }
    const startedAt =
      typeof input?.startedAt === "number" && Number.isFinite(input.startedAt)
        ? Math.floor(input.startedAt)
        : Date.now();
    const factoryPort =
      typeof input?.factoryPort === "number" && Number.isFinite(input.factoryPort)
        ? Math.floor(input.factoryPort)
        : 0;
    const opencodeUrl = typeof input?.opencodeUrl === "string" ? input.opencodeUrl : "";
    const opencodeStatus = typeof input?.opencodeStatus === "string" ? input.opencodeStatus : "not_started";
    const opencodeUptime = toUptime(input?.opencodeUptime);
    const opencodeError =
      typeof input?.opencodeError === "string" && input.opencodeError.length > 0
        ? input.opencodeError
        : undefined;
    const payload: HealthPayload = {
      queue: { pending, running },
      uptime,
      version,
      ts,
      buildId,
      startedAt,
      factoryPort,
      opencode: {
        url: opencodeUrl,
        status: opencodeStatus,
        port: input?.opencodePort ?? null,
        uptime: opencodeUptime,
        ...(opencodeError ? { error: opencodeError } : {}),
      },
      opencodeUrl,
      opencodeStatus,
      ports: { factory: factoryPort, opencode: input?.opencodePort ?? null },
      botReconcile: toBotReconcileGate(input?.botReconcile),
    };
    return payload;
  } catch {
    try {
      return {
        queue: { pending: 0, running: 0 },
        uptime: 0,
        version: "local",
        ts: new Date().toISOString(),
        buildId: buildFallbackBuildId(Date.now()),
        startedAt: Date.now(),
        factoryPort: 0,
        opencode: { url: "", status: "not_started", port: null, uptime: 0 },
        opencodeUrl: "",
        opencodeStatus: "not_started",
        ports: { factory: 0, opencode: null },
        botReconcile: { enabled: false, source: "unknown" },
      };
    } catch {
      return {
        queue: { pending: 0, running: 0 },
        uptime: 0,
        version: "local",
        ts: new Date().toISOString(),
        buildId: "dev-unknown",
        startedAt: 0,
        factoryPort: 0,
        opencode: { url: "", status: "not_started", port: null, uptime: 0 },
        opencodeUrl: "",
        opencodeStatus: "not_started",
        ports: { factory: 0, opencode: null },
        botReconcile: { enabled: false, source: "unknown" },
      };
    }
  }
}

export interface MinimalHealthSnapshot {
  pending: number;
  running: number;
  uptime: number;
  version: string;
}

/**
 * Resumen minimo pendiente y corriendo mas uptime (espejo del helper
 * `getFactoryHealthSnapshot` del cascaron). Puro, nunca lanza.
 */
export function buildMinimalHealthSnapshot(input: {
  readonly pending: unknown;
  readonly running: unknown;
  readonly uptime: unknown;
  readonly version: unknown;
}): MinimalHealthSnapshot {
  try {
    return {
      pending: toCount(input?.pending),
      running: toCount(input?.running),
      uptime: toUptime(input?.uptime),
      version: typeof input?.version === "string" && input.version.length > 0 ? input.version : "local",
    };
  } catch {
    return { pending: 0, running: 0, uptime: 0, version: "local" };
  }
}
