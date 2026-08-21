import { useEffect, useState } from "react";
import { useRepoContextStore } from "../stores/repoContextStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { JsonCodeBlock } from "./JsonCodeBlock";
import { EffectiveModelChip } from "./ai/EffectiveModelChip";

// Modal de contexto del repositorio — REDISEÑO (Figma: "Replicate Modal
// Dialog Design"). Mismo store y motor que antes (fases idle/interview/
// synthesizing/done/error, vista lista/detalle), nueva piel:
//   - shell 38rem, radius 10px, scrim con blur, botones min-h 40px;
//   - header sin "Salir": la salida vive en "Guardar y salir" (con overlay
//     de confirmación si hay respuesta sin enviar);
//   - lista: click en fila ACTIVA el contexto; "Ver detalle" abre el detalle;
//   - eliminar contexto sintetizado (nuevo, IPC interview:briefDelete);
//   - error: "Reintentar" re-ejecuta la última operación fallida.
//
// Fases:
//   - idle:     lista/detalle de contextos + entrevistas en progreso;
//   - interview: pregunta actual del template + texto libre (Enter envía,
//               Shift+Enter nueva línea, Ctrl/Cmd+Enter también);
//   - synthesizing: la síntesis del documento (una llamada al modelo);
//   - done:     documento sintetizado → "Usar activo" (activo);
//   - error:    mensaje del motor + reintentar.

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

// ─── Iconos (mismos SVG que el diseño) ──────────────────────────────────

const CloseXIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ChevronRight = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
);

const ChevronLeft = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const AlertIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="8" x2="12" y2="12"></line>
    <line x1="12" y1="16" x2="12.01" y2="16"></line>
  </svg>
);

const DocumentPlusIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="12" y1="18" x2="12" y2="12"></line>
    <line x1="9" y1="15" x2="15" y2="15"></line>
  </svg>
);

