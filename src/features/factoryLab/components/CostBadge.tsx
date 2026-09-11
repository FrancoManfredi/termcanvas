/**
 * CostBadge — Ola 15 E2 (Paridad Warp: costo real + UI honesta) + F4-T2.
 *
 * Muestra:
 * - `—` si tracking apagado (`summary === null`, costTracking:false).
 * - `sin datos todavía` si aún no hay llamadas (undefined o llmCalls 0).
 *   El `USD 0.00` inicial legacy NUNCA se muestra como dato (P0.1).
 * - T4: si hay medición del servidor (`summary.actual`), manda lo MEDIDO:
 *   `N llamadas · ~X tokens (+Y caché) · ~USD Y (medido)` (skills/MCPs/
 *   contexto incluidos) con desglose input/output/reasoning/cache en el
 *   tooltip. El total NO suma la caché (la caché va aparte: es lectura
 *   reutilizada, no tokens nuevos; sumarla inflaba ~2x, caso issue #69).
 *   Sin medición, el régimen estimado de siempre.
 * - `N llamadas · ~X tokens · sin tarifa` si no hay tarifa (USD null).
 * - `N llamadas · ~X tokens · ~USD Y (est.)` con tarifa (4 decimales para
 *   no redondear a un falso `0.00`) + basis (`estimated-chars/4`) y ratesRef
 *   en el tooltip (F4 money track, display-only).
 * F4-T2: non-finite USD (NaN/Infinity) cae al camino honesto "sin tarifa":
 * NUNCA se muestra 0.00, NaN ni Infinity como dato.
 * FU-4: `ratesAsOf` opcional (sello YYYY-MM-DD de factory.yaml) — cuando se
 * provee se agrega al tooltip (`rates as of <date>`) para que la vigencia de
 * las tarifas sea visible. Opcional y display-only: nada lo fetchea.
 */

import type { CostSummary } from "../../../../shared/types/workItem";

interface CostBadgeProps {
  summary?: CostSummary | null;
  className?: string;
  ratesAsOf?: string | null;
}

function formatTokens(total: number): string {
  try {
    return `~${total.toLocaleString("en-US")} tokens`;
  } catch {
    return `~${total} tokens`;
  }
}

