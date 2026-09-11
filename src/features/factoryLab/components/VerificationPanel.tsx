/**
 * VerificationPanel — Ola 3.
 * Muestra result.json verification steps con exitCode, durationMs, createdFiles, timestamp, link a build.log.
 * Polling lazy por workItemId con fetchWithTimeout 3s.
 * Fix crash: verification puede ser undefined (Triage, recién creado, infra fail) — usa optional chaining y fallback "Sin verificación".
 */

import { useCallback, useEffect, useState } from "react";
import type { ImplementResultJson, VerificationReport, VerificationStep } from "../../../../shared/types/implement";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import {
  parseVerifyEvidence,
  type VerifyEvidenceItem,
} from "./verifyEvidence";
import {
  hasFullVerification,
  resolveVerificationView,
  type FallbackVerification,
} from "./verificationFallback";
import { DiscardJobButton } from "./DiscardJobButton";

export { parseVerifyEvidence, type VerifyEvidenceItem };

const FETCH_TIMEOUT_MS = 3000;

// TODO(F4-vista-única): migrar a src/lib/factoryClient.ts (único importador de red del renderer); carry-over F4-E2: el acceso directo actual NO se toca en esta tanda.
async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}


function StepIcon({ status }: { status: VerificationStep["status"] }) {
  if (status === "pass") return <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-[11px] font-bold text-white">✓</span>;
  if (status === "fail") return <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white">✗</span>;
  return <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-300 text-[11px] font-bold text-zinc-600">–</span>;
}

function StepBadge({ status }: { status: VerificationStep["status"] }) {
  const cls =
    status === "pass"
      ? "bg-green-100 text-green-800 border-green-200"
      : status === "fail"
        ? "bg-red-100 text-red-800 border-red-200"
        : "bg-zinc-100 text-zinc-600 border-zinc-200";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{status}</span>;
}

// ── Ola 15 E2: badge de aislamiento honesto (lee step.isolation de E1) ──
function IsolationBadge({ isolation }: { isolation: "docker" | "none" | null }) {
  if (isolation === "docker") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-800"
        title="Aislamiento real del step (E1): docker"
        aria-label="aislamiento docker"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-600" aria-hidden="true" />
        docker
      </span>
    );
  }
  if (isolation === "none") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
        title="Aislamiento real del step (E1): local · sin aislamiento"
        aria-label="aislamiento local sin aislamiento"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        local · sin aislamiento
      </span>
    );
  }
  return null;
}

function stepIsolation(step: VerificationStep): "docker" | "none" | null {
  try {
    const iso = (step as unknown as { isolation?: unknown })?.isolation;
    if (iso === "docker" || iso === "none") return iso;
    return null;
  } catch {
    return null;
  }
}

function overallIsolation(steps: VerificationStep[]): "docker" | "none" | null {
  try {
    const vals = steps.map(stepIsolation).filter((v): v is "docker" | "none" => v !== null);
    if (vals.length === 0) return null;
    const uniq = [...new Set(vals)];
    if (uniq.length === 1) return uniq[0] as "docker" | "none";
    return null;
  } catch {
    return null;
  }
}

interface VerificationPanelProps {
  workItemId: string | null;
  className?: string;
}

