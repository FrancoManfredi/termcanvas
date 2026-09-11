/**
 * CostTracker — Ola 15 E2 (Paridad Warp: costo real).
 *
 * Contador puro y testeable por jobId (nunca global):
 * - Tokens estimados con `floor(chars/4)` sobre chars JS (string.length,
 *   no bytes: multibyte cuenta por chars JS).
 * - USD estimado SOLO con tarifa explícita; sin tarifa → null (NUNCA 0
 *   inventado, Regla 1 + P0.1).
 * - Interruptor (Regla 8): si factory.yaml dice `costTracking: false`,
 *   `getCostSummary` devuelve null y no se registra nada (apagado total).
 *   Se lee vía loader existente (`getFactoryConfig`), sin modificarlo.
 * - Cota explícita (Regla 7): cap de 10000 entradas con evicción FIFO.
 *   Sin loops, sin reintentos, sin TTL (no se cachean rates: lectura fresca
 *   por llamada, así no hay cache que expirar).
 *
 * ESM puro, TypeScript estricto, cero require().
 *
 * FU-4b (per-job USD): `incrementCost`/`refreshCostSummary` ya NO usan
 * `resolveSingleCostRate` (null con 27 tarifas por ambiguo). Resuelven por
 * el modelo REAL del job vía `resolveCostRateForModelRef` (exact-key,
 * trimmed): job sin modelo o sin tarifa → null honesto (NUNCA 0.00).
 * `resolveSingleCostRate` se conserva intacta por compat (tests F4-T1).
 */

import { getFactoryConfig } from "../factory/agentLoader";
import type { ActualCostSummary, CostSummary } from "../../shared/types/workItem";

/** Base declarada de toda estimación (visible en UI y job.json). */
export const COST_ESTIMATE_BASIS = "estimated-chars/4" as const;

/** Base declarada de la medición real del servidor opencode (UI y job.json). */
export const COST_ACTUAL_BASIS = "opencode-session" as const;

/**
 * Cota explícita del mapa por jobId (Regla 7: cero loops sin cota).
 * Al llegar, se evicta la entrada MÁS VIEJA (FIFO por orden de inserción
 * del Map). Test que lo demuestra: `tests/measure-cost.test.ts`.
 */
export const COST_TRACKER_MAX_ENTRIES = 10_000;

/** Tarifa `{inputUSDper1M, outputUSDper1M}` (espejo de FactoryCostRate). */
export interface CostRate {
  inputUSDper1M: number;
  outputUSDper1M: number;
}

interface CounterEntry {
  calls: number;
  inChars: number;
  outChars: number;
  actual: ActualCounter;
}

/** Acumulador de uso REAL reportado por el servidor opencode. */
interface ActualCounter {
  calls: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  /** Suma de `cost` del server; null hasta el primer costo visto. */
  serverUsd: number | null;
}

function emptyActual(): ActualCounter {
  return { calls: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, serverUsd: null };
}

/** Contador por jobId (key por jobId, nunca global — riesgo §2.5). */
const counters = new Map<string, CounterEntry>();

/**
 * Último uso CRUDO visto por (job, sesión) para detectar reportes
 * acumulados. El servidor puede reportar el acumulado de la SESIÓN en vez
 * del delta del turno; como un job habla por varias sesiones (foreman,
 * implement, review, renovaciones), la llave incluye el sessionId —comparar
 * el acumulado de la sesión B contra el de la A corrompe el cálculo
 * (exactitud dashboard opencode). Sin sessionId se usa la llave legacy del
 * job (compat con callers que no la conocen). Best-effort, nunca lanza.
 */
const lastSeenActualByJob = new Map<string, SessionUsage>();

function lastSeenKey(jobKey: string, sessionId?: string): string {
  try {
    if (typeof sessionId === "string" && sessionId.length > 0) {
      return `${jobKey}::${sessionId}`;
    }
  } catch {
    // cae a la llave del job
  }
  return jobKey;
}

