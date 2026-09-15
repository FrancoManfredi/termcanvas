/**
 * factory/mcps/mcpFileRoutes — CRUD de bundles MCP por agente.
 *
 * Un bundle es UN archivo `factory/mcps/<name>.json` con el formato que ya
 * consume el engine (`parseMcpConfigFile`): `{ "mcpServers": { "<server>":
 * { url | command, ... } } }`. El `agent.md` declara `mcps: {a, b}` por nombre
 * y el nodo IA, al correr con ese agente, scopea un server opencode con esos
 * servers mergeados (ver `workflows/capabilities.ts` + `nodes/ai.ts`).
 *
 * Reglas (espejo de agentFileRoutes):
 * - ESM puro, sin timers; nunca lanza hacia el server (errores con `code`).
 * - Anti-traversal `^[a-z0-9][a-z0-9_-]*$` + resolución dentro de
 *   `factory/mcps/` (el seam `mcpsDir` es SOLO para tests).
 * - Escritura atómica tmp→rename; validación completa antes de tocar disco.
 * - DELETE bloqueado (409) si un agente referencia el bundle: los agentes
 *   viajan inline y un bundle faltante fallaría el nodo en runtime.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveFactoryRepoRoot } from "../agentLoader";
import { listAgents, readAgentFull } from "../agents/agentFileRoutes";

/** Tope del archivo MCP aceptado (64KB: sobra para bundles honestos). */
export const MCP_BUNDLE_MAX_CHARS = 64 * 1024;

const MCP_BUNDLE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

export interface McpServerSummary {
  name: string;
  type: "remote" | "local";
  target: string;
}

export interface McpBundleListItem {
  name: string;
  serverCount: number;
  servers: McpServerSummary[];
}

export interface McpBundleRead {
  name: string;
  servers: Record<string, unknown>;
}

export type McpWriteErrorCode = "invalid" | "duplicate" | "not-found" | "referenced" | "io";

export interface McpWriteError {
  ok: false;
  error: string;
  code: McpWriteErrorCode;
}

export function isValidMcpBundleName(name: unknown): name is string {
  try {
    return (
      typeof name === "string" &&
      MCP_BUNDLE_NAME_PATTERN.test(name.trim()) &&
      name.trim().length <= 64
    );
  } catch {
    return false;
  }
}

/**
 * Parsea `/factory/mcps/:name` (sin query). Puro, nunca lanza. Rechaza
 * segmentos extra, trailing slash y traversal.
 */
export function parseMcpBundlePath(pathname: unknown): { name: string } | { error: string } {
  try {
    if (typeof pathname !== "string" || !pathname.startsWith("/factory/mcps/")) {
      return { error: "not found" };
    }
    const rest = pathname.slice("/factory/mcps/".length);
    if (!rest || rest.includes("/") || rest.includes("?") || rest.includes("#")) {
      return { error: "not found" };
    }
    let name: string;
    try {
      name = decodeURIComponent(rest).trim();
    } catch {
      return { error: "nombre de mcp inválido" };
    }
    if (!isValidMcpBundleName(name)) return { error: "nombre de mcp inválido" };
    return { name };
  } catch {
    return { error: "nombre de mcp inválido" };
  }
}

/** Dir real de bundles, o el sandbox de tests si se pasa `mcpsDir`. */
export function resolveMcpBundlesDir(mcpsDir?: string): string {
  try {
    if (typeof mcpsDir === "string" && mcpsDir.trim().length > 0) {
      return mcpsDir.trim();
    }
  } catch {
    // cae al disco real
  }
  return path.join(resolveFactoryRepoRoot(), "factory", "mcps");
}

function filePathFor(name: string, mcpsDir?: string): string {
  return path.join(resolveMcpBundlesDir(mcpsDir), `${name}.json`);
}

/** Escritura atómica tmp→rename (mismo patrón que agentFileRoutes). */
function writeTextAtomic(filePath: string, content: string): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    fs.writeFileSync(tmp, content, "utf-8");
    fs.renameSync(tmp, filePath);
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Valida y canoniza el mapa de servers recibido por API. Acepta la forma
 * raw (`{ url }` | `{ command, args, env }`) y devuelve una copia limpia.
 * Puro, nunca lanza (null = inválido).
 */
