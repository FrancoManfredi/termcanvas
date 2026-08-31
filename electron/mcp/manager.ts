/**
 * McpManager — lifecycle de conexiones MCP por proyecto.
 *
 * v1: catálogo cerrado, sin spawn real obligatorio. El manager:
 * - Mantiene estado por proyecto/servidor (disconnected/connecting/connected/needs_auth/error)
 * - Valida que si un server requiere secreto y no hay en vault -> needs_auth
 * - Para "http" sin secreto (filesystem/fetch) -> connected directo tras toggle
 * - Para "stdio" -> simula conexión (en v2 hará spawn npx)
 *
 * Futuro: reemplazar simulateConnect con Client de @modelcontextprotocol/sdk
 * y tool discovery real. La interfaz ya es compatible: getToolsForProject()
 * devuelve ToolRefs que AgentService inyecta.
 *
 * Scope actual: "project" (todos los LLMs/terminales). El campo `scope`
 * y `getToolsForScope()` dejan la puerta abierta a terminal/agent sin romper.
 */

import type {
  McpServerId,
  McpConnectionStatus,
  McpServerState,
  McpCatalogEntry,
  ProjectMcpConfig,
  ProjectMcpServerConfig,
  ProjectMcpStatus,
  McpToolRef,
  McpScope,
} from "../../shared/mcp.ts";
import { MCP_CATALOG, getCatalogEntry, defaultProjectMcpConfig, sanitizeProjectMcpConfig } from "../../shared/mcp.ts";
import { McpVault } from "./vault.ts";
import { probeLocal, probeLocalWithHandshake } from "./health/local-probe.ts";

type StatusMap = Map<string, McpConnectionStatus>;
type ErrorMap = Map<string, string | undefined>;
type ToolCountMap = Map<string, number>;

function mapKey(projectId: string, serverId: McpServerId): string {
  return `${projectId}::${serverId}`;
}

export interface McpManagerDeps {
  vault?: McpVault;
  /** Para tests: override del conectador real. */
  connector?: (projectId: string, serverId: McpServerId, config: ProjectMcpServerConfig) => Promise<{ ok: boolean; toolCount?: number; error?: string }>;
}

export class McpManager {
  private vault: McpVault;
  private connector?: McpManagerDeps["connector"];
  /** Config no-secreta por proyecto (la que syncea). En memoria; persistida en state.json + sidecar. */
  private configs = new Map<string, ProjectMcpConfig>();
  private statuses: StatusMap = new Map();
  private errors: ErrorMap = new Map();
  private toolCounts: ToolCountMap = new Map();
  /** Listener para push a renderer (status cambiado). */
  private onChange?: (projectId: string) => void;

  constructor(deps: McpManagerDeps = {}) {
    this.vault = deps.vault ?? new McpVault();
    this.connector = deps.connector;
  }

  setChangeListener(fn: (projectId: string) => void): void {
    this.onChange = fn;
  }

  /** Carga o crea config para un proyecto. */
  getConfig(projectId: string): ProjectMcpConfig {
    const existing = this.configs.get(projectId);
    if (existing) return existing;
    const def = defaultProjectMcpConfig();
    this.configs.set(projectId, def);
    return def;
  }

  /** Hidrata desde persistencia (state.json o sidecar). */
  hydrateConfig(projectId: string, raw: unknown): void {
    const sanitized = sanitizeProjectMcpConfig(raw);
    this.configs.set(projectId, sanitized);
    // Recalcular estados iniciales
    for (const s of sanitized.servers) {
      if (!s.enabled) {
        this.statuses.set(mapKey(projectId, s.id), "disconnected");
      } else {
        // se evaluará async en ensureStatus; por ahora needs_auth optimista si requiere
        const entry = getCatalogEntry(s.id, sanitized.customServers);
        if (entry?.auth) {
          this.statuses.set(mapKey(projectId, s.id), "needs_auth");
        } else {
          this.statuses.set(mapKey(projectId, s.id), "disconnected");
        }
      }
    }
  }

  getRawConfig(projectId: string): ProjectMcpConfig {
    return this.getConfig(projectId);
  }

  private getAllCatalogForProject(projectId: string): McpCatalogEntry[] {
    const cfg = this.getConfig(projectId);
    const hidden = new Set(cfg.hiddenServers ?? []);
    // Merge built-in + custom, filtrando ocultos
    const custom = cfg.customServers ?? [];
    const map = new Map<string, McpCatalogEntry>();
    for (const e of MCP_CATALOG) {
      if (hidden.has(e.id as McpServerId)) continue;
      map.set(e.id, e);
    }
    for (const e of custom) map.set(e.id, e);
    return [...map.values()];
  }