/**
 * Uso REAL de un turno LLM tal como lo reporta el servidor opencode
 * (`session.prompt` → `data.info`, o `session.get`/`session.messages`).
 * Incluye lo que el estimado chars/4 jamás ve: skills, MCPs y contexto
 * inicial inyectado por el servidor. Puro en construcción (ver
 * `extractSessionUsage`).
 */
export interface SessionUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD calculado por el servidor; null cuando no lo informa. */
  cost: number | null;
}

function clampTokens(value: unknown): number {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    return Math.floor(value);
  } catch {
    return 0;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extrae el uso real de una respuesta del SDK opencode. Formas aceptadas
 * (todas best-effort, nunca lanza):
 * - `{ data: { info: { tokens: {input,output,reasoning,cache:{read,write}}, cost } } }`
 *   (respuesta de `session.prompt`).
 * - `{ info: {...} }` (mensaje ya desenvuelto).
 * - `{ data: { cost, tokens } }` (un `Session` de `session.get`).
 * Tokens ausentes → 0; costo ausente/inválido → null. Null cuando no hay
 * ningún bloque `info`/`tokens`/`cost` legible.
 */
export function extractSessionUsage(res: unknown): SessionUsage | null {
  try {
    const root = asRecord(res);
    if (!root) return null;
    const data = asRecord(root.data);
    const info = asRecord(data?.info) ?? asRecord(root.info) ?? data;
    if (!info) return null;
    const tokens = asRecord(info.tokens);
    const cache = asRecord(tokens?.cache);
    const hasTokens = tokens !== null;
    const rawCost = (info as Record<string, unknown>).cost;
    const cost =
      typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0
        ? rawCost
        : null;
    if (!hasTokens && cost === null) return null;
    return {
      input: clampTokens(tokens?.input),
      output: clampTokens(tokens?.output),
      reasoning: clampTokens(tokens?.reasoning),
      cacheRead: clampTokens(cache?.read),
      cacheWrite: clampTokens(cache?.write),
      cost,
    };
  } catch {
    return null;
  }
}
/**
 * Estima tokens desde chars: `floor(chars/4)`.
 * Vacío/negativo/NaN/Infinito → 0. Multibyte cuenta por chars JS
 * (string.length), no por bytes.
 */
export function estimateTokensFromChars(chars: number): number {
  try {
    if (typeof chars !== "number" || !Number.isFinite(chars)) return 0;
    if (chars <= 0) return 0;
    return Math.floor(chars / 4);
  } catch {
    return 0;
  }
}

/**
 * Calcula USD estimado desde tokens + tarifa.
 * Sin tarifa (null/undefined/inválida) → null (NUNCA 0 inventado).
 * Tokens inválidos → null. Resultado no-finito o negativo → null.
 */
export function calcUSD(
  inputTokens: number,
  outputTokens: number,
  rate?: CostRate | null,
): number | null {
  try {
    if (!rate || typeof rate !== "object") return null;
    const { inputUSDper1M, outputUSDper1M } = rate;
    if (
      typeof inputUSDper1M !== "number" ||
      typeof outputUSDper1M !== "number" ||
      !Number.isFinite(inputUSDper1M) ||
      !Number.isFinite(outputUSDper1M) ||
      inputUSDper1M < 0 ||
      outputUSDper1M < 0
    ) {
      return null;
    }
    if (
      typeof inputTokens !== "number" ||
      typeof outputTokens !== "number" ||
      !Number.isFinite(inputTokens) ||
      !Number.isFinite(outputTokens) ||
      inputTokens < 0 ||
      outputTokens < 0
    ) {
      return null;
    }
    const usd =
      (inputTokens / 1_000_000) * inputUSDper1M +
      (outputTokens / 1_000_000) * outputUSDper1M;
    if (!Number.isFinite(usd) || usd < 0) return null;
    return usd;
  } catch {
    return null;
  }
}

/**
 * Interruptor (Regla 8): lee `costTracking` del yaml vía loader existente.
 * Nunca lanza: ante cualquier fallo, default `true` (comportamiento actual).
 */
export function isCostTrackingEnabled(): boolean {
  try {
    if (costTrackingOverride !== null) return costTrackingOverride;
    const cfg = getFactoryConfig();
    return cfg?.costTracking !== false;
  } catch {
    return true;
  }
}

/**
 * Seam SOLO para tests: fuerza el flag sin tocar factory.yaml (prohibido
 * modificarlo: es de E1). Espejo del `setDockerProbeOverride` de E1.
 * `null` = sin override (lee el yaml real).
 */
let costTrackingOverride: boolean | null = null;
export function setCostTrackingOverrideForTests(v: boolean | null): void {
  costTrackingOverride = v;
}
export function resetCostTrackingOverrideForTests(): void {
  costTrackingOverride = null;
}

function clampChars(value: unknown): number {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    return Math.floor(value);
  } catch {
    return 0;
  }
}

