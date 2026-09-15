/**
 * URL builder único de sesiones opencode (cascarón + engineBridge).
 *
 * El puerto efímero lo conoce SOLO `opencodeServerManager`; el renderer jamás
 * arma URLs a mano (lee `dashboardUrl`/links ya construidos). Extraído de
 * `factoryServer.ts` para que el bridge del engine attachee las sesiones de
 * sus nodos con el mismo contrato (`/<dir-encoded>/session/<id>`).
 */

import { opencodeServerManager } from "../opencodeServerManager";

export const OPENCODE_WEB_DEFAULT_URL = "http://127.0.0.1:4096";

export function encodeOpencodeDirectory(dir: string): string {
  return Buffer.from(dir)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function getOpencodeBaseUrlSync(): string {
  return opencodeServerManager.getUrl() ?? OPENCODE_WEB_DEFAULT_URL;
}

export function buildDashboardUrl(
  sessionId?: string,
  directory?: string,
): string {
  const base = getOpencodeBaseUrlSync();
  if (!sessionId) return base;
  if (!directory) return `${base}/session/${sessionId}`;
  const enc = encodeOpencodeDirectory(directory);
  return `${base}/${enc}/session/${sessionId}`;
}
