import { create } from "zustand";
import { useNotificationStore } from "./notificationStore";
import { useInterviewStore } from "./interviewStore";
import type {
  BriefListItem,
  BriefStatus,
  BriefInterviewInProgress,
  BriefInterviewPosition,
} from "../types";
import type { BriefDocument } from "../../headless-runtime/interview/index.ts";

// Estado del modal de contexto del repositorio. Reemplaza al repo-context.md
// manual: el contexto del proyecto se RELEVA con la entrevista de contexto
// (Fase 0 del motor) y queda como documento .agents/interview/contexto/contexto-*-documento.json.
//
// El modal orquesta:
//   - briefPhase "idle": la vista de lista/detalle de contextos + las
//     entrevistas de contexto en progreso;
//   - briefPhase "interview": el dueño responde el template 1-a-1 (BRIEF_BLOCKS);
//   - briefPhase "synthesizing"/"done": la síntesis del documento (1 llamada);
//   - "usar como contexto" marca el brief activo (el motor de requerimientos
//     lo usa en cada llamada).

export type { BriefListItem, BriefStatus, BriefInterviewInProgress } from "../types";

export type BriefPhase = "idle" | "interview" | "synthesizing" | "done" | "error";

// Última operación fallida de la entrevista de contexto: permite el botón
// "Reintentar" del nuevo diseño sin inventar qué op retomar. Cada catch la
// deja apuntando a la op exacta (crear, retomar, enviar o sintetizar).
export type BriefRetryOp =
  | { kind: "create" }
  | { kind: "resume"; ledgerPath: string }
  | { kind: "submit"; respuesta: string }
  | { kind: "synthesize"; ledgerPath: string };

interface RepoContextStore {
  open: boolean;
  repoPath: string | null;
  loading: boolean;
  briefStatus: BriefStatus | null;
  // Vista actual: lista de contextos disponibles o detalle de uno.
  view: "list" | "detail";
  // Brief en detalle (path). Cuando hay un solo brief, se abre directo en
  // detalle.
  selectedPath: string | null;
  // Cuando el modal se abrió desde la entrevista de requerimientos
  // ("Cambiar contexto"), cerrarlo devuelve a esa entrevista.
  fromInterview: boolean;

  // ── Fase de entrevista de contexto (motor Fase 0) ─────────────────────
  briefPhase: BriefPhase;
  briefLedgerPath: string | null;
  position: BriefInterviewPosition | null;
  briefAnswer: string;
  briefBusy: boolean;
  briefDone: { brief: BriefDocument; briefPath: string } | null;
  briefError: string | null;
  briefLastOp: BriefRetryOp | null;
  // Historial de preguntas respondidas en ESTA sesión del modal: permite
  // volver atrás y editar una respuesta ya guardada (el upsert la reemplaza).
  briefHistory: { position: BriefInterviewPosition; respuesta: string }[];
  canGoBackBrief: boolean;

  openModal: (repoPath: string, options?: { fromInterview?: boolean }) => Promise<void>;
  closeModal: () => void;
  refresh: () => Promise<void>;
  // Marca el brief como ACTIVO del proyecto y muestra su detalle.
  selectBrief: (briefPath: string) => Promise<void>;
  // Marca un brief como ACTIVO sin cambiar de vista (click en fila de lista).
  activateBrief: (briefPath: string) => Promise<void>;
  // Elimina un contexto SINtetizado (no puede ser el activo) + su borrador.
  deleteBrief: (briefPath: string) => Promise<void>;
  // Elimina una entrevista de contexto EN PROGRESO (mini-ledger sin síntesis).
  deleteInProgress: (ledgerPath: string) => Promise<void>;
  goToDetail: (briefPath: string) => void;
  goToList: () => void;

  // Entrevista de contexto: empezar una nueva / continuar una en progreso.
  startBriefInterview: () => Promise<void>;
  resumeBrief: (ledgerPath: string) => Promise<void>;
  setBriefAnswer: (text: string) => void;
  submitBriefAnswer: () => Promise<void>;
  // Vuelve a la pregunta anterior con su respuesta cargada para editar.
  goBackBrief: () => void;
  // Vuelve a la vista de lista (la entrevista queda guardada en disco).
  exitBrief: () => Promise<void>;
  // Marca el brief recién sintetizado como contexto activo y vuelve a la lista.
  useDoneAsContext: () => Promise<void>;
  // Reintenta la última operación fallida (botón "Reintentar" del modal).
  retryBrief: () => Promise<void>;
}

