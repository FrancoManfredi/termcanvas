import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Discovers Factory daemon port in range 17680-17690.
 * Strategy:
 *  1. Try factory-port files (prod + dev) → verify health.
 *  2. Fallback to sequential probing with GET /factory/health.
 *
 * Windows only — expects 127.0.0.1 + PowerShell/curl.exe friendly errors.
 */

const FACTORY_PORT_MIN = 17680;
const FACTORY_PORT_MAX = 17690;

function getPortFileCandidates(): string[] {
  const candidates: string[] = [];

  // Explicit env override (highest priority)
  if (process.env.TERMCANVAS_PORT_FILE) {
    candidates.push(process.env.TERMCANVAS_PORT_FILE);
  }
  if (process.env.FACTORY_PORT_FILE) {
    candidates.push(process.env.FACTORY_PORT_FILE);
  }

  // TermCanvas factory-port files (prod/dev)
  // Mirrors headless-runtime/factory/factoryServer.ts: getFactoryPortFile()
  for (const instance of ["dev", "prod"] as const) {
    const baseDir =
      instance === "dev"
        ? path.join(os.homedir(), ".termcanvas-dev")
        : path.join(os.homedir(), ".termcanvas");
    candidates.push(path.join(baseDir, "factory-port"));
    // Also try legacy generic "port" file via shared helper pattern
    candidates.push(path.join(baseDir, "port"));
  }

  return candidates;
}

async function isHealthOk(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`http://127.0.0.1:${port}/factory/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const body = (await res.json()) as unknown;
    if (
      body !== null &&
      typeof body === "object" &&
      "queue" in body &&
      typeof (body as { queue: unknown }).queue === "object" &&
      (body as { queue: { pending: unknown } }).queue !== null
    ) {
      const pending = (body as { queue: { pending: unknown } }).queue.pending;
      return typeof pending === "number";
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Discovers Factory port by reading port files then probing.
 * @throws Error with ERR_NO_FACTORY message if nothing responds.
 */
export async function discoverFactoryPort(): Promise<number> {
  // a) Try port files
  for (const file of getPortFileCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf-8").trim().split("\n")[0]?.trim();
      if (!raw) continue;
      const port = Number(raw);
      if (!Number.isInteger(port)) continue;
      if (port < FACTORY_PORT_MIN || port > FACTORY_PORT_MAX) continue;
      if (await isHealthOk(port)) return port;
    } catch {
      // Ignore and continue probing
    }
  }

  // b) Sequential probing 17680-17690
  for (let port = FACTORY_PORT_MIN; port <= FACTORY_PORT_MAX; port++) {
    if (await isHealthOk(port)) return port;
  }

  throw new Error(
    `ERR_NO_FACTORY: No hay Factory en ${FACTORY_PORT_MIN}-${FACTORY_PORT_MAX}. ` +
      "Corré `pnpm dev` en otra terminal PowerShell, o standalone: `npx tsx headless-runtime/factory/factoryServer.ts` (o `node --import tsx headless-runtime/factory/factoryServer.ts`).\n" +
      "Verificá: Invoke-RestMethod -UseBasicParsing http://127.0.0.1:17680/factory/health | ConvertTo-Json\n" +
      "o: curl.exe --silent http://127.0.0.1:17680/factory/health",
  );
}

export const FACTORY_PORT_RANGE = {
  min: FACTORY_PORT_MIN,
  max: FACTORY_PORT_MAX,
} as const;