export function normalizeMcpServers(raw: unknown): Record<string, unknown> | null {
  try {
    const servers = asRecord(raw);
    if (!servers || Object.keys(servers).length === 0) return null;
    const out: Record<string, unknown> = {};
    for (const [serverName, entryRaw] of Object.entries(servers)) {
      const name = serverName.trim();
      if (!name || !MCP_BUNDLE_NAME_PATTERN.test(name)) return null;
      const entry = asRecord(entryRaw);
      if (!entry) return null;
      if (typeof entry.url === "string" && entry.url.trim().length > 0) {
        const clean: Record<string, unknown> = { url: entry.url.trim() };
        if (entry.headers !== undefined) {
          const headers = asRecord(entry.headers);
          if (!headers) return null;
          const cleanHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(headers)) {
            if (typeof v !== "string") return null;
            cleanHeaders[k] = v;
          }
          if (Object.keys(cleanHeaders).length > 0) clean.headers = cleanHeaders;
        }
        out[name] = clean;
        continue;
      }
      if (typeof entry.command === "string" && entry.command.trim().length > 0) {
        const clean: Record<string, unknown> = { command: entry.command.trim() };
        if (entry.args !== undefined) {
          if (!Array.isArray(entry.args)) return null;
          const args = (entry.args as unknown[]).map((a) => String(a ?? ""));
          if (args.length > 0) clean.args = args;
        }
        const envRaw = entry.env ?? entry.environment;
        if (envRaw !== undefined) {
          const env = asRecord(envRaw);
          if (!env) return null;
          const cleanEnv: Record<string, string> = {};
          for (const [k, v] of Object.entries(env)) {
            if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return null;
            cleanEnv[k] = String(v);
          }
          if (Object.keys(cleanEnv).length > 0) clean.env = cleanEnv;
        }
        out[name] = clean;
        continue;
      }
      return null;
    }
    return out;
  } catch {
    return null;
  }
}

/** Lee y valida `factory/mcps/<name>.json` desde disco. null = no parseable. */
function readServersFromDisk(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const raw = parsed.mcpServers ?? parsed.mcp;
    return normalizeMcpServers(raw);
  } catch {
    return null;
  }
}

/** Serializa canónico (2 espacios + newline) para archivos dif-friendly. */
function serializeBundle(servers: Record<string, unknown>): string {
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

function summarizeServers(servers: Record<string, unknown>): McpServerSummary[] {
  const out: McpServerSummary[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    const rec = asRecord(entry) ?? {};
    if (typeof rec.url === "string") {
      out.push({ name, type: "remote", target: rec.url });
    } else if (typeof rec.command === "string") {
      const args = Array.isArray(rec.args) ? (rec.args as unknown[]).map(String) : [];
      out.push({ name, type: "local", target: [rec.command, ...args].join(" ") });
    }
  }
  return out;
}

/**
 * Lista bundles `factory/mcps/*.json` con un resumen de servers. Los archivos
 * rotos se omiten (los reporta el validator). Ordenado. Nunca lanza.
 */
export function listMcpBundles(mcpsDir?: string): McpBundleListItem[] {
  const out: McpBundleListItem[] = [];
  try {
    const dir = resolveMcpBundlesDir(mcpsDir);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).slice().sort();
    } catch {
      return out;
    }
    for (const entry of entries) {
      try {
        if (!entry.endsWith(".json")) continue;
        const name = entry.slice(0, -5);
        if (!isValidMcpBundleName(name)) continue;
        const servers = readServersFromDisk(path.join(dir, entry));
        if (!servers) continue;
        const summary = summarizeServers(servers);
        out.push({ name, serverCount: summary.length, servers: summary });
      } catch {
        // roto: lo reporta el validator
      }
    }
  } catch {
    // nunca lanza
  }
  return out;
}

/** Lee un bundle completo. Nunca lanza. */
export function readMcpBundle(
  name: string,
  mcpsDir?: string,
): { ok: true; value: McpBundleRead } | { ok: false; error: string } {
  try {
    if (!isValidMcpBundleName(name)) return { ok: false, error: "nombre de mcp inválido" };
    const clean = name.trim();
    const filePath = filePathFor(clean, mcpsDir);
    let text: string;
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `mcp bundle no encontrado: ${clean}` };
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      return { ok: false, error: `no se pudo leer el mcp: ${clean}` };
    }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const servers = normalizeMcpServers(parsed.mcpServers ?? parsed.mcp);
      if (!servers) return { ok: false, error: `mcp bundle inválido: ${clean}` };
      return { ok: true, value: { name: clean, servers } };
    } catch {
      return { ok: false, error: `mcp bundle inválido: ${clean}` };
    }
  } catch {
    return { ok: false, error: "no se pudo leer el mcp" };
  }
}

/** Agentes que referencian un bundle por nombre (`mcps` del frontmatter). */
export function listAgentsReferencingMcp(name: string, factoryDir?: string): string[] {
  try {
    if (!isValidMcpBundleName(name)) return [];
    const target = name.trim();
    const refs: string[] = [];
    for (const item of listAgents(factoryDir)) {
      try {
        const full = readAgentFull(item.name, factoryDir);
        if (!full.ok) continue;
        const raw = full.value.frontmatter.mcps;
        const names: string[] = Array.isArray(raw)
          ? (raw as unknown[]).map((v) => String(v ?? "").trim())
          : raw && typeof raw === "object"
            ? Object.keys(raw as Record<string, unknown>).map((k) => k.trim())
            : typeof raw === "string"
              ? raw
                  .replace(/^\{/, "")
                  .replace(/\}$/, "")
                  .split(",")
                  .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
              : [];
        if (names.includes(target)) refs.push(item.name);
      } catch {
        // agente roto: lo reporta el validator
      }
    }
    return refs;
  } catch {
    return [];
  }
}

