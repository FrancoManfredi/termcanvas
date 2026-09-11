/**
 * Reverify allowlist — Ola 17 (Paridad Warp: review que re-valida).
 *
 * El reviewer (modelo) jamás toca bash: solo PIDE re-verificación enfocada
 * vía `ReviewFinding.reverify`. Este módulo decide qué pedidos son
 * ejecutables (allowlist cerrada) y el SISTEMA los ejecuta
 * (`VerificationService.runFocused`). Fail-closed: lo no listado se ignora
 * con nota, nunca lanza.
 *
 * Allowlist EXACTA (case-sensitive tras trim, nada más pasa):
 * - `pnpm test` | `pnpm build` | `git diff --stat` | `git status --porcelain`
 * - `git diff -- <paths>`: exige `--` + ≥1 path relativo dentro del job
 *   (sin `..` que escape, sin absolutas, sin flags extra, sin metacaracteres
 *   de shell). Cada path debe coincidir con un archivo del job o ser un
 *   directorio ancestro de uno de ellos (comparación normalizada de
 *   separadores + `..` resuelto; debe quedar dentro del worktree).
 *
 * ESM puro, cero `require()`. `validateReverifyCommands` y
 * `capReverifyEvidence` son puras (iteración acotada a los inputs, sin IO,
 * sin throw); el flag `reviewerReverify` lee factory.yaml con fallback
 * (Regla 8: `false` = revise clásico exacto).
 */

import path from "node:path";
import { getFactoryConfig } from "../factory/agentLoader";
import { REVERIFY_MAX_COMMAND_LEN } from "../../shared/types/review";

// ── Allowlist ──

/** Comandos exactos (comparación case-sensitive tras trim). */
export const REVERIFY_EXACT_COMMANDS = [
  "pnpm test",
  "pnpm build",
  "git diff --stat",
  "git status --porcelain",
] as const;

/** Prefijo de la única forma parametrizada: `git diff -- <paths>`. */
export const REVERIFY_DIFF_PREFIX = "git diff --";

/** Nota fail-closed ante pedidos fuera de la allowlist (contrato exacto). */
export const REVERIFY_IGNORED_NOTE = "reverify ignorado: comando fuera de allowlist";

/** Cap de evidence en el evento de timeline (8KB, contrato). */
export const REVERIFY_EVIDENCE_MAX_BYTES = 8 * 1024;

/** Marca de truncado de evidence (contrato exacto). */
export const REVERIFY_TRUNCATION_MARK = "…[truncado]";

/**
 * Metacaracteres de shell / controles rechazados en CUALQUIER comando
 * (defensa en profundidad: `;`, `|`, `&`, `>`, `<`, backtick, `$`, comillas,
 * paréntesis, globs, `!#~%^` y todo char de control incl. `\n\r`). Los 4
 * comandos exactos no contienen ninguno, así que el filtro jamás rechaza
 * un comando listado.
 */
