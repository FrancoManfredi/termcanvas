/**
 * ScorersPanel — Ola 11 (Measure: Scorers).
 * Espejo de ReviewPanel: discoverFactoryPort, fetchWithTimeout, polling con
 * setInterval + cleanup, estados loading/acting/msg/err, botón de acción con
 * POST, badges estilo VerdictBadge, español, aria/focus-visible.
 *
 * - Definiciones (GET /factory/scorers) + baseline (GET /factory/scores/summary)
 *   cada 30s; scores del job (GET /factory/jobs/:id/scores) cada 5s.
 * - Botón "calificar" por scorer: POST manual fire-and-forget (body {}).
 * - Todo campo ausente o forma inesperada → "sin datos", nunca rompe.
 */

import { useCallback, useEffect, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  resolveScoreReason,
  scoreReasonDisplay,
} from "../../../../shared/types/scorer";
import {
  filterScorersByRole,
  formatPassRate,
  formatScoreDate,
  groupScorersByRole,
  jobScoresUrl,
  manualScorePayload,
  manualScoreUrl,
  originLabel,
  parseJobScores,
  parseScorersList,
  parseScoresSummary,
  scoreBadgeTone,
  scorerRolesPresent,
  scorerSubtitle,
  truncateReason,
  scorersUrl,
  scoresSummaryUrl,
  type JobScoreEntry,
  type ScorerDef,
  type ScorerSummaryStat,
  type ScoreBadgeTone,
} from "./scorersUi";

const FETCH_TIMEOUT_MS = 3000;
const POLL_DEFS_MS = 30000;
const POLL_SCORES_MS = 5000;

// F4-T2 (display-only, 0 new polling): score entries may carry an additive
// `scoreReason` ("scored" | "sampled-out" | "judge-down" | "not-applicable" |
// "unscored-legacy"). Pre-F4 entries have no key on disk and resolve to
// "unscored-legacy" in memory only (history never rewritten). The backend
// parser type does not expose it yet, so the panel overlays it defensively
// from the raw JSON next to parseJobScores (never throws, unknown → absent).
type JobScoreWithReason = JobScoreEntry & { scoreReason?: unknown };

function extractScoreReason(raw: unknown, scorerName: string): unknown {
  try {
    if (!raw || typeof raw !== "object") return undefined;
    const scores = (raw as Record<string, unknown>).scores;
    if (!scores || typeof scores !== "object" || Array.isArray(scores)) return undefined;
    const entry = (scores as Record<string, unknown>)[scorerName];
    if (!entry || typeof entry !== "object") return undefined;
    return (entry as Record<string, unknown>).scoreReason;
  } catch {
    return undefined;
  }
}

/**
 * Absent-score hint naming the three honest causes (F4-T2 trace strings).
 * The panel cannot prove which cause applies without daemon logs, so it
 * names all three instead of inventing one: sampled-out (25%) by design,
 * judge-down (retryable), or not-applicable (stage not reached). Pure.
 */
function absentScoreHint(samplingRate: unknown): string {
  const rate =
    typeof samplingRate === "number" && Number.isInteger(samplingRate) && samplingRate >= 0 && samplingRate <= 100
      ? samplingRate
      : 25;
  return (
    `Sin score para este WorkItem todavía — ` +
    `posible sampled-out (${rate}%) por diseño, judge-down (juez caído, reintentable con «calificar») ` +
    `o not-applicable (el job aún no alcanzó la etapa del scorer).`
  );
}

// TODO(F4-vista-única): migrar a src/lib/factoryClient.ts (único importador de red del renderer); carry-over F4-E2: el acceso directo actual NO se toca en esta tanda.
async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function postWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manualScorePayload()),
    });
  } finally {
    clearTimeout(timer);
  }
}

function ScoreBadge({ entry }: { entry: JobScoreEntry | null }) {
  const tone: ScoreBadgeTone = entry ? scoreBadgeTone(entry.passing) : "zinc";
  if (tone === "green") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold text-white">
        ✓ {entry?.label || "pass"}
      </span>
    );
  }
  if (tone === "red") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
        ✗ {entry?.label || "fail"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-600">
      — sin score
    </span>
  );
}