/**
 * Crea `factory/mcps/<name>.json`. Valida nombre, duplicado y servers antes
 * de tocar disco. Nunca lanza.
 */
export function createMcpBundle(
  name: unknown,
  serversInput: unknown,
  mcpsDir?: string,
): { ok: true; value: McpBundleRead } | McpWriteError {
  try {
    if (!isValidMcpBundleName(name)) return { ok: false, error: "nombre de mcp inválido", code: "invalid" };
    const clean = (name as string).trim();
    const servers = normalizeMcpServers(serversInput);
    if (!servers) {
      return { ok: false, error: "mcpServers inválido: cada server necesita url (remoto) o command (local)", code: "invalid" };
    }
    const text = serializeBundle(servers);
    if (text.length > MCP_BUNDLE_MAX_CHARS) {
      return { ok: false, error: `mcp demasiado grande (máx ${MCP_BUNDLE_MAX_CHARS} caracteres)`, code: "invalid" };
    }
    const filePath = filePathFor(clean, mcpsDir);
    try {
      if (fs.existsSync(filePath)) {
        return { ok: false, error: `el mcp ya existe: ${clean}`, code: "duplicate" };
      }
    } catch {
      return { ok: false, error: "no se pudo verificar el mcp", code: "io" };
    }
    if (!writeTextAtomic(filePath, text)) {
      return { ok: false, error: "no se pudo escribir el mcp", code: "io" };
    }
    return { ok: true, value: { name: clean, servers } };
  } catch {
    return { ok: false, error: "no se pudo crear el mcp", code: "io" };
  }
}

/**
 * Sobrescribe `factory/mcps/<name>.json` con servers validados. Nunca lanza.
 */
export function writeMcpBundle(
  name: unknown,
  serversInput: unknown,
  mcpsDir?: string,
): { ok: true; value: McpBundleRead } | McpWriteError {
  try {
    if (!isValidMcpBundleName(name)) return { ok: false, error: "nombre de mcp inválido", code: "invalid" };
    const clean = (name as string).trim();
    const servers = normalizeMcpServers(serversInput);
    if (!servers) {
      return { ok: false, error: "mcpServers inválido: cada server necesita url (remoto) o command (local)", code: "invalid" };
    }
    const text = serializeBundle(servers);
    if (text.length > MCP_BUNDLE_MAX_CHARS) {
      return { ok: false, error: `mcp demasiado grande (máx ${MCP_BUNDLE_MAX_CHARS} caracteres)`, code: "invalid" };
    }
    const filePath = filePathFor(clean, mcpsDir);
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `mcp bundle no encontrado: ${clean}`, code: "not-found" };
    } catch {
      return { ok: false, error: "no se pudo verificar el mcp", code: "io" };
    }
    if (!writeTextAtomic(filePath, text)) {
      return { ok: false, error: "no se pudo escribir el mcp", code: "io" };
    }
    return { ok: true, value: { name: clean, servers } };
  } catch {
    return { ok: false, error: "no se pudo guardar el mcp", code: "io" };
  }
}

/**
 * Elimina `factory/mcps/<name>.json`. 409 si algún agente lo referencia.
 * Nunca lanza.
 */
export function deleteMcpBundle(
  name: unknown,
  mcpsDir?: string,
  factoryDir?: string,
): { ok: true; value: { name: string } } | McpWriteError {
  try {
    if (!isValidMcpBundleName(name)) return { ok: false, error: "nombre de mcp inválido", code: "invalid" };
    const clean = (name as string).trim();
    const filePath = filePathFor(clean, mcpsDir);
    try {
      if (!fs.existsSync(filePath)) return { ok: false, error: `mcp bundle no encontrado: ${clean}`, code: "not-found" };
    } catch {
      return { ok: false, error: "no se pudo verificar el mcp", code: "io" };
    }
    const refs = listAgentsReferencingMcp(clean, factoryDir);
    if (refs.length > 0) {
      return {
        ok: false,
        error: `el mcp está en uso por: ${refs.join(", ")}. Quitálo de esos agentes antes de eliminarlo`,
        code: "referenced",
      };
    }
    try {
      fs.unlinkSync(filePath);
    } catch {
      return { ok: false, error: "no se pudo eliminar el mcp", code: "io" };
    }
    return { ok: true, value: { name: clean } };
  } catch {
    return { ok: false, error: "no se pudo eliminar el mcp", code: "io" };
  }
}
