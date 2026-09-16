/**
 * Minimal change helpers — cambio minimo deterministico (1 archivo) + git diff filtrado.
 * Parsea el prompt para crear EXACTAMENTE el archivo/carpeta pedido,
 * sin importar el nombre: cualquier nombre entrecomillado o ruta explicita sirve.
 * La deteccion de intencion usa keywords de idioma (carpeta/directorio/folder,
 * archivo/file) con tolerancia a typos SOLO en esas keywords, mas deteccion
 * por mtime reciente. Este modulo nunca contiene literales de nombres propios.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { IMPLEMENT_MAX_CREATED_FILES, IMPLEMENT_MODEL_SNIPPET_MAX } from "../../shared/types/implement";
import type { ImplementInput } from "../../shared/types/implement";
import type { WorkItem } from "../../shared/types/workItem";

// Excluir de createdFiles (ruido de build, deps, estado interno).
const EXCLUDE_PREFIXES = [
  "node_modules/",
  ".git/",
  ".agents/",
  "dist/",
  "dist-electron/",
  "dist-cli/",
  "dist-headless/",
  "logs/",
  ".hydra/",
  ".worktrees/",
  // Ayudas de review del propio ciclo (espejo de gitHubPr: nunca cambio).
  "review/",
];

const EXCLUDE_EXACT = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "scope.md",
  "plan.md",
  "triage.md",
  "discoveries.json",
  "discoveries.md",
]);

function isExcluded(file: string): boolean {
  const norm = file.replace(/\\/g, "/");
  if (EXCLUDE_EXACT.has(path.basename(norm))) return true;
  for (const prefix of EXCLUDE_PREFIXES) {
    if (norm.startsWith(prefix) || norm.includes(`/${prefix}`) || norm === prefix.replace(/\/$/, "")) {
      if (norm.startsWith(prefix)) return true;
    }
    if (norm.includes(".agents/factory")) return true;
    if (norm.includes("logs/build.log")) return true;
    if (norm.includes("result.json")) return true;
  }
  // docs/implement-ola3- is allowed (fallback marker deterministico)
  if (norm.startsWith("docs/implement-ola3-")) return false;
  // general exclude
  for (const p of EXCLUDE_PREFIXES) {
    if (norm.startsWith(p)) return true;
    if (norm.includes(p)) return true;
  }
  return false;
}

/**
 * True si `file` es la ruta pedida o vive debajo de ella.
 * Permite que la ruta explicitamente pedida sobreviva al filtro de excluidos
 * (ej. una carpeta pedida bajo .agents/), sin listas de nombres.
 */
function isRequestedPath(file: string, requested: string | null | undefined): boolean {
  if (!requested) return false;
  const norm = file.replace(/\\/g, "/");
  const req = requested.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!req) return false;
  return norm === req || norm.startsWith(`${req}/`);
}

function normalizeGitPath(p: string): string {
  return p.replace(/\\/g, "/").trim();
}

/**
 * Detecta intencion de creacion de carpeta/directorio en un prompt.
 * Solo matchea keywords de idioma (con variantes de typo comunes en esas
 * keywords: carepta/carpta). El NOMBRE pedido se extrae aparte y puede ser
 * cualquiera — este predicado jamas inspecciona nombres propios.
 */
export function hasFolderIntent(prompt: string): boolean {
  if (!prompt || typeof prompt !== "string") return false;
  const lower = prompt.toLowerCase();
  return (
    lower.includes("carpeta") ||
    lower.includes("carepta") ||
    lower.includes("carpta") ||
    lower.includes("directorio") ||
    lower.includes("folder") ||
    /c[aá]r+e?p*t+a/.test(lower)
  );
}

/**
 * Obtiene createdFiles vía git diff filtrado.
 * Antes/después: compara `git diff --name-only HEAD` + untracked.
 * Si no es git repo, fallback a fs mtime scan.
 *
 * Si el prompt pide una ruta explicita y existe en disco, retorna solo esa
 * ruta (1 archivo) para evitar devolver decenas de untracked viejos.
 */
/**
 * Concilia lista del disco (git diff filtrado) con lista del modelo.
 * El disco manda: lo que realmente cambió en disco nunca se pierde por el
 * fast-path de 1 archivo (ej: el issue nombra `package.json` pero el builder
 * tocó 3 archivos más — antes el fast-path reemplazaba y review solo veía
 * package.json). El modelo agrega como extras lo que el diff no atribuye.
 * Con disco vacío se conserva la del modelo (git no disponible); con modelo
 * vacía, el disco. Prompts de carpeta conservan su poda (evita decenas de
 * untracked). Puro, nunca lanza.
 */
export function mergeDiskAndModelFiles(
  diskFiles: unknown,
  modelFiles: unknown,
  prompt?: string,
): string[] {
  try {
    const disk = (Array.isArray(diskFiles) ? diskFiles : [])
      .filter((f): f is string => typeof f === "string" && f.length > 0);
    const model = (Array.isArray(modelFiles) ? modelFiles : [])
      .filter((f): f is string => typeof f === "string" && f.length > 0);
    if (disk.length === 0) return model.slice(0, 50);
    const text = typeof prompt === "string" ? prompt : "";
    if (hasFolderIntent(text)) {
      const parsedReq = parseRequestedFromPrompt(text);
      const reqBase = parsedReq && parsedReq.isFolder
        ? parsedReq.relPath.replace(/\\/g, "/").replace(/\/+$/, "")
        : null;
      const folderOnly = reqBase
        ? disk.filter(
            (x) => x === parsedReq?.relPath || x.startsWith(`${reqBase}/`),
          )
        : disk.filter((x) => !x.includes("/"));
      if (folderOnly.length >= 1 && folderOnly.length <= 3) {
        return folderOnly.slice(0, 3);
      } else if (disk.length <= 3) {
        return disk.slice(0, 3);
      }
      return [disk[0]];
    }
    const seen = new Set(disk);
    const extras = model.filter((f) => !seen.has(f));
    return [...disk, ...extras].slice(0, 50);
  } catch {
    return [];
  }
}