export function CostBadge({ summary, className, ratesAsOf }: CostBadgeProps) {
  const base = `inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${className ?? ""}`;
  // Tracking apagado: null explícito → "—" (Regla 8).
  if (summary === null) {
    return (
      <span
        className={`${base} border-zinc-200 bg-zinc-50 text-zinc-400`}
        title="Seguimiento de costo apagado (costTracking: false en factory.yaml)"
        aria-label="costo apagado"
      >
        —
      </span>
    );
  }
  // Sin datos todavía: ausente o 0 llamadas → label honesto, NUNCA USD 0.00.
  if (!summary || typeof summary.llmCalls !== "number" || summary.llmCalls <= 0) {
    return (
      <span
        className={`${base} border-zinc-200 bg-zinc-50 text-zinc-500`}
        title="Sin datos de costo todavía (0 llamadas LLM registradas)"
        aria-label="costo sin datos todavía"
      >
        sin datos todavía
      </span>
    );
  }
  const total =
    (summary.estimatedInputTokens ?? 0) + (summary.estimatedOutputTokens ?? 0);
  const callsLabel = `${summary.llmCalls} ${summary.llmCalls === 1 ? "llamada" : "llamadas"}`;
  // T4: medición del servidor cuando existe (no inventada: solo si el
  // daemon la persistió con forma válida y ≥1 turno medido).
  const measured = (() => {
    try {
      const a = summary.actual as
        | {
            inputTokens?: unknown;
            outputTokens?: unknown;
            reasoningTokens?: unknown;
            cacheReadTokens?: unknown;
            cacheWriteTokens?: unknown;
            calls?: unknown;
            usd?: unknown;
            usdSource?: unknown;
          }
        | null
        | undefined;
      if (!a || typeof a !== "object") return null;
      const num = (v: unknown): number | null =>
        typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
      const input = num(a.inputTokens);
      const output = num(a.outputTokens);
      const reasoning = num(a.reasoningTokens);
      const cacheRead = num(a.cacheReadTokens);
      const cacheWrite = num(a.cacheWriteTokens);
      const calls = num(a.calls);
      if (
        input === null ||
        output === null ||
        reasoning === null ||
        cacheRead === null ||
        cacheWrite === null ||
        calls === null ||
        calls <= 0
      ) {
        return null;
      }
      const usd =
        typeof a.usd === "number" && Number.isFinite(a.usd) && a.usd >= 0 ? a.usd : null;
      const usdSource = a.usdSource === "server" || a.usdSource === "rates" ? a.usdSource : null;
      return { input, output, reasoning, cacheRead, cacheWrite, calls, usd, usdSource };
    } catch {
      return null;
    }
  })();
  if (measured !== null) {
    // Preciso: el total es tokens NUEVOS (in+out+reasoning); la caché va
    // aparte para no inflar (caso #69: 170k reales vs 1M sumando caché).
    // Las llamadas también prefieren las medidas (turnos reales del server).
    const measuredCalls = measured.calls;
    const measuredCallsLabel = `${measuredCalls} ${measuredCalls === 1 ? "llamada" : "llamadas"}`;
    const measuredTotal = measured.input + measured.output + measured.reasoning;
    const measuredCache = measured.cacheRead + measured.cacheWrite;
    const tokensLabel =
      measuredCache > 0
        ? `${formatTokens(measuredTotal)} (+${measuredCache.toLocaleString("en-US")} caché)`
        : formatTokens(measuredTotal);
    const measuredDetail =
      `medido por opencode (skills/MCPs/contexto incluidos) · in=${measured.input} out=${measured.output} reasoning=${measured.reasoning} cache=${measured.cacheRead}/${measured.cacheWrite}` +
      (measured.usd !== null
        ? ` · USD ${measured.usdSource === "server" ? "del server" : "por tarifas (sin caché)"}`
        : " · sin USD") +
      ` · estimado: ~${total} tokens`;
    if (measured.usd !== null) {
      const usd = measured.usd.toFixed(4);
      return (
        <span
          className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}
          title={measuredDetail}
          aria-label={`${measuredCallsLabel}, ${tokensLabel}, medido ${usd} USD`}
        >
          {measuredCallsLabel} · {tokensLabel} · ~USD {usd} (medido)
        </span>
      );
    }
    return (
      <span
        className={`${base} border-blue-200 bg-blue-50 text-blue-800`}
        title={measuredDetail}
        aria-label={`${measuredCallsLabel}, ${tokensLabel}, medido sin USD`}
      >
        {measuredCallsLabel} · {tokensLabel} · medido sin USD
      </span>
    );
  }
  // FU-4: el sello de vigencia solo decora el tooltip (display-only).
  const asOfSuffix =
    typeof ratesAsOf === "string" && ratesAsOf.trim().length > 0
      ? ` · rates as of ${ratesAsOf.trim().slice(0, 10)}`
      : "";
  const detailTitle = `basis=${summary.basis ?? "estimated-chars/4"}${summary.ratesRef ? ` ratesRef=${summary.ratesRef}` : " sin tarifa"} · in=${summary.estimatedInputTokens ?? 0} out=${summary.estimatedOutputTokens ?? 0}${asOfSuffix}`;
  // Sin tarifa → llamadas + tokens, sin USD (NUNCA 0.00 inventado).
  // F4-T2: non-finite USD also falls back here (never NaN/Infinity as data).
  if (
    summary.estimatedUSD === null ||
    summary.estimatedUSD === undefined ||
    typeof summary.estimatedUSD !== "number" ||
    !Number.isFinite(summary.estimatedUSD)
  ) {
    return (
      <span
        className={`${base} border-blue-200 bg-blue-50 text-blue-800`}
        title={detailTitle}
        aria-label={`${callsLabel}, ${formatTokens(total)}, sin tarifa`}
      >
        {callsLabel} · {formatTokens(total)} · sin tarifa
      </span>
    );
  }
  // Con tarifa: 4 decimales (evita el falso 0.00 de toFixed(2) en costos <1¢).
  const usd = summary.estimatedUSD.toFixed(4);
  return (
    <span
      className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}
      title={detailTitle}
      aria-label={`${callsLabel}, ${formatTokens(total)}, estimado ${usd} USD`}
    >
      {callsLabel} · {formatTokens(total)} · ~USD {usd} (est.)
    </span>
  );
}

export default CostBadge;
