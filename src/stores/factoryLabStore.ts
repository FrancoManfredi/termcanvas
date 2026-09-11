import { create } from "zustand";

/**
 * factoryLabStore — toggle minimal Factory Lab (MVP).
 * Persistido en localStorage bajo "factory-lab-active".
 * Reemplaza a playgroundPactStore (borrado en MVP).
 */

const STORAGE_KEY = "factory-lab-active";

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

interface FactoryLabState {
  factoryLabActive: boolean;
  setFactoryLabActive: (active: boolean) => void;
  toggleFactoryLab: () => void;
}

export const useFactoryLabStore = create<FactoryLabState>((set, get) => ({
  factoryLabActive: typeof window !== "undefined" ? loadActive() : false,
  setFactoryLabActive: (active: boolean) => {
    set({ factoryLabActive: active });
    persistActive(active);
  },
  toggleFactoryLab: () => {
    const next = !get().factoryLabActive;
    set({ factoryLabActive: next });
    persistActive(next);
  },
}));
