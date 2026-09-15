/**
 * AgentTransport — transporte único de llamadas LLM para los agentes factory.
 *
 * Por qué existe: cada agente (foreman/triage/spec/review/scorer/improvement)
 * tenía su propia copia de `withTimeout` + `withTimeoutRetry` que reenviaba
 * el MISMO prompt a la MISMA sesión cuando el timeout cliente vencía. Como
 * el timeout (12s/20s) era mucho más corto que la latencia real del modelo
 * (~30-50s), el reintento clonaba el mensaje en el transcript y quemaba
 * tokens: el bug de "mensajes duplicados en todas las sesiones".
 *
 * Doctrina (una sola, acá):
 * - Timeout/abort = el modelo sigue pensando → NUNCA reenviar: abortar la
 *   request zombie y fallar limpio (el caller aplica su fallo-sano).
 * - Error de transporte (econn/fetch/UnknownError/`{}`) = la request nunca
 *   se estableció → UN solo reintento con el mismo payload es seguro.
 * - Error de auth/modelo/cuota = el servidor rechazó → nada pendiente:
 *   el caller puede probar otro modelo (nunca reenviar por timeout).
 *
 * Fusible: UN solo `GLOBAL_AGENT_FUSE_MS` para todos los turnos LLM y UN
 * solo `SESSION_CREATE_FUSE_MS` para `session.create` (RPC local). Sin
 * timeouts por fase: el turno vive hasta el fusible, no hasta un capricho
 * de 12s. Puro donde puede, nunca lanza en los helpers de clasificación.
 */

import {
  isFormatUnsupportedError,
  isFormatUnsupportedServer,
  markFormatUnsupportedServer,
  readStructuredRaw,
  stripStructuredFormat,
} from "./structuredOutput";
import {
  extractSessionUsage,
  recordRealUsage,
  type SessionUsage,
} from "../cost/costTracker";

/**
 * Fusible global anti-cuelgue para turnos LLM (único en todo el factory).
 * 10 minutos: cubre reviews con tool loop + contexto grande medidos en vivo
 * (~1min) con margen amplio; un turno colgado de verdad muere acá, no antes.
 */
export const GLOBAL_AGENT_FUSE_MS = 600_000;

/**
 * Fusible global efectivo. `TERMCANVAS_AGENT_FUSE_MS` permite ajustarlo sin
 * recompilar (los turnos del implementer con tool loop y contexto grande
 * pueden superar los 10 min default). Valor inválido/ausente → default.
 */
export function globalAgentFuseMs(): number {
  const raw = Number(process.env.TERMCANVAS_AGENT_FUSE_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : GLOBAL_AGENT_FUSE_MS;
}

/**
 * Fusible para `session.create` (RPC local contra el server efímero o
 * 127.0.0.1: crear una sesión nunca debería tardar; si cuelga, el server
 * está mal y reintentar solo huérfana sesiones vacías).
 */
export const SESSION_CREATE_FUSE_MS = 30_000;

/**
 * True cuando el error es timeout/abort (el modelo seguía pensando).
 * Ante esto está PROHIBIDO reenviar: ver `withTimeoutNoResend`.
 * Puro, nunca lanza.
 */
export function isTimeoutLikeError(value: unknown): boolean {
  try {
    const m = (value instanceof Error ? value.message : String(value ?? "")).toLowerCase();
    return m.includes("timeout") || m.includes("abort");
  } catch {
    return false;
  }
}

/**
 * True cuando el error es de transporte y el reenvío es seguro (la request
 * nunca se estableció del lado del servidor): string vacío, `{}`, econn,
 * fetch, UnknownError, "unexpected server error".
 * NUNCA true ante timeout/abort (el servidor puede estar generando).
 * Puro, nunca lanza.
 */
export function isRetryableTransportError(value: unknown): boolean {
  try {
    if (value == null) return true;
    const s = String(value).trim();
    if (s.length === 0) return true;
    if (s === "{}") return true;
    const m = s.toLowerCase();
    if (m.includes("{}")) return true;
    if (m.includes("timeout") || m.includes("abort")) return false;
    return (
      m.includes("econn") ||
      m.includes("fetch") ||
      m.includes("unknownerror") ||
      m.includes("unexpected server error")
    );
  } catch {
    return false;
  }
}

/**
 * Carrera entre la promesa y el fusible. Un solo intento, cero reintentos.
 * Puro en estructura (el timer siempre se limpia), nunca lanza por sí mismo.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`timeout ${ms}ms ${label}`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout.finally(() => clearTimeout(timer))]);
}

/**
 * UN solo reintento y SOLO ante error de transporte (ver
 * `isRetryableTransportError`). Ante timeout/abort relanza sin reenviar:
 * reenviar clona el mensaje en la sesión y quema tokens duplicados.
 */
export async function withTransportRetry<T>(
  fn: () => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  try {
    return await withTimeout(fn(), ms, label);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isRetryableTransportError(msg)) {
      return await withTimeout(fn(), ms, `${label} retry`);
    }
    throw e;
  }
}