export function getFilteredCreatedFiles(worktreePath: string, startTimeMs: number, prompt?: string): string[] {
  const resolved = path.resolve(worktreePath);
  const requested = prompt ? parseRequestedFromPrompt(prompt) : null;
  const requestedRel = requested ? requested.relPath.replace(/\\/g, "/") : null;

  // Fast-path: si el prompt pide una ruta explicita y existe en disco,
  // retornar solo eso (1 archivo). Evita el bug de decenas de createdFiles.
  if (requested && requestedRel) {
    const fullPath = path.join(resolved, requested.relPath);
    try {
      if (fs.existsSync(fullPath)) {
        return [requestedRel];
      }
    } catch {}
  }

  try {
    if (fs.existsSync(path.join(resolved, ".git")) || isInsideGitWorktree(resolved)) {
      const files = new Set<string>();

      // tracked modified
      const diff = spawnSync("git", ["diff", "--name-only", "HEAD"], {
        cwd: resolved,
        encoding: "utf-8",
        timeout: 5000,
        shell: false,
        windowsHide: true,
      });
      if (diff.status === 0 && diff.stdout) {
        for (const line of diff.stdout.split("\n")) {
          const f = normalizeGitPath(line);
          if (!f) continue;
          if (!isExcluded(f) || isRequestedPath(f, requestedRel)) files.add(f);
        }
      }

      // untracked
      const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
        cwd: resolved,
        encoding: "utf-8",
        timeout: 5000,
        shell: false,
        windowsHide: true,
      });
      if (untracked.status === 0 && untracked.stdout) {
        for (const line of untracked.stdout.split("\n")) {
          const f = normalizeGitPath(line);
          if (!f) continue;
          if (!isExcluded(f) || isRequestedPath(f, requestedRel)) files.add(f);
        }
      }

      // Also git status --porcelain as fallback union if nothing collected
      if (files.size === 0) {
        const status = spawnSync("git", ["status", "--porcelain"], {
          cwd: resolved,
          encoding: "utf-8",
          timeout: 5000,
          shell: false,
          windowsHide: true,
        });
        if (status.status === 0 && status.stdout) {
          for (const line of status.stdout.split("\n")) {
            if (!line.trim()) continue;
            const f = normalizeGitPath(line.slice(3).trim().split(" -> ").pop() ?? "");
            if (!f) continue;
            if (!isExcluded(f) || isRequestedPath(f, requestedRel)) files.add(f);
          }
        }
      }

      // Filter by mtime to avoid returning old untracked files
      // Only keep files/dirs that were modified/created recently (>= startTimeMs - 2s)
      const filteredRecent: string[] = [];
      for (const f of files) {
        let stat: fs.Stats | null = null;
        const full = path.join(resolved, f);
        try {
          stat = fs.statSync(full);
        } catch {
          // For entries with trailing slash, try without slash
          try {
            const alt = path.join(resolved, f.replace(/\/$/, ""));
            if (fs.existsSync(alt)) stat = fs.statSync(alt);
          } catch {}
        }
        if (stat) {
          if (stat.mtimeMs >= startTimeMs - 2000) {
            filteredRecent.push(f);
          }
        } else {
          // If can't stat (e.g., deleted tracked file), skip – don't include old untracked noise
        }
      }

      // Also explicitly check for the requested folder even if git didn't list
      // it (empty dirs are not tracked). Generico: vale para cualquier nombre.
      if (requested && requested.isFolder && requestedRel) {
        const full = path.join(resolved, requested.relPath);
        try {
          if (fs.existsSync(full)) {
            const s = fs.statSync(full);
            if (s.mtimeMs >= startTimeMs - 5000) {
              if (!filteredRecent.includes(requestedRel)) filteredRecent.push(requestedRel);
            } else if (prompt && parseRequestedFromPrompt(prompt)?.relPath === requested.relPath) {
              // If prompt explicitly requested this folder, include it even if mtime old (idempotent re-run)
              if (!filteredRecent.includes(requestedRel)) filteredRecent.push(requestedRel);
            }
          }
        } catch {}
      }

      if (filteredRecent.length > 0) {
        // If prompt requested a specific path and it's in filteredRecent, return only that (minimal)
        if (requested && requestedRel && filteredRecent.includes(requestedRel)) {
          return [requestedRel];
        }
        if (prompt && requested && requested.isFolder && requestedRel) {
          // If prompt is folder creation and filteredRecent is huge (>3), prioritize the requested folder only
          if (filteredRecent.length > 3) {
            const base = requestedRel.replace(/\/+$/, "");
            const folderOnly = filteredRecent.filter(
              (x) => x === requestedRel || x === base || x.startsWith(`${base}/`),
            );
            if (folderOnly.length > 0) {
              return folderOnly.slice(0, 50);
            }
          }
        }
        return filteredRecent.slice(0, 50);
      }

      // No recent files found but files set had many old entries – fallback to mtime scan
      const fallbackScan = scanByMtime(resolved, startTimeMs, requestedRel);
      if (fallbackScan.length > 0) return fallbackScan;

      // Last resort: if the explicitly requested path exists (even old), return it for idempotent jobs
      if (requested && requestedRel) {
        const full = path.join(resolved, requested.relPath);
        try {
          if (fs.existsSync(full)) return [requestedRel];
        } catch {}
      }

      return [];
    }
  } catch {
    // ignore and fallback to fs scan
  }
  return scanByMtime(resolved, startTimeMs, requestedRel);
}

function isInsideGitWorktree(dir: string): boolean {
  try {
    const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 3000,
      shell: false,
      windowsHide: true,
    });
    return r.status === 0 && r.stdout.trim() === "true";
  } catch {
    return false;
  }
}

