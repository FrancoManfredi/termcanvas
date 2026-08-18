import React, { useState, useEffect, useRef } from "react";
import { safeCopyToClipboard } from "../utils/clipboard";

export interface Uncertainty {
  tema: string;
  por_que_importa: string;
  impacto_en_diseno: string;
}

export interface ConsistencyAlert {
  descripcion: string;
  gravedad: "alta" | "media" | "baja" | string;
}

export interface BriefData {
  resumen_proyecto: string;
  propuesta_de_valor?: string;
  incertidumbres_criticas: Uncertainty[];
  alertas_consistencia: ConsistencyAlert[];
}

export interface BriefItem {
  path: string;
  timestamp: string;
  brief: BriefData;
}

export interface InProgressItem {
  ledgerPath: string;
  timestamp: string;
  answers_count: number;
  total_questions: number;
}

export interface InterviewPosition {
  bloqueNumero: number;
  bloqueTotal: number;
  preguntaNumero: number;
  preguntaTotal: number;
  respondidas: number;
  bloque: { titulo: string };
  pregunta: string;
}

export type ModalPhase = "idle" | "interview" | "synthesizing" | "done" | "error";
export type ModalView = "list" | "detail";

export interface RepoContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInline?: boolean; // When rendered inside the 90% Core Architecture Modal panel
  phase: ModalPhase;
  view: ModalView;
  briefs: BriefItem[];
  activePath: string;
  selectedPath: string;
  inProgress: InProgressItem[];
  position: InterviewPosition | null;
  briefAnswer: string;
  canGoBack: boolean;
  busy: boolean;
  briefDone: BriefItem | null;
  briefError: string | null;
  onSelectPath: (path: string) => void;
  onActivateSelected: (path?: string) => void;
  onDeleteBrief: (path: string) => void;
  onStartInterview: (resumeAt?: number) => void;
  onSubmitAnswer: () => void;
  onAnswerChange: (value: string) => void;
  onGoBack: () => void;
  onExitInterview: () => void;
  onUseDoneAsContext: () => void;
  onDeleteLedger: (path: string) => void;
  onResumeLedger: (path: string) => void;
  onSwitchView: (view: ModalView) => void;
  onRetrySynthesis?: () => void;
}

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

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
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