/**
 * Timeout de prompt SIN reenvío idéntico. Un timeout casi siempre es el
 * modelo pensando (thinking alto) — reenviar el MISMO prompt clona el
 * mensaje en la misma sesión y quema tokens duplicados. `onTimeout` aborta
 * la request zombie: sin él el modelo seguiría generando y su respuesta
 * llegaría tarde a una sesión que ya siguió de largo. Retry SOLO ante
 * errores de transporte, nunca timeout/abort.
 */
export async function withTimeoutNoResend<T>(
  fn: () => Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  try {
    return await withTimeout(fn(), ms, label);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTimeoutLikeError(msg)) {
      if (onTimeout) {
        try {
          onTimeout();
        } catch {}
      }
      throw e;
    }
    if (isRetryableTransportError(msg)) {
      return await withTimeout(fn(), ms, `${label} retry`);
    }
    throw e;
  }
}

/**
 * Extrae el texto de respuesta de cualquier forma del SDK (string, `{data}`,
 * `{text|content|output}`, `parts[]`, `info.parts[]`, lista de mensajes con
 * rol assistant). `preferKey` preserva la semántica legacy: el fallback de
 * objeto-serializado solo se devuelve cuando menciona esa key (ej.
 * `"verdict"`, `"decision"`); sin `preferKey` se devuelve igual (tolerante).
 * Puro, nunca lanza.
 */