function scanByMtime(root: string, startMs: number, allowed: string | null = null): string[] {
  const out: string[] = [];
  try {
    walkMtime(root, root, startMs, out, 0, allowed);
  } catch {}
  return out.slice(0, 50).map((p) => normalizeGitPath(path.relative(root, p)));
}

const MTIME_SKIP_ROOT_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  ".gitignore",
]);

const MTIME_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-electron",
  "dist-cli",
  "dist-headless",
  "logs",
  ".hydra",
  ".worktrees",
]);

function walkMtime(
  current: string,
  root: string,
  startMs: number,
  out: string[],
  depth: number,
  allowed: string | null = null,
): void {
  if (depth > 6) return;
  if (out.length >= 50) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= 50) break;
    const full = path.join(current, e.name);
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (MTIME_SKIP_ROOT_FILES.has(rel) || MTIME_SKIP_ROOT_FILES.has(e.name)) {
      continue;
    }
    const isAllowed = isRequestedPath(rel, allowed);
    if (!isAllowed && isExcluded(rel)) {
      // No descartar directorios intermedios que pueden contener la ruta
      // pedida (ej. raiz de un area excluida por prefijo).
      if (e.isDirectory() && allowed) {
        const req = (allowed as string).replace(/\/+$/, "");
        if (req === rel || req.startsWith(`${rel}/`)) {
          walkMtime(full, root, startMs, out, depth + 1, allowed);
        }
      }
      continue;
    }
    try {
      const stat = fs.statSync(full);
      if (e.isDirectory()) {
        if (!isAllowed && (MTIME_SKIP_DIRS.has(rel) || MTIME_SKIP_DIRS.has(e.name))) continue;
        if (!isAllowed && rel.startsWith(".agents/factory")) continue;
        // Recently created directories count as change (mtime detection,
        // any name) so empty new folders are visible even without prompt.
        if (stat.mtimeMs >= startMs - 5000) {
          out.push(full);
        }
        walkMtime(full, root, startMs, out, depth + 1, allowed);
      } else {
        if (stat.mtimeMs >= startMs - 1000) {
          if ((!isExcluded(rel) || isAllowed) && rel !== "package.json") out.push(full);
        }
      }
    } catch {}
  }
}

// ── Parser generico de archivo/carpeta pedido en prompt ──

/**
 * H-001: corta la cláusula de contenido "con un/una/el/la archivo/fichero…"
 * del candidato a nombre de carpeta. "carpeta demo-e2e con un archivo
 * leeme.txt que…" → "demo-e2e". Sin este corte el fallback creaba la carpeta
 * literal "demo-e2e con un archivo leemetxt". Puro, nunca lanza.
 */
export function stripFileClause(cand: string): string {
  try {
    if (!cand || typeof cand !== "string") return cand;
    const m = cand.match(/\s+con\s+(un|una|el|la|los|las|este|esta|ese|esa)\s+(archivo|fichero|file|documento|fichier)\b/i);
    if (m && typeof m.index === "number" && m.index > 0) {
      return cand.slice(0, m.index).trim();
    }
    return cand;
  } catch {
    return cand;
  }
}

/** Palabras que delatan residuo de prompt en vez de nombre de carpeta. */
const FOLDER_RESIDUE_RE = /(^|\s)(archivo|fichero|files?|documento|contenga|contiene|contener|explique|que)\b/i;

/**
 * H-001: true si un nombre NO entrecomillado parece texto del prompt y no un
 * nombre de carpeta (menciona archivo/contenido o tiene >3 palabras).
 * El fallback jamás debe usar texto del prompt como ruta: ante true el
 * parser retorna null y el caller deriva a triage. Puro, nunca lanza.
 */
export function isUnconfidentFolderName(cleaned: string): boolean {
  try {
    if (!cleaned || typeof cleaned !== "string") return true;
    if (FOLDER_RESIDUE_RE.test(cleaned)) return true;
    const words = cleaned.split(/\s+/).filter(Boolean);
    return words.length > 3;
  } catch {
    return true;
  }
}

/**
 * H-001: el fallback necesita triage (no carpeta inventada) cuando el prompt
 * pide carpeta pero el parser no extrae un nombre confiable. Retorna la razón
 * lista para timeline, o null cuando hay parse (o no hay intención de carpeta).
 * Puro, nunca lanza.
 */
export function fallbackNeedsTriage(prompt: string): string | null {
  try {
    if (!prompt || typeof prompt !== "string" || !hasFolderIntent(prompt)) return null;
    const parsed = parseRequestedFromPrompt(prompt);
    if (parsed && parsed.isFolder && parsed.relPath) return null;
    return (
      "fallback sin parse confiable de carpeta: el prompt pide una carpeta pero no se extrajo " +
      "un nombre exacto — se deriva a triage humano en vez de crear una carpeta literal del texto"
    );
  } catch {
    return null;
  }
}

/**
 * H-001 (red de seguridad): conserva solo las rutas que existen en disco.
 * Las inexistentes (fantasmas) se descartan — nunca se registran como hechas.
 * Retorna {kept, dropped} para que el caller anote los descartes en timeline.
 * Nunca lanza.
 */
export function filterExistingCreatedFiles(
  worktreePath: string,
  files: string[],
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  try {
    const resolved = path.resolve(worktreePath);
    for (const f of files ?? []) {
      if (typeof f !== "string" || f.length === 0) {
        dropped.push(String(f));
        continue;
      }
      try {
        if (fs.existsSync(path.join(resolved, f))) kept.push(f);
        else dropped.push(f);
      } catch {
        dropped.push(f);
      }
    }
  } catch {
    return { kept: [], dropped: [...(files ?? [])] };
  }
  return { kept, dropped };
}

