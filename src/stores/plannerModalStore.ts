import { create } from "zustand";
import { useIssuePlannerStore } from "./issuePlannerStore.ts";

// Compartido entre el botón de la toolbar y el modal de planificación:
// el botón abre/cierra y el modal necesita saber si está visible. Al
// abrir, se intenta restaurar el último resultado guardado del repo
// activo (ver restoreSavedResults): si el usuario cerró la app con una
// auditoría terminada, los hallazgos vuelven a aparecer hasta que corra
// una revisión nueva o los descarte.
interface PlannerModalStore {
  open: boolean;
  openPlanner: () => void;
  closePlanner: () => void;
  togglePlanner: () => void;
}

export const usePlannerModalStore = create<PlannerModalStore>((set) => ({
  open: false,
  openPlanner: () => {
    set({ open: true });
    void useIssuePlannerStore.getState().restoreSavedResults();
  },
  closePlanner: () => set({ open: false }),
  togglePlanner: () => {
    const willOpen = !usePlannerModalStore.getState().open;
    set({ open: willOpen });
    if (willOpen) void useIssuePlannerStore.getState().restoreSavedResults();
  },
}));