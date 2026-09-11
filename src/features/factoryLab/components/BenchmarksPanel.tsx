/**
 * BenchmarksPanel — Ola 12 (Measure: Benchmarks).
 * Espejo de ScorersPanel: discoverFactoryPort, fetchWithTimeout, polling con
 * setInterval + cleanup, estados loading/posting/msg/err, botón de acción con
 * POST, badges, español, aria/focus-visible.
 *
 * - Lista de runs (GET /factory/benchmarks) cada 15s.
 * - Detalle del run seleccionado (GET /factory/benchmarks/:id): fetch al
 *   seleccionar + polling cada 5s SOLO si status=running (si done, una vez).
 * - Lanzador: textarea con la definition JSON + validación local + aviso de
 *   costo ANTES del POST (N llamadas LLM al revisor).
 * - SIN ganador automático: el humano pondera pass rate vs duración (§2.4).
 * - Todo campo ausente o forma inesperada → "sin datos", nunca rompe.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  benchmarkRunUrl,
  benchmarksUrl,
  formatDuration,
  formatPassRate,
  formatRunDate,
  formatScoreRateValue,
  isRunningStatus,
  normalizeBenchmarkDefinition,
  parseRunDetail,
  parseRunsList,
  parseScorersField,
  statusLabel,
  totalCallsWithScorers,
  trialBadge,
  validateDefinitionInput,
  type BenchmarkRunDetail,
  type BenchmarkRunSummary,
  type TrialBadgeTone,
} from "./benchmarksUi";
import { parseScorersList, scorersUrl } from "./scorersUi";

const FETCH_TIMEOUT_MS = 3000;
const POST_TIMEOUT_MS = 10000;
const POLL_RUNS_MS = 15000;
const POLL_DETAIL_MS = 5000;

// TODO(F4-vista-única): migrar a src/lib/factoryClient.ts (único importador de red del renderer); carry-over F4-E2: el acceso directo actual NO se toca en esta tanda.
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function RunStatusDot({ status }: { status: string }) {
  const running = isRunningStatus(status);
  if (running) {
    return (
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
    );
  }
  return <span className="inline-flex h-2 w-2 rounded-full bg-zinc-300" aria-hidden="true" />;
}

function TrialBadge({ tone, verdict }: { tone: TrialBadgeTone; verdict: string }) {
  if (tone === "pass") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold text-white">
        ✓ {verdict || "pass"}
      </span>
    );
  }
  if (tone === "error") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
        ⚠ error parse
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
      ✗ {verdict || "fail"}
    </span>
  );
}

function formatConfidence(c: number): string {
  if (!Number.isFinite(c)) return "—";
  if (c >= 0 && c <= 1) return `${Math.round(c * 100)}%`;
  return String(c);
}

const EXAMPLE_PLACEHOLDER = `{"name":"mi-benchmark","tasks":[{"id":"t1","prompt":"crear carpeta demo con nota","files":[{"path":"demo/nota.md","content":"# Demo"}],"verification":{"overall":"pass"},"expectedVerdict":"accept"}],"configs":[{"id":"c1","reviewerModel":"opencode/big-pickle"}],"repetitions":1}`;

// ── F3-T3: compositor de decisión humana (wiring +0, sin polling nuevo) ──
// La tabla de rutas no sumó filas en F3-T3 (ver routing/routeTable.ts): no hay
// POST de registro, así que este compositor arma + valida el JSON de la
// BenchmarkDecision (decidedBy fijo "human", trialsRef enlazado al run) y lo
// deja listo para copiar (el estreno live registra por vía engine con
// `recordBenchmarkDecision`). Puro, nunca lanza; no hace fetch ni intervalos.

/** Topes del schema compartido (espejo de decisionRecord, sin importar backend). */
const DECISION_CHANGE_MAX = 500;
const DECISION_WEIGHT_MAX = 200;
const DECISION_TRIALS_REF_MAX = 256;
const DECISION_NOTE_MAX = 1000;
const DECISION_ERRORS_MAX = 8;

