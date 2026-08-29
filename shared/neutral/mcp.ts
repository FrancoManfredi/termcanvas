/**
 * Neutral MCP layer — source of truth for all harnesses.
 *
 * shared/mcp.ts already defines the neutral catalog/config types.
 * This file is the explicit neutral facade: harnesses never import
 * shared/mcp.ts directly for translation; they depend on this module
 * and on the HarnessMcpAdapter contract below.
 *
 * Why a facade? When we add a second harness (codebuddy), the catalog
 * stays single-source, but each harness needs a different serialization:
 *   - opencode:  { mcp: { [id]: { type: "local", command: [...] } } } in opencode.json
 *   - codebuddy: { mcpServers: { [id]: { type: "stdio", command, args, env } } } in .codebuddy/mcp.json or --mcp-config
 *
 * The manager (electron/mcp/manager.ts) owns Neutral state (ProjectMcpConfig + vault).
 * Adapters own the translation.
 */

export type {
  McpTransport,
  BuiltInMcpServerId,
  McpServerId,
  McpConnectionStatus,
  McpCatalogEntry,
  ProjectMcpServerConfig,
  ProjectMcpConfig,
  McpServerState,
  ProjectMcpStatus,
  McpScope,
  McpToolRef,
} from "../mcp.ts";

export {
  MCP_CATALOG,
  getCatalogEntry,
  getAllCatalogEntries,
  isBuiltInMcpId,
  validateCatalog,
  defaultProjectMcpConfig,
  sanitizeCatalogEntry,
  sanitizeProjectMcpConfig,
} from "../mcp.ts";

/**
 * Contract every harness adapter must implement.
 * The manager never writes harness files directly; it calls the
 * adapter for the active harness(es).
 */
export interface HarnessMcpAdapter {
  /** Stable harness id, e.g. "opencode" | "codebuddy" */
  readonly harnessId: string;

  /**
   * Serialize neutral config to the harness's on-disk format.
   * Should be idempotent and preserve unknown keys from existing file.
   */
  syncToHarness(
    projectPath: string,
    serverId: import("../mcp.ts").McpServerId,
    enabled: boolean,
    token: string | null,
    customCatalog?: import("../mcp.ts").McpCatalogEntry[],
  ): void;

  /** Remove a single server from the harness file (best-effort). */
  removeFromHarness(projectPath: string, serverId: import("../mcp.ts").McpServerId): void;

  /** Sync all enabled servers (used on hydrate). */
  syncAllToHarness(
    projectPath: string,
    getConfig: () => { servers: Array<{ id: import("../mcp.ts").McpServerId; enabled: boolean }>; customServers?: import("../mcp.ts").McpCatalogEntry[] },
    getSecret: (serverId: import("../mcp.ts").McpServerId) => Promise<string | null>,
  ): Promise<void>;

  /** Read back entries as neutral catalog entries for comparison/diagnostics. */
  readFromHarness?(projectPath: string): unknown[];
}

/**
 * Registry — single place to enumerate supported harnesses.
 * Add a new harness by adding its id here and registering its adapter
 * in electron/mcp/adapters/index.ts without touching manager.ts.
 */
export const SUPPORTED_HARNESS_IDS = ["opencode", "codebuddy"] as const;
export type HarnessId = (typeof SUPPORTED_HARNESS_IDS)[number];
