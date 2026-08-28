import { ipcMain } from "electron";
import { McpManager } from "./manager.ts";
import { writeMcpToAgentsDir, readMcpFromAgentsDir } from "./sync.ts";
import { getGlobalOpencodeMcpEntries, getProjectOpencodeMcpEntries } from "./opencode-reader.ts";
import { syncTermCanvasMcpToOpencode, syncAllEnabledToOpencode } from "./opencode-sync.ts";
import { registerMcpProject } from "./project-env.ts";
import type { McpServerId } from "../../shared/mcp.ts";

type Envelope<T> = { ok: true; result: T } | { ok: false; error: string };

function wrap<T>(fn: () => Promise<T>): Promise<Envelope<T>> {
  return fn()
    .then((result) => ({ ok: true as const, result }))
    .catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
}

export function registerMcpIpc(manager: McpManager): void {
  ipcMain.handle("mcp:status", async (_event, projectId: string, projectPath: string) => {
    // Si existe .agents/mcp.json (pull cross-device), hidratar solo si es más nuevo que el manager
    if (projectPath) {
      const fromAgents = readMcpFromAgentsDir(projectPath);
      if (fromAgents) {
        const current = manager.getRawConfig(projectId);
        const hasDiff = JSON.stringify(current) !== JSON.stringify(fromAgents);
        if (hasDiff) {
          // Solo hidratar si el archivo es más nuevo (evita revertir un toggle local cuando el write falló o aún no se hizo)
          let shouldHydrate = false;
          const currentById = new Map(current.servers.map((s) => [s.id, s]));
          for (const s of fromAgents.servers) {
            const cur = currentById.get(s.id);
            if (!cur) { shouldHydrate = true; break; }
            if (s.enabled !== cur.enabled && (s.updatedAt ?? 0) > (cur.updatedAt ?? 0)) {
              shouldHydrate = true;
              break;
            }
            // Si el manager nunca tuvo este server (updatedAt 0) y el archivo sí tiene data, hidratar
            if ((cur.updatedAt ?? 0) === 0 && (s.updatedAt ?? 0) > 0) {
              shouldHydrate = true;
              break;
            }
          }
          // Fallback: si el manager está en default (todo disabled y updatedAt 0) y el archivo tiene algún enabled true, hidratar
          if (!shouldHydrate) {
            const managerIsDefault = current.servers.every((s) => !s.enabled && (s.updatedAt ?? 0) === 0);
            const fileHasEnabled = fromAgents.servers.some((s) => s.enabled);
            if (managerIsDefault && fileHasEnabled) shouldHydrate = true;
          }
          if (shouldHydrate) {
            manager.hydrateConfig(projectId, fromAgents);
            // Sincronizar los habilitados hacia opencode para que `opencode` los vea
            try {
              await syncAllEnabledToOpencode(
                projectPath,
                () => manager.getRawConfig(projectId),
                (sid) => manager.getSecret(projectId, sid),
              );
            } catch {}
          }
        }
      }
    }
    return wrap(() => manager.getStatus(projectId, projectPath));
  });

  ipcMain.handle("mcp:set-enabled", async (_event, projectId: string, serverId: string, enabled: boolean, projectPath?: string) => {
    const res = await wrap(() => manager.setEnabled(projectId, serverId as McpServerId, enabled));
    if (res.ok && projectPath) {
      try {
        const cfg = manager.getRawConfig(projectId);
        writeMcpToAgentsDir(projectPath, cfg);
      } catch {}
      try {
        const cfg = manager.getRawConfig(projectId);
        const token = await manager.getSecret(projectId, serverId as McpServerId);
        syncTermCanvasMcpToOpencode(projectPath, serverId as McpServerId, enabled, token, cfg.customServers);
      } catch {}
    }
    return res;
  });

  ipcMain.handle("mcp:set-secret", async (_event, projectId: string, serverId: string, token: string | null, projectPath?: string) => {
    const res = await wrap(() => manager.setSecret(projectId, serverId as McpServerId, token));
    if (res.ok && projectPath) {
      try {
        const cfg = manager.getRawConfig(projectId);
        const srv = cfg.servers.find((s) => s.id === serverId);
        const enabled = srv?.enabled ?? false;
        // Si el MCP está activo, sincronizar el nuevo token a opencode; si no, no hace falta
        if (enabled) {
          syncTermCanvasMcpToOpencode(projectPath, serverId as McpServerId, enabled, token, cfg.customServers);
        }
      } catch {}
    }
    return res;
  });

  ipcMain.handle("mcp:connect", (_event, projectId: string, serverId: string) =>
    wrap(() => manager.connect(projectId, serverId as McpServerId)),
  );

  ipcMain.handle("mcp:disconnect", (_event, projectId: string, serverId: string) =>
    wrap(async () => {
      manager.disconnect(projectId, serverId as McpServerId);
      return { ok: true as const };
    }),
  );

  ipcMain.handle("mcp:get-config", (_event, projectId: string) =>
    wrap(async () => manager.getRawConfig(projectId)),
  );

  ipcMain.handle("mcp:hydrate-config", (_event, projectId: string, raw: unknown, projectPath?: string) =>
    wrap(async () => {
      manager.hydrateConfig(projectId, raw);
      if (projectPath) {
        registerMcpProject(projectId, projectPath);
        try {
          const cfg = manager.getRawConfig(projectId);
          writeMcpToAgentsDir(projectPath, cfg);
        } catch {}
        try {
          await syncAllEnabledToOpencode(
            projectPath,
            () => manager.getRawConfig(projectId),
            (sid) => manager.getSecret(projectId, sid),
          );
        } catch {}
      }
      return { ok: true as const };
    }),
  );

  ipcMain.handle("mcp:register-project", (_event, projectId: string, projectPath: string) =>
    wrap(async () => {
      registerMcpProject(projectId, projectPath);
      return { ok: true as const };
    }),
  );

  ipcMain.handle("mcp:global-status", () =>
    wrap(async () => getGlobalOpencodeMcpEntries()),
  );

  ipcMain.handle("mcp:project-opencode-status", (_event, projectPath: string) =>
    wrap(async () => getProjectOpencodeMcpEntries(projectPath)),
  );

  ipcMain.handle("mcp:health-check", (_event, projectId: string, serverId: string, projectPath: string) =>
    wrap(() => manager.checkHealth(projectId, serverId as McpServerId, projectPath)),
  );

  ipcMain.handle("mcp:add-custom", (_event, projectId: string, projectPath: string, entry: unknown) =>
    wrap(async () => {
      const res = await manager.addCustom(projectId, entry as import("../../shared/mcp.ts").McpCatalogEntry);
      if (!res.ok) throw new Error(res.error);
      const cfg = manager.getRawConfig(projectId);
      writeMcpToAgentsDir(projectPath, cfg);
      return res;
    }),
  );

  ipcMain.handle("mcp:update-custom", (_event, projectId: string, projectPath: string, id: string, patch: unknown) =>
    wrap(async () => {
      const res = await manager.updateCustom(projectId, id, patch as import("../../shared/mcp.ts").McpCatalogEntry);
      if (!res.ok) throw new Error(res.error);
      const cfg = manager.getRawConfig(projectId);
      writeMcpToAgentsDir(projectPath, cfg);
      // Si tenía enabled, re-sync a opencode
      const srv = cfg.servers.find((s) => s.id === (patch as Record<string, unknown>).id || s.id === id);
      if (srv?.enabled) {
        const token = await manager.getSecret(projectId, srv.id as McpServerId);
        syncTermCanvasMcpToOpencode(projectPath, srv.id as McpServerId, true, token, cfg.customServers);
      }
      return res;
    }),
  );

  ipcMain.handle("mcp:remove-custom", (_event, projectId: string, projectPath: string, id: string) =>
    wrap(async () => {
      const res = await manager.removeCustom(projectId, id);
      if (!res.ok) throw new Error(res.error);
      const cfg = manager.getRawConfig(projectId);
      writeMcpToAgentsDir(projectPath, cfg);
      // Eliminar del opencode.json también
      const { removeTermCanvasMcpFromOpencode } = await import("./opencode-sync.ts");
      removeTermCanvasMcpFromOpencode(projectPath, id as McpServerId);
      return res;
    }),
  );

  ipcMain.handle("mcp:hide-built-in", (_event, projectId: string, projectPath: string, id: string) =>
    wrap(async () => {
      const res = await manager.hideBuiltIn(projectId, id);
      if (!res.ok) throw new Error(res.error);
      const cfg = manager.getRawConfig(projectId);
      writeMcpToAgentsDir(projectPath, cfg);
      const { removeTermCanvasMcpFromOpencode } = await import("./opencode-sync.ts");
      removeTermCanvasMcpFromOpencode(projectPath, id as McpServerId);
      return res;
    }),
  );

  ipcMain.handle("mcp:restore-built-in", (_event, projectId: string, projectPath: string, id: string) =>
    wrap(async () => {
      const res = await manager.restoreBuiltIn(projectId, id);
      if (!res.ok) throw new Error(res.error);
      const cfg = manager.getRawConfig(projectId);
      writeMcpToAgentsDir(projectPath, cfg);
      return res;
    }),
  );

  // Push de cambios al renderer (cuando cambia estado interno)
  manager.setChangeListener((projectId) => {
    // No podemos broadcast sin window; el renderer hace polling o escucha evento.
    // Emitimos un evento genérico que el preload reenvía.
    // Se usará ipcMain emit -> webContents send via window capturado en main.ts
    // Por ahora el renderer refresca con getStatus luego de cada mutación.
    void projectId;
  });
}
