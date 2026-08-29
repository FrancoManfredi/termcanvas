/**
 * CodeBuddy harness adapter — neutral -> CodeBuddy via CLI.
 *
 * CodeBuddy stores MCPs via its CLI, not a plain JSON file:
 *   codebuddy mcp add <name> --scope project --transport <stdio|http|ssec> [--env KEY=val] [--header "K: V"] -- <commandOrUrl> [args...]
 *   codebuddy mcp remove <name> --scope project
 *   codebuddy mcp list --scope project
 *
 * This mirrors `codebuddy mcp add --help` seen in Fase 1 validation:
 *   -s, --scope <scope>          local|project|user (default: local) — we use "project"
 *   -t, --transport <transport>  stdio|sse|http (default: stdio)
 *   -e, --env <env...>           KEY=value
 *   -H, --header <header...>     "Header-Key: Header-Value" (for http/sse)
 *
 * For TermCanvas we dual-write: opencode adapter writes opencode.json,
 * this adapter calls the CodeBuddy CLI with cwd=projectPath. Both are
 * best-effort; one failing never blocks the other (see adapters/index.ts).
 *
 * Special handling:
 * - codegraph: stdio -> `codegraph serve --mcp`
 * - engram:    stdio -> `engram mcp --tools=agent` (win: engram.exe)
 * - context7:  http  -> https://mcp.context7.com/mcp  (token via --header if present)
 * - filesystem: stdio -> npx -y @modelcontextprotocol/server-filesystem {projectPath} (win: cmd /c npx ...)
 *
 * Tokens are passed via --env or --header, never written to a file we manage.
 * The file we previously used (.codebuddy/mcp.json) is NOT read by CodeBuddy,
 * so we no longer write it — see docs/adapter-guide.md § MCP pitfalls.
 */

import { execSync } from "node:child_process";
import type { McpServerId, McpCatalogEntry } from "../../../shared/mcp.ts";
import { getCatalogEntry } from "../../../shared/mcp.ts";
import { getGlobalOpencodeMcpEntries } from "../opencode-reader.ts";
import type { HarnessMcpAdapter } from "./types.ts";

function escapeArg(arg: string): string {
  if (/^[a-zA-Z0-9@._\-\/\\:]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function runCodebuddy(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    // Use execSync with a single string and shell:true to correctly handle .cmd on Windows
    // and to avoid DEP0190 (execFile with shell:true + args array). We escape args.
    const cmd = `codebuddy ${args.map(escapeArg).join(" ")}`;
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      windowsHide: true,
      timeout: 8000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout), stderr: "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; status?: number };
    const stderr = String(e.stderr ?? e.message ?? err);
    // "already exists" or "not found" are not fatal for idempotency — treat as ok
    if (/already exists/i.test(stderr) || /already configured/i.test(stderr)) {
      return { ok: true, stdout: String(e.stdout ?? ""), stderr };
    }
    return { ok: false, stdout: String(e.stdout ?? ""), stderr };
  }
}

function buildCodebuddyAddArgs(
  serverId: McpServerId,
  token: string | null,
  projectPath: string,
  catalog: McpCatalogEntry,
): string[] | null {
  // Per `codebuddy mcp add --help`: add [options] <name> <commandOrUrl> [args...]
  // Options (-s/--scope, -t/--transport, -e/--env, -H/--header) MUST come before <name>
  const base = ["mcp", "add", "--scope", "project"];
  if (catalog.transport === "http") {
    const url = catalog.defaultUrl?.trim();
    if (!url) return null;
    base.push("--transport", "http");
    if (catalog.auth?.envVar && token) {
      base.push("--header", `Authorization: Bearer ${token}`);
      base.push("--env", `${catalog.auth.envVar}=${token}`);
    }
    base.push(serverId, "--", url);
    return base;
  } else {
    let command: string;
    let args: string[];
    if (serverId === "engram") {
      command = process.platform === "win32" ? "engram.exe" : "engram";
      args = ["mcp", "--tools=agent"];
    } else if (serverId === "codegraph") {
      command = "codegraph";
      args = ["serve", "--mcp"];
    } else {
      const rawCommand = catalog.defaultCommand ?? "npx";
      let rawArgs = [...(catalog.defaultArgs ?? [])].map((a) =>
        a === "{projectPath}" ? projectPath : a.replace("{projectPath}", projectPath),
      );
      if (process.platform === "win32" && rawCommand === "npx") {
        command = "cmd";
        args = ["/c", "npx", ...rawArgs];
      } else {
        command = rawCommand;
        args = rawArgs;
      }
    }
    base.push("--transport", "stdio");
    if (catalog.auth?.envVar && token) {
      base.push("--env", `${catalog.auth.envVar}=${token}`);
    }
    base.push(serverId, "--", command, ...args);
    return base;
  }
}

