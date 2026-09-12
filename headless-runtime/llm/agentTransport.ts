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

/**
 * Error embebido en la respuesta (`{error}` o `{data.error}`), recortado a
 * 200 chars. Null cuando la respuesta no trae error. Puro, nunca lanza.
 */
export function readResultError(res: unknown): string | null {
  try {
    if (!res || typeof res !== "object") return null;
    const obj = res as Record<string, unknown>;
    if ("error" in obj && obj.error) {
      try {
        return JSON.stringify(obj.error).slice(0, 200);
      } catch {
        return String(obj.error).slice(0, 200);
      }
    }
    const maybeData = obj.data as Record<string, unknown> | undefined;
    if (maybeData && typeof maybeData === "object" && "error" in maybeData && maybeData.error) {
      try {
        return JSON.stringify(maybeData.error).slice(0, 200);
      } catch {
        return String(maybeData.error).slice(0, 200);
      }
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
  const ms = typeof opts.ms === "number" && opts.ms > 0 ? opts.ms : GLOBAL_AGENT_FUSE_MS;
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
