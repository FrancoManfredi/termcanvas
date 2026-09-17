/**
 * settings/factorySettingsStore — gate persistente del factory (`.settings.json`).
 *
 * Single writer de `<factoryDir>/.settings.json` con la misma resolución de
 * base que `automationStore` (`TERMCANVAS_FACTORY_DIR` para sandbox de tests
 * o `<repo>/factory`): escritura atómica tmp-then-rename, lecturas
 * tolerantes (archivo ausente o corrupto ≡ settings vacíos). Hoy solo el
 * gate `botReconcile`: el env `TERMCANVAS_BOT_RECONCILE` (`1`/`0`) sigue
 * siendo override y gana sobre el setting persistido.
 *
 * ESM puro, sin timers; cada export es fail-safe (nunca lanza).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Settings file name under the factory base dir (contract). */
export const FACTORY_SETTINGS_FILE_NAME = ".settings.json";

/** Schema version written by this store (restore tolerates other shapes). */
export const FACTORY_SETTINGS_FILE_VERSION = 1;

export interface FactorySettingsShape {
  version: number;
  botReconcile?: boolean;
  updatedAt?: string;
}

export type BotReconcileGateSource = "env" | "setting" | "default";

export interface BotReconcileGate {
  enabled: boolean;
  source: BotReconcileGateSource;
}

function getRepoRoot(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(currentFile), "../../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {
    // falls through to cwd probing
  }
  try {
    const cwd = process.cwd();
    if (
      fs.existsSync(path.join(cwd, "package.json")) &&
      fs.existsSync(path.join(cwd, "factory"))
    ) {
      return cwd;
    }
  } catch {
    // falls through to cwd default
  }
  return process.cwd();
}

function getFactoryBaseDir(): string {
  try {
    const env = process.env.TERMCANVAS_FACTORY_DIR;
    if (typeof env === "string" && env.trim().length > 0) {
      return path.resolve(env.trim());
    }
  } catch {
    // falls through to repo default
  }
  try {
    return path.join(getRepoRoot(), "factory");
  } catch {
    return path.join(process.cwd(), "factory");
  }
}

/**
 * Absolute path of the settings file. Honors `TERMCANVAS_FACTORY_DIR` so
 * tests run in a sandbox. Never throws.
 */
export function getFactorySettingsPath(): string {
  try {
    return path.join(getFactoryBaseDir(), FACTORY_SETTINGS_FILE_NAME);
  } catch {
    return path.join(process.cwd(), "factory", FACTORY_SETTINGS_FILE_NAME);
  }
}

/**
 * Reads the sanitized settings (missing or corrupt file equals empty
 * settings). Never throws.
 */
export function readFactorySettings(): FactorySettingsShape {
  try {
    const filePath = getFactorySettingsPath();
    if (!fs.existsSync(filePath)) return { version: FACTORY_SETTINGS_FILE_VERSION };
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { version: FACTORY_SETTINGS_FILE_VERSION };
    }
    const rec = parsed as Record<string, unknown>;
    const out: FactorySettingsShape = { version: FACTORY_SETTINGS_FILE_VERSION };
    if (rec.botReconcile === true || rec.botReconcile === false) {
      out.botReconcile = rec.botReconcile;
    }
    if (typeof rec.updatedAt === "string" && rec.updatedAt.trim().length > 0) {
      out.updatedAt = rec.updatedAt.trim().slice(0, 64);
    }
    return out;
  } catch {
    return { version: FACTORY_SETTINGS_FILE_VERSION };
  }
}

/** Persisted `botReconcile` value; null when unset or unreadable. Never throws. */
export function readBotReconcileSetting(): boolean | null {
  try {
    const value = readFactorySettings().botReconcile;
    return value === true || value === false ? value : null;
  } catch {
    return null;
  }
}

/**
 * Gate efectivo: el env explícito (`1`/`0`) gana; si no está seteado vale
 * el setting persistido; sin ninguno de los dos, default off. Nunca lanza.
 */
export function resolveBotReconcileGate(
  env: Record<string, string | undefined> = process.env,
): BotReconcileGate {
  try {
    const raw = env?.TERMCANVAS_BOT_RECONCILE;
    if (raw === "1") return { enabled: true, source: "env" };
    if (raw === "0") return { enabled: false, source: "env" };
    const persisted = readBotReconcileSetting();
    if (persisted !== null) return { enabled: persisted, source: "setting" };
    return { enabled: false, source: "default" };
  } catch {
    return { enabled: false, source: "default" };
  }
}

export interface FactorySettingsSnapshot {
  ok: true;
  settings: { botReconcile: boolean };
  gate: BotReconcileGate;
  envOverride: "1" | "0" | null;
}

/**
 * Snapshot de GET/POST /factory/settings: valor efectivo + fuente del gate +
 * override de env explícito. Puro sobre sus entradas (el disco lo lee el
 * resolver del gate). Nunca lanza.
 */
export function buildFactorySettingsSnapshot(
  env: Record<string, string | undefined> = process.env,
): FactorySettingsSnapshot {
  try {
    const gate = resolveBotReconcileGate(env);
    const raw = env?.TERMCANVAS_BOT_RECONCILE;
    return {
      ok: true,
      settings: { botReconcile: gate.enabled },
      gate,
      envOverride: raw === "1" || raw === "0" ? raw : null,
    };
  } catch {
    return {
      ok: true,
      settings: { botReconcile: false },
      gate: { enabled: false, source: "default" },
      envOverride: null,
    };
  }
}

/**
 * Valida y persiste el body de POST /factory/settings (`{botReconcile}`).
 * Nunca lanza.
 */
export function applyBotReconcileSetting(
  body: unknown,
): { ok: true; value: boolean } | { ok: false; error: string } {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, error: "body must be a JSON object" };
    }
    const value = (body as Record<string, unknown>).botReconcile;
    if (value !== true && value !== false) {
      return { ok: false, error: "botReconcile must be a boolean" };
    }
    return writeBotReconcileSetting(value);
  } catch {
    return { ok: false, error: "invalid body" };
  }
}

/**
 * Persiste `botReconcile` (merge con el resto del archivo) con escritura
 * atómica tmp-then-rename. Nunca lanza.
 */
export function writeBotReconcileSetting(
  enabled: unknown,
): { ok: true; value: boolean } | { ok: false; error: string } {
  try {
    if (enabled !== true && enabled !== false) {
      return { ok: false, error: "botReconcile must be a boolean" };
    }
    const filePath = getFactorySettingsPath();
    const current = readFactorySettings();
    const payload: FactorySettingsShape = {
      ...current,
      version: FACTORY_SETTINGS_FILE_VERSION,
      botReconcile: enabled,
      updatedAt: new Date().toISOString(),
    };
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
    return { ok: true, value: enabled };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "write failed" };
  }
}
