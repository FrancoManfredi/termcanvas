/**
 * MCP por proyecto — tipos compartidos entre main y renderer.
 *
 * Catálogo cerrado (v1): Supabase, GitHub, Filesystem, Postgres, Fetch.
 * Transport: "http" (remote SSE/HTTP) o "stdio" (npx local).
 * Los secretos NUNCA viajan en este config; van al vault device-local.
 */

export type McpTransport = "http" | "stdio";
export type BuiltInMcpServerId = "supabase" | "github" | "filesystem" | "postgres";
export type McpServerId = BuiltInMcpServerId | (string & {});

/** Estado de conexión por servidor (expuesto al renderer). */
export type McpConnectionStatus =
  | "disconnected" // nunca conectado o desactivado
  | "connecting"
  | "connected"
  | "needs_auth" // habilitado pero falta token -> 1 re-auth por device
  | "error";

export interface McpCatalogEntry {
  id: McpServerId;
  name: string;
  description: string;
  transport: McpTransport;
  /** URL por defecto para http, package para stdio */
  defaultUrl?: string;
  defaultCommand?: string;
  defaultArgs?: string[];
  /** Qué secreto pide (label + placeholder + help). */
  auth: {
    label: string;
    placeholder: string;
    helpUrl?: string;
    envVar?: string;
  } | null;
  /** Si requiere que el proyecto tenga git repo, etc. (extensible). */
  requires?: string[];
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "supabase",
    name: "Supabase",
    description: "Base de datos, auth y storage de tu proyecto Supabase",
    transport: "http",
    defaultUrl: "https://mcp.supabase.com/mcp",
    auth: {
      label: "Supabase Access Token",
      placeholder: "sbp_...",
      helpUrl: "https://supabase.com/dashboard/account/tokens",
      envVar: "SUPABASE_ACCESS_TOKEN",
    },
  },
  {
    id: "github",
    name: "GitHub",
    description: "Issues, PRs y código del repo conectado",
    transport: "http",
    defaultUrl: "https://api.githubcopilot.com/mcp",
    auth: {
      label: "GitHub Personal Access Token",
      placeholder: "ghp_...",
      helpUrl: "https://github.com/settings/tokens",
      envVar: "GITHUB_PERSONAL_ACCESS_TOKEN",
    },
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Acceso de lectura/escritura al workspace del proyecto",
    transport: "stdio",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@modelcontextprotocol/server-filesystem", "{projectPath}"],
    auth: null,
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "Conexión directa a Postgres (Supabase o externo)",
    transport: "stdio",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@modelcontextprotocol/server-postgres"],
    auth: {
      label: "Connection String",
      placeholder: "postgresql://user:pass@host:5432/db",
      envVar: "POSTGRES_CONNECTION_STRING",
    },
  },
];

export function getCatalogEntry(id: string, custom?: McpCatalogEntry[]): McpCatalogEntry | undefined {
  const fromCustom = custom?.find((e) => e.id === id);
  if (fromCustom) return fromCustom;
  return MCP_CATALOG.find((e) => e.id === id);
}

export function getAllCatalogEntries(custom?: McpCatalogEntry[]): McpCatalogEntry[] {
  if (!custom || custom.length === 0) return MCP_CATALOG;
  // Merge built-in + custom, custom wins if id collides (shouldn't happen, validated)
  const map = new Map<string, McpCatalogEntry>();
  for (const e of MCP_CATALOG) map.set(e.id, e);
  for (const e of custom) map.set(e.id, e);
  return [...map.values()];
}

export function isBuiltInMcpId(id: string): boolean {
  return (MCP_CATALOG as McpCatalogEntry[]).some((e) => e.id === id);
}