/**
 * H-012: true si `fullPath` es un directorio existente sin entradas.
 * Implementación única del chequeo de vacío (la verificación la reutiliza
 * por importación, sin duplicar lógica). Puro salvo el readdir, nunca lanza.
 */
export function isEmptyDirSync(fullPath: string): boolean {
  try {
    if (typeof fullPath !== "string" || fullPath.length === 0) return false;
    return fs.readdirSync(fullPath).length === 0;
  } catch {
    return false;
  }
}

/**
 * H-012: extrae el nombre del ARCHIVO pedido en un prompt de carpeta+archivo
 * ("... carpeta X con un archivo Y.txt que ... " → "Y.txt"). Genérico: vale
 * para cualquier basename con extensión, sin literales de nombres propios
 * (solo keywords de idioma archivo/fichero/file/documento, igual que
 * `stripFileClause`/`hasFolderIntent`). Retorna null si no hay archivo claro
 * (carpeta sola, sin extensión). Puro, nunca lanza, sin loops.
 */
export function parseRequestedFileName(prompt: string): string | null {
  try {
    if (!prompt || typeof prompt !== "string") return null;
    // E1-B: same escape normalization as the folder parser so
    // `archivo \"dato.txt\"` and `archivo "dato.txt"` agree.
    const text = unescapePromptQuotes(prompt).trim();
    if (!text) return null;
    const afterKeyword = text.match(
      /(?:archivo|fichero|files?|documento|fichier)\s+(?:llamad[oa]?\s+(?:como\s+)?)?["']?([A-Za-z0-9_\-]+\.[A-Za-z0-9]{1,5})["']?/i,
    );
    const cand1 = afterKeyword?.[1]?.trim().replace(/^["']+|["']+$/g, "") ?? "";
    if (cand1.length > 0 && cand1.length < 120 && cand1.includes(".")) return cand1;
    const afterCon = text.match(
      /\scon\s+[^.]{0,80}?["']?([A-Za-z0-9_\-]+\.[A-Za-z0-9]{1,5})["']?/i,
    );
    const cand2 = afterCon?.[1]?.trim().replace(/^["']+|["']+$/g, "") ?? "";
    if (cand2.length > 0 && cand2.length < 120 && cand2.includes(".")) return cand2;
    return null;
  } catch {
    return null;
  }
}

/**
 * H-012 (conteo honesto): quita los placeholders de carpeta vacía del conteo
 * cuando el prompt pedía un ARCHIVO que sigue ausente. Si no hay archivo
 * pedido (carpeta sola) o el archivo ya existe (en la carpeta pedida o en la
 * raíz), la lista vuelve intacta (éxito trivial de carpeta sola preservado,
 * H-001 intacto). Solo cae la carpeta vacía sin archivo: el `changed N` del
 * caller cuenta archivos reales, no placeholders. Acotado a
 * `IMPLEMENT_MAX_CREATED_FILES`, best-effort, nunca lanza.
 */
export function stripEmptyFolderPlaceholder(
  worktreePath: string,
  files: string[],
  prompt?: string,
): string[] {
  try {
    const list = (Array.isArray(files) ? files : []).slice(0, IMPLEMENT_MAX_CREATED_FILES);
    if (list.length === 0) return list;
    if (typeof prompt !== "string" || prompt.length === 0) return list;
    const fileName = parseRequestedFileName(prompt);
    if (!fileName) return list;
    const base =
      typeof worktreePath === "string" && worktreePath.length > 0
        ? path.resolve(worktreePath)
        : process.cwd();
    let present = false;
    try {
      const folderRel = parseRequestedFromPrompt(prompt)?.relPath ?? null;
      if (typeof folderRel === "string" && folderRel.length > 0) {
        try {
          if (fs.existsSync(path.join(base, folderRel, fileName))) present = true;
        } catch {}
      }
      if (!present) {
        try {
          if (fs.existsSync(path.join(base, fileName))) present = true;
        } catch {}
      }
    } catch {}
    if (present) return list;
    return list.filter((rel) => {
      try {
        if (typeof rel !== "string" || rel.length === 0) return false;
        const full = path.join(base, rel);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          return true;
        }
        if (st.isDirectory() && isEmptyDirSync(full)) return false;
        return true;
      } catch {
        return true;
      }
    });
  } catch {
    return Array.isArray(files) ? [...files] : [];
  }
}

/**
 * H-001 / E2E-05: cuenta cuántas palabras significativas del prompt aparecen
 * en el nombre de la ruta (criterio del caso E2E-05: ">3 palabras del prompt
 * en el nombre" = carpeta literal). Puro, nunca lanza.
 */
export function countPromptWordsInPath(prompt: string, relPath: string): number {
  try {
    if (!prompt || !relPath) return 0;
    const words = new Set(
      prompt
        .toLowerCase()
        .split(/[^a-z0-9áéíóúñü]+/i)
        .map((w) => w.trim())
        .filter((w) => w.length > 3),
    );
    if (words.size === 0) return 0;
    const base = relPath.replace(/\\/g, "/").split("/").filter(Boolean).join(" ").toLowerCase();
    let count = 0;
    for (const w of words) {
      if (base.includes(w)) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * H-001 / E2E-05: true si `relPath` parece una carpeta literal del prompt
 * (más de 3 palabras del prompt en el nombre). Puro, nunca lanza.
 */
export function isLiteralFolderName(prompt: string, relPath: string): boolean {
  try {
    return countPromptWordsInPath(prompt, relPath) > 3;
  } catch {
    return false;
  }
}

/**
 * E1-B (parser deterministico ante doble escape JSON en intake):
 * `job-mtot0raj-0r2m` (retry3) guarda `carpeta "spec-demo"` (0x22) y parsea;
 * `job-mtp4fqut-ncsf` (retry4) guarda `carpeta \"spec-demo\"` (0x5C 0x22) con
 * el MISMO prompt humano y cae a Triage en `:226`. El intake via browser
 * fetch puede persistir backslashes literales (`\"` -> backslash + quote en
 * el string real). Sin normalizar, el mismo intent humano da dos outcomes
 * segun la capa de escape (no-determinismo aparente). Esta normalizacion
 * quita el backslash ante quote/backslash (`\"`->`"`, `\'`->`'`, `\\`->`\`)
 * en UNA pasada, pura, sin loops, delivery-safe: solo normaliza, jamas
 * inventa rutas (la duda sigue a Triage via H-001 como hoy).
 * Pura, nunca lanza.
 */
export function unescapePromptQuotes(prompt: string): string {
  try {
    if (!prompt || typeof prompt !== "string") return prompt;
    return prompt.replace(/\\(["'\\])/g, "$1");
  } catch {
    return prompt;
  }
}

export interface ParsedRequested {
  relPath: string;
  isFolder: boolean;
  content: string; // para files, contenido extraído después de "con"
}

/**
 * Parsea el prompt para extraer el archivo o carpeta pedido explícitamente.
 * Funciona con CUALQUIER nombre (entrecomillado, tras "llamado/a", tras la
 * keyword de carpeta, o ruta explicita). Ejemplos genericos:
 * - "crear un docs/<feature>.md con <contenido>" → { relPath: "docs/<feature>.md", isFolder:false, content:"<contenido>" }
 * - "cree una carpeta llamada <nombre> a nivel de .agents" → { relPath: ".agents/<nombre>", isFolder:true, content:"" }
 * - "crear carepta <nombre> en raiz" (typo en keyword) → { relPath: "<nombre>", isFolder:true, content:"" }
 * Retorna null si no hay pedido claro de ruta. Nunca contiene literales de
 * nombres propios: el nombre siempre sale del prompt del usuario.
 */
export function parseRequestedFromPrompt(prompt: string): ParsedRequested | null {
  if (!prompt || typeof prompt !== "string") return null;
  // E1-B: normalize escaped quotes first so `carpeta \"spec-demo\"` (retry4
  // intake bytes 0x5C 0x22) parses identically to `carpeta "spec-demo"`
  // (retry3 bytes 0x22). Deterministic for the quoted-folder shape in both
  // foreman contexts (pre/post spec-approve re-dispatch `skipTriageSpec`
  // never mutates `workItem.prompt`; the bytes differ at creation, not at
  // re-dispatch — verified on job.json/prompt.md hex).
  const normalizedInput = unescapePromptQuotes(prompt);
  const trimmed = normalizedInput.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // 1) Carpeta: keyword de idioma con tolerancia a typos en la keyword
  if (hasFolderIntent(trimmed)) {
    const hasAgents = lower.includes(".agents");
    let folderName: string | null = null;
    // H-001: true solo si el nombre vino entrecomillado explícito (ruta 1a:
    // alta confianza, exento del filtro anti-literal de abajo).
    let quotedExplicit = false;

    // 1a) Quoted after "llamado/a" or "se llame": e.g., se llame "Mi Proyecto"
    const quotedAfterLlamada = trimmed.match(/(?:llamad[ao]|se\s+llame)\s+["']([^"']+)["']/i);
    if (quotedAfterLlamada && quotedAfterLlamada[1]) {
      folderName = quotedAfterLlamada[1].trim().replace(/^["']+|["']+$/g, "");
      if (folderName.length > 0) quotedExplicit = true;
    }

    // 1b) Unquoted after "llamado/a" or "se llame" up to " en " or " a nivel" or end
    if (!folderName) {
      const unquotedAfterLlamada = trimmed.match(
        /(?:llamad[ao]|se\s+llame)\s+["']?([^\n"']+?)(?:\s+en\s+|\s+a\s+nivel|\s*$)/i
      );
      if (unquotedAfterLlamada && unquotedAfterLlamada[1]) {
        let cand = unquotedAfterLlamada[1].trim();
        cand = cand.replace(/^["']+|["']+$/g, "").trim();
        cand = cand.replace(/\s+en\s+la\s+raiz\s*$/i, "").replace(/\s+en\s+raiz\s*$/i, "").replace(/\s+a\s+nivel\s+de.*$/i, "").trim();
        if (cand.length > 0 && cand.length < 120 && !hasFolderIntent(cand)) {
          // H-001: mismo corte de cláusula de contenido que en 1c.
          cand = stripFileClause(cand);
          if (cand.length > 0) folderName = cand;
        }
      }
    }

    // 1a-bis) Quoted directly after carpeta keyword: e.g., carpeta "spec-demo" en ...
    // FU-3 A-retry (job-mtop4fcx-0rii): 1c fails on closing-quote-before-`en`
    // (`carpeta "spec-demo" en su interior` → null → fallbackNeedsTriage → Triage
    // even though Foreman decided building with an approved brief). Explicit quotes
    // are high confidence like 1a, but delivery-safe: only a plausible folder
    // token is accepted (no path separators, sanitized single token, confident);
    // doubt falls through to 1c/Triage as today, never mkdir literal.
    // Takes effect after user restart (daemon single-load, no watch mode).
    if (!folderName) {
      const quotedAfterCarpeta = trimmed.match(
        /(?:carpeta|carepta|carpta|directorio|folder)\s+(?:llamad[ao]\s+)?["']([^"']+)["']/i,
      );
      if (quotedAfterCarpeta && quotedAfterCarpeta[1]) {
        const candQ = quotedAfterCarpeta[1].trim().replace(/^["']+|["']+$/g, "").trim();
        if (candQ.length > 0 && candQ.length < 120 && !candQ.includes("/") && !candQ.includes("\\")) {
          const cleanedQ = candQ
            .replace(/[^A-Za-z0-9_\- ÁáÉéÍíÓóÚúÑñ]/g, "")
            .replace(/\s+/g, " ")
            .trim();
          if (cleanedQ.length > 0 && !isUnconfidentFolderName(cleanedQ)) {
            folderName = candQ;
            quotedExplicit = true;
          }
          // else: doubt → leave folderName null (falls to 1c → null → Triage, as today).
        }
      }
    }

    // 1c) After carpeta keyword (con o sin "llamado/a")
    if (!folderName) {
      const afterCarpetaMatch = trimmed.match(
        /(?:carpeta|carepta|carpta|directorio|folder)\s+(?:llamad[ao]\s+)?["']?([^\n"']+?)["']?(?:\s+en\s+|\s+con\s+|\s+que\s+|\s+a\s+nivel|[\s,;:]*$)/i
      );
      if (afterCarpetaMatch && afterCarpetaMatch[1]) {
        let cand = afterCarpetaMatch[1].trim().replace(/^["']+|["']+$/g, "").trim();
        cand = cand.replace(/\s+en\s+la\s+raiz\s*$/i, "").replace(/\s+en\s+raiz\s*$/i, "").replace(/\s+a\s+nivel\s+de.*$/i, "").trim();
        // Handle inner "que se llame"
        const innerSeLlame = cand.match(/se\s+llame\s+["']?([^\n"']+)/i);
        if (innerSeLlame && innerSeLlame[1]) {
          let inner = innerSeLlame[1].trim().replace(/^["']+|["']+$/g, "");
          inner = inner.replace(/\s+en\s+.*$/i, "").trim();
          if (inner.length > 0) cand = inner;
        }
        if (cand.toLowerCase().includes("que se llame")) {
          const parts = cand.split(/que\s+se\s+llame/i);
          if (parts[1]) cand = parts[1].trim().replace(/^["']+|["']+$/g, "");
        }
        if (cand.length > 0 && cand.length < 120) {
          // H-001: "carpeta X con un archivo Y..." → la carpeta es X; la
          // cláusula "con un archivo ..." describe contenido, no nombre.
          cand = stripFileClause(cand);
          // Remove any remaining trailing "en ..." or "que ..."
          cand = cand.split(/\s+en\s+/i)[0]?.trim() ?? cand;
          cand = cand.split(/\s+que\s+/i)[0]?.trim() ?? cand;
          // Delivery-safe: a folder token never carries path separators.
          // Quoted paths like "spec-demo/esquema" are doubt → Triage, never
          // sanitized into a concatenated literal (H-001).
          if (cand.includes("/") || cand.includes("\\")) {
            // leave folderName null (falls to Triage, as today).
          } else if (cand.length > 0) folderName = cand;
        }
      }
    }

    if (folderName) {
      // Sanitize: allow letters, numbers, underscore, hyphen, space, spanish chars
      const cleaned = folderName.replace(/[^A-Za-z0-9_\- ÁáÉéÍíÓóÚúÑñ]/g, "").replace(/\s+/g, " ").trim();
      if (cleaned.length > 0) {
        // H-001: red de confianza para nombres NO entrecomillados (rutas 1b/1c,
        // regex frágil): si el residuo parece texto del prompt en vez de un
        // nombre (menciona archivo/fichero o tiene >3 palabras), NO hay parse
        // confiable → null (el caller deriva a triage, jamás mkdir literal).
        // Los nombres entrecomillados (1a/1a-bis) son explícitos y no pasan este filtro.
        if (!quotedExplicit && isUnconfidentFolderName(cleaned)) {
          return null;
        }
        // Check explicit .agents path in original prompt
        const agentsExplicit = trimmed.match(/\.agents\/[A-Za-z0-9_\- ]+/i);
        if (agentsExplicit && hasAgents) {
          const p = agentsExplicit[0].replace(/\\/g, "/").replace(/^\/+/, "").trim();
          // Use explicit path if it matches cleaned
          if (p.toLowerCase().includes(cleaned.toLowerCase())) {
            return { relPath: p, isFolder: true, content: "" };
          }
        }
        const relPath = hasAgents ? `.agents/${cleaned}` : cleaned;
        return { relPath: relPath.replace(/\\/g, "/"), isFolder: true, content: "" };
      }
    }

    const agentsPathMatch = trimmed.match(/\.agents\/[A-Za-z0-9_\-\/ ]+/i);
    if (agentsPathMatch) {
      const p = agentsPathMatch[0].replace(/\\/g, "/").replace(/^\/+/, "").trim();
      return { relPath: p, isFolder: true, content: "" };
    }

    // Folder intent without an extractable name: no hay pedido claro.
    return null;
  }

  // 2) Archivo .md (priorizar docs/...md). Generico: cualquier ruta .md.
  const mdRegex = /([A-Za-z0-9_\-\/]+\.md)/gi;
  const mdMatches = trimmed.match(mdRegex);
  if (mdMatches && mdMatches.length > 0) {
    let relPath: string | null = null;
    for (const m of mdMatches) {
      const norm = m.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
      if (norm.toLowerCase().startsWith("docs/")) {
        relPath = norm;
        break;
      }
    }
    if (!relPath) {
      relPath = mdMatches[0].replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
    }
    if (relPath) {
      relPath = relPath.replace(/\\/g, "/");
      let content = "";
      const lowerRel = relPath.toLowerCase();
      const lowerPrompt = lower;
      let idx = lowerPrompt.indexOf(lowerRel);
      if (idx === -1) {
        const idx2 = trimmed.toLowerCase().indexOf(lowerRel);
        idx = idx2;
      }
      if (idx !== -1) {
        const after = trimmed.slice(idx + relPath.length);
        const conIdx = after.toLowerCase().indexOf(" con ");
        if (conIdx !== -1) {
          content = after.slice(conIdx + 5).trim();
          content = content.replace(/^["']+/, "").replace(/["']+$/, "");
          if (content.toLowerCase().startsWith("contenido ")) {
            content = content.slice(10).trim();
          }
          const quoted = content.match(/^["'](.+)["']$/);
          if (quoted) content = quoted[1];
          content = content.slice(0, 2000);
        }
      }
      return { relPath, isFolder: false, content };
    }
  }

  return null;
}

/**
 * Truncate model prose for timeline evidence. Every branch records what the
 * model returned capped at IMPLEMENT_MODEL_SNIPPET_MAX chars, so the
 * timeline explains the outcome without storing full prose. Pure, never throws.
 */
export function truncateModelSnippet(text: unknown): string {
  try {
    if (typeof text !== "string") return "";
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (collapsed.length <= IMPLEMENT_MODEL_SNIPPET_MAX) return collapsed;
    return collapsed.slice(0, IMPLEMENT_MODEL_SNIPPET_MAX);
  } catch {
    return "";
  }
}

/**
 * True when the prompt asks to MODIFY existing files instead of creating
 * new ones. Requires BOTH a modify verb (whole-word match, so "prefix" or
 * "suffix" never count) AND a file-like token (name with extension or path
 * with a slash). Generic: language keywords plus a shape, zero proper-name
 * literals. Pure, never throws.
 */
export function hasModifyIntent(prompt: string): boolean {
  try {
    if (!prompt || typeof prompt !== "string") return false;
    const verbRe =
      /\b(modific\w*|modif\w*|edit\w*|fix|correg\w*|arregl\w*|actualiz\w*|updat\w*|cambi\w*|chang\w*|patch|refactor\w*|repar\w*|repair\w*|bug\w*)\b/i;
    if (!verbRe.test(prompt)) return false;
    const fileTokenRe = /[A-Za-z0-9_\-][A-Za-z0-9_\-./]*\.[A-Za-z0-9]{1,6}\b|[A-Za-z0-9_\-]+(?:\/[A-Za-z0-9_\-]+)+/;
    return fileTokenRe.test(prompt);
  } catch {
    return false;
  }
}

/**
 * Bounded fallback guard: a MODIFY-existing request with no exact parsed
 * path must fail honest to Triage with a reason — never a ghost doc.
 * Returns the ready timeline reason, or null for the normal path (exact
 * create parse, or an ambiguous prompt that keeps the legacy marker).
 * H-001/H-012 intact: folder-without-parse still routes via
 * fallbackNeedsTriage in the caller, before this check matters.
 * Pure, never throws.
 */
export function fallbackRefusalReason(prompt: string): string | null {
  try {
    if (!prompt || typeof prompt !== "string") return null;
    if (parseRequestedFromPrompt(prompt)) return null;
    if (!hasModifyIntent(prompt)) return null;
    return (
      "bounded fallback refused a ghost doc: the request modifies existing files " +
      "but names no exact new path and the model left no applicable text — " +
      "routing to human triage instead of writing an unrelated marker file"
    );
  } catch {
    return null;
  }
}

export interface BoundedFallbackResult {
  /** Files created on disk (exact new path, legacy marker, or none). */
  files: string[];
  /** Non-null when the fallback honestly refused (modify request, no ghost doc). */
  refused: string | null;
}

/**
 * Bounded fallback: creates ONLY the exact NEW file/folder the prompt
 * requests. A modify-existing request without an exact parse is refused
 * honestly (no disk write, reason for Triage). Truly ambiguous prompts keep
 * the single legacy marker as last resort. Never throws.
 */
export function tryBoundedFallback(
  input: ImplementInput | Pick<WorkItem, "id" | "prompt" | "worktree">,
): BoundedFallbackResult {
  try {
    const prompt = (input as { prompt: string }).prompt ?? "";
    const refused = fallbackRefusalReason(prompt);
    if (refused) return { files: [], refused };
    return { files: writeFallbackTarget(input), refused: null };
  } catch {
    return { files: [], refused: null };
  }
}

/**
 * List file-like tokens in a prompt (names with extension or slash paths),
 * capped for bounded scans. Pure, never throws.
 */
export function listPromptFileTokens(prompt: string, cap = 10): string[] {
  try {
    if (!prompt || typeof prompt !== "string") return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const re = /[A-Za-z0-9_\-./]+\.[A-Za-z0-9]{1,6}\b/g;
    const hits = prompt.match(re) ?? [];
    const capped = hits.slice(0, Math.max(cap, 0));
    for (const raw of capped) {
      const tok = raw.replace(/^\/+/, "").replace(/^\.\//, "").trim();
      if (tok.length === 0 || tok.length > 180 || seen.has(tok)) continue;
      if (tok.includes("..")) continue;
      seen.add(tok);
      out.push(tok);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Extract the first fenced code block (```...```) from model prose, minus
 * the optional language tag line, capped at 4000 chars. Prose without a
 * block is NOT applicable patch material (returns null). Pure, never throws.
 */
export function extractFirstCodeBlock(llmText: string): string | null {
  try {
    if (!llmText || typeof llmText !== "string") return null;
    const m = llmText.match(/```(?:[A-Za-z0-9_+-]*\n)?([\s\S]*?)```/);
    if (!m || typeof m[1] !== "string") return null;
    const body = m[1].replace(/^\s+/, "").replace(/\s+$/, "");
    if (body.length === 0) return null;
    return body.slice(0, 4000);
  } catch {
    return null;
  }
}

/**
 * Apply model prose as a patch over EXISTING files when applicable: the
 * prompt must name a file that already exists on disk, and the prose must
 * carry a fenced code block. Writes the block into the first such file
 * (single file, minimal) and returns its relative path. Anything else
 * (missing file, prose without code) returns [] — never a generic doc.
 * Bounded, sync, never throws.
 */
export function tryApplyTextAsPatch(
  worktreePath: string,
  prompt: string,
  llmText: string,
): string[] {
  try {
    if (!worktreePath || !prompt || !llmText) return [];
    const block = extractFirstCodeBlock(llmText);
    if (!block) return [];
    const base = path.resolve(worktreePath);
    const tokens = listPromptFileTokens(prompt, 10);
    for (const tok of tokens) {
      const rel = tok.replace(/\\/g, "/");
      const full = path.join(base, rel);
      let isFile = false;
      try {
        isFile = fs.statSync(full).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) continue;
      try {
        const content = block.endsWith("\n") ? block : `${block}\n`;
        fs.writeFileSync(full, content, "utf-8");
        return [rel];
      } catch {
        return [];
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Shared writer behind tryBoundedFallback and the legacy entry: exact
 * parsed target first, single legacy marker as last resort. Never throws.
 */
function writeFallbackTarget(
  input: ImplementInput | Pick<WorkItem, "id" | "prompt" | "worktree">,
): string[] {
  const id = (input as { id: string }).id;
  const prompt = (input as { prompt: string }).prompt ?? "";
  const worktreePath =
    (input as ImplementInput).worktreePath ??
    (input as WorkItem).worktree ??
    "";
  const resolvedWorktree = path.resolve(worktreePath || process.cwd());

  // Intentar parsear pedido exacto del prompt antes de marker genérico
  const parsed = parseRequestedFromPrompt(prompt);
  if (parsed) {
    const fullPath = path.join(resolvedWorktree, parsed.relPath);
    try {
      if (parsed.isFolder) {
        fs.mkdirSync(fullPath, { recursive: true });
        if (fs.existsSync(fullPath)) {
          return [parsed.relPath.replace(/\\/g, "/")];
        }
      } else {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        let fileContent: string;
        if (parsed.content && parsed.content.trim().length > 0) {
          fileContent = parsed.content;
          if (!fileContent.endsWith("\n")) fileContent += "\n";
        } else {
          fileContent = `<!-- ola3 ${id} -->\n# ${path.basename(parsed.relPath, ".md")}\n\n${prompt.slice(0, 500)}\n`;
        }
        fs.writeFileSync(fullPath, fileContent, "utf-8");
        if (fs.existsSync(fullPath)) {
          return [parsed.relPath.replace(/\\/g, "/")];
        }
      }
    } catch (e) {
      console.warn(`[minimalChange] parsed fallback write failed for ${parsed.relPath}: ${String(e)}`);
    }
  }

  // Fallback genérico (1 archivo marker) — solo si no se pudo crear archivo real
  // Nota: este marker es último recurso; el LLM con tools debe crear archivos
  // reales. Pero si cae aquí, es fail-safe.
  const docsDir = path.join(resolvedWorktree, "docs");
  try {
    fs.mkdirSync(docsDir, { recursive: true });
  } catch {}
  const fileName = `implement-ola3-${id}.md`;
  const filePath = path.join(docsDir, fileName);
  const relPath = `docs/${fileName}`;
  const nowIso = new Date().toISOString();
  const content = [
    `<!-- ola3 ${id} -->`,
    `# Implement Ola 3 — ${id}`,
    ``,
    `> Fallback determinístico (cambio mínimo).`,
    `> Prompt: ${prompt.slice(0, 500).replace(/\n/g, " ")}`,
    `> Worktree: ${resolvedWorktree}`,
    `> Timestamp: ${nowIso}`,
    ``,
    `Este archivo es el cambio mínimo para el WorkItem \`${id}\`.`,
    ``,
    `Prompt original:`,
    ``,
    "```",
    prompt.slice(0, 2000),
    "```",
    ``,
    `> Generado por ImplementAgent fallback (1 archivo, no rompe build).`,
    ``,
  ].join("\n");
  try {
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (e) {
    console.warn(`[minimalChange] fallback write failed: ${String(e)}`);
    return [];
  }
  return [relPath];
}

/**
 * Legacy deterministic fallback entry (pacts and existing callers).
 * Bounded since the traceability track: modify-existing requests without
 * an exact parse return [] with no disk write (honest refusal; the caller
 * routes to Triage via tryBoundedFallback). Exact creates and the ambiguous
 * last-resort marker behave as before. Never throws.
 */
export function fallbackMinimalChange(
  input: ImplementInput | Pick<WorkItem, "id" | "prompt" | "worktree">,
): string[] {
  try {
    return tryBoundedFallback(input).files;
  } catch {
    return [];
  }
}

/**
 * Rollback helper: si createdFiles > threshold (3), elimina los archivos creados
 * que no existían antes (solo untracked). Retorna true si hizo rollback.
 * Si >3 rollback + fallback → Triage.
 */
export function rollbackIfExceeds(
  worktreePath: string,
  createdFiles: string[],
  threshold = 3,
): boolean {
  if (createdFiles.length <= threshold) return false;
  const resolved = path.resolve(worktreePath);
  let rolledBack = false;
  for (const rel of createdFiles) {
    if (!rel.startsWith("docs/implement-ola3-")) continue;
    const full = path.join(resolved, rel);
    try {
      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
        rolledBack = true;
      }
    } catch {}
  }
  return rolledBack;
}

/**
 * Ensure rollback for generic exceed — delete all createdFiles that were untracked
 * and count > threshold. Caller should then call fallbackMinimalChange.
 */
export function rollbackAllIfExceeds(
  worktreePath: string,
  createdFiles: string[],
  threshold = 3,
): boolean {
  if (createdFiles.length <= threshold) return false;
  const resolved = path.resolve(worktreePath);
  for (const rel of createdFiles) {
    const full = path.join(resolved, rel);
    try {
      if (rel.startsWith("docs/") || rel.includes("ola3")) {
        if (fs.existsSync(full)) fs.unlinkSync(full);
      }
    } catch {}
  }
  return true;
}
