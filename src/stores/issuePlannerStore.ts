import { create } from "zustand";
import type {
  AuditPlan,
  PlannerMode,
  PlanningResult,
  RoadmapPlan,
} from "../types/issuePlanning.ts";
import { isAuditPlan, isRoadmapPlan } from "../types/issuePlanning.ts";
import {
  launchPlanningSessionForActiveWorktree,
  resolveActiveWorktree,
  type PlanningSessionHandle,
} from "../planner/planningSession.ts";
import {
  clearPlannerResults,
  loadPlannerResults,
  savePlannerResults,
} from "../planner/plannerResultsPersistence.ts";
import { buildIssueTemplateBody, buildFindingIssueBody } from "../planner/issueTemplate.ts";
import { useNotificationStore } from "./notificationStore.ts";

// Estado de la pantalla de Planificación. La sesión de opencode corre en
// un PTY headless (sin tile en la escena) y escribe
// <repo>/.agents/planning/plan-*.json; el store espera ese archivo y pasa
// a "results" cuando aparece. Los MOCK_* solo se usan en el entorno de
// tests (sin window), donde no hay sesión real que lanzar ni disco que poll.
//
// La simulación temporal (running/creating) vive en el store y no en los
// componentes: aunque el modal se cierre y se desmonte, los timers siguen
// avanzando el estado y al reabrir la pantalla se muestra el progreso real.
// En el entorno de tests (sin window) la sesión real queda fuera de
// servicio porque startSession se invoca manualmente.

export type PlannerPhase =
  | "idle"
  | "running"
  | "results"
  | "creating"
  | "summary";

export interface CreateProgress {
  index: number;
  state: "pending" | "creating" | "done" | "error";
  url?: string;
  // Número real que GitHub asignó al issue creado (NO el índice local del
  // plan): se usa para resolver las relaciones entre issues al final.
  number?: number;
}// Runtime headless de opencode que la sesión corriendo creó; el modal lo
// atachea a su panel derecho (único renderer del runtime, no hay tile en
// la escena).
export interface SessionRuntimeRef {
  terminalId: string;
  outputPath: string;
}

export const MOCK_ROADMAP: RoadmapPlan = {
  mode: "roadmap",
  repo: "acme/termcanvas",
  proposals: [
    {
      title: "Agregar vista de calendario por milestone",
      body: "Listar issues agrupados por milestone en un calendario navegable por mes...",
      labels: ["feature", "ui"],
      status: "Todo",
      priority: "P1",
      size: "L",
      blockedBy: [],
      blocking: [1],
    },
    {
      title: "Persistir el estado colapsado de la barra lateral",
      body: "Guardar el ancho y la visibilidad del panel en localStorage...",
      labels: ["improvement", "persistencia"],
      status: "Todo",
      priority: "P2",
      size: "S",
      parent: 0,
      blockedBy: [],
      blocking: [],
      related: [2],
    },
    {
      title: "Migrar las consultas de issues a query keys tipadas",
      body: "Centralizar las claves de cache para invalidar de forma predecible...",
      labels: ["refactor", "infra"],
      status: "Todo",
      priority: "P3",
      size: "M",
      parent: undefined,
      blockedBy: [1],
      blocking: [],
    },
    {
      title: "Paginación por cursor en la lista de issues",
      body: "Reemplazar fetch de una sola página por paginación con cursor...",
      labels: ["perf"],
      status: "In Progress",
      priority: "P0",
      size: "XL",
      parent: undefined,
      blockedBy: [],
      blocking: [2, 3],
    },
  ],
};

