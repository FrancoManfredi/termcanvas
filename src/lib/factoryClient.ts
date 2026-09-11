/**
 * factoryClient — FASE 1 E2 (docs/MASTER-PLAN-MODULARIDAD.md §2 FASE 1).
 *
 * Único cliente HTTP del renderer para el daemon factory (un cliente, una red).
 * En F1 es ESQUELETO: existe pero ningún panel lo usa todavía (la migración
 * de paneles es F4; acá NO se migra nada).
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`, cero loops/intervalos/polling
 *   (una sola request por llamada; el timeout es race + AbortController).
 * - C2 fail-safe: toda operación NUNCA lanza; ante red caída, HTTP !ok o
 *   forma inesperada retorna su fallback defensivo con `ok:false`.
 * - C3 un escritor: este archivo es el único dueño de URLs/paths del renderer
 *   (los espejos `*Ui.ts` seguirán importando tipos de `shared/`, no redefinen).
 * - C4 disco best-effort: N/A (cliente puro, sin disco).
 * - C5 aditivo: solo AGREGA; formas de los endpoints y sets intactos.
 * - C6 vocabulario único: los paths espejan la tabla de E1
 *   (`headless-runtime/factory/routing/routeTable.ts`); dirección siempre
 *   toolPolicy→roles, nunca al revés (este archivo no toca roles).
 * - C7 nada duplicado: el discovery vive en `./factoryDiscovery` (se importa,
 *   no se copia); cero literales de puerto/modelo/imagen (el puerto SIEMPRE
 *   viene de discovery o de `opts.port` explícito).
 * - C8 rutas en tabla: cada path acá existe en la tabla de E1 (canónico
 *   `/factory/...`; el alias dual `/work-items/...` lo sigue sirviendo el
 *   server sin que el cliente lo necesite).
 * - C9 builders puros testeables: `factoryUrl` y los parsers son puros.
 * - C10 trazabilidad: cada operación usa una constante de timeout nombrada y
 *   exportada; los tests cubren formas defensivas + timeouts + fetch inyectado.
 * - Las 8: offline total en tests (fetch inyectado, cero red real), mocks solo
 *   en tests, cero LLM real, sin docker, daemon del usuario intacto (este
 *   cliente nunca reinicia nada: solo GETs y POSTs de acciones ya existentes).
 */

import { discoverFactoryPort } from "./factoryDiscovery";

/** Fetch inyectable (los tests pasan mocks; en prod se usa el global). */
export type FactoryFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Opciones de cada operación: fetch inyectado, puerto explícito, timeout. */
export interface FactoryClientOptions {
  fetchFn?: FactoryFetch;
  port?: number | null;
  timeoutMs?: number;
}

// ── Timeouts nombrados (uno por operación; salud con timeout corto) ──

export const FACTORY_HEALTH_TIMEOUT_MS = 1500;
export const FACTORY_JOB_CREATE_TIMEOUT_MS = 10000;
export const FACTORY_JOBS_TIMEOUT_MS = 3000;
export const FACTORY_JOB_DETAIL_TIMEOUT_MS = 3000;
export const FACTORY_JOB_LOGS_TIMEOUT_MS = 3000;
export const FACTORY_JOB_EVENTS_TIMEOUT_MS = 3000;
export const FACTORY_JOB_RESULT_TIMEOUT_MS = 3000;
export const FACTORY_BUILD_LOG_TIMEOUT_MS = 3000;
export const FACTORY_REVIEW_TIMEOUT_MS = 3000;
export const FACTORY_REVIEW_RAW_TIMEOUT_MS = 3000;
export const FACTORY_REVIEW_ACTION_TIMEOUT_MS = 3000;
export const FACTORY_TRIAGE_TIMEOUT_MS = 3000;
export const FACTORY_SPEC_TIMEOUT_MS = 3000;
export const FACTORY_VERIFY_TIMEOUT_MS = 3000;
export const FACTORY_VERIFY_RETRY_TIMEOUT_MS = 3000;
export const FACTORY_SCORERS_TIMEOUT_MS = 3000;
export const FACTORY_SCORES_SUMMARY_TIMEOUT_MS = 3000;
export const FACTORY_JOB_SCORES_TIMEOUT_MS = 3000;
export const FACTORY_MANUAL_SCORE_TIMEOUT_MS = 3000;
export const FACTORY_BENCHMARKS_TIMEOUT_MS = 3000;
export const FACTORY_BENCHMARK_CREATE_TIMEOUT_MS = 10000;
export const FACTORY_BENCHMARK_DETAIL_TIMEOUT_MS = 3000;
export const FACTORY_FAILURES_TIMEOUT_MS = 3000;
export const FACTORY_PROPOSALS_TIMEOUT_MS = 3000;
export const FACTORY_PROPOSAL_DETAIL_TIMEOUT_MS = 3000;
export const FACTORY_PROPOSAL_CREATE_TIMEOUT_MS = 10000;
export const FACTORY_PROPOSAL_DECIDE_TIMEOUT_MS = 10000;
export const FACTORY_NOTIFICATIONS_TIMEOUT_MS = 3000;
export const FACTORY_NOTIFICATION_ACK_TIMEOUT_MS = 3000;
export const FACTORY_DEFINITION_TIMEOUT_MS = 5000;
export const FACTORY_AUTOMATIONS_TIMEOUT_MS = 3000;
export const FACTORY_AUTOMATIONS_TICK_TIMEOUT_MS = 5000;
export const FACTORY_INTEGRATIONS_TIMEOUT_MS = 3000;
export const FACTORY_INTEGRATION_POST_TIMEOUT_MS = 3000;
export const FACTORY_INTEGRATION_WEBHOOK_TIMEOUT_MS = 5000;
export const FACTORY_INTEGRATION_POSTBACK_TIMEOUT_MS = 60000;
export const FACTORY_WORKTREE_DELETE_TIMEOUT_MS = 5000;
/**
 * Discard = teardown completo (gh pr close + git push --delete + branch -D
 * + worktree remove + rm del job): secuencial y con red, así que necesita el
 * tope máximo del cliente (60s) y no los 3s de una acción normal.
 */
export const FACTORY_DISCARD_TIMEOUT_MS = 60000;
export const FACTORY_AGENT_FILE_TIMEOUT_MS = 5000;
export const FACTORY_DEFAULT_TIMEOUT_MS = 3000;

/** Tope del timeout ante `timeoutMs` absurdo (cota C1). */
const FACTORY_TIMEOUT_MAX_MS = 60000;

// ── Sobre de retorno (todas las operaciones lo usan; nunca lanzan) ──

export interface FactoryOk<T> {
  ok: true;
  status: number;
  data: T;
}

export interface FactoryErr<T> {
  ok: false;
  status: number | null;
  data: T;
  error: string;
}

export type FactoryResult<T> = FactoryOk<T> | FactoryErr<T>;

// ── Validadores puros (nunca lanzan) ──

function isValidPort(value: unknown): value is number {
  try {
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 65535
    );
  } catch {
    return false;
  }
}

function isValidTimeout(value: unknown): value is number {
  try {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= FACTORY_TIMEOUT_MAX_MS
    );
  } catch {
    return false;
  }
}