export function ScorersPanel({
  workItemId,
  className,
}: {
  workItemId: string | null;
  className?: string;
}) {
  const [scorers, setScorers] = useState<ScorerDef[]>([]);
  const [summary, setSummary] = useState<Record<string, ScorerSummaryStat>>({});
  const [scores, setScores] = useState<Record<string, JobScoreWithReason>>({});
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  // Ola 18 P1.5 (E2): filtro por rol ("todos" = agrupado por rol primario).
  const [roleFilter, setRoleFilter] = useState<string>("todos");

  const fetchDefs = useCallback(async () => {
    if (!workItemId) return;
    setLoading(true);
    try {
      const port = await discoverFactoryPort();
      if (port === null) return;
      try {
        const res = await fetchWithTimeout(scorersUrl(port), FETCH_TIMEOUT_MS);
        if (res.ok) {
          const json: unknown = await res.json().catch(() => null);
          setScorers(parseScorersList(json));
        }
      } catch {
        // timeout/abort silencioso (polling vivo)
      }
      try {
        const res = await fetchWithTimeout(scoresSummaryUrl(port), FETCH_TIMEOUT_MS);
        if (res.ok) {
          const json: unknown = await res.json().catch(() => null);
          setSummary(parseScoresSummary(json));
        }
      } catch {
        // timeout/abort silencioso (polling vivo)
      }
    } catch {
      // discovery falló: polling vivo, sin romper
    } finally {
      setLoading(false);
    }
  }, [workItemId]);

  const fetchScores = useCallback(async () => {
    if (!workItemId) {
      setScores({});
      return;
    }
    try {
      const port = await discoverFactoryPort();
      if (port === null) return;
      const res = await fetchWithTimeout(jobScoresUrl(port, workItemId), FETCH_TIMEOUT_MS);
      if (!res.ok) {
        if (res.status === 404) setScores({});
        return;
      }
      const json: unknown = await res.json().catch(() => null);
      const parsed = parseJobScores(json).scores;
      // F4-T2 overlay: keep the parsed (defensive) entry, attach the raw
      // scoreReason when present so the trace line can show it. No new fetch.
      const merged: Record<string, JobScoreWithReason> = {};
      for (const [name, entry] of Object.entries(parsed)) {
        const rawReason = extractScoreReason(json, name);
        merged[name] = rawReason === undefined ? { ...entry } : { ...entry, scoreReason: rawReason };
      }
      setScores(merged);
    } catch {
      // timeout/abort silencioso (polling vivo)
    }
  }, [workItemId]);

  useEffect(() => {
    if (!workItemId) return;
    void fetchDefs();
    const t = window.setInterval(() => {
      void fetchDefs();
    }, POLL_DEFS_MS);
    return () => window.clearInterval(t);
  }, [fetchDefs, workItemId]);

  useEffect(() => {
    if (!workItemId) return;
    void fetchScores();
    const t = window.setInterval(() => {
      void fetchScores();
    }, POLL_SCORES_MS);
    return () => window.clearInterval(t);
  }, [fetchScores, workItemId]);

  const doScore = useCallback(
    async (name: string) => {
      if (!workItemId || acting) return;
      setActing(name);
      setActionMsg(null);
      setActionErr(null);
      try {
        const port = await discoverFactoryPort();
        if (port === null) {
          setActionErr("daemon no disponible");
          return;
        }
        const res = await postWithTimeout(manualScoreUrl(port, workItemId, name), FETCH_TIMEOUT_MS);
        const text = await res.text();
        let body: Record<string, unknown> = {};
        try {
          body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          body = { raw: text.slice(0, 200) };
        }
        if (!res.ok) {
          setActionErr(typeof body.error === "string" ? body.error : `error ${res.status}`);
          return;
        }
        setActionMsg(`Calificación manual enviada para ${name} — el score aparece al completarse`);
        await fetchScores();
      } catch (e) {
        setActionErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
      } finally {
        setActing(null);
      }
    },
    [workItemId, acting, fetchScores],
  );

  if (!workItemId) {
    return (
      <div className={`rounded-lg border border-zinc-200 bg-zinc-50 p-3 ${className ?? ""}`} aria-live="polite">
        <h3 className="text-xs font-semibold text-zinc-800">Scorers</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          Seleccioná un WorkItem para ver los scorers y sus scores (scores cada 5s, definiciones cada 30s)
        </p>
      </div>
    );
  }

  const refreshAll = () => {
    void fetchDefs();
    void fetchScores();
  };

  // Ola 18 P1.5/P1.7 (E2): el `passing` del badge y el `passRate` del baseline
  // vienen TAL CUAL del backend (summary + scores ya re-etiquetados por el
  // threshold actual en el server): este panel NUNCA recomputa passing local.
  const roles = scorerRolesPresent(scorers);
  const visibleScorers = filterScorersByRole(scorers, roleFilter);
  const groups =
    roleFilter === "todos"
      ? groupScorersByRole(visibleScorers)
      : [{ role: roleFilter, scorers: visibleScorers }];

  const renderScorerCard = (s: ScorerDef) => {
    const entry = scores[s.name] ?? null;
    const stat = summary[s.name] ?? null;
    const baseline = stat ? formatPassRate(stat) : "—";
    const agents = Array.isArray(s.agents) ? s.agents : [];
    return (
      <li
        key={s.name}
        className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] leading-snug"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold text-zinc-700">{s.name}</span>
          <ScoreBadge entry={entry} />
          {agents.length === 0 ? (
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">
              sin rol
            </span>
          ) : (
            agents.map((a) => (
              <span
                key={a}
                className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800"
                title={`rol del pipeline que juzga: ${a}`}
              >
                {a}
              </span>
            ))
          )}
          {s.selfImprovement ? (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">
              self-improvement
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-zinc-700">{s.description || "sin datos"}</div>
        <div className="mt-0.5 text-[10px] text-zinc-500">{scorerSubtitle(s)}</div>
        <div className="mt-0.5 text-[10px] text-zinc-500">
          baseline {baseline}
          {stat ? ` · ${stat.passing} pass / ${stat.failing} fail` : null}
        </div>
        {entry ? (
          <div className="mt-1 space-y-0.5 border-t border-zinc-200 pt-1">
            <div className="text-zinc-700">{truncateReason(entry.reason)}</div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
              <span>origen: {originLabel(entry.origin)}</span>
              {entry.model ? <span className="font-mono">juez: {entry.model}</span> : null}
              <span>{formatScoreDate(entry.at)}</span>
            </div>
            <div
              className="text-[10px] text-zinc-500"
              title="trace: display-only reason persisted in scores.json (pre-F4 entries read as unscored-legacy, history never rewritten)"
            >
              trace: {scoreReasonDisplay(resolveScoreReason((entry as JobScoreWithReason).scoreReason), { samplingRate: s.samplingRate })}
            </div>
          </div>
        ) : (
          <div className="mt-1 border-t border-zinc-200 pt-1 text-[10px] text-zinc-400">
            {absentScoreHint(s.samplingRate)}
          </div>
        )}
        <div className="mt-1.5">
          <button
            type="button"
            disabled={acting !== null}
            onClick={() => void doScore(s.name)}
            className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            title="Scoring manual (fire-and-forget, re-score reemplaza)"
          >
            {acting === s.name ? "calificando…" : "calificar"}
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className={`rounded-lg border border-zinc-200 bg-white p-3 ${className ?? ""}`} aria-live="polite">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-800">
          Scorers — {workItemId.slice(0, 12)}…{" "}
          <span className="font-normal text-zinc-500">
            ({scorers.length} {scorers.length === 1 ? "scorer" : "scorers"})
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {loading ? <span className="text-[11px] text-zinc-500">cargando…</span> : null}
          <button
            type="button"
            onClick={refreshAll}
            className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            refrescar
          </button>
        </div>
      </div>

      {scorers.length === 0 ? (
        <div className="mt-2 text-[11px] text-zinc-500">
          Sin datos — el backend todavía no expone scorers (GET /factory/scorers vacío o no disponible).
        </div>
      ) : (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="filtrar scorers por rol">
            <button
              type="button"
              onClick={() => setRoleFilter("todos")}
              aria-pressed={roleFilter === "todos"}
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${
                roleFilter === "todos"
                  ? "bg-zinc-800 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              todos ({scorers.length})
            </button>
            {roles.map((r) => {
              const n = filterScorersByRole(scorers, r).length;
              const active = roleFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(active ? "todos" : r)}
                  aria-pressed={active}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${
                    active
                      ? "bg-sky-700 text-white"
                      : "bg-sky-50 text-sky-800 hover:bg-sky-100"
                  }`}
                >
                  {r} ({n})
                </button>
              );
            })}
          </div>
          {visibleScorers.length === 0 ? (
            <div className="mt-2 text-[11px] text-zinc-500">
              Sin scorers para el rol “{roleFilter}”.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.role} className="mt-2">
                {roleFilter === "todos" ? (
                  <h4 className="text-[11px] font-semibold text-zinc-600">
                    rol: {g.role}{" "}
                    <span className="font-normal text-zinc-400">
                      ({g.scorers.length} {g.scorers.length === 1 ? "scorer" : "scorers"})
                    </span>
                  </h4>
                ) : null}
                <ul className="mt-1 space-y-2">
                  {g.scorers.map((s) => renderScorerCard(s))}
                </ul>
              </div>
            ))
          )}
          <p className="mt-2 text-[10px] text-zinc-400">
            Agrupado por rol primario; el filtro matchea cualquier rol del scorer.
          </p>
        </div>
      )}

      {actionMsg || actionErr ? (
        <div className="mt-2 border-t border-zinc-100 pt-2" aria-live="polite">
          {actionMsg ? <span className="text-[11px] text-green-700">{actionMsg}</span> : null}
          {actionErr ? <span className="text-[11px] text-red-700">{actionErr}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export default ScorersPanel;
