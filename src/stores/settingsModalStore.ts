import { create } from "zustand";

type SettingsTab =
  | "general"
  | "appearance"
  | "features"
  | "agent"
  | "shortcuts"
  | "mcps"
  | "skills"
  // legacy alias — Integrations was renamed to MCPs, keep it so old callers still work
  | "integrations";

interface SettingsModalStore {
  open: boolean;
  initialTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
}

export type { SettingsTab };

function normalizeTab(tab: SettingsTab): SettingsTab {
  if (tab === "integrations") return "mcps";
  return tab;
}

export const useSettingsModalStore = create<SettingsModalStore>((set) => ({
  open: false,
  initialTab: "general",
  openSettings: (tab = "general") => set({ open: true, initialTab: normalizeTab(tab) }),
  closeSettings: () => set({ open: false }),
}));
