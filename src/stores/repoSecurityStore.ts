import { create } from "zustand";
import { resolveActiveWorktree } from "../planner/planningSession";
import {
  launchSecuritySession,
  newestSecurityResult,
  type SecuritySessionHandle,
} from "../planner/securitySession";
import type {
  SecurityAudit,
  SecurityResult,
  SecuritySelections,
} from "../types/repoSecurity";

// Store del flujo de seguridad del repositorio (PLANNING → Diagnóstico):
// audit (estado actual por feature), checklist (selecciones del usuario),
// apply (sesión headless con logs en streaming) y resultado. Vive a nivel
// módulo: cerrar el modal NO cancela la corrida (mismo patrón que
// diagnosisStore).

interface RepoSecuritySessionRuntime {
  terminalId: string;
}

interface RepoSecurityStore {
  phase: "idle" | "auditing" | "checklist" | "running" | "done";
  audit: SecurityAudit | null;
  result: SecurityResult | null;
  resultPath: string | null;
  sessionRuntime: RepoSecuritySessionRuntime | null;
  error: string | null;
  selections: SecuritySelections;
  runAudit: (repoPath: string) => Promise<void>;
  toggleFeature: (id: string) => void;
  toggleSubOption: (featureId: string, optionId: string) => void;
  apply: (repoPath: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  dismissError: () => void;
}

let activeSession: SecuritySessionHandle | null = null;

// Selecciones por defecto: todo lo seleccionable marcado, sub-opciones con
// su defaultOn.
function defaultSelectionsFromAudit(audit: SecurityAudit): SecuritySelections {
  const selectable = audit.features.filter((f) => f.selectable);
  const subOptions: Record<string, string[]> = {};
  for (const f of selectable) {
    subOptions[f.id] = f.subOptions.filter((o) => o.defaultOn).map((o) => o.id);
  }
  return { features: selectable.map((f) => f.id), subOptions };
}

// Lee y parsea un security-result-<ts>.json (null si no es parseable).
async function readResultFile(resultPath: string): Promise<SecurityResult | null> {
  try {
    const res = await window.termcanvas.fs.readFile(resultPath);
    if ("error" in res) return null;
    return JSON.parse(res.content) as SecurityResult;
  } catch {
    return null;
  }
}

export const useRepoSecurityStore = create<RepoSecurityStore>((set, get) => ({
  phase: "idle",
  audit: null,
  result: null,
  resultPath: null,
  sessionRuntime: null,
  error: null,
  selections: { features: [], subOptions: {} },

  runAudit: async (repoPath) => {
    const phase = get().phase;
    if (phase === "auditing" || phase === "running") return;
    set({ phase: "auditing", error: null });
    const res = await window.termcanvas.github.securityAudit(repoPath);
    if (!res.ok) {
      set({ phase: "idle", error: res.error });
      return;
    }
    set({
      phase: "checklist",
      audit: res,
      result: null,
      resultPath: null,
      selections: defaultSelectionsFromAudit(res),
    });
  },

  toggleFeature: (id) => {
    const audit = get().audit;
    const feature = audit?.features.find((f) => f.id === id);
    if (!audit || !feature || !feature.selectable) return;
    set((state) => {
      const on = state.selections.features.includes(id);
      const features = on
        ? state.selections.features.filter((f) => f !== id)
        : [...state.selections.features, id];
      const subOptions = { ...state.selections.subOptions };
      if (on) {
        delete subOptions[id];
      } else {
        subOptions[id] = feature.subOptions.filter((o) => o.defaultOn).map((o) => o.id);
      }
      return { selections: { features, subOptions } };
    });
  },

  toggleSubOption: (featureId, optionId) => {
    set((state) => {
      const current = state.selections.subOptions[featureId] ?? [];
      const on = current.includes(optionId);
      return {
        selections: {
          ...state.selections,
          subOptions: {
            ...state.selections.subOptions,
            [featureId]: on ? current.filter((o) => o !== optionId) : [...current, optionId],
          },
        },
      };
    });
  },

  apply: async (repoPath) => {
    const state = get();
    if (state.phase !== "checklist" || !state.audit) return;
    if (state.selections.features.length === 0) return;

    const active = resolveActiveWorktree();
    if (!active) {
      set({ error: "No hay proyecto activo para correr la configuración." });
      return;
    }

    const outDir = `${repoPath.replace(/[\\/]+$/, "")}/.agents/planning`;

    set({ phase: "running", result: null, resultPath: null, error: null, sessionRuntime: null });

    const handle = await launchSecuritySession({
      repoPath,
      projectId: active.projectId,
      worktreeId: active.worktreeId,
      selectionsJson: JSON.stringify(state.selections),
      outDir,
      onReady: (resultPath) => {
        void (async () => {
          const result = await readResultFile(resultPath);
          if (result) set({ result, resultPath });
        })();
      },
      onExited: (exitCode) => {
        if (exitCode !== 0) {
          activeSession?.stop();
          activeSession = null;
          set({ phase: "idle", sessionRuntime: null });
          return;
        }
        void (async () => {
          // El result puede haber llegado justo después de onReady: si aún
          // no está, se relee el más reciente antes de pasar a done.
          let { result, resultPath } = get();
          if (!result) {
            const found = resultPath ?? (await newestSecurityResult(outDir));
            if (found) {
              const parsed = await readResultFile(found);
              if (parsed) {
                result = parsed;
                resultPath = found;
              }
            }
          }
          activeSession?.stop();
          activeSession = null;
          set({ phase: "done", sessionRuntime: null, result, resultPath });
        })();
      },
      onError: (message) => {
        activeSession?.stop();
        activeSession = null;
        set({ phase: "idle", sessionRuntime: null, error: message });
      },
    });

    if (!handle) {
      set({ phase: "idle" });
      return;
    }
    activeSession = handle;
    set({ sessionRuntime: { terminalId: handle.terminalId } });
  },

  cancel: () => {
    activeSession?.stop();
    activeSession = null;
    set({ phase: "idle", sessionRuntime: null });
  },

  reset: () => {
    activeSession?.stop();
    activeSession = null;
    set({
      phase: "idle",
      audit: null,
      result: null,
      resultPath: null,
      sessionRuntime: null,
      error: null,
      selections: { features: [], subOptions: {} },
    });
  },

  dismissError: () => set({ error: null }),
}));
