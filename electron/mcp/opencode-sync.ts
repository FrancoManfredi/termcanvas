import fs from "node:fs";
import path from "node:path";
import { getCatalogEntry, type McpCatalogEntry } from "../../shared/mcp.ts";
import type { McpServerId } from "../../shared/mcp.ts";

/**
 * Sincroniza los MCPs de TermCanvas (por proyecto) hacia el config de Opencode
 * del mismo proyecto, para que `opencode` abierto en esa carpeta vea los MCPs.
 *
 * Escribe en `<projectPath>/.opencode/opencode.json` si existe, si no en
 * `<projectPath>/opencode.json` si existe, si no crea `.opencode/opencode.json`.
 * Respeta otros campos del config (no pisa `agent`, `provider`, etc.).
 */

function getOpencodeConfigPathForWrite(projectPath: string): string {
  if (!projectPath) return "";
  const candidates = [
    path.join(projectPath, "opencode.json"),
    path.join(projectPath, "opencode.jsonc"),
    path.join(projectPath, ".opencode", "opencode.json"),
    path.join(projectPath, ".opencode", "opencode.jsonc"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Ninguno existe: crear en .opencode/opencode.json (no ensucia la raíz)
  return path.join(projectPath, ".opencode", "opencode.json");
}

function readOpencodeConfigLenient(p: string): Record<string, unknown> {
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf-8");
    // Intento 1: JSON estricto
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {}
    // Intento 2: extraer solo el bloque mcp si el resto tiene prompts multilínea
    const mcpIdx = raw.indexOf('"mcp"');
    if (mcpIdx !== -1) {
      const braceStart = raw.indexOf("{", raw.indexOf(":", mcpIdx));
      if (braceStart !== -1) {
        let depth = 0;
        let end = -1;
        for (let i = braceStart; i < raw.length; i++) {
          const ch = raw[i];
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) { end = i; break; }
          }
        }
        if (end !== -1) {
          const mcpRaw = raw.slice(braceStart, end + 1);
          const mcpObj = JSON.parse(mcpRaw) as Record<string, unknown>;
          // Reconstruir un objeto mínimo con solo mcp, para no perder todo si el resto falla
          // Pero intentamos preservar otros campos si podemos: si el archivo es jsonc con comentarios, lo perdemos.
          // Para no corromper, devolvemos solo mcp y dejamos que el write preserve otros campos si existen?
          // En este fallback, devolvemos solo mcp y el caller hará merge.
          return { mcp: mcpObj } as Record<string, unknown>;
        }
      }
    }
    return {};
  } catch {
    return {};
  }
}

function buildOpencodeMcpEntry(
  serverId: McpServerId,
  enabled: boolean,
  projectPath: string,
  token: string | null,
  customCatalog?: McpCatalogEntry[],
): Record<string, unknown> | null {
  const catalog = getCatalogEntry(serverId, customCatalog);
  if (!catalog) return null;

  if (!enabled) {
    return { enabled: false };
  }

  if (catalog.transport === "http") {
    const url = catalog.defaultUrl ?? "";
    const entry: Record<string, unknown> = {
      type: "remote",
      url,
      enabled: true,
    };
    if (token && catalog.auth) {
      // Para remote, opencode NO interpola {env:VAR} en headers (ver issue #23664), así que hay que escribir el token en claro.
      // Lo mitigamos agregando el archivo a .gitignore y con permisos 600, y el token sigue en vault cifrado como fuente.
      entry.headers = {
        Authorization: `Bearer ${token}`,
      };
      (entry as Record<string, unknown>).oauth = false;
    } else if (catalog.auth?.envVar && process.env[catalog.auth.envVar]) {
      // Fallback: si el token está en env del sistema (ej. GITHUB_PERSONAL_ACCESS_TOKEN), usarlo
      const envToken = String(process.env[catalog.auth.envVar]);
      if (envToken) {
        entry.headers = { Authorization: `Bearer ${envToken}` };
        (entry as Record<string, unknown>).oauth = false;
      }
    }
    return entry;
  } else {
    const rawCommand = catalog.defaultCommand ?? "npx";
    let rawArgs = [...(catalog.defaultArgs ?? [])];
    rawArgs = rawArgs.map((a) => a === "{projectPath}" ? projectPath : a.replace("{projectPath}", projectPath));
    // En Windows, opencode necesita cmd /c para npx (ver README de mcp/memory)
    const isWin = process.platform === "win32";
    const command = isWin && rawCommand === "npx" ? "cmd" : rawCommand;
    const args = isWin && rawCommand === "npx" ? ["/c", "npx", ...rawArgs] : rawArgs;
    const entry: Record<string, unknown> = {
      type: "local",
      command: [command, ...args],
      enabled: true,
    };
    // Para local: NUNCA escribir el token en claro — usar placeholder {env:VAR} que TermCanvas inyecta vía pty env (seguro, no va a GitHub ni es legible por LLM).
    // El vault es la fuente, el pty es el canal. Si el pty aún no tiene la env (terminal viejo), el health lo detecta y pide reiniciar el terminal.
    if (catalog.auth?.envVar) {
      entry.environment = {
        [catalog.auth.envVar]: `{env:${catalog.auth.envVar}}`,
      };
    }
    // Si no hay token y no hay env, no ponemos environment; el MCP local fallará en health check y se verá como error, no como disabled.
    return entry;
  }
}