export default function RepoContextModal({
  isOpen,
  onClose,
  isInline = false,
  phase,
  view,
  briefs,
  activePath,
  selectedPath,
  inProgress,
  position,
  briefAnswer,
  canGoBack,
  busy,
  briefDone,
  briefError,
  onSelectPath,
  onActivateSelected,
  onDeleteBrief,
  onStartInterview,
  onSubmitAnswer,
  onAnswerChange,
  onGoBack,
  onExitInterview,
  onUseDoneAsContext,
  onDeleteLedger,
  onResumeLedger,
  onSwitchView,
  onRetrySynthesis,
}: RepoContextModalProps) {
  const [copied, setCopied] = useState(false);
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const [deletingBriefPath, setDeletingBriefPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stepNumber = position?.preguntaNumero ?? 0;

  useEffect(() => {
    if (phase === "interview" && textareaRef.current && !busy) {
      textareaRef.current.focus();
    }
  }, [phase, stepNumber, busy]);

  useEffect(() => {
    if (isInline) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        if (showConfirmExit) setShowConfirmExit(false);
        else if (phase === "interview" && briefAnswer.trim()) setShowConfirmExit(true);
        else onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, phase, briefAnswer, showConfirmExit, onClose, isInline]);

  if (!isOpen) return null;

  const selectedBrief = briefs.find((b) => b.path === selectedPath) || null;
  const isInterview = phase === "interview" || phase === "synthesizing";

  const handleCopy = async (text: string) => {
    const success = await safeCopyToClipboard(text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const filteredBriefs = briefs.filter((b) =>
    b.brief.resumen_proyecto.toLowerCase().includes(search.toLowerCase()) ||
    b.timestamp.toLowerCase().includes(search.toLowerCase())
  );

  const renderInterview = () => {
    if (!position) return null;
    const canSubmit = !busy && briefAnswer.trim().length > 0;
    const pct = Math.round((position.respondidas / position.preguntaTotal) * 100);

    return (
      <div className="space-y-3.5">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-mono">
          <span className="font-semibold text-[var(--accent)]">
            Bloque {position.bloqueNumero}/{position.bloqueTotal} · {position.bloque.titulo}
          </span>
          <span>Pregunta {position.preguntaNumero} de {position.preguntaTotal} ({pct}%)</span>
        </div>

        <div className="progress-line-track">
          <div className="progress-line-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="p-3.5 sm:p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs sm:text-sm leading-relaxed text-[var(--text-primary)] font-medium shadow-xs">
          {position.pregunta}
        </div>

        <div className="space-y-1">
          <textarea
            ref={textareaRef}
            className="textarea-minimal text-xs sm:text-sm py-2.5 px-3 min-h-[100px]"
            rows={3 as any}
            placeholder="Escribí tu respuesta aquí…"
            value={briefAnswer}
            onChange={(e) => onAnswerChange(e.target.value)}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                if (canSubmit) onSubmitAnswer();
              }
            }}
          />
          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] font-mono">
            <span>{briefAnswer.length} caracteres</span>
            <span>Atajo: <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-secondary)]">Ctrl + Enter</kbd></span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            className="btn btn-danger-ghost text-xs"
            onClick={() => {
              if (briefAnswer.trim()) setShowConfirmExit(true);
              else onExitInterview();
            }}
          >
            Guardar y salir
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost text-xs min-h-[40px] px-4"
              onClick={onGoBack}
              disabled={busy || !canGoBack}
            >
              ← Anterior
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs min-h-[40px] px-4 font-semibold"
              onClick={onSubmitAnswer}
              disabled={!canSubmit}
            >
              {busy ? "Guardando…" : "Siguiente →"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSynthesizing = () => (
    <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      <p className="text-xs text-[var(--text-primary)] font-medium">Sintetizando el contexto del proyecto…</p>
      <p className="text-[11px] text-[var(--text-muted)] max-w-xs">Analizando visión, usuarios y restricciones…</p>
    </div>
  );

  const renderError = () => (
    <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
      <div className="text-[var(--red)]"><AlertIcon /></div>
      <p className="text-xs text-[var(--text-secondary)] max-w-xs">{briefError || "Ocurrió un error."}</p>
      <div className="flex gap-2 pt-1">
        {onRetrySynthesis && (
          <button type="button" className="btn btn-primary text-xs min-h-[38px] px-3.5 font-semibold" onClick={onRetrySynthesis}>Reintentar</button>
        )}
        <button type="button" className="btn btn-ghost text-xs min-h-[38px] px-3.5" onClick={onExitInterview}>Volver</button>
      </div>
    </div>
  );

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
            onClick={() => handleCopy(JSON.stringify(b, null, 2))}
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
          <button
            type="button"
            className="btn btn-ghost text-xs min-h-[38px] w-36 font-medium"
            onClick={onExitInterview}
          >
            Volver al menú
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs min-h-[38px] w-36 font-semibold"
            onClick={onUseDoneAsContext}
          >
            Usar activo
          </button>
        </div>
      </div>
    );
  };

  const renderNoBrief = () => (
    <div className="py-6 px-4 flex flex-col items-center justify-center text-center space-y-4">
      <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center border border-[var(--border)]">
        <DocumentPlusIcon />
      </div>

      <div className="space-y-1 max-w-sm">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">
          Sin contexto de repositorio cargado
        </h3>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          El contexto de repositorio releva la misión, el problema principal, los usuarios objetivo y las restricciones del proyecto mediante una entrevista guiada.
        </p>
      </div>

      <button
        type="button"
        className="btn btn-primary min-h-[38px] px-4 text-xs font-semibold"
        onClick={() => onStartInterview(0)}
      >
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
                <span className="font-mono text-[10.5px] text-[var(--text-muted)]">{item.timestamp}</span>
                <span className="text-[10.5px] text-[var(--text-secondary)]">{item.answers_count}/{item.total_questions} respondidas</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  className="text-[10.5px] text-[var(--accent)] font-semibold flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
                  onClick={() => onResumeLedger(item.ledgerPath)}
                >
                  Continuar <ChevronRight />
                </button>
                <button
                  type="button"
                  className="icon-btn text-[var(--red)] w-5 h-5 p-0 hover:bg-[var(--red-soft)] rounded"
                  onClick={() => onDeleteLedger(item.ledgerPath)}
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

  const renderList = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-[var(--text-muted)] font-mono">{briefs.length} contexto(s) guardado(s)</span>
        <button
          type="button"
          className="btn btn-primary min-h-[38px] px-3.5 text-xs font-semibold"
          onClick={() => onStartInterview(0)}
        >
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
          const isActive = item.path === activePath;
          return (
            <div
              key={item.path}
              className={`p-3.5 sm:p-4 rounded-lg border min-h-[44px] transition-all cursor-pointer flex items-center justify-between gap-3 text-xs sm:text-sm ${
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-hover)] hover:bg-[var(--surface)]"
              }`}
              onClick={() => {
                onSelectPath(item.path);
                onActivateSelected(item.path);
              }}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">{item.timestamp}</span>
                {isActive ? (
                  <span className="text-[9.5px] font-semibold bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.5 rounded-full shrink-0">
                    Activo
                  </span>
                ) : (
                  <span className="text-[9.5px] text-[var(--text-muted)] shrink-0">Clic para activar</span>
                )}
                <p className="text-xs sm:text-sm text-[var(--text-primary)] font-medium truncate">
                  {item.brief.resumen_proyecto}
                </p>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  className="text-xs text-[var(--accent)] font-semibold flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPath(item.path);
                    onSwitchView("detail");
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

      {/* In Progress Drafts */}
      {inProgress.length > 0 && (
        <div className="pt-2 border-t border-[var(--border)] space-y-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
            Entrevistas en proceso ({inProgress.length})
          </span>
          <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-0.5">
            {inProgress.map((item) => (
              <div key={item.ledgerPath} className="px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between gap-2 text-xs min-h-[38px]">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="font-mono text-[10.5px] text-[var(--text-muted)] shrink-0">{item.timestamp}</span>
                  <span className="text-[10.5px] text-[var(--text-secondary)] truncate">{item.answers_count}/{item.total_questions} respondidas</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    className="text-[10.5px] text-[var(--accent)] font-semibold flex items-center gap-0.5 hover:underline bg-transparent border-none p-0 cursor-pointer"
                    onClick={() => onResumeLedger(item.ledgerPath)}
                  >
                    Continuar <ChevronRight />
                  </button>
                  <button
                    type="button"
                    className="icon-btn text-[var(--red)] w-5 h-5 p-0 hover:bg-[var(--red-soft)] rounded"
                    onClick={() => onDeleteLedger(item.ledgerPath)}
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

  const renderDetail = () => {
    if (!selectedBrief) return null;
    const isActive = selectedBrief.path === activePath;

    return (
      <div className="space-y-3">
        <button
          type="button"
          className="btn btn-ghost text-xs py-1 min-h-[32px] self-start flex items-center gap-1"
          onClick={() => onSwitchView("list")}
        >
          <ChevronLeft /> Volver a la lista
        </button>

        <div className="space-y-2 p-3 rounded-md bg-[var(--bg)] border border-[var(--border)] text-xs">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-1.5">
            <span className="font-mono text-[10.5px] text-[var(--text-muted)]">{selectedBrief.timestamp}</span>
            <div className="flex items-center gap-2">
              {isActive && <span className="text-[9.5px] font-semibold bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.2 rounded-full">Activo</span>}
              <button
                type="button"
                disabled={isActive}
                className={`btn text-[11px] py-0.5 px-2 ${
                  isActive ? "btn-ghost opacity-30 cursor-not-allowed" : "btn-danger-ghost"
                }`}
                onClick={() => {
                  if (!isActive) setDeletingBriefPath(selectedBrief.path);
                }}
              >
                Eliminar
              </button>
            </div>
          </div>

          <div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block">Resumen</span>
            <p className="text-[11.5px] text-[var(--text-primary)] leading-relaxed mt-0.5">{selectedBrief.brief.resumen_proyecto}</p>
          </div>

          {selectedBrief.brief.propuesta_de_valor && (
            <div>
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase block">Propuesta de Valor</span>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{selectedBrief.brief.propuesta_de_valor}</p>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-1">
          <button
            type="button"
            className="btn btn-ghost text-xs min-h-[38px] px-3.5"
            onClick={() => handleCopy(selectedBrief.brief.resumen_proyecto)}
          >
            {copied ? "¡Copiado!" : "Copiar Resumen"}
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs min-h-[38px] px-3.5 font-semibold"
            onClick={() => onActivateSelected(selectedBrief.path)}
            disabled={isActive}
          >
            {isActive ? "Contexto Activo" : "Marcar como Activo"}
          </button>
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (phase === "interview") return renderInterview();
    if (phase === "synthesizing") return renderSynthesizing();
    if (phase === "done") return renderDone();
    if (phase === "error") return renderError();

    if (!briefs.length) return renderNoBrief();

    return view === "list" ? renderList() : renderDetail();
  };

  // If inline, render directly without modal-scrim or modal-shell
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
                    onExitInterview();
                  }}
                >
                  Guardar y salir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Overlay */}
        {deletingBriefPath && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 rounded-md">
            <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
              <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar este contexto?</h3>
              <p className="text-[11px] text-[var(--text-muted)]">El contexto se eliminará permanentemente.</p>
              <div className="flex justify-end gap-2 pt-0.5">
                <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingBriefPath(null)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                  onClick={() => {
                    onDeleteBrief(deletingBriefPath);
                    setDeletingBriefPath(null);
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
          if (phase === "interview" && briefAnswer.trim()) setShowConfirmExit(true);
          else onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-shell tc-enter relative">
        <div className="modal-header">
          <h2 className="text-xs font-semibold tracking-tight text-[var(--text-primary)]">
            {isInterview ? "Entrevista de Contexto" : "Contexto del Repositorio"}
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
                    onExitInterview();
                  }}
                >
                  Guardar y salir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Overlay */}
        {deletingBriefPath && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
              <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar este contexto?</h3>
              <p className="text-[11px] text-[var(--text-muted)]">El contexto se eliminará permanentemente.</p>
              <div className="flex justify-end gap-2 pt-0.5">
                <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingBriefPath(null)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                  onClick={() => {
                    onDeleteBrief(deletingBriefPath);
                    setDeletingBriefPath(null);
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
