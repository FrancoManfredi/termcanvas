import { create } from "zustand";
import type { ComposerImageAttachment } from "../types";

export type ComposerMode = "compose" | "renameTerminalTitle";

interface ComposerStore {
  draft: string;
  images: ComposerImageAttachment[];
  isSubmitting: boolean;
  error: string | null;
  mode: ComposerMode;
  renameTerminalId: string | null;
  composeSnapshot?: ComposerSnapshot;
  setDraft: (draft: string) => void;
  addImages: (images: ComposerImageAttachment[]) => void;
  removeImage: (imageId: string) => void;
  clearImages: () => void;
  clear: () => void;
  setSubmitting: (isSubmitting: boolean) => void;
  setError: (error: string | null) => void;
  enterRenameTerminalTitleMode: (
    terminalId: string,
    initialValue: string,
  ) => void;
  exitRenameTerminalTitleMode: () => void;
}

type ComposerSnapshot = {
  draft: string;
  images: ComposerImageAttachment[];
  error: string | null;
};

export const useComposerStore = create<ComposerStore>((set) => ({
  draft: "",
  images: [],
  isSubmitting: false,
  error: null,
  mode: "compose",
  renameTerminalId: null,

  setDraft: (draft) => set({ draft }),
  addImages: (images) =>
    set((state) => ({
      images: [...state.images, ...images],
      error: null,
    })),
  removeImage: (imageId) =>
    set((state) => ({
      images: state.images.filter((image) => image.id !== imageId),
    })),
  clearImages: () => set({ images: [] }),
  clear: () =>
    set({
      draft: "",
      images: [],
      error: null,
      isSubmitting: false,
      mode: "compose",
      renameTerminalId: null,
      composeSnapshot: undefined,
    }),
  setSubmitting: (isSubmitting) => set({ isSubmitting }),
  setError: (error) => set({ error }),
  enterRenameTerminalTitleMode: (terminalId, initialValue) =>
    set((state) => {
      const snapshot: ComposerSnapshot =
        state.mode === "renameTerminalTitle" && state.composeSnapshot
          ? state.composeSnapshot
          : {
              draft: state.draft,
              images: state.images,
              error: state.error,
            };

      return {
        draft: initialValue,
        images: [],
        error: null,
        mode: "renameTerminalTitle",
        renameTerminalId: terminalId,
        composeSnapshot: snapshot,
      };
    }),
  exitRenameTerminalTitleMode: () =>
    set((state) => {
      if (state.mode !== "renameTerminalTitle") {
        return state;
      }
      const snapshot = state.composeSnapshot ?? {
        draft: "",
        images: [],
        error: null,
      };

      return {
        draft: snapshot.draft,
        images: snapshot.images,
        error: snapshot.error,
        mode: "compose",
        renameTerminalId: null,
        composeSnapshot: undefined,
      };
    }),
}));