/**
 * Registra una llamada LLM para un jobId (chars in/out).
 * Best-effort: nunca lanza. Si tracking apagado → no-op (apagado total).
 * Cota FIFO: si el mapa está lleno y el jobId es nuevo, se evicta la
 * entrada más vieja antes de insertar.
 */
export function recordLlmCall(
  jobId: string,
  inputChars: number,
  outputChars: number,
): void {
  try {
    if (!isCostTrackingEnabled()) return;
    if (typeof jobId !== "string" || jobId.trim().length === 0) return;
    const key = jobId.trim();
    const inC = clampChars(inputChars);
    const outC = clampChars(outputChars);
    const existing = counters.get(key);
    if (existing) {
      existing.calls += 1;
      existing.inChars += inC;
      existing.outChars += outC;
      return;
    }
    if (counters.size >= COST_TRACKER_MAX_ENTRIES) {
      const oldest = counters.keys().next();
      if (!oldest.done && typeof oldest.value === "string") {
        counters.delete(oldest.value);
      }
    }
    counters.set(key, { calls: 1, inChars: inC, outChars: outC, actual: emptyActual() });
  } catch {
    // best-effort: el conteo nunca rompe el flujo LLM
  }
}

/**
 * Registra el uso REAL de un turno LLM para un jobId (medido por el
 * servidor opencode: incluye skills, MCPs y contexto inicial). Columna
 * separada del estimado: no toca calls/inChars/outChars (el conteo lógico
 * de `recordLlmCall` sigue intacto, sin doble conteo). Best-effort, nunca
 * lanza. Si tracking apagado → no-op. `usage` null/inválido → no-op.
 *
 * Guarda anti-acumulado POR SESIÓN: si el servidor reporta el acumulado
 * de la sesión en vez del delta del turno (campos monótonos no-decrecientes
 * vs lo último visto EN LA MISMA SESIÓN), se registra el delta
 * `max(0, cur-prev)` en vez de sumar el acumulado entero. Deltas reales (no
 * monótonos) se suman tal cual. Sin `sessionId` se descuenta contra la
 * llave del job (compat; menos preciso multi-sesión).
 */
