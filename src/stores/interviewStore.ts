import { create } from "zustand";
import { useNotificationStore } from "./notificationStore";
import { resolveActiveWorktree } from "../planner/planningSession";
import type { BriefStatus } from "../types";
import type {
  InterviewLedger,
  InterviewQuestion,
  InterviewSummary,
  BriefDocument,
  TurnResult,
} from "../../headless-runtime/interview/index.ts";

// Estado de la entrevista de requerimientos en la UI (motor v4). El motor
// corre en el proceso principal (IPC interview:*); acá solo se orquesta:
// listar entrevistas del proyecto activo, crear/retomar, enviar respuestas
// y mostrar el resultado.
//
// Persistencia: TODO el progreso vive en el ledger en disco
// (<projectPath>/.agents/interview/requerimientos/entrevista-*.json) — cerrar el modal no
// pierde nada; al reabrir se vuelve a listar y a retomar exactamente donde
// quedó. El contexto del proyecto (Fase 0) vive en contexto-*-documento.json y el
// motor lo usa automáticamente en cada llamada.
//
// La respuesta en edición (opción seleccionada + texto libre) vive acá, no
// en el modal: "volver atrás" restaura la pregunta anterior junto con la
// respuesta que se había enviado, para modificarla y re-enviar.

export type InterviewPhase =
  | "pick"
  | "generating_questions"
  | "loading_next"
  | "interview"
  | "synthesizing"
  | "done"
  | "error";

// Re-export: los componentes importan BriefStatus desde este store.
export type { BriefStatus } from "../types";

interface HistoryEntry {
  question: InterviewQuestion;
  topic: string | null;
  selectedOptionId: string | null;
  freeText: string;
}

interface InterviewStore {
  open: boolean;
  repoPath: string | null;
  phase: InterviewPhase;
  busy: boolean;
  summaries: InterviewSummary[];
  // Contexto del proyecto (Fase 0): alimenta la pantalla inicial del pick.
  briefStatus: BriefStatus | null;
  ledgerPath: string | null;
  // Tópico de la pregunta actual: en el contrato v4 la pregunta NO trae
  // topic_id (viene en el TurnResult), la UI lo guarda aparte.
  topic: string | null;
  question: InterviewQuestion | null;
  doneReason: string | null;
  errorMessage: string | null;
  // Ledger del estado más reciente: alimenta el aviso de contradicción
  // pendiente y el progreso de cobertura.
  ledger: InterviewLedger | null;
  // Progreso de cobertura derivado por el motor (state IPC): respuestas
  // respondidas + tópicos cerrados (barra del modal).
  progress: { answered: number; closed: number; total: number; pct: number } | null;
  // Respuesta en edición (la envían los botones del modal).
  selectedOptionId: string | null;
  freeText: string;
  // Entrevista ACTIVA del proyecto (la que alimenta las secciones POST
  // ENTREVISTA del modal unificado). Se elige en el pick phase (click en
  // la card); sin selección, la última completada. Es estado de UI en
  // memoria (no se persiste: al reabrir cae a la última completada).
  activeInterviewPath: string | null;
  // Historial de preguntas respondidas en ESTA sesión del modal: permite
  // volver atrás y modificar una respuesta ya enviada.
  history: HistoryEntry[];
  canGoBack: boolean;
  openModal: () => Promise<void>;
  closeModal: () => void;
  // Refresca el contexto del repositorio (Fase 0) desde disco: se llama al
  // activar/cambiar el brief para que el banner lo refleje al instante.
  refreshBrief: () => Promise<void>;
  createNew: () => Promise<void>;
  resume: (ledgerPath: string) => Promise<void>;
  // Elimina una entrevista guardada y la saca de la lista del selector.
  removeInterview: (ledgerPath: string) => Promise<void>;
  // Marca la entrevista como ACTIVA (la que alimenta los resultados).
  activateInterview: (ledgerPath: string) => void;
  // Vuelve al selector (fase pick) sin cerrar el modal: para elegir otra
  // entrevista o cambiar el contexto del proyecto.
  backToPick: () => void;
  selectOption: (optionId: string | null) => void;
  setFreeText: (text: string) => void;
  goBack: () => void;
  submitAnswer: () => Promise<void>;
}

