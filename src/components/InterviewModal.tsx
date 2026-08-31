import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useInterviewStore, pendingContradictionFor } from "../stores/interviewStore";
import { useRepoContextStore } from "../stores/repoContextStore";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { JsonCodeBlock } from "./JsonCodeBlock";
import { useNotificationStore } from "../stores/notificationStore";
import { PhaseActivityFeed } from "./ai/PhaseActivityFeed";
import { EffectiveModelChip } from "./ai/EffectiveModelChip";
import type { PhaseId } from "../../shared/phaseModels";
import type { InterviewQuestion } from "../../headless-runtime/interview/index.ts";

// Modal de entrevista de requerimientos — REDISEÑO (Figma: "Replicate
// Modal Dialog Design"). Mismo store/motor, nueva piel:
//   - shell 38rem, radius 10px, scrim con blur, botones min-h 40px;
//   - fases nuevas de carga a pantalla completa: "generating_questions"
//     (crear entrevista) y "loading_next" (enviar respuesta);
//   - historial de entrevistas compacto con píldoras Completada / %;
//   - eliminación con overlay propio (sin window.confirm);
//   - Escape / scrim cierran con confirmación si hay respuesta sin enviar.

const TOPIC_LABELS: Record<string, string> = {
  problema: "Problema",
  usuarios: "Usuarios",
  flujo_principal: "Flujo principal",
  criterio_exito: "Criterio de éxito",
  rendimiento: "Rendimiento",
  __contradiction__: "Resolución de contradicción",
};

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

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const AlertIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="8" x2="12" y2="12"></line>
    <line x1="12" y1="16" x2="12.01" y2="16"></line>
  </svg>
);

const DocumentTextIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
  </svg>
);

// ─── Markdown inline (mismo render que el diseño) ───────────────────────