export function recordRealUsage(jobId: string, usage: SessionUsage | null | undefined, sessionId?: string): void {
  try {
    if (!isCostTrackingEnabled()) return;
    if (typeof jobId !== "string" || jobId.trim().length === 0) return;
    if (!usage || typeof usage !== "object") return;
    const key = jobId.trim();
    const cur: SessionUsage = {
      input: clampTokens(usage.input),
      output: clampTokens(usage.output),
      reasoning: clampTokens(usage.reasoning),
      cacheRead: clampTokens(usage.cacheRead),
      cacheWrite: clampTokens(usage.cacheWrite),
      cost: typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null,
    };
    // Detección de acumulado: todos los campos de tokens no-decrecen y al
    // menos uno crece строго, con previo no-vacío. Costo acumulado también
    // se descuenta por delta cuando ambos son números y cur >= prev.
    let delta = cur;
    try {
      const prev = lastSeenActualByJob.get(lastSeenKey(key, sessionId));
      if (prev) {
        const prevEmpty =
          prev.input === 0 && prev.output === 0 && prev.reasoning === 0 &&
          prev.cacheRead === 0 && prev.cacheWrite === 0;
        if (!prevEmpty) {
          const mono =
            cur.input >= prev.input && cur.output >= prev.output &&
            cur.reasoning >= prev.reasoning && cur.cacheRead >= prev.cacheRead &&
            cur.cacheWrite >= prev.cacheWrite;
          const grows =
            cur.input > prev.input || cur.output > prev.output ||
            cur.reasoning > prev.reasoning || cur.cacheRead > prev.cacheRead ||
            cur.cacheWrite > prev.cacheWrite;
          if (mono && grows) {
            let deltaCost: number | null = cur.cost;
            if (
              typeof cur.cost === "number" && typeof prev.cost === "number" &&
              Number.isFinite(cur.cost) && Number.isFinite(prev.cost) &&
              cur.cost >= prev.cost
            ) {
              deltaCost = cur.cost - prev.cost;
            }
            delta = {
              input: cur.input - prev.input,
              output: cur.output - prev.output,
              reasoning: cur.reasoning - prev.reasoning,
              cacheRead: cur.cacheRead - prev.cacheRead,
              cacheWrite: cur.cacheWrite - prev.cacheWrite,
              cost: deltaCost,
            };
          }
        }
      }
      lastSeenActualByJob.set(lastSeenKey(key, sessionId), cur);
    } catch {
      delta = cur;
    }
    let entry = counters.get(key);
    if (!entry) {
      if (counters.size >= COST_TRACKER_MAX_ENTRIES) {
        const oldest = counters.keys().next();
        if (!oldest.done && typeof oldest.value === "string") {
          counters.delete(oldest.value);
        }
      }
      entry = { calls: 0, inChars: 0, outChars: 0, actual: emptyActual() };
      counters.set(key, entry);
    }
    const a = entry.actual;
    a.calls += 1;
    a.input += clampTokens(delta.input);
    a.output += clampTokens(delta.output);
    a.reasoning += clampTokens(delta.reasoning);
    a.cacheRead += clampTokens(delta.cacheRead);
    a.cacheWrite += clampTokens(delta.cacheWrite);
    if (typeof delta.cost === "number" && Number.isFinite(delta.cost) && delta.cost >= 0) {
      a.serverUsd = (a.serverUsd ?? 0) + delta.cost;
    }
  } catch {
    // best-effort: el conteo nunca rompe el flujo LLM
  }
}

/**
 * Construye el sub-objeto `actual` desde el acumulador real. undefined
 * cuando todavía no hubo ningún turno medido (la forma del resumen queda
 * intacta). USD: prefiere la suma del server; sin ella, rates del yaml con
 * reasoning como output y caché EXCLUIDA del fallback (el yaml no tiene
 * columnas de caché: sumarla como input/output inventa costo; la caché va
 * desglosada en el display, nunca tarifada). Nunca lanza.
 */
export function buildActualSummary(
  actual: ActualCounter,
  rate?: CostRate | null,
): ActualCostSummary | undefined {
  try {
    if (!actual || actual.calls <= 0) return undefined;
    let usd: number | null = null;
    let usdSource: "server" | "rates" | null = null;
    if (actual.serverUsd !== null && Number.isFinite(actual.serverUsd) && actual.serverUsd >= 0) {
      usd = actual.serverUsd;
      usdSource = "server";
    } else {
      const fallback = calcUSD(actual.input, actual.output + actual.reasoning, rate ?? null);
      if (fallback !== null) {
        usd = fallback;
        usdSource = "rates";
      }
    }
    return {
      inputTokens: actual.input,
      outputTokens: actual.output,
      reasoningTokens: actual.reasoning,
      cacheReadTokens: actual.cacheRead,
      cacheWriteTokens: actual.cacheWrite,
      calls: actual.calls,
      usd,
      usdSource,
      basis: COST_ACTUAL_BASIS,
    };
  } catch {
    return undefined;
  }
}
/**
 * Resuelve la tarifa única usable desde factory.yaml.
 * - tracking apagado → `{rate: null, ref: null}`.
 * - 0 tarifas → `{rate: null, ref: null}` (modo "sin tarifa", honesto).
 * - exactamente 1 tarifa válida → esa (ref = su key, ej. "prov/model").
 * - >1 tarifas → `{rate: null, ref: null}` (ambiguo: elegir una al azar
 *   sería inventar; el orquestador deberá pasar rate+ref explícitos).
 * Nunca lanza.
 */