export function RepoContextModal({ isInline = false }: { isInline?: boolean }) {
  const {
    open,
    loading,
    briefStatus,
    view,
    selectedPath,
    briefPhase,
    position,
    briefAnswer,
    briefBusy,
    briefDone,
    briefError,
    canGoBackBrief,
    closeModal,
    goToList,
    goToDetail,
    selectBrief,
    activateBrief,
    deleteBrief,
    deleteInProgress,
    startBriefInterview,
    resumeBrief,
    setBriefAnswer,
    submitBriefAnswer,
    goBackBrief,
    exitBrief,
    useDoneAsContext,
    retryBrief,
  } = useRepoContextStore();
  // En línea (dentro del modal unificado) el scroll-lock y el Escape los
  // maneja el contenedor; acá solo se usa el modo modal de ventana.
  useBodyScrollLock(!isInline && open);

const [copied, setCopied] = useState(false);
const [showConfirmExit, setShowConfirmExit] = useState(false);
const [deletingBriefPath, setDeletingBriefPath] = useState<string | null>(null);
const [search, setSearch] = useState("");
const [jsonExpanded, setJsonExpanded] = useState(false);

  const stepNumber = position?.preguntaNumero ?? 0;

  // El textarea gana el foco al entrar a una pregunta nueva (diseño: Fitts).
  useEffect(() => {
    if (briefPhase === "interview" && !briefBusy) {
      const ta = document.getElementById("tc-brief-answer") as HTMLTextAreaElement | null;
      ta?.focus();
    }
  }, [briefPhase, stepNumber, briefBusy]);

  // Escape: cierra el confirm abierto, o pregunta al salir con respuesta
  // sin enviar, o cierra el modal. (Solo en modo ventana.)
  useEffect(() => {
    if (isInline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open) return;
      if (showConfirmExit) setShowConfirmExit(false);
      else if (briefPhase === "interview" && briefAnswer.trim()) setShowConfirmExit(true);
      else closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isInline, open, briefPhase, briefAnswer, showConfirmExit, closeModal]);

  if (!isInline && !open) return null;

  const briefs = briefStatus?.briefs ?? [];
  const selected = briefs.find((b) => b.path === selectedPath) ?? null;
  const inProgress = briefStatus?.inProgress ?? [];
  const isInterview = briefPhase === "interview" || briefPhase === "synthesizing";

  const filteredBriefs = briefs.filter(
    (b) =>
      b.brief.resumen_proyecto.toLowerCase().includes(search.toLowerCase()) ||
      formatTimestamp(b.timestamp).toLowerCase().includes(search.toLowerCase()),
  );

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      useNotificationStore.getState().notify("error", "Could not copy to clipboard.");
    }
  };

  const requestExit = () => {
    if (briefAnswer.trim()) setShowConfirmExit(true);
    else void exitBrief();
  };

  // ── Fase interview ─────────────────────────────────────────────────────
  const renderInterview = () => {
    if (!position) return null;
    const canSubmit = !briefBusy && briefAnswer.trim().length > 0;
    const pct = Math.round((position.respondidas / position.preguntaTotal) * 100);

    return (
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--accent)]">
            Bloque {position.bloqueNumero}/{position.bloqueTotal} · {position.bloque.titulo}
          </span>
          <span className="flex items-center gap-3">
            <EffectiveModelChip phaseId="brief" />
            <span>
              Pregunta {position.preguntaNumero} de {position.preguntaTotal} ({pct}%)
            </span>
          </span>
        </div>

        <div className="progress-line-track">
          <div className="progress-line-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs leading-relaxed text-[var(--text-primary)]">
          {position.pregunta}
        </div>

        <div className="space-y-0.5">
          <textarea
            id="tc-brief-answer"
            className="textarea-minimal text-xs py-1.5"
            rows={3}
            placeholder="Escribí tu respuesta aquí…"
            value={briefAnswer}
            onChange={(e) => setBriefAnswer(e.target.value)}
            disabled={briefBusy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) void submitBriefAnswer();
              }
            }}
          />
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
            <span>{briefAnswer.length} caracteres</span>
            <span>
              Atajo:{" "}
              <kbd className="px-1 py-0.5 rounded bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-secondary)]">
                Ctrl + Enter
              </kbd>
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-0.5">
          <button type="button" className="btn btn-danger-ghost text-[11px]" onClick={requestExit}>
            Guardar y salir
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-ghost text-xs min-h-[38px] px-3.5"
              onClick={goBackBrief}
              disabled={briefBusy || !canGoBackBrief}
            >
              ← Anterior
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs min-h-[38px] px-3.5 font-semibold"
              onClick={() => void submitBriefAnswer()}
              disabled={!canSubmit}
            >
              {briefBusy ? "Guardando…" : "Siguiente →"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Fase synthesizing ──────────────────────────────────────────────────
  const renderSynthesizing = () => (
    <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      <p className="text-xs text-[var(--text-primary)] font-medium">Sintetizando el contexto del proyecto…</p>
      <p className="text-[11px] text-[var(--text-muted)] max-w-xs">Analizando visión, usuarios y restricciones…</p>
      <EffectiveModelChip phaseId="brief" />
    </div>
  );

  // ── Fase error ─────────────────────────────────────────────────────────
  const renderError = () => (
    <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
      <div className="text-[var(--red)]">
        <AlertIcon />
      </div>
      <p className="text-xs text-[var(--text-secondary)] max-w-xs">{briefError || "Ocurrió un error."}</p>
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn btn-primary text-xs min-h-[38px] px-3.5 font-semibold" onClick={() => void retryBrief()}>
          Reintentar
        </button>
        <button type="button" className="btn btn-ghost text-xs min-h-[38px] px-3.5" onClick={() => void exitBrief()}>
          Volver
        </button>
      </div>
    </div>
  );

  // ── Fase done ──────────────────────────────────────────────────────────
  const renderDone = () => {
    if (!briefDone) return null;
    const b = briefDone.brief;

    return (
      <div className="space-y-3 text-center py-1">
        <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
          <CheckIcon />
        </div>

        <div className="space-y-0.5">
          <h3 className="text-xs font-semibold text-[var(--text-primary)]">Síntesis Finalizada</h3>
          <button
            type="button"
            className="text-[10.5px] text-[var(--accent)] font-mono underline hover:opacity-80 border-none bg-transparent cursor-pointer"
            onClick={() => void handleCopy(JSON.stringify(b, null, 2))}
          >
            {copied ? "¡JSON copiado!" : "Copiar JSON"}
          </button>
        </div>

        <div className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-left text-xs space-y-1">
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block">Resumen del Proyecto</span>
          <p className="text-[11.5px] text-[var(--text-primary)] leading-relaxed">{b.resumen_proyecto}</p>
          {b.propuesta_de_valor && (
            <div className="pt-1 border-t border-[var(--border)] mt-1">
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block">Propuesta de Valor</span>
              <p className="text-[11px] text-[var(--text-secondary)]">{b.propuesta_de_valor}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 pt-2">
          <button type="button" className="btn btn-ghost text-xs min-h-[38px] w-36 font-medium" onClick={() => void exitBrief()}>
            Volver al menú
          </button>
          <button type="button" className="btn btn-primary text-xs min-h-[38px] w-36 font-semibold" onClick={() => void useDoneAsContext()}>
            Usar activo
          </button>
        </div>
      </div>
    );
  };

  // ── Sin briefs ─────────────────────────────────────────────────────────
  const renderNoBrief = () => (
    <div className="py-8 px-4 flex flex-col items-center justify-center text-center space-y-4">
      <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center border border-[var(--border)]">
        <DocumentPlusIcon />
      </div>

      <div className="space-y-1 max-w-sm">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">Sin contexto de repositorio cargado</h3>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          El contexto de repositorio releva la misión, el problema principal, los usuarios objetivo y las
          restricciones del proyecto mediante una entrevista guiada.
        </p>
      </div>

      <button type="button" className="btn btn-primary min-h-[38px] px-4 text-xs font-semibold" onClick={() => void startBriefInterview()}>
        + Comenzar Entrevista de Contexto
      </button>

      {inProgress.length > 0 && (
        <div className="w-full pt-4 border-t border-[var(--border)] text-left space-y-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
            Borradores en curso ({inProgress.length})
          </span>
          {inProgress.map((item) => (
            <div key={item.ledgerPath} className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between text-xs min-h-[38px]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] text-[var(--text-muted)]">{formatTimestamp(item.timestamp)}</span>
                <span className="text-[10.5px] text-[var(--text-secondary)]">
                  {item.answers_count}/{item.total_questions} respondidas
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  className="text-[10.5px] text-[var(--accent)] font-semibold flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
                  onClick={() => void resumeBrief(item.ledgerPath)}
                >
                  Continuar <ChevronRight />
                </button>
                <button
                  type="button"
                  className="icon-btn text-[var(--red)] w-5 h-5 p-0 hover:bg-[var(--red-soft)] rounded"
                  onClick={() => void deleteInProgress(item.ledgerPath)}
                  title="Eliminar borrador"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Vista lista ────────────────────────────────────────────────────────
  const renderList = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-[var(--text-muted)] font-mono">{briefs.length} contexto(s) guardado(s)</span>
        <button type="button" className="btn btn-primary min-h-[38px] px-3.5 text-xs font-semibold" onClick={() => void startBriefInterview()}>
          + Nueva Entrevista
        </button>
      </div>

      {briefs.length > 3 && (
        <input
          type="text"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="textarea-minimal text-xs py-1.5 min-h-[36px]"
        />
      )}

      <div className="space-y-2">
        {filteredBriefs.slice().reverse().map((item) => {
          const isActive = item.path === (briefStatus?.activePath ?? null);
          return (
            <div
              key={item.path}
              className={`p-3.5 sm:p-4 rounded-lg border min-h-[44px] transition-all cursor-pointer flex items-center justify-between gap-3 text-xs sm:text-sm ${
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-hover)] hover:bg-[var(--surface)]"
              }`}
              onClick={() => void activateBrief(item.path)}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">{formatTimestamp(item.timestamp)}</span>
                {isActive ? (
                  <span className="text-[9.5px] font-semibold bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.5 rounded-full shrink-0">
                    Activo
                  </span>
                ) : (
                  <span className="text-[9.5px] text-[var(--text-muted)] shrink-0">Clic para activar</span>
                )}
                <p className="text-xs sm:text-sm text-[var(--text-primary)] font-medium truncate">{item.brief.resumen_proyecto}</p>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  className="text-[10.5px] text-[var(--accent)] font-semibold flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToDetail(item.path);
                  }}
                >
                  Ver detalle <ChevronRight />
                </button>
                <button
                  type="button"
                  disabled={isActive}
                  className={`icon-btn w-5 h-5 p-0 rounded ${
                    isActive
                      ? "opacity-20 cursor-not-allowed text-[var(--text-muted)]"
                      : "text-[var(--red)] hover:bg-[var(--red-soft)]"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isActive) setDeletingBriefPath(item.path);
                  }}
                  title={isActive ? "No se puede eliminar el contexto activo" : "Eliminar"}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {inProgress.length > 0 && (
        <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
            Entrevistas en proceso ({inProgress.length})
          </span>
          <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-0.5">
            {inProgress.map((item) => (
              <div key={item.ledgerPath} className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between gap-2 text-xs min-h-[38px]">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="font-mono text-[10.5px] text-[var(--text-muted)] shrink-0">{formatTimestamp(item.timestamp)}</span>
                  <span className="text-[10.5px] text-[var(--text-secondary)] truncate">
                    {item.answers_count}/{item.total_questions} respondidas
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="text-[10.5px] text-[var(--accent)] font-semibold flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
                    onClick={() => void resumeBrief(item.ledgerPath)}
                  >
                    Continuar <ChevronRight />
                  </button>
                  <button
                    type="button"
                    className="icon-btn text-[var(--red)] w-5 h-5 p-0 hover:bg-[var(--red-soft)] rounded"
                    onClick={() => void deleteInProgress(item.ledgerPath)}
                    title="Eliminar borrador"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ── Vista detalle ──────────────────────────────────────────────────────
  const renderDetail = () => {
    if (!selected) return null;
    const isActive = selected.path === (briefStatus?.activePath ?? null);
    const jsonFileName = selected.path.split(/[\\/]/).pop() || "brief.json";

    return (
      <div className="space-y-3.5">
        <button
          type="button"
          className="btn btn-ghost text-xs py-1 min-h-[32px] self-start flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
          onClick={() => {
            setJsonExpanded(false);
            goToList();
          }}
        >
          <ChevronLeft /> Volver a la lista
        </button>

        <div className="space-y-2.5 p-3.5 sm:p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs sm:text-sm">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
            <span className="font-mono text-[11px] text-[var(--text-muted)]">{formatTimestamp(selected.timestamp)}</span>
            <div className="flex items-center gap-2">
              {isActive && <span className="text-[9.5px] font-semibold bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.5 rounded-full">Activo</span>}
              <button
                type="button"
                disabled={isActive}
                className={`btn text-[11px] py-0.5 px-2 ${
                  isActive ? "btn-ghost opacity-30 cursor-not-allowed" : "btn-danger-ghost"
                }`}
                onClick={() => {
                  if (!isActive) setDeletingBriefPath(selected.path);
                }}
              >
                Eliminar
              </button>
            </div>
          </div>

          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block font-semibold">Resumen</span>
            <p className="text-xs sm:text-sm text-[var(--text-primary)] leading-relaxed mt-0.5 font-medium">{selected.brief.resumen_proyecto}</p>
          </div>

          {selected.brief.propuesta_de_valor && (
            <div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block font-semibold">Propuesta de Valor</span>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">{selected.brief.propuesta_de_valor}</p>
            </div>
          )}
        </div>

        {/* Collapsible JSON Viewer (coloreado, arranca cerrado) */}
        <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--bg)] shadow-xs">
          <button
            type="button"
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
            onClick={() => setJsonExpanded(!jsonExpanded)}
            aria-expanded={jsonExpanded}
          >
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-[var(--accent)] text-[10px]">{jsonExpanded ? "▼" : "▶"}</span>
              <span>Ver JSON completo ({jsonFileName})</span>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              {jsonExpanded ? "Ocultar" : "Desplegar"}
            </span>
          </button>

          {jsonExpanded && (
            <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                  Estructura del Brief (Código JSON)
                </span>
                <button
                  type="button"
                  className="btn btn-ghost text-[10.5px] py-1 px-2.5 border border-[var(--border)] font-mono hover:bg-[var(--surface-hover)]"
                  onClick={() => void handleCopy(JSON.stringify(selected.brief, null, 2))}
                >
                  {copied ? "¡Copiado!" : "Copiar JSON"}
                </button>
              </div>
              <JsonCodeBlock data={selected.brief} maxHeight="320px" />
            </div>
          )}
        </div>

        <div className="flex justify-end items-center pt-1">
          <button
            type="button"
            className="btn btn-primary text-xs min-h-[40px] px-4 font-semibold shadow-xs"
            onClick={() => void selectBrief(selected.path)}
            disabled={isActive}
          >
            {isActive ? "Contexto Activo" : "Marcar como Activo"}
          </button>
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
          <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
          <p className="text-xs text-[var(--text-muted)]">Cargando contexto…</p>
        </div>
      );
    }
    if (briefPhase === "interview") return renderInterview();
    if (briefPhase === "synthesizing") return renderSynthesizing();
    if (briefPhase === "done") return renderDone();
    if (briefPhase === "error") return renderError();

    if (!briefs.length) return renderNoBrief();
    return view === "list" ? renderList() : renderDetail();
  };

  const overlays = (
    <>
      {/* Overlay: confirmar salida (el progreso queda en disco) */}
      {showConfirmExit && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">¿Guardar y salir?</h3>
            <p className="text-[11px] text-[var(--text-muted)]">Tu progreso actual se guardará en el borrador.</p>
            <div className="flex justify-end gap-2 pt-0.5">
              <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setShowConfirmExit(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs py-1 min-h-[32px]"
                onClick={() => {
                  setShowConfirmExit(false);
                  void exitBrief();
                }}
              >
                Guardar y salir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay: confirmar eliminación de un contexto sintetizado */}
      {deletingBriefPath && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
            <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar este contexto?</h3>
            <p className="text-[11px] text-[var(--text-muted)]">El contexto se eliminará permanentemente.</p>
            <div className="flex justify-end gap-2 pt-0.5">
              <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingBriefPath(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                onClick={() => {
                  void deleteBrief(deletingBriefPath);
                  setDeletingBriefPath(null);
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

  // Modo EN LÍNEA (dentro del modal unificado de arquitectura): solo el
  // contenido, sin scrim ni shell ni header — el contenedor provee todo.
  if (isInline) {
    return (
      <div className="relative w-full">
        {renderBody()}
        {overlays}
      </div>
    );
  }

  return (
    <div
      className="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (briefPhase === "interview" && briefAnswer.trim()) setShowConfirmExit(true);
          else closeModal();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Contexto del repositorio"
    >
      <div className="modal-shell tc-enter relative">
        <div className="modal-header">
          <h2 className="text-xs font-semibold tracking-tight text-[var(--text-primary)]">
            {isInterview ? "Entrevista de Contexto" : "Contexto del Repositorio"}
          </h2>
          <button type="button" className="icon-btn" onClick={closeModal} aria-label="Cerrar">
            <CloseXIcon />
          </button>
        </div>

        <div className="modal-body">{renderBody()}</div>

        {overlays}
      </div>
    </div>
  );
}
