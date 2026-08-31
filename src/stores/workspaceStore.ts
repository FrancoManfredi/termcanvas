import { create } from "zustand";

interface WorkspaceStore {
  workspacePath: string | null;
  dirty: boolean;
  lastSavedAt: number | null;
  lastDirtyAt: number | null;
  setWorkspacePath: (path: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
}

export function hasPendingSnapshot(
  dirty: boolean,
  lastDirtyAt: number | null,
  lastSavedAt: number | null,
): boolean {
  return dirty && lastDirtyAt !== null && lastDirtyAt > (lastSavedAt ?? 0);
}

export function shouldRunAutoSaveBackstop({
  dirty,
  lastDirtyAt,
  lastSavedAt,
  now = Date.now(),
  intervalMs = 60_000,
}: {
  dirty: boolean;
  lastDirtyAt: number | null;
  lastSavedAt: number | null;
  now?: number;
  intervalMs?: number;
}): boolean {
  return (
    hasPendingSnapshot(dirty, lastDirtyAt, lastSavedAt) &&
    (!lastSavedAt || now - lastSavedAt > intervalMs)
  );
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspacePath: null,
  dirty: false,
  lastSavedAt: null,
  lastDirtyAt: null,
  setWorkspacePath: (path) => set({ workspacePath: path }),
  markDirty: () =>
    set({
      dirty: true,
      lastDirtyAt: Date.now(),
    }),
  markClean: () => set({ dirty: false, lastSavedAt: Date.now(), lastDirtyAt: null }),
}));