function effectiveTimeout(timeoutMs: unknown, fallback: number): number {
  try {
    return isValidTimeout(timeoutMs) ? Math.floor(timeoutMs) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Id de job/run/propuesta/notificación válido para URL. Puro, nunca lanza.
 * Espejo mínimo de `isSafeRouteId` de E1 (sin importar routing: el cliente
 * solo necesita no construir URLs rotas; el server valida de nuevo).
 */
function isValidId(value: unknown): value is string {
  try {
    if (typeof value !== "string") return false;
    const t = value.trim();
    if (t.length === 0 || t.length > 128) return false;
    if (t === "." || t === ".." || t.includes("..")) return false;
    if (t.includes("/") || t.includes("\\") || t.includes("\0")) return false;
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asArray(value: unknown): unknown[] | null {
  try {
    return Array.isArray(value) ? (value as unknown[]) : null;
  } catch {
    return null;
  }
}

function asNonEmptyString(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const t = value.trim();
    return t.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Mensaje `{error}` del server si lo trae (enriquece el `error`, nunca lanza). */
function serverErrorOf(json: unknown): string | null {
  try {
    const rec = asRecord(json);
    const err = rec ? rec.error : null;
    return typeof err === "string" && err.trim().length > 0
      ? err.trim().slice(0, 200)
      : null;
  } catch {
    return null;
  }
}

// ── Núcleo (puro en URLs; red solo vía fetch inyectado) ──

/**
 * Builder puro de URL: puerto por discovery (jamás literal) + path canónico
 * de la tabla de E1. `""` si el puerto es inválido (el caller retorna
 * fallback sin red). Puro, nunca lanza.
 */
export function factoryUrl(port: number, path: string): string {
  try {
    if (!isValidPort(port)) return "";
    if (typeof path !== "string" || path.length === 0 || path[0] !== "/") return "";
    if (path.includes("..") || path.includes("\\")) return "";
    return `http://127.0.0.1:${port}${path}`;
  } catch {
    return "";
  }
}

/** Puerto efectivo: explícito válido > discovery > null. Nunca lanza. */
async function resolvePort(explicit?: number | null): Promise<number | null> {
  try {
    if (explicit === undefined || explicit === null) {
      try {
        return await discoverFactoryPort();
      } catch {
        return null;
      }
    }
    return isValidPort(explicit) ? explicit : null;
  } catch {
    return null;
  }
}

/** Fetch efectivo: inyectado > global > null. Nunca lanza. */
function resolveFetch(fetchFn?: FactoryFetch): FactoryFetch | null {
  try {
    if (typeof fetchFn === "function") return fetchFn;
    const g = (globalThis as unknown as { fetch?: unknown }).fetch;
    return typeof g === "function" ? (g as FactoryFetch) : null;
  } catch {
    return null;
  }
}

interface RawResponse {
  status: number | null;
  json: unknown;
  text: string;
  transportError: string | null;
}

/**
 * Una request con timeout por race + AbortController (el race cubre mocks
 * que ignoran la señal; el signal cancela el fetch real). Nunca lanza.
 */
async function requestRaw(
  url: string,
  init: RequestInit,
  fetchFn: FactoryFetch,
  timeoutMs: number,
  label: string,
): Promise<RawResponse> {
  const ms = effectiveTimeout(timeoutMs, FACTORY_DEFAULT_TIMEOUT_MS);
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const started = fetchFn(url, { ...init, signal: ctrl.signal });
    const res = await new Promise<Response>((resolve, reject) => {
      timer = setTimeout(() => {
        try {
          ctrl.abort();
        } catch {
          // noop: abort best-effort
        }
        reject(new Error(`${label} timeout`));
      }, ms);
      started.then(resolve, reject);
    });
    const status =
      res && typeof (res as Response).status === "number"
        ? (res as Response).status
        : null;
    let text = "";
    try {
      text = await (res as Response).text();
    } catch {
      text = "";
    }
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = null;
      }
    }
    return { status, json, text, transportError: null };
  } catch (e) {
    return {
      status: null,
      json: null,
      text: "",
      transportError: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  } finally {
    if (timer !== null) {
      try {
        clearTimeout(timer);
      } catch {
        // noop
      }
    }
  }
}

function transportFail<T>(data: T, transportError: string | null): FactoryErr<T> {
  return {
    ok: false,
    status: null,
    data,
    error: transportError ?? "factory no disponible",
  };
}

function httpFail<T>(status: number, data: T, json: unknown, fallback: string): FactoryErr<T> {
  return {
    ok: false,
    status,
    data,
    error: serverErrorOf(json) ?? `${fallback} → ${status}`,
  };
}

function badShape<T>(status: number, data: T, label: string): FactoryErr<T> {
  return { ok: false, status, data, error: `${label}: forma inesperada` };
}

function isHttpOk(status: number | null): status is number {
  try {
    return typeof status === "number" && status >= 200 && status <= 299;
  } catch {
    return false;
  }
}

interface Prepared {
  port: number | null;
  fetchFn: FactoryFetch | null;
  timeoutMs: number;
}

/** Prepara puerto+fetch+timeout de cada operación. Nunca lanza. */
async function prepare(
  opts: FactoryClientOptions | undefined,
  fallbackTimeout: number,
): Promise<Prepared> {
  try {
    const o = (opts ?? {}) as FactoryClientOptions;
    const timeoutMs = effectiveTimeout(o.timeoutMs, fallbackTimeout);
    const fetchFn = resolveFetch(o.fetchFn);
    if (fetchFn === null) return { port: null, fetchFn: null, timeoutMs };
    const port = await resolvePort(o.port);
    return { port, fetchFn, timeoutMs };
  } catch {
    return { port: null, fetchFn: null, timeoutMs: fallbackTimeout };
  }
}

function unavailable<T>(data: T): FactoryErr<T> {
  return { ok: false, status: null, data, error: "factory no disponible" };
}

function invalidId<T>(data: T): FactoryErr<T> {
  return { ok: false, status: null, data, error: "id inválido" };
}

function postJsonInit(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
  };
}

// ── Salud (timeout corto) ──

/**
 * GET /factory/health (timeout corto). Fallback `null`, nunca lanza.
 */
export async function getFactoryHealth(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown> | null>> {
  try {
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_HEALTH_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(null);
    const url = factoryUrl(port, "/factory/health");
    if (!url) return unavailable(null);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/health");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(null, raw.transportError);
      return httpFail(raw.status as number, null, raw.json, "GET /factory/health");
    }
    const rec = asRecord(raw.json);
    if (!rec) return badShape(raw.status as number, null, "GET /factory/health");
    return { ok: true, status: raw.status as number, data: rec };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Jobs: crear ──

export interface FactoryJobCreateInput {
  prompt: unknown;
  worktree: unknown;
  phase?: unknown;
  modelRef?: unknown;
  reviewerRef?: unknown;
  /**
   * REQUIRED link to the GitHub issue this job resolves. Every factory job
   * starts from Resolve Issue — without it the daemon 400s (no branch
   * `issue-N`, no handoff PR, the work would strand in the worktree).
   * Shape: `{provider: "github", issueNumber, repo, url}`.
   */
  issueRef: unknown;
}

export interface FactoryJobCreated {
  id: string | null;
  raw: unknown;
}

/**
 * POST /factory/jobs (body `{prompt, worktree, phase?, modelRef?,
 * reviewerRef?, issueRef}` — issueRef REQUIRED, the daemon 400s without
 * it). Canonical path from the E1 route table (`jobs-create`). Fallback
 * `{id: null}`, never throws.
 *
 * Fail-closed on missing prompt/worktree/issueRef (no network touched);
 * the daemon re-validates everything.
 */
export async function createFactoryJob(
  input: FactoryJobCreateInput,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryJobCreated>> {
  try {
    const fallback: FactoryJobCreated = { id: null, raw: null };
    const rec = asRecord(input as unknown);
    const prompt = typeof rec?.prompt === "string" ? rec.prompt.trim() : "";
    const worktree =
      typeof rec?.worktree === "string" ? rec.worktree.trim() : "";
    if (prompt.length === 0) {
      return { ok: false, status: null, data: fallback, error: "prompt is required" };
    }
    if (worktree.length === 0) {
      return { ok: false, status: null, data: fallback, error: "worktree is required" };
    }
    const refValue = asRecord((rec as Record<string, unknown>).issueRef);
    if (refValue === null) {
      return {
        ok: false,
        status: null,
        data: fallback,
        error:
          "issueRef is required: create factory jobs from Resolve Issue (linked GitHub issue)",
      };
    }
    const body: Record<string, unknown> = { prompt, worktree, issueRef: refValue };
    const phase =
      typeof rec?.phase === "string" && rec.phase.trim().length > 0
        ? rec.phase.trim().slice(0, 64)
        : null;
    if (phase !== null) body.phase = phase;
    for (const key of ["modelRef", "reviewerRef"] as const) {
      try {
        const value = asRecord((rec as Record<string, unknown>)[key]);
        if (value !== null) body[key] = value;
      } catch {
        // a broken optional ref is omitted, never breaks the create
      }
    }
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_JOB_CREATE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/jobs");
    if (!url) return unavailable(fallback);
    const label = "POST /factory/jobs";
    const raw = await requestRaw(url, postJsonInit(body), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) {
        return transportFail(fallback, raw.transportError);
      }
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const resp = asRecord(raw.json);
    const createdId = asNonEmptyString(resp?.id);
    if (!resp || createdId === null) {
      return badShape(raw.status as number, { id: null, raw: raw.json }, label);
    }
    return {
      ok: true,
      status: raw.status as number,
      data: { id: createdId, raw: raw.json },
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { id: null, raw: null },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Jobs: listar + detalle ──

/**
 * GET /factory/jobs. Acepta `{jobs|workItems: []}` o array directo.
 * Fallback `[]`, nunca lanza.
 */
export async function listFactoryJobs(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown[]>> {
  try {
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_JOBS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable([]);
    const url = factoryUrl(port, "/factory/jobs");
    if (!url) return unavailable([]);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail([], raw.transportError);
      return httpFail(raw.status as number, [], raw.json, "GET /factory/jobs");
    }
    const direct = asArray(raw.json);
    if (direct) return { ok: true, status: raw.status as number, data: direct };
    const rec = asRecord(raw.json);
    const list = asArray(rec?.jobs) ?? asArray(rec?.workItems) ?? asArray(rec?.items);
    if (!list) return badShape(raw.status as number, [], "GET /factory/jobs");
    return { ok: true, status: raw.status as number, data: list };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: [],
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * GET /factory/jobs/:id. Fallback `null`, nunca lanza.
 */
export async function getFactoryJob(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown | null>> {
  try {
    if (!isValidId(id)) return invalidId(null);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_JOB_DETAIL_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(null);
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}`);
    if (!url) return unavailable(null);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(null, raw.transportError);
      return httpFail(raw.status as number, null, raw.json, "GET /factory/jobs/:id");
    }
    const rec = asRecord(raw.json);
    if (!rec) return badShape(raw.status as number, null, "GET /factory/jobs/:id");
    return { ok: true, status: raw.status as number, data: rec };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Jobs: isolated worktree cleanup (T01 explicit-only route) ──

export interface FactoryWorktreeDeleted {
  id: string | null;
  path: string | null;
  state: string | null;
}

function deleteInit(force: boolean): RequestInit {
  return {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(force ? { force: true } : {}),
  };
}

/**
 * DELETE /factory/jobs/:id/worktree (explicit human cleanup only — never
 * automatic. Guards: terminal job + merged/closed PR unless `force`).
 * Success shape `{ok: true, id, path, state: "cleaned"}`; honest
 * 400/404/409/500 fallbacks. Fallback
 * `{id, path: null, state: null}`, never throws.
 */
export async function deleteFactoryJobWorktree(
  id: string,
  opts: FactoryClientOptions & { force?: boolean } = {},
): Promise<FactoryResult<FactoryWorktreeDeleted>> {
  try {
    const trimmed = typeof id === "string" ? id.trim() : "";
    const fallback: FactoryWorktreeDeleted = {
      id: trimmed.length > 0 ? trimmed : null,
      path: null,
      state: null,
    };
    if (!isValidId(id)) return invalidId(fallback);
    const force = (opts as { force?: unknown }).force === true;
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_WORKTREE_DELETE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(trimmed)}/worktree`);
    if (!url) return unavailable(fallback);
    const label = "DELETE /factory/jobs/:id/worktree";
    const raw = await requestRaw(url, deleteInit(force), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const rec = asRecord(raw.json);
    if (!rec || rec.ok !== true) {
      return badShape(raw.status as number, fallback, label);
    }
    return {
      ok: true,
      status: raw.status as number,
      data: {
        id: asNonEmptyString(rec.id) ?? fallback.id,
        path: typeof rec.path === "string" && rec.path.trim().length > 0
          ? (rec.path as string)
          : null,
        state: typeof rec.state === "string" && (rec.state as string).trim().length > 0
          ? (rec.state as string)
          : null,
      },
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { id: null, path: null, state: null },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Jobs: logs / eventos / resultado / build-log ──

/** GET /factory/jobs/:id/logs. Fallback `[]`, nunca lanza. */
export async function getFactoryJobLogs(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown[]>> {
  try {
    if (!isValidId(id)) return invalidId([]);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_JOB_LOGS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable([]);
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/logs`);
    if (!url) return unavailable([]);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id/logs");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail([], raw.transportError);
      return httpFail(raw.status as number, [], raw.json, "GET /factory/jobs/:id/logs");
    }
    const list = asArray(raw.json) ?? asArray(asRecord(raw.json)?.logs);
    if (!list) return badShape(raw.status as number, [], "GET /factory/jobs/:id/logs");
    return { ok: true, status: raw.status as number, data: list };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: [],
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** GET /factory/jobs/:id/events. Fallback `[]`, nunca lanza. */
export async function getFactoryJobEvents(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown[]>> {
  try {
    if (!isValidId(id)) return invalidId([]);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_JOB_EVENTS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable([]);
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/events`);
    if (!url) return unavailable([]);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id/events");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail([], raw.transportError);
      return httpFail(raw.status as number, [], raw.json, "GET /factory/jobs/:id/events");
    }
    const list =
      asArray(raw.json) ??
      asArray(asRecord(raw.json)?.events) ??
      asArray(asRecord(raw.json)?.timeline);
    if (!list) return badShape(raw.status as number, [], "GET /factory/jobs/:id/events");
    return { ok: true, status: raw.status as number, data: list };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: [],
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** GET /factory/jobs/:id/result. Fallback `null`, nunca lanza. */
export async function getFactoryJobResult(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown | null>> {
  try {
    if (!isValidId(id)) return invalidId(null);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_JOB_RESULT_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(null);
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/result`);
    if (!url) return unavailable(null);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id/result");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(null, raw.transportError);
      return httpFail(raw.status as number, null, raw.json, "GET /factory/jobs/:id/result");
    }
    const rec = asRecord(raw.json);
    if (!rec) return badShape(raw.status as number, null, "GET /factory/jobs/:id/result");
    return { ok: true, status: raw.status as number, data: rec };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** GET /factory/jobs/:id/build-log (texto). Fallback `""`, nunca lanza. */
export async function getFactoryBuildLog(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<string>> {
  try {
    if (!isValidId(id)) return invalidId("");
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_BUILD_LOG_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable("");
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/build-log`);
    if (!url) return unavailable("");
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id/build-log");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail("", raw.transportError);
      return httpFail(raw.status as number, "", raw.json, "GET /factory/jobs/:id/build-log");
    }
    return { ok: true, status: raw.status as number, data: raw.text };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: "",
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Review ──

/** GET /factory/jobs/:id/review. Fallback `null`, nunca lanza. */
export async function getFactoryReview(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown> | null>> {
  try {
    if (!isValidId(id)) return invalidId(null);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_REVIEW_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(null);
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/review`);
    if (!url) return unavailable(null);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id/review");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(null, raw.transportError);
      return httpFail(raw.status as number, null, raw.json, "GET /factory/jobs/:id/review");
    }
    const rec = asRecord(raw.json);
    if (!rec) return badShape(raw.status as number, null, "GET /factory/jobs/:id/review");
    return { ok: true, status: raw.status as number, data: rec };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** GET /factory/jobs/:id/review/raw (texto). Fallback `""`, nunca lanza. */
export async function getFactoryReviewRaw(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<string>> {
  try {
    if (!isValidId(id)) return invalidId("");
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_REVIEW_RAW_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable("");
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/review/raw`);
    if (!url) return unavailable("");
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id/review/raw");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail("", raw.transportError);
      return httpFail(raw.status as number, "", raw.json, "GET /factory/jobs/:id/review/raw");
    }
    return { ok: true, status: raw.status as number, data: raw.text };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: "",
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** POST genérico de acción de review (`accept`/`retry`/`retry-review`). Nunca lanza. */
async function postReviewAction(
  id: string,
  action: "accept" | "retry" | "retry-review",
  opts: FactoryClientOptions,
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_REVIEW_ACTION_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/review/${action}`);
    if (!url) return unavailable({});
    const label = `POST /factory/jobs/:id/review/${action}`;
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** POST /factory/jobs/:id/review/accept. Fallback `{}`, nunca lanza. */
export async function postFactoryReviewAccept(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  return postReviewAction(id, "accept", opts);
}

/** POST /factory/jobs/:id/review/retry. Fallback `{}`, nunca lanza. */
export async function postFactoryReviewRetry(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  return postReviewAction(id, "retry", opts);
}

/** POST /factory/jobs/:id/review/retry-review. Fallback `{}`, nunca lanza. */
export async function postFactoryReviewRetryReview(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  return postReviewAction(id, "retry-review", opts);
}

/**
 * POST /factory/jobs/:id/review/rerun (RE-REVISAR: corre el review sobre un
 * job Complete sin mover su status). Fallback `{}`, nunca lanza.
 */
export async function postFactoryReviewRerun(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_REVIEW_ACTION_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/review/rerun`);
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/review/rerun";
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/jobs/:id/discard (NO RETOMAR TRABAJO: teardown completo —
 * cierra el PR sin mergear, borra rama/worktree/archivos/job). El default
 * de timeout es el tope del cliente: el teardown es secuencial y con red.
 * Fallback `{}`, nunca lanza.
 */
export async function postFactoryJobDiscard(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_DISCARD_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/discard`);
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/discard";
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/jobs/:id/merge-notify (body `{prNumber}`). Close-out ante
 * merge del PR de handoff: el daemon lo registra idempotente (sin este
 * aviso el job queda Complete sin constancia del merge). Fallback `{}`,
 * nunca lanza.
 */
export async function notifyFactoryJobMerged(
  id: string,
  prNumber: number,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    if (typeof prNumber !== "number" || !Number.isInteger(prNumber) || prNumber <= 0) {
      return {
        ok: false,
        status: null,
        data: {},
        error: "prNumber must be a positive integer",
      };
    }
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_REVIEW_ACTION_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/merge-notify`);
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/merge-notify";
    const raw = await requestRaw(url, postJsonInit({ prNumber }), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Triage / Spec / Verify ──

/** Limpia respuestas humanas (espejo de `normalizeTriageAnswers`, sin importar UI). */
function cleanAnswers(input: unknown): string[] {
  try {
    if (!Array.isArray(input)) return [];
    return (input as unknown[])
      .filter((item): item is string => typeof item === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.slice(0, 500))
      .slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * POST /factory/jobs/:id/triage/respond (body `{answers}`). Fallback `{}`,
 * nunca lanza.
 */
export async function postFactoryTriageRespond(
  id: string,
  answers: unknown,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_TRIAGE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/triage/respond`);
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/triage/respond";
    const raw = await requestRaw(
      url,
      postJsonInit({ answers: cleanAnswers(answers) }),
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/jobs/:id/spec/reject (body `{feedback?}`). Fallback `{}`,
 * nunca lanza.
 */
export async function postFactorySpecReject(
  id: string,
  feedback: unknown,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_SPEC_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/spec/reject`);
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/spec/reject";
    const clean = typeof feedback === "string" && feedback.trim().length > 0 ? feedback.trim().slice(0, 500) : undefined;
    const raw = await requestRaw(
      url,
      postJsonInit(clean !== undefined ? { feedback: clean } : {}),
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/jobs/:id/resume. Fallback `{}`, nunca lanza.
 */
export async function postFactoryResume(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_SPEC_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/resume`);
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/resume";
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/jobs/:id/spec/approve. Fallback `{}`, nunca lanza.
 */
export async function postFactorySpecApprove(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_SPEC_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/spec/approve`);
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/spec/approve";
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** GET /factory/jobs/:id/verify. Fallback `null`, nunca lanza. */
export async function getFactoryVerify(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown | null>> {
  try {
    if (!isValidId(id)) return invalidId(null);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_VERIFY_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(null);
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/verify`);
    if (!url) return unavailable(null);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id/verify");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(null, raw.transportError);
      return httpFail(raw.status as number, null, raw.json, "GET /factory/jobs/:id/verify");
    }
    const rec = asRecord(raw.json);
    if (!rec) return badShape(raw.status as number, null, "GET /factory/jobs/:id/verify");
    return { ok: true, status: raw.status as number, data: rec };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/jobs/:id/review/verify-retry. Fallback `{}`, nunca lanza.
 */
export async function postFactoryVerifyRetry(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_VERIFY_RETRY_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/review/verify-retry`);
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/review/verify-retry";
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Scorers ──

/**
 * GET /factory/scorers. Acepta `{scorers: []}` o array directo.
 * Fallback `[]`, nunca lanza.
 */
export async function listFactoryScorers(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown[]>> {
  try {
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_SCORERS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable([]);
    const url = factoryUrl(port, "/factory/scorers");
    if (!url) return unavailable([]);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/scorers");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail([], raw.transportError);
      return httpFail(raw.status as number, [], raw.json, "GET /factory/scorers");
    }
    const list = asArray(raw.json) ?? asArray(asRecord(raw.json)?.scorers);
    if (!list) return badShape(raw.status as number, [], "GET /factory/scorers");
    return { ok: true, status: raw.status as number, data: list };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: [],
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * GET /factory/scores/summary. Fallback `{scorers: {}}`, nunca lanza.
 */
export async function getFactoryScoresSummary(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_SCORES_SUMMARY_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({ scorers: {} });
    const url = factoryUrl(port, "/factory/scores/summary");
    if (!url) return unavailable({ scorers: {} });
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/scores/summary");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({ scorers: {} }, raw.transportError);
      return httpFail(raw.status as number, { scorers: {} }, raw.json, "GET /factory/scores/summary");
    }
    const rec = asRecord(raw.json);
    if (!rec || !asRecord(rec.scorers)) {
      return badShape(raw.status as number, { scorers: {} }, "GET /factory/scores/summary");
    }
    return { ok: true, status: raw.status as number, data: rec };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { scorers: {} },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

export interface FactoryJobScores {
  workItemId: string;
  scores: Record<string, unknown>;
}

/**
 * GET /factory/jobs/:id/scores. Fallback `{workItemId, scores: {}}`,
 * nunca lanza.
 */
export async function getFactoryJobScores(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryJobScores>> {
  try {
    if (!isValidId(id)) return invalidId({ workItemId: String(id ?? ""), scores: {} });
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_JOB_SCORES_TIMEOUT_MS);
    const fallback: FactoryJobScores = { workItemId: id.trim(), scores: {} };
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, `/factory/jobs/${encodeURIComponent(id.trim())}/scores`);
    if (!url) return unavailable(fallback);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/jobs/:id/scores");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, "GET /factory/jobs/:id/scores");
    }
    const rec = asRecord(raw.json);
    const scores = asRecord(rec?.scores);
    if (!rec || !scores) {
      return badShape(raw.status as number, fallback, "GET /factory/jobs/:id/scores");
    }
    return {
      ok: true,
      status: raw.status as number,
      data: {
        workItemId: asNonEmptyString(rec.workItemId) ?? id.trim(),
        scores,
      },
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { workItemId: "", scores: {} },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/jobs/:id/scores/:scorer (scoring manual, body `{}`).
 * Fallback `{}`, nunca lanza.
 */
export async function postFactoryManualScore(
  jobId: string,
  scorer: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(jobId) || !isValidId(scorer)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_MANUAL_SCORE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(
      port,
      `/factory/jobs/${encodeURIComponent(jobId.trim())}/scores/${encodeURIComponent(scorer.trim())}`,
    );
    if (!url) return unavailable({});
    const label = "POST /factory/jobs/:id/scores/:scorer";
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Benchmarks ──

export interface FactoryBenchmarkCreated {
  id: string | null;
  raw: unknown;
}

/**
 * POST /factory/benchmarks (body = definition tal cual). Fallback
 * `{id: null}`, nunca lanza.
 */
export async function createFactoryBenchmark(
  definition: unknown,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryBenchmarkCreated>> {
  try {
    const rec = asRecord(definition);
    if (!rec) {
      return { ok: false, status: null, data: { id: null, raw: null }, error: "definition inválida" };
    }
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_BENCHMARK_CREATE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({ id: null, raw: null });
    const url = factoryUrl(port, "/factory/benchmarks");
    if (!url) return unavailable({ id: null, raw: null });
    const label = "POST /factory/benchmarks";
    const raw = await requestRaw(url, postJsonInit(rec), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) {
        return transportFail({ id: null, raw: null }, raw.transportError);
      }
      return httpFail(raw.status as number, { id: null, raw: null }, raw.json, label);
    }
    const body = asRecord(raw.json);
    const createdId = asNonEmptyString(body?.id);
    if (!body || createdId === null) {
      return badShape(raw.status as number, { id: null, raw: raw.json }, label);
    }
    return {
      ok: true,
      status: raw.status as number,
      data: { id: createdId, raw: raw.json },
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { id: null, raw: null },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * GET /factory/benchmarks. Acepta `{runs: []}` o array directo.
 * Fallback `[]`, nunca lanza.
 */
export async function listFactoryBenchmarks(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown[]>> {
  try {
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_BENCHMARKS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable([]);
    const url = factoryUrl(port, "/factory/benchmarks");
    if (!url) return unavailable([]);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/benchmarks");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail([], raw.transportError);
      return httpFail(raw.status as number, [], raw.json, "GET /factory/benchmarks");
    }
    const list = asArray(raw.json) ?? asArray(asRecord(raw.json)?.runs);
    if (!list) return badShape(raw.status as number, [], "GET /factory/benchmarks");
    return { ok: true, status: raw.status as number, data: list };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: [],
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** GET /factory/benchmarks/:id. Fallback `null`, nunca lanza. */
export async function getFactoryBenchmark(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown | null>> {
  try {
    if (!isValidId(id)) return invalidId(null);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_BENCHMARK_DETAIL_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(null);
    const url = factoryUrl(port, `/factory/benchmarks/${encodeURIComponent(id.trim())}`);
    if (!url) return unavailable(null);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/benchmarks/:id");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(null, raw.transportError);
      return httpFail(raw.status as number, null, raw.json, "GET /factory/benchmarks/:id");
    }
    const rec = asRecord(raw.json);
    if (!rec) return badShape(raw.status as number, null, "GET /factory/benchmarks/:id");
    return { ok: true, status: raw.status as number, data: rec };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Failures / Proposals ──

/**
 * GET /factory/improve/failures?scorer=NAME. Acepta `{failures: []}` o array
 * directo. Fallback `[]`, nunca lanza.
 */
export async function listFactoryFailures(
  scorer: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown[]>> {
  try {
    if (!isValidId(scorer)) return invalidId([]);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_FAILURES_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable([]);
    const url = factoryUrl(
      port,
      `/factory/improve/failures?scorer=${encodeURIComponent(scorer.trim())}`,
    );
    if (!url) return unavailable([]);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/improve/failures");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail([], raw.transportError);
      return httpFail(raw.status as number, [], raw.json, "GET /factory/improve/failures");
    }
    const list = asArray(raw.json) ?? asArray(asRecord(raw.json)?.failures);
    if (!list) return badShape(raw.status as number, [], "GET /factory/improve/failures");
    return { ok: true, status: raw.status as number, data: list };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: [],
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * GET /factory/improve/proposals. Acepta `{proposals: []}` o array directo.
 * Fallback `[]`, nunca lanza.
 */
export async function listFactoryProposals(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown[]>> {
  try {
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_PROPOSALS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable([]);
    const url = factoryUrl(port, "/factory/improve/proposals");
    if (!url) return unavailable([]);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/improve/proposals");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail([], raw.transportError);
      return httpFail(raw.status as number, [], raw.json, "GET /factory/improve/proposals");
    }
    const list = asArray(raw.json) ?? asArray(asRecord(raw.json)?.proposals);
    if (!list) return badShape(raw.status as number, [], "GET /factory/improve/proposals");
    return { ok: true, status: raw.status as number, data: list };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: [],
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** GET /factory/improve/proposals/:id. Fallback `null`, nunca lanza. */
export async function getFactoryProposal(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<unknown | null>> {
  try {
    if (!isValidId(id)) return invalidId(null);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_PROPOSAL_DETAIL_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(null);
    const url = factoryUrl(port, `/factory/improve/proposals/${encodeURIComponent(id.trim())}`);
    if (!url) return unavailable(null);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/improve/proposals/:id");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(null, raw.transportError);
      return httpFail(raw.status as number, null, raw.json, "GET /factory/improve/proposals/:id");
    }
    const rec = asRecord(raw.json);
    if (!rec) return badShape(raw.status as number, null, "GET /factory/improve/proposals/:id");
    return { ok: true, status: raw.status as number, data: rec };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

export interface FactoryProposalCreated {
  id: string | null;
  raw: unknown;
}

/**
 * POST /factory/improve/proposals (body `{scorer}`). Fallback `{id: null}`,
 * nunca lanza.
 */
export async function createFactoryProposal(
  scorer: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryProposalCreated>> {
  try {
    if (!isValidId(scorer)) {
      return { ok: false, status: null, data: { id: null, raw: null }, error: "scorer inválido" };
    }
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_PROPOSAL_CREATE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({ id: null, raw: null });
    const url = factoryUrl(port, "/factory/improve/proposals");
    if (!url) return unavailable({ id: null, raw: null });
    const label = "POST /factory/improve/proposals";
    const raw = await requestRaw(
      url,
      postJsonInit({ scorer: scorer.trim() }),
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) {
        return transportFail({ id: null, raw: null }, raw.transportError);
      }
      return httpFail(raw.status as number, { id: null, raw: null }, raw.json, label);
    }
    const body = asRecord(raw.json);
    const createdId = asNonEmptyString(body?.id);
    if (!body || createdId === null) {
      return badShape(raw.status as number, { id: null, raw: raw.json }, label);
    }
    return {
      ok: true,
      status: raw.status as number,
      data: { id: createdId, raw: raw.json },
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { id: null, raw: null },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** POST de decisión de propuesta (`adopt`/`discard`). Nunca lanza. */
async function postProposalDecision(
  id: string,
  decision: "adopt" | "discard" | "retry-analysis",
  opts: FactoryClientOptions,
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    if (!isValidId(id)) return invalidId({});
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_PROPOSAL_DECIDE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(
      port,
      `/factory/improve/proposals/${encodeURIComponent(id.trim())}/${decision}`,
    );
    if (!url) return unavailable({});
    const label = `POST /factory/improve/proposals/:id/${decision}`;
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** POST /factory/improve/proposals/:id/adopt. Fallback `{}`, nunca lanza. */
export async function postFactoryProposalAdopt(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  return postProposalDecision(id, "adopt", opts);
}

/** POST /factory/improve/proposals/:id/discard. Fallback `{}`, nunca lanza. */
export async function postFactoryProposalDiscard(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  return postProposalDecision(id, "discard", opts);
}

/**
 * POST /factory/improve/proposals/:id/retry-analysis (P4c: re-corre el
 * análisis solo si la propuesta está `failed`; resto → 409).
 * Fallback `{}`, nunca lanza.
 */
export async function postFactoryProposalRetryAnalysis(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  return postProposalDecision(id, "retry-analysis", opts);
}

// ── Notificaciones ──

export interface FactoryNotifications {
  notifications: unknown[];
  notificationsEnabled: boolean | null;
  osNotifications: boolean | null;
}

function parseNotificationsBody(json: unknown): FactoryNotifications {
  try {
    const fallback: FactoryNotifications = {
      notifications: [],
      notificationsEnabled: null,
      osNotifications: null,
    };
    const direct = asArray(json);
    if (direct) return { ...fallback, notifications: direct };
    const rec = asRecord(json);
    if (!rec) return fallback;
    const list = asArray(rec.notifications);
    if (!list) return fallback;
    const enabled =
      rec.notificationsEnabled === true
        ? true
        : rec.notificationsEnabled === false
          ? false
          : null;
    const os =
      rec.osNotifications === true ? true : rec.osNotifications === false ? false : null;
    return { notifications: list, notificationsEnabled: enabled, osNotifications: os };
  } catch {
    return { notifications: [], notificationsEnabled: null, osNotifications: null };
  }
}

/**
 * GET /factory/notifications. Fallback con lista vacía y flags `null`,
 * nunca lanza.
 */
export async function listFactoryNotifications(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryNotifications>> {
  try {
    const fallback: FactoryNotifications = {
      notifications: [],
      notificationsEnabled: null,
      osNotifications: null,
    };
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_NOTIFICATIONS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/notifications");
    if (!url) return unavailable(fallback);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/notifications");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, "GET /factory/notifications");
    }
    const parsed = parseNotificationsBody(raw.json);
    if (parsed.notificationsEnabled === null && parsed.osNotifications === null) {
      const rec = asRecord(raw.json);
      if (!rec && !asArray(raw.json)) {
        return badShape(raw.status as number, fallback, "GET /factory/notifications");
      }
    }
    return { ok: true, status: raw.status as number, data: parsed };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { notifications: [], notificationsEnabled: null, osNotifications: null },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/notifications/:id/ack. Fallback `{acked: false}`,
 * nunca lanza.
 */
export async function postFactoryNotificationAck(
  id: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<{ acked: boolean }>> {
  try {
    if (!isValidId(id)) return invalidId({ acked: false });
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_NOTIFICATION_ACK_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({ acked: false });
    const url = factoryUrl(port, `/factory/notifications/${encodeURIComponent(id.trim())}/ack`);
    if (!url) return unavailable({ acked: false });
    const label = "POST /factory/notifications/:id/ack";
    const raw = await requestRaw(url, { method: "POST" }, fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({ acked: false }, raw.transportError);
      return httpFail(raw.status as number, { acked: false }, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: { acked: true } };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { acked: false },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Definition status ──

export interface FactoryDefinitionStatus {
  valid: boolean | null;
  issues: unknown[];
  checkedAt: string;
}

function parseDefinitionBody(json: unknown): FactoryDefinitionStatus {
  try {
    const fallback: FactoryDefinitionStatus = { valid: null, issues: [], checkedAt: "" };
    const rec = asRecord(json);
    if (!rec) return fallback;
    const valid = rec.valid === true ? true : rec.valid === false ? false : null;
    const issues = asArray(rec.issues) ?? [];
    const checkedAt = typeof rec.checkedAt === "string" ? rec.checkedAt : "";
    return { valid, issues, checkedAt };
  } catch {
    return { valid: null, issues: [], checkedAt: "" };
  }
}

/**
 * GET /factory/definition/status. Fallback gris `{valid: null, ...}`
 * (fail-safe visible, espejo de `definitionUi`), nunca lanza.
 */
export async function getFactoryDefinitionStatus(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryDefinitionStatus>> {
  try {
    const fallback: FactoryDefinitionStatus = { valid: null, issues: [], checkedAt: "" };
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_DEFINITION_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/definition/status");
    if (!url) return unavailable(fallback);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/definition/status");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, "GET /factory/definition/status");
    }
    if (!asRecord(raw.json)) {
      return badShape(raw.status as number, fallback, "GET /factory/definition/status");
    }
    return { ok: true, status: raw.status as number, data: parseDefinitionBody(raw.json) };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { valid: null, issues: [], checkedAt: "" },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Automations + Integrations (Wave 14: 4 ops, fail-safe, never throw) ──

export interface FactoryAutomations {
  enabled: boolean | null;
  tickMs: number | null;
  triggers: unknown[];
}

function parseAutomationsBody(json: unknown): FactoryAutomations {
  try {
    const fallback: FactoryAutomations = { enabled: null, tickMs: null, triggers: [] };
    const rec = asRecord(json);
    if (!rec) {
      const direct = asArray(json);
      if (direct) return { ...fallback, triggers: direct };
      return fallback;
    }
    const triggers =
      asArray(rec.triggers) ?? asArray(rec.automations) ?? asArray(rec.items) ?? [];
    const enabled =
      rec.enabled === true ? true : rec.enabled === false ? false : null;
    const tickMs =
      typeof rec.tickMs === "number" && Number.isFinite(rec.tickMs) ? rec.tickMs : null;
    return { enabled, tickMs, triggers };
  } catch {
    return { enabled: null, tickMs: null, triggers: [] };
  }
}

/**
 * GET /factory/automations. Fallback with empty triggers, never throws.
 */
export async function listFactoryAutomations(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryAutomations>> {
  try {
    const fallback: FactoryAutomations = { enabled: null, tickMs: null, triggers: [] };
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AUTOMATIONS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/automations");
    if (!url) return unavailable(fallback);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/automations");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, "GET /factory/automations");
    }
    if (!asRecord(raw.json) && !asArray(raw.json)) {
      return badShape(raw.status as number, fallback, "GET /factory/automations");
    }
    return { ok: true, status: raw.status as number, data: parseAutomationsBody(raw.json) };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { enabled: null, tickMs: null, triggers: [] },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/automations/tick (one bounded manual tick). Fallback `{}`,
 * never throws.
 */
export async function postFactoryAutomationsTick(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<Record<string, unknown>>> {
  try {
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AUTOMATIONS_TICK_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable({});
    const url = factoryUrl(port, "/factory/automations/tick");
    if (!url) return unavailable({});
    const label = "POST /factory/automations/tick";
    const raw = await requestRaw(url, postJsonInit({}), fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail({}, raw.transportError);
      return httpFail(raw.status as number, {}, raw.json, label);
    }
    return { ok: true, status: raw.status as number, data: asRecord(raw.json) ?? {} };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: {},
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

export interface FactoryIntegrationsStatus {
  enabled: boolean | null;
  mode: string | null;
  provider: string | null;
  count: number;
  posts: unknown[];
  live: FactoryIntegrationsLive | null;
}

export interface FactoryIntegrationsLive {
  liveMode: boolean | null;
  provider: string | null;
  hasCredentials: boolean | null;
  allowPostBack: boolean | null;
  filterPresent: boolean | null;
}

function parseIntegrationsLive(value: unknown): FactoryIntegrationsLive | null {
  try {
    const rec = asRecord(value);
    if (!rec) return null;
    const tri = (v: unknown): boolean | null =>
      v === true ? true : v === false ? false : null;
    return {
      liveMode: tri(rec.liveMode),
      provider: typeof rec.provider === "string" && (rec.provider as string).length > 0
        ? (rec.provider as string)
        : null,
      hasCredentials: tri(rec.hasCredentials),
      allowPostBack: tri(rec.allowPostBack),
      filterPresent: tri(rec.filterPresent),
    };
  } catch {
    return null;
  }
}

function parseIntegrationsStatusBody(json: unknown): FactoryIntegrationsStatus {
  try {
    const fallback: FactoryIntegrationsStatus = {
      enabled: null,
      mode: null,
      provider: null,
      count: 0,
      posts: [],
      live: null,
    };
    const rec = asRecord(json);
    const data = asRecord(rec?.data) ?? rec;
    if (!data) return fallback;
    const enabled =
      data.enabled === true ? true : data.enabled === false ? false : null;
    const mode = typeof data.mode === "string" && data.mode.length > 0 ? data.mode : null;
    const provider =
      typeof data.provider === "string" && data.provider.length > 0 ? data.provider : null;
    const posts = asArray(data.posts) ?? [];
    const count =
      typeof data.count === "number" && Number.isFinite(data.count)
        ? Math.max(0, Math.floor(data.count))
        : posts.length;
    return { enabled, mode, provider, count, posts, live: parseIntegrationsLive(data.live) };
  } catch {
    return { enabled: null, mode: null, provider: null, count: 0, posts: [], live: null };
  }
}

/**
 * GET /factory/integrations/status. Fallback gray `{enabled: null, ...}`,
 * never throws.
 */
export async function getFactoryIntegrationsStatus(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryIntegrationsStatus>> {
  try {
    const fallback: FactoryIntegrationsStatus = {
      enabled: null,
      mode: null,
      provider: null,
      count: 0,
      posts: [],
      live: null,
    };
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_INTEGRATIONS_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/integrations/status");
    if (!url) return unavailable(fallback);
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, "GET /factory/integrations/status");
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, "GET /factory/integrations/status");
    }
    if (!asRecord(raw.json)) {
      return badShape(raw.status as number, fallback, "GET /factory/integrations/status");
    }
    return { ok: true, status: raw.status as number, data: parseIntegrationsStatusBody(raw.json) };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { enabled: null, mode: null, provider: null, count: 0, posts: [], live: null },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

export interface FactoryIntegrationTestPost {
  post: unknown | null;
}

/**
 * POST /factory/integrations/test-post (mock only; disabled returns an
 * honest 409 from the server). Fallback `{post: null}`, never throws.
 */
export async function postFactoryIntegrationTestPost(
  input: { title: string; body?: string; jobId?: string | null },
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryIntegrationTestPost>> {
  try {
    const fallback: FactoryIntegrationTestPost = { post: null };
    const title = typeof input?.title === "string" ? input.title.trim() : "";
    if (title.length === 0) {
      return { ok: false, status: null, data: fallback, error: "title is required" };
    }
    const body =
      typeof input?.body === "string" ? input.body.slice(0, 2000) : "";
    const jobId =
      typeof input?.jobId === "string" && input.jobId.trim().length > 0
        ? input.jobId.trim().slice(0, 128)
        : null;
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_INTEGRATION_POST_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/integrations/test-post");
    if (!url) return unavailable(fallback);
    const label = "POST /factory/integrations/test-post";
    const raw = await requestRaw(
      url,
      postJsonInit({ title: title.slice(0, 200), body, jobId }),
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const rec = asRecord(raw.json);
    const post = rec?.post ?? rec?.data ?? null;
    if (!rec || post === null || post === undefined) {
      return badShape(raw.status as number, fallback, label);
    }
    return { ok: true, status: raw.status as number, data: { post } };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { post: null },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Integrations live intake (F1 wiring: webhook-in + post-back, fail-safe) ──

function asStringCapped(value: unknown, max: number): string {
  try {
    return typeof value === "string" ? value.slice(0, max) : "";
  } catch {
    return "";
  }
}

function asStringArrayCapped(value: unknown, itemMax: number, listMax: number): string[] {
  try {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (out.length >= listMax) break;
      if (typeof item === "string" && item.length > 0) out.push(item.slice(0, itemMax));
    }
    return out;
  } catch {
    return [];
  }
}

export interface FactoryIntegrationWebhookIn {
  outcome: string;
  jobId: string | null;
  explain: string;
}

export interface FactoryWebhookInEvent {
  provider?: unknown;
  threadId?: unknown;
  replyTo?: unknown;
  author?: unknown;
  title?: unknown;
  body?: unknown;
  labels?: unknown;
  eventId?: unknown;
}

/**
 * POST /factory/integrations/webhook-in (live intake seam: 201 created,
 * 200 continued/skipped, 400 invalid, 409 live off). Fallback
 * `{outcome: "", jobId: null, explain: ""}`, never throws.
 */
export async function postFactoryIntegrationWebhookIn(
  event: FactoryWebhookInEvent,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryIntegrationWebhookIn>> {
  try {
    const fallback: FactoryIntegrationWebhookIn = { outcome: "", jobId: null, explain: "" };
    const rec = asRecord(event as unknown);
    if (!rec) {
      return { ok: false, status: null, data: fallback, error: "event is required" };
    }
    const provider = asStringCapped(rec.provider, 16);
    const threadId = asStringCapped(rec.threadId, 256).trim();
    const title = asStringCapped(rec.title, 200).trim();
    const eventId = asStringCapped(rec.eventId, 128).trim();
    if (threadId.length === 0 || title.length === 0 || eventId.length === 0) {
      return {
        ok: false,
        status: null,
        data: fallback,
        error: "threadId, title and eventId are required",
      };
    }
    const replyRaw = asStringCapped(rec.replyTo, 256).trim();
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_INTEGRATION_WEBHOOK_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/integrations/webhook-in");
    if (!url) return unavailable(fallback);
    const label = "POST /factory/integrations/webhook-in";
    const raw = await requestRaw(
      url,
      postJsonInit({
        provider: provider === "slack" ? "slack" : "linear",
        threadId,
        replyTo: replyRaw.length > 0 ? replyRaw : null,
        author: asStringCapped(rec.author, 256),
        title,
        body: asStringCapped(rec.body, 2000),
        labels: asStringArrayCapped(rec.labels, 64, 20),
        eventId,
      }),
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const body = asRecord(raw.json);
    const outcome = typeof body?.outcome === "string" ? (body.outcome as string) : "";
    if (!body || outcome.length === 0) {
      return badShape(raw.status as number, fallback, label);
    }
    const jobId = typeof body.jobId === "string" && (body.jobId as string).length > 0
      ? (body.jobId as string)
      : null;
    const explain = typeof body.explain === "string" ? (body.explain as string) : "";
    return { ok: true, status: raw.status as number, data: { outcome, jobId, explain } };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { outcome: "", jobId: null, explain: "" },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

export interface FactoryIntegrationPostBack {
  via: string | null;
  remoteId: string | null;
  note: string;
  attempts: number;
}

export interface FactoryPostBackInput {
  jobId?: unknown;
  threadId?: unknown;
  kind?: unknown;
  title?: unknown;
  body?: unknown;
}

/**
 * POST /factory/integrations/post-back (terminal-state update: 200 posted
 * via live|mock, 400 invalid, 409 post-back off, 500 honest failure past
 * the attempt cap). The timeout (60s) covers the server-side worst case
 * (3 live attempts x 15s). Fallback
 * `{via: null, remoteId: null, note: "", attempts: 0}`, never throws.
 */
export async function postFactoryIntegrationPostBack(
  input: FactoryPostBackInput,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryIntegrationPostBack>> {
  try {
    const fallback: FactoryIntegrationPostBack = { via: null, remoteId: null, note: "", attempts: 0 };
    const rec = asRecord(input as unknown);
    if (!rec) {
      return { ok: false, status: null, data: fallback, error: "post-back is required" };
    }
    const jobId = asStringCapped(rec.jobId, 128).trim();
    const threadId = asStringCapped(rec.threadId, 256).trim();
    const title = asStringCapped(rec.title, 200).trim();
    const kindRaw = asStringCapped(rec.kind, 32).trim();
    const kind = kindRaw === "complete" || kindRaw === "ask_human" ||
        kindRaw === "proposal-ready" || kindRaw === "benchmark-done"
      ? kindRaw
      : "";
    if (jobId.length === 0 || threadId.length === 0 || title.length === 0 || kind.length === 0) {
      return {
        ok: false,
        status: null,
        data: fallback,
        error: "jobId, threadId, kind and title are required",
      };
    }
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_INTEGRATION_POSTBACK_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/integrations/post-back");
    if (!url) return unavailable(fallback);
    const label = "POST /factory/integrations/post-back";
    const raw = await requestRaw(
      url,
      postJsonInit({ jobId, threadId, kind, title, body: asStringCapped(rec.body, 2000) }),
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const body = asRecord(raw.json);
    if (!body) {
      return badShape(raw.status as number, fallback, label);
    }
    const via = typeof body.via === "string" ? (body.via as string) : null;
    const remoteId = typeof body.remoteId === "string" && (body.remoteId as string).length > 0
      ? (body.remoteId as string)
      : null;
    const note = typeof body.note === "string" ? (body.note as string) : "";
    const attempts = typeof body.attempts === "number" && Number.isFinite(body.attempts)
      ? Math.max(0, Math.floor(body.attempts as number))
      : 0;
    return { ok: true, status: raw.status as number, data: { via, remoteId, note, attempts } };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { via: null, remoteId: null, note: "", attempts: 0 },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

// ── Agent files (body real de factory/agents/<name>/agent.md) ──

export interface FactoryAgentBody {
  name: string;
  body: string;
  /**
   * Solo en PUT: false = el daemon no pudo verificar el espejo opencode
   * (local+global); la próxima sesión puede usar el prompt viejo cacheado.
   */
  mirrorSynced?: boolean;
}

/** Agente completo (alta en una pasada + GET extendido): frontmatter aditivo. */
export interface FactoryAgentFull {
  name: string;
  body: string;
  frontmatter: Record<string, unknown>;
  /** Solo en escrituras (ver `FactoryAgentBody.mirrorSynced`). */
  mirrorSynced?: boolean;
}

export interface FactoryAgentCreateInput {
  name: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

function isValidAgentName(value: unknown): value is string {
  try {
    return typeof value === "string" && /^[a-z0-9-]+$/i.test(value.trim()) && value.trim().length <= 64;
  } catch {
    return false;
  }
}

function parseAgentBodyJson(json: unknown): FactoryAgentBody | null {
  try {
    const rec = asRecord(json);
    if (!rec) return null;
    if (typeof rec.body !== "string") return null;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const out: FactoryAgentBody = { name, body: rec.body };
    if (typeof rec.mirrorSynced === "boolean") out.mirrorSynced = rec.mirrorSynced;
    return out;
  } catch {
    return null;
  }
}

function parseAgentFullJson(json: unknown): FactoryAgentFull | null {
  try {
    const rec = asRecord(json);
    if (!rec) return null;
    if (typeof rec.body !== "string") return null;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const frontmatter = asRecord(rec.frontmatter) ?? {};
    const out: FactoryAgentFull = {
      name,
      body: rec.body,
      frontmatter: frontmatter as Record<string, unknown>,
    };
    if (typeof rec.mirrorSynced === "boolean") out.mirrorSynced = rec.mirrorSynced;
    return out;
  } catch {
    return null;
  }
}

/**
 * GET /factory/agents/:name → solo el body (frontmatter oculto).
 * Fallback `{ name, body: "" }` con `ok:false` (offline → la UI usa el seed).
 * Nunca lanza.
 */
export async function getFactoryAgentBody(
  name: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryAgentBody>> {
  try {
    const fallback: FactoryAgentBody = { name: typeof name === "string" ? name.trim() : "", body: "" };
    if (!isValidAgentName(name)) return invalidId(fallback);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AGENT_FILE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, `/factory/agents/${encodeURIComponent(name.trim())}`);
    if (!url) return unavailable(fallback);
    const label = "GET /factory/agents/:name";
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const parsed = parseAgentBodyJson(raw.json);
    if (!parsed) return badShape(raw.status as number, fallback, label);
    return { ok: true, status: raw.status as number, data: parsed };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { name: typeof name === "string" ? name : "", body: "" },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * GET /factory/agents/:name full → { name, body, frontmatter }.
 * Fallback con frontmatter vacío (offline → la UI usa el seed).
 * Nunca lanza.
 */
export async function getFactoryAgentFull(
  name: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryAgentFull>> {
  try {
    const fallback: FactoryAgentFull = { name: typeof name === "string" ? name.trim() : "", body: "", frontmatter: {} };
    if (!isValidAgentName(name)) return invalidId(fallback);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AGENT_FILE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, `/factory/agents/${encodeURIComponent(name.trim())}`);
    if (!url) return unavailable(fallback);
    const label = "GET /factory/agents/:name";
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const parsed = parseAgentFullJson(raw.json);
    if (!parsed) return badShape(raw.status as number, fallback, label);
    return { ok: true, status: raw.status as number, data: parsed };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { name: typeof name === "string" ? name : "", body: "", frontmatter: {} },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * POST /factory/agents `{ name, frontmatter, body }` → 201 alta en una
 * pasada (409 duplicado/2do foreman, 400 inválido). Nunca lanza.
 */
export async function createFactoryAgent(
  input: FactoryAgentCreateInput,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryAgentFull>> {
  try {
    const fallback: FactoryAgentFull = {
      name: typeof input?.name === "string" ? input.name.trim() : "",
      body: typeof input?.body === "string" ? input.body : "",
      frontmatter: {},
    };
    if (!isValidAgentName(input?.name)) return invalidId(fallback);
    if (typeof input?.body !== "string" || input.body.trim().length === 0) {
      return { ok: false, status: null, data: fallback, error: "body vacío: no se creó nada" };
    }
    if (!input?.frontmatter || typeof input.frontmatter !== "object" || Array.isArray(input.frontmatter)) {
      return { ok: false, status: null, data: fallback, error: "frontmatter debe ser un objeto" };
    }
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AGENT_FILE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/agents");
    if (!url) return unavailable(fallback);
    const label = "POST /factory/agents";
    const raw = await requestRaw(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: (input.name as string).trim(), frontmatter: input.frontmatter, body: input.body }),
      },
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !(raw.status === 201 || isHttpOk(raw.status))) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const parsed = parseAgentFullJson(raw.json);
    if (!parsed) return badShape(raw.status as number, fallback, label);
    return { ok: true, status: raw.status as number, data: parsed };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { name: "", body: "", frontmatter: {} },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

export interface FactoryAgentListItem {
  name: string;
  description: string;
  agentType: string;
}

function parseAgentListJson(json: unknown): FactoryAgentListItem[] | null {
  try {
    const rec = asRecord(json);
    if (!rec || !Array.isArray(rec.agents)) return null;
    const out: FactoryAgentListItem[] = [];
    for (const item of rec.agents) {
      const r = asRecord(item);
      if (!r || typeof r.name !== "string" || r.name.trim().length === 0) return null;
      out.push({
        name: r.name.trim(),
        description: typeof r.description === "string" ? r.description : "",
        agentType: typeof r.agentType === "string" ? r.agentType : "",
      });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * GET /factory/agents → lista [{ name, description, agentType }].
 * Fallback [] con `ok:false` (offline → la UI usa los seeds).
 * Nunca lanza.
 */
export async function listFactoryAgents(
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryAgentListItem[]>> {
  try {
    const fallback: FactoryAgentListItem[] = [];
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AGENT_FILE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, "/factory/agents");
    if (!url) return unavailable(fallback);
    const label = "GET /factory/agents";
    const raw = await requestRaw(url, {}, fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const parsed = parseAgentListJson(raw.json);
    if (!parsed) return badShape(raw.status as number, fallback, label);
    return { ok: true, status: raw.status as number, data: parsed };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: [],
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * PUT /factory/agents/:name `{ body?, frontmatter? }` → escribe body y/o
 * frontmatter validados en disco. Nunca lanza.
 */
export async function saveFactoryAgentFull(
  name: string,
  body: string | undefined,
  frontmatter: Record<string, unknown> | undefined,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryAgentFull>> {
  try {
    const fallback: FactoryAgentFull = { name: typeof name === "string" ? name.trim() : "", body: "", frontmatter: {} };
    if (!isValidAgentName(name)) return invalidId(fallback);
    const payload: Record<string, unknown> = {};
    if (body !== undefined) {
      if (typeof body !== "string" || body.trim().length === 0) {
        return { ok: false, status: null, data: fallback, error: "body vacío: no se guardó nada" };
      }
      payload.body = body;
    }
    if (frontmatter !== undefined) {
      if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
        return { ok: false, status: null, data: fallback, error: "frontmatter debe ser un objeto" };
      }
      payload.frontmatter = frontmatter;
    }
    if (Object.keys(payload).length === 0) {
      return { ok: false, status: null, data: fallback, error: "nada para guardar" };
    }
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AGENT_FILE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, `/factory/agents/${encodeURIComponent((name as string).trim())}`);
    if (!url) return unavailable(fallback);
    const label = "PUT /factory/agents/:name";
    const raw = await requestRaw(
      url,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const parsed = parseAgentFullJson(raw.json);
    if (!parsed) return badShape(raw.status as number, fallback, label);
    return { ok: true, status: raw.status as number, data: parsed };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { name: typeof name === "string" ? name : "", body: "", frontmatter: {} },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * DELETE /factory/agents/:name → elimina el agente (los core van 409).
 * Fallback con `ok:false` (offline → nada se toca). Nunca lanza.
 */
export async function deleteFactoryAgent(
  name: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<{ deleted: string }>> {
  try {
    const fallback: { deleted: string } = { deleted: "" };
    if (!isValidAgentName(name)) return invalidId(fallback);
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AGENT_FILE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, `/factory/agents/${encodeURIComponent((name as string).trim())}`);
    if (!url) return unavailable(fallback);
    const label = "DELETE /factory/agents/:name";
    const raw = await requestRaw(url, { method: "DELETE" }, fetchFn, timeoutMs, label);
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const rec = asRecord(raw.json);
    if (!rec || typeof rec.deleted !== "string") return badShape(raw.status as number, fallback, label);
    return { ok: true, status: raw.status as number, data: { deleted: rec.deleted } };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { deleted: "" },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * PUT /factory/agents/:name `{ body }` → escribe solo el body en disco
 * (frontmatter preservado por el daemon). Nunca lanza.
 */
export async function saveFactoryAgentBody(
  name: string,
  body: string,
  opts: FactoryClientOptions = {},
): Promise<FactoryResult<FactoryAgentBody>> {
  try {
    const fallback: FactoryAgentBody = { name: typeof name === "string" ? name.trim() : "", body: "" };
    if (!isValidAgentName(name)) return invalidId(fallback);
    if (typeof body !== "string" || body.trim().length === 0) {
      return { ok: false, status: null, data: fallback, error: "body vacío: no se guardó nada" };
    }
    const { port, fetchFn, timeoutMs } = await prepare(opts, FACTORY_AGENT_FILE_TIMEOUT_MS);
    if (port === null || fetchFn === null) return unavailable(fallback);
    const url = factoryUrl(port, `/factory/agents/${encodeURIComponent(name.trim())}`);
    if (!url) return unavailable(fallback);
    const label = "PUT /factory/agents/:name";
    const raw = await requestRaw(
      url,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) },
      fetchFn,
      timeoutMs,
      label,
    );
    if (raw.transportError !== null || !isHttpOk(raw.status)) {
      if (raw.transportError !== null) return transportFail(fallback, raw.transportError);
      return httpFail(raw.status as number, fallback, raw.json, label);
    }
    const parsed = parseAgentBodyJson(raw.json);
    if (!parsed) return badShape(raw.status as number, fallback, label);
    return { ok: true, status: raw.status as number, data: parsed };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: { name: typeof name === "string" ? name : "", body: "" },
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}