const REVERIFY_FORBIDDEN_RE = /[;|&><`$"'\u0000-\u001F()[\]{}*?!#~%^]/;

export interface ReverifyValidation {
  valid: string[];
  invalid: string[];
  note: string | null;
}

/**
 * Normaliza un path pedido a forma `a/b/c` (separadores `/`, `.` omitidos,
 * `..` resuelto). Retorna null si es absoluto o el `..` escapa del worktree
 * (fail-closed). Puro, sin IO, sin throw.
 */
function normalizeJobRelativePath(raw: string): string | null {
  try {
    if (typeof raw !== "string") return null;
    const p = raw.replace(/\\/g, "/").trim();
    if (p.length === 0) return null;
    if (p.startsWith("/")) return null;
    if (/^[A-Za-z]:(\/|$)/.test(p)) return null;
    const parts = p.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (stack.length === 0) return null;
        stack.pop();
        continue;
      }
      stack.push(part);
    }
    if (stack.length === 0) return null;
    return stack.join("/");
  } catch {
    return null;
  }
}

/** Normaliza los paths del job a un set comparable. Puro, nunca lanza. */
function normalizeJobPaths(jobPaths: string[]): Set<string> {
  const out = new Set<string>();
  try {
    for (const entry of jobPaths ?? []) {
      const norm = normalizeJobRelativePath(entry);
      if (norm !== null) out.add(norm);
    }
  } catch {
    // best-effort: lo normalizado hasta acá vale
  }
  return out;
}

/**
 * True si el candidato es directorio ancestro de ≥1 path del job
 * (permite `git diff -- src` cuando el job tocó `src/a.ts`). El comando
 * sigue siendo read-only; el riesgo de escape lo cubre la validación
 * de `..`/absolutas. Puro, nunca lanza.
 */
function isAncestorDirOfJobPath(candidate: string, jobSet: Set<string>): boolean {
  try {
    const prefix = `${candidate}/`;
    for (const jobPath of jobSet) {
      if (jobPath.startsWith(prefix)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Extrae los paths de `git diff -- <paths>` (null si no tiene esa forma o
 * trae flags extra). Puro, nunca lanza.
 */
function parseDiffPaths(cmd: string): string[] | null {
  try {
    if (cmd === REVERIFY_DIFF_PREFIX) return null;
    if (!cmd.startsWith(`${REVERIFY_DIFF_PREFIX} `)) return null;
    const rest = cmd.slice(REVERIFY_DIFF_PREFIX.length).trim();
    if (rest.length === 0) return null;
    const tokens = rest.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) return null;
    for (const token of tokens) {
      if (token.startsWith("-")) return null;
    }
    return tokens;
  } catch {
    return null;
  }
}

/**
 * True si el comando tiene forma `git diff -- <paths>` con todos los paths
 * dentro del job y del worktree. Puro (la resolución es léxica), nunca lanza.
 */
function isAllowedDiffCommand(
  cmd: string,
  jobSet: Set<string>,
  worktree: string | null,
): boolean {
  try {
    const tokens = parseDiffPaths(cmd);
    if (!tokens) return false;
    for (const token of tokens) {
      const norm = normalizeJobRelativePath(token);
      if (norm === null) return false;
      if (!jobSet.has(norm) && !isAncestorDirOfJobPath(norm, jobSet)) return false;
      if (worktree !== null) {
        let rel = "";
        try {
          rel = path.relative(worktree, path.resolve(worktree, norm));
        } catch {
          return false;
        }
        if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Valida pedidos de re-verificación contra la allowlist cerrada.
 * Normalización: trim; comparación exacta case-sensitive; `git diff --`
 * exige `--` + ≥1 path relativo válido dentro del job.
 * Nunca lanza: ante cualquier input inesperado, todo a inválido con nota.
 */
export function validateReverifyCommands(
  commands: unknown,
  jobWorktree: string,
  jobPaths: string[],
): ReverifyValidation {
  try {
    if (!Array.isArray(commands) || commands.length === 0) {
      return { valid: [], invalid: [], note: REVERIFY_IGNORED_NOTE };
    }
    const valid: string[] = [];
    const invalid: string[] = [];
    const jobSet = normalizeJobPaths(Array.isArray(jobPaths) ? jobPaths : []);
    let worktree: string | null = null;
    try {
      worktree =
        typeof jobWorktree === "string" && jobWorktree.length > 0
          ? path.resolve(jobWorktree)
          : null;
    } catch {
      worktree = null;
    }
    for (const entry of commands) {
      if (typeof entry !== "string") {
        try {
          invalid.push(String(entry).slice(0, 120));
        } catch {
          invalid.push("[no-string]");
        }
        continue;
      }
      const cmd = entry.trim();
      if (
        cmd.length === 0 ||
        cmd.length > REVERIFY_MAX_COMMAND_LEN ||
        REVERIFY_FORBIDDEN_RE.test(cmd)
      ) {
        invalid.push(cmd.slice(0, 120));
        continue;
      }
      if ((REVERIFY_EXACT_COMMANDS as readonly string[]).includes(cmd)) {
        if (!valid.includes(cmd)) valid.push(cmd);
        continue;
      }
      if (isAllowedDiffCommand(cmd, jobSet, worktree)) {
        if (!valid.includes(cmd)) valid.push(cmd);
        continue;
      }
      invalid.push(cmd.slice(0, 120));
    }
    return { valid, invalid, note: invalid.length > 0 ? REVERIFY_IGNORED_NOTE : null };
  } catch {
    return { valid: [], invalid: [], note: REVERIFY_IGNORED_NOTE };
  }
}

/**
 * Capa la evidence a 8KB con marca `…[truncado]` (contrato del evento de
 * timeline). Pura, nunca lanza.
 */
export function capReverifyEvidence(evidence: unknown): string {
  try {
    const text = typeof evidence === "string" ? evidence : String(evidence ?? "");
    if (text.length <= REVERIFY_EVIDENCE_MAX_BYTES) return text;
    return text.slice(0, REVERIFY_EVIDENCE_MAX_BYTES) + REVERIFY_TRUNCATION_MARK;
  } catch {
    return "";
  }
}

// ── Interruptor (Regla 8) ──

/**
 * Seam SOLO para tests: fuerza el flag sin tocar factory.yaml.
 * `null` = sin override (lee el yaml real). Espejo de
 * `setAgentSessionsOverrideForTests` (Ola 16).
 */
let reviewerReverifyOverride: boolean | null = null;

export function setReviewerReverifyOverrideForTests(value: boolean | null): void {
  reviewerReverifyOverride = value;
}

export function resetReviewerReverifyOverrideForTests(): void {
  reviewerReverifyOverride = null;
}

/**
 * Flag `reviewerReverify` de factory.yaml (default true). Apagado = revise
 * clásico exacto (cero ejecuciones). Nunca lanza: ante cualquier fallo,
 * default `true` (re-validación encendida).
 */
export function isReviewerReverifyEnabled(): boolean {
  try {
    if (reviewerReverifyOverride !== null) return reviewerReverifyOverride;
    const cfg = getFactoryConfig() as { reviewerReverify?: unknown } | null;
    return cfg?.reviewerReverify !== false;
  } catch {
    return true;
  }
}
