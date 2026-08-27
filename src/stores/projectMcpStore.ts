import { create } from "zustand";
import type { ProjectMcpStatus, McpServerId } from "../../shared/mcp.ts";

interface ProjectMcpStore {
  byProject: Record<string, ProjectMcpStatus>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;

  refresh: (projectId: string, projectPath: string) => Promise<void>;
  setEnabled: (projectId: string, projectPath: string, serverId: McpServerId, enabled: boolean) => Promise<void>;
  setSecret: (projectId: string, projectPath: string, serverId: McpServerId, token: string | null) => Promise<void>;
  connect: (projectId: string, projectPath: string, serverId: McpServerId) => Promise<void>;
}

export const useProjectMcpStore = create<ProjectMcpStore>((set, get) => ({
  byProject: {},
  loading: {},
  error: {},

  refresh: async (projectId, projectPath) => {
    set((s) => ({ loading: { ...s.loading, [projectId]: true }, error: { ...s.error, [projectId]: null } }));
    try {
      const res = await window.termcanvas.mcp.status(projectId, projectPath);
      if (!res.ok) throw new Error(res.error);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: res.result } }));
    } catch (e) {
      set((s) => ({ error: { ...s.error, [projectId]: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [projectId]: false } }));
    }
  },

  setEnabled: async (projectId, projectPath, serverId, enabled) => {
    set((s) => ({ loading: { ...s.loading, [projectId]: true } }));
    // Optimistic update: mantener toggle activo sin esperar al refresh (incluso si aún no hay status)
    const prev = get().byProject[projectId];
    if (prev) {
      const optimistic = {
        ...prev,
        servers: prev.servers.map((s) => (s.catalog.id === serverId ? { ...s, config: { ...s.config, enabled, updatedAt: Date.now() } } : s)),
      };
      set((s) => ({ byProject: { ...s.byProject, [projectId]: optimistic } }));
    } else {
      // Primera vez: crear status optimista desde catálogo para evitar flicker
      try {
        const { MCP_CATALOG } = await import("../../shared/mcp.ts");
        const optimisticServers = MCP_CATALOG.map((catalog) => ({
          catalog,
          config: { id: catalog.id, enabled: catalog.id === serverId ? enabled : false, updatedAt: catalog.id === serverId ? Date.now() : 0 },
          status: "disconnected" as const,
          hasSecret: false,
          lastError: undefined,
          toolCount: undefined,
        }));
        set((s) => ({
          byProject: { ...s.byProject, [projectId]: { projectId, projectPath, servers: optimisticServers } },
        }));
      } catch {}
    }
    try {
      const res = await window.termcanvas.mcp.setEnabled(projectId, serverId, enabled, projectPath);
      if (!res.ok) throw new Error(res.error);
      await get().refresh(projectId, projectPath);
      // también actualizar projectStore local para que persista en state.json y sobreviva reinicios
      try {
        const { useProjectStore } = await import("./projectStore.ts");
        useProjectStore.getState().setProjectMcpServerEnabled(projectId, serverId, enabled);
      } catch {}
    } catch (e) {
      // Revertir optimistic si falló
      if (prev) {
        set((s) => ({ byProject: { ...s.byProject, [projectId]: prev } }));
      }
      set((s) => ({ error: { ...s.error, [projectId]: e instanceof Error ? e.message : String(e) } }));
      return;
    } finally {
      set((s) => ({ loading: { ...s.loading, [projectId]: false } }));
    }
  },

  setSecret: async (projectId, projectPath, serverId, token) => {
    set((s) => ({ loading: { ...s.loading, [projectId]: true } }));
    try {
      const res = await window.termcanvas.mcp.setSecret(projectId, serverId, token, projectPath);
      if (!res.ok) throw new Error(res.error);
      await get().refresh(projectId, projectPath);
    } catch (e) {
      set((s) => ({ error: { ...s.error, [projectId]: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [projectId]: false } }));
    }
  },

  connect: async (projectId, projectPath, serverId) => {
    set((s) => ({ loading: { ...s.loading, [projectId]: true } }));
    try {
      const res = await window.termcanvas.mcp.connect(projectId, serverId);
      if (!res.ok) throw new Error(res.error);
      await get().refresh(projectId, projectPath);
    } catch (e) {
      set((s) => ({ error: { ...s.error, [projectId]: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [projectId]: false } }));
    }
  },
}));
