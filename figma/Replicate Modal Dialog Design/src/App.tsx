import React, { useState } from "react";
import RepoContextModal from "./components/RepoContextModal";
import InterviewModal from "./components/InterviewModal";
import CoreArchitectureModal from "./components/CoreArchitectureModal";
import { useRepoContextModal } from "./hooks/useRepoContextModal";
import { useInterviewModal } from "./hooks/useInterviewModal";
import { useCoreArchitectureModal } from "./hooks/useCoreArchitectureModal";
import { REPO_CONTEXT_PALETTE, type ColorToken } from "./styles/palette";
import { safeCopyToClipboard } from "./utils/clipboard";

export default function App() {
  const repoModal = useRepoContextModal();
  const interviewModal = useInterviewModal();
  const architectureModal = useCoreArchitectureModal();

  const [tab, setTab] = useState<"demo" | "heuristics" | "fitts" | "palette">("demo");
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  const activeBrief = repoModal.briefs.find((b) => b.path === repoModal.activePath);

  const copyToClipboard = async (text: string, varName: string) => {
    const success = await safeCopyToClipboard(text);
    if (success) {
      setCopiedVar(varName);
      setTimeout(() => setCopiedVar(null), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-150">
      {/* Minimal Header */}
      <header className="border-b border-[var(--border)] bg-[var(--sidebar)] px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-[var(--accent)] text-[var(--accent-foreground)] font-bold text-xs flex items-center justify-center">
            RC
          </div>
          <span className="text-xs font-semibold tracking-tight text-[var(--text-primary)]">
            RepoContext, Interview & Core Architecture Modals
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Navigation Tabs */}
          <div className="flex bg-[var(--bg)] p-0.5 rounded border border-[var(--border)] text-xs">
            {(
              [
                ["demo", "Demos de Modales"],
                ["heuristics", "10 Heurísticas"],
                ["fitts", "Ley de Fitts"],
                ["palette", "Paleta"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`px-3 py-1 rounded transition-colors ${
                  tab === key
                    ? "bg-[var(--surface)] text-[var(--text-primary)] font-medium shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Theme Switch */}
          <button
            type="button"
            className="btn btn-ghost text-xs py-1 min-h-[32px]"
            onClick={repoModal.toggleTheme}
          >
            {repoModal.theme === "dark" ? "☀️ Claro" : "🌙 Oscuro"}
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {tab === "demo" && (
          <div className="space-y-6">
            {/* Featured 90% Core Architecture Modal CTA */}
            <div className="p-5 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono tracking-widest text-[var(--accent)] uppercase block font-semibold">
                    MODAL GENERAL UNIFICADO (90% VIEWPORT)
                  </span>
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    Matriz de Entrevistas y Post-Entrevistas del Proyecto
                  </h2>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    Modal unificado que agrupa las Entrevistas (Contexto y Requerimientos) y las Post-Entrevistas (RFs, ASRs, Restricciones y Glosario).
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary min-h-[40px] px-4 font-semibold text-xs shrink-0 self-start sm:self-auto"
                  onClick={architectureModal.openModal}
                >
                  📐 Abrir Modal General (90%)
                </button>
              </div>
            </div>

            {/* Modal Switcher Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. Repo Context Modal Tester */}
              <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                  <div>
                    <h2 className="text-xs font-semibold text-[var(--text-primary)]">Modal 1: Contexto de Repositorio</h2>
                    <p className="text-[11px] text-[var(--text-muted)]">Fase 0 — Brief e incertidumbres.</p>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={repoModal.openModal}>
                    Abrir
                  </button>
                </div>

                <div className="space-y-1.5 pt-1">
                  <span className="text-[10.5px] font-mono text-[var(--text-muted)] uppercase block">Simular Estado:</span>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => repoModal.forceState("idle", "list")}>Lista</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => repoModal.forceState("idle", "detail")}>Detalle</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => repoModal.startInterview(3)}>Pregunta (4/8)</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => repoModal.forceState("synthesizing", "list")}>Sintetizando</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => repoModal.forceState("done", "list")}>Resultado</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px] text-[var(--amber)]" onClick={repoModal.restoreDemo}>Restaurar</button>
                  </div>
                </div>
              </div>

              {/* 2. Requirements Interview Modal Tester */}
              <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                  <div>
                    <h2 className="text-xs font-semibold text-[var(--text-primary)]">Modal 2: Entrevista de Requerimientos</h2>
                    <p className="text-[11px] text-[var(--text-muted)]">Entrevista IA — Tópicos y contradicciones.</p>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={interviewModal.openModal}>
                    Abrir
                  </button>
                </div>

                <div className="space-y-1.5 pt-1">
                  <span className="text-[10.5px] font-mono text-[var(--text-muted)] uppercase block">Simular Estado:</span>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => interviewModal.forceState("pick")}>Selector</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={interviewModal.startNew}>Entrevista</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => interviewModal.forceState("synthesizing")}>Sintetizando</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => interviewModal.forceState("done")}>Resultado</button>
                    <button type="button" className="btn btn-ghost text-[11px] py-1 px-2 min-h-[28px]" onClick={() => interviewModal.forceState("error")}>Error</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Active Context Status */}
            <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[11px] text-[var(--text-muted)] uppercase">Contexto Activo del Proyecto</span>
                {activeBrief && <span className="text-[10px] font-semibold bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.5 rounded-full">Activo</span>}
              </div>

              {activeBrief ? (
                <p className="text-xs text-[var(--text-primary)] leading-relaxed">
                  {activeBrief.brief.resumen_proyecto}
                </p>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">No hay ningún contexto activo cargado.</p>
              )}
            </div>
          </div>
        )}

        {tab === "heuristics" && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">10 Heurísticas de Nielsen — Rediseño Minimalista</h2>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Los modales fueron diseñados con la misma estética minimalista, Fitts's Law y los 10 principios de usabilidad en 100% español.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                ["H1. Visibilidad del sistema", "Estado activo, contadores de items e indicadores claros de progreso."],
                ["H2. Lenguaje claro", "Copy en 100% español sin términos en inglés ('Requerimientos Funcionales', 'Atributos de Calidad', 'Restricciones', 'Glosario')."],
                ["H3. Control y libertad", "Navegación fluida por pestañas, cierre rápido con ESC e interacciones de 1-clic."],
                ["H4. Consistencia", "Misma tipografía Geist, paleta guardada y estándares visuales uniformes."],
                ["H5. Prevención de errores", "Confirmación previa antes de eliminar elementos o salir de entrevistas."],
                ["H6. Reconocimiento", "Badges semánticos para prioridad (Alta, Media, Baja) e identificadores únicos."],
                ["H7. Flexibilidad y eficiencia", "Buscador global en la matriz de 90%, atajos de teclado y copia con 1 clic."],
                ["H8. Estética minimalista", "Diseño sobrio al 90% del viewport sin distracciones visuales ni elementos redundantes."],
                ["H9. Diagnóstico de errores", "Notificaciones de error con reintento y recuperación de borrador."],
                ["H10. Ayuda y documentación", "Criterios de ajuste, justificaciones e identificadores visibles en español."],
              ].map(([title, desc], idx) => (
                <div key={idx} className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-1">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">{title}</h3>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "fitts" && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">Aplicación de la Ley de Fitts</h2>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Aprovechamiento del 90% del viewport para maximizar el área de visualización ($W$) y reducir desplazamientos ($D$).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-1">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">1. Cobertura al 90% Viewport</h3>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  Aprovechamiento amplio del canvas para mostrar 3 columnas paralelas de tarjetas sin densidad excesiva.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-1">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">2. Pestañas Laterales Amplias</h3>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  Las 6 subcategorías agrupadas en Entrevistas y Post-Entrevistas se seleccionan con clics laterales de área completa.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-1">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">3. Copia Instantánea</h3>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  Botones discretos al pie de cada tarjeta para copiar el contenido completo al portapapeles.
                </p>
              </div>
            </div>
          </div>
        )}

        {tab === "palette" && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
              <h2 className="text-xs font-semibold text-[var(--text-primary)]">Paleta Conservada (`src/styles/palette.ts`)</h2>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Misma paleta de colores original, adaptable en modo Oscuro y Claro.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {REPO_CONTEXT_PALETTE.map((t: ColorToken) => {
                const currentColor = repoModal.theme === "dark" ? t.darkValue : t.lightValue;
                const isCopied = copiedVar === t.variable;

                return (
                  <div key={t.variable} className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[var(--text-primary)]">{t.name}</span>
                      <button
                        type="button"
                        className="btn btn-ghost text-[10px] py-0.5 px-1.5 min-h-0"
                        onClick={() => copyToClipboard(`var(${t.variable})`, t.variable)}
                      >
                        {isCopied ? "¡Copiado!" : "Copiar"}
                      </button>
                    </div>

                    <div className="h-10 rounded border border-[var(--border)]" style={{ backgroundColor: `var(${t.variable})` }} />

                    <div className="flex justify-between text-[10.5px] font-mono text-[var(--text-muted)]">
                      <span>{t.variable}</span>
                      <span>{currentColor}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Modal 1: Repo Context Modal Standalone */}
      <RepoContextModal
        isOpen={repoModal.isOpen}
        onClose={repoModal.closeModal}
        phase={repoModal.phase}
        view={repoModal.view}
        briefs={repoModal.briefs}
        activePath={repoModal.activePath}
        selectedPath={repoModal.selectedPath}
        inProgress={repoModal.inProgress}
        position={repoModal.position}
        briefAnswer={repoModal.briefAnswer}
        canGoBack={repoModal.canGoBack}
        busy={repoModal.busy}
        briefDone={repoModal.briefDone}
        briefError={repoModal.briefError}
        onSelectPath={repoModal.setSelectedPath}
        onActivateSelected={repoModal.activateSelected}
        onDeleteBrief={repoModal.deleteBrief}
        onStartInterview={repoModal.startInterview}
        onSubmitAnswer={repoModal.submitAnswer}
        onAnswerChange={repoModal.setBriefAnswer}
        onGoBack={repoModal.goBack}
        onExitInterview={repoModal.exitInterview}
        onUseDoneAsContext={repoModal.useDoneAsContext}
        onDeleteLedger={repoModal.deleteLedger}
        onResumeLedger={repoModal.resumeLedger}
        onRetrySynthesis={repoModal.retrySynthesis}
        onSwitchView={repoModal.switchView}
      />

      {/* Modal 2: Requirements Interview Modal Standalone */}
      <InterviewModal
        isOpen={interviewModal.isOpen}
        onClose={interviewModal.closeModal}
        phase={interviewModal.phase}
        busy={interviewModal.busy}
        summaries={interviewModal.summaries}
        showBrief={interviewModal.showBrief}
        briefInfo={interviewModal.briefInfo}
        qIndex={interviewModal.qIndex}
        questions={interviewModal.questions}
        selectedOptionId={interviewModal.selectedOptionId}
        freeText={interviewModal.freeText}
        canGoBack={interviewModal.canGoBack}
        answered={interviewModal.answered}
        doneReason={interviewModal.doneReason}
        ledgerPath={interviewModal.ledgerPath}
        errorMessage={interviewModal.errorMessage}
        synthesis={interviewModal.synthesis}
        onStartNew={interviewModal.startNew}
        onResume={interviewModal.resume}
        onDeleteSummary={interviewModal.deleteSummary}
        onSelectOption={interviewModal.selectOption}
        onTextChange={interviewModal.setText}
        onSubmitAnswer={interviewModal.submitAnswer}
        onGoBack={interviewModal.goBack}
        onGoToPick={interviewModal.goToPick}
        onOpenContextModal={() => {
          interviewModal.closeModal();
          repoModal.openModal();
        }}
      />

      {/* Modal 3: Core Architecture 90% Viewport Matrix Modal */}
      <CoreArchitectureModal
        isOpen={architectureModal.isOpen}
        onClose={architectureModal.closeModal}
        repoState={{
          phase: repoModal.phase,
          view: repoModal.view,
          briefs: repoModal.briefs,
          activePath: repoModal.activePath,
          selectedPath: repoModal.selectedPath,
          inProgress: repoModal.inProgress,
          position: repoModal.position,
          briefAnswer: repoModal.briefAnswer,
          canGoBack: repoModal.canGoBack,
          busy: repoModal.busy,
          briefDone: repoModal.briefDone,
          briefError: repoModal.briefError,
          onSelectPath: repoModal.setSelectedPath,
          onActivateSelected: repoModal.activateSelected,
          onDeleteBrief: repoModal.deleteBrief,
          onStartInterview: repoModal.startInterview,
          onSubmitAnswer: repoModal.submitAnswer,
          onAnswerChange: repoModal.setBriefAnswer,
          onGoBack: repoModal.goBack,
          onExitInterview: repoModal.exitInterview,
          onUseDoneAsContext: repoModal.useDoneAsContext,
          onDeleteLedger: repoModal.deleteLedger,
          onResumeLedger: repoModal.resumeLedger,
          onRetrySynthesis: repoModal.retrySynthesis,
          onSwitchView: repoModal.switchView,
        }}
        interviewState={{
          phase: interviewModal.phase,
          busy: interviewModal.busy,
          summaries: interviewModal.summaries,
          showBrief: interviewModal.showBrief,
          briefInfo: interviewModal.briefInfo,
          qIndex: interviewModal.qIndex,
          questions: interviewModal.questions,
          selectedOptionId: interviewModal.selectedOptionId,
          freeText: interviewModal.freeText,
          canGoBack: interviewModal.canGoBack,
          answered: interviewModal.answered,
          doneReason: interviewModal.doneReason,
          ledgerPath: interviewModal.ledgerPath,
          errorMessage: interviewModal.errorMessage,
          synthesis: interviewModal.synthesis,
          onStartNew: interviewModal.startNew,
          onResume: interviewModal.resume,
          onDeleteSummary: interviewModal.deleteSummary,
          onSelectOption: interviewModal.selectOption,
          onTextChange: interviewModal.setText,
          onSubmitAnswer: interviewModal.submitAnswer,
          onGoBack: interviewModal.goBack,
          onGoToPick: interviewModal.goToPick,
        }}
      />
    </div>
  );
}
