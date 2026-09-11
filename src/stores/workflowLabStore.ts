import { create } from "zustand";

/**
 * workflowLabStore — toggle de la vista Workflows (Fase 4c).
 * Persistido en localStorage bajo "workflow-lab-active".
 */

const STORAGE_KEY = "workflow-lab-active";

function loadActive(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistActive(active: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(active));
  } catch {}
}

interface WorkflowLabState {
  workflowLabActive: boolean;
  setWorkflowLabActive: (active: boolean) => void;
  toggleWorkflowLab: () => void;
}

export const useWorkflowLabStore = create<WorkflowLabState>((set, get) => ({
  workflowLabActive: typeof window !== "undefined" ? loadActive() : false,
  setWorkflowLabActive: (active: boolean) => {
    set({ workflowLabActive: active });
    persistActive(active);
  },
  toggleWorkflowLab: () => {
    const next = !get().workflowLabActive;
    set({ workflowLabActive: next });
    persistActive(next);
  },
}));
