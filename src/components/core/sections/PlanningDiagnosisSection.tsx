// Sección PLANNING → Diagnóstico del Repositorio (auditoría real).
//
// Extraída VERBATIM del cuerpo de CoreArchitectureModal: vista detalle de un
// diagnóstico, vista running (sesión headless con xterm) y vista idle (acción
// + historial). El estado de la sesión vive en diagnosisStore a nivel módulo:
// cerrar el modal NO la cancela. La tarjeta fija de seguridad del repo es
// chrome del shell y comparte securityOpen por contexto.

import { useEffect, useState } from "react";
import { PlannerTerminalPane } from "../../PlannerTerminalPane";
import { EffectiveModelChip } from "../../ai/EffectiveModelChip";
import { RepoSecurityFlow } from "../../RepoSecurityFlow";
import { relativeTimeLabel } from "../../../snapshotHistory";
import { useDiagnosisStore } from "../../../stores/diagnosisStore";
import {
  DIAGNOSIS_CATEGORIES,
  categoryLabel,
  getDiagnosisCategory,
} from "../../../types/diagnosisCategories";
import { resolveActiveWorktree } from "../../../planner/planningSession";
import { useCoreModal } from "../context";
import {
  CollapsibleJson,
  DiagnosisIcon,
  GitHubIcon,
  SecurityShieldIcon,
  TrashIcon,
  makeDiagStats,
  sortFindingsBySeverity,
} from "../shared";

