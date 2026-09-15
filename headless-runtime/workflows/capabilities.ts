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
  /**
   * Nombres de bundles MCP declarados por el agente del nodo
   * (`factory/agents/<name>/agent.md` → `mcps: {a, b}`). Se resuelven contra
   * `factory/mcps/<name>.json` y se mergean con el MCP del nodo (el nodo pisa
   * claves homónimas). Fatal si un bundle no existe.
   */
  agentMcps?: string[];
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

/** Nombres de bundles MCP válidos (mismo anti-traversal que agentes/skills). */
export const MCP_BUNDLE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Normaliza `mcps` del frontmatter (el parser lo entrega como string[],
 * Record o string crudo `{a, b}`) a una lista de nombres válidos.
 * Pura, nunca lanza. Nombres inválidos se descartan.
 */
export function normalizeMcpNames(raw: unknown): string[] {
  try {
    if (raw === undefined || raw === null) return [];
    let items: unknown[] = [];
    if (Array.isArray(raw)) items = raw;
    else if (typeof raw === "object") items = Object.keys(raw as Record<string, unknown>);
    else if (typeof raw === "string") {
      const t = raw.trim().replace(/^\{/, "").replace(/\}$/, "");
      items = t.length === 0 ? [] : t.split(",").map((s) => s.trim().replace(/^["']+|["']+$/g, ""));
    } else return [];
    const out: string[] = [];
    for (const item of items) {
      const name = String(item ?? "").trim();
      if (!name || !MCP_BUNDLE_NAME_PATTERN.test(name)) continue;
      if (!out.includes(name)) out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

/** Dir de bundles MCP (`<repoRoot>/factory/mcps`). */
export function mcpBundlesDir(opts: { repoRoot: string }): string {
  return path.join(opts.repoRoot, "factory", "mcps");
}

/**
 * Resuelve bundles MCP por nombre contra `factory/mcps/<name>.json`.
 * Cada bundle aporta uno o más servers (formato `{ mcpServers: {...} }`).
 * Fatal si un bundle no existe: el nodo no corre a medias.
 */
export function resolveAgentMcps(
  names: string[],
  opts: { repoRoot: string },
): Record<string, unknown> {
  const dir = mcpBundlesDir(opts);
  const out: Record<string, unknown> = {};
  const requested = normalizeMcpNames(names);
  for (const name of requested) {
    const filePath = path.join(dir, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      const available = listMcpBundleNames(opts);
      throw new Error(
        `mcp bundle "${name}" no existe en factory/mcps. Disponibles: ${available.length > 0 ? available.join(", ") : "(ninguno)"}`,
      );
    }
    Object.assign(out, parseMcpConfigFile(filePath));
  }
  return out;
}

/** Nombres de bundles `factory/mcps/*.json` presentes en disco. Nunca lanza. */
export function listMcpBundleNames(opts: { repoRoot: string }): string[] {
  try {
    const dir = mcpBundlesDir(opts);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((entry) => entry.endsWith(".json") && MCP_BUNDLE_NAME_PATTERN.test(entry.slice(0, -5)))
      .map((entry) => entry.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Materializa las capacidades de un nodo. Devuelve null cuando el nodo no
 * declara skills ni mcp ni hereda MCPs del agente (no hace falta server
 * scopeado). Los errores de skill/mcp son fatales: el nodo no debe correr a
 * medias. El MCP del nodo pisa claves homónimas del MCP del agente.
 */
export function materializeNodeCapabilities(
  node: Pick<WorkflowNode, "skills" | "mcp">,
  opts: CapabilityOptions,
): NodeCapabilityScope | null {
  const skillNames = node.skills ?? [];
  const nodeMcpConfig = node.mcp
    ? parseMcpConfigFile(path.resolve(opts.workflowDir, node.mcp))
    : {};
  const agentMcpConfig = resolveAgentMcps(opts.agentMcps ?? [], opts);
  const mcpConfig = { ...agentMcpConfig, ...nodeMcpConfig };
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