// Contradicción pendiente que toca el tópico de la pregunta actual, si hay.
// En el contrato v4 la detección vive en la evaluación (ledger.contradictions)
// y la UI la deriva del ledger — con el mismo efecto visual: la pregunta
// aparece como conflicto a resolver.
export function pendingContradictionFor(
  ledger: InterviewLedger | null,
  topic: string | null,
): { explanation: string; conflictingId: string } | null {
  if (!ledger || !topic) return null;
  const topicAnswerIds = new Set(
    ledger.answers.filter((a) => a.topic === topic).map((a) => a.id),
  );
  const pending = ledger.contradictions.find(
    (c) =>
      c.status !== "resolved" &&
      (topicAnswerIds.has(c.answer_id) || topicAnswerIds.has(c.conflicting_answer_id)),
  );
  return pending
    ? { explanation: pending.reason, conflictingId: pending.conflicting_answer_id }
    : null;
}

export const useInterviewStore = create<InterviewStore>((set, get) => ({
  open: false,
  repoPath: null,
  phase: "pick",
  busy: false,
  summaries: [],
  briefStatus: null,
  ledgerPath: null,
  topic: null,
  question: null,
  doneReason: null,
  errorMessage: null,
  ledger: null,
  progress: null,
  selectedOptionId: null,
  freeText: "",
  activeInterviewPath: null,
  history: [],
  canGoBack: false,

  openModal: async () => {
    const active = resolveActiveWorktree();
    if (!active) {
      useNotificationStore
        .getState()
        .notify(
          "error",
          "Open a project first to run a requirements interview.",
        );
      return;
    }
    set({ open: true, repoPath: active.path, busy: true, errorMessage: null });
    try {
      const [summaries, briefStatus, requirementsStatus] = await Promise.all([
        window.termcanvas.interview.list(active.path),
        window.termcanvas.interview.briefStatus(active.path),
        window.termcanvas.interview.requirementsStatus(active.path),
      ]);
      // Entrevista ACTIVA por defecto: la que coincide con el marcador
      // requerimientos-activo.json (el path de la síntesis se convierte al
      // del ledger: entrevista-<ts>-sintesis.json → entrevista-<ts>.json).
      const activePath = requirementsStatus.activePath;
      const activeInterviewPath = activePath
        ? activePath.replace(/-sintesis\.json$/, ".json")
        : null;
      if (summaries.length === 1) {
        // Una sola entrevista en el proyecto: se retoma directo, sin pasar
        // por el selector — cerrar a mitad y reabrir continúa donde quedó.
        set({
          summaries,
          briefStatus,
          busy: false,
          activeInterviewPath: activeInterviewPath ?? summaries[0].ledgerPath,
        });
        await get().resume(summaries[0].ledgerPath);
        return;
      }
      set({
        summaries,
        briefStatus,
        phase: "pick",
        busy: false,
        activeInterviewPath,
      });
    } catch (err) {
      set({
        busy: false,
        phase: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  },

  closeModal: () => set({ open: false }),

  // Refresca el contexto del repositorio (Fase 0) desde disco: el banner de
  // la entrevista de requerimientos debe reflejar al instante el brief que
  // el usuario acaba de activar/cambiar en el modal de contexto.
  refreshBrief: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      const briefStatus = await window.termcanvas.interview.briefStatus(repoPath);
      set({ briefStatus });
    } catch {
      // Best-effort: el banner queda con el contexto anterior.
    }
  },

  removeInterview: async (ledgerPath) => {
    try {
      await window.termcanvas.interview.delete(ledgerPath);
    } catch (err) {
      useNotificationStore
        .getState()
        .notify("error", err instanceof Error ? err.message : "Could not delete the interview.");
      return;
    }
    const { summaries, activeInterviewPath, repoPath } = get();
    const next = summaries.filter((s) => s.ledgerPath !== ledgerPath);
    // Si se eliminó la entrevista ACTIVA, la activa cae a la última
    // completada restante (o null) y el marcador de requerimientos se
    // actualiza para que los prompts no apunten a una síntesis inexistente.
    let nextActive = activeInterviewPath;
    if (activeInterviewPath === ledgerPath) {
      const fallback = next.find(
        (s) => s.topics_total > 0 && s.topics_closed >= s.topics_total,
      );
      nextActive = fallback?.ledgerPath ?? null;
      if (nextActive && repoPath) {
        const synthesisPath = nextActive.replace(/\.json$/, "-sintesis.json");
        void window.termcanvas.interview
          .setActiveRequirements(repoPath, synthesisPath)
          .catch(() => {});
      }
    }
    set({ summaries: next, activeInterviewPath: nextActive });
  },

  // Marca la entrevista como ACTIVA: las secciones POST ENTREVISTA del
  // modal unificado leen la síntesis de la activa, y el marcador de
  // requerimientos activos (requerimientos-activo.json) se actualiza para
  // que los prompts de orquestador inyecten esa síntesis. El path de la
  // síntesis se deriva del ledger (entrevista-<ts>.json → -sintesis.json).
  activateInterview: (ledgerPath) => {
    set({ activeInterviewPath: ledgerPath });
    const { repoPath } = get();
    if (!repoPath) return;
    const synthesisPath = ledgerPath.replace(/\.json$/, "-sintesis.json");
    void window.termcanvas.interview
      .setActiveRequirements(repoPath, synthesisPath)
      .catch(() => {
        // La síntesis puede no existir todavía (entrevista sin terminar):
        // el marcador se limpia/ignora y los prompts caen al fallback.
      });
  },

  // Vuelve al selector (fase pick) sin cerrar el modal: para elegir otra
  // entrevista o cambiar el contexto del proyecto. REFRESCA la lista desde
  // disco: "Guardar y salir" a mitad de una entrevista deja el progreso en
  // el ledger y el historial debe mostrarlo al instante, sin reabrir.
  backToPick: async () => {
    const { repoPath } = get();
    set({
      phase: "pick",
      ledgerPath: null,
      topic: null,
      question: null,
      doneReason: null,
      errorMessage: null,
      ledger: null,
      progress: null,
      selectedOptionId: null,
      freeText: "",
      history: [],
      canGoBack: false,
    });
    if (!repoPath) return;
    try {
      const summaries = await window.termcanvas.interview.list(repoPath);
      set({ summaries });
    } catch {
      // Si el listado falla se conserva el historial previo.
    }
  },

  createNew: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    // Fase de carga del diseño: pantalla completa "Generando las preguntas…".
    set({ busy: true, errorMessage: null, phase: "generating_questions" });
    try {
      const created = await window.termcanvas.interview.create(repoPath);
      await applyTurnResult(created.firstQuestion, created.ledgerPath, set);
    } catch (err) {
      set({
        busy: false,
        phase: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  },

  resume: async (ledgerPath) => {
    set({ busy: true, errorMessage: null });
    try {
      const result = await window.termcanvas.interview.resume(ledgerPath);
      if (result.done) {
        // Sin tópicos pendientes: la entrevista está terminada. Si todavía
        // no se generó la síntesis (RFs, ASRs, …), se genera ahora.
        set({
          busy: false,
          phase: "synthesizing",
          doneReason: result.reason,
          ledgerPath,
          topic: null,
          question: null,
        });
        await finishSynthesisIfNeeded(ledgerPath, set);
        return;
      }
      const { ledger, progress } = await window.termcanvas.interview.state(ledgerPath);
      set({
        busy: false,
        phase: "interview",
        ledgerPath,
        ledger,
        progress,
        topic: result.topic,
        question: result.question,
        doneReason: null,
        selectedOptionId: null,
        freeText: "",
        history: [],
        canGoBack: false,
      });
    } catch (err) {
      set({
        busy: false,
        phase: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  },

  selectOption: (optionId) => {
    // Una sola respuesta: elegir una opción invalida el texto libre (y
    // viceversa). Elegir la misma opción de nuevo la deselecciona.
    const current = get().selectedOptionId;
    set({ selectedOptionId: current === optionId ? null : optionId });
  },

  setFreeText: (text) => {
    // Escribir en el campo de texto libre deselecciona la opción marcada:
    // o te explayás, o elegís una de las opciones sugeridas.
    set({ freeText: text, selectedOptionId: text.trim().length > 0 ? null : get().selectedOptionId });
  },

  goBack: () => {
    const { history, busy } = get();
    if (busy || history.length === 0) return;
    const entry = history[history.length - 1];
    set({
      history: history.slice(0, -1),
      canGoBack: history.length - 1 > 0,
      question: entry.question,
      topic: entry.topic,
      selectedOptionId: entry.selectedOptionId,
      freeText: entry.freeText,
    });
  },

  submitAnswer: async () => {
    const { ledgerPath, topic, question, selectedOptionId, freeText } = get();
    if (!ledgerPath || !topic || !question) return;
    const text = freeText.trim();
    const hasAnswer = selectedOptionId !== null || text.length > 0;
    if (!hasAnswer) return;

    set({ busy: true, errorMessage: null, phase: "loading_next" });
    // La pregunta que se está respondiendo pasa al historial de "volver
    // atrás", con la respuesta enviada, ANTES de que el motor avance.
    const historyEntry: HistoryEntry = {
      question,
      topic,
      selectedOptionId,
      freeText,
    };
    try {
      const result = await window.termcanvas.interview.submit(ledgerPath, {
        topic,
        question_text: question.question_text,
        selected_option_id: selectedOptionId,
        selected_option_label: null,
        free_text: text.length > 0 ? text : null,
      });
      await applyTurnResult(result, ledgerPath, set, {
        historyEntry,
        currentHistory: get().history,
      });
    } catch (err) {
      set({
        busy: false,
        phase: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));

// Procesa un TurnResult: refresca el ledger (contradicciones/progreso) y
// muestra la pregunta nueva, apilando la respondida en el historial (también
// cuando la entrevista termina — el stack queda para volver atrás).
async function applyTurnResult(
  result: TurnResult,
  ledgerPath: string,
  set: (partial: Partial<InterviewStore>) => void,
  opts?: { historyEntry?: HistoryEntry; currentHistory: HistoryEntry[] },
): Promise<void> {
  const history = opts ? [...opts.currentHistory, opts.historyEntry!] : [];
  if (!result.done) {
    const { ledger, progress } = await window.termcanvas.interview.state(ledgerPath);
    set({
      busy: false,
      phase: "interview",
      ledgerPath,
      ledger,
      progress,
      topic: result.topic,
      question: result.question,
      doneReason: null,
      selectedOptionId: null,
      freeText: "",
      history,
      canGoBack: history.length > 0,
    });
    return;
  }
  // La entrevista terminó: pasa a generar la síntesis con feedback de
  // estado ("Completado, estamos generando los resultados…").
  set({
    busy: false,
    phase: "synthesizing",
    ledgerPath,
    topic: null,
    question: null,
    doneReason: result.reason,
    selectedOptionId: null,
    freeText: "",
    history,
    canGoBack: history.length > 0,
  });
  await finishSynthesisIfNeeded(ledgerPath, set);
}

// Genera la síntesis final si el ledger todavía no la tiene (1 llamada), y
// pasa a la fase done con el ledger actualizado. Si la llamada falla, NO se
// traga el error en silencio: se muestra la fase de error con el motivo real
// (reabrir el modal → resume reintenta la síntesis).
async function finishSynthesisIfNeeded(
  ledgerPath: string,
  set: (partial: Partial<InterviewStore>) => void,
): Promise<void> {
  try {
    const { ledger } = await window.termcanvas.interview.state(ledgerPath);
    if (!ledger.synthesis) {
      await window.termcanvas.interview.finish(ledgerPath);
    }
    const { ledger: actualizado, progress } = await window.termcanvas.interview.state(ledgerPath);
    set({ phase: "done", ledger: actualizado, progress, errorMessage: null });
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    const { ledger, progress } = await window.termcanvas.interview.state(ledgerPath).catch(() => ({
      ledger: null,
      progress: null,
    }));
    useNotificationStore
      .getState()
      .notify(
        "error",
        "La síntesis de requerimientos no se pudo generar. Cerrá y reabrí el modal para reintentarla.",
      );
    set({
      phase: "error",
      ledger,
      progress,
      errorMessage: `La entrevista terminó pero la síntesis falló: ${motivo}`,
    });
  }
}
