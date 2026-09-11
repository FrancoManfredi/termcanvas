/**
 * reviewDiff — diff del worktree para el turno del reviewer.
 *
 * El reviewer necesita ver líneas agregadas/borradas, no solo la lista de
 * archivos (la lista puede estar incompleta; el diff es la verdad del disco).
 * `getReviewDiffBlock` combina `git diff HEAD` (tracked) + contenido de
 * archivos nuevos untracked, acotado a 12KB, listo para el mensaje.
 * Sin shell (argv separado, sin inyección). Puro en contrato: nunca lanza
 * ("" = sin diff disponible).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Tope del diff en el mensaje (precedente: diff acotado 12KB). */
export const REVIEW_DIFF_MAX_BYTES = 12 * 1024;

export const REVIEW_DIFF_TRUNCATION_MARK = "\n…[diff truncado a 12KB: ver el resto con read en el worktree]";

/** Tope por archivo nuevo (evita que 1 untracked gigante coma el budget). */
const NEW_FILE_MAX_BYTES = 4 * 1024;

function isSafeRelPath(p: unknown): p is string {
  try {
    if (typeof p !== "string") return false;
    const t = p.trim();
    if (t.length === 0 || t.length > 512) return false;
    if (path.isAbsolute(t)) return false;
    const norm = t.replace(/\\/g, "/");
    if (norm.split("/").includes("..")) return false;
    if (norm.includes("\0")) return false;
    return true;
  } catch {
    return false;
  }
}

function runGit(cwd: string, args: string[], maxBuffer: number): string | null {
  try {
    const run = spawnSync("git", args, { windowsHide: true,
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      shell: false,
      maxBuffer,
    });
    if (run.status !== 0 || typeof run.stdout !== "string") return null;
    return run.stdout.replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

function readNewFile(cwd: string, rel: string): string | null {
  try {
    const full = path.join(cwd, rel);
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return null;
    return buf.toString("utf-8").slice(0, NEW_FILE_MAX_BYTES);
  } catch {
    return null;
  }
}

/**
 * Devuelve el diff del cambio: `git diff HEAD` para tracked + contenido de
 * untracked nuevos, acotado al budget. "" cuando no hay archivos, no es repo
 * git o no hay cambios. Nunca lanza.
 */
export function getReviewDiffBlock(
  worktreePath: unknown,
  files: unknown,
  maxBytes: number = REVIEW_DIFF_MAX_BYTES,
): string {
  try {
    if (typeof worktreePath !== "string" || worktreePath.trim().length === 0) return "";
    const list = (Array.isArray(files) ? files : []).filter(isSafeRelPath).slice(0, 50);
    if (list.length === 0) return "";
    const cwd = path.resolve(worktreePath.trim());
    try {
      if (!fs.existsSync(path.join(cwd, ".git"))) return "";
    } catch {
      return "";
    }
    const cap = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : REVIEW_DIFF_MAX_BYTES;
    const parts: string[] = [];

    const diff = runGit(cwd, ["diff", "HEAD", "--no-color", "--", ...list], cap + 1024);
    const tracked = typeof diff === "string" ? diff.trim() : "";
    if (tracked) parts.push(tracked);

    const status = runGit(cwd, ["status", "--porcelain", "--", ...list], 64 * 1024);
    const untracked = new Set<string>();
    if (typeof status === "string") {
      for (const line of status.split("\n")) {
        const code = line.slice(0, 2);
        const name = line.slice(3).trim().replace(/^"|"$/g, "");
        if (code === "??" && isSafeRelPath(name)) untracked.add(name);
      }
    }
    let used = parts.join("\n").length;
    const omitted: string[] = [];
    for (const rel of list) {
      if (!untracked.has(rel) && !untracked.has(`"${rel}"`)) continue;
      if (used >= cap) {
        omitted.push(rel);
        continue;
      }
      const content = readNewFile(cwd, rel);
      if (content === null || content.trim().length === 0) continue;
      const block = `### Nuevo archivo: ${rel}\n${content.trimEnd()}`;
      if (used + 1 + block.length > cap) {
        omitted.push(rel);
        continue;
      }
      parts.push(block);
      used += 1 + block.length;
    }

    let out = parts.join("\n").trim();
    if (omitted.length > 0) {
      out = (out ? out + "\n" : "") + `…[+${omitted.length} archivo(s) fuera del tope: ${omitted.slice(0, 5).join(", ")}]`;
    }
    if (!out) return "";
    if (out.length > cap + 512) return out.slice(0, cap) + REVIEW_DIFF_TRUNCATION_MARK;
    return out;
  } catch {
    return "";
  }
}