  private getCatalogForProject(projectId: string, serverId: string): McpCatalogEntry | undefined {
    const cfg = this.getConfig(projectId);
    return getCatalogEntry(serverId, cfg.customServers);
  }

  private async hasEffectiveSecret(projectId: string, cat: McpCatalogEntry): Promise<boolean> {
    if (!cat.auth) return true; // no requiere
    try {
      if (await this.vault.hasSecret(projectId, cat.id)) return true;
    } catch {}
    // Fallback: variable de entorno global (ej. GITHUB_PERSONAL_ACCESS_TOKEN en el sistema)
    const envVar = cat.auth.envVar;
    if (envVar && process.env[envVar] && String(process.env[envVar]).trim().length > 0) return true;
    return false;
  }

  private async getEffectiveToken(projectId: string, cat: McpCatalogEntry): Promise<string | null> {
    if (!cat.auth) return null;
    try {
      const fromVault = await this.getSecret(projectId, cat.id);
      if (fromVault) return fromVault;
    } catch {}
    const envVar = cat.auth.envVar;
    if (envVar && process.env[envVar]) return String(process.env[envVar]);
    return null;
  }

  async checkHealth(projectId: string, serverId: McpServerId, projectPath: string): Promise<{ ok: boolean; latencyMs?: number; error?: string; details?: string }> {
    const cat = this.getCatalogForProject(projectId, serverId);
    if (!cat) return { ok: false, error: `MCP desconocido: ${serverId}` };
    const cfg = this.getConfig(projectId);
    const conf = cfg.servers.find((s) => s.id === serverId);
    if (!conf?.enabled) return { ok: false, error: "MCP desactivado" };

    const hasSecret = await this.hasEffectiveSecret(projectId, cat);
    if (cat.auth && !hasSecret) {
      return { ok: false, error: "Falta token — ingresalo o define " + (cat.auth.envVar ?? "la variable de entorno") };
    }

    const start = Date.now();
    try {
      if (cat.transport === "http") {
        const url = conf.url ?? cat.defaultUrl ?? "";
        if (!url) return { ok: false, error: "URL no configurada" };
        const token = await this.getEffectiveToken(projectId, cat);
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        // MCP sobre HTTP usa JSON-RPC; un POST a /mcp con initialize debería responder 200/401, no red ni timeout
        // Si el servidor no soporta POST, un GET también sirve para chequear conectividad.
        let res: Response | null = null;
        try {
          res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "termcanvas-health", version: "1.0.0" } } }),
            signal: controller.signal,
          });
        } catch {
          // Fallback a GET si POST falla por método no permitido
          try {
            res = await fetch(url, { method: "GET", headers, signal: controller.signal });
          } catch (e2) {
            clearTimeout(timeout);
            throw e2;
          }
        }
        clearTimeout(timeout);
        const latencyMs = Date.now() - start;
        if (!res) return { ok: false, error: "Sin respuesta", latencyMs };
        if (res.status === 401 || res.status === 403) return { ok: false, error: `Auth falló (${res.status}) — revisá el token`, latencyMs, details: `HTTP ${res.status}` };
        if (res.status >= 200 && res.status < 500) return { ok: true, latencyMs, details: `HTTP ${res.status}` };
        return { ok: false, error: `HTTP ${res.status}`, latencyMs, details: `HTTP ${res.status}` };
      } else {
        // local: health debe probar con el token real, sino opencode fallará aunque npx exista
        const command = conf.command ?? cat.defaultCommand ?? "npx";
        const args = conf.args ?? cat.defaultArgs ?? [];
        const token = cat.auth ? await this.getEffectiveToken(projectId, cat) : null;
        const env: Record<string, string> = {};
        if (cat.auth?.envVar && token) env[cat.auth.envVar] = token;
        const result = await probeLocalWithHandshake(command, args, projectPath, 7000, env);
        const latencyMs = Date.now() - start;
        if (result.ok) return { ok: true, latencyMs, details: result.details };
        // Si el error es por falta de API key, reportarlo claro (no enmascarar como npx ok)
        if (result.details?.includes("No API Key") || result.error?.includes("No API Key") || result.details?.includes("API Key") || result.error?.includes("API_KEY")) {
          return { ok: false, error: result.error, latencyMs, details: result.details };
        }
        if (result.error?.includes("Connection closed") && command === "npx") {
          const quick = await probeLocal(command, args, 3000);
          if (quick.ok) return { ok: true, latencyMs, details: `${result.error} — pero npx disponible, reintento puede funcionar` };
        }
        return { ok: false, error: result.error, latencyMs, details: result.details };
      }
    } catch (e) {
      const latencyMs = Date.now() - start;
      if (e instanceof Error && e.name === "AbortError") return { ok: false, error: "Timeout (5s) — el servidor no responde", latencyMs };
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs };
    }
  }

  /** Lista catálogo con estado para UI. */
  async getStatus(projectId: string, projectPath: string): Promise<ProjectMcpStatus> {
    const cfg = this.getConfig(projectId);
    const servers: McpServerState[] = [];
    const allCatalog = this.getAllCatalogForProject(projectId);
    for (const cat of allCatalog) {
      const conf = cfg.servers.find((s) => s.id === cat.id) ?? { id: cat.id, enabled: false, updatedAt: 0 };
      const key = mapKey(projectId, cat.id);
      let status: McpConnectionStatus | undefined = this.statuses.get(key);

      // Si nunca hubo estado explícito, inferir según enabled (evita mostrar "desconectado" falso para enabled)
      if (!status) {
        status = conf.enabled ? "connected" : "disconnected";
        // Para enabled sin estado previo, darle toolCount simulado para que la UI no parezca vacía
        if (conf.enabled && !this.toolCounts.has(key)) {
          // No seteamos aún en el map para no ocultar un futuro error; getStatus lo materializará si corresponde
        }
      }

      let hasSecret = false;
      if (cat.auth) {
        hasSecret = await this.hasEffectiveSecret(projectId, cat);
        if (!conf.enabled) {
          // Desactivado siempre es disconnected, limpiar estados previos de auth
          if (status === "needs_auth" || status === "connected" || status === "connecting" || status === "error") {
            status = "disconnected";
            this.statuses.set(key, status);
          }
        } else if (!hasSecret) {
          // Habilitado pero sin secreto => necesita auth (cross-device)
          if (status !== "needs_auth") {
            status = "needs_auth";
            this.statuses.set(key, status);
          }
        } else {
          // Habilitado y con secreto => debe verse conectado salvo que esté explícitamente en error/connecting
          if (status === "needs_auth" || status === "disconnected") {
            status = "connected";
            if (!this.toolCounts.has(key)) {
              this.toolCounts.set(key, cat.id === "supabase" ? 8 : cat.id === "github" ? 12 : cat.id === "filesystem" ? 5 : 3);
            }
            this.statuses.set(key, status);
          }
          // Si ya es connected/connecting/error se respeta
        }
      } else {
        hasSecret = false;
        if (!conf.enabled) {
          if (status !== "disconnected") {
            status = "disconnected";
            this.statuses.set(key, status);
          }
        } else {
          // sin auth y enabled => conectado salvo error/connecting
          if (status === "needs_auth" || status === "disconnected") {
            status = "connected";
            if (!this.toolCounts.has(key)) {
              this.toolCounts.set(key, cat.id === "filesystem" ? 5 : 3);
            }
            this.statuses.set(key, status);
          }
        }
      }

      // Si está conectado pero nunca se asignó toolCount (ej. tras hydrate), asignar default para no mostrar vacío
      if (status === "connected" && !this.toolCounts.has(key)) {
        this.toolCounts.set(key, cat.id === "supabase" ? 8 : cat.id === "github" ? 12 : cat.id === "filesystem" ? 5 : 3);
      }

      servers.push({
        catalog: cat,
        config: conf,
        status,
        hasSecret,
        lastError: this.errors.get(key),
        toolCount: this.toolCounts.get(key),
      });
    }
    return { projectId, projectPath, servers };
  }

  /** Toggle enabled para un server. Retorna el nuevo status. */
  async setEnabled(projectId: string, serverId: McpServerId, enabled: boolean): Promise<{ ok: boolean; status: McpConnectionStatus; error?: string }> {
    const cat = this.getCatalogForProject(projectId, serverId);
    if (!cat) return { ok: false, status: "error", error: `MCP desconocido: ${serverId}` };
    const cfg = this.getConfig(projectId);
    const idx = cfg.servers.findIndex((s) => s.id === serverId);
    if (idx >= 0) {
      cfg.servers[idx] = { ...cfg.servers[idx], enabled, updatedAt: Date.now() };
    } else {
      cfg.servers.push({ id: serverId, enabled, updatedAt: Date.now() });
    }
    const key = mapKey(projectId, serverId);
    if (!enabled) {
      this.statuses.set(key, "disconnected");
      this.errors.delete(key);
      this.toolCounts.delete(key);
      this.onChange?.(projectId);
      return { ok: true, status: "disconnected" };
    }
    // Habilitado -> validar secreto si requiere (vault o env var del sistema)
    if (cat.auth) {
      const hasSecret = await this.hasEffectiveSecret(projectId, cat);
      if (!hasSecret) {
        this.statuses.set(key, "needs_auth");
        this.onChange?.(projectId);
        return { ok: true, status: "needs_auth" };
      }
    }
    // Validación previa para local: verificar que el comando existe antes de intentar conectar
    if (cat.transport === "stdio") {
      const command = cat.defaultCommand ?? "npx";
      const args = cat.defaultArgs ?? [];
      const probe = await probeLocal(command, args, 4000);
      if (!probe.ok) {
        this.statuses.set(key, "error");
        this.errors.set(key, probe.error ?? "No se pudo verificar el comando");
        this.onChange?.(projectId);
        return { ok: false, status: "error", error: probe.error };
      }
    }
    // Intentar conectar
    return this.connect(projectId, serverId);
  }

  async setSecret(projectId: string, serverId: McpServerId, token: string | null): Promise<{ ok: boolean; status: McpConnectionStatus; error?: string }> {
    const cat = this.getCatalogForProject(projectId, serverId);
    if (!cat) return { ok: false, status: "error", error: `MCP desconocido: ${serverId}` };
    if (!cat.auth && token) {
      return { ok: false, status: "error", error: `${cat.name} no requiere secreto` };
    }
    await this.vault.setSecret(projectId, serverId, token);
    const cfg = this.getConfig(projectId);
    const conf = cfg.servers.find((s) => s.id === serverId);
    // Si está habilitado y ahora hay secreto -> intentar conectar
    if (conf?.enabled && token) {
      return this.connect(projectId, serverId);
    }
    if (conf?.enabled && !token) {
      const key = mapKey(projectId, serverId);
      this.statuses.set(key, "needs_auth");
      this.onChange?.(projectId);
      return { ok: true, status: "needs_auth" };
    }
    this.onChange?.(projectId);
    return { ok: true, status: this.statuses.get(mapKey(projectId, serverId)) ?? "disconnected" };
  }

  async connect(projectId: string, serverId: McpServerId): Promise<{ ok: boolean; status: McpConnectionStatus; error?: string }> {
    const key = mapKey(projectId, serverId);
    this.statuses.set(key, "connecting");
    this.errors.delete(key);
    this.onChange?.(projectId);

    if (this.connector) {
      const catCfg = this.getConfig(projectId).servers.find((s) => s.id === serverId);
      if (!catCfg) return { ok: false, status: "error", error: "config no encontrada" };
      const res = await this.connector(projectId, serverId, catCfg);
      if (res.ok) {
        this.statuses.set(key, "connected");
        if (typeof res.toolCount === "number") this.toolCounts.set(key, res.toolCount);
        this.onChange?.(projectId);
        return { ok: true, status: "connected" };
      } else {
        this.statuses.set(key, "error");
        this.errors.set(key, res.error ?? "Error de conexión");
        this.onChange?.(projectId);
        return { ok: false, status: "error", error: res.error };
      }
    }

    // Simulación v1: http con secreto -> connected, stdio -> connected directo
    // En v2 aquí se instancia el SDK client y se hace list_tools
    await new Promise((r) => setTimeout(r, 300));
    const cat = this.getCatalogForProject(projectId, serverId);
    if (cat?.transport === "http" && cat.auth) {
      const hasSecret = await this.hasEffectiveSecret(projectId, cat);
      if (!hasSecret) {
        this.statuses.set(key, "needs_auth");
        this.errors.set(key, "Falta token — re-autenticá en este dispositivo o define " + (cat.auth.envVar ?? "la variable de entorno"));
        this.onChange?.(projectId);
        return { ok: false, status: "needs_auth", error: "Falta token" };
      }
    }
    // Éxito simulado
    this.statuses.set(key, "connected");
    this.toolCounts.set(key, cat?.id === "supabase" ? 8 : cat?.id === "github" ? 12 : cat?.id === "filesystem" ? 5 : 3);
    this.onChange?.(projectId);
    return { ok: true, status: "connected" };
  }

  disconnect(projectId: string, serverId: McpServerId): void {
    const key = mapKey(projectId, serverId);
    this.statuses.set(key, "disconnected");
    this.errors.delete(key);
    this.toolCounts.delete(key);
    this.onChange?.(projectId);
  }

  disconnectAll(projectId: string): void {
    for (const cat of this.getAllCatalogForProject(projectId)) {
      this.disconnect(projectId, cat.id);
    }
  }

  /** Para AgentService: tools disponibles para un proyecto (scope=project por ahora). */
  async getToolsForProject(projectId: string, _scope: McpScope = "project"): Promise<McpToolRef[]> {
    const cfg = this.getConfig(projectId);
    const out: McpToolRef[] = [];
    for (const s of cfg.servers) {
      if (!s.enabled) continue;
      const key = mapKey(projectId, s.id);
      const status = this.statuses.get(key);
      if (status !== "connected") continue;
      const count = this.toolCounts.get(key) ?? 0;
      // En v1 generamos tools stub; en v2 vendrán del MCP server real
      for (let i = 0; i < count; i++) {
        out.push({
          serverId: s.id,
          name: `${s.id}__tool_${i + 1}`,
          description: `Tool ${i + 1} de ${s.id} (stub v1)`,
        });
      }
    }
    return out;
  }

  async getSecret(projectId: string, serverId: McpServerId): Promise<string | null> {
    try {
      const secrets = await this.vault.load(projectId);
      return (secrets as Record<string, string>)[serverId] ?? null;
    } catch {
      return null;
    }
  }

  /** Usado al borrar proyecto o deshabilitar todos. */
  async clearProject(projectId: string): Promise<void> {
    const cfg = this.configs.get(projectId);
    const allIds = cfg ? [...cfg.servers.map((s) => s.id), ...(cfg.customServers?.map((c) => c.id) ?? [])] : this.getAllCatalogForProject(projectId).map((c) => c.id);
    this.configs.delete(projectId);
    for (const id of allIds) {
      const k = mapKey(projectId, id as McpServerId);
      this.statuses.delete(k);
      this.errors.delete(k);
      this.toolCounts.delete(k);
    }
    await this.vault.deleteProject(projectId);
  }

  async addCustom(projectId: string, entry: McpCatalogEntry): Promise<{ ok: boolean; error?: string }> {
    const { sanitizeCatalogEntry, isBuiltInMcpId } = await import("../../shared/mcp.ts");
    const sanitized = sanitizeCatalogEntry(entry);
    if (!sanitized) return { ok: false, error: "Definición de MCP inválida" };
    if (isBuiltInMcpId(sanitized.id)) return { ok: false, error: `El id "${sanitized.id}" colisiona con un MCP built-in` };
    const cfg = this.getConfig(projectId);
    const custom = cfg.customServers ?? [];
    if (custom.find((c) => c.id === sanitized.id) || cfg.servers.find((s) => s.id === sanitized.id)) {
      return { ok: false, error: `Ya existe un MCP con id "${sanitized.id}"` };
    }
    custom.push(sanitized);
    cfg.customServers = custom;
    // Crear server config desactivado
    cfg.servers.push({ id: sanitized.id, enabled: false, updatedAt: Date.now() });
    this.statuses.set(mapKey(projectId, sanitized.id), "disconnected");
    this.onChange?.(projectId);
    return { ok: true };
  }

  async updateCustom(projectId: string, id: string, patch: Partial<McpCatalogEntry>): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.getConfig(projectId);
    const custom = cfg.customServers ?? [];
    const idx = custom.findIndex((c) => c.id === id);
    if (idx === -1) return { ok: false, error: `MCP custom no encontrado: ${id}` };
    // No permitir cambiar id a uno que colisione
    if (patch.id && patch.id !== id) {
      const { isBuiltInMcpId } = await import("../../shared/mcp.ts");
      if (isBuiltInMcpId(patch.id)) return { ok: false, error: `El id "${patch.id}" colisiona con un MCP built-in` };
      if (custom.find((c) => c.id === patch.id) || cfg.servers.find((s) => s.id === patch.id)) return { ok: false, error: `Ya existe un MCP con id "${patch.id}"` };
    }
    const merged = { ...custom[idx], ...patch };
    const { sanitizeCatalogEntry } = await import("../../shared/mcp.ts");
    const sanitized = sanitizeCatalogEntry(merged);
    if (!sanitized) return { ok: false, error: "Definición de MCP inválida tras el parche" };
    // Si cambió id, renombrar server config y estado
    if (patch.id && patch.id !== id) {
      const srvIdx = cfg.servers.findIndex((s) => s.id === id);
      if (srvIdx !== -1) cfg.servers[srvIdx] = { ...cfg.servers[srvIdx], id: patch.id as McpServerId };
      const oldKey = mapKey(projectId, id as McpServerId);
      const newKey = mapKey(projectId, patch.id as McpServerId);
      if (this.statuses.has(oldKey)) {
        this.statuses.set(newKey, this.statuses.get(oldKey)!);
        this.statuses.delete(oldKey);
      }
      if (this.errors.has(oldKey)) {
        this.errors.set(newKey, this.errors.get(oldKey));
        this.errors.delete(oldKey);
      }
      if (this.toolCounts.has(oldKey)) {
        this.toolCounts.set(newKey, this.toolCounts.get(oldKey)!);
        this.toolCounts.delete(oldKey);
      }
      // Vault: mover secreto si existe
      try {
        const secrets = await this.vault.load(projectId);
        const oldSecret = (secrets as Record<string, string>)[id];
        if (oldSecret) {
          await this.vault.setSecret(projectId, patch.id as McpServerId, oldSecret);
          await this.vault.setSecret(projectId, id as McpServerId, null);
        }
      } catch {}
    }
    custom[idx] = sanitized;
    cfg.customServers = custom;
    this.onChange?.(projectId);
    return { ok: true };
  }

  async removeCustom(projectId: string, id: string): Promise<{ ok: boolean; error?: string }> {
    const { isBuiltInMcpId } = await import("../../shared/mcp.ts");
    if (isBuiltInMcpId(id)) return { ok: false, error: `No se puede eliminar un MCP built-in` };
    const cfg = this.getConfig(projectId);
    const custom = cfg.customServers ?? [];
    const idx = custom.findIndex((c) => c.id === id);
    if (idx === -1) return { ok: false, error: `MCP custom no encontrado: ${id}` };
    custom.splice(idx, 1);
    cfg.customServers = custom;
    cfg.servers = cfg.servers.filter((s) => s.id !== id);
    const key = mapKey(projectId, id as McpServerId);
    this.statuses.delete(key);
    this.errors.delete(key);
    this.toolCounts.delete(key);
    try { await this.vault.setSecret(projectId, id as McpServerId, null); } catch {}
    this.onChange?.(projectId);
    return { ok: true };
  }

  async hideBuiltIn(projectId: string, id: string): Promise<{ ok: boolean; error?: string }> {
    const { isBuiltInMcpId } = await import("../../shared/mcp.ts");
    if (!isBuiltInMcpId(id)) return { ok: false, error: `Solo se pueden ocultar MCPs del catálogo` };
    const cfg = this.getConfig(projectId);
    cfg.hiddenServers = cfg.hiddenServers ?? [];
    if (cfg.hiddenServers.includes(id as McpServerId)) return { ok: true };
    cfg.hiddenServers.push(id as McpServerId);
    // Quitar de servers para que no reaparezca como disabled
    cfg.servers = cfg.servers.filter((s) => s.id !== id);
    const key = mapKey(projectId, id as McpServerId);
    this.statuses.delete(key);
    this.errors.delete(key);
    this.toolCounts.delete(key);
    try { await this.vault.setSecret(projectId, id as McpServerId, null); } catch {}
    this.onChange?.(projectId);
    return { ok: true };
  }

  async restoreBuiltIn(projectId: string, id: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.getConfig(projectId);
    const hidden = cfg.hiddenServers ?? [];
    const idx = hidden.indexOf(id as McpServerId);
    if (idx === -1) return { ok: false, error: `MCP no está oculto: ${id}` };
    hidden.splice(idx, 1);
    cfg.hiddenServers = hidden;
    if (!cfg.servers.find((s) => s.id === id)) {
      cfg.servers.push({ id: id as McpServerId, enabled: false, updatedAt: Date.now() });
    }
    this.statuses.set(mapKey(projectId, id as McpServerId), "disconnected");
    this.onChange?.(projectId);
    return { ok: true };
  }

  /** Para tests: forzar estado. */
  _setStatusForTest(projectId: string, serverId: McpServerId, status: McpConnectionStatus, toolCount?: number): void {
    this.statuses.set(mapKey(projectId, serverId), status);
    if (typeof toolCount === "number") this.toolCounts.set(mapKey(projectId, serverId), toolCount);
  }
}
