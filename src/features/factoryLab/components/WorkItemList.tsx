/**
 * WorkItemList — tabla/lista Work Items sin reload.
 * Ola 2: badges para Review (púrpura) y Triage (ámbar con reason), colapsable timeline con reason.
 * Ola 3: badges pass/fail, preview createdFiles, links result.json/build.log, verification meta.
 */

import { useCallback, useEffect, useState } from "react";
import type { WorkItem, CostSummary } from "../../../../shared/types/workItem";
import { useWorkItemStore } from "@/stores/workItemStore";
import { discoverFactoryPort } from "@/lib/factoryDiscovery";
import { buildWorkItemSummary, copyTextToClipboard, readCreatedFiles } from "./workItemSummary";
import { extractTriageInfo } from "./triageUi";
import { TriageQuestions } from "./TriageQuestions";
import { CostBadge } from "./CostBadge";

const FALLBACK_FACTORY_PORT = 17680;

function StatusBadge({ status, reason, verification }: { status: string; reason?: string; verification?: { overall?: string } | null }) {
  const colorMap: Record<string, string> = {
    Intake: "bg-zinc-100 text-zinc-800 border-zinc-200",
    Foreman: "bg-amber-100 text-amber-800 border-amber-200",
    Triage: "bg-amber-100 text-amber-800 border-amber-300",
    Building: "bg-blue-100 text-blue-800 border-blue-200",
    Review: "bg-purple-100 text-purple-800 border-purple-200",
    Complete: "bg-green-100 text-green-800 border-green-200",
    Cancelled: "bg-red-100 text-red-800 border-red-200",
  };
  const cls = colorMap[status] ?? "bg-zinc-100 text-zinc-800 border-zinc-200";
  const isBuilding = status === "Building";
  const isTriage = status === "Triage";
  const isReview = status === "Review";
  const isComplete = status === "Complete";
  const overall = verification?.overall;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}
      aria-label={`status ${status}`}
      title={reason ? `reason: ${reason}` : undefined}
    >
      {isBuilding ? <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" aria-hidden="true" /> : null}
      {isTriage ? <span className="h-2 w-2 rounded-full bg-amber-600" aria-hidden="true" /> : null}
      {isReview ? <span className="h-2 w-2 animate-pulse rounded-full bg-purple-600" aria-hidden="true" /> : null}
      {isComplete && overall === "pass" ? <span className="h-2 w-2 rounded-full bg-green-600" aria-hidden="true" /> : null}
      {status}
      {isComplete && overall === "pass" ? (
        <span className="ml-1 rounded bg-green-600 px-1 py-0.5 text-[10px] font-bold text-white">pass</span>
      ) : null}
      {isTriage && overall === "fail" ? (
        <span className="ml-1 rounded bg-amber-600 px-1 py-0.5 text-[10px] font-bold text-white">fail</span>
      ) : null}
      {isComplete && overall === "fail" ? (
        <span className="ml-1 rounded bg-amber-500 px-1 py-0.5 text-[10px] font-bold text-white">fail</span>
      ) : null}
    </span>
  );
}

function PassFailBadge({ overall }: { overall?: string }) {
  if (overall === "pass") {
    return <span className="inline-flex items-center rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white">pass</span>;
  }
  if (overall === "fail") {
    return <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">fail</span>;
  }
  return null;
}

function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
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