export const codebuddyMcpAdapter: HarnessMcpAdapter = {
  harnessId: "codebuddy",

  syncToHarness(projectPath, serverId, enabled, token, customCatalog) {
    if (!projectPath) return;
    const catalog = getCatalogEntry(serverId, customCatalog);
    if (!catalog) return;
    const cwd = projectPath;
    if (!enabled) {
      const res = runCodebuddy(["mcp", "remove", "--scope", "project", serverId], cwd);
      if (!res.ok) {
        console.warn(`[mcp:codebuddy] remove ${serverId} failed:`, res.stderr);
      }
      return;
    }
    runCodebuddy(["mcp", "remove", "--scope", "project", serverId], cwd);
    const addArgs = buildCodebuddyAddArgs(serverId, token, projectPath, catalog);
    if (!addArgs) return;
    const res = runCodebuddy(addArgs, cwd);
    if (!res.ok) {
      console.warn(`[mcp:codebuddy] add ${serverId} failed:`, res.stderr, "args:", addArgs.join(" "));
    }
  },

  removeFromHarness(projectPath, serverId) {
    if (!projectPath) return;
    const res = runCodebuddy(["mcp", "remove", "--scope", "project", serverId], projectPath);
    if (!res.ok) {
      console.warn(`[mcp:codebuddy] remove ${serverId} failed:`, res.stderr);
    }
  },

  async syncAllToHarness(projectPath, getConfig, getSecret) {
    if (!projectPath) return;
    const cfg = getConfig();
    const custom = cfg.customServers ?? [];
    for (const s of cfg.servers) {
      try {
        const token = s.enabled ? await getSecret(s.id) : null;
        this.syncToHarness(projectPath, s.id, s.enabled, token, custom);
      } catch {
        try {
          this.syncToHarness(projectPath, s.id, s.enabled, null, custom);
        } catch {}
      }
    }
  },
};

/**
 * Sync GLOBAL opencode MCPs (from ~/.config/opencode/opencode.json) to CodeBuddy user scope.
 * This is what the user sees as "3 mcps globales" — they are not per-project, so ProjectMcpConfig won't have them.
 * We read the global opencode file and mirror each enabled entry to `codebuddy mcp add --scope user`.
 * Called once on app start and after any global opencode.json change.
 */
export function syncGlobalMcpToCodebuddy(): void {
  try {
    const globals = getGlobalOpencodeMcpEntries();
    for (const entry of globals) {
      if (!entry.enabled) continue;
      // Map opencode entry to catalog for transport/auth info
      // For globals we don't have ProjectMcpConfig, so build a minimal catalog lookup
      const catalog = getCatalogEntry(entry.name);
      // Fallback: if not in built-in catalog (e.g. engram, codegraph are custom globals), synthesize
      const effectiveCatalog: McpCatalogEntry | undefined = catalog ?? (
        entry.name === "engram"
          ? { id: "engram", name: "Engram", description: "Persistent memory", transport: "stdio", defaultCommand: "engram", defaultArgs: ["mcp", "--tools=agent"], auth: null }
          : entry.name === "codegraph"
            ? { id: "codegraph", name: "CodeGraph", description: "Code intelligence", transport: "stdio", defaultCommand: "codegraph", defaultArgs: ["serve", "--mcp"], auth: null }
            : entry.name === "context7"
              ? { id: "context7", name: "Context7", description: "Docs", transport: "http", defaultUrl: entry.url ?? "https://mcp.context7.com/mcp", auth: null }
              : undefined
      ) as McpCatalogEntry | undefined;
      if (!effectiveCatalog) continue;
      // Remove first (idempotent), then add to user scope
      runCodebuddy(["mcp", "remove", "--scope", "user", entry.name], process.cwd());
      const urlOrCommand = effectiveCatalog.transport === "http" ? effectiveCatalog.defaultUrl ?? entry.url ?? "" : effectiveCatalog.defaultCommand ?? entry.command?.[0] ?? "";
      const args: string[] = ["mcp", "add", "--scope", "user", "--transport", effectiveCatalog.transport];
      if (effectiveCatalog.transport === "http") {
        args.push(entry.name, "--", urlOrCommand);
      } else {
        const cmd = (effectiveCatalog as McpCatalogEntry).defaultCommand ?? entry.command?.[0] ?? "npx";
        const cmdArgs = (effectiveCatalog as McpCatalogEntry).defaultArgs ?? entry.command?.slice(1) ?? [];
        const finalCmd = cmd === "engram" && process.platform === "win32" ? "engram.exe" : cmd;
        args.push(entry.name, "--", finalCmd, ...cmdArgs);
      }
      const res = runCodebuddy(args, process.cwd());
      if (!res.ok) {
        console.warn(`[mcp:codebuddy] global sync ${entry.name} failed:`, res.stderr);
      }
    }
  } catch (err) {
    console.warn("[mcp:codebuddy] syncGlobalMcpToCodebuddy failed:", err);
  }
}