export const MOCK_AUDIT: AuditPlan = {
  mode: "audit",
  repo: "acidad/termcanvas",
  findings: [
    {
      title: "API token expuesto en el bundle del cliente",
      severity: "critical",
      file: "src/lib/apiClient.ts",
      line: 27,
      description:
        "El token de GitHub se inyecta en las variables de entorno públicas del renderer; cualquiera que abre el bundle lo extrae.",
    },
    {
      title: "Llamadas a la API sin timeout ni retry",
      severity: "high",
      file: "src/stores/issuesStore.ts",
      line: 88,
      description:
        "Un throttle de GitHub deja la pantalla en loading infinito; no hay reintentos con backoff.",
    },
    {
      title: "Fuga de memoria en el watcher del repo",
      severity: "medium",
      file: "src/stores/repoWatcher.ts",
      line: 41,
      description:
        "El listener de fs.watch nunca se cierra al destruir el store; las pestañas se acumulan.",
    },
    {
      title: "Comentarios fuera de norma en el handler de atajos",
      severity: "low",
      file: "src/stores/shortcutsStore.ts",
      line: 52,
      description:
        "Algunos comentarios describen el 'qué' en vez del 'porqué', dificultando el mantenimiento.",
    },
  ],
};

export interface RoadmapFile {
  name: string;
  content: string;
}

// Duración de la simulación de creación de issues por paso: se aplica en
// tests (sin window) porque no hay GitHub al que llamar.
const CREATE_STEP_MS = 700;

// Handles de timers a nivel módulo: se limpia cualquier reset para no
// dejar una corrida zombie colgada si el usuario descarta a media simulación.
let createTimerId: ReturnType<typeof setTimeout> | null = null;
// Sesión real de opencode en curso: su polling se detiene al resetear.
let activeSession: PlanningSessionHandle | null = null;

function clearBackgroundTimers() {
  if (createTimerId !== null) {
    clearTimeout(createTimerId);
    createTimerId = null;
  }
  activeSession?.stop();
  activeSession = null;
}