/** Último isolation declarado en los steps de verificación del timeline (E1). */
function latestIsolation(wi: WorkItem): "docker" | "none" | null {
  try {
    const rev = [...(wi.timeline ?? [])].reverse();
    for (const e of rev) {
      const m = e.meta as Record<string, unknown> | undefined;
      const v = m?.verification as { steps?: unknown[] } | undefined;
      if (v && Array.isArray(v.steps)) {
        for (const s of [...v.steps].reverse()) {
          const iso = (s as { isolation?: unknown })?.isolation;
          if (iso === "docker" || iso === "none") return iso;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Perfil del runner desde el dato expuesto (timeline meta runnerSpec, que
 * viene del yaml vía loader). Soporta forma vieja
 * `{dockerImage, instanceShape:{cpu,memory}}` y forma nueva
 * `{platform:{dockerImage}, instanceShape:{vcpus,memoryGb}}`.
 */
function runnerProfileText(wi: WorkItem): string | null {
  try {
    const rev = [...(wi.timeline ?? [])].reverse();
    for (const e of rev) {
      const m = e.meta as Record<string, unknown> | undefined;
      const rs = m?.runnerSpec as Record<string, unknown> | undefined;
      if (rs && typeof rs === "object") {
        const image =
          (typeof rs.dockerImage === "string" && rs.dockerImage) ||
          ((rs.platform as Record<string, unknown> | undefined)?.dockerImage as string | undefined) ||
          null;
        const shape = rs.instanceShape as Record<string, unknown> | undefined;
        const cpu =
          (typeof shape?.cpu === "string" && (shape.cpu as string)) ||
          (typeof shape?.vcpus === "number" ? `${shape.vcpus}vCPU` : null) ||
          (typeof shape?.cpuCount === "number" ? `${shape.cpuCount}vCPU` : null);
        const mem =
          (typeof shape?.memory === "string" && (shape.memory as string)) ||
          (typeof shape?.memoryGb === "number" ? `${shape.memoryGb}GB` : null) ||
          (typeof shape?.memoryGB === "number" ? `${shape.memoryGB}GB` : null);
        const parts = [image, cpu && mem ? `${cpu}/${mem}` : (cpu ?? mem)].filter(Boolean);
        if (parts.length > 0) return `${(parts as string[]).join(" ")} (perfil del yaml)`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function readCostSummary(wi: WorkItem): CostSummary | null | undefined {
  try {
    const v = (wi as unknown as { costSummary?: CostSummary | null }).costSummary;
    if (v === null) return null;
    if (v && typeof v === "object") return v as CostSummary;
    return undefined;
  } catch {
    return undefined;
  }
}

export function WorkItemList() {
  const { workItems, isLoadingWorkItems, workItemsError } = useWorkItemStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [factoryPort, setFactoryPort] = useState<number>(FALLBACK_FACTORY_PORT);

  useEffect(() => {
    let cancelled = false;
    void discoverFactoryPort().then((port) => {
      if (!cancelled && port !== null) setFactoryPort(port);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const jobFileUrl = (id: string, suffix: "result" | "build-log") =>
    `http://127.0.0.1:${factoryPort}/factory/jobs/${encodeURIComponent(id)}/${suffix}`;

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopy = useCallback(
    async (wi: WorkItem) => {
      const text = buildWorkItemSummary(wi, {
        resultUrl: jobFileUrl(wi.id, "result"),
        buildLogUrl: jobFileUrl(wi.id, "build-log"),
      });
      const ok = await copyTextToClipboard(text);
      if (ok) {
        setCopiedId(wi.id);
        window.setTimeout(() => {
          setCopiedId((prev) => (prev === wi.id ? null : prev));
        }, 2000);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [factoryPort],
  );

  if (isLoadingWorkItems && workItems.length === 0) {
    return <div className="mt-4 text-xs text-zinc-500" aria-live="polite">Cargando Work Items…</div>;
  }

  if (workItemsError) {
    return (
      <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" aria-live="polite">
        Error Work Items: {workItemsError}
      </div>
    );
  }

  if (workItems.length === 0) {
    return (
      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600" aria-live="polite">
        Sin Work Items — creá uno con “Crear sesión” (prompt “Test Factory tildes ñ → 😀”).
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h2 className="mb-2 text-xs font-semibold text-zinc-800">Work Items <span className="font-normal text-zinc-500">({workItems.length})</span></h2>
      <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-zinc-50 text-[11px] font-semibold text-zinc-600">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Runner</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Timeline</th>
                <th className="px-3 py-2">.done</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {workItems.map((wi) => {
                const isExpanded = !!expanded[wi.id];
                const timelineLen = wi.timeline?.length ?? 0;
                const isComplete = wi.status === "Complete";
                const isCancelled = wi.status === "Cancelled";
                // H-002 E2: info de triage (reason/confidence de foremanDecision +
                // openQuestions concretas de meta.triage). Misma reason visible que antes.
                const triageInfo = wi.status === "Triage" ? extractTriageInfo(wi.timeline) : null;
                const reasonStr = triageInfo?.reason ? triageInfo.reason.slice(0, 80) : undefined;
                // Ola 3: extract verification from timeline meta (intacto).
                const verificationMeta = (() => {
                  const rev = [...(wi.timeline ?? [])].reverse();
                  for (const e of rev) {
                    const m = e.meta as Record<string, unknown> | undefined;
                    if (m && typeof m.verification === "object" && m.verification !== null) return m.verification as { overall?: string; steps?: unknown[] };
                  }
                  return null;
                })();
                // H-001 E2 (1 línea): createdFiles top-level primero (E1 lo espeja en
                // job.json), fallback a la meta del timeline. Ver `readCreatedFiles`.
                const createdFilesMeta = readCreatedFiles(wi);
                const overall = verificationMeta?.overall as string | undefined;
                const createdPreview = createdFilesMeta && createdFilesMeta.length > 0 ? createdFilesMeta.slice(0, 3) : null;
                // Ola 4: reviewCount + lastReview (verdict) — WorkItem extendido con opcionales
                const wiAny = wi as unknown as {
                  reviewCount?: number;
                  lastReview?: {
                    verdict?: string;
                    confidence?: number;
                    summary?: string;
                    findings?: unknown[];
                    reviewAttempt?: number;
                    reviewerModel?: { providerID?: string; modelID?: string };
                  };
                };
                const reviewCount = typeof wiAny.reviewCount === "number" ? wiAny.reviewCount : 0;
                const lastVerdict = typeof wiAny.lastReview?.verdict === "string" ? wiAny.lastReview.verdict : null;
                const lastAttempt = typeof wiAny.lastReview?.reviewAttempt === "number" ? wiAny.lastReview.reviewAttempt : null;
                return (
                  <tr key={wi.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 font-mono text-[11px] text-zinc-700" title={wi.id}>
                      {shortId(wi.id)}
                      {overall ? (
                        <span className="ml-1">
                          <PassFailBadge overall={overall} />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={wi.status} reason={reasonStr} verification={verificationMeta} />
                      {wi.status === "Triage" && reasonStr ? (
                        <div className="mt-1 max-w-[160px] truncate text-[11px] text-amber-700" title={reasonStr}>
                          {reasonStr}
                        </div>
                      ) : wi.status === "Review" ? (                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-purple-700">
                          <span>awaiting review</span>
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800 border border-purple-200">
                            R{reviewCount}{lastAttempt ? ` · intento ${lastAttempt}` : ""}
                          </span>
                          {lastVerdict ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${lastVerdict === "accept" ? "bg-green-600" : lastVerdict === "revise" ? "bg-amber-500" : "bg-purple-600"}`}
                            >
                              {lastVerdict}
                            </span>
                          ) : null}
                        </div>
                      ) : wi.status === "Building" ? (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" aria-hidden="true" />
                          Implementando…
                        </div>
                      ) : null}
                      {/* H-002 E2: preguntas concretas + responder/derivar, visible sin expandir (E2E-03). */}
                      {wi.status === "Triage" && triageInfo ? (
                        <TriageQuestions jobId={wi.id} info={triageInfo} />
                      ) : null}
                      {overall ? (
                        <div className="mt-1 text-[10px] text-zinc-500">verification: {overall} {verificationMeta?.steps ? `(${(verificationMeta.steps as unknown[]).length} steps)` : ""}</div>
                      ) : null}
                      {createdPreview ? (
                        <div className="mt-1 max-w-[180px] truncate text-[10px] text-zinc-600" title={createdFilesMeta?.join(", ")}>
                          {createdPreview.join(", ")}{createdFilesMeta && createdFilesMeta.length > 3 ? ` +${createdFilesMeta.length - 3} more` : ""}
                        </div>
                      ) : null}
                      {(reviewCount > 0 || lastVerdict) && wi.status !== "Review" ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-600">
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-semibold border border-zinc-200">
                            R{reviewCount}
                          </span>
                          {lastVerdict ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${lastVerdict === "accept" ? "bg-green-600" : lastVerdict === "revise" ? "bg-amber-500" : "bg-purple-600"}`}
                              title={typeof wiAny.lastReview?.summary === "string" ? String(wiAny.lastReview.summary).slice(0, 120) : undefined}
                            >
                              {lastVerdict}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      <div className="flex flex-col gap-1">
                        <span title={runnerProfileText(wi) ?? `runner: ${wi.runnerId ?? "linux-build"}`}>
                          {wi.runnerId ?? "linux-build"}
                        </span>
                        <IsolationBadge isolation={latestIsolation(wi)} />
                        {runnerProfileText(wi) ? (
                          <span className="max-w-[180px] truncate text-[10px] text-zinc-500" title={runnerProfileText(wi) ?? undefined}>
                            {runnerProfileText(wi)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <CostBadge summary={readCostSummary(wi)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [wi.id]: !prev[wi.id] }))}
                          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          aria-expanded={isExpanded}
                          aria-controls={`timeline-${wi.id}`}
                          title={isExpanded ? "Ocultar timeline" : "Ver timeline completo"}
                        >
                          {timelineLen} {isExpanded ? "▲" : "▼"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopy(wi)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                          title="Copiar resumen del job para pegar en el chat"
                        >
                          {copiedId === wi.id ? "✓ copiado" : "copiar"}
                        </button>
                      </div>
                      {isExpanded ? (
                        <div id={`timeline-${wi.id}`} className="mt-2 w-[min(640px,80vw)] rounded-md border border-zinc-200 bg-zinc-50 p-2">
                          <ol className="relative space-y-2 border-l-2 border-zinc-200 pl-3">
                            {(wi.timeline ?? []).map((entry) => {
                              const meta = entry.meta as Record<string, unknown> | undefined;
                              const fd = meta?.foremanDecision as Record<string, unknown> | undefined;
                              const hasReason = fd && typeof fd.reason === "string";
                              const ver = meta?.verification as Record<string, unknown> | undefined;
                              const hasVer = ver && typeof ver.overall === "string";
                              const cf = meta?.createdFiles as string[] | undefined;
                              // Ola 17 E2: evento reverify (meta.reverify aditiva de E1) — comandos +
                              // evidencia colapsable. Tipado estructural (unknown + optional chaining),
                              // sin importar tipos del motor.
                              const rvObj =
                                meta?.reverify !== null && typeof meta?.reverify === "object"
                                  ? (meta.reverify as { commands?: unknown; evidence?: unknown })
                                  : undefined;
                              const rvCommands = Array.isArray(rvObj?.commands)
                                ? (rvObj.commands as unknown[]).filter(
                                    (c): c is string => typeof c === "string",
                                  )
                                : [];
                              const rvEvidence =
                                typeof rvObj?.evidence === "string" ? rvObj.evidence : null;
                              const hasReverify =
                                rvObj !== undefined && (rvCommands.length > 0 || rvEvidence !== null);
                              return (
                                <li key={entry.id} className="relative">
                                  <span className="absolute -left-[19px] top-1.5 h-2.5 w-2.5 rounded-full bg-zinc-300 ring-2 ring-zinc-50" aria-hidden="true" />
                                  <div className="rounded-md border border-zinc-200 bg-white px-2 py-1.5">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">{entry.from}→{entry.to}</span>
                                      <span className="text-[11px] font-medium text-zinc-500">{entry.actor}</span>
                                      <span className="ml-auto text-[10px] text-zinc-400">{new Date(entry.at).toLocaleTimeString()}</span>
                                    </div>
                                    <p className="mt-1 select-text whitespace-pre-wrap break-words text-[11px] leading-snug text-zinc-700">{entry.message}</p>
                                    {hasReason ? (
                                      <div className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-900">
                                        <span className="font-semibold">reason:</span>{" "}
                                        <span className="select-text whitespace-pre-wrap break-words">“{String(fd.reason)}”</span>
                                        <span className="mt-0.5 block font-mono text-[10px] text-amber-700">confidence={String(fd.confidence ?? "?")} decision={String(fd.decision ?? "?")}</span>
                                      </div>
                                    ) : null}
                                    {hasVer ? (
                                      <div className="mt-1.5 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] leading-snug text-zinc-700">
                                        <span className="font-semibold">verification:</span>{" "}
                                        <span className="font-mono">overall={String(ver.overall)}</span>
                                        <span className="font-mono"> steps={(ver.steps as unknown[])?.length ?? 0}</span>
                                        <span className="font-mono"> durationMs={String(ver.durationMs ?? "?")}</span>
                                        {cf && cf.length > 0 ? (
                                          <span className="mt-0.5 block select-text break-words font-mono text-[10px] text-zinc-600">files: {cf.join(", ")}</span>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    {hasReverify ? (
                                      <div className="mt-1.5 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] leading-snug text-zinc-700">
                                        <span className="font-semibold">reverify:</span>{" "}
                                        <span className="select-text break-words font-mono text-[10px]">
                                          {rvCommands.length > 0 ? rvCommands.join(", ") : "sin comandos"}
                                        </span>
                                        {rvEvidence !== null ? (
                                          <details className="mt-1">
                                            <summary className="cursor-pointer text-[11px] font-medium text-zinc-600 hover:text-zinc-800">
                                              ver evidencia
                                            </summary>
                                            <pre className="mt-1 max-h-40 select-text overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900 px-2 py-1 font-mono text-[10px] text-zinc-100">
                                              {rvEvidence}
                                            </pre>
                                          </details>
                                        ) : null}
                                      </div>
                                    ) : null}
                                    {cf && !hasVer && cf.length > 0 ? (
                                      <div className="mt-1.5 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600">
                                        <span className="font-semibold">createdFiles:</span>{" "}
                                        <span className="select-text break-words font-mono text-[10px]">{cf.join(", ")}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                </li>
                              );
                            })}
                          </ol>
                          {wi.prompt ? (
                            <div className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5">
                              <div className="text-[11px] font-semibold text-zinc-700">Prompt</div>
                              <div className="select-text break-words whitespace-pre-wrap text-[11px] text-zinc-600">{wi.prompt}</div>
                            </div>
                          ) : null}
                          {createdFilesMeta ? (
                            <div className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5">
                              <div className="text-[11px] font-semibold text-zinc-700">CreatedFiles ({createdFilesMeta.length})</div>
                              <div className="select-text break-words font-mono text-[11px] text-zinc-600">{createdFilesMeta.join(", ")}</div>
                              <div className="mt-1 flex gap-2">
                                <a href={jobFileUrl(wi.id, "result")} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline">result.json</a>
                                <a href={jobFileUrl(wi.id, "build-log")} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline">build.log</a>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {isComplete ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                          ✓ .done {overall === "pass" ? <span className="rounded bg-white px-1 py-0.5 text-[9px] font-bold text-green-700">pass</span> : overall === "fail" ? <span className="rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold text-white">fail</span> : null}
                        </span>
                      ) : isCancelled ? (
                        <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">✗ Cancelled</span>
                      ) : wi.status === "Triage" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                          ⚠ Triage {overall === "fail" ? <span className="rounded bg-white px-1 py-0.5 text-[9px] font-bold text-amber-700">fail</span> : null}
                        </span>
                      ) : wi.status === "Review" ? (
                        <span className="inline-flex items-center rounded-full bg-purple-600 px-2 py-0.5 text-[11px] font-semibold text-white">◐ Review</span>
                      ) : wi.status === "Building" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white animate-pulse">
                          ● Building
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600">—</span>
                      )}
                      {(isComplete || wi.status === "Triage" || wi.status === "Building") && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          <a href={jobFileUrl(wi.id, "result")} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline">
                            result
                          </a>
                          <a href={jobFileUrl(wi.id, "build-log")} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline">
                            build.log
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-zinc-500" aria-live="polite">
        Polling vivo cada 2.5s sin reload — {workItems.length} items, {workItems.filter((w) => w.status === "Complete").length} Complete, {workItems.filter((w) => w.status === "Building").length} Building, {workItems.filter((w) => w.status === "Triage").length} Triage, {workItems.filter((w) => w.status === "Review").length} Review
      </div>
    </div>
  );
}

export default WorkItemList;