export function resolveSingleCostRate(): {
  rate: CostRate | null;
  ref: string | null;
} {
  try {
    if (!isCostTrackingEnabled()) return { rate: null, ref: null };
    const cfg = getFactoryConfig();
    const table = (cfg?.costRates ?? {}) as Record<string, unknown>;
    const entries = Object.entries(table);
    if (entries.length !== 1) return { rate: null, ref: null };
    const [ref, raw] = entries[0] as [string, unknown];
    if (typeof ref !== "string" || ref.trim().length === 0) {
      return { rate: null, ref: null };
    }
    const r = raw as Record<string, unknown>;
    const inputUSDper1M =
      typeof r?.inputUSDper1M === "number" ? r.inputUSDper1M : NaN;
    const outputUSDper1M =
      typeof r?.outputUSDper1M === "number" ? r.outputUSDper1M : NaN;
    if (
      !Number.isFinite(inputUSDper1M) ||
      !Number.isFinite(outputUSDper1M) ||
      (inputUSDper1M as number) < 0 ||
      (outputUSDper1M as number) < 0
    ) {
      return { rate: null, ref: null };
    }
    return {
      rate: {
        inputUSDper1M: inputUSDper1M as number,
        outputUSDper1M: outputUSDper1M as number,
      },
      ref: ref.trim(),
    };
  } catch {
    return { rate: null, ref: null };
  }
}

/**
 * F4 money track (PLAN-100 PARIDAD section 3.3): pure per-model lookup
 * inside a rates table shaped like factory.yaml `costRates`
 * (`{ "provider/model": { inputUSDper1M, outputUSDper1M } }`).
 * Exact trimmed key wins; anything else (blank key, unknown key, broken
 * entry, non-object table) yields `{ rate: null, ref: null }` so callers
 * fall back to the honest "sin tarifa" path (never USD 0.00 as data).
 * Pure: no disk, no network, no state. Never throws.
 */
export function pickCostRate(
  table: unknown,
  modelKey: unknown,
): {
  rate: CostRate | null;
  ref: string | null;
} {
  try {
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      return { rate: null, ref: null };
    }
    if (typeof modelKey !== "string" || modelKey.trim().length === 0) {
      return { rate: null, ref: null };
    }
    const key = modelKey.trim();
    const raw: unknown = (table as Record<string, unknown>)[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { rate: null, ref: null };
    }
    const r = raw as Record<string, unknown>;
    const inputUSDper1M: number =
      typeof r.inputUSDper1M === "number" ? r.inputUSDper1M : NaN;
    const outputUSDper1M: number =
      typeof r.outputUSDper1M === "number" ? r.outputUSDper1M : NaN;
    if (
      !Number.isFinite(inputUSDper1M) ||
      !Number.isFinite(outputUSDper1M) ||
      inputUSDper1M < 0 ||
      outputUSDper1M < 0
    ) {
      return { rate: null, ref: null };
    }
    return { rate: { inputUSDper1M, outputUSDper1M }, ref: key };
  } catch {
    return { rate: null, ref: null };
  }
}

/**
 * F4 money track: live rates lookup for one `provider/model` key against
 * the yaml table (fresh read per call, no cached rates to expire).
 * Tracking off or empty/ambiguous table → `{ rate: null, ref: null }`
 * (honest "sin tarifa"). Never throws.
 */
export function lookupCostRate(modelKey: string): {
  rate: CostRate | null;
  ref: string | null;
} {
  try {
    if (!isCostTrackingEnabled()) return { rate: null, ref: null };
    const cfg = getFactoryConfig();
    return pickCostRate(cfg?.costRates, modelKey);
  } catch {
    return { rate: null, ref: null };
  }
}

/**
 * F4 money track: USD estimate for token counts against the yaml rate of
 * one model key. No rate (or invalid counts) → `{ estimatedUSD: null,
 * ratesRef: null }` with the shared basis (NEVER 0.00 as data; an honest
 * zero only flows from `calcUSD` with a real rate and zero usage).
 * Never throws.
 */
