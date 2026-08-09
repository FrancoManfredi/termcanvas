import { create } from "zustand";
import { useNotificationStore } from "./notificationStore";

// Archivo versionable dentro del repo: el contexto viaja con el código y
// vale para cualquier sesión futura (auditor, implementador, reviewer).
const REPO_CONTEXT_FILE = ".agents/repo-context.md";

interface RepoContextStore {
  open: boolean;
  repoPath: string | null;
  content: string;
  loading: boolean;
  openModal: (repoPath: string) => Promise<void>;
  closeModal: () => void;
  setContent: (content: string) => void;
  save: () => Promise<boolean>;
}

export const useRepoContextStore = create<RepoContextStore>((set, get) => ({
  open: false,
  repoPath: null,
  content: "",
  loading: false,

  // Carga el contexto existente (si hay) y abre el modal. Un repo nuevo
  // arranca con el textarea vacío: guardar crea el archivo por primera vez.
  openModal: async (repoPath) => {
    set({ open: true, repoPath, loading: true });
    let content = "";
    try {
      const result = await window.termcanvas.fs.readFile(
        `${repoPath.replace(/[\\/]+$/, "")}/${REPO_CONTEXT_FILE}`,
      );
      if (result && typeof result !== "string" && "content" in result) {
        content = result.content;
      }
    } catch {
      // Sin archivo todavía: es el caso esperado en la primera apertura.
    }
    set({ content, loading: false });
  },

  closeModal: () => set({ open: false }),

  setContent: (content) => set({ content }),

  save: async () => {
    const { repoPath, content } = get();
    if (!repoPath) return false;
    try {
      await window.termcanvas.fs.mkdir(repoPath, ".agents");
      await window.termcanvas.fs.writeFile(
        `${repoPath.replace(/[\\/]+$/, "")}/${REPO_CONTEXT_FILE}`,
        content.trim().length > 0 ? content : "# Repository context\n",
      );
      return true;
    } catch {
      useNotificationStore
        .getState()
        .notify("error", "Could not save repository context.");
      return false;
    }
  },
}));
