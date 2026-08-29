/**
 * Opencode harness adapter — thin wrapper around existing opencode-sync/reader.
 *
 * This file is the ONLY place that knows opencode's on-disk shape:
 *   - project: <project>/.opencode/opencode.json  or  <project>/opencode.json
 *   - global:  ~/.config/opencode/opencode.json{,c}
 *   - shape:   { mcp: { [id]: { type: "local" | "remote", command?, url?, headers?, environment? } } }
 *
 * Neutral code (manager.ts, ipc.ts) talks to this adapter via HarnessMcpAdapter.
 * Codebuddy adapter will live beside this file and never import it.
 */

import type { McpServerId, McpCatalogEntry } from "../../../shared/mcp.ts";
import {
  syncTermCanvasMcpToOpencode,
  syncAllEnabledToOpencode,
  removeTermCanvasMcpFromOpencode,
} from "../opencode-sync.ts";
import type { HarnessMcpAdapter } from "./types.ts";

export const opencodeMcpAdapter: HarnessMcpAdapter = {
  harnessId: "opencode",

  syncToHarness(projectPath, serverId, enabled, token, customCatalog) {
    syncTermCanvasMcpToOpencode(projectPath, serverId, enabled, token, customCatalog);
  },

  removeFromHarness(projectPath, serverId) {
    removeTermCanvasMcpFromOpencode(projectPath, serverId);
  },

  async syncAllToHarness(projectPath, getConfig, getSecret) {
    await syncAllEnabledToOpencode(projectPath, getConfig as any, getSecret);
  },
};
