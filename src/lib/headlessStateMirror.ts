/**
 * src/lib/headlessStateMirror.ts — one-shot project mirror for web mode (F4).
 *
 * Without the Electron bridge there is no `state.load()`; instead we read
 * the headless daemon's `GET /state` once on startup and populate the
 * project store (read-only snapshot — flows keep the store fresh with the
 * daemon's own responses). Server-side terminals are dropped on purpose:
 * their ptyIds belong to another runtime and this session spawns its own
 * ptys over `/pty/stream`. Never throws — an unreachable daemon leaves the
 * honest-empty canvas and logs why.
 */
import type { ProjectData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { resolveHeadlessHttpUrl } from "./githubClient.ts";

interface DaemonStateProject {
  id: string;
  name: string;
  path: string;
  worktrees?: Array<{ id: string; name: string; path: string }>;
}

export async function mirrorHeadlessState(): Promise<
  { ok: true; projects: number } | { ok: false; error: string }
> {
  let data: unknown;
  try {
    const res = await fetch(`${resolveHeadlessHttpUrl()}/state`);
    if (!res.ok) {
      return { ok: false, error: `headless /state → ${res.status}` };
    }
    data = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[web] headless state mirror skipped: ${message}`);
    return { ok: false, error: message };
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: "headless /state: unexpected shape" };
  }
  const projects: ProjectData[] = (data as DaemonStateProject[]).map((p) => ({
    id: String(p.id),
    name: String(p.name),
    path: String(p.path),
    worktrees: (p.worktrees ?? []).map((w) => ({
      id: String(w.id),
      name: String(w.name),
      path: String(w.path),
      terminals: [],
    })),
  }));
  useProjectStore.getState().setProjects(projects);
  return { ok: true, projects: projects.length };
}