export function VerificationPanel({ workItemId, className }: VerificationPanelProps) {
  const [result, setResult] = useState<ImplementResultJson | null>(null);
  const [buildLog, setBuildLog] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBuildLog, setShowBuildLog] = useState(false);
  const [polling, setPolling] = useState(false);
  const [factoryPort, setFactoryPort] = useState<number>(17680);
  const [verifyPosting, setVerifyPosting] = useState(false);
  const [verifyRetryError, setVerifyRetryError] = useState<string | null>(null);
  const [verifyRetryLaunched, setVerifyRetryLaunched] = useState(false);
  // H-008 (parte 2): fallback a verify.json + timeline cuando result.json no
  // existe o viene sin `verification` (jobs no-terminales, ej. Triage por
  // setup-fail). Son los datos que el panel ya puede pedir (GET /verify +
  // GET single existentes, sin cambios de servidor).
  const [verifyJson, setVerifyJson] = useState<unknown>(null);
  const [jobJson, setJobJson] = useState<unknown>(null);

  // Best-effort: nunca lanza, deja nulls si algo falla (el panel muestra
  // "empty" honesto en vez de romper).
  const fetchFallback = useCallback(
    async (port: number) => {
      if (!workItemId) return;
      try {
        const vres = await fetchWithTimeout(
          `http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(workItemId)}/verify`,
          FETCH_TIMEOUT_MS,
        );
        if (vres.ok) setVerifyJson((await vres.json()) as unknown);
        else setVerifyJson(null);
      } catch {
        setVerifyJson(null);
      }
      try {
        const jres = await fetchWithTimeout(
          `http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(workItemId)}`,
          FETCH_TIMEOUT_MS,
        );
        if (jres.ok) setJobJson((await jres.json()) as unknown);
        else setJobJson(null);
      } catch {
        setJobJson(null);
      }
    },
    [workItemId],
  );

  const fetchResult = useCallback(async () => {
    if (!workItemId) {
      setResult(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        setError("Factory no disponible (17680-17690)");
        setLoading(false);
        return;
      }
      setFactoryPort(port);
      const res = await fetchWithTimeout(`http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(workItemId)}/result`, FETCH_TIMEOUT_MS);
      if (res.status === 404) {
        setResult(null);
        setError(null); // not yet built, not error
        // H-008: sin result.json, igual se intenta el fallback parcial.
        await fetchFallback(port);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GET /result → ${res.status} ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as unknown as ImplementResultJson;
      setResult(data);
      setError(null);
      // H-008: result.json pobre (sin verification) → fallback parcial.
      // Refactor ① E1 (A3): el chequeo vive en la forma única
      // (`hasFullVerification`, misma regla que la vista "full").
      if (hasFullVerification(data)) {
        setVerifyJson(null);
        setJobJson(null);
      } else {
        await fetchFallback(port);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout")) {
        // ignore timeout
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchFallback, workItemId]);

  const fetchBuildLog = useCallback(async () => {
    if (!workItemId) return;
    try {
      const port = await discoverFactoryPort();
      if (port === null) return;
      const res = await fetchWithTimeout(`http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(workItemId)}/build-log`, FETCH_TIMEOUT_MS);
      if (!res.ok) {
        setBuildLog(null);
        return;
      }
      const text = await res.text();
      setBuildLog(text);
    } catch {
      // ignore
    }
  }, [workItemId]);

  // Polling when workItemId changes or status Building (fetch every 3s while Building)
  useEffect(() => {
    if (!workItemId) return;
    void fetchResult();
    // poll every 2.5s while result is null (building) or overall pending
    const interval = window.setInterval(() => {
      void fetchResult();
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchResult, workItemId]);

  // Ola 9: reintentar verificación (Triage → re-verify). POST inmediato +
  // refresco con el polling existente (más un fetch inmediato).
  const handleVerifyRetry = useCallback(async () => {
    if (!workItemId || verifyPosting) return;
    setVerifyPosting(true);
    setVerifyRetryError(null);
    setVerifyRetryLaunched(false);
    try {
      const port = await discoverFactoryPort();
      if (port === null) {
        throw new Error("Factory no disponible (17680-17690)");
      }
      const res = await fetchWithTimeout(
        `http://127.0.0.1:${port}/factory/jobs/${encodeURIComponent(workItemId)}/review/verify-retry`,
        FETCH_TIMEOUT_MS,
        { method: "POST" },
      );
      if (res.status === 404) {
        throw new Error("Job no encontrado (404) — refrescá la lista");
      }
      if (res.status === 409) {
        throw new Error("El job ya no está en Triage (409) — refrescá");
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST /review/verify-retry → ${res.status} ${text.slice(0, 160)}`);
      }
      setVerifyRetryLaunched(true);
      await fetchResult();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout")) {
        setVerifyRetryError("Timeout lanzando re-verificación — puede seguir corriendo en el daemon");
      } else {
        setVerifyRetryError(msg);
      }
    } finally {
      setVerifyPosting(false);
    }
  }, [workItemId, verifyPosting, fetchResult]);

  useEffect(() => {
    if (showBuildLog && workItemId) {
      void fetchBuildLog();
    }
  }, [showBuildLog, fetchBuildLog, workItemId]);

  // Auto-poll polling indicator
  useEffect(() => {
    if (!workItemId) return;
    setPolling(true);
    const t = setTimeout(() => setPolling(false), 1000);
    return () => clearTimeout(t);
  }, [result, workItemId]);

  if (!workItemId) {
    return (
      <div className={`rounded-lg border border-zinc-200 bg-zinc-50 p-3 ${className ?? ""}`} aria-live="polite">
        <h3 className="text-xs font-semibold text-zinc-800">Verificación</h3>
        <p className="mt-1 text-[11px] text-zinc-500">Seleccioná un WorkItem para ver verificación (result.json / build.log)</p>
      </div>
    );
  }

  // Safe guards: verification puede ser undefined (Triage, recién creado, infra fail)
  // H-008 (parte 2): la vista se resuelve con fallback — `result` rico manda;
  // si falta, `verify.json` + timeline del job dan vista "parcial" honesta
  // (nunca "pendiente" cuando hay evidence). Tipado estructural, sin headless.
  const view = resolveVerificationView({ result, verify: verifyJson, job: jobJson });
  const viewVerification: FallbackVerification | null = view.verification;
  const verification: VerificationReport | undefined = (viewVerification as unknown as VerificationReport | null) ?? undefined;
  const steps: VerificationStep[] = ((viewVerification?.steps ?? []) as unknown as VerificationStep[]);
  const overall: string | undefined = viewVerification?.overall;
  // Ola 9: evidence del result o del fallback (jobs viejos → [] y no se muestra nada).
  const evidence: VerifyEvidenceItem[] = view.evidence;
  const createdFiles: string[] = view.createdFiles;
  const resultStatus: string | undefined =
    view.mode === "full"
      ? (result as unknown as { status?: string } | null)?.status
      : view.mode === "partial"
        ? view.status
        : undefined;
  const workItemIdSafe: string = (result as unknown as { workItemId?: string } | null)?.workItemId ?? workItemId ?? "";
  const runnerIdSafe: string = (result as unknown as { runnerId?: string } | null)?.runnerId ?? "—";
  const timestampSafe: string | null = (result as unknown as { timestamp?: string } | null)?.timestamp ?? null;
  const worktreePathSafe: string = (result as unknown as { worktreePath?: string } | null)?.worktreePath ?? "—";

  return (
    <div className={`rounded-lg border border-zinc-200 bg-white p-3 ${className ?? ""}`} aria-live="polite">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-800">Verificación — {workItemId.slice(0, 12)}…</h3>
        <div className="flex items-center gap-2">
          {loading ? <span className="text-[11px] text-zinc-500">cargando…</span> : null}
          {polling ? <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" aria-hidden="true" /> : null}
          <button
            type="button"
            onClick={() => void fetchResult()}
            className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100"
          >
            refrescar
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</div>
      ) : null}

      {!result && view.mode === "empty" && !loading && !error ? (
        <div className="mt-2 text-[11px] text-zinc-500">
          Sin result.json todavía — {`status Building? verificación en curso (polling 2.5s)`}
        </div>
      ) : null}

      {view.note ? (
        <div
          className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
          aria-live="polite"
        >
          {view.note}
        </div>
      ) : null}

      {view.mode !== "empty" ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-bold ${resultStatus === "pass" ? "bg-green-600 text-white" : resultStatus === "fail" ? "bg-amber-500 text-white" : "bg-zinc-400 text-white"}`}>
              {resultStatus === "pass" ? "✓ pass" : resultStatus === "fail" ? "✗ fail" : "○ pendiente"}
            </span>
            <span className="text-[11px] text-zinc-600">runner: {runnerIdSafe}</span>
            {/* Runner label is dynamic (daemon/yaml via loader); no hardcoded image/profile here. */}
            <IsolationBadge isolation={overallIsolation(steps)} />
            <span className="text-[11px] text-zinc-500">{timestampSafe ? new Date(timestampSafe).toLocaleString() : "—"}</span>
            <span className="text-[11px] text-zinc-500">worktree: {worktreePathSafe}</span>
            {result?.modelRef ? (
              <span className="text-[11px] text-zinc-500">
                model: {result.modelRef.providerID}/{result.modelRef.modelID}
              </span>
            ) : null}
          </div>

          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
            {verification ? (
              <>
                <div className="text-[11px] font-semibold text-zinc-700">Verification — overall: {overall ?? "Pendiente"}</div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {steps.length} steps • {verification.durationMs ?? "—"}ms • started {verification.startedAt ? new Date(verification.startedAt).toLocaleTimeString() : "—"}
                </div>
                {steps.length === 0 ? (
                  <div className="mt-2 text-[11px] text-zinc-500">Sin steps — verificación vacía</div>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {steps.map((step, idx) => (
                      <li key={`${step?.name ?? "step"}-${idx}`} className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5">
                        <StepIcon status={step?.status ?? "skipped"} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-zinc-800">{step?.name ?? "—"}</span>
                            <span className="font-mono text-[10px] text-zinc-500">{step?.command ?? "—"}</span>
                            <span className="ml-auto flex items-center gap-1">
                              <IsolationBadge isolation={stepIsolation(step)} />
                              <StepBadge status={step?.status ?? "skipped"} />
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500">
                            <span>exitCode: {step?.exitCode ?? "null"}</span>
                            <span>duration: {step?.durationMs ?? "—"}ms</span>
                            <span className="truncate">log: {step?.logPath ?? "—"}</span>
                          </div>
                          {step?.logSnippet ? (
                            <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-100">
                              {step.logSnippet.slice(0, 800)}
                            </pre>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="text-[11px] text-zinc-500" aria-live="polite">
                Sin verificación — {resultStatus === "fail" ? "fail sin detalles (infra/modelo falló)" : "Pendiente"}
              </div>
            )}
          </div>

          {evidence.length > 0 ? (
            <div>
              <div className="text-[11px] font-semibold text-zinc-700">Evidencia ({evidence.length})</div>
              <ul className="mt-1 space-y-2">
                {evidence.map((ev, idx) => (
                  <li key={`${ev.kind}-${idx}`} className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5">
                    <StepIcon status={ev.status as VerificationStep["status"]} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-zinc-800">{ev.kind}</span>
                        <span className="ml-auto">
                          <StepBadge status={ev.status as VerificationStep["status"]} />
                        </span>
                      </div>
                      {ev.ref ? (
                        <div className="mt-1 truncate font-mono text-[10px] text-zinc-500" title={ev.ref}>
                          ref: {ev.ref}
                        </div>
                      ) : null}
                      {ev.summary ? (
                        <div className="mt-1 text-[11px] text-zinc-700">{ev.summary}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <div className="text-[11px] font-semibold text-zinc-700">CreatedFiles ({createdFiles.length})</div>
            {createdFiles.length === 0 ? (
              <div className="text-[11px] text-zinc-500">— ningún archivo (no-op o todos excluidos)</div>
            ) : (
              <ul className="mt-1 list-disc pl-4 text-[11px] text-zinc-700">
                {createdFiles.map((f) => (
                  <li key={f} className="font-mono text-[11px]">{f}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {overall === "fail" ? (
              <button
                type="button"
                onClick={() => void handleVerifyRetry()}
                disabled={verifyPosting}
                aria-label="Reintentar verificación"
                aria-busy={verifyPosting}
                className="rounded-md bg-amber-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-amber-600 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
              >
                {verifyPosting ? "reintentando…" : "reintentar verificación"}
              </button>
            ) : null}
            {overall === "fail" && workItemId ? (
              <DiscardJobButton jobId={workItemId} port={factoryPort} onDone={() => void fetchResult()} />
            ) : null}
            <button
              type="button"
              onClick={() => setShowBuildLog((v) => !v)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
            >
              {showBuildLog ? "ocultar build.log" : "ver build.log"}
            </button>
            <a
              href={`http://127.0.0.1:${factoryPort}/factory/jobs/${encodeURIComponent(workItemIdSafe)}/result`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-zinc-800"
            >
              result.json
            </a>
            <a
              href={`http://127.0.0.1:${factoryPort}/factory/jobs/${encodeURIComponent(workItemIdSafe)}/build-log`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
            >
              build.log (raw)
            </a>
          </div>

          {verifyRetryError ? (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
              {verifyRetryError}
            </div>
          ) : null}
          {verifyRetryLaunched && !verifyRetryError ? (
            <div aria-live="polite" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              Re-verificación lanzada — el resultado se actualiza solo (polling 2.5s).
            </div>
          ) : null}

          {showBuildLog ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-900 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-100">logs/build.log</span>
                <button
                  type="button"
                  onClick={() => void fetchBuildLog()}
                  className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
                >
                  refrescar
                </button>
              </div>
              <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-100">
                {buildLog ?? "cargando build.log..."}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default VerificationPanel;