export function extractSessionText(res: unknown, preferKey?: string): string | null {
  try {
    try {
      const structured = readStructuredRaw(res);
      if (structured !== null) return structured;
    } catch {}
    if (typeof res === "string") return res;
    if (Array.isArray(res)) {
      let found: string | null = null;
      (res as unknown[]).forEach((m) => {
        if (found !== null) return;
        try {
          if (m === null || typeof m !== "object" || Array.isArray(m)) return;
          const rec = m as Record<string, unknown>;
          const info = (rec.info as Record<string, unknown> | undefined) ?? rec;
          const role = (info?.role as string | undefined) ?? (rec.role as string | undefined);
          if (role !== "assistant") return;
          if (typeof info.text === "string") {
            found = info.text;
            return;
          }
          if (typeof rec.text === "string") {
            found = rec.text as string;
            return;
          }
          if (Array.isArray(info.parts)) {
            const t = (info.parts as unknown[])
              .map((p) => ((p as Record<string, unknown>).text as string) || "")
              .filter(Boolean)
              .join("\n");
            if (t) found = t;
          }
        } catch {}
      });
      if (found !== null) return found;
      return null;
    }
    if (!res || typeof res !== "object") return null;
    const obj = res as Record<string, unknown>;
    const data = (obj.data as unknown) ?? res;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.text === "string") return d.text;
      if (typeof d.content === "string") return d.content;
      if (typeof d.output === "string") return d.output;
      if (Array.isArray(d.parts)) {
        const texts = (d.parts as unknown[])
          .map((p) => {
            if (p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string")
              return (p as Record<string, unknown>).text as string;
            if (typeof p === "string") return p;
            return "";
          })
          .filter(Boolean);
        if (texts.length > 0) return texts.join("\n");
      }
      if (d.info && typeof d.info === "object") {
        const info = d.info as Record<string, unknown>;
        if (typeof info.text === "string") return info.text;
        if (Array.isArray(info.parts)) {
          const texts2 = (info.parts as unknown[])
            .map((p) => {
              if (p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string")
                return (p as Record<string, unknown>).text as string;
              return "";
            })
            .filter(Boolean);
          if (texts2.length > 0) return texts2.join("\n");
        }
      }
      const key = typeof preferKey === "string" ? preferKey.trim() : "";
      try {
        const maybe = JSON.stringify(d);
        if (key.length === 0 || maybe.includes(`"${key}"`)) return maybe;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

/** Serializa un payload de error a string (legacy: JSON, fallback String). */
function serializeErrorPayload(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") return serialized.slice(0, 200);
  } catch {
    // cae al String de abajo
  }
  try {
    return String(value).slice(0, 200);
  } catch {
    return null;
  }
}

/**
 * Payload vacío (el SDK devuelve `error: {}` cuando la respuesta no-2xx
 * viene sin body — hey-api hace `finalError = finalError || {}`): el
 * mensaje legacy era literalmente `"{}"`, perdiendo el status HTTP.
 */
function isEmptyErrorPayload(serialized: string): boolean {
  const trimmed = serialized.trim();
  return (
    trimmed === "" ||
    trimmed === "{}" ||
    trimmed === "null" ||
    trimmed === "undefined"
  );
}

/**
 * Describe la respuesta HTTP del result del SDK (`res.response` es el
 * Fetch Response cuando el transporte lo adjunta). Null cuando no hay
 * status legible — nunca inventa. Puro, nunca lanza.
 */
function describeHttpResponse(res: Record<string, unknown>): string | null {
  try {
    const response = res.response;
    if (response === null || typeof response !== "object") return null;
    const status = (response as { status?: unknown }).status;
    if (typeof status !== "number" || !Number.isFinite(status)) return null;
    const statusText = (response as { statusText?: unknown }).statusText;
    const text =
      typeof statusText === "string" && statusText.trim() !== ""
        ? ` ${statusText.trim()}`
        : "";
    return `HTTP ${status}${text}`;
  } catch {
    return null;
  }
}

/**
 * Error embebido en la respuesta (`{error}` o `{data.error}`), recortado a
 * 200 chars. Null cuando la respuesta no trae error. Un payload vacío
 * (`{}` / `""`) cae al status HTTP cuando el result lo trae
 * (`HTTP 500 ... (empty error body)`) — sin esto el incidente #125 reportó
 * `prompt falló: {}` y el status real era invisible. Sin status, conserva
 * el `"{}"` legacy. Puro, nunca lanza.
 */
export function readResultError(res: unknown): string | null {
  try {
    if (!res || typeof res !== "object") return null;
    const obj = res as Record<string, unknown>;
    const http = describeHttpResponse(obj);
    const withHttp = (serialized: string | null): string | null => {
      if (serialized === null) return null;
      if (!isEmptyErrorPayload(serialized)) return serialized;
      return http !== null ? `${http} (empty error body)` : serialized;
    };
    if ("error" in obj && obj.error) {
      return withHttp(serializeErrorPayload(obj.error));
    }
    const maybeData = obj.data as Record<string, unknown> | undefined;
    if (maybeData && typeof maybeData === "object" && "error" in maybeData && maybeData.error) {
      return withHttp(serializeErrorPayload(maybeData.error));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extrae el sessionId de cualquier forma del SDK: string `ses_*`, campos
 * `id`/`sessionID`/`sessionId` (planos, en `data` o anidados en `session`).
 * Null cuando no hay id utilizable. Puro, nunca lanza.
 */
export function parseSessionId(res: unknown): string | null {
  try {
    const pickFrom = (o: unknown): string | null => {
      try {
        if (typeof o === "string" && o.startsWith("ses_")) return o;
        if (!o || typeof o !== "object" || Array.isArray(o)) return null;
        const rec = o as Record<string, unknown>;
        const direct =
          (typeof rec.id === "string" ? rec.id : undefined) ??
          (typeof rec.sessionID === "string" ? rec.sessionID : undefined) ??
          (typeof rec.sessionId === "string" ? rec.sessionId : undefined);
        if (direct) return direct;
        const inner = rec.session;
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
          const inrec = inner as Record<string, unknown>;
          const innerCand =
            (typeof inrec.id === "string" ? inrec.id : undefined) ??
            (typeof inrec.sessionID === "string" ? inrec.sessionID : undefined) ??
            (typeof inrec.sessionId === "string" ? inrec.sessionId : undefined);
          if (innerCand) return innerCand;
        }
        return null;
      } catch {
        return null;
      }
    };
    const direct = pickFrom(res);
    if (direct) return direct;
    if (res && typeof res === "object" && !Array.isArray(res)) {
      const data = (res as Record<string, unknown>).data;
      if (data !== undefined) return pickFrom(data);
    }
    return null;
  } catch {
    return null;
  }
}

/** Resultado de un intento único de prompt: texto o causa. Nunca lanza. */
export interface PromptAttempt {
  raw: string | null;
  lastErr: unknown;
  /**
   * Uso REAL medido por el servidor en este intento (T4, aditivo): incluye
   * skills, MCPs y contexto inicial. Solo presente cuando el servidor lo
   * informó; ausente = solo estimado (forma intacta).
   */
  usage?: SessionUsage | null;
}

/**
 * UN intento de `session.prompt` con la doctrina completa: fusible global
 * (default), abort de la request zombie ante timeout (vía `signal`, que el
 * `call` debe hilar a la llamada SDK), cero reenvíos ante timeout/abort,
 * un solo reintento ante error de transporte, y extracción de texto.
 * El `call` recibe el `AbortSignal` y lo pasa como `{ signal }` a la SDK.
 * T4: con `opts.jobId` se registra el uso real del servidor (best-effort,
 * nunca rompe el intento). Con `opts.sessionId` el anti-acumulado descuenta
 * por sesión (exactitud dashboard: cada sesión opencode informa su propio
 * acumulado); sin sessionId se descuenta por job (compat).
 */
export async function attemptPromptOnce(
  call: (signal: AbortSignal) => Promise<unknown>,
  opts: { ms?: number; label: string; preferKey?: string; jobId?: unknown; sessionId?: unknown },
): Promise<PromptAttempt> {
  const ms = typeof opts.ms === "number" && opts.ms > 0 ? opts.ms : globalAgentFuseMs();
  const label = typeof opts.label === "string" && opts.label.length > 0 ? opts.label : "session.prompt";
  const ctrl = new AbortController();
  try {
    const res = await withTimeoutNoResend(() => call(ctrl.signal), ms, label, () => {
      try {
        ctrl.abort();
      } catch {}
    });
    const errStr = readResultError(res);
    if (errStr) throw new Error(errStr);
    let usage: SessionUsage | null = null;
    try {
      usage = extractSessionUsage(res);
      if (usage && typeof opts.jobId === "string" && opts.jobId.trim().length > 0) {
        const sid = typeof opts.sessionId === "string" && opts.sessionId.length > 0 ? opts.sessionId : undefined;
        recordRealUsage(opts.jobId, usage, sid);
      }
    } catch {
      // la medición nunca rompe el intento
    }
    const out: PromptAttempt = { raw: extractSessionText(res, opts.preferKey), lastErr: null };
    if (usage) out.usage = usage;
    return out;
  } catch (e) {
    return { raw: null, lastErr: e };
  }
}

/**
 * Intento único con fallback de structured output: si el servidor rechaza
 * `body.format` (400 OutputFormat = binario viejo), se memoiza por proceso
 * y se reintenta UNA vez en texto plano en el acto — sin quemar minutos
 * repitiendo el mismo 400. El `payload` trae `format` siempre; este helper
 * decide si sale o se quita. Cualquier otro error sigue su camino
 * (cero reenvíos ante timeout/abort: doctrina `attemptPromptOnce`).
 */
export async function attemptJsonPromptOnce(
  call: (signal: AbortSignal, payload: Record<string, unknown>) => Promise<unknown>,
  opts: { payload: Record<string, unknown>; label: string; preferKey?: string; jobId?: unknown; sessionId?: unknown; ms?: number },
): Promise<PromptAttempt> {
  const first = isFormatUnsupportedServer() ? stripStructuredFormat(opts.payload) : opts.payload;
  const out = await attemptPromptOnce((signal) => call(signal, first), {
    label: opts.label,
    preferKey: opts.preferKey,
    jobId: opts.jobId,
    sessionId: opts.sessionId,
    ...(typeof opts.ms === "number" ? { ms: opts.ms } : {}),
  });
  if (out.raw !== null) return out;
  if (!isFormatUnsupportedServer() && isFormatUnsupportedError(out.lastErr)) {
    markFormatUnsupportedServer();
    try {
      console.warn(`[${opts.label}] servidor opencode sin structured output (400 OutputFormat) → texto plano`);
    } catch {}
    return attemptPromptOnce((signal) => call(signal, stripStructuredFormat(opts.payload)), {
      label: `${opts.label} texto-plano`,
      preferKey: opts.preferKey,
      jobId: opts.jobId,
      sessionId: opts.sessionId,
      ...(typeof opts.ms === "number" ? { ms: opts.ms } : {}),
    });
  }
  return out;
}

// ─── Transporte async (promptAsync + poll) ─────────────────────────────────
//
// Por qué existe: `session.prompt` mantiene el request HTTP abierto durante
// TODO el turno. Un turno largo puede morir del lado del request (incidente
// #125: el implement falló a los ~5m con `prompt falló: {}` — respuesta
// no-2xx sin body — MIENTRAS la sesión seguía corriendo server-side), y el
// engine lo trataba como fallo fatal perdiendo el trabajo. `promptAsync`
// devuelve al instante: el turno se sigue por polling de `session.messages`
// hasta ver la respuesta assistant completa, el fusible global lo acota y
// al vencer `session.abort` frena el turno de verdad (el abort del request
// síncrono dejaba la sesión generando). Mismo contrato de intento único:
// cero reenvíos tras el ack.

/** Superficie mínima del SDK para el transporte async (inyectable en tests). */
export interface AsyncPromptApi {
  promptAsync: (
    params: Record<string, unknown>,
    opts?: unknown,
  ) => Promise<unknown>;
  messages: (
    params: Record<string, unknown>,
    opts?: unknown,
  ) => Promise<unknown>;
  /** Best-effort: frena el turno server-side al vencer el fusible. */
  abort?: (
    params: Record<string, unknown>,
    opts?: unknown,
  ) => Promise<unknown>;
}

export interface AsyncPromptOptions {
  payload: Record<string, unknown>;
  sessionID: string;
  label: string;
  preferKey?: string;
  jobId?: unknown;
  sessionId?: unknown;
  ms?: number;
  /** Cadencia de polling (los tests usan valores chicos). */
  pollIntervalMs?: number;
  /**
   * Abort externo (cancelación del run): corta el poll en el próximo tick y
   * aborta el turno server-side. Sin esto un discard/cancel dejaba la sesión
   * generando hasta el fusible.
   */
  signal?: AbortSignal;
}

/** Cada GET de `messages` vive con su propio timeout corto (RPC local). */
const ASYNC_MESSAGES_TIMEOUT_MS = 15_000;
/** Cadencia de polling por defecto del turno async. */
const ASYNC_POLL_INTERVAL_MS = 1_500;
/** Margen anti-skew para no descartar el assistant recién creado. */
const ASYNC_MESSAGE_SKEW_MS = 5_000;

function asyncMessageInfo(entry: unknown): Record<string, unknown> | null {
  try {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const rec = entry as Record<string, unknown>;
    const info = rec.info;
    if (info && typeof info === "object" && !Array.isArray(info)) {
      return info as Record<string, unknown>;
    }
    return rec;
  } catch {
    return null;
  }
}

function asyncMessageRole(entry: unknown): string | null {
  try {
    const info = asyncMessageInfo(entry);
    return info !== null && typeof info.role === "string" ? info.role : null;
  } catch {
    return null;
  }
}

function asyncMessageCreatedMs(entry: unknown): number | null {
  try {
    const info = asyncMessageInfo(entry);
    if (info === null) return null;
    const time = info.time;
    if (!time || typeof time !== "object" || Array.isArray(time)) return null;
    const created = (time as Record<string, unknown>).created;
    if (typeof created === "number" && Number.isFinite(created)) return created;
    if (typeof created === "string" && created.trim() !== "") {
      const ms = new Date(created.trim()).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Turno terminado. OJO: un paso intermedio del loop de tools también trae
 * `time.completed` pero `finish: "tool-calls"` — la sesión sigue con el
 * siguiente assistant, así que NO cierra el turno. Se acepta:
 * - `error` presente (terminal),
 * - `finish` legible y distinto de `tool-calls` (stop/length/error/...),
 * - `time.completed` presente SIN `finish` legible (shapes viejos/fakes).
 * Cualquier otra cosa se considera EN CURSO (nunca se devuelve a medias).
 */
function asyncMessageCompleted(entry: unknown): boolean {
  try {
    const info = asyncMessageInfo(entry);
    if (info === null) return false;
    const finish = typeof info.finish === "string" ? info.finish : null;
    if (finish === "tool-calls") return false;
    if (info.error !== undefined && info.error !== null) return true;
    if (finish !== null && finish !== "") return true;
    const time = info.time;
    if (time && typeof time === "object" && !Array.isArray(time)) {
      const completed = (time as Record<string, unknown>).completed;
      if (typeof completed === "number" && Number.isFinite(completed)) return true;
      if (typeof completed === "string" && completed.trim() !== "") return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Último assistant COMPLETO del turno. `sinceIndex` (cantidad de mensajes
 * ANTES del envío) es autoritativo cuando se conoce: una sesión reusada por
 * el loop puede tener un assistant final de la iteración previa dentro del
 * margen de skew y devolverlo como si fuera el nuevo. Sin índice se cae al
 * corte por `time.created` (shapes viejos/fakes). Null cuando no hay
 * ninguno — el poll sigue. Nunca lanza.
 */
function findCompletedAssistant(
  entries: unknown[],
  sinceIndex: number | null,
  sinceMs: number,
): unknown | null {
  try {
    let found: unknown | null = null;
    for (let i = 0; i < entries.length; i += 1) {
      if (sinceIndex !== null) {
        if (i < sinceIndex) continue;
      } else {
        const created = asyncMessageCreatedMs(entries[i]);
        if (created !== null && created + ASYNC_MESSAGE_SKEW_MS < sinceMs) {
          continue;
        }
      }
      if (asyncMessageRole(entries[i]) !== "assistant") continue;
      if (!asyncMessageCompleted(entries[i])) continue;
      found = entries[i];
    }
    return found;
  } catch {
    return null;
  }
}

/** Cantidad de mensajes del result de `messages` (null si no es lista). */
function countMessages(value: unknown): number | null {
  try {
    const data = unwrapResultData(value);
    return Array.isArray(data) ? data.length : null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      setTimeout(resolve, ms);
    } catch {
      resolve();
    }
  });
}

/**
 * Intento async completo: ack corto de `promptAsync` (con el fusible y el
 * retry de transporte de `withTimeoutNoResend`) + poll de `messages` hasta
 * la respuesta assistant completa o el fusible. Al vencer aborta el turno
 * server-side y falla limpio — jamás reenvía tras el ack. La respuesta se
 * extrae con el mismo `extractSessionText` del camino sync y el uso real se
 * registra con el mensaje final. Nunca lanza.
 */
export async function attemptPromptAsyncOnce(
  api: AsyncPromptApi,
  opts: AsyncPromptOptions,
): Promise<PromptAttempt> {
  const ms =
    typeof opts.ms === "number" && opts.ms > 0 ? opts.ms : globalAgentFuseMs();
  const label =
    typeof opts.label === "string" && opts.label.length > 0
      ? opts.label
      : "session.promptAsync";
  const pollMs =
    typeof opts.pollIntervalMs === "number" && opts.pollIntervalMs > 0
      ? opts.pollIntervalMs
      : ASYNC_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  const externalAbort = (): boolean => {
    try {
      return opts.signal?.aborted === true;
    } catch {
      return false;
    }
  };
  /** Aborta el turno server-side (best-effort) — fusible o cancel externo. */
  const abortTurn = async (): Promise<void> => {
    try {
      if (typeof api.abort === "function") {
        await api.abort({ sessionID: opts.sessionID });
      }
    } catch {
      // best-effort: el aborto nunca cambia el resultado del intento
    }
  };
  if (externalAbort()) {
    return { raw: null, lastErr: new Error(`${label}: abortado antes del envío`) };
  }
  // Conteo PREVIO best-effort: identifica los mensajes del turno por índice
  // aunque la sesión se reuse (loop_group) y un final viejo caiga dentro del
  // margen de skew. Si falla, el poll cae al corte por timestamp.
  let beforeCount: number | null = null;
  try {
    const pre = await withTimeout(
      api.messages({ sessionID: opts.sessionID }),
      ASYNC_MESSAGES_TIMEOUT_MS,
      `${label} messages pre`,
    );
    if (readResultError(pre) === null) beforeCount = countMessages(pre);
  } catch {
    beforeCount = null;
  }
  try {
    const ack = await withTimeoutNoResend(
      () => api.promptAsync({ sessionID: opts.sessionID, ...opts.payload }),
      ms,
      `${label} promptAsync`,
    );
    const ackErr = readResultError(ack);
    if (ackErr !== null) throw new Error(ackErr);
  } catch (e) {
    return { raw: null, lastErr: e };
  }
  // Turno en marcha: NUNCA reenviar. Poll hasta el fusible o el abort externo.
  let lastPollErr: unknown = null;
  try {
    while (Date.now() < startedAt + ms) {
      if (externalAbort()) {
        await abortTurn();
        return { raw: null, lastErr: new Error(`${label}: abortado`) };
      }
      let list: unknown = null;
      try {
        list = await withTimeout(
          api.messages({ sessionID: opts.sessionID }),
          ASYNC_MESSAGES_TIMEOUT_MS,
          `${label} messages`,
        );
      } catch (e) {
        lastPollErr = e;
        list = null;
      }
      if (list !== null) {
        const listErr = readResultError(list);
        if (listErr !== null) lastPollErr = new Error(listErr);
        const data = unwrapResultData(list);
        const entries = Array.isArray(data) ? (data as unknown[]) : null;
        const found =
          entries !== null
            ? findCompletedAssistant(
                entries,
                beforeCount,
                startedAt - ASYNC_MESSAGE_SKEW_MS,
              )
            : null;
        if (found !== null) {
          const raw = extractSessionText(found, opts.preferKey);
          const out: PromptAttempt = {
            raw,
            lastErr:
              raw === null
                ? new Error(`${label}: respuesta assistant sin texto extraíble`)
                : null,
          };
          try {
            const usage = extractSessionUsage(found);
            if (
              usage &&
              typeof opts.jobId === "string" &&
              opts.jobId.trim().length > 0
            ) {
              const sid =
                typeof opts.sessionId === "string" && opts.sessionId.length > 0
                  ? opts.sessionId
                  : undefined;
              recordRealUsage(opts.jobId, usage, sid);
            }
            if (usage) out.usage = usage;
          } catch {
            // la medición nunca rompe el intento
          }
          return out;
        }
      }
      await sleep(pollMs);
    }
    // Fusible: abortar el turno server-side (si el SDK lo expone) y fallar.
    await abortTurn();
    return {
      raw: null,
      lastErr: new Error(`timeout ${ms}ms ${label} (promptAsync sin completar)`),
    };
  } catch (e) {
    return { raw: null, lastErr: e ?? lastPollErr };
  }
}

/** `res.data` cuando el result del SDK lo trae; si no, el propio result. */
function unwrapResultData(value: unknown): unknown {
  try {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const data = (value as Record<string, unknown>).data;
      if (data !== undefined) return data;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Variante JSON del transporte async: mismo fallback de structured output
 * que `attemptJsonPromptOnce` (400 OutputFormat → memo + 1 reintento en
 * texto plano), pero sobre `promptAsync` + poll.
 */
export async function attemptJsonPromptAsyncOnce(
  api: AsyncPromptApi,
  opts: AsyncPromptOptions,
): Promise<PromptAttempt> {
  const first = isFormatUnsupportedServer()
    ? stripStructuredFormat(opts.payload)
    : opts.payload;
  const out = await attemptPromptAsyncOnce(api, { ...opts, payload: first });
  if (out.raw !== null) return out;
  if (!isFormatUnsupportedServer() && isFormatUnsupportedError(out.lastErr)) {
    markFormatUnsupportedServer();
    try {
      console.warn(`[${opts.label}] servidor opencode sin structured output (400 OutputFormat) → texto plano`);
    } catch {}
    return attemptPromptAsyncOnce(api, {
      ...opts,
      payload: stripStructuredFormat(opts.payload),
      label: `${opts.label} texto-plano`,
    });
  }
  return out;
}