export function PlanningDiagnosisSection() {
  const { navigate, openGithubIssues, securityOpen, openSecurityFlow, closeSecurityFlow } = useCoreModal();

  // Flujo de seguridad del repositorio: la tarjeta fija del shell abre la
  // checklist como vista interna de esta sección.
  const [viewingDiagId, setViewingDiagId] = useState<string | null>(null);
  const [diagJsonOpen, setDiagJsonOpen] = useState(false);
  const [deletingDiag, setDeletingDiag] = useState<{
    id: string;
    filename: string;
  } | null>(null);
  // Categoría elegida en el selector (idle): el botón "+ Nuevo diagnóstico"
  // la pasa al store. La corrida en curso la expone selectedCategory del
  // store (sobrevive cerrar/abrir el modal).
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  // Prompt persistido como sidecar (<plan>.json.prompt.md) del diagnóstico
  // que se está viendo en detalle: los registros cargados desde disco no
  // traen prompt en memoria, así que se lee lazy al abrir el detalle.
  const [detailPrompt, setDetailPrompt] = useState<string | null>(null);

  const diagPhase = useDiagnosisStore((s) => s.phase);
  const diagSessionRuntime = useDiagnosisStore((s) => s.sessionRuntime);
  const diagError = useDiagnosisStore((s) => s.error);
  const diagHistory = useDiagnosisStore((s) => s.history);
  const diagLatestId = useDiagnosisStore((s) => s.latestDiagnosisId);
  const diagToolsDone = useDiagnosisStore((s) => s.toolsDone);
  const diagToolsSummary = useDiagnosisStore((s) => s.toolsSummary);
  const diagSelectedCategory = useDiagnosisStore((s) => s.selectedCategory);
  const diagToolFindings = useDiagnosisStore((s) => s.toolFindingsByCategory);

  // Último análisis COMPLETADO por categoría (id = diag-<ts>): alimenta el
  // "Último análisis" de cada tarjeta del selector.
  const lastRunByCategory = new Map<string, { ts: number; findings: number }>();
  for (const rec of diagHistory) {
    const ts = Number(rec.id.slice("diag-".length));
    if (!Number.isFinite(ts)) continue;
    const current = lastRunByCategory.get(rec.category);
    if (!current || ts > current.ts) {
      lastRunByCategory.set(rec.category, {
        ts,
        findings: rec.data.findings.length,
      });
    }
  }

  // Reglas del "→ LLM directo": solo categorías CON herramientas y SOLO si
  // esas herramientas corrieron alguna vez (tool-findings propio en disco —
  // aunque su LLM haya fallado después, que es justo el caso de retry).
  const selectedCat = selectedCategoryId
    ? getDiagnosisCategory(selectedCategoryId)
    : undefined;
  const hasCategoryToolFindings = !!(
    selectedCategoryId && diagToolFindings[selectedCategoryId] !== undefined
  );
  const llmDirectAvailable =
    !!selectedCat && selectedCat.tools.length > 0 && hasCategoryToolFindings;

  // Sidecar del prompt: se lee al abrir el detalle de un diagnóstico.
  useEffect(() => {
    setDetailPrompt(null);
    if (!viewingDiagId) return;
    const active = resolveActiveWorktree();
    if (!active) return;
    const rec = useDiagnosisStore
      .getState()
      .history.find((d) => d.id === viewingDiagId);
    if (!rec) return;
    void window.termcanvas.fs
      .readFile(
        `${active.path.replace(/[\\/]+$/, "")}/.agents/planning/${rec.filename}.prompt.md`,
      )
      .then((read) => {
        if (read && "content" in read) setDetailPrompt(read.content);
      })
      .catch(() => {});
  }, [viewingDiagId]);

  // Un diagnóstico terminado (en primer plano o de fondo) se consume una
  // sola vez: la primera apertura de la sección muestra su detalle.
  useEffect(() => {
    const latest = useDiagnosisStore.getState().takeLatestId();
    if (latest) {
      setViewingDiagId(latest);
      setDiagJsonOpen(false);
    }
  }, [diagLatestId]);

  // Flujo de seguridad del repositorio (checklist → logs → resultado).
  if (securityOpen) {
    return <RepoSecurityFlow onBack={closeSecurityFlow} />;
  }

  // Vista detalle de un diagnóstico del historial.
  if (viewingDiagId !== null) {
    const rec = diagHistory.find((d) => d.id === viewingDiagId);
    if (!rec) {
      setViewingDiagId(null);
      return null;
    }
    const stats = makeDiagStats(rec.data.findings);
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            onClick={() => {
              setViewingDiagId(null);
              setDiagJsonOpen(false);
            }}
          >
            <span>←</span>
            <span>Volver al diagnóstico</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] flex items-center gap-1.5"
            onClick={() => openGithubIssues(rec.id)}
          >
            <GitHubIcon />
            <span>Ver en GitHub Issues →</span>
          </button>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-500/8 border border-emerald-500/25">
          <div className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-sm shrink-0 mt-0.5">✓</div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-bold text-emerald-400">Diagnóstico completado</p>
              <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded border text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent)]/30">
                {categoryLabel(rec.category)}
              </span>
            </div>
            <p className="text-[10.5px] font-mono text-[var(--text-muted)]">{rec.repo}</p>
            <p className="text-[10px] font-mono text-[var(--text-muted)]">{rec.filename} · {rec.timestamp}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "% Cobertura",
              value:
                rec.toolCoverage?.pct != null
                  ? `${rec.toolCoverage.pct}%`
                  : "—",
              sub:
                rec.toolCoverage?.packages?.length
                  ? rec.toolCoverage.packages
                      .map((p) =>
                        p.scanned != null
                          ? `${p.scanned}/${p.files} ${p.name}`
                          : `${p.name}: sin herramienta de archivos`,
                      )
                      .join(" · ")
                  : undefined,
            },
            { label: "Hallazgos", value: stats.total },
            { label: "Issues críticos", value: stats.critical, highlight: true },
            { label: "Archivos con issues", value: stats.uniqueFiles },
          ].map(({ label, value, sub, highlight }) => (
            <div key={label} className={`p-3 rounded-md border text-center space-y-0.5 ${highlight ? "bg-red-500/8 border-red-500/25" : "bg-[var(--bg)] border-[var(--border)]"}`}>
              <p className={`text-base font-bold font-mono tabular-nums ${highlight ? "text-red-400" : "text-[var(--text-primary)]"}`}>{value}</p>
              <p className="text-[10px] text-[var(--text-muted)] leading-tight">{label}</p>
              {sub && <p className="text-[9px] font-mono text-[var(--text-muted)] leading-tight">{sub}</p>}
            </div>
          ))}
        </div>

        {rec.toolCoverage && (
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-md border border-[var(--border)] bg-[var(--bg)]">
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              Herramientas deterministas:{" "}
              <span className="text-emerald-400 font-semibold">
                {rec.toolCoverage.toolsOk}/{rec.toolCoverage.toolsTotal} ok
              </span>
              {rec.toolCoverage.notEvaluated.length > 0 && (
                <span className="text-amber-400">
                  {" "}· {rec.toolCoverage.notEvaluated.length} no evaluada(s):{" "}
                  {rec.toolCoverage.notEvaluated.join("; ")}
                </span>
              )}
              {rec.toolCoverage.packages.some((p) => p.scanned == null) && (
                <span>
                  {" "}·{" "}
                  {rec.toolCoverage.packages
                    .filter((p) => p.scanned == null)
                    .map((p) => p.name)
                    .join(", ")}{" "}
                  sin herramienta de archivos
                </span>
              )}
            </span>
            <span className="text-[9.5px] font-mono text-[var(--text-muted)] shrink-0">
              cobertura por herramientas, no del LLM
            </span>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">ISSUES DETECTADOS</span>
            <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
              {stats.total} hallazgos · {stats.critical} críticos · {stats.high} altos
            </span>
          </div>
          {sortFindingsBySeverity(rec.data.findings).map((finding, i) => {
            const sStyle = finding.severity === "critical" ? "border-red-500/25 bg-red-500/5" : finding.severity === "high" ? "border-amber-500/20 bg-amber-500/5" : "border-[var(--border)] bg-[var(--bg)]";
            const sBadge = finding.severity === "critical" ? "text-red-400 bg-red-500/15 border-red-500/25" : finding.severity === "high" ? "text-amber-400 bg-amber-500/15 border-amber-500/20" : "text-[var(--text-muted)] bg-[var(--surface)] border-[var(--border)]";
            return (
              <div key={i} className={`p-3 rounded-md border text-xs space-y-1.5 ${sStyle}`}>
                <div className="flex items-start gap-2 flex-wrap">
                  <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${sBadge}`}>{finding.severity.toUpperCase()}</span>
                  {finding.rule === "requisito-no-cumplido" && (
                    <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent)]/30">
                      Requisito
                    </span>
                  )}
                  <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug flex-1">{finding.title}</p>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{finding.description}</p>
                <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                  <span className="font-mono text-[9.5px] text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">{finding.file}:{finding.line}</span>
                  {(finding.labels ?? []).map((lbl) => (
                    <span key={lbl} className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]">{lbl}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <CollapsibleJson label={`Ver JSON resultante (${rec.filename})`} data={rec.data} open={diagJsonOpen} onToggle={() => setDiagJsonOpen((v) => !v)} />

        {rec.data.requisitos && rec.data.requisitos.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                CUMPLIMIENTO DE REQUERIMIENTOS
              </span>
              <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
                {(() => {
                  const c = { CUMPLE: 0, NO_CUMPLE: 0, PARCIAL: 0, NO_VERIFICABLE: 0 } as Record<string, number>;
                  for (const v of rec.data.requisitos ?? []) c[v.estado] = (c[v.estado] ?? 0) + 1;
                  const total = rec.data.requisitos?.length ?? 0;
                  const defectos = c.NO_CUMPLE + c.PARCIAL;
                  return `${c.CUMPLE}/${total} cumplen · ${defectos} defecto(s) · ${c.NO_VERIFICABLE} sin medición`;
                })()}
              </span>
            </div>
            <div className="space-y-1.5">
              {rec.data.requisitos.map((v) => {
                const style =
                  v.estado === "CUMPLE"
                    ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/25"
                    : v.estado === "NO_CUMPLE"
                      ? "text-red-400 bg-red-500/15 border-red-500/25"
                      : v.estado === "PARCIAL"
                        ? "text-amber-400 bg-amber-500/15 border-amber-500/25"
                        : "text-orange-400 bg-orange-500/15 border-orange-500/25";
                const border =
                  v.estado === "CUMPLE"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : v.estado === "NO_CUMPLE"
                      ? "border-red-500/25 bg-red-500/5"
                      : v.estado === "PARCIAL"
                        ? "border-amber-500/20 bg-amber-500/5"
                        : "border-orange-500/20 bg-orange-500/5";
                return (
                  <div key={v.id} className={`p-2.5 rounded-md border text-xs space-y-1 ${border}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] font-semibold text-[var(--text-primary)]">{v.id}</span>
                      <span className={`font-mono text-[9.5px] font-semibold px-1.5 py-0.5 rounded border ${style}`}>
                        {v.estado}
                        {v.estado === "NO_VERIFICABLE" ? " · requiere medición" : ""}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{v.justificacion}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(rec.prompt ?? detailPrompt) && (
          <details className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
            <summary className="flex items-center justify-between px-3 py-2 text-[11px] font-mono text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors list-none">
              <span>Ver prompt enviado a opencode{categoryLabel(rec.category) !== "General" ? ` · ${categoryLabel(rec.category)}` : ""}</span>
              <span className="text-[10px]">▾</span>
            </summary>
            <pre className="p-3 border-t border-[var(--border)] bg-[var(--surface)] text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap max-h-48 overflow-y-auto">
              {rec.prompt ?? detailPrompt}
            </pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={diagPhase !== "idle" ? "h-full flex flex-col gap-5" : "space-y-5"}>
        {/* RUNNING (tools + LLM): sesión headless real (xterm) */}
        {diagPhase !== "idle" && (
          <div className="flex flex-col gap-3 min-h-0 flex-1">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border)] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
              <span className="text-[11px] font-mono font-semibold text-[var(--text-secondary)]">
                {diagPhase === "tools"
                  ? diagToolsDone
                    ? "Herramientas completadas — revisá el log antes de continuar"
                    : "Herramientas deterministas — escaneando el repositorio"
                  : "Sesión opencode activa — diagnóstico en curso"}
              </span>
              {diagSelectedCategory && (
                <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent)]/30">
                  {categoryLabel(diagSelectedCategory)}
                </span>
              )}
              {diagPhase === "running" && (
                <EffectiveModelChip phaseId="diagnosisLlm" />
              )}
            </div>
              <button
                type="button"
                className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] shrink-0"
                onClick={() => useDiagnosisStore.getState().cancel()}
              >
                Cancelar
              </button>
            </div>
            {diagSessionRuntime ? (
              <div className="flex flex-col gap-2 min-h-0 flex-1">
                {diagSessionRuntime.prompt && (
                  <details className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden shrink-0">
                    <summary className="flex items-center justify-between px-3 py-2 text-[11px] font-mono text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors list-none">
                      <span>Prompt enviado a opencode</span>
                      <span className="text-[10px]">▾</span>
                    </summary>
                    <pre className="p-3 border-t border-[var(--border)] bg-[var(--surface)] text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {diagSessionRuntime.prompt}
                    </pre>
                  </details>
                )}
                <div className="relative flex-1 min-h-[240px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)]">
                  <PlannerTerminalPane terminalId={diagSessionRuntime.terminalId} />
                </div>
              </div>
            ) : (
              <div className="text-[11px] font-mono text-[var(--text-muted)] py-6 text-center animate-pulse shrink-0">
                {diagPhase === "tools"
                  ? "Iniciando pipeline de herramientas…"
                  : "Iniciando sesión de opencode…"}
              </div>
            )}

            {/* Gate herramientas → LLM: el botón se habilita cuando
                TODAS las herramientas terminaron (archivo + exit 0) */}
            {diagPhase === "tools" && (
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-md border bg-[var(--bg)] border-[var(--border)] shrink-0">
                {diagToolsDone ? (
                  <>
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-bold text-emerald-400">Herramientas completadas</p>
                      <p className="text-[10px] font-mono text-[var(--text-muted)] flex items-center gap-2 flex-wrap">
                        <span>
                          {diagToolsSummary
                            ? `${diagToolsSummary.toolsOk}/${diagToolsSummary.toolsTotal} herramientas ok${diagToolsSummary.notEvaluated.length > 0 ? ` · ${diagToolsSummary.notEvaluated.length} no evaluada(s)` : ""}`
                            : "Escaneo completo"}{" "}
                          — revisá el log y continuá con el diagnóstico LLM
                        </span>
                        <EffectiveModelChip phaseId="diagnosisLlm" />
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0"
                      onClick={() => void useDiagnosisStore.getState().continueToLlm()}
                    >
                      Continuar al diagnóstico LLM →
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[10.5px] font-mono text-[var(--text-muted)]">
                      Esperando a que todas las herramientas terminen de escanear…
                    </p>
                    <button
                      type="button"
                      disabled
                      className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0 opacity-50 cursor-not-allowed"
                    >
                      Herramientas escaneando…
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* IDLE: acción + historial */}
        {diagPhase === "idle" && (
          <>
            {diagError && (
              <div className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-red-500/8 border border-red-500/25">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-bold text-red-400">El diagnóstico falló</p>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{diagError}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] shrink-0"
                  onClick={() => useDiagnosisStore.getState().dismissError()}
                >
                  Cerrar
                </button>
              </div>
            )}
            <div className="flex items-center gap-4 p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <div className="w-9 h-9 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
                <DiagnosisIcon />
              </div>
              <div className="space-y-1 flex-1">
                <h3 className="text-xs font-bold text-[var(--text-primary)]">Diagnóstico del Repositorio</h3>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  Elegí una categoría: corren solo sus herramientas deterministas y el LLM analiza con foco exclusivo en esa área. Cada corrida guarda su propio JSON en{" "}
                  <code className="text-[var(--text-secondary)] bg-[var(--surface)] px-1 rounded border border-[var(--border)]">
                    .agents/planning/diagnostico-&lt;categoría&gt;-*.json
                  </code>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* LLM directo: solo para categorías CON herramientas y solo
                    si esas herramientas corrieron alguna vez (tool-findings
                    propio en disco). En categorías LLM-only no hay Fase A que
                    saltear: se oculta. */}
                {(!selectedCat || selectedCat.tools.length > 0) && (
                  <button
                    type="button"
                    className="btn btn-ghost text-[11px] py-2 px-3 border border-[var(--border)] shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!llmDirectAvailable}
                    title={
                      llmDirectAvailable
                        ? "Saltea las herramientas y lanza el LLM con el tool-findings más reciente de esta categoría"
                        : selectedCat
                          ? "Todavía no corrieron las herramientas de esta categoría — lanzá primero el diagnóstico completo"
                          : "Elegí una categoría primero"
                    }
                    onClick={() => {
                      if (selectedCategoryId) {
                        void useDiagnosisStore.getState().startLlmDirect(selectedCategoryId);
                      }
                    }}
                  >
                    → LLM directo
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedCategoryId}
                  title={selectedCategoryId ? undefined : "Elegí una categoría primero"}
                  onClick={() => {
                    if (selectedCategoryId) void useDiagnosisStore.getState().start(selectedCategoryId);
                  }}
                >
                  + Nuevo diagnóstico
                </button>
              </div>
            </div>

            {/* Selector de categoría (single-select): la categoría decide qué
                herramientas corren en la Fase A y en qué se concentra el LLM. */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold block">
                CATEGORÍA DEL DIAGNÓSTICO
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DIAGNOSIS_CATEGORIES.map((cat) => {
                  const isSelected = selectedCategoryId === cat.id;
                  const lastRun = lastRunByCategory.get(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      className={`text-left p-3 rounded-md border transition-all space-y-1 ${
                        isSelected
                          ? "border-[var(--accent)] ring-1 ring-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/50 hover:bg-[var(--surface)]"
                      }`}
                      onClick={() => setSelectedCategoryId(isSelected ? null : cat.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-[11.5px] font-bold leading-tight ${isSelected ? "text-[var(--accent)]" : "text-[var(--text-primary)]"}`}>
                          {cat.label}
                        </p>
                        {isSelected && (
                          <span className="font-mono text-[9px] font-semibold px-1 py-0.5 rounded border shrink-0 text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent)]/30">
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] leading-snug">{cat.description}</p>
                      <p className="font-mono text-[9px] text-[var(--text-faint)] leading-snug">
                        {cat.tools.length > 0
                          ? `Herramientas: ${cat.tools.join(", ")}`
                          : "Sin herramientas — solo análisis del modelo"}
                      </p>
                      <p
                        className={`font-mono text-[9px] leading-snug ${lastRun ? "text-[var(--text-muted)]" : "text-[var(--text-faint)] italic"}`}
                        title={lastRun ? new Date(lastRun.ts).toLocaleString("es-AR") : undefined}
                      >
                        Último análisis:{" "}
                        {lastRun
                          ? `${relativeTimeLabel(lastRun.ts)} · ${lastRun.findings} hallazgo${lastRun.findings !== 1 ? "s" : ""}`
                          : "nunca"}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-[var(--border)]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                  HISTORIAL DE DIAGNÓSTICOS
                </span>
                <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
                  {diagHistory.length} diagnóstico(s)
                </span>
              </div>

              {diagHistory.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)] py-4 text-center">
                  Todavía no hay diagnósticos completados.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {diagHistory.map((rec) => {
                    const stats = makeDiagStats(rec.data.findings);
                    return (
                      <div
                        key={rec.id}
                        className="p-3 rounded-md border text-xs flex items-center justify-between gap-3 cursor-pointer transition-all border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/50 hover:bg-[var(--surface)]"
                        onClick={() => {
                          setViewingDiagId(rec.id);
                          setDiagJsonOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="font-mono text-[10.5px] text-[var(--text-muted)] shrink-0">{rec.timestamp}</span>
                          <span
                            className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 max-w-[150px] truncate text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent)]/25"
                            title={categoryLabel(rec.category)}
                          >
                            {categoryLabel(rec.category)}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--text-muted)] truncate">{rec.repo}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {stats.critical > 0 && (
                            <span className="text-[9.5px] font-semibold text-red-400 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded font-mono">
                              {stats.critical} crítico{stats.critical > 1 ? "s" : ""}
                            </span>
                          )}
                          <span className="text-[9.5px] font-mono text-[var(--text-muted)]">{stats.total} hallazgos</span>
                          <button
                            type="button"
                            className="btn btn-ghost text-[11px] py-0.5 px-2 border border-[var(--border)]"
                            onClick={(e) => {
                              e.stopPropagation();
                              openGithubIssues(rec.id);
                            }}
                          >
                            GitHub Issues →
                          </button>
                          <button
                            type="button"
                            className="icon-btn w-5 h-5 p-0 rounded text-[var(--red)] hover:bg-[var(--red-soft)]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingDiag({ id: rec.id, filename: rec.filename });
                            }}
                            title="Eliminar diagnóstico"
                            aria-label={`Eliminar diagnóstico ${rec.filename}`}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Overlay: confirmar eliminación de un diagnóstico */}
      {deletingDiag && (
        <div className="fixed inset-0 z-[400] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
            <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar este diagnóstico?</h3>
            <p className="text-[11px] text-[var(--text-muted)] break-all">{deletingDiag.filename}</p>
            <p className="text-[11px] text-[var(--text-muted)]">El JSON se borrará del disco.</p>
            <div className="flex justify-end gap-2 pt-0.5">
              <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingDiag(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                onClick={() => {
                  const active = resolveActiveWorktree();
                  if (active) {
                    void useDiagnosisStore.getState().removeRecord(deletingDiag.id, active.path);
                  }
                  if (viewingDiagId === deletingDiag.id) setViewingDiagId(null);
                  setDeletingDiag(null);
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