interface BenchmarkDecisionDraft {
  change: string;
  costWeight: string;
  qualityWeight: string;
  trialsRef: string;
  note: string;
}

const EMPTY_DECISION_DRAFT: BenchmarkDecisionDraft = {
  change: "",
  costWeight: "",
  qualityWeight: "",
  trialsRef: "",
  note: "",
};

/** trialsRef honesto por defecto: el archivo de trials de ESTE run. */
function trialsRefForRun(runId: string): string {
  try {
    const id = typeof runId === "string" ? runId.trim() : "";
    if (!id) return "";
    return `factory/.benchmark-results/${id}.json`;
  } catch {
    return "";
  }
}

/**
 * Valida el borrador contra las reglas del schema compartido (no-vacío,
 * topes, trialsRef con enlace al run, sin traversal). Nunca lanza.
 */
function validateBenchmarkDecisionDraft(
  runId: unknown,
  draft: BenchmarkDecisionDraft,
): string[] {
  const errors: string[] = [];
  try {
    const id = typeof runId === "string" ? runId.trim() : "";
    if (!id) errors.push("sin run seleccionado");
    const change = typeof draft.change === "string" ? draft.change.trim() : "";
    if (!change) {
      errors.push("el cambio decidido es obligatorio (qué modelo/config cambia por tu ponderación)");
    } else if (change.length > DECISION_CHANGE_MAX) {
      errors.push(`el cambio supera ${DECISION_CHANGE_MAX} caracteres`);
    }
    if (draft.costWeight.length > DECISION_WEIGHT_MAX) {
      errors.push(`costWeight supera ${DECISION_WEIGHT_MAX} caracteres`);
    }
    if (draft.qualityWeight.length > DECISION_WEIGHT_MAX) {
      errors.push(`qualityWeight supera ${DECISION_WEIGHT_MAX} caracteres`);
    }
    const refRaw = typeof draft.trialsRef === "string" ? draft.trialsRef : "";
    const ref = refRaw.trim() || (id ? trialsRefForRun(id) : "");
    if (!ref) {
      errors.push("trialsRef obligatorio (apunta a los trials que ponderaste)");
    } else {
      if (ref.length > DECISION_TRIALS_REF_MAX) {
        errors.push(`trialsRef supera ${DECISION_TRIALS_REF_MAX} caracteres`);
      }
      if (ref.includes("..") || ref.includes("\\") || ref.includes("\0")) {
        errors.push("trialsRef sin traversal (.. o barras invertidas)");
      }
      if (id && !ref.includes(id)) {
        errors.push("trialsRef debe contener el id del run (enlace honesto con lo ponderado)");
      }
    }
    if (draft.note.length > DECISION_NOTE_MAX) {
      errors.push(`note supera ${DECISION_NOTE_MAX} caracteres`);
    }
  } catch {
    errors.push("no se pudo validar el borrador");
  }
  return errors.slice(0, DECISION_ERRORS_MAX);
}

/**
 * Arma el objeto BenchmarkDecision listo para registrar (decidedBy siempre
 * "human"; jamás emite claves winner/auto). Nunca lanza.
 */
function buildBenchmarkDecisionJson(
  runId: string,
  draft: BenchmarkDecisionDraft,
  decidedAt: string,
): Record<string, unknown> {
  try {
    const id = runId.trim();
    const ref = draft.trialsRef.trim() || trialsRefForRun(id);
    return {
      benchmarkId: id,
      decidedAt,
      decidedBy: "human",
      change: draft.change.trim(),
      costWeight: draft.costWeight.trim(),
      qualityWeight: draft.qualityWeight.trim(),
      trialsRef: ref,
      note: draft.note.trim(),
    };
  } catch {
    return { benchmarkId: "", decidedAt: "", decidedBy: "human", change: "", trialsRef: "" };
  }
}

