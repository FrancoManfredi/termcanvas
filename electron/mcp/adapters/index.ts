/**
 * Adapter registry — single dispatch for all harnesses.
 *
 * Manager and IPC never import opencode-sync/codebuddy directly.
 * They import this registry and iterate over enabled harnesses.
 *
 * Today we dual-write to both harnesses on every toggle so the
 * migration is zero-data-loss. Future: harness selection per project
 * (ProjectData.harness: "opencode" | "codebuddy" | "both").
 */

import type { McpServerId, McpCatalogEntry } from "../../../shared/mcp.ts";
import type { HarnessMcpAdapter } from "./types.ts";
import { opencodeMcpAdapter } from "./opencode.ts";
import { codebuddyMcpAdapter } from "./codebuddy.ts";

const adapters: Record<string, HarnessMcpAdapter> = {
  [opencodeMcpAdapter.harnessId]: opencodeMcpAdapter,
  [codebuddyMcpAdapter.harnessId]: codebuddyMcpAdapter,
};

export function getMcpAdapter(harnessId: string): HarnessMcpAdapter | undefined {
  return adapters[harnessId];
}

export function listMcpAdapters(): HarnessMcpAdapter[] {
  return Object.values(adapters);
}

/**
 * Sync to all registered harnesses. Used by ipc.ts on set-enabled/set-secret.
 * Best-effort: one harness failing never blocks the other.
 */
export function syncToAllHarnesses(
  projectPath: string,
  serverId: McpServerId,
  enabled: boolean,
  token: string | null,
  customCatalog?: McpCatalogEntry[],
): void {
  for (const adapter of listMcpAdapters()) {
    try {
      adapter.syncToHarness(projectPath, serverId, enabled, token, customCatalog);
    } catch (err) {
      console.warn(`[mcp:adapters] ${adapter.harnessId} sync failed for ${serverId}:`, err);
    }
  }
}

export async function syncAllToAllHarnesses(
  projectPath: string,
  getConfig: () => { servers: Array<{ id: McpServerId; enabled: boolean }>; customServers?: McpCatalogEntry[] },
  getSecret: (serverId: McpServerId) => Promise<string | null>,
): Promise<void> {
  for (const adapter of listMcpAdapters()) {
    try {
      await adapter.syncAllToHarness(projectPath, getConfig, getSecret);
    } catch (err) {
      console.warn(`[mcp:adapters] ${adapter.harnessId} syncAll failed:`, err);
    }
  }
}

export function removeFromAllHarnesses(projectPath: string, serverId: McpServerId): void {
  for (const adapter of listMcpAdapters()) {
    try {
      adapter.removeFromHarness(projectPath, serverId);
    } catch (err) {
      console.warn(`[mcp:adapters] ${adapter.harnessId} remove failed for ${serverId}:`, err);
    }
  }
}