export function estimateCostForModel(
  inputTokens: number,
  outputTokens: number,
  modelKey: string,
): {
  estimatedUSD: number | null;
  ratesRef: string | null;
  basis: typeof COST_ESTIMATE_BASIS;
} {
  try {
    const { rate, ref } = lookupCostRate(modelKey);
    const usd = calcUSD(inputTokens, outputTokens, rate);
    if (usd === null || ref === null) {
      return { estimatedUSD: null, ratesRef: null, basis: COST_ESTIMATE_BASIS };
    }
    return { estimatedUSD: usd, ratesRef: ref, basis: COST_ESTIMATE_BASIS };
  } catch {
    return { estimatedUSD: null, ratesRef: null, basis: COST_ESTIMATE_BASIS };
  }
}

/**
 * FU-4b: normaliza un modelRef al live modelKey `provider/model` usado en
 * factory.yaml `costRates` (la key ES el modelKey: nunca renombrar).
 * Acepta objeto `{providerID, modelID}` (variant ignorada: no es parte de
 * la key) o string `"provider/model"`. Todo trimmed, exact-key.
 * Cualquier otra forma (null, vacío, sin "/", campos en blanco) → null.
 * Pura, nunca lanza.
 */
export function modelKeyForModelRef(ref: unknown): string | null {
  try {
    if (typeof ref === "string") {
      const s = ref.trim();
      if (s.length === 0) return null;
      const i = s.indexOf("/");
      if (i <= 0 || i >= s.length - 1) return null;
      const provider = s.slice(0, i).trim();
      const model = s.slice(i + 1).trim();
      if (provider.length === 0 || model.length === 0) return null;
      // Sin "/" extra a medias: solo se tolera lo ya trimmed; una key con
      // "/" interior (p. ej. variantes con slash) no matchea exact-key y el
      // lookup devolverá null honesto de todos modos.
      return `${provider}/${model}`;
    }
    if (ref && typeof ref === "object" && !Array.isArray(ref)) {
      const r = ref as Record<string, unknown>;
      if (typeof r.providerID !== "string" || typeof r.modelID !== "string") {
        return null;
      }
      const provider = r.providerID.trim();
      const model = r.modelID.trim();
      if (provider.length === 0 || model.length === 0) return null;
      return `${provider}/${model}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * FU-4b: tarifa viva para el modelo REAL de un job.
 * `modelKeyForModelRef(ref)` → `lookupCostRate(key)`. Sin modelo, sin key
 * o sin tarifa → `{rate: null, ref: null}` (honesto "sin tarifa", NUNCA
 * USD 0.00 como dato). Nunca lanza.
 */
export function resolveCostRateForModelRef(ref: unknown): {
  rate: CostRate | null;
  ref: string | null;
} {
  try {
    const key = modelKeyForModelRef(ref);
    if (key === null) return { rate: null, ref: null };
    return lookupCostRate(key);
  } catch {
    return { rate: null, ref: null };
  }
}

/**
 * Resumen de costo para un jobId, o null si no hay datos / tracking apagado.
 * - tracking apagado → null (la UI muestra "—").
 * - jobId desconocido → null (sin datos, la UI muestra "sin datos todavía").
 * - sin tarifa (rate null) → `estimatedUSD: null, ratesRef: null`
 *   (la UI muestra "N llamadas · sin tarifa", NUNCA USD 0.00).
 * Nunca lanza.
 */
export function getCostSummary(
  jobId: string,
  rate?: CostRate | null,
  ratesRef?: string | null,
): CostSummary | null {
  try {
    if (!isCostTrackingEnabled()) return null;
    if (typeof jobId !== "string" || jobId.trim().length === 0) return null;
    const entry = counters.get(jobId.trim());
    if (!entry) return null;
    const estimatedInputTokens = estimateTokensFromChars(entry.inChars);
    const estimatedOutputTokens = estimateTokensFromChars(entry.outChars);
    const actual = buildActualSummary(entry.actual, rate ?? null);
    const withActual =
      actual !== undefined ? { actual } : ({} as Record<string, never>);
    if (!rate || typeof rate !== "object") {
      return {
        llmCalls: entry.calls,
        estimatedInputTokens,
        estimatedOutputTokens,
        estimatedUSD: null,
        basis: COST_ESTIMATE_BASIS,
        ratesRef: null,
        ...withActual,
      };
    }
    const usd = calcUSD(estimatedInputTokens, estimatedOutputTokens, rate);
    if (usd === null) {
      return {
        llmCalls: entry.calls,
        estimatedInputTokens,
        estimatedOutputTokens,
        estimatedUSD: null,
        basis: COST_ESTIMATE_BASIS,
        ratesRef: null,
        ...withActual,
      };
    }
    const ref =
      typeof ratesRef === "string" && ratesRef.trim().length > 0
        ? ratesRef.trim()
        : "custom";
    return {
      llmCalls: entry.calls,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedUSD: usd,
      basis: COST_ESTIMATE_BASIS,
      ratesRef: ref,
      ...withActual,
    };
  } catch {
    return null;
  }
}

/** Limpia el contador en memoria (solo tests). */
export function resetCostTracker(): void {
  try {
    counters.clear();
  } catch {
    // noop
  }
  try {
    lastSeenActualByJob.clear();
  } catch {
    // noop
  }
}

/** Tamaño actual del mapa (solo tests / diagnóstico de cota). */
export function getCostTrackerSize(): number {
  try {
    return counters.size;
  } catch {
    return 0;
  }
}

/**
 * Lee el acumulado REAL de un jobId como sub-objeto `actual` (undefined
 * cuando todavía no hubo ningún turno medido o el tracking está apagado).
 * `rate` solo se usa para el fallback de USD cuando el server no informó
 * costo. Nunca lanza.
 */
export function getActualSummaryForJob(
  jobId: string,
  rate?: CostRate | null,
): ActualCostSummary | undefined {
  try {
    if (!isCostTrackingEnabled()) return undefined;
    if (typeof jobId !== "string" || jobId.trim().length === 0) return undefined;
    const entry = counters.get(jobId.trim());
    if (!entry) return undefined;
    return buildActualSummary(entry.actual, rate ?? null);
  } catch {
    return undefined;
  }
}

/**
 * Valida un `actual` persistido/restaurado con el mismo rigor manual del
 * restore de workItemDisk (nunca zod directo: tolerante, nunca lanza).
 * undefined ante cualquier forma inválida.
 */
export function asValidActual(value: unknown): ActualCostSummary | undefined {
  try {
    const o = asRecord(value);
    if (!o) return undefined;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
    const inputTokens = num(o.inputTokens);
    const outputTokens = num(o.outputTokens);
    const reasoningTokens = num(o.reasoningTokens);
    const cacheReadTokens = num(o.cacheReadTokens);
    const cacheWriteTokens = num(o.cacheWriteTokens);
    const calls = num(o.calls);
    if (
      inputTokens === null ||
      outputTokens === null ||
      reasoningTokens === null ||
      cacheReadTokens === null ||
      cacheWriteTokens === null ||
      calls === null
    ) {
      return undefined;
    }
    const usdRaw = o.usd;
    const usd =
      usdRaw === null || usdRaw === undefined
        ? null
        : typeof usdRaw === "number" && Number.isFinite(usdRaw) && usdRaw >= 0
          ? usdRaw
          : undefined;
    if (usd === undefined) return undefined;
    const sourceRaw = o.usdSource;
    const usdSource =
      sourceRaw === null || sourceRaw === undefined
        ? null
        : sourceRaw === "server" || sourceRaw === "rates"
          ? sourceRaw
          : undefined;
    if (usdSource === undefined) return undefined;
    if (usd !== null && usdSource === null) return undefined;
    if (o.basis !== COST_ACTUAL_BASIS) return undefined;
    return {
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      calls,
      usd,
      usdSource,
      basis: COST_ACTUAL_BASIS,
    };
  } catch {
    return undefined;
  }
}