export function BenchmarksPanel({ className }: { className?: string }) {
  const [runs, setRuns] = useState<BenchmarkRunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BenchmarkRunDetail | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [posting, setPosting] = useState(false);
  const [draft, setDraft] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  // Ola 18 P1.6 (E2): scorers cargados (para el aviso cuando la definition no
  // trae `scorers` explícito = se corren TODOS). Best-effort, nunca rompe.
  const [loadedScorers, setLoadedScorers] = useState(0);
  // F3-T3: compositor de decisión humana (estado local, 0 fetch + 0 polling).
  const [decisionDraft, setDecisionDraft] = useState<BenchmarkDecisionDraft>(EMPTY_DECISION_DRAFT);
  const [decisionErrors, setDecisionErrors] = useState<string[]>([]);
  const [preparedDecision, setPreparedDecision] = useState<{ runId: string; json: string; decidedAt: string } | null>(null);
  const [decisionCopied, setDecisionCopied] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const selectRun = useCallback((id: string | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    if (id === null) setDetail(null);
    // El preparado referencia un run fijo: al cambiar de run se invalida.
    setPreparedDecision(null);
    setDecisionErrors([]);
    setDecisionCopied(null);
  }, []);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const port = await discoverFactoryPort();
      if (port === null) return;
      try {
        const res = await fetchWithTimeout(benchmarksUrl(port), {}, FETCH_TIMEOUT_MS);
        if (!res.ok) return;
        const json: unknown = await res.json().catch(() => null);
        const list = parseRunsList(json);
        setRuns(list);
        if (selectedIdRef.current === null && list.length > 0) {
          selectedIdRef.current = list[0].id;
          setSelectedId(list[0].id);
        }
      } catch {
        // timeout/abort silencioso (polling vivo)
      }
      // Ola 18 P1.6 (E2): conteo de scorers cargados para el aviso de costo
      // (definition sin `scorers` = se corren todos). Best-effort.
      try {
        const res = await fetchWithTimeout(scorersUrl(port), {}, FETCH_TIMEOUT_MS);
        if (res.ok) {
          const json: unknown = await res.json().catch(() => null);
          setLoadedScorers(parseScorersList(json).length);
        }
      } catch {
        // timeout/abort silencioso (el aviso usa 0 = solo revisor)
      }
    } catch {
      // discovery falló: polling vivo, sin romper
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const port = await discoverFactoryPort();
      if (port === null) return;
      try {
        const res = await fetchWithTimeout(benchmarkRunUrl(port, id), {}, FETCH_TIMEOUT_MS);
        if (selectedIdRef.current !== id) return;
        if (!res.ok) {
          if (res.status === 404) setDetail(null);
          return;
        }
        const json: unknown = await res.json().catch(() => null);
        if (selectedIdRef.current !== id) return;
        setDetail(parseRunDetail(json));
      } catch {
        // timeout/abort silencioso (polling vivo)
      }
    } catch {
      // discovery falló: polling vivo, sin romper
    } finally {
      if (selectedIdRef.current === id) setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
    const t = window.setInterval(() => {
      void fetchRuns();
    }, POLL_RUNS_MS);
    return () => window.clearInterval(t);
  }, [fetchRuns]);

  useEffect(() => {
    if (!selectedId) return;
    void fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  const detailStatus = detail && selectedId ? detail.status : null;
  useEffect(() => {
    if (!selectedId || detailStatus === null || !isRunningStatus(detailStatus)) return;
    const t = window.setInterval(() => {
      void fetchDetail(selectedId);
    }, POLL_DETAIL_MS);
    return () => window.clearInterval(t);
  }, [selectedId, detailStatus, fetchDetail]);

  // Aviso de costo en vivo (Ola 18 P1.6, E2): trials × (1 + scorers) — 1
  // llamada al revisor + 1 por scorer por trial. Solo si el borrador valida
  // (se muestra ANTES del POST). Sin `scorers` explícito se corren TODOS los
  // cargados (conteo de GET /factory/scorers).
  const costPreview = useMemo(() => {
    if (!draft.trim()) return null;
    const v = validateDefinitionInput(draft);
    if (!v.ok) return null;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(draft) as unknown;
    } catch {
      return null;
    }
    const sf = parseScorersField(parsed);
    if (!sf.ok) return null;
    const explicit =
      !!parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as Record<string, unknown>).scorers);
    const scorerCount = explicit ? sf.scorers.length : loadedScorers;
    return {
      summary: v.summary,
      scorers: sf.scorers,
      explicitScorers: explicit,
      scorerCount,
      estimatedCalls: totalCallsWithScorers(
        parsed as { tasks?: unknown; configs?: unknown; repetitions?: unknown; scorers?: unknown },
        loadedScorers,
      ),
    };
  }, [draft, loadedScorers]);

  const runBenchmark = useCallback(async () => {
    if (posting) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setActionMsg(null);
      setActionErr("pegá la definition JSON del benchmark primero");
      return;
    }
    const v = validateDefinitionInput(trimmed);
    if (!v.ok) {
      setActionMsg(null);
      setActionErr(v.error);
      return;
    }
    let definition: unknown;
    try {
      definition = JSON.parse(trimmed) as unknown;
    } catch {
      setActionMsg(null);
      setActionErr("JSON inválido: revisá comas y comillas");
      return;
    }
    // Normalizar reviewerModel string → objeto (forma exacta del backend).
    const normalized = normalizeBenchmarkDefinition(definition);
    if (!normalized) {
      setActionMsg(null);
      setActionErr("la definition no tiene la forma esperada (revisá tasks/configs)");
      return;
    }
    definition = normalized;
    setPosting(true);
    setActionMsg(null);
    setActionErr(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setActionErr("daemon no disponible");
        return;
      }
      const res = await fetchWithTimeout(
        benchmarksUrl(port),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(definition),
        },
        POST_TIMEOUT_MS,
      );
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
      const id = typeof body.id === "string" && body.id.length > 0 ? body.id : null;
      const trials = typeof body.trials === "number" ? body.trials : v.summary.trials;
      const llmCalls = typeof body.llmCalls === "number" ? body.llmCalls : v.summary.trials;
      const scorers =
        typeof body.scorers === "number"
          ? body.scorers
          : costPreview
            ? costPreview.scorerCount
            : 0;
      setActionMsg(
        `benchmark creado${id ? ` (${id.slice(0, 12)}…)` : ""}: ${trials} trials × (1 + ${scorers} ${scorers === 1 ? "scorer" : "scorers"}) ≈ ${llmCalls} llamadas LLM — aparece en la lista`,
      );
      await fetchRuns();
      if (id) selectRun(id);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    } finally {
      setPosting(false);
    }
  }, [draft, posting, fetchRuns, selectRun, costPreview]);

  // F3-T3: prepara la decisión (valida + fija decidedAt + previsualiza).
  // Sin fetch: el registro viaja por vía engine hasta que exista la ruta POST.
  const prepareDecision = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) {
      setPreparedDecision(null);
      setDecisionErrors(["sin run seleccionado"]);
      setDecisionCopied(null);
      return;
    }
    const errors = validateBenchmarkDecisionDraft(id, decisionDraft);
    if (errors.length > 0) {
      setPreparedDecision(null);
      setDecisionErrors(errors);
      setDecisionCopied(null);
      return;
    }
    const decidedAt = new Date().toISOString();
    const json = JSON.stringify(buildBenchmarkDecisionJson(id, decisionDraft, decidedAt), null, 2);
    setPreparedDecision({ runId: id, json, decidedAt });
    setDecisionErrors([]);
    setDecisionCopied(null);
  }, [decisionDraft]);

  const copyPreparedDecision = useCallback(async () => {
    if (!preparedDecision) return;
    try {
      const clip = (navigator as unknown as { clipboard?: { writeText(t: string): Promise<void> } }).clipboard;
      if (!clip) throw new Error("portapapeles no disponible: seleccioná el texto manualmente");
      await clip.writeText(preparedDecision.json);
      setDecisionCopied("decisión copiada (JSON válido para recordBenchmarkDecision)");
    } catch (e) {
      setDecisionCopied(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    }
  }, [preparedDecision]);

  return (
    <div
      className={`rounded-lg border border-zinc-200 bg-white p-3 ${className ?? ""}`}
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-800">
          Benchmarks{" "}
          <span className="font-normal text-zinc-500">
            ({runs.length} {runs.length === 1 ? "run" : "runs"})
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {loadingRuns ? <span className="text-[11px] text-zinc-500">cargando…</span> : null}
          <button
            type="button"
            onClick={() => {
              void fetchRuns();
            }}
            className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            refrescar
          </button>
        </div>
      </div>

      <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
        sin ganador automático: vos ponderás pass rate vs duración
      </p>

      {runs.length === 0 ? (
        <div className="mt-2 text-[11px] text-zinc-500">
          Todavía no hay benchmarks — pegá una definition abajo y corré el primero (la lista se
          actualiza cada 15s).
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2 md:flex-row">
          <ul className="max-h-56 w-full overflow-auto rounded-md border border-zinc-200 md:w-64 md:shrink-0">
            {runs.map((r) => {
              const active = r.id === selectedId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => selectRun(r.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 ${
                      active ? "bg-zinc-100 font-semibold" : ""
                    }`}
                  >
                    <RunStatusDot status={r.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-zinc-800">{r.name || "sin nombre"}</span>
                      <span className="block text-[10px] text-zinc-500">
                        {statusLabel(r.status)} · {r.trials} trials · {formatRunDate(r.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="min-w-0 flex-1">
            {!selectedId ? (
              <div className="text-[11px] text-zinc-500">Seleccioná un run para ver el detalle.</div>
            ) : loadingDetail && !detail ? (
              <div className="text-[11px] text-zinc-500">cargando detalle…</div>
            ) : !detail ? (
              <div className="text-[11px] text-zinc-500">
                sin datos — el backend no devolvió el run (¿lo borró el cap de 20?).
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <RunStatusDot status={detail.status} />
                  <span className="font-semibold text-zinc-800">{detail.name || "sin nombre"}</span>
                  <span className="text-zinc-500">
                    {statusLabel(detail.status)} · creado {formatRunDate(detail.createdAt)}
                    {detail.finishedAt ? ` · fin ${formatRunDate(detail.finishedAt)}` : ""}
                  </span>
                </div>

                {Object.keys(detail.stats).length === 0 ? (
                  <div className="mt-1 text-[11px] text-zinc-500">
                    sin datos de stats todavía
                    {isRunningStatus(detail.status) ? " (el run sigue en curso…)" : ""}.
                  </div>
                ) : (
                  <table className="mt-2 w-full border-collapse text-[11px]">
                    <caption className="pb-1 text-left font-semibold text-zinc-700">
                      Por config
                    </caption>
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-zinc-500">
                        <th className="py-1 pr-2 font-medium">config</th>
                        <th className="py-1 pr-2 font-medium">trials</th>
                        <th className="py-1 pr-2 font-medium">pass rate</th>
                        <th className="py-1 pr-2 font-medium">score pass rate</th>
                        <th className="py-1 pr-2 font-medium">duración media</th>
                        <th className="py-1 font-medium">errores parse</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(detail.stats).map(([configId, s]) => (
                        <tr key={configId} className="border-b border-zinc-100 text-zinc-700">
                          <td className="py-1 pr-2 font-mono">{configId}</td>
                          <td className="py-1 pr-2">{s.trials}</td>
                          <td className="py-1 pr-2">
                            {formatPassRate({ trials: s.trials, pass: s.pass })}
                          </td>
                          <td className="py-1 pr-2">
                            {Object.keys(s.scorePassRates ?? {}).length === 0 ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <span className="flex flex-col gap-0.5">
                                {Object.entries(s.scorePassRates ?? {}).map(([name, rate]) => (
                                  <span key={name} className="font-mono" title={`scorePassRate de ${name} (solo trials scored)`}>
                                    {name} {formatScoreRateValue(rate)}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-2">{formatDuration(s.avgDurationMs)}</td>
                          <td className="py-1">{s.parseErrors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detail.trials.length === 0 ? (
                  <div className="mt-1 text-[11px] text-zinc-500">sin trials todavía.</div>
                ) : (
                  <table className="mt-2 w-full border-collapse text-[11px]">
                    <caption className="pb-1 text-left font-semibold text-zinc-700">
                      Trials ({detail.trials.length})
                    </caption>
                    <thead>
                      <tr className="border-b border-zinc-200 text-left text-zinc-500">
                        <th className="py-1 pr-2 font-medium">task</th>
                        <th className="py-1 pr-2 font-medium">config</th>
                        <th className="py-1 pr-2 font-medium">rep</th>
                        <th className="py-1 pr-2 font-medium">resultado</th>
                        <th className="py-1 pr-2 font-medium">scores</th>
                        <th className="py-1 pr-2 font-medium">conf</th>
                        <th className="py-1 font-medium">duración</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.trials.map((t, i) => (
                        <tr
                          key={`${t.taskId}-${t.configId}-${t.repetition}-${i}`}
                          className="border-b border-zinc-100 text-zinc-700"
                        >
                          <td className="py-1 pr-2 font-mono">{t.taskId}</td>
                          <td className="py-1 pr-2 font-mono">{t.configId}</td>
                          <td className="py-1 pr-2">{t.repetition}</td>
                          <td className="py-1 pr-2">
                            <TrialBadge tone={trialBadge(t)} verdict={t.verdict} />
                          </td>
                          <td className="py-1 pr-2">
                            {Object.keys(t.scores ?? {}).length === 0 ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <span className="flex flex-col gap-0.5">
                                {Object.entries(t.scores ?? {}).map(([name, e]) => (
                                  <span
                                    key={name}
                                    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold text-white ${
                                      e.passing ? "bg-green-600" : "bg-red-600"
                                    }`}
                                    title={`${name}: ${e.label} (${e.passing ? "passing" : "failing"} según el umbral actual)`}
                                  >
                                    {e.passing ? "✓" : "✗"} {name}:{e.label}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-2">{formatConfidence(t.confidence)}</td>
                          <td className="py-1">{formatDuration(t.durationMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-zinc-100 pt-2">
        <label
          htmlFor="benchmark-definition"
          className="text-[11px] font-semibold text-zinc-700"
        >
          Lanzar benchmark (definition JSON)
        </label>
        <p className="mt-0.5 text-[10px] text-zinc-500">
          Opcional: <span className="font-mono">"scorers": ["nombre", …]</span> (ausente = se corren
          todos los cargados, máx 10). Sin ganador automático: vos ponderás pass rate vs duración.
        </p>
        <textarea
          id="benchmark-definition"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={EXAMPLE_PLACEHOLDER}
          rows={5}
          spellCheck={false}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {costPreview ? (
          <p className="mt-1 text-[11px] font-medium text-amber-800" aria-live="polite">
            esto hará ≈ {costPreview.estimatedCalls} llamadas LLM ({costPreview.summary.trials}{" "}
            {costPreview.summary.trials === 1 ? "trial" : "trials"} × (1 + {costPreview.scorerCount}{" "}
            {costPreview.scorerCount === 1 ? "scorer" : "scorers"}
            {costPreview.explicitScorers ? "" : " cargados"}): {costPreview.summary.tasks}{" "}
            {costPreview.summary.tasks === 1 ? "task" : "tasks"} × {costPreview.summary.configs}{" "}
            {costPreview.summary.configs === 1 ? "config" : "configs"} × {costPreview.summary.repetitions}{" "}
            {costPreview.summary.repetitions === 1 ? "repetición" : "repeticiones"}; la duración depende de
            la cola del daemon
          </p>
        ) : null}
        <div className="mt-1.5">
          <button
            type="button"
            disabled={posting}
            onClick={() => void runBenchmark()}
            className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          >
            {posting ? "lanzando…" : "correr benchmark"}
          </button>
        </div>
      </div>

      {selectedId ? (
        <div className="mt-3 border-t border-zinc-100 pt-2">
          <h4 className="text-[11px] font-semibold text-zinc-700">
            Decisión humana del run
          </h4>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            vos ponderás costo vs calidad y la decisión queda a tu nombre (decidedBy human,
            nunca auto). El trialsRef enlaza los trials que ponderaste.
          </p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-700">
              <span className="font-medium">cambio decidido (obligatorio)</span>
              <input
                type="text"
                value={decisionDraft.change}
                onChange={(e) => setDecisionDraft((d) => ({ ...d, change: e.target.value }))}
                placeholder="review model big-pickle -> gpt-4o for review role"
                spellCheck={false}
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <div className="flex flex-col gap-1.5 md:flex-row">
              <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-zinc-700">
                <span className="font-medium">costWeight (opcional)</span>
                <input
                  type="text"
                  value={decisionDraft.costWeight}
                  onChange={(e) => setDecisionDraft((d) => ({ ...d, costWeight: e.target.value }))}
                  placeholder="weekly spend must stay flat"
                  spellCheck={false}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-zinc-700">
                <span className="font-medium">qualityWeight (opcional)</span>
                <input
                  type="text"
                  value={decisionDraft.qualityWeight}
                  onChange={(e) => setDecisionDraft((d) => ({ ...d, qualityWeight: e.target.value }))}
                  placeholder="fewer major misses on requirements"
                  spellCheck={false}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-700">
              <span className="font-medium">trialsRef (vacío = trials de este run)</span>
              <input
                type="text"
                value={decisionDraft.trialsRef}
                onChange={(e) => setDecisionDraft((d) => ({ ...d, trialsRef: e.target.value }))}
                placeholder={trialsRefForRun(selectedId)}
                spellCheck={false}
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-zinc-700">
              <span className="font-medium">note (opcional)</span>
              <textarea
                value={decisionDraft.note}
                onChange={(e) => setDecisionDraft((d) => ({ ...d, note: e.target.value }))}
                placeholder="human weighed cost vs quality over N trials"
                rows={2}
                spellCheck={false}
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-zinc-700 px-2 py-0.5 text-[11px] font-bold text-white">
              decidedBy: human
            </span>
            <button
              type="button"
              onClick={prepareDecision}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            >
              preparar decisión
            </button>
          </div>
          {decisionErrors.length > 0 ? (
            <ul className="mt-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-800" aria-live="polite">
              {decisionErrors.map((err) => (
                <li key={err.slice(0, 80)}>· {err}</li>
              ))}
            </ul>
          ) : null}
          {preparedDecision && preparedDecision.runId === selectedId ? (
            <div className="mt-1.5">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px] text-zinc-800">
                {preparedDecision.json}
              </pre>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyPreparedDecision()}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  copiar JSON
                </button>
                {decisionCopied ? (
                  <span className="text-[11px] text-green-700" aria-live="polite">{decisionCopied}</span>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] text-zinc-500">
                registro: aún sin ruta POST (carry-over declarado en F3-T3, wiring +0) — el
                estreno live registra esta decisión por vía engine (recordBenchmarkDecision,
                decidedAt {preparedDecision.decidedAt}) y el validador la audita
                (decisions-benchmark-record).
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {actionMsg || actionErr ? (
        <div className="mt-2 border-t border-zinc-100 pt-2" aria-live="polite">
          {actionMsg ? <span className="text-[11px] text-green-700">{actionMsg}</span> : null}
          {actionErr ? <span className="text-[11px] text-red-700">{actionErr}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export default BenchmarksPanel;
