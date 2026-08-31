/**
 * Sincronización de MCP config con .agents/mcp.json para sidecar.
 *
 * La config no-secreta (enabled, url) se persiste en dos lugares:
 * 1. ProjectData.mcp dentro de state.json (rápido, local)
 * 2. <projectPath>/.agents/mcp.json (syncea cross-device vía termcanvas-context)
 *
 * Esta helper mantiene ambos en sync.
 */

import fs from "node:fs";
import path from "node:path";
import type { ProjectMcpConfig } from "../../shared/mcp.ts";
import { sanitizeProjectMcpConfig } from "../../shared/mcp.ts";

function agentsMcpPath(projectPath: string): string {
  return path.join(projectPath, ".agents", "mcp.json");
}

/** Escribe config a .agents/mcp.json (para que contextPush lo espeje). */
export function writeMcpToAgentsDir(projectPath: string, config: ProjectMcpConfig): void {
  try {
    const dir = path.join(projectPath, ".agents");
    fs.mkdirSync(dir, { recursive: true });
    const p = agentsMcpPath(projectPath);
    fs.writeFileSync(p, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // No bloquea toggle si el FS falla (proyecto en ruta no escribible)
  }
}

/** Lee config desde .agents/mcp.json si existe. */
export function readMcpFromAgentsDir(projectPath: string): ProjectMcpConfig | null {
  try {
    const p = agentsMcpPath(projectPath);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return sanitizeProjectMcpConfig(raw);
  } catch {
    return null;
  }
}

/** Borra mcp.json del sidecar local (al deshabilitar todos). */
export function deleteMcpFromAgentsDir(projectPath: string): void {
  try {
    const p = agentsMcpPath(projectPath);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}
