import React, { useState, useEffect, useRef } from "react";
import { safeCopyToClipboard } from "../utils/clipboard";

export interface Option {
  id: string;
  label: string;
}

export interface Contradiction {
  explanation: string;
}

export interface InterviewQuestion {
  topic: string;
  kind: "single_select" | "free_only" | string;
  question_text: string;
  options: Option[];
  contradiction: Contradiction | null;
}

export interface InterviewSummaryItem {
  ledgerPath: string;
  created_at: string;
  answers_count: number;
  topics_closed: number;
  topics_total: number;
  pending_contradictions: number;
}

export interface SummariesData {
  enProgreso: InterviewSummaryItem[];
  completadas: InterviewSummaryItem[];
  vacias: InterviewSummaryItem[];
}

export interface SynthesisResult {
  proyecto_metadata: {
    nombre_proyecto: string;
    id_sesion: string;
    fecha_relevamiento: string;
    brief_contexto: string;
  };
  requerimientos_funcionales: { id: string }[];
  atributos_de_calidad_y_asrs: { id: string }[];
  restricciones_globales: { id: string }[];
  glosario_de_terminos: Record<string, boolean>;
}

export interface BriefInfo {
  path: string;
  activePath: string;
  brief: {
    resumen_proyecto: string;
  };
}

export type InterviewPhase = "pick" | "generating_questions" | "interview" | "loading_next" | "synthesizing" | "done" | "error";

export interface InterviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInline?: boolean; // When rendered inside the 90% Core Architecture Modal panel
  onViewResults?: () => void; // Callback to switch to Post-Entrevistas view in Core Architecture Modal
  phase: InterviewPhase;
  busy: boolean;
  summaries: SummariesData;
  showBrief: boolean;
  briefInfo: BriefInfo | null;
  qIndex: number;
  questions: InterviewQuestion[];
  selectedOptionId: string | null;
  freeText: string;
  canGoBack: boolean;
  answered: number;
  doneReason: string | null;
  ledgerPath: string | null;
  errorMessage: string | null;
  synthesis: SynthesisResult;
  onStartNew: () => void;
  onResume: (path: string, completed: boolean) => void;
  onDeleteSummary: (path: string) => void;
  onSelectOption: (id: string) => void;
  onTextChange: (text: string) => void;
  onSubmitAnswer: () => void;
  onGoBack: () => void;
  onGoToPick: () => void;
  onOpenContextModal: () => void;
}

const TOPIC_LABELS: Record<string, string> = {
  problema: "Problema",
  usuarios: "Usuarios",
  flujo_principal: "Flujo principal",
  criterio_exito: "Criterio de éxito",
  rendimiento: "Rendimiento",
  __contradiction__: "Resolución de contradicción",
};

// Icons
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

function renderQuestionText(text: string) {
  const lineas = text.split("\n");
  return lineas.map((linea, idx) => {
    const tokens = linea.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    const parsed = tokens.map((tok, i) => {
      if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
        return <strong key={i} className="font-semibold text-[var(--text-primary)]">{tok.slice(2, -2)}</strong>;
      }
      if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
        return <code key={i} className="px-1.5 py-0.5 rounded bg-[var(--bg)] font-mono text-[11.5px] border border-[var(--border)]">{tok.slice(1, -1)}</code>;
      }
      if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
        return <em key={i} className="italic text-[var(--text-primary)]">{tok.slice(1, -1)}</em>;
      }
      return tok;
    });

    return (
      <React.Fragment key={idx}>
        {idx > 0 && <br />}
        {parsed}
      </React.Fragment>
    );
  });
}