export function validateCatalog(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of MCP_CATALOG) {
    if (!entry.id) errors.push(`Missing id for entry ${JSON.stringify(entry)}`);
    if (ids.has(entry.id)) errors.push(`Duplicate id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.name) errors.push(`Missing name for ${entry.id}`);
    if (!entry.description) errors.push(`Missing description for ${entry.id}`);
    if (!entry.transport || !["http", "stdio"].includes(entry.transport)) errors.push(`Invalid transport for ${entry.id}: ${entry.transport}`);
    if (entry.transport === "http" && !entry.defaultUrl) errors.push(`Missing defaultUrl for http ${entry.id}`);
    if (entry.transport === "stdio" && !entry.defaultCommand) errors.push(`Missing defaultCommand for stdio ${entry.id}`);
    if (entry.transport === "stdio" && !entry.defaultArgs) errors.push(`Missing defaultArgs for stdio ${entry.id}`);
  }
  return { ok: errors.length === 0, errors };
}

// Validar al cargar el módulo en dev para detectar errores temprano
if (process.env.NODE_ENV !== "production") {
  const validation = validateCatalog();
  if (!validation.ok) {
    console.warn("[mcp] Catalog validation failed:", validation.errors);
  }
}

/** Config no-secreta que SI syncea vía sidecar (context-sync). */
export interface ProjectMcpServerConfig {
  id: McpServerId;
  enabled: boolean;
  /** Override opcional de URL/command (para self-hosted). */
  url?: string;
  command?: string;
  args?: string[];
  /** Si el usuario tocó el config (para UI). */
  updatedAt: number;
}

export interface ProjectMcpConfig {
  version: 1;
  servers: ProjectMcpServerConfig[];
  /** Definiciones de MCPs personalizados (agregados por el usuario). */
  customServers?: McpCatalogEntry[];
  /** Built-ins que el usuario ocultó (no se muestran en el catálogo). */
  hiddenServers?: McpServerId[];
}

export function defaultProjectMcpConfig(): ProjectMcpConfig {
  return {
    version: 1,
    servers: MCP_CATALOG.map((e) => ({
      id: e.id,
      enabled: false,
      updatedAt: 0,
    })),
    customServers: [],
    hiddenServers: [],
  };
}

export function sanitizeCatalogEntry(raw: unknown): McpCatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!id || !/^[a-z0-9_-]{2,32}$/.test(id)) return null;
  if (isBuiltInMcpId(id)) return null; // custom no puede pisar built-in
  const name = typeof r.name === "string" ? r.name.trim() : "";
  const description = typeof r.description === "string" ? r.description.trim() : "";
  const transport = r.transport === "http" || r.transport === "stdio" ? r.transport : null;
  if (!name || !description || !transport) return null;
  const entry: McpCatalogEntry = {
    id: id as McpServerId,
    name,
    description,
    transport,
    auth: null,
  };
  if (transport === "http") {
    if (typeof r.defaultUrl !== "string" || !r.defaultUrl) return null;
    try { new URL(r.defaultUrl); } catch { return null; }
    entry.defaultUrl = r.defaultUrl;
  } else {
    if (typeof r.defaultCommand !== "string" || !r.defaultCommand) return null;
    entry.defaultCommand = r.defaultCommand;
    if (!Array.isArray(r.defaultArgs)) return null;
    entry.defaultArgs = (r.defaultArgs as unknown[]).filter((a): a is string => typeof a === "string");
  }
  if (r.auth && typeof r.auth === "object") {
    const a = r.auth as Record<string, unknown>;
    if (typeof a.label === "string" && typeof a.placeholder === "string" && typeof a.envVar === "string" && a.envVar) {
      entry.auth = {
        label: a.label,
        placeholder: a.placeholder,
        helpUrl: typeof a.helpUrl === "string" ? a.helpUrl : undefined,
        envVar: a.envVar,
      };
    }
  }
  return entry;
}

export function sanitizeProjectMcpConfig(raw: unknown): ProjectMcpConfig {
  if (!raw || typeof raw !== "object") return defaultProjectMcpConfig();
  const r = raw as Record<string, unknown>;
  const serversRaw = Array.isArray(r.servers) ? r.servers : [];
  const customRaw = Array.isArray(r.customServers) ? r.customServers : [];
  const hiddenRaw = Array.isArray(r.hiddenServers) ? r.hiddenServers : [];
  const customServers: McpCatalogEntry[] = [];
  for (const c of customRaw) {
    const s = sanitizeCatalogEntry(c);
    if (s) customServers.push(s);
  }
  const customIds = new Set(customServers.map((c) => c.id));
  const builtInIds = new Set(MCP_CATALOG.map((e) => e.id));
  const hiddenServers: McpServerId[] = [];
  for (const h of hiddenRaw) {
    if (typeof h !== "string") continue;
    if (!builtInIds.has(h)) continue;
    if (hiddenServers.includes(h as McpServerId)) continue;
    hiddenServers.push(h as McpServerId);
  }
  const allowedIds = new Set([...MCP_CATALOG.map((e) => e.id), ...customIds]);

  const servers: ProjectMcpServerConfig[] = [];
  for (const s of serversRaw) {
    if (!s || typeof s !== "object") continue;
    const ss = s as Record<string, unknown>;
    if (typeof ss.id !== "string" || !allowedIds.has(ss.id)) continue;
    if (typeof ss.enabled !== "boolean") continue;
    // Si está oculto, no lo restauramos en servers (queda escondido)
    if (hiddenServers.includes(ss.id as McpServerId)) continue;
    servers.push({
      id: ss.id as McpServerId,
      enabled: ss.enabled,
      ...(typeof ss.url === "string" && ss.url ? { url: ss.url } : {}),
      ...(typeof ss.command === "string" && ss.command ? { command: ss.command } : {}),
      ...(Array.isArray(ss.args) ? { args: ss.args.filter((a): a is string => typeof a === "string") } : {}),
      updatedAt: typeof ss.updatedAt === "number" ? ss.updatedAt : 0,
    });
  }
  // Asegurar que todos los ids del catálogo existan (migración aditiva) salvo ocultos
  for (const cat of MCP_CATALOG) {
    if (hiddenServers.includes(cat.id as McpServerId)) continue;
    if (!servers.find((s) => s.id === cat.id)) {
      servers.push({ id: cat.id, enabled: false, updatedAt: 0 });
    }
  }
  for (const custom of customServers) {
    if (!servers.find((s) => s.id === custom.id)) {
      servers.push({ id: custom.id, enabled: false, updatedAt: 0 });
    }
  }
  return { version: 1, servers, customServers, hiddenServers };
}

/** Estado por servidor expuesto al renderer (config + conexión + auth). */
export interface McpServerState {
  catalog: McpCatalogEntry;
  config: ProjectMcpServerConfig;
  status: McpConnectionStatus;
  /** Solo para UI: si hay secreto guardado en este device. Nunca expone el valor. */
  hasSecret: boolean;
  lastError?: string;
  toolCount?: number;
}

/** Respuesta IPC mcp:status para un proyecto. */
export interface ProjectMcpStatus {
  projectId: string;
  projectPath: string;
  servers: McpServerState[];
}

/** Scope futuro: hoy todo es "project" (todos los LLMs/terminales). */
export type McpScope = "project" | "terminal" | "agent";

export interface McpToolRef {
  serverId: McpServerId;
  name: string;
  description?: string;
  inputSchema?: unknown;
}
