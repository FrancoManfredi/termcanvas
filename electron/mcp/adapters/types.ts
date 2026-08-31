/**
 * Harness MCP adapter types — neutral -> harness serialization.
 *
 * Each file in this directory implements HarnessMcpAdapter for one harness.
 * The manager (electron/mcp/manager.ts) stays harness-agnostic and never
 * imports opencode-reader/opencode-sync directly; it calls the registry.
 */

import type { McpServerId, McpCatalogEntry } from "../../../shared/mcp.ts";

export interface HarnessMcpAdapter {
  readonly harnessId: string;
  syncToHarness(
    projectPath: string,
    serverId: McpServerId,
    enabled: boolean,
    token: string | null,
    customCatalog?: McpCatalogEntry[],
  ): void;
  removeFromHarness(projectPath: string, serverId: McpServerId): void;
  syncAllToHarness(
    projectPath: string,
    getConfig: () => { servers: Array<{ id: McpServerId; enabled: boolean }>; customServers?: McpCatalogEntry[] },
    getSecret: (serverId: McpServerId) => Promise<string | null>,
  ): Promise<void>;
}
