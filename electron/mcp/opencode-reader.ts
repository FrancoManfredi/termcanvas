import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface OpencodeMcpEntry {
  name: string;
  type: "local" | "remote";
  enabled: boolean;
  command?: string[];
  url?: string;
  source: "global" | "project";
  sourcePath: string;
}

function readJsonIfExists(p: string): Record<string, unknown> | null {
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    // jsonc: strip comments (// and /* */) naively for our case
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    // Fallback: el opencode.json global contiene prompts multilínea con saltos literales
    // que rompen JSON.parse estricto. Extraemos solo el bloque "mcp" con balanceo de llaves.
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const mcpIdx = raw.indexOf('"mcp"');
      if (mcpIdx === -1) return null;
      const braceStart = raw.indexOf("{", raw.indexOf(":", mcpIdx));
      if (braceStart === -1) return null;
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
      if (end === -1) return null;
      const mcpRaw = raw.slice(braceStart, end + 1);
      // el bloque mcp es JSON válido (no contiene prompts con newlines)
      const mcpObj = JSON.parse(mcpRaw) as Record<string, unknown>;
      return { mcp: mcpObj } as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function parseMcpBlock(obj: Record<string, unknown> | null, source: OpencodeMcpEntry["source"], sourcePath: string): OpencodeMcpEntry[] {
  if (!obj || typeof obj.mcp !== "object" || !obj.mcp) return [];
  const mcp = obj.mcp as Record<string, unknown>;
  const out: OpencodeMcpEntry[] = [];
  for (const [name, val] of Object.entries(mcp)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const type = (v.type as string) === "remote" ? "remote" as const : "local" as const;
    const enabled = v.enabled !== false; // default true
    const url = typeof v.url === "string" ? v.url : undefined;
    const command = Array.isArray(v.command) ? (v.command as string[]) : undefined;
    out.push({ name, type, enabled, url, command, source, sourcePath });
  }
  return out;
}

export function getGlobalOpencodeMcpEntries(): OpencodeMcpEntry[] {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".config", "opencode", "opencode.json"),
    path.join(home, ".config", "opencode", "opencode.jsonc"),
  ];
  const out: OpencodeMcpEntry[] = [];
  for (const p of candidates) {
    const obj = readJsonIfExists(p);
    out.push(...parseMcpBlock(obj, "global", p));
  }
  // dedupe by name, last wins
  const byName = new Map<string, OpencodeMcpEntry>();
  for (const e of out) byName.set(e.name, e);
  return [...byName.values()];
}

export function getProjectOpencodeMcpEntries(projectPath: string): OpencodeMcpEntry[] {
  if (!projectPath) return [];
  const candidates = [
    path.join(projectPath, "opencode.json"),
    path.join(projectPath, "opencode.jsonc"),
    path.join(projectPath, ".opencode", "opencode.json"),
    path.join(projectPath, ".opencode", "opencode.jsonc"),
  ];
  const out: OpencodeMcpEntry[] = [];
  for (const p of candidates) {
    const obj = readJsonIfExists(p);
    out.push(...parseMcpBlock(obj, "project", p));
  }
  const byName = new Map<string, OpencodeMcpEntry>();
  for (const e of out) byName.set(e.name, e);
  return [...byName.values()];
}
