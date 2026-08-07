import { create } from "zustand";

// Acciones que el usuario disparó desde la card del issue (no las trae
// GitHub: son el historial local de la app).
export type IssueActivityType = "resolve" | "review" | "fix" | "merge";

export interface IssueActivityEntry {
  type: IssueActivityType;
  at: number; // epoch ms
}

type ActivityMap = Record<number, IssueActivityEntry[]>;

// Vivo dentro del repo (versionable) para que viaje entre PCs que comparten
// el mismo repo; NO en localStorage, que es por-máquina.
const ACTIVITY_FILE = ".agents/activity.json";
// Cota por issue: la card solo muestra las últimas, el resto es ruido.
const MAX_ENTRIES_PER_ISSUE = 10;

function entryKey(e: IssueActivityEntry): string {
  return `${e.type}:${e.at}`;
}

interface IssueActivityStore {
  // Clave: ruta del worktree/repo del issue. Un mismo número de issue puede
  // existir en varios repos, así que el historial se separa por repositorio.
  activityByRepo: Record<string, ActivityMap>;
  loadActivity: (repoPath: string) => Promise<void>;
  recordActivity: (
    repoPath: string,
    issueNumber: number,
    type: IssueActivityType,
  ) => void;
}

function activityFilePath(repoPath: string): string {
  return `${repoPath.replace(/[\\/]+$/, "")}/${ACTIVITY_FILE}`;
}

export const useIssueActivityStore = create<IssueActivityStore>((set, get) => ({
  activityByRepo: {},

  // Lee el archivo del repo y fusiona lo que el store no conoce todavía.
  // Es la fuente de verdad para "abrí termcanvas en otra PC": cuando el repo
  // comparte el archivo, la card recupera el historial del otro lado.
  loadActivity: async (repoPath) => {
    if (!repoPath) return;
    const current = get().activityByRepo;
    if (current[repoPath]) return; // ya cargado en esta sesión
    const result = await window.termcanvas.fs.readFile(activityFilePath(repoPath));
    if (!result || typeof result === "string" || "error" in result) return;
    if (result.type !== "text" && result.type !== "markdown") return;
    let parsed: { issues?: Record<string, IssueActivityEntry[]> };
    try {
      parsed = JSON.parse(result.content) as { issues?: Record<string, IssueActivityEntry[]> };
    } catch {
      return; // archivo corrupto o pre-v1 — lo ignoramos por ahora
    }
    if (!parsed.issues) return;
    const quota: ActivityMap = {};
    for (const [issue, entries] of Object.entries(parsed.issues)) {
      const n = Number(issue);
      if (!Number.isFinite(n)) continue;
      const cleaned = (entries ?? []).filter(
        (e) =>
          e &&
          typeof e.at === "number" &&
          typeof e.type === "string",
      );
      if (cleaned.length > 0) quota[n] = cleaned.slice(-MAX_ENTRIES_PER_ISSUE);
    }
    set({ activityByRepo: { ...get().activityByRepo, [repoPath]: quota } });
  },

  recordActivity: (repoPath, issueNumber, type) => {
    if (!repoPath) return;
    const entry: IssueActivityEntry = { type, at: Date.now() };
    const repoMap = get().activityByRepo[repoPath];
    const current = (repoMap ?? {})[issueNumber] ?? [];
    // Orden cronológico ascendente: la última actividad queda al final.
    const nextForIssue = [...current, entry]
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_ENTRIES_PER_ISSUE);
    const nextRepoMap = { ...(repoMap ?? {}), [issueNumber]: nextForIssue };
    set({
      activityByRepo: { ...get().activityByRepo, [repoPath]: nextRepoMap },
    });
    void persistActivity(repoPath, nextRepoMap);
  },
}));

async function persistActivity(
  repoPath: string,
  repoMap: ActivityMap,
): Promise<void> {
  try {
    await window.termcanvas.fs.mkdir(repoPath, ".agents");
  } catch {
    // El directorio ya existe (`.agents` es común) — la escritura de abajo
    // reportará un error real si el path completo sigue sin valer.
  }
  try {
    const issues: Record<string, IssueActivityEntry[]> = {};
    for (const [issue, entries] of Object.entries(repoMap)) {
      issues[issue] = entries.slice(-MAX_ENTRIES_PER_ISSUE);
    }
    const content = JSON.stringify({ version: 1, issues }, null, 2);
    await window.termcanvas.fs.writeFile(activityFilePath(repoPath), content);
  } catch (error) {
    console.warn(
      "[issue-activity] no se pudo persistir la actividad:",
      error instanceof Error ? error.message : String(error),
    );
  }
}