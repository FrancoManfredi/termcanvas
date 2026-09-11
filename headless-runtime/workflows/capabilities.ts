/**
 * Capacidades por nodo (Fase 2): skills scopadas, MCP y tools.
 *
 * - Skills: se materializan en un scope efímero del run y se pasan a OpenCode
 *   vía `skills.paths` + `permission.skill` deny-all/allow-list (mismo formato
 *   que src/skills/scopedSession.ts).
 * - MCP: archivo JSON estilo `{ mcpServers: {...} }` (o `{ mcp: {...} }`)
 *   convertido al shape de OpenCode (`type: local|remote`).
 * - Tools: record de tools habilitadas para el body de session.prompt,
 *   reutilizando el vocabulario canónico de runner/toolPolicy.
 *
 * Un nodo sin skills/mcp/tools declarados no paga ningún costo extra.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IMPLEMENT_TOOLS, toolsetFromList, type Toolset } from "../runner/toolPolicy";
import type { WorkflowNode } from "./schema";

export interface SkillMaterial {
  name: string;
  raw: string;
  source: string;
}

export interface CapabilityOptions {
  repoRoot: string;
  workflowDir: string;
  scopeDir: string;
}

export interface NodeCapabilityScope {
  /** Config para OPENCODE_CONFIG_CONTENT del server scopeado. */
  config: Record<string, unknown>;
  scopeDir: string;
}

export function skillRoots(opts: { repoRoot: string; workflowDir: string }): string[] {
  return [
    path.join(opts.workflowDir, "skills"),
    path.join(opts.repoRoot, "factory", "skills"),
    path.join(opts.repoRoot, ".agents", "skills"),
    path.join(os.homedir(), ".config", "opencode", "skills"),
  ];
}

/** Busca cada skill en los roots; falla con la lista de roots si no existe. */
export function resolveSkills(
  names: string[],
  opts: { repoRoot: string; workflowDir: string },
): SkillMaterial[] {
  const roots = skillRoots(opts);
  return names.map((name) => {
    for (const root of roots) {
      const filePath = path.join(root, name, "SKILL.md");
      if (fs.existsSync(filePath)) {
        return {
          name,
          raw: fs.readFileSync(filePath, "utf-8"),
          source: filePath,
        };
      }
    }
    throw new Error(
      `skill "${name}" no encontrada. Roots: ${roots.join(" | ")}`,
    );
  });
}

export interface ToolFields {
  allowed_tools?: string[];
  denied_tools?: string[];
}

/**
 * Record de tools para el body de prompt. Sin allowed/denied → undefined
 * (el nodo hereda el toolset default del server).
 * - allowed_tools: allowlist exacta (vocabulario canónico).
 * - denied_tools sin allowlist: set completo de implement menos las denegadas.
 */
export function buildToolsRecord(node: ToolFields): Toolset | undefined {
  const allowed = node.allowed_tools;
  const denied = node.denied_tools;
  if (!allowed && !denied) return undefined;
  const record: Toolset = allowed
    ? toolsetFromList(allowed)
    : { ...IMPLEMENT_TOOLS };
  if (denied) {
    for (const tool of denied) {
      delete record[tool.trim().toLowerCase()];
    }
  }
  return record;
}

interface RawMcpServer {
  url?: unknown;
  headers?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  environment?: unknown;
}

/** Convierte un archivo MCP estilo Archon al shape `mcp` de OpenCode. */
export function parseMcpConfigFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`mcp file no existe: ${filePath}`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`mcp file inválido (${filePath}): ${message}`);
  }
  const servers = (parsed.mcpServers ?? parsed.mcp ?? {}) as Record<string, RawMcpServer>;
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(servers)) {
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.url === "string" && raw.url.length > 0) {
      out[name] = {
        type: "remote",
        url: raw.url,
        enabled: true,
        ...(raw.headers && typeof raw.headers === "object"
          ? { headers: raw.headers }
          : {}),
      };
      continue;
    }
    if (typeof raw.command === "string" && raw.command.length > 0) {
      const args = Array.isArray(raw.args) ? raw.args.map(String) : [];
      const isWin = process.platform === "win32";
      const command = isWin && raw.command === "npx" ? "cmd" : raw.command;
      const fullArgs = isWin && raw.command === "npx" ? ["/c", "npx", ...args] : args;
      const environment = raw.env ?? raw.environment;
      out[name] = {
        type: "local",
        command: [command, ...fullArgs],
        enabled: true,
        ...(environment && typeof environment === "object"
          ? { environment }
          : {}),
      };
    }
  }
  return out;
}

/**
 * Materializa las capacidades de un nodo. Devuelve null cuando el nodo no
 * declara skills ni mcp (no hace falta server scopeado).
 * Los errores de skill/mcp son fatales: el nodo no debe correr a medias.
 */
export function materializeNodeCapabilities(
  node: Pick<WorkflowNode, "skills" | "mcp">,
  opts: CapabilityOptions,
): NodeCapabilityScope | null {
  const skillNames = node.skills ?? [];
  const mcpConfig = node.mcp
    ? parseMcpConfigFile(path.resolve(opts.workflowDir, node.mcp))
    : {};
  const hasMcp = Object.keys(mcpConfig).length > 0;
  if (skillNames.length === 0 && !hasMcp) return null;

  const config: Record<string, unknown> = {};
  if (skillNames.length > 0) {
    const materials = resolveSkills(skillNames, opts);
    fs.mkdirSync(opts.scopeDir, { recursive: true });
    const permissionSkill: Record<string, "allow" | "deny"> = { "*": "deny" };
    for (const skill of materials) {
      const dir = path.join(opts.scopeDir, skill.name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), skill.raw, "utf-8");
      permissionSkill[skill.name] = "allow";
    }
    config.skills = { paths: [opts.scopeDir] };
    config.permission = { skill: permissionSkill };
  }
  if (hasMcp) config.mcp = mcpConfig;
  return { config, scopeDir: opts.scopeDir };
}
