/**
 * McpVault — secretos por proyecto, device-local, cifrados con safeStorage.
 *
 * Requisito cross-device: si configuras Supabase en PC y abrís la laptop,
 * la CONFIG (enabled:true) syncea vía sidecar privado, pero el SECRETO no.
 * En la laptop el estado será `needs_auth` y se pide 1 re-entrada del token.
 * Luego se cifra localmente y queda disponible para TODOS los LLMs de ese
 * proyecto en ese device.
 *
 * Diseño: archivo por proyecto en ~/.termcanvas/mcp-vault/<projectId>.enc
 * Contenido: JSON cifrado con safeStorage.encryptString o fallback plain
 * con prefijo "plain:" si safeStorage no disponible (dev/test).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { McpServerId } from "../../shared/mcp.ts";

// Lazy safeStorage — no disponible fuera de Electron (tests)
function getSafeStorage(): { isEncryptionAvailable: () => boolean; encryptString: (s: string) => Buffer; decryptString: (b: Buffer) => string } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as { safeStorage?: { isEncryptionAvailable: () => boolean; encryptString: (s: string) => Buffer; decryptString: (b: Buffer) => string } };
    return electron?.safeStorage ?? null;
  } catch {
    return null;
  }
}

const PLAINTEXT_PREFIX = "plain:";

export type McpSecrets = Partial<Record<McpServerId, string>>;

function getVaultDir(homeOverride?: string): string {
  const base = homeOverride
    ? homeOverride
    : process.env.TERMCANVAS_MCP_VAULT_HOME?.trim()
      ? process.env.TERMCANVAS_MCP_VAULT_HOME!.trim()
      : path.join(os.homedir(), ".termcanvas", "mcp-vault");
  return base;
}

function vaultPath(projectId: string, dir: string): string {
  // projectId es UUID; sanitizar por si viene path-like
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(dir, `${safe}.enc`);
}

function isSafeStorageAvailable(): boolean {
  const ss = getSafeStorage();
  if (!ss) return false;
  try {
    return ss.isEncryptionAvailable();
  } catch {
    return false;
  }
}

async function encryptPayload(plaintext: string): Promise<string> {
  const ss = getSafeStorage();
  if (ss && isSafeStorageAvailable()) {
    const buf = ss.encryptString(plaintext);
    return buf.toString("base64");
  }
  return PLAINTEXT_PREFIX + plaintext;
}

async function decryptPayload(stored: string): Promise<string> {
  if (stored.startsWith(PLAINTEXT_PREFIX)) {
    return stored.slice(PLAINTEXT_PREFIX.length);
  }
  const ss = getSafeStorage();
  if (ss && isSafeStorageAvailable()) {
    try {
      const buf = Buffer.from(stored, "base64");
      return ss.decryptString(buf);
    } catch {
      // Falló descifrado (clave distinta entre devices) -> tratar como vacío
      throw new Error("VAULT_DECRYPT_FAILED");
    }
  }
  // stored parece base64 pero no tenemos safeStorage -> ilegible
  throw new Error("VAULT_DECRYPT_FAILED");
}

export class McpVault {
  private dir: string;

  constructor(dirOverride?: string) {
    this.dir = getVaultDir(dirOverride);
  }

  getDir(): string {
    return this.dir;
  }

  async load(projectId: string): Promise<McpSecrets> {
    const p = vaultPath(projectId, this.dir);
    if (!fs.existsSync(p)) return {};
    try {
      const stored = fs.readFileSync(p, "utf-8").trim();
      if (!stored) return {};
      const json = await decryptPayload(stored);
      const parsed = JSON.parse(json) as McpSecrets;
      if (!parsed || typeof parsed !== "object") return {};
      const out: McpSecrets = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v) (out as Record<string, string>)[k] = v;
      }
      return out;
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "VAULT_DECRYPT_FAILED") {
        // Señal para UI: necesita re-auth en este device
        throw e;
      }
      // Corrupto -> vacío (no rompe app)
      return {};
    }
  }

  /** Guarda un secreto para un serverId dentro del proyecto. null/"" = borrar. */
  async setSecret(projectId: string, serverId: McpServerId, token: string | null): Promise<void> {
    const current = await this.loadSafe(projectId);
    if (!token) {
      delete current[serverId];
    } else {
      current[serverId] = token;
    }
    await this.saveAll(projectId, current);
  }

  async hasSecret(projectId: string, serverId: McpServerId): Promise<boolean> {
    try {
      const s = await this.load(projectId);
      return typeof s[serverId] === "string" && (s[serverId] as string).length > 0;
    } catch (e) {
      if (e instanceof Error && e.message === "VAULT_DECRYPT_FAILED") return false;
      return false;
    }
  }

  /** Carga tolerante (si descifrado falla, devuelve {} y resetea archivo). */
  private async loadSafe(projectId: string): Promise<McpSecrets> {
    try {
      return await this.load(projectId);
    } catch (e) {
      if (e instanceof Error && e.message === "VAULT_DECRYPT_FAILED") {
        // Archivo ilegible en este device -> reset (forzará needs_auth)
        return {};
      }
      return {};
    }
  }

  private async saveAll(projectId: string, secrets: McpSecrets): Promise<void> {
    const p = vaultPath(projectId, this.dir);
    fs.mkdirSync(this.dir, { recursive: true });
    if (Object.keys(secrets).length === 0) {
      // No secrets -> borrar archivo si existe
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
      return;
    }
    const json = JSON.stringify(secrets);
    const encrypted = await encryptPayload(json);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, encrypted, "utf-8");
    // Vault con permisos 600 — ni siquiera los LLM con bash pueden leerlo si respetan permisos
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {}
    fs.renameSync(tmp, p);
    try {
      fs.chmodSync(p, 0o600);
    } catch {}
    // Asegurar directorio también 700
    try {
      fs.chmodSync(this.dir, 0o700);
    } catch {}
  }

  async deleteProject(projectId: string): Promise<void> {
    const p = vaultPath(projectId, this.dir);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  }
}
