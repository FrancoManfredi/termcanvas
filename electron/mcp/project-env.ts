import path from "node:path";
import type { McpManager } from "./manager.ts";

const projectPathById = new Map<string, string>();
const projectIdByPath = new Map<string, string>();

export function registerMcpProject(projectId: string, projectPath: string): void {
  if (!projectId || !projectPath) return;
  const normPath = path.resolve(projectPath);
  projectPathById.set(projectId, normPath);
  projectIdByPath.set(normPath.toLowerCase(), projectId);
}

export function findProjectIdForCwd(cwd: string): string | null {
  if (!cwd) return null;
  const normCwd = path.resolve(cwd).toLowerCase();
  // Exact match or prefix with separator
  for (const [projectId, projectPath] of projectPathById.entries()) {
    const normProj = path.resolve(projectPath).toLowerCase();
    if (normCwd === normProj || normCwd.startsWith(normProj + path.sep.toLowerCase())) {
      return projectId;
    }
  }
  // Fallback: check if cwd is inside any worktree path that is inside project
  // For now, we only have main project paths, but worktrees are inside main, so prefix check covers it.
  return null;
}

export async function getMcpEnvForCwd(cwd: string, manager: McpManager): Promise<Record<string, string>> {
  const projectId = findProjectIdForCwd(cwd);
  if (!projectId) return {};
  const env: Record<string, string> = {};
  try {
    const cfg = manager.getRawConfig(projectId);
    const custom = cfg.customServers ?? [];
    // Import helpers to resolve catalog including customs
    const { getCatalogEntry } = await import("../../shared/mcp.ts");
    for (const s of cfg.servers) {
      if (!s.enabled) continue;
      const token = await manager.getSecret(projectId, s.id as any);
      if (!token) {
        continue;
      }
      const catalog = getCatalogEntry(s.id, custom);
      const envVar = catalog?.auth?.envVar;
      if (envVar) {
        env[envVar] = token;
      }
    }
  } catch {}
  return env;
}

export function getRegisteredProjects(): Array<{ id: string; path: string }> {
  return [...projectPathById.entries()].map(([id, p]) => ({ id, path: p }));
}