export const useRepoContextStore = create<RepoContextStore>((set, get) => ({
  open: false,
  repoPath: null,
  loading: false,
  briefStatus: null,
  view: "list",
  selectedPath: null,
  fromInterview: false,

  briefPhase: "idle",
  briefLedgerPath: null,
  position: null,
  briefAnswer: "",
  briefBusy: false,
  briefDone: null,
  briefError: null,
  briefLastOp: null,
  briefHistory: [],
  canGoBackBrief: false,

  // Consulta los briefs del proyecto y abre el modal SIEMPRE en la lista
  // (la pantalla principal): el detalle se alcanza con "Ver detalle".
  openModal: async (repoPath, options) => {
    set({ open: true, repoPath, loading: true, fromInterview: options?.fromInterview ?? false });
    try {
      const briefStatus = await window.termcanvas.interview.briefStatus(repoPath);
      const selected =
        briefStatus.activePath ??
        (briefStatus.briefs.length > 0 ? briefStatus.briefs[briefStatus.briefs.length - 1].path : null);
      set({
        briefStatus,
        loading: false,
        selectedPath: selected,
        view: "list",
      });
    } catch {
      useNotificationStore
        .getState()
        .notify("error", "Could not load the repository context.");
      set({ loading: false });
    }
  },

  closeModal: () => {
    const { fromInterview, repoPath } = get();
    set({ open: false, fromInterview: false });
    // Si vino de "Cambiar contexto" en la entrevista de requerimientos,
    // devuelve a esa entrevista sin que el usuario reabrá el icono.
    if (fromInterview && repoPath) {
      void useInterviewStore.getState().openModal();
    }
  },

  refresh: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ loading: true });
    try {
      const briefStatus = await window.termcanvas.interview.briefStatus(repoPath);
      set({ briefStatus, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  selectBrief: async (briefPath) => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      await window.termcanvas.interview.setActiveBrief(repoPath, briefPath);
      useNotificationStore
        .getState()
        .notify("info", "Contexto seleccionado: el entrevistador de requerimientos lo usará en cada pregunta.");
    } catch {
      useNotificationStore
        .getState()
        .notify("error", "Could not set the active brief.");
      return;
    }
    set({ selectedPath: briefPath, view: "detail" });
    await get().refresh();
    // El banner de la entrevista de requerimientos refleja el cambio ya.
    void useInterviewStore.getState().refreshBrief();
  },

  activateBrief: async (briefPath) => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      await window.termcanvas.interview.setActiveBrief(repoPath, briefPath);
    } catch {
      useNotificationStore
        .getState()
        .notify("error", "Could not set the active brief.");
      return;
    }
    await get().refresh();
    // El banner de la entrevista de requerimientos refleja el cambio ya.
    void useInterviewStore.getState().refreshBrief();
  },

  deleteInProgress: async (ledgerPath) => {
    try {
      await window.termcanvas.interview.delete(ledgerPath);
    } catch (err) {
      useNotificationStore
        .getState()
        .notify("error", err instanceof Error ? err.message : "Could not delete the brief interview.");
      return;
    }
    await get().refresh();
  },

  deleteBrief: async (briefPath) => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      await window.termcanvas.interview.briefDelete(repoPath, briefPath);
    } catch (err) {
      useNotificationStore
        .getState()
        .notify("error", err instanceof Error ? err.message : "Could not delete the brief.");
      return;
    }
    await get().refresh();
  },

  goToDetail: (briefPath) => set({ selectedPath: briefPath, view: "detail" }),
  goToList: () => set({ view: "list" }),

  startBriefInterview: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ briefBusy: true, briefError: null, briefLastOp: null });
    try {
      const { ledgerPath, position } = await window.termcanvas.interview.briefCreate(repoPath);
      set({
        briefPhase: "interview",
        briefLedgerPath: ledgerPath,
        position,
        briefAnswer: "",
        briefDone: null,
        briefBusy: false,
        briefHistory: [],
        canGoBackBrief: false,
      });
    } catch (err) {
      set({
        briefBusy: false,
        briefPhase: "error",
        briefError: err instanceof Error ? err.message : String(err),
        briefLastOp: { kind: "create" },
      });
    }
  },

  resumeBrief: async (ledgerPath) => {
    set({ briefBusy: true, briefError: null, briefLastOp: null });
    try {
      const { position } = await window.termcanvas.interview.briefState(ledgerPath);
      if (position === null) {
        // Todas respondidas pero sin documento: se sintetiza directo.
        set({ briefLedgerPath: ledgerPath, briefPhase: "synthesizing", briefBusy: true });
        await synthesizeBriefDoc(ledgerPath, set);
        return;
      }
      set({
        briefPhase: "interview",
        briefLedgerPath: ledgerPath,
        position,
        briefAnswer: position.respuesta_actual ?? "",
        briefDone: null,
        briefBusy: false,
        briefHistory: [],
        canGoBackBrief: false,
      });
    } catch (err) {
      set({
        briefBusy: false,
        briefPhase: "error",
        briefError: err instanceof Error ? err.message : String(err),
        briefLastOp: { kind: "resume", ledgerPath },
      });
    }
  },

  setBriefAnswer: (text) => set({ briefAnswer: text }),

  submitBriefAnswer: async () => {
    const { briefLedgerPath, position, briefAnswer, briefBusy, briefHistory } = get();
    if (!briefLedgerPath || !position || briefBusy) return;
    const respuesta = briefAnswer.trim();
    set({ briefBusy: true, briefError: null, briefLastOp: null });
    let historyEntry: { position: BriefInterviewPosition; respuesta: string };
    try {
      const { position: siguiente } = await window.termcanvas.interview.briefSubmit(briefLedgerPath, {
        bloque: position.bloque.id,
        pregunta: position.pregunta,
        respuesta,
      });
      historyEntry = { position, respuesta };
      if (siguiente === null) {
        // Última pregunta: a sintetizar el documento (1 llamada).
        set({
          briefPhase: "synthesizing",
          briefBusy: true,
          position: null,
          briefAnswer: "",
          briefHistory: [...briefHistory, historyEntry],
          canGoBackBrief: true,
        });
        await synthesizeBriefDoc(briefLedgerPath, set);
        return;
      }
      set({
        position: siguiente,
        briefAnswer: "",
        briefBusy: false,
        briefHistory: [...briefHistory, historyEntry],
        canGoBackBrief: true,
      });
    } catch (err) {
      set({
        briefBusy: false,
        briefPhase: "error",
        briefError: err instanceof Error ? err.message : String(err),
        briefLastOp: { kind: "submit", respuesta },
      });
    }
  },

  retryBrief: async () => {
    const op = get().briefLastOp;
    if (!op) return;
    set({ briefError: null, briefPhase: "idle" });
    if (op.kind === "create") {
      await get().startBriefInterview();
    } else if (op.kind === "resume") {
      await get().resumeBrief(op.ledgerPath);
    } else if (op.kind === "submit") {
      set({ briefAnswer: op.respuesta });
      await get().submitBriefAnswer();
    } else {
      await synthesizeBriefDoc(op.ledgerPath, set);
    }
  },

  goBackBrief: () => {
    const { briefHistory, briefBusy } = get();
    if (briefBusy || briefHistory.length === 0) return;
    const entry = briefHistory[briefHistory.length - 1];
    set({
      briefHistory: briefHistory.slice(0, -1),
      canGoBackBrief: briefHistory.length - 1 > 0,
      position: entry.position,
      briefAnswer: entry.respuesta,
    });
  },

  exitBrief: async () => {
    set({
      briefPhase: "idle",
      briefLedgerPath: null,
      position: null,
      briefAnswer: "",
      briefDone: null,
      briefHistory: [],
      canGoBackBrief: false,
      briefLastOp: null,
    });
    await get().refresh();
  },

  useDoneAsContext: async () => {
    const { repoPath, briefDone } = get();
    if (!repoPath || !briefDone) return;
    try {
      await window.termcanvas.interview.setActiveBrief(repoPath, briefDone.briefPath);
      useNotificationStore
        .getState()
        .notify("info", "Contexto activo: el entrevistador de requerimientos lo usará en cada pregunta.");
    } catch (err) {
      useNotificationStore
        .getState()
        .notify("error", err instanceof Error ? err.message : "Could not set the active brief.");
      return;
    }
    set({ briefPhase: "idle", briefDone: null, briefLedgerPath: null, position: null, briefAnswer: "" });
    await get().refresh();
    // El banner de la entrevista de requerimientos refleja el cambio ya.
    void useInterviewStore.getState().refreshBrief();
  },
}));

// Sintetiza el documento del brief (1 llamada) y pasa a done; si falla,
// deja la fase error con el retry apuntando a esta síntesis. Compartida por
// resumeBrief, submitBriefAnswer y retryBrief.
async function synthesizeBriefDoc(
  ledgerPath: string,
  set: (partial: Partial<RepoContextStore>) => void,
): Promise<void> {
  try {
    const { brief, briefPath } = await window.termcanvas.interview.briefSynthesize(ledgerPath);
    set({ briefPhase: "done", briefDone: { brief, briefPath }, briefBusy: false, briefLastOp: null });
    void useRepoContextStore.getState().refresh();
  } catch (err) {
    set({
      briefBusy: false,
      briefPhase: "error",
      briefError: err instanceof Error ? err.message : String(err),
      briefLastOp: { kind: "synthesize", ledgerPath },
    });
  }
}