export default function InterviewModal({
  isOpen,
  onClose,
  isInline = false,
  onViewResults,
  phase,
  busy,
  summaries,
  showBrief,
  briefInfo,
  qIndex,
  questions,
  selectedOptionId,
  freeText,
  canGoBack,
  answered,
  doneReason,
  ledgerPath,
  errorMessage,
  synthesis,
  onStartNew,
  onResume,
  onDeleteSummary,
  onSelectOption,
  onTextChange,
  onSubmitAnswer,
  onGoBack,
  onGoToPick,
  onOpenContextModal,
}: InterviewModalProps) {
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (phase === "interview" && textareaRef.current && !busy) {
      textareaRef.current.focus();
    }
  }, [phase, qIndex, busy]);

  useEffect(() => {
    if (isInline) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        if (showConfirmExit) setShowConfirmExit(false);
        else if (phase === "interview" && (freeText.trim() || selectedOptionId)) setShowConfirmExit(true);
        else onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, phase, freeText, selectedOptionId, showConfirmExit, onClose, isInline]);

  if (!isOpen) return null;

  const currentQ = questions[qIndex] || null;
  const allInterviews = [...summaries.enProgreso, ...summaries.completadas];

  const renderPickPhase = () => (
    <div className="space-y-3">
      {/* Active Brief Card */}
      {!showBrief ? (
        <div className="p-2.5 rounded-md bg-[var(--amber-soft)] border border-amber-500/30 text-xs space-y-1">
          <p className="text-[var(--text-primary)] leading-tight">
            <strong className="text-[var(--amber)] font-semibold">Sin contexto de repositorio.</strong> El modelo responderá sin contexto previo.
          </p>
          <button
            type="button"
            className="btn btn-primary text-[11px] py-0.5 px-2 min-h-[28px]"
            onClick={onOpenContextModal}
          >
            Hacer entrevista de contexto primero
          </button>
        </div>
      ) : briefInfo && (
        <div className="p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs space-y-0.5 min-h-[38px]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Contexto Activo</span>
            <span className="text-[9.5px] font-semibold bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.2 rounded-full">Activo</span>
          </div>
          <p className="text-[var(--text-primary)] line-clamp-1 leading-normal text-[11px]">
            {briefInfo.brief.resumen_proyecto}
          </p>
          <button
            type="button"
            className="text-[10.5px] text-[var(--accent)] font-medium flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
            onClick={onOpenContextModal}
          >
            Cambiar contexto <ChevronRight />
          </button>
        </div>
      )}

      {/* New Interview CTA */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-primary min-h-[38px] px-3.5 text-xs font-semibold"
          onClick={onStartNew}
        >
          + Nueva Entrevista
        </button>
        <span className="text-[10.5px] text-[var(--text-muted)] font-mono">{allInterviews.length} guardada(s)</span>
      </div>

      {/* Compact, high-density Interview Cards */}
      {allInterviews.length > 0 && (
        <div className="space-y-1.5 pt-1.5 border-t border-[var(--border)]">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
            Historial de Entrevistas
          </span>

          <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-0.5">
            {allInterviews.map((s) => {
              const isCompleted = s.topics_total > 0 && s.topics_closed >= s.topics_total;
              const pct = s.topics_total > 0 ? Math.round((s.topics_closed / s.topics_total) * 100) : 0;

              return (
                <div
                  key={s.ledgerPath}
                  className="px-3 py-2 rounded-md border min-h-[38px] border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-hover)] hover:bg-[var(--surface)] transition-all cursor-pointer flex items-center justify-between gap-2 text-xs"
                  onClick={() => onResume(s.ledgerPath, isCompleted)}
                >
                  {/* Left Column */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="font-mono text-[10.5px] text-[var(--text-muted)] shrink-0">
                      {s.created_at}
                    </span>
                    {isCompleted ? (
                      <span className="text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 px-1.5 py-0.2 rounded border border-emerald-500/20 shrink-0">
                        Completada
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold bg-[var(--amber-soft)] text-[var(--amber)] px-1.5 py-0.2 rounded border border-amber-500/20 shrink-0">
                        {pct}%
                      </span>
                    )}
                    <span className="text-[10.5px] text-[var(--text-secondary)] truncate">
                      {s.answers_count} resp. · {s.topics_closed}/{s.topics_total} tópicos
                    </span>
                  </div>

                  {/* Right Column */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10.5px] text-[var(--accent)] font-semibold flex items-center gap-0.5">
                      {isCompleted ? "Ver" : "Continuar"} <ChevronRight />
                    </span>
                    <button
                      type="button"
                      className="icon-btn text-[var(--red)] w-5 h-5 p-0 hover:bg-[var(--red-soft)] rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingPath(s.ledgerPath);
                      }}
                      title="Eliminar"
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

  const renderGeneratingQuestions = () => (
    <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      <p className="text-xs text-[var(--text-primary)] font-medium">Generando las preguntas…</p>
      <p className="text-[11px] text-[var(--text-muted)] max-w-xs">
        Preparando la sesión de entrevista y cargando el contexto…
      </p>
    </div>
  );

  const renderLoadingNext = () => (
    <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      <p className="text-xs text-[var(--text-primary)] font-medium">Cargando siguiente pregunta…</p>
      <p className="text-[11px] text-[var(--text-muted)] max-w-xs">
        Procesando tu respuesta y formulando la pregunta correspondiente…
      </p>
    </div>
  );

  const renderInterviewPhase = () => {
    if (!currentQ) return null;
    const labelTopic = TOPIC_LABELS[currentQ.topic] || currentQ.topic;
    const canSubmit = !busy && (selectedOptionId !== null || freeText.trim().length > 0);

    return (
      <div className="space-y-3.5">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-mono">
          <span className="font-semibold text-[var(--accent)]">
            Tópico: {labelTopic}
          </span>
          <span>{answered} respondida(s)</span>
        </div>

        <div className="space-y-3">
          {currentQ.contradiction && (
            <div className="p-3 rounded-lg bg-[var(--amber-soft)] border border-amber-500/30 text-xs sm:text-sm flex items-start gap-2">
              <AlertIcon />
              <p className="text-[var(--text-primary)] leading-relaxed">
                <strong className="text-[var(--amber)] font-semibold">Contradicción:</strong>{" "}
                {currentQ.contradiction.explanation}
              </p>
            </div>
          )}

          <div className="p-3.5 sm:p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs sm:text-sm leading-relaxed text-[var(--text-primary)] font-medium shadow-xs space-y-1">
            {renderQuestionText(currentQ.question_text)}
          </div>

          {currentQ.options.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10.5px] font-mono text-[var(--text-muted)] uppercase tracking-wider block font-semibold">Opciones recomendadas:</span>
              <div className="grid grid-cols-1 gap-2">
                {currentQ.options.map((opt) => {
                  const isSelected = selectedOptionId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`w-full text-left text-xs sm:text-sm px-3.5 py-2.5 rounded-lg border transition-all cursor-pointer font-medium ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)] shadow-xs ring-1 ring-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      }`}
                      onClick={() => onSelectOption(opt.id)}
                      disabled={busy}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <textarea
              ref={textareaRef}
              className="textarea-minimal text-xs sm:text-sm py-2.5 px-3 min-h-[100px]"
              rows={3 as any}
              placeholder={
                selectedOptionId
                  ? "Opción seleccionada. Si querés explayarte, podés escribir acá…"
                  : "Escribí tu respuesta aquí…"
              }
              value={freeText}
              onChange={(e) => onTextChange(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                  e.preventDefault();
                  if (canSubmit) onSubmitAnswer();
                }
              }}
            />
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
              <span>Atajo: <kbd className="px-1 py-0.2 rounded bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-secondary)]">Ctrl + Enter</kbd></span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <button
              type="button"
              className="btn btn-danger-ghost text-[11px]"
              onClick={() => {
                if (freeText.trim() || selectedOptionId) setShowConfirmExit(true);
                else onGoToPick();
              }}
            >
              Guardar y salir
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn btn-ghost text-xs min-h-[36px] px-3.5"
                onClick={onGoBack}
                disabled={busy || !canGoBack}
              >
                ← Anterior
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs min-h-[36px] px-3.5 font-semibold"
                onClick={onSubmitAnswer}
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

  const renderSynthesizing = () => (
    <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      <p className="text-xs text-[var(--text-primary)] font-medium">Generando resultados…</p>
      <p className="text-[11px] text-[var(--text-muted)] max-w-xs">
        Sintetizando la planilla de requerimientos (RFs, ASRs, restricciones, glosario)…
      </p>
    </div>
  );

  const renderDone = () => (
    <div className="space-y-4 text-center py-2 max-w-lg mx-auto">
      <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
        <CheckIcon />
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Entrevista Finalizada con Éxito</h3>
        <p className="text-xs font-mono text-[var(--text-muted)]">Motivo: {doneReason || "all_topics_closed"}</p>
      </div>

      <div className="p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-left text-xs sm:text-sm space-y-2 shadow-xs">
        <span className="text-[10.5px] font-mono text-[var(--text-muted)] uppercase block font-semibold">Resumen de la Síntesis Generada</span>
        <p className="font-bold text-[var(--text-primary)] text-xs sm:text-sm">{synthesis.proyecto_metadata.nombre_proyecto}</p>
        <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)] pt-1 border-t border-[var(--border)]">
          <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {synthesis.requerimientos_funcionales.length} Requerimientos Funcionales</div>
          <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {synthesis.atributos_de_calidad_y_asrs.length} Atributos de Calidad (ASR)</div>
          <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {synthesis.restricciones_globales.length} Restricciones Globales</div>
          <div className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {Object.keys(synthesis.glosario_de_terminos).length} Términos del Glosario</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
        <button
          type="button"
          className="btn btn-ghost text-xs min-h-[40px] px-4 font-medium"
          onClick={onGoToPick}
        >
          Volver a Entrevistas
        </button>
        {onViewResults ? (
          <button
            type="button"
            className="btn btn-primary text-xs min-h-[40px] px-4 font-semibold shadow-xs"
            onClick={onViewResults}
          >
            Ver Requerimientos Sintetizados →
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary text-xs min-h-[40px] px-4 font-semibold shadow-xs"
            onClick={onClose}
          >
            Cerrar Modal
          </button>
        )}
      </div>
    </div>
  );

  const renderError = () => (
    <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
      <div className="text-[var(--red)]"><AlertIcon /></div>
      <p className="text-xs text-[var(--text-secondary)] max-w-xs">{errorMessage || "Ocurrió un error."}</p>
      <button type="button" className="btn btn-ghost text-xs mt-1 min-h-[36px] px-3.5" onClick={onGoToPick}>Volver</button>
    </div>
  );

  const renderBody = () => {
    if (phase === "pick") return renderPickPhase();
    if (phase === "generating_questions") return renderGeneratingQuestions();
    if (phase === "loading_next") return renderLoadingNext();
    if (phase === "interview") return renderInterviewPhase();
    if (phase === "synthesizing") return renderSynthesizing();
    if (phase === "done") return renderDone();
    if (phase === "error") return renderError();
    return null;
  };

  if (isInline) {
    return (
      <div className="w-full h-full flex flex-col relative">
        <div className="flex-1 overflow-y-auto">{renderBody()}</div>

        {/* Exit Confirmation Overlay */}
        {showConfirmExit && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 rounded-md">
            <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">¿Guardar y salir?</h3>
              <p className="text-[11px] text-[var(--text-muted)]">Tu progreso actual se guardará en el borrador.</p>
              <div className="flex justify-end gap-2 pt-0.5">
                <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setShowConfirmExit(false)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary text-xs py-1 min-h-[32px]"
                  onClick={() => {
                    setShowConfirmExit(false);
                    onGoToPick();
                  }}
                >
                  Salir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Overlay */}
        {deletingPath && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 rounded-md">
            <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
              <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar esta entrevista?</h3>
              <p className="text-[11px] text-[var(--text-muted)]">El historial se borrará del disco.</p>
              <div className="flex justify-end gap-2 pt-0.5">
                <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingPath(null)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                  onClick={() => {
                    onDeleteSummary(deletingPath);
                    setDeletingPath(null);
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (phase === "interview" && (freeText.trim() || selectedOptionId)) setShowConfirmExit(true);
          else onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-shell tc-enter relative">
        <div className="modal-header">
          <h2 className="text-xs font-semibold tracking-tight text-[var(--text-primary)]">
            {phase === "synthesizing" || phase === "generating_questions" || phase === "loading_next"
              ? "Generando Resultados"
              : "Entrevista de Requerimientos"}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <CloseXIcon />
          </button>
        </div>

        <div className="modal-body">{renderBody()}</div>

        {/* Exit Confirmation Overlay */}
        {showConfirmExit && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
              <h3 className="text-xs font-semibold text-[var(--text-primary)]">¿Guardar y salir?</h3>
              <p className="text-[11px] text-[var(--text-muted)]">Tu progreso actual se guardará en el borrador.</p>
              <div className="flex justify-end gap-2 pt-0.5">
                <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setShowConfirmExit(false)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary text-xs py-1 min-h-[32px]"
                  onClick={() => {
                    setShowConfirmExit(false);
                    onGoToPick();
                  }}
                >
                  Salir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Overlay */}
        {deletingPath && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
              <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar esta entrevista?</h3>
              <p className="text-[11px] text-[var(--text-muted)]">El historial se borrará del disco.</p>
              <div className="flex justify-end gap-2 pt-0.5">
                <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingPath(null)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                  onClick={() => {
                    onDeleteSummary(deletingPath);
                    setDeletingPath(null);
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