// Descarta el resultado persistido del repo activo (reset explícito del
// usuario o confirmación de descarte). Fire-and-forget: si el archivo no
// existe, clearPlannerResults ya lo tolera.
function clearSavedResults() {
  if (typeof window === "undefined") return;
  const worktree = resolveActiveWorktree();
  if (worktree) {
    void clearPlannerResults(worktree.path).catch((error) =>
      console.warn(
        "[planner] no se pudo descartar el resultado persistido:",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

/**
 * Crea los issues seleccionados contra GitHub REAL, uno por uno, y al
 * terminar resuelve las relaciones entre ellos.
 *
 * El plan usa índices locales (0-based del array); GitHub asigna sus
 * propios números al crear. El mapeo índice → número real queda en
 * createProgress[].number, y las relaciones (blockedBy/blocking/related/
 * parent) se cierran al final con un comentario por issue que usa los
 * números REALES de GitHub, no los del plan.
 */
async function runRealCreate(initial: IssuePlannerState) {
  const { result, createProgress } = initial;
  if (!result) return;
  const worktree = resolveActiveWorktree();
  const cwd = worktree?.path ?? "";
  const repoUrl = `https://github.com/${result.repo}`;
  // Seleccionados en el orden en que el usuario los marcó.
  const indices = createProgress.map((p) => p.index);
  // índice del plan → número real de GitHub.
  const realNumbers = new Map<number, number>();

  for (let position = 0; position < indices.length; position += 1) {
    const index = indices[position];
    const store = useIssuePlannerStore.getState();
    if (store.phase !== "creating") return; // el usuario canceló/reseteó
    store.markCreating(position);
    const body = buildIssueBody(result, index, repoUrl);
    const created = await window.termcanvas.github.createIssue(
      cwd,
      result.mode === "roadmap"
        ? result.proposals[index].title
        : result.findings[index].title,
      body,
      result.mode === "roadmap"
        ? result.proposals[index].labels
        : (result.findings[index].labels ?? []),
    );
    if (!created.ok) {
      useNotificationStore.getState().notify(
        "error",
        `No se pudo crear "${result.mode === "roadmap" ? result.proposals[index].title : result.findings[index].title}": ${created.error}`,
      );
      // Vuelve a resultados con el item fallido marcado: el usuario puede
      // reintentar (los done no se vuelven a crear) o quitar la selección.
      useIssuePlannerStore.setState((state) => ({
        phase: "results",
        createProgress: state.createProgress.map((p, idx) =>
          idx === position ? { ...p, state: "error" } : p,
        ),
      }));
      return;
    }
    realNumbers.set(index, created.number);
    useIssuePlannerStore
      .getState()
      .markCreated(position, created.url, created.number);
    // Project v2 best-effort: si el repo tiene project-config.json, el issue
    // se integra al proyecto y se rellenan sus fields. Nunca bloquea la
    // corrida ni reintenta: un fallo de config no debe costar un issue.
    void window.termcanvas.github.addToProject(cwd, created.url).then(
      (assigned) => {
        if (!assigned.ok) {
          useNotificationStore.getState().notify(
            "error",
            `Issue #${created.number} creado, pero el Project v2 no se actualizó: ${assigned.error}`,
          );
        }
      },
      (error) => {
        console.warn("[planner] addToProject:", error);
      },
    );
  }
  if (useIssuePlannerStore.getState().phase !== "creating") return;

  // Relaciones con números reales: un comentario por issue que declara
  // dependencias, referenciando los números que GitHub asignó.
  if (isRoadmapPlan(result)) {
    for (const [index, number] of realNumbers) {
      const proposal = result.proposals[index];
      const relations: string[] = [];
      for (const blocked of proposal.blockedBy) {
        const real = realNumbers.get(blocked);
        if (real !== undefined) {
          relations.push(`⛔ Bloqueado por #${real} (${result.proposals[blocked]?.title ?? "?"})`);
        }
      }
      for (const blocks of proposal.blocking) {
        const real = realNumbers.get(blocks);
        if (real !== undefined) {
          relations.push(`🔒 Bloquea a #${real} (${result.proposals[blocks]?.title ?? "?"})`);
        }
      }
      if (proposal.parent !== undefined) {
        const real = realNumbers.get(proposal.parent);
        if (real !== undefined) {
          relations.push(`📁 Hijo de #${real} (${result.proposals[proposal.parent]?.title ?? "?"})`);
        }
      }
      for (const related of proposal.related ?? []) {
        const real = realNumbers.get(related);
        if (real !== undefined) {
          relations.push(`∥ Relacionado con #${real} (${result.proposals[related]?.title ?? "?"})`);
        }
      }
      if (relations.length > 0) {
        await window.termcanvas.github.addComment(cwd, number, relations.join("\n"));
      }
    }
  }
  if (useIssuePlannerStore.getState().phase === "creating") {
    useIssuePlannerStore.getState().finishCreateAll();
  }
}

function buildIssueBody(
  result: PlanningResult,
  index: number,
  repoUrl: string,
): string {
  if (isRoadmapPlan(result)) {
    const proposal = result.proposals[index];
    return proposal.template
      ? buildIssueTemplateBody(proposal.body, proposal.template, repoUrl)
      : proposal.body;
  }
  if (isAuditPlan(result)) {
    const finding = result.findings[index];
    return buildFindingIssueBody(finding, repoUrl);
  }
  return "";
}

interface IssuePlannerState {
  mode: PlannerMode;
  roadmapText: string;
  roadmapFiles: RoadmapFile[];
  phase: PlannerPhase;
  result: PlanningResult | null;
  selected: number[];
  createProgress: CreateProgress[];
  // Último número de issue/PR que GitHub asignó en el repo activo: permite
  // previsualizar los números reales del plan (#n+1, #n+2, …) en vez de los
  // índices locales (#1, #2, …). null = no se pudo resolver (sin remote,
  // sin gh) y se muestra el índice local como antes.
  nextIssueNumber: number | null;
  startedAt: number | null;
  detailIndex: number | null;
  confirmDiscard: boolean;
  sessionRuntime: SessionRuntimeRef | null;
  setMode: (mode: PlannerMode) => void;
  setRoadmapText: (text: string) => void;
  addRoadmapFile: (file: RoadmapFile) => void;
  removeRoadmapFile: (index: number) => void;
  startSession: () => void;
  askDiscard: () => void;
  finishSession: (result?: PlanningResult) => void;
  restoreSavedResults: () => Promise<void>;
  refreshNextIssueNumber: () => Promise<void>;
  cancelSession: () => void;
  toggleSelect: (index: number) => void;
  multiSelect: (indices: number[]) => void;
  startCreate: () => void;
  markCreating: (index: number) => void;
  markCreated: (position: number, url: string, number?: number) => void;
  finishCreateAll: () => void;
  // Vuelve a la fase de selección tras crear algunos issues: el plan y los
  // ya creados (createProgress con state done) se conservan, para que el
  // usuario pueda marcar más propuestas y crear el resto sin re-auditar.
  backToResults: () => void;
  resetAll: () => void;
  confirmDiscardChoice: (discard: boolean) => void;
  openDetail: (index: number) => void;
  closeDetail: () => void;
}

export const useIssuePlannerStore = create<IssuePlannerState>((set, get) => ({
  mode: "roadmap",
  roadmapText: "",
  roadmapFiles: [],
  phase: "idle",
  result: null,
  createProgress: [],
  selected: [],
  nextIssueNumber: null,
  startedAt: null,
  detailIndex: null,
  confirmDiscard: false,
  sessionRuntime: null,

  setMode: (mode) => {
    const { phase, result, selected } = get();
    const hasPendingResult =
      phase === "results" || phase === "creating" || phase === "summary";
    if (hasPendingResult && (result || selected.length > 0)) {
      set({ confirmDiscard: true });
      return;
    }
    clearBackgroundTimers();
    set({
      mode,
      phase: "idle",
      result: null,
      selected: [],
      createProgress: [],
      roadmapText: "",
      roadmapFiles: mode === "roadmap" ? get().roadmapFiles : [],
    });
  },

  setRoadmapText: (text) => set({ roadmapText: text }),

  addRoadmapFile: (file) =>
    set((state) => ({
      roadmapFiles: [...state.roadmapFiles, file],
    })),

  removeRoadmapFile: (index) =>
    set((state) => ({
      roadmapFiles: state.roadmapFiles.filter((_, i) => i !== index),
    })),

  startSession: async () => {
    const { mode, roadmapText, roadmapFiles } = get();
    if (mode === "roadmap" && roadmapText.trim().length === 0 && roadmapFiles.length === 0)
      return;
    set({ phase: "running", startedAt: Date.now() });
    // En el entorno de tests no hay window: la corrida se avanza a mano.
    if (typeof window === "undefined") return;
    clearBackgroundTimers();
    // Sesión real: runtime de opencode en el worktree activo + espera del
    // plan JSON en disco. Sin proyecto en la escena, el launch ya notificó
    // el error y no hay nada que simular.
    const session = await launchPlanningSessionForActiveWorktree({
      mode,
      roadmapText,
      attachmentNames: roadmapFiles.map((file) => file.name),
      onResult: (result, warnings) => {
        activeSession = null;
        for (const warning of warnings) console.warn("[planner]", warning);
        get().finishSession(result);
      },
      onError: (message) => {
        activeSession = null;
        useNotificationStore.getState().notify("error", message);
        set({ phase: "idle", startedAt: null, sessionRuntime: null });
      },
    });
    if (!session) {
      set({ phase: "idle", startedAt: null });
      return;
    }
    activeSession = session;
    // El modal atachea el renderer del runtime headless mientras corre.
    set({
      sessionRuntime: {
        terminalId: session.terminalId,
        outputPath: session.outputPath,
      },
    });
  },

  askDiscard: () => set({ confirmDiscard: true }),

  finishSession: (result?: PlanningResult) => {
    const { mode } = get();
    const fallback = mode === "roadmap" ? MOCK_ROADMAP : MOCK_AUDIT;
    const finalResult = result ?? fallback;
    set({
      phase: "results",
      result: finalResult,
      selected: [],
      createProgress: [],
      startedAt: null,
      sessionRuntime: null,
    });
    // La sesión real escribió un plan: se guarda en el repo para que el
    // resultado sobreviva al cierre de la app (se restaura al reabrir el
    // modal). Los mocks de los tests (sin window) no se persisten.
    if (result && typeof window !== "undefined") {
      const worktree = resolveActiveWorktree();
      if (worktree) {
        void savePlannerResults(worktree.path, result).catch((error) =>
          console.warn(
            "[planner] no se pudo persistir el resultado:",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }
    void get().refreshNextIssueNumber();
  },

  // Restaura el último resultado guardado del repo activo. Solo aplica si
  // el store está limpio (idle y sin resultado): una corrida en curso o un
  // resultado en memoria tienen prioridad sobre lo que haya en disco.
  restoreSavedResults: async () => {
    const { phase, result } = get();
    if (phase !== "idle" || result) return;
    if (typeof window === "undefined") return;
    const worktree = resolveActiveWorktree();
    if (!worktree) return;
    const saved = await loadPlannerResults(worktree.path).catch(() => null);
    if (!saved) return;
    set({
      phase: "results",
      mode: saved.mode,
      result: saved,
      selected: [],
      createProgress: [],
      startedAt: null,
      sessionRuntime: null,
    });
    void get().refreshNextIssueNumber();
  },

  // Consulta el último número asignado por GitHub en el repo activo para
  // proyectar los números del plan. Best-effort: sin remote/gh, o si falla,
  // queda null y la UI muestra los índices locales como antes.
  refreshNextIssueNumber: async () => {
    if (
      typeof window === "undefined" ||
      !window.termcanvas?.github?.lastIssueNumber
    ) {
      return;
    }
    const worktree = resolveActiveWorktree();
    if (!worktree) return;
    const number = await window.termcanvas.github
      .lastIssueNumber(worktree.path)
      .catch(() => null);
    set({ nextIssueNumber: number });
  },

  cancelSession: () => {
    clearBackgroundTimers();
    set({ phase: "idle", startedAt: null, sessionRuntime: null });
  },

  toggleSelect: (index) => {
    const { selected } = get();
    set({
      selected: selected.includes(index)
        ? selected.filter((i) => i !== index)
        : [...selected, index],
    });
  },

  multiSelect: (indices) => set({ selected: indices }),

  startCreate: () => {
    const { selected, result, createProgress } = get();
    if (selected.length === 0 || !result) return;
    // Reintento tras un fallo parcial: los issues ya creados (done) no se
    // vuelven a crear aunque sigan seleccionados.
    const alreadyCreated = new Set(
      createProgress.filter((p) => p.state === "done").map((p) => p.index),
    );
    const pending = selected.filter((index) => !alreadyCreated.has(index));
    if (pending.length === 0) return;
    set({
      phase: "creating",
      createProgress: pending.map((index) => ({ index, state: "pending" })),
    });
    // En el entorno de tests no hay GitHub que llamar: la simulación se
    // avanza a mano (markCreating/markCreated) como antes.
    if (typeof window === "undefined" || !window.termcanvas?.github?.createIssue) {
      return;
    }
    void runRealCreate(get());
  },

  markCreating: (position: number) =>
    set((state) => ({
      createProgress: state.createProgress.map((p, idx) =>
        idx === position ? { ...p, state: "creating" } : p,
      ),
    })),

  markCreated: (position: number, url: string, number?: number) =>
    set((state) => ({
      createProgress: state.createProgress.map((p, idx) =>
        idx === position ? { ...p, state: "done", url, ...(number !== undefined ? { number } : {}) } : p,
      ),
    })),

  finishCreateAll: () => set({ phase: "summary" }),

  backToResults: () => set({ phase: "results" }),

  resetAll: () => {
    clearBackgroundTimers();
    clearSavedResults();
    set({
      phase: "idle",
      result: null,
      selected: [],
      createProgress: [],
      roadmapText: "",
      roadmapFiles: [],
      startedAt: null,
      detailIndex: null,
      sessionRuntime: null,
    });
  },

  confirmDiscardChoice: (discard) => {
    clearBackgroundTimers();
    set((state) =>
      discard
        ? {
            confirmDiscard: false,
            phase: "idle",
            result: null,
            selected: [],
            createProgress: [],
            startedAt: null,
            detailIndex: null,
            sessionRuntime: null,
          }
        : { confirmDiscard: false },
    );
    if (discard) clearSavedResults();
  },

  openDetail: (index) => set({ detailIndex: index }),

  closeDetail: () => set({ detailIndex: null }),
}));