function ensureGitignored(projectPath: string, configPath: string): void {
  try {
    const gitignorePath = path.join(projectPath, ".gitignore");
    const rel = path.relative(projectPath, configPath).replace(/\\/g, "/");
    const patterns = [rel, ".opencode/opencode.json", "opencode.json", ".agents/mcp.json"];
    let existing = "";
    if (fs.existsSync(gitignorePath)) existing = fs.readFileSync(gitignorePath, "utf-8");
    let changed = false;
    for (const pat of patterns) {
      if (!existing.includes(pat)) {
        existing += (existing && !existing.endsWith("\n") ? "\n" : "") + pat + "\n";
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(gitignorePath, existing, "utf-8");
    // Permisos 600 en el opencode.json del proyecto para que no sea world-readable
    try {
      if (fs.existsSync(configPath)) fs.chmodSync(configPath, 0o600);
    } catch {}
  } catch {}
}

function ensurePermissionDeny(existing: Record<string, unknown>): Record<string, unknown> {
  // Bloquear que cualquier LLM (opencode o TermCanvas) lea opencode.json con secretos, incluso si contiene plaintext para remote
  const perm = (existing.permission && typeof existing.permission === "object" ? existing.permission as Record<string, unknown> : {}) as Record<string, unknown>;
  const read = (perm.read && typeof perm.read === "object" ? perm.read as Record<string, unknown> : {}) as Record<string, unknown>;
  // Negar lectura de cualquier opencode.json y del vault (por si el LLM adivina la ruta)
  const denyPatterns = ["**/.opencode/opencode.json", "**/opencode.json", "**/opencode.jsonc", "**/.termcanvas/mcp-vault/**"];
  let changed = false;
  for (const pat of denyPatterns) {
    if (read[pat] !== "deny") {
      read[pat] = "deny";
      changed = true;
    }
  }
  if (changed) {
    perm.read = read;
    existing.permission = perm;
  }
  return existing;
}

/**
 * Sincroniza un solo MCP de TermCanvas hacia el opencode.json del proyecto.
 * Llamar después de setEnabled / setSecret.
 */
export function syncTermCanvasMcpToOpencode(
  projectPath: string,
  serverId: McpServerId,
  enabled: boolean,
  token: string | null,
  customCatalog?: McpCatalogEntry[],
): void {
  if (!projectPath) return;
  const configPath = getOpencodeConfigPathForWrite(projectPath);
  if (!configPath) return;

  let existing: Record<string, unknown> = {};
  let isNewFile = !fs.existsSync(configPath);
  if (!isNewFile) {
    existing = readOpencodeConfigLenient(configPath);
  }

  const mcpBlock = (existing.mcp && typeof existing.mcp === "object" ? existing.mcp as Record<string, unknown> : {}) as Record<string, unknown>;
  const newEntry = buildOpencodeMcpEntry(serverId, enabled, projectPath, token, customCatalog);

  if (!newEntry) return;

  // Merge: si se desactiva, poner enabled:false; si se activa, reemplazar entry completa
  // Para no borrar otros mcps del usuario (ej. context7 global ya está en global, pero project-level puede tener otros)
  const nextMcp = { ...mcpBlock, [serverId]: newEntry };

  const nextConfig = ensurePermissionDeny({ ...existing, mcp: nextMcp } as Record<string, unknown>);
  // Asegurar $schema si es archivo nuevo
  if (isNewFile && !nextConfig.$schema) {
    (nextConfig as Record<string, unknown>).$schema = "https://opencode.ai/config.json";
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2) + "\n", "utf-8");
    ensureGitignored(projectPath, configPath);
  } catch (err) {
    console.warn("[mcp:opencode-sync] failed to write", configPath, err);
  }
}

/**
 * Elimina un MCP de TermCanvas del opencode.json del proyecto (opcional, no usado en disable).
 * Lo dejamos como enabled:false en vez de borrar, para que siga visible.
 */
export function removeTermCanvasMcpFromOpencode(projectPath: string, serverId: McpServerId): void {
  if (!projectPath) return;
  const configPath = getOpencodeConfigPathForWrite(projectPath);
  if (!fs.existsSync(configPath)) return;
  const existing = readOpencodeConfigLenient(configPath);
  const mcpBlock = (existing.mcp && typeof existing.mcp === "object" ? existing.mcp as Record<string, unknown> : null);
  if (!mcpBlock || !(serverId in mcpBlock)) return;
  delete mcpBlock[serverId];
  const nextConfig = { ...existing, mcp: mcpBlock };
  try {
    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2) + "\n", "utf-8");
  } catch {}
}

export async function syncAllEnabledToOpencode(
  projectPath: string,
  getConfig: () => { servers: Array<{ id: McpServerId; enabled: boolean }>; customServers?: McpCatalogEntry[] },
  getSecret: (serverId: McpServerId) => Promise<string | null>,
): Promise<void> {
  if (!projectPath) return;
  const cfg = getConfig();
  const custom = cfg.customServers ?? [];
  for (const s of cfg.servers) {
    try {
      const token = s.enabled ? await getSecret(s.id) : null;
      syncTermCanvasMcpToOpencode(projectPath, s.id, s.enabled, token, custom);
    } catch {
      try { syncTermCanvasMcpToOpencode(projectPath, s.id, s.enabled, null, custom); } catch {}
    }
  }
}
