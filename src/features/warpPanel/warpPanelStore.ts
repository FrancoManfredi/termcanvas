import { create } from "zustand";

/**
 * warpPanelStore — canvas/panel visibility toggle for WarpPanel.
 * Mirrors the factoryLabStore precedent (localStorage persistence).
 * Colocated in the feature per DESIGN-warppanel §1.2 ("20-line zustand store
 * next to it"). Shared by Toolbar (toggle button) and src/App.tsx (mount
 * branch). Track B touches nothing here.
 */

const STORAGE_KEY = "warp-panel-active";

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

interface WarpPanelState {
  warpPanelActive: boolean;
  setWarpPanelActive: (active: boolean) => void;
  toggleWarpPanel: () => void;
}

export const useWarpPanelStore = create<WarpPanelState>((set, get) => ({
  warpPanelActive: typeof window !== "undefined" ? loadActive() : false,
  setWarpPanelActive: (active: boolean) => {
    set({ warpPanelActive: active });
    persistActive(active);
  },
  toggleWarpPanel: () => {
    const next = !get().warpPanelActive;
    set({ warpPanelActive: next });
    persistActive(next);
  },
}));