function renderQuestionText(text: string): ReactNode {
  const lineas = text.split("\n");
  return lineas.map((linea, idx) => {
    const tokens = linea.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    const parsed = tokens.map((tok, i) => {
      if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
        return (
          <strong key={i} className="font-semibold text-[var(--text-primary)]">
            {tok.slice(2, -2)}
          </strong>
        );
      }
      if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
        return (
          <code key={i} className="px-1.5 py-0.5 rounded bg-[var(--bg)] font-mono text-[11.5px] border border-[var(--border)]">
            {tok.slice(1, -1)}
          </code>
        );
      }
      if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
        return (
          <em key={i} className="italic text-[var(--text-primary)]">
            {tok.slice(1, -1)}
          </em>
        );
      }
      return tok;
    });

    return (
      <Fragment key={idx}>
        {idx > 0 && <br />}
        {parsed}
      </Fragment>
    );
  });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function InterviewModal({
  isInline = false,
  onClose,
  onViewResults,
  onOpenContextModal,
}: {
  isInline?: boolean;
  // En modo en línea (modal unificado), cerrar, saltar a los resultados y
  // abrir el contexto del repositorio son decisiones del contenedor; sin
  // props, caen al store.
  onClose?: () => void;
  onViewResults?: () => void;
  onOpenContextModal?: () => void;
}) {
  const {
    phase,
    busy,
    summaries,
    briefStatus,
    repoPath,
    question,
    ledger,
    doneReason,
    errorMessage,
    activeInterviewPath,
    closeModal,
    createNew,
    resume,
    removeInterview,
    backToPick,
    activateInterview,
  } = useInterviewStore();

  // En línea (dentro del modal unificado) el scroll-lock y el Escape los
  // maneja el contenedor; acá solo se usa el modo modal de ventana.
  useBodyScrollLock(!isInline);

const [showConfirmExit, setShowConfirmExit] = useState(false);
const [deletingPath, setDeletingPath] = useState<string | null>(null);
const [jsonExpanded, setJsonExpanded] = useState(false);
const [copiedJson, setCopiedJson] = useState(false);

const handleCopy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  } catch {
    useNotificationStore.getState().notify("error", "Could not copy to clipboard.");
  }
};
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const topic = useInterviewStore((s) => s.topic);
  const selectedOptionId = useInterviewStore((s) => s.selectedOptionId);
  const freeText = useInterviewStore((s) => s.freeText);
  const canGoBack = useInterviewStore((s) => s.canGoBack);
  const progress = useInterviewStore((s) => s.progress);
  const setFreeText = useInterviewStore((s) => s.setFreeText);
  const selectOption = useInterviewStore((s) => s.selectOption);
  const goBack = useInterviewStore((s) => s.goBack);
  const submitAnswer = useInterviewStore((s) => s.submitAnswer);

  const contradiction = pendingContradictionFor(ledger, topic);

  // El textarea gana el foco al entrar a una pregunta nueva.
  useEffect(() => {
    if (phase === "interview" && textareaRef.current && !busy) {
      textareaRef.current.focus();
    }
  }, [phase, question, busy]);

  // Escape: cierra el confirm, o pregunta al salir con respuesta sin
  // enviar, o cierra el modal. (Solo en modo ventana.)
  useEffect(() => {
    if (isInline) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showConfirmExit) setShowConfirmExit(false);
      else if (phase === "interview" && (freeText.trim() || selectedOptionId)) setShowConfirmExit(true);
      else closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isInline, phase, freeText, selectedOptionId, showConfirmExit, closeModal]);

  // Ir a la entrevista de contexto (Fase 0): en línea solo cambia la
  // sección del contenedor; en modo ventana cierra este modal y abre el
  // del contexto — al cerrarlo, vuelve acá.
  const goToContext = () => {
    if (onOpenContextModal) {
      onOpenContextModal();
      return;
    }
    if (!repoPath) return;
    closeModal();
    void useRepoContextStore.getState().openModal(repoPath, { fromInterview: true });
  };

  const requestExit = () => {
    if (freeText.trim() || selectedOptionId) setShowConfirmExit(true);
    else backToPick();
  };

  const currentQ = question;

  const enProgreso = summaries.filter((s) => s.answers_count > 0 && s.topics_closed < s.topics_total);
  const completadas = summaries.filter((s) => s.topics_total > 0 && s.topics_closed >= s.topics_total);

  const contexto =
    briefStatus && briefStatus.briefs.length > 0
      ? briefStatus.briefs.find((b) => b.path === briefStatus.activePath) ??
        briefStatus.briefs[briefStatus.briefs.length - 1]
      : null;
  const contextoActivo = contexto !== null && briefStatus?.activePath === contexto.path;
  const showBrief = contexto !== null;

  // ── Fase pick ──────────────────────────────────────────────────────────
  const renderPickPhase = () => (
    <div className="space-y-4">
      {/* Sin brief: la entrevista funciona pero sin contexto de negocio. */}
      {!showBrief ? (
        <div className="p-2.5 rounded-md bg-[var(--amber-soft)] border border-amber-500/30 text-xs space-y-1">
          <p className="text-[var(--text-primary)] leading-tight">
            <strong className="text-[var(--amber)] font-semibold">Sin contexto de repositorio.</strong>{" "}
            El modelo responderá sin contexto previo.
          </p>
          <button type="button" className="btn btn-primary text-[11px] py-0.5 px-2 min-h-[28px]" onClick={goToContext}>
            Hacer entrevista de contexto primero
          </button>
        </div>
      ) : (
        contexto && (
          <div className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs flex items-center justify-between gap-2 min-h-[38px]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider shrink-0">Contexto activo</span>
              {contextoActivo && (
                <span className="text-[9.5px] font-semibold bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.5 rounded-full shrink-0">
                  Activo
                </span>
              )}
              <p className="text-[11px] text-[var(--text-primary)] truncate">{contexto.brief.resumen_proyecto}</p>
            </div>
            <button
              type="button"
              className="text-[10.5px] text-[var(--accent)] font-medium flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer shrink-0"
              onClick={goToContext}
            >
              Cambiar <ChevronRight />
            </button>
          </div>
        )
      )}

      {/* ── Completadas (selección de la activa) ─────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-[var(--text-muted)] font-mono">
            {completadas.length} entrevista(s) completada(s)
          </span>
          <button
            type="button"
            className="btn btn-primary min-h-[38px] px-3.5 text-xs font-semibold"
            onClick={() => void createNew()}
          >
            + Nueva Entrevista
          </button>
        </div>

        {completadas.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-9 h-9 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center border border-[var(--border)]">
              <DocumentTextIcon />
            </div>
            <div className="space-y-1 max-w-xs">
              <p className="text-xs font-semibold text-[var(--text-primary)]">Sin entrevistas completadas</p>
              <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                Completá una entrevista de requerimientos para poder seleccionar una como activa.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {completadas.map((s) => {
              const isActive = s.ledgerPath === activeInterviewPath;
              const summary = `${s.answers_count} respuestas · ${s.topics_closed}/${s.topics_total} tópicos`;
              return (
                <div
                  key={s.ledgerPath}
                  className={`p-3.5 rounded-lg border min-h-[44px] transition-all cursor-pointer flex items-center justify-between gap-3 text-xs ${
                    isActive
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-hover)] hover:bg-[var(--surface)]"
                  }`}
                  onClick={() => activateInterview(s.ledgerPath)}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">{formatTimestamp(s.created_at)}</span>
                    {isActive ? (
                      <span className="text-[9.5px] font-semibold bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.5 rounded-full shrink-0">
                        Activa
                      </span>
                    ) : (
                      <span className="text-[9.5px] text-[var(--text-muted)] shrink-0">Clic para activar</span>
                    )}
                    <p className="text-xs text-[var(--text-primary)] font-medium truncate">{summary}</p>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      className="text-xs text-[var(--accent)] font-semibold flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        void resume(s.ledgerPath);
                      }}
                    >
                      Ver resultado <ChevronRight />
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
                        if (!isActive) setDeletingPath(s.ledgerPath);
                      }}
                      title={isActive ? "No se puede eliminar la entrevista activa" : "Eliminar"}
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

      {/* ── Borradores en progreso ────────────────────────────────────── */}
      {enProgreso.length > 0 && (
        <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
            Entrevistas en proceso ({enProgreso.length})
          </span>
          <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-0.5">
            {enProgreso.map((s) => {
              const pct = s.topics_total > 0 ? Math.round((s.topics_closed / s.topics_total) * 100) : 0;
              return (
                <div
                  key={s.ledgerPath}
                  className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between gap-2 text-xs min-h-[38px]"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="font-mono text-[10.5px] text-[var(--text-muted)] shrink-0">{formatTimestamp(s.created_at)}</span>
                    <span className="text-[9px] font-semibold bg-[var(--amber-soft)] text-[var(--amber)] px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                      {pct}%
                    </span>
                    <span className="text-[10.5px] text-[var(--text-secondary)] truncate">
                      {s.answers_count} resp. · {s.topics_closed}/{s.topics_total} tópicos
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="text-[10.5px] text-[var(--accent)] font-semibold flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
                      onClick={() => void resume(s.ledgerPath)}
                    >
                      Continuar <ChevronRight />
                    </button>
                    <button
                      type="button"
                      className="icon-btn text-[var(--red)] w-5 h-5 p-0 hover:bg-[var(--red-soft)] rounded"
                      onClick={() => setDeletingPath(s.ledgerPath)}
                      title="Eliminar borrador"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ── Pantallas de carga a pantalla completa ────────────────────────────
  const renderLoadingScreen = (
    title: string,
    subtitle: string,
    chipPhase?: PhaseId,
    onCancel?: () => void,
  ) => (
    <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      <p className="text-xs text-[var(--text-primary)] font-medium">{title}</p>
      <p className="text-[11px] text-[var(--text-muted)] max-w-xs">{subtitle}</p>
      {chipPhase && <EffectiveModelChip phaseId={chipPhase} />}
      {onCancel && (
        <button
          type="button"
          className="btn btn-ghost text-xs py-1.5 px-4 border border-[var(--border)] hover:border-[var(--red)] hover:text-[var(--red)]"
          onClick={onCancel}
        >
          Cancelar
        </button>
      )}
    </div>
  );

  // ── Fase interview ─────────────────────────────────────────────────────
  const renderInterviewPhase = () => {
    if (!currentQ) return null;
    const labelTopic = topic ? (TOPIC_LABELS[topic] ?? topic) : "—";
    const answered = progress?.answered ?? 0;
    const canSubmit = !busy && (selectedOptionId !== null || freeText.trim().length > 0);

    return (
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--accent)]">Tópico: {labelTopic}</span>
          <span className="flex items-center gap-3">
            <EffectiveModelChip phaseId="requirements" />
            <span>{answered} respondida(s)</span>
          </span>
        </div>

        <div className="space-y-2.5">
          {contradiction && (
            <div className="p-2 rounded-md bg-[var(--amber-soft)] border border-amber-500/30 text-[11px] flex items-start gap-1.5">
              <AlertIcon />
              <p className="text-[var(--text-primary)] leading-snug">
                <strong className="text-[var(--amber)] font-semibold">Contradicción:</strong> {contradiction.explanation}
              </p>
            </div>
          )}

          <div className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs leading-relaxed text-[var(--text-primary)] space-y-0.5">
            {renderQuestionText(currentQ.question_text)}
          </div>

          {currentQ.options.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider block">Opciones:</span>
              <div className="space-y-1">
                {currentQ.options.map((opt) => {
                  const isSelected = selectedOptionId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md border transition-all cursor-pointer ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--text-primary)]"
                          : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                      }`}
                      onClick={() => selectOption(opt.id)}
                      disabled={busy}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-0.5">
            <textarea
              ref={textareaRef}
              className="textarea-minimal text-xs py-1.5"
              rows={3}
              placeholder={
                selectedOptionId
                  ? "Opción seleccionada. Si querés explayarte, podés escribir acá…"
                  : "Escribí tu respuesta aquí…"
              }
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSubmit) void submitAnswer();
                }
              }}
            />
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
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
                onClick={goBack}
                disabled={busy || !canGoBack}
              >
                ← Anterior
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs min-h-[38px] px-3.5 font-semibold"
                onClick={() => void submitAnswer()}
                disabled={!canSubmit}
              >
                Enviar respuesta →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Fase done ──────────────────────────────────────────────────────────
  const renderDone = () => {
    const synthesis = ledger?.synthesis?.data ?? null;

    return (
      <div className="space-y-4 text-center py-2 max-w-lg mx-auto">
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
          <CheckIcon />
        </div>

        <div className="space-y-1">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Entrevista Finalizada con Éxito</h3>
          <p className="text-xs font-mono text-[var(--text-muted)]">Motivo: {doneReason || "all_topics_closed"}</p>
        </div>

        {synthesis && (
          <div className="p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-left text-xs sm:text-sm space-y-2 shadow-xs">
            <span className="text-[10.5px] font-mono text-[var(--text-muted)] uppercase block font-semibold">Resumen de la Síntesis Generada</span>
            <p className="font-bold text-[var(--text-primary)] text-xs sm:text-sm">{synthesis.proyecto_metadata?.nombre_proyecto ?? "—"}</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] pt-1 border-t border-[var(--border)]">
              <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {synthesis.historias_de_usuario.length} Historias de Usuario</div>
              <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {synthesis.requerimientos_funcionales.length} Requerimientos Funcionales</div>
              <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {synthesis.atributos_de_calidad_y_asrs.length} Atributos de Calidad (ASR)</div>
              <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {synthesis.restricciones_globales.length} Restricciones Globales</div>
              <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {Object.keys(synthesis.glosario_de_terminos ?? {}).length} Términos del Glosario</div>
            </div>
          </div>
        )}

        {/* Collapsible JSON Viewer de la síntesis (coloreado, arranca cerrado) */}
        {synthesis && (
          <div className="border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--bg)] shadow-xs text-left">
            <button
              type="button"
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
              onClick={() => setJsonExpanded(!jsonExpanded)}
              aria-expanded={jsonExpanded}
            >
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-[var(--accent)] text-[10px]">{jsonExpanded ? "▼" : "▶"}</span>
                <span>Ver JSON completo de síntesis</span>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {jsonExpanded ? "Ocultar" : "Desplegar"}
              </span>
            </button>

            {jsonExpanded && (
              <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                    Estructura de la Síntesis (Código JSON)
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost text-[10.5px] py-1 px-2.5 border border-[var(--border)] font-mono hover:bg-[var(--surface-hover)]"
                    onClick={() => void handleCopy(JSON.stringify(synthesis, null, 2))}
                  >
                    {copiedJson ? "¡Copiado!" : "Copiar JSON"}
                  </button>
                </div>
                <JsonCodeBlock data={synthesis} maxHeight="320px" />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
          <button type="button" className="btn btn-ghost text-xs min-h-[40px] px-4 font-medium" onClick={backToPick}>
            Volver a Entrevistas
          </button>
          {onViewResults ? (
            <button type="button" className="btn btn-primary text-xs min-h-[40px] px-4 font-semibold shadow-xs" onClick={onViewResults}>
              Ver Requerimientos Sintetizados →
            </button>
          ) : (
            <button type="button" className="btn btn-primary text-xs min-h-[40px] px-4 font-semibold shadow-xs" onClick={onClose ?? closeModal}>
              Cerrar Modal
            </button>
          )}
        </div>
      </div>
    );
  };

  // ── Fase error ─────────────────────────────────────────────────────────
  const renderError = () => (
    <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
      <div className="text-[var(--red)]">
        <AlertIcon />
      </div>
      <p className="text-xs text-[var(--text-secondary)] max-w-xs">{errorMessage || "Ocurrió un error."}</p>
      <button type="button" className="btn btn-ghost text-xs mt-1 min-h-[38px] px-3.5" onClick={backToPick}>
        Volver
      </button>
    </div>
  );

  const renderBody = () => {
    const phaseContent =
      phase === "pick" ? renderPickPhase()
      : phase === "generating_questions"
        ? renderLoadingScreen("Generando las preguntas…", "Preparando la sesión de entrevista y cargando el contexto…", "requirements", () => useInterviewStore.getState().cancelActiveOp())
        : phase === "loading_next"
          ? renderLoadingScreen("Cargando siguiente pregunta…", "Procesando tu respuesta y formulando la pregunta correspondiente…", "requirements", () => useInterviewStore.getState().cancelActiveOp())
          : phase === "interview" ? renderInterviewPhase()
          : phase === "synthesizing"
            ? renderLoadingScreen("Generando resultados…", "Sintetizando la planilla de requerimientos (RFs, ASRs, restricciones, glosario)…", "synthesis", () => useInterviewStore.getState().cancelActiveOp())
            : phase === "done" ? renderDone()
            : phase === "error" ? renderError()
            : null;
    return (
      <div className="space-y-3">
        {phaseContent}
        {/* Feed "IA actuando": oculto en pick (no hay llamadas al modelo ahí). */}
        {phase !== "pick" && phase !== "done" && <PhaseActivityFeed />}
      </div>
    );
  };

  const isGenerating = phase === "synthesizing" || phase === "generating_questions" || phase === "loading_next";

  const overlays = (
    <>
      {/* Overlay: confirmar salida (el progreso queda en el ledger) */}
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
                  backToPick();
                }}
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay: confirmar eliminación de una entrevista */}
      {deletingPath && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
            <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar esta entrevista?</h3>
            <p className="text-[11px] text-[var(--text-muted)]">El historial se borrará del disco.</p>
            <div className="flex justify-end gap-2 pt-0.5">
              <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingPath(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                onClick={() => {
                  void removeInterview(deletingPath);
                  setDeletingPath(null);
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
          if (phase === "interview" && (freeText.trim() || selectedOptionId)) setShowConfirmExit(true);
          else closeModal();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Entrevista de requerimientos"
    >
      <div className="modal-shell tc-enter relative">
        <div className="modal-header">
          <h2 className="text-xs font-semibold tracking-tight text-[var(--text-primary)]">
            {isGenerating ? "Generando Resultados" : "Entrevista de Requerimientos"}
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
