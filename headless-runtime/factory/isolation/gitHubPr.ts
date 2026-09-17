/**
 * GitHub PR handoff given isolated factory jobs.
 *
 * Warp rule (non-negotiable): this module opens the review PR on first
 * `Complete` and never finalizes the human side — no primitive that
 * completes a PR is exported here, ever. The human merge stays in
 * Electron main plus the GitHub UI.
 *
 * Push + `gh pr create` (body carries `Closes #N`) run exactly once per
 * job (`prGuard` in `isolationStore.ts`); failure is honest (timeline
 * event, job stays `Complete`, manual command hint). `readPrState` backs
 * the explicit-cleanup guard. Every export never throws.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../../workItem/workItemStore";
import { resolveBotReconcileGate } from "../settings/factorySettingsStore";
import type { WorkItem } from "../../../shared/types/workItem";
import { buildCommitSubject, buildPrBody, buildPrTitle, capTextAtBoundary, extractCommitUnits, extractDispositions, prGuard, parseIssueTitleFromPrompt, summarizeDetailsForCommit, type PrBodyDetails } from "./isolationStore";
import {
  appendBotReviewSection,
  applyBotFindingsToReport,
  assertReportIntegrity,
  refreshReviewReportMeta,
  parseReviewReportMeta,
} from "../../review/reviewReport";
import {
  changedFilesSince,
  reconcileBotFindings,
  waitForBotReview,
} from "../../review/botReview";

/** Bound G02: `git push -u origin <branch>`, single attempt. */
export const GIT_PUSH_TIMEOUT_MS = 30000;

/** Bound G05: `git status --porcelain`, single attempt. */
export const GIT_STATUS_TIMEOUT_MS = 10000;

/** Bound G06: `git add -A` + `git commit`, single attempt each. */
export const GIT_COMMIT_TIMEOUT_MS = 15000;

/** Bound for the empty-branch pre-check (`git rev-list --count`), single attempt. */
export const GIT_REV_LIST_TIMEOUT_MS = 10000;

/** Bound G03: `gh pr create`, single attempt. */
export const GH_PR_CREATE_TIMEOUT_MS = 30000;

/** Bound G04: `gh pr view --json state`, single attempt. */
export const GH_PR_VIEW_TIMEOUT_MS = 15000;

/** Bound: `gh pr close` (abandon, sin merge), single attempt. */
export const GH_PR_CLOSE_TIMEOUT_MS = 15000;

/** Bound for best-effort post-create labeling (`gh pr edit --add-label`). */
export const GH_PR_LABEL_TIMEOUT_MS = 15000;

/** Bound G07: `gh pr comment` + comment verification, single attempt each. */
export const GH_PR_COMMENT_TIMEOUT_MS = 30000;

/** Bound for the publish head probe (`git rev-parse <branch>`). */
export const GIT_REV_PARSE_TIMEOUT_MS = 10000;

/** Bound for ground-truth PR files (`git diff --name-only base...branch`). */
export const GIT_DIFF_TIMEOUT_MS = 15000;

/** Cycle label for a brand-new reviewable PR (canvas parity). */
const REVIEW_LABEL_PENDING = "review:pendiente";

/**
 * Best-effort: tag the fresh PR with `review:pendiente` so the canvas/panel
 * derivation sees it without waiting for a live terminal watcher (factory
 * jobs have no canvas terminal; without this the row stays `pending` until
 * a manual refresh, issue #69). Never throws, never blocks the PR outcome.
 */
async function applyPendingLabelBestEffort(
  run: GhExecRun,
  repoPath: string,
  prNumber: number,
): Promise<void> {
  try {
    if (!repoPath || !Number.isInteger(prNumber) || prNumber <= 0) return;
    await run("gh", ["pr", "edit", String(prNumber), "--add-label", REVIEW_LABEL_PENDING], {
      cwd: repoPath,
      timeoutMs: GH_PR_LABEL_TIMEOUT_MS,
    }).catch(() => null);
  } catch {
    // best-effort: labeling never breaks the PR handoff
  }
}

/** Output cap given every git/gh spawn. */
export const GH_EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/** Slice width given honest error strings. */
const ERROR_SLICE = 200;

/** Injectable spawn (tests pass a fake; production uses execFile). */
export type GhExecRun = (
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

/**
 * Auth env mirror (copied shape of `electron/main.ts` `github:fetch-issues`:
 * `gh` reads `GH_TOKEN` or `GITHUB_TOKEN`; Electron may not inherit shell
 * env, so both are forwarded when either is set).
 */
export function ghEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.GH_TOKEN && process.env.GITHUB_TOKEN) {
    env.GH_TOKEN = process.env.GITHUB_TOKEN;
  }
  if (!env.GITHUB_TOKEN && process.env.GH_TOKEN) {
    env.GITHUB_TOKEN = process.env.GH_TOKEN;
  }
  return env;
}

/**
 * Production spawn: argv array (no shell), explicit timeout, capped
 * buffer, gh auth forwarding. Never throws by itself (callers catch).
 */
function defaultRun(
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, [...args], {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    maxBuffer: GH_EXEC_MAX_BUFFER_BYTES,
    env: ghEnv(),
    windowsHide: true,
  }).then((out) => ({
    stdout: typeof out.stdout === "string" ? out.stdout : String(out.stdout),
    stderr: typeof out.stderr === "string" ? out.stderr : String(out.stderr),
  }));
}

function sliceError(value: unknown): string {
  try {
    const msg = value instanceof Error ? value.message : String(value);
    return msg.slice(0, ERROR_SLICE);
  } catch {
    return "git/gh call failed";
  }
}

export interface OpenPrForJobInput {
  readonly repoPath: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly issueNumber: number;
  readonly title?: unknown;
  readonly details?: PrBodyDetails;
  readonly run?: GhExecRun;
  readonly writeBodyFile?: (file: string, body: string) => void;
  readonly unlinkBodyFile?: (file: string) => void;
  /**
   * Allowlist opcional de rutas relativas a commitear (reconciled
   * createdFiles). Cuando viene no-vacía manda sobre el porcelain.
   */
  readonly allowedPaths?: readonly unknown[];
  /**
   * Ronda de reconciliación post-bot: con un PR ya abierto, la reutilización
   * NO corta el commit/push del trabajo nuevo — solo evita crear otro PR.
   * Sin el flag, el comportamiento histórico (early return duplicate) intacto.
   */
  readonly reconcile?: boolean;
}

export type OpenPrForJobResult =
  | {
      ok: true;
      prNumber: number;
      prUrl: string;
      /** True when the PR already existed open (reused, nothing created). */
      duplicate?: true;
      /** Post-create verification (best-effort; absent when unverifiable). */
      state?: string;
      base?: string;
      head?: string;
      draft?: boolean;
    }
  | { ok: false; error: string; manualHint: string };

function manualPushHint(branch: string): string {
  return `git push -u origin ${branch}`;
}

function manualPrHint(
  branch: string,
  baseBranch: string,
  issueNumber: number,
  title: string,
): string {
  return (
    `${manualPushHint(branch)} && ` +
    `gh pr create --head ${branch} --base ${baseBranch} ` +
    `--title ${JSON.stringify(title)} --body ${JSON.stringify(`Closes #${issueNumber}`)}`
  );
}

/**
 * Empty-branch probe: commits on `branch` not on `baseBranch`
 * (`git rev-list --count <base>..<branch>`). Returns the count, or null
 * when the probe itself fails (unknown revision, missing branch, git
 * absent) — callers fail OPEN on null and proceed to the push/PR attempt
 * instead of blocking honest work on a probe failure. Never throws.
 *
 * Live evidence (job-mtqqz1fz-ntis, issue #60, Complete 04:41Z): the
 * implement wrote 0 deliverable files (createdFiles dropped H-001/H-012:
 * `docs/implement-ola3-*.md` nonexistent) → branch
 * `issue-60-todo-item-disappears-after-page-reload` identical to `main`
 * (`rev-list --count main..branch` = 0, verified read-only) → push ok but
 * `gh pr create` fails with no commits. Without this probe the daemon
 * logs the cryptic truncated `pr create failed: Command failed: gh pr
 * create … --body-file C:\…\Temp\termcanvas-` (ERROR_SLICE + timeline
 * 500-char slice hide the stderr); with it the timeline carries the honest
 * `nothing to propose` event + manual CTA instead. No PR URL is ever
 * invented here.
 */
export async function countBranchCommitsVsBase(input: {
  repoPath: string;
  branch: string;
  baseBranch: string;
  run: GhExecRun;
}): Promise<number | null> {
  try {
    const repoPath = typeof input?.repoPath === "string" ? input.repoPath : "";
    const branch = typeof input?.branch === "string" ? input.branch : "";
    const baseBranch =
      typeof input?.baseBranch === "string" ? input.baseBranch : "";
    if (
      repoPath.trim().length === 0 ||
      branch.trim().length === 0 ||
      baseBranch.trim().length === 0
    ) {
      return null;
    }
    const out = await input.run(
      "git",
      ["rev-list", "--count", `${baseBranch}..${branch}`],
      { cwd: repoPath, timeoutMs: GIT_REV_LIST_TIMEOUT_MS },
    );
    const raw = String(out?.stdout ?? "").trim();
    // `rev-list --count` prints a bare integer; anything else is unparseable.
    if (!/^\d+$/.test(raw)) return null;
    const count = Number.parseInt(raw, 10);
    return Number.isInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

/**
 * Worktree sucio o limpio (`git status --porcelain -uall`). Recorta SOLO la
 * cola (CRLF normalizado, sin newlines finales): el espacio líder de la
 * primera línea es el offset `XY` del formato (`" M archivo"`) y un `trim()`
 * completo lo borraba — `parsePorcelainPaths` cortaba de más y `js/app.js`
 * se volvía `s/app.js` (bug run #125: `git add` explotaba y el PR jamás se
 * abría). `-uall` enumera archivos untracked individualmente: sin él, git
 * colapsa el dir a `?? artifacts/` y una review aid (`artifacts/scope.md`)
 * pasaba el filtro exacto y shipeaba (PR #158). `""` = limpio. Null cuando
 * el probe falla (git ausente, no-repo, timeout) — el caller decide
 * fail-open. Read-only, nunca lanza.
 */
export async function readWorktreeStatusPorcelain(input: {
  repoPath: string;
  run: GhExecRun;
}): Promise<string | null> {
  try {
    const repoPath = typeof input?.repoPath === "string" ? input.repoPath : "";
    if (repoPath.trim().length === 0) return null;
    const out = await input.run("git", ["status", "--porcelain", "-uall"], {
      cwd: repoPath,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
    });
    return String(out?.stdout ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\s+$/, "");
  } catch {
    return null;
  }
}

/** Identidad de commit local del orquestador (sin depender del gitconfig). */
const FACTORY_GIT_USER_NAME = "termcanvas-factory";
const FACTORY_GIT_USER_EMAIL = "factory@termcanvas.local";

/**
 * Prefijos que el commit del orquestador JAMÁS incluye (ruido de toolchain y
 * del propio daemon, no cambio del issue). Espejo de `EXCLUDE_PREFIXES` de
 * `implement/minimalChange.ts` (duplicado a propósito: este módulo no puede
 * importar de implement sin ciclo). Nunca lanza.
 */
const COMMIT_EXCLUDE_PREFIXES: readonly string[] = [
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
  // Ayudas de review del propio ciclo (scope/planes/reportes): viven en el
  // worktree o en $ARTIFACTS_DIR, jamás en el PR.
  "review/",
];

/**
 * Ayudas de review del ciclo: viven en el worktree, jamás en un commit/PR.
 * Pura, case-insensitive, nunca lanza. Alimenta tanto el filtro de `add`
 * como el gate pre-push de `openPrForJob`.
 */
const REVIEW_AID_PATHS: ReadonlySet<string> = new Set([
  "artifacts/scope.md",
  "scope.md",
  "plan.md",
  "triage.md",
  "discoveries.json",
  "discoveries.md",
]);

/**
 * True si la ruta es una review aid del ciclo (scope/plan/triage/
 * discoveries o cualquier cosa bajo `review/`). Las formas de directorio
 * (`review/`, residuo de un porcelain colapsado) cuentan como aids: no hay
 * nada legítimo que shipear bajo `review/`. Pura, nunca lanza.
 */
export function isReviewAidPath(p: unknown): boolean {
  try {
    if (typeof p !== "string" || p.length === 0) return false;
    const norm = p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    if (norm.length === 0) return false;
    if (norm.endsWith("/")) return norm === "review/" || norm === "artifacts/";
    if (REVIEW_AID_PATHS.has(norm)) return true;
    return norm.startsWith("review/");
  } catch {
    return false;
  }
}

/** Archivos exactos que el commit jamás incluye (locks y review aids). */
const COMMIT_EXCLUDE_EXACT: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  // Ayudas de review en la raíz (ver prefijos arriba para `review/`).
  ...REVIEW_AID_PATHS,
]);

/** Tope de paths por `git add --` (misma cota que el reporte de cambios). */
const COMMIT_MAX_PATHS = 50;

/**
 * True si la ruta relativa puede entrar al commit del PR (pura, nunca
 * lanza). Fuera: ruido de toolchain/daemon (`node_modules/`, `dist/`,
 * `logs/`, `.agents/...`, worktrees), `*.log`, formas de directorio
 * (`dir/`) y las review aids del ciclo (`scope.md`, `review/`, ...).
 * Todo lo demás pasa, incluido el código y tests del issue.
 */
export function isCommittablePath(p: unknown): boolean {
  try {
    if (typeof p !== "string" || p.length === 0) return false;
    const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
    if (norm.length === 0 || norm.startsWith("/") || norm.includes("..")) return false;
    const lower = norm.toLowerCase();
    // Forma de directorio (porcelain sin `-uall` colapsa untracked dirs a
    // `artifacts/`): no es un archivo validable contra las listas exactas
    // y podía barrer una review aid dentro. Con `-uall` los archivos vienen
    // enumerados; un dir pelado se rechaza por las dudas.
    if (lower.endsWith("/")) return false;
    for (const pre of COMMIT_EXCLUDE_PREFIXES) {
      if (lower.startsWith(pre)) return false;
    }
    if (COMMIT_EXCLUDE_EXACT.has(lower)) return false;
    if (lower.endsWith(".log")) return false;
    if (lower.includes("logs/build.log")) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Parsea `git status --porcelain` a rutas relativas (pura, nunca lanza).
 * Soporta `XY PATH`, renombres `R  old -> new` (toma el destino), paths
 * entrecomillados y la primera línea sin el offset `XY` (texto que pasó por
 * un `trim()` aguas arriba: `"M archivo"` → path desde index 2, jamás
 * mutilado a `"s/archivo"`). Deduplica, acota a `COMMIT_MAX_PATHS`, ignora
 * basura.
 */
export function parsePorcelainPaths(porcelain: unknown): string[] {
  try {
    if (typeof porcelain !== "string" || porcelain.length === 0) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const rawLine of porcelain.split("\n")) {
      try {
        // Offset `XY` canónico: el separador vive en index 2. Si no es un
        // espacio pero la línea abre con un status + espacio (`"M ruta"`,
        // primera línea trimeada por un caller), el path arranca en 2.
        const statusLost =
          rawLine.length >= 3 &&
          rawLine[2] !== " " &&
          rawLine[1] === " " &&
          "MADRCU?!".includes(rawLine[0] as string);
        const line =
          rawLine.length >= 3
            ? rawLine.slice(statusLost ? 2 : 3)
            : rawLine.trim();
        let rel = line.trim();
        if (rel.length === 0) continue;
        const arrow = rel.indexOf(" -> ");
        if (arrow >= 0) rel = rel.slice(arrow + 4).trim();
        if (rel.startsWith('"') && rel.endsWith('"') && rel.length >= 2) {
          rel = rel.slice(1, -1);
        }
        rel = rel.replace(/\\/g, "/").replace(/^\.\//, "");
        if (rel.length === 0 || rel.includes("..")) continue;
        if (!seen.has(rel)) {
          seen.add(rel);
          out.push(rel);
        }
        if (out.length >= COMMIT_MAX_PATHS) break;
      } catch {
        // una línea rota nunca aborta el parseo
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Registra el trabajo del worktree en la rama (`git add -- <paths>` + `git
 * commit` con identidad `-c`). Commit SELECTIVO (fix #69/#70: el `add -A`
 * ciego commiteaba `node_modules/` y `logs/build.log` → PRs de +1M
 * líneas): solo entran rutas commiteables — `allowedPaths` cuando el
 * caller las trae, si no las del `knownStatus` porcelain ya leído por el
 * caller (cero spawns extra), y como último recurso `add -A` con pathspec
 * de exclusión. Si tras filtrar no queda nada commiteable, honesto
 * `ok:false` (el caller decide: nothing-to-propose). Single attempt por
 * comando. Nunca lanza.
 */
export async function commitWorktreeChanges(input: {
  repoPath: string;
  issueNumber: number;
  run: GhExecRun;
  knownStatus?: string | null;
  allowedPaths?: readonly unknown[];
  /**
   * Cuerpo del commit (summary + files + validation, ya acotado por el
   * caller). Vacío = commit solo con headline.
   */
  messageBody?: unknown;
  /**
   * Subject del commit (conventional, ya construido por el caller). Vacío
   * o ausente = headline legacy `factory: implement issue #N (handoff)`.
   */
  messageSubject?: unknown;
  /**
   * WS-F: unidades de trabajo (una por commit, en orden). Cada `paths` se
   * intersecta con los candidatos commiteables reales; los candidatos no
   * asignados cierran en un commit final `chore: remaining changes`. Vacío
   * o inválido = commit único legacy.
   */
  units?: readonly { subject?: unknown; body?: unknown; paths?: readonly unknown[] }[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const repoPath = typeof input?.repoPath === "string" ? input.repoPath : "";
    const n = input?.issueNumber;
    if (
      repoPath.trim().length === 0 ||
      typeof n !== "number" ||
      !Number.isInteger(n) ||
      n <= 0
    ) {
      return { ok: false, error: "repoPath/issueNumber are required" };
    }
    const run = input.run;
    let candidates: string[] = [];
    try {
      const raw = input?.allowedPaths;
      if (Array.isArray(raw) && raw.length > 0) {
        const seen = new Set<string>();
        for (const c of raw) {
          if (typeof c !== "string") continue;
          const norm = c.replace(/\\/g, "/").replace(/^\.\//, "");
          if (!isCommittablePath(norm) || seen.has(norm)) continue;
          seen.add(norm);
          candidates.push(norm);
          if (candidates.length >= COMMIT_MAX_PATHS) break;
        }
      } else if (typeof input?.knownStatus === "string") {
        for (const rel of parsePorcelainPaths(input.knownStatus)) {
          if (!isCommittablePath(rel)) continue;
          candidates.push(rel);
          if (candidates.length >= COMMIT_MAX_PATHS) break;
        }
      }
    } catch {
      candidates = [];
    }
    // WS-F: unidades de trabajo declaradas por el implement. Solo paths del
    // set committable entran; duplicados/desconocidos se descartan. Sin
    // unidades válidas la ruta de commit único legacy queda intacta.
    const commitUnits: Array<{ subject: string; body: string; paths: string[] }> = [];
    try {
      if (Array.isArray(input?.units) && input.units.length > 0) {
        const candidateSet = new Set(candidates);
        const assigned = new Set<string>();
        for (const raw of input.units) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const u = raw as { subject?: unknown; body?: unknown; paths?: unknown };
          const subject = typeof u.subject === "string" ? u.subject.trim().slice(0, 160) : "";
          if (subject === "" || !Array.isArray(u.paths)) continue;
          const paths: string[] = [];
          for (const p of u.paths) {
            if (typeof p !== "string") continue;
            const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
            if (!candidateSet.has(norm) || assigned.has(norm)) continue;
            assigned.add(norm);
            paths.push(norm);
          }
          if (paths.length === 0) continue;
          commitUnits.push({
            subject,
            body:
              typeof u.body === "string" && u.body.trim() !== ""
                ? capTextAtBoundary(u.body.trim(), 1000)
                : "",
            paths,
          });
          if (commitUnits.length >= 8) break;
        }
      }
    } catch {
      commitUnits.length = 0;
    }
    if (candidates.length === 0) {
      if (Array.isArray(input?.allowedPaths) && input.allowedPaths.length > 0) {
        return { ok: false, error: "nothing committable after exclusions: node_modules/logs/.agents/dist quedan fuera del PR" };
      }
      if (typeof input?.knownStatus === "string") {
        return { ok: false, error: "nothing committable after exclusions: node_modules/logs/.agents/dist quedan fuera del PR" };
      }
      // Compat: caller sin status (uso directo legacy) — add -A con
      // exclusiones, nunca ciego.
      try {
        await run(
          "git",
          [
            "add",
            "-A",
            "--",
            ".",
            ":!node_modules",
            ":!.git",
            ":!.agents",
            ":!dist",
            ":!dist-electron",
            ":!dist-cli",
            ":!dist-headless",
            ":!logs",
            ":!.hydra",
            ":!.worktrees",
            ":!review",
            ":!artifacts/scope.md",
            ":!scope.md",
            ":!plan.md",
            ":!triage.md",
            ":!discoveries.json",
            ":!discoveries.md",
            ":!*.log",
          ],
          {
            cwd: repoPath,
            timeoutMs: GIT_COMMIT_TIMEOUT_MS,
          },
        );
      } catch (e) {
        return { ok: false, error: sliceError(`git add failed: ${e instanceof Error ? e.message : String(e)}`) };
      }
    }
    const defaultBodyText =
      typeof input?.messageBody === "string" && input.messageBody.trim() !== ""
        ? capTextAtBoundary(input.messageBody.trim(), 1500)
        : "";
    const defaultSubjectText =
      typeof input?.messageSubject === "string" && input.messageSubject.trim() !== ""
        ? input.messageSubject.trim().slice(0, 160)
        : `factory: implement issue #${n} (handoff)`;
    const stage = async (paths: string[]): Promise<void> => {
      await run("git", ["add", "--", ...paths], {
        cwd: repoPath,
        timeoutMs: GIT_COMMIT_TIMEOUT_MS,
      });
    };
    const commitWith = async (subjectText: string, bodyText: string): Promise<void> => {
      const commitArgs = [
        "-c",
        `user.name=${FACTORY_GIT_USER_NAME}`,
        "-c",
        `user.email=${FACTORY_GIT_USER_EMAIL}`,
        "commit",
        "-m",
        subjectText,
        ...(bodyText !== "" ? ["-m", bodyText] : []),
      ];
      await run("git", commitArgs, {
        cwd: repoPath,
        timeoutMs: GIT_COMMIT_TIMEOUT_MS,
      });
    };
    if (commitUnits.length > 0 && candidates.length > 0) {
      for (const unit of commitUnits) {
        try {
          await stage(unit.paths);
        } catch (e) {
          return { ok: false, error: sliceError(`git add failed: ${e instanceof Error ? e.message : String(e)}`) };
        }
        try {
          await commitWith(unit.subject, unit.body !== "" ? unit.body : defaultBodyText);
        } catch (e) {
          return { ok: false, error: sliceError(`git commit failed: ${e instanceof Error ? e.message : String(e)}`) };
        }
      }
      const assigned = new Set(commitUnits.flatMap((u) => u.paths));
      const remaining = candidates.filter((c) => !assigned.has(c));
      if (remaining.length > 0) {
        try {
          await stage(remaining);
        } catch (e) {
          return { ok: false, error: sliceError(`git add failed: ${e instanceof Error ? e.message : String(e)}`) };
        }
        try {
          await commitWith("chore: remaining changes", defaultBodyText);
        } catch (e) {
          return { ok: false, error: sliceError(`git commit failed: ${e instanceof Error ? e.message : String(e)}`) };
        }
      }
      return { ok: true };
    }
    try {
      if (candidates.length > 0) await stage(candidates);
      await commitWith(defaultSubjectText, defaultBodyText);
    } catch (e) {
      return { ok: false, error: sliceError(`git commit failed: ${e instanceof Error ? e.message : String(e)}`) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}

/**
 * Gate de accept (ruta POST .../review/accept, async): la misma matriz de
 * propuesta, en modo read-only. Si la rama existe aislada Y el worktree
 * está limpio Y hay 0 commits vs base → el accept se RECHAZA (409) con
 * evento honesto y el job QUEDA en Review: completar sería varar un
 * Complete sin diff ni PR posible. Todo lo demás (sin aislamiento,
 * probes desconocidos, trabajo pendiente) → `{ok:true}` fail-open; el
 * hook post-Complete commitea/pushea/PR honestamente. Nunca lanza.
 */
export async function gateAcceptOnBranchDiff(
  jobId: unknown,
  run?: GhExecRun,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (typeof jobId !== "string" || jobId.length === 0) return { ok: true };
    const job = workItemStore.get(jobId);
    if (!job) return { ok: true };
    // Solo jobs en Review aceptan: fuera de Review el 409 canónico lo
    // produce acceptReviewEqual (este gate no lo pisa).
    if ((job as WorkItem).status !== "Review") return { ok: true };
    const iso = (job as WorkItem).isolation;
    const branch =
      iso && typeof iso.branch === "string" && iso.branch.length > 0
        ? iso.branch
        : null;
    const baseBranch =
      iso && typeof iso.baseBranch === "string" && iso.baseBranch.length > 0
        ? iso.baseBranch
        : null;
    const repoPath =
      iso && typeof iso.worktreePath === "string" && iso.worktreePath.length > 0
        ? iso.worktreePath
        : null;
    // Sin jaula completa no hay nada que medir: fail-open (el hook
    // post-Complete salta honesto con not-isolated).
    if (!branch || !baseBranch || !repoPath) return { ok: true };
    const exec: GhExecRun = run ?? defaultRun;
    const ahead = await countBranchCommitsVsBase({
      repoPath,
      branch,
      baseBranch,
      run: exec,
    }).catch(() => null);
    const status = await readWorktreeStatusPorcelain({
      repoPath,
      run: exec,
    }).catch(() => null);
    if (status === "" && ahead === 0) {
      const msg =
        `accept bloqueado: branch ${branch} sin commits vs ${baseBranch} y worktree limpio — ` +
        `implement no produjo cambios, no hay nada para proponer ni PR posible. El job queda en Review.`;
      try {
        workItemStore.appendEvent(jobId, "system", msg, {
          pr: { skipped: "empty-branch-accept-blocked", branch },
        } as unknown as Record<string, unknown>);
      } catch {
        // best-effort; el bloqueo sigue en pie
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Post-create verification of a fresh PR (best-effort, never throws). */
export interface CreatedPrVerification {
  state: string;
  base: string;
  head: string;
  draft: boolean;
  url: string;
}

export async function verifyCreatedPr(input: {
  repoPath: string;
  prNumber: number;
  run: GhExecRun;
}): Promise<CreatedPrVerification | null> {
  try {
    const repoPath = typeof input?.repoPath === "string" ? input.repoPath : "";
    const n = input?.prNumber;
    if (
      repoPath.trim().length === 0 ||
      typeof n !== "number" ||
      !Number.isInteger(n) ||
      n <= 0
    ) {
      return null;
    }
    const out = await input.run(
      "gh",
      [
        "pr",
        "view",
        String(n),
        "--json",
        "number,url,state,baseRefName,headRefName,isDraft",
      ],
      { cwd: repoPath, timeoutMs: GH_PR_VIEW_TIMEOUT_MS },
    );
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(out?.stdout ?? "").trim()) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
    if (typeof parsed.number !== "number" || parsed.number !== n) return null;
    if (typeof parsed.url !== "string" || parsed.url.length === 0) return null;
    const raw = typeof parsed.state === "string" ? parsed.state.toUpperCase() : "";
    const state =
      raw === "OPEN"
        ? "open"
        : raw === "MERGED"
          ? "merged"
          : raw === "CLOSED"
            ? "closed"
            : "unknown";
    return {
      state,
      base: typeof parsed.baseRefName === "string" ? parsed.baseRefName : "",
      head: typeof parsed.headRefName === "string" ? parsed.headRefName : "",
      draft: parsed.isDraft === true,
      url: parsed.url as string,
    };
  } catch {
    return null;
  }
}

function parseCreateOutput(stdout: string): {
  prNumber: number;
  prUrl: string;
} | null {
  try {
    const text = String(stdout ?? "").trim();
    if (text.length === 0) return null;
    const urlHit = text.match(/https?:\/\/\S+/);
    if (!urlHit) return null;
    const prUrl = urlHit[0].replace(/[),.;]+$/, "");
    const numHit = prUrl.match(/\/(\d+)\/?$/);
    if (!numHit) return null;
    const prNumber = Number.parseInt(numHit[1] as string, 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
    return { prNumber, prUrl };
  } catch {
    return null;
  }
}

/**
 * Push the branch and open the handoff PR (body carries `Closes #N`).
 * OWNERSHIP (no negociable): el orquestador commitea el trabajo del
 * worktree (`git add -A` + `git commit` con identidad local `-c`, sin
 * depender del gitconfig global) ANTES del push. Ningún prompt LLM pide
 * jamás commitear/pushear/PR — si el modelo lo intentara, este paso lo
 * vuelve irrelevante: el commit canónico lo hace el sistema. Single
 * attempt per call; callers enforce once-per-job. Never throws.
 */
export async function openPrForJob(
  input: OpenPrForJobInput,
): Promise<OpenPrForJobResult> {
  const run: GhExecRun = input?.run ?? defaultRun;
  const writeFile =
    input?.writeBodyFile ??
    ((file: string, body: string) => {
      fs.writeFileSync(file, body, "utf-8");
    });
  const unlinkFile =
    input?.unlinkBodyFile ??
    ((file: string) => {
      fs.unlinkSync(file);
    });
  try {
    const repoPath =
      typeof input?.repoPath === "string" ? input.repoPath : "";
    const branch = typeof input?.branch === "string" ? input.branch : "";
    const baseBranch =
      typeof input?.baseBranch === "string" ? input.baseBranch : "";
    const n = input?.issueNumber;
    if (
      repoPath.trim().length === 0 ||
      branch.trim().length === 0 ||
      baseBranch.trim().length === 0 ||
      typeof n !== "number" ||
      !Number.isInteger(n) ||
      n <= 0
    ) {
      return {
        ok: false,
        error: "repoPath/branch/baseBranch/issueNumber are required",
        manualHint: "",
      };
    }
    // Title mirrors the issue (prp-pr, skill): texto humano y estable. El
    // outcome/summary solo entra como fallback sin título y nunca si es
    // finding o prosa de compliance (caso PR #162).
    const detailsSummary =
      input?.details &&
      typeof (input.details as PrBodyDetails).summary === "string"
        ? (input.details as PrBodyDetails).summary
        : undefined;
    const title = buildPrTitle(n, input?.title, detailsSummary);
    const hint = manualPrHint(branch, baseBranch, n, title);
    // Matriz de propuesta (orquestador commitea, el LLM nunca):
    // - worktree SUCIO → commit SELECTIVO del SISTEMA (identidad local
    //   `-c`, sin depender del gitconfig): solo rutas commiteables del
    //   porcelain ya leído (node_modules/logs/.agents/dist/*.log quedan
    //   fuera — fix PRs +1M líneas). Luego push/PR. Este es el caso real:
    //   implement edita pero nadie commitea.
    // - limpio + ahead===0 → nothing to propose honesto (caso job-mtqqz1fz).
    // - resto (ahead>0, o probes desconocidos) → push/PR fail-open como
    //   antes: un probe roto nunca bloquea trabajo honesto.
    const ahead = await countBranchCommitsVsBase({
      repoPath,
      branch,
      baseBranch,
      run,
    }).catch(() => null);
    const status = await readWorktreeStatusPorcelain({ repoPath, run }).catch(
      () => null,
    );
    // Anti-duplicate (prp-pr): an open PR for this branch is reused, never
    // recreated. The lookup is best-effort: an unreadable answer fails open
    // to the push/PR attempt below (its error stays honest). WS-2: en la
    // ronda de reconciliación la reutilización NO corta el commit/push — el
    // trabajo nuevo debe quedar registrado en la rama del PR abierto.
    let existingPr: { prNumber: number; prUrl: string } | null = null;
    try {
      const existing = await readPrState({ repoPath, branch, run }).catch(
        () => null,
      );
      if (
        existing !== null &&
        existing.ok &&
        existing.state === "open" &&
        typeof existing.prNumber === "number" &&
        typeof existing.prUrl === "string" &&
        existing.prUrl.length > 0
      ) {
        if (input?.reconcile !== true) {
          return {
            ok: true,
            prNumber: existing.prNumber,
            prUrl: existing.prUrl,
            duplicate: true,
          };
        }
        existingPr = { prNumber: existing.prNumber, prUrl: existing.prUrl };
      } else if (
        input?.reconcile === true &&
        existing !== null &&
        existing.ok &&
        (existing.state === "merged" || existing.state === "closed")
      ) {
        // WS-2: reconciliación con PR cerrado/mergeado — jamás crear otro PR
        // ni pushear trabajo después del cierre; el humano decide (el reporte
        // del nuevo head queda honesto en REVIEW INCOMPLETE).
        return {
          ok: false,
          error: sliceError(
            `reconciliación abortada: el PR de la rama está ${existing.state} — no se pushea ni se crea otro PR`,
          ),
          manualHint: hint,
        };
      }
    } catch {
      // best-effort; fall through to the push/PR attempt
    }
    if (status !== "" && status !== null) {
      // Archivos del commit desde el porcelain ya leído (ground truth de
      // lo que se commitea; el body del PR usa el diff real pre-push abajo).
      const pendingFiles = parsePorcelainPaths(status).filter((f) =>
        isCommittablePath(f),
      );
      const commitDetails =
        input?.details && typeof input.details === "object" && !Array.isArray(input.details)
          ? { ...(input.details as Record<string, unknown>), files: pendingFiles }
          : { files: pendingFiles };
      // WS-F: unidades de commit declaradas por el implement (sección
      // `## Commit units`); sin sección válida cae al commit único legacy.
      const implementReportText =
        input?.details &&
        typeof (input.details as PrBodyDetails).implementReport === "string"
          ? ((input.details as PrBodyDetails).implementReport as string)
          : "";
      const committed = await commitWorktreeChanges({
        repoPath,
        issueNumber: n,
        run,
        knownStatus: status,
        allowedPaths: input?.allowedPaths,
        messageBody: summarizeDetailsForCommit(commitDetails),
        messageSubject: buildCommitSubject(n, input?.title),
        units: extractCommitUnits(implementReportText),
      }).catch(() => ({ ok: false as const, error: "commit spawn failed" }));
      if (!committed.ok) {
        return {
          ok: false,
          error: sliceError(`commit failed: ${committed.error} — implement changes could not be recorded on ${branch}`),
          manualHint: hint,
        };
      }
    } else if (ahead === 0) {
      return {
        ok: false,
        error:
          `nothing to propose: branch ${branch} has no commits vs ` +
          `${baseBranch} (empty diff) — implement produced no changes, so no PR was opened`,
        manualHint: hint,
      };
    }
    // Changed files ground-truth (el diff real del PR): no depende del
    // reporte del agente. Best-effort: si falla, el body usa lo declarado.
    // Además es el gate anti-fuga: si una review aid entró a algún commit
    // de la rama, no se pushea ni se abre PR (nunca shipean, ver PR #158).
    let diffFiles: string[] = [];
    try {
      const d = await run(
        "git",
        ["diff", "--name-only", `${baseBranch}...${branch}`],
        { cwd: repoPath, timeoutMs: GIT_DIFF_TIMEOUT_MS },
      );
      const diffPaths = d.stdout
        .split("\n")
        .map((s) => s.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
        .filter((s) => s.length > 0);
      const leaked = diffPaths.filter((s) => isReviewAidPath(s));
      if (leaked.length > 0) {
        return {
          ok: false,
          error: sliceError(
            `review-aid leaked into branch ${branch}: ${leaked.slice(0, 5).join(", ")} — push/PR abortados`,
          ),
          manualHint: hint,
        };
      }
      diffFiles = diffPaths.filter((s) => isCommittablePath(s)).slice(0, 50);
    } catch {
      diffFiles = [];
    }
    try {
      await run("git", ["push", "-u", "origin", branch], {
        cwd: repoPath,
        timeoutMs: GIT_PUSH_TIMEOUT_MS,
      });
    } catch (e) {
      return {
        ok: false,
        error: sliceError(
          `push failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
        manualHint: hint,
      };
    }
    if (existingPr) {
      // WS-2: PR abierto reutilizado en la ronda de reconciliación — el
      // commit y el push ya se hicieron; jamás se crea otro PR. El reporte
      // del nuevo head lo publica el caller aguas arriba (idempotente por head).
      return {
        ok: true,
        prNumber: existingPr.prNumber,
        prUrl: existingPr.prUrl,
        duplicate: true,
      };
    }
    const bodyDetails =
      input?.details && typeof input.details === "object" && !Array.isArray(input.details)
        ? {
            ...(input.details as Record<string, unknown>),
            ...(diffFiles.length > 0 ? { files: diffFiles } : {}),
          }
        : diffFiles.length > 0
          ? { files: diffFiles }
          : input?.details;
    const body = buildPrBody(n, input?.title, bodyDetails);
    const bodyFile = path.join(
      os.tmpdir(),
      `termcanvas-pr-${n}-${Date.now().toString(36)}.md`,
    );
    try {
      writeFile(bodyFile, body);
    } catch (e) {
      return {
        ok: false,
        error: sliceError(
          `pr body write failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
        manualHint: hint,
      };
    }
    let createdStdout = "";
    try {
      const created = await run(
        "gh",
        [
          "pr",
          "create",
          "--head",
          branch,
          "--base",
          baseBranch,
          "--title",
          title,
          "--body-file",
          bodyFile,
        ],
        { cwd: repoPath, timeoutMs: GH_PR_CREATE_TIMEOUT_MS },
      );
      createdStdout = created.stdout;
    } catch (e) {
      try {
        unlinkFile(bodyFile);
      } catch {
        // Best-effort temp cleanup.
      }
      return {
        ok: false,
        error: sliceError(
          `pr create failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
        manualHint: hint,
      };
    }
    try {
      unlinkFile(bodyFile);
    } catch {
      // Best-effort temp cleanup.
    }
    const parsed = parseCreateOutput(createdStdout);
    if (parsed === null) {
      return {
        ok: false,
        error: sliceError(`pr opened but number unreadable: ${createdStdout}`),
        manualHint: `gh pr view ${branch} --json number,url`,
      };
    }
    // Post-create verification (prp-pr): read the PR back and confirm it
    // exists with the intended head. Best-effort: never blocks the handoff.
    const verified = await verifyCreatedPr({
      repoPath,
      prNumber: parsed.prNumber,
      run,
    }).catch(() => null);
    // The PR exists now: tag it pendiente best-effort so the panel can
    // derive it without a live watcher (factory path has no terminal).
    await applyPendingLabelBestEffort(run, repoPath, parsed.prNumber);
    return {
      ok: true,
      prNumber: parsed.prNumber,
      prUrl: parsed.prUrl,
      ...(verified !== null
        ? {
            state: verified.state,
            ...(verified.base.length > 0 ? { base: verified.base } : {}),
            ...(verified.head.length > 0 ? { head: verified.head } : {}),
            draft: verified.draft,
          }
        : {}),
    };
  } catch (e) {
    return { ok: false, error: sliceError(e), manualHint: "" };
  }
}

/** Outcome del close-out ante merge (idempotente, nunca lanza). */
export type NotePrMergedResult =
  | { ok: true; id: string; prNumber: number; duplicate: boolean }
  | { ok: false; code: 400 | 404 | 409; error: string };

/**
 * Close-out ante merge (ruta POST .../merge-notify, Warp paso 7 — cierre):
 * el forge ya mergeó el PR de handoff; el daemon lo registra (evento
 * durable + `isolation.state="pr-merged"` en memoria). Guardas: job
 * conocido (404), `Complete` (409), `prNumber` coincide con el registrado
 * (409 mismatch — nunca se marca un PR ajeno). Idempotente: ya mergeado →
 * `{ok:true, duplicate:true}` sin duplicar eventos. Puro store, sin git
 * ni red. Nunca lanza.
 */
export function notePrMergedEqual(
  jobId: unknown,
  prNumber: unknown,
): NotePrMergedResult {
  try {
    if (typeof jobId !== "string" || jobId.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const job = workItemStore.get(jobId);
    if (!job) {
      return { ok: false, code: 404, error: `job not found: ${jobId}` };
    }
    if ((job as WorkItem).status !== "Complete") {
      return {
        ok: false,
        code: 409,
        error: `job not in Complete (status=${(job as WorkItem).status})`,
      };
    }
    if (
      typeof prNumber !== "number" ||
      !Number.isInteger(prNumber) ||
      prNumber <= 0
    ) {
      return { ok: false, code: 400, error: "prNumber must be a positive integer" };
    }
    const iso = (job as WorkItem).isolation as unknown as Record<string, unknown> | undefined;
    const recorded =
      iso && typeof iso.prNumber === "number" ? (iso.prNumber as number) : null;
    if (recorded === null || recorded !== prNumber) {
      return {
        ok: false,
        code: 409,
        error: `prNumber mismatch: job carries ${recorded === null ? "no PR" : `#${recorded}`} (got #${prNumber})`,
      };
    }
    const already =
      (iso as Record<string, unknown>).state === "pr-merged" ||
      prMergedRecorded(jobId, prNumber);
    if (already) return { ok: true, id: jobId, prNumber, duplicate: true };
    try {
      (job as WorkItem).isolation = {
        ...(iso as object),
        state: "pr-merged",
      } as WorkItem["isolation"];
    } catch {
      // best-effort; el evento durable de abajo es el registro
    }
    try {
      workItemStore.appendEvent(
        jobId,
        "system",
        `pr merged #${prNumber} — trabajo cerrado (merge detectado en el forge)`,
        { pr: { merged: true, prNumber } } as unknown as Record<string, unknown>,
      );
    } catch {
      // best-effort; el estado en memoria ya quedó
    }
    return { ok: true, id: jobId, prNumber, duplicate: false };
  } catch {
    return { ok: false, code: 409, error: "merge-notify failed" };
  }
}

/** ¿El timeline ya registra el merge de este PR? (durable path). */
function prMergedRecorded(jobId: string, prNumber: number): boolean {
  try {
    const job = workItemStore.get(jobId);
    const timeline = (job as unknown as Record<string, unknown> | undefined)?.timeline;
    if (!Array.isArray(timeline)) return false;
    return timeline.some((e) => {
      try {
        const meta = (e as Record<string, unknown>)?.meta as unknown;
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
        const pr = (meta as Record<string, unknown>).pr as unknown;
        if (!pr || typeof pr !== "object" || Array.isArray(pr)) return false;
        const rec = pr as Record<string, unknown>;
        return rec.merged === true && rec.prNumber === prNumber;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
/** Normalized PR visibility (gh reports OPEN/MERGED/CLOSED). */
export type GhPrState = "open" | "merged" | "closed" | "unknown";

export type ReadPrStateResult =
  | { ok: true; state: GhPrState; prNumber?: number; prUrl?: string }
  | { ok: false; error: string };

/**
 * Best-effort PR visibility (`gh pr view --json state`), used by the
 * explicit-cleanup guard. Never throws.
 */
export async function readPrState(input: {
  repoPath: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  run?: GhExecRun;
}): Promise<ReadPrStateResult> {
  const run: GhExecRun = input?.run ?? defaultRun;
  try {
    const repoPath =
      typeof input?.repoPath === "string" ? input.repoPath : "";
    if (repoPath.trim().length === 0) {
      return { ok: false, error: "repoPath is required" };
    }
    const sel =
      typeof input?.prNumber === "number" &&
      Number.isInteger(input.prNumber) &&
      (input.prNumber as number) > 0
        ? String(input.prNumber)
        : typeof input?.prUrl === "string" && input.prUrl.length > 0
          ? (input.prUrl as string)
          : typeof input?.branch === "string" && input.branch.length > 0
            ? (input.branch as string)
            : "";
    if (sel.length === 0) {
      return { ok: false, error: "branch/prNumber/prUrl is required" };
    }
    const out = await run(
      "gh",
      ["pr", "view", sel, "--json", "state,number,url"],
      { cwd: repoPath, timeoutMs: GH_PR_VIEW_TIMEOUT_MS },
    );
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(out.stdout.trim()) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "pr view output unreadable" };
    }
    const raw =
      typeof parsed.state === "string" ? parsed.state.toUpperCase() : "";
    const state: GhPrState =
      raw === "OPEN"
        ? "open"
        : raw === "MERGED"
          ? "merged"
          : raw === "CLOSED"
            ? "closed"
            : "unknown";
    const res: { ok: true; state: GhPrState; prNumber?: number; prUrl?: string } = {
      ok: true,
      state,
    };
    if (
      typeof parsed.number === "number" &&
      Number.isInteger(parsed.number) &&
      (parsed.number as number) > 0
    ) {
      res.prNumber = parsed.number as number;
    }
    if (typeof parsed.url === "string" && (parsed.url as string).length > 0) {
      res.prUrl = parsed.url as string;
    }
    return res;
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}

/** Head SHA del PR (`gh pr view --json headRefOid`). Espejo de readPrState. */
export type ReadPrHeadResult =
  | { ok: true; headOid: string; prNumber?: number; prUrl?: string }
  | { ok: false; error: string };

/**
 * Lee el head actual del PR (best-effort, nunca lanza). Sirve al
 * stale-check del review: compara contra el `reviewed_head` del último
 * reporte canónico.
 */
export async function readPrHead(input: {
  repoPath: string;
  prNumber?: number;
  prUrl?: string;
  branch?: string;
  run?: GhExecRun;
}): Promise<ReadPrHeadResult> {
  const run: GhExecRun = input?.run ?? defaultRun;
  try {
    const repoPath =
      typeof input?.repoPath === "string" ? input.repoPath : "";
    if (repoPath.trim().length === 0) {
      return { ok: false, error: "repoPath is required" };
    }
    const sel =
      typeof input?.prNumber === "number" &&
      Number.isInteger(input.prNumber) &&
      (input.prNumber as number) > 0
        ? String(input.prNumber)
        : typeof input?.prUrl === "string" && input.prUrl.length > 0
          ? (input.prUrl as string)
          : typeof input?.branch === "string" && input.branch.length > 0
            ? (input.branch as string)
            : "";
    if (sel.length === 0) {
      return { ok: false, error: "prNumber/prUrl/branch is required" };
    }
    const out = await run(
      "gh",
      ["pr", "view", sel, "--json", "headRefOid,number,url"],
      { cwd: repoPath, timeoutMs: GH_PR_VIEW_TIMEOUT_MS },
    );
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(out?.stdout ?? "").trim()) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "pr view output unreadable" };
    }
    const oid = typeof parsed.headRefOid === "string" ? (parsed.headRefOid as string).trim() : "";
    if (!/^[0-9a-f]{4,64}$/i.test(oid)) {
      return { ok: false, error: "pr head unreadable" };
    }
    const res: { ok: true; headOid: string; prNumber?: number; prUrl?: string } = {
      ok: true,
      headOid: oid,
    };
    if (
      typeof parsed.number === "number" &&
      Number.isInteger(parsed.number) &&
      (parsed.number as number) > 0
    ) {
      res.prNumber = parsed.number as number;
    }
    if (typeof parsed.url === "string" && (parsed.url as string).length > 0) {
      res.prUrl = parsed.url as string;
    }
    return res;
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}

/** Resultado del stale-check del review (on-demand, nunca automático). */
export type ReviewStaleOutcome =
  | { checked: true; stale: boolean; reviewedHead: string; currentHead?: string; prNumber: number }
  | { checked: false; reason: string };

/**
 * Fix L — compara el head actual del PR contra el `reviewed_head` del
 * último reporte canónico del timeline. Divergencia → evento durable
 * `review stale` (el panel lo muestra vía Activity) y el veredicto
 * publicado queda explícitamente vencido. Sin reporte, sin PR publicado
 * o con `gh` caído → `{checked:false}` honesto (fail-open, sin evento).
 * Re-review siempre a pedido humano, nunca automático: cero timers,
 * cero polling. Nunca lanza.
 */
export async function checkReviewStale(
  jobId: unknown,
  opts?: { repoPath?: unknown; prNumber?: unknown; run?: GhExecRun },
): Promise<ReviewStaleOutcome> {
  try {
    if (typeof jobId !== "string" || jobId.length === 0) {
      return { checked: false, reason: "unknown-job" };
    }
    const job = workItemStore.get(jobId);
    if (!job) return { checked: false, reason: "unknown-job" };
    const stored = readReviewReportFromTimeline(
      (job as unknown as { timeline?: unknown }).timeline,
    );
    if (!stored || typeof stored.report !== "string") {
      return { checked: false, reason: "no-report" };
    }
    const meta = parseReviewReportMeta(stored.report as string);
    if (!meta) return { checked: false, reason: "no-meta" };
    if (!/^https?:\/\/\S+$/.test(meta.publication)) {
      return { checked: false, reason: "not-published" };
    }
    if (meta.reviewed_head === "" || meta.reviewed_head === "unknown") {
      return { checked: false, reason: "no-reviewed-head" };
    }
    const iso = (job as WorkItem).isolation as unknown as Record<string, unknown> | undefined;
    const repoPath =
      typeof opts?.repoPath === "string" && (opts.repoPath as string).length > 0
        ? (opts.repoPath as string)
        : iso && typeof iso.worktreePath === "string"
          ? (iso.worktreePath as string)
          : "";
    const prNumber =
      typeof opts?.prNumber === "number" && Number.isInteger(opts.prNumber)
        ? (opts.prNumber as number)
        : iso && typeof iso.prNumber === "number"
          ? (iso.prNumber as number)
          : meta.pr > 0
            ? meta.pr
            : 0;
    if (repoPath.trim().length === 0 || prNumber <= 0) {
      return { checked: false, reason: "no-pr-target" };
    }
    const run: GhExecRun = opts?.run ?? defaultRun;
    const head = await readPrHead({ repoPath, prNumber, run }).catch(() => null);
    if (!head || !head.ok) {
      return { checked: false, reason: "head-unreadable" };
    }
    if (head.headOid.toLowerCase() === meta.reviewed_head.toLowerCase()) {
      return { checked: true, stale: false, reviewedHead: meta.reviewed_head, prNumber };
    }
    // Idempotencia: la misma divergencia ya quedó registrada → no duplicar.
    try {
      const timeline = (job as unknown as { timeline?: unknown }).timeline;
      if (Array.isArray(timeline)) {
        const dup = [...timeline].reverse().find((e) => {
          try {
            const m = (e as Record<string, unknown> | null)?.meta as unknown;
            if (!m || typeof m !== "object" || Array.isArray(m)) return false;
            const s = (m as Record<string, unknown>).reviewStale as unknown;
            if (!s || typeof s !== "object" || Array.isArray(s)) return false;
            const rec = s as Record<string, unknown>;
            return (
              rec.currentHead === head.headOid &&
              (rec as Record<string, unknown>).reviewedHead === meta.reviewed_head
            );
          } catch {
            return false;
          }
        });
        if (dup) {
          return {
            checked: true,
            stale: true,
            reviewedHead: meta.reviewed_head,
            currentHead: head.headOid,
            prNumber,
          };
        }
      }
    } catch {
      // best-effort; sigue al evento
    }
    const short = (sha: string): string => sha.slice(0, 12);
    try {
      workItemStore.appendEvent(
        jobId,
        "system",
        `review stale — new head since ${short(meta.reviewed_head)} (current ${short(head.headOid)}): el veredicto publicado vale para el head revisado, pedí re-review antes de mergear`,
        {
          reviewStale: {
            reviewedHead: meta.reviewed_head,
            currentHead: head.headOid,
            prNumber,
          },
        } as unknown as Record<string, unknown>,
      );
    } catch {
      // best-effort; el resultado igual informa stale
    }
    return {
      checked: true,
      stale: true,
      reviewedHead: meta.reviewed_head,
      currentHead: head.headOid,
      prNumber,
    };
  } catch {
    return { checked: false, reason: "stale-check-failed" };
  }
}

/**
 * P3b — publicación del review report canónico en el PR (siempre,
 * best-effort, nunca bloquea el handoff).
 *
 * Idempotencia por head: el comentario lleva `prp-review-id: pr-N` más
 * `reviewed_head: <sha>`; si ese marcador ya existe en los comentarios
 * del PR se reutiliza su URL sin comentar de nuevo. La URL solo se
 * reporta cuando el comentario se verifica releyendo el PR (nunca
 * inventada). Todo exportado nunca lanza.
 */

export interface PublishReviewInput {
  readonly repoPath: string;
  readonly prNumber: number;
  readonly branch?: unknown;
  readonly headSha?: unknown;
  readonly body: string;
  readonly run?: GhExecRun;
  readonly writeBodyFile?: (file: string, body: string) => void;
  readonly unlinkBodyFile?: (file: string) => void;
}

export type PublishReviewResult =
  | { ok: true; url: string; duplicate: boolean }
  | { ok: false; error: string };

interface PrCommentLike {
  body: string;
  url: string;
}

/** Lee los comentarios del PR (`gh pr view --comments`). Null si ilegible. */
async function readPrComments(input: {
  repoPath: string;
  prNumber: number;
  run: GhExecRun;
}): Promise<PrCommentLike[] | null> {
  try {
    const out = await input.run(
      "gh",
      ["pr", "view", String(input.prNumber), "--json", "comments"],
      { cwd: input.repoPath, timeoutMs: GH_PR_VIEW_TIMEOUT_MS },
    );
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(out?.stdout ?? "").trim()) as Record<string, unknown>;
    } catch {
      return null;
    }
    const list = parsed.comments;
    if (!Array.isArray(list)) return null;
    return list
      .map((c) => {
        try {
          if (!c || typeof c !== "object" || Array.isArray(c)) return null;
          const rec = c as Record<string, unknown>;
          if (typeof rec.body !== "string") return null;
          return {
            body: rec.body as string,
            url: typeof rec.url === "string" ? (rec.url as string) : "",
          };
        } catch {
          return null;
        }
      })
      .filter((c): c is PrCommentLike => c !== null)
      .slice(0, 100);
  } catch {
    return null;
  }
}

/** Head SHA de la rama (`git rev-parse`). "unknown" cuando no se resuelve. */
async function resolvePublishHead(input: {
  repoPath: string;
  branch: string;
  run: GhExecRun;
}): Promise<string> {
  try {
    if (input.branch.trim().length === 0) return "unknown";
    const out = await input.run("git", ["rev-parse", input.branch], {
      cwd: input.repoPath,
      timeoutMs: GIT_REV_PARSE_TIMEOUT_MS,
    });
    const sha = String(out?.stdout ?? "").trim();
    return /^[0-9a-f]{4,64}$/i.test(sha) ? sha : "unknown";
  } catch {
    return "unknown";
  }
}

function reviewMarker(prNumber: number, head: string): { idMark: string; headMark: string } {
  return {
    idMark: `prp-review-id: pr-${prNumber}`,
    headMark: `reviewed_head: ${head}`,
  };
}

/**
 * Publica el reporte en el PR y verifica la URL releyendo los comentarios.
 * Nunca lanza.
 */
export async function publishReviewReport(
  input: PublishReviewInput,
): Promise<PublishReviewResult> {
  const run: GhExecRun = input?.run ?? defaultRun;
  const writeFile =
    input?.writeBodyFile ??
    ((file: string, body: string) => {
      fs.writeFileSync(file, body, "utf-8");
    });
  const unlinkFile =
    input?.unlinkBodyFile ??
    ((file: string) => {
      fs.unlinkSync(file);
    });
  try {
    const repoPath = typeof input?.repoPath === "string" ? input.repoPath : "";
    const n = input?.prNumber;
    const body = typeof input?.body === "string" ? input.body : "";
    if (
      repoPath.trim().length === 0 ||
      typeof n !== "number" ||
      !Number.isInteger(n) ||
      n <= 0 ||
      body.trim().length === 0
    ) {
      return { ok: false, error: "repoPath/prNumber/body are required" };
    }
    const branch = typeof input?.branch === "string" ? input.branch : "";
    const head =
      typeof input?.headSha === "string" && (input.headSha as string).trim().length > 0
        ? (input.headSha as string).trim().slice(0, 120)
        : await resolvePublishHead({ repoPath, branch, run }).catch(() => "unknown");
    const { idMark, headMark } = reviewMarker(n, head);
    const finalBody = refreshReviewReportMeta(body, { pr: n, reviewedHead: head });
    // Idempotencia: el marcador de este head ya publicado se reutiliza.
    try {
      const existing = await readPrComments({ repoPath, prNumber: n, run }).catch(
        () => null,
      );
      const hit = (existing ?? []).find(
        (c) => c.body.includes(idMark) && c.body.includes(headMark),
      );
      if (hit && hit.url.length > 0) {
        return { ok: true, url: hit.url, duplicate: true };
      }
    } catch {
      // best-effort; sigue al comment
    }
    const bodyFile = path.join(
      os.tmpdir(),
      `termcanvas-review-${n}-${Date.now().toString(36)}.md`,
    );
    try {
      writeFile(bodyFile, finalBody);
    } catch (e) {
      return {
        ok: false,
        error: sliceError(
          `review body write failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      };
    }
    let commentStdout = "";
    try {
      const created = await run("gh", ["pr", "comment", String(n), "--body-file", bodyFile], {
        cwd: repoPath,
        timeoutMs: GH_PR_COMMENT_TIMEOUT_MS,
      });
      commentStdout = String(created?.stdout ?? "");
    } catch (e) {
      try {
        unlinkFile(bodyFile);
      } catch {
        // Best-effort temp cleanup.
      }
      return {
        ok: false,
        error: sliceError(
          `pr comment failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      };
    }
    try {
      unlinkFile(bodyFile);
    } catch {
      // Best-effort temp cleanup.
    }
    // Verificación: el marcador debe existir en los comentarios del PR.
    // La URL sale del stdout del comment o del comentario verificado.
    const urlHit = commentStdout.match(/https?:\/\/\S+/);
    const stdoutUrl = urlHit ? urlHit[0].replace(/[),.;]+$/, "") : "";
    try {
      const after = await readPrComments({ repoPath, prNumber: n, run }).catch(
        () => null,
      );
      const confirmed = (after ?? []).find(
        (c) => c.body.includes(idMark) && c.body.includes(headMark),
      );
      if (!confirmed) {
        return { ok: false, error: "review comment not confirmed on the PR (publication pending)" };
      }
      const url = stdoutUrl.length > 0 ? stdoutUrl : confirmed.url;
      if (url.length === 0) {
        return { ok: false, error: "review comment confirmed but url unreadable (publication pending)" };
      }
      return { ok: true, url, duplicate: false };
    } catch {
      return { ok: false, error: "review comment verification failed (publication pending)" };
    }
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}

/** Outcome del publish post-Complete (best-effort, idempotente por head). */
export type PublishReviewOutcome =
  | { published: true; url: string; duplicate: boolean }
  | { published: false; skipped?: string; error?: string };

/**
 * Lee el último `reviewReport` del timeline (lo escribe el espejo del
 * engine en P3a). Null cuando no hay reporte canónico. Puro, nunca lanza.
 */
export function readReviewReportFromTimeline(
  timeline: unknown,
): { verdict?: unknown; openFindings?: unknown; publication?: unknown; publishedHead?: unknown; report?: unknown } | null {
  try {
    if (!Array.isArray(timeline)) return null;
    const entries = [...timeline].reverse();
    const found = entries
      .map((e) => {
        try {
          const meta = (e as Record<string, unknown> | null)?.meta as unknown;
          if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
          const holder = (meta as Record<string, unknown>).reviewReport;
          if (!holder || typeof holder !== "object" || Array.isArray(holder)) return null;
          const rec = holder as Record<string, unknown>;
          return typeof rec.report === "string" && rec.report !== "" ? rec : null;
        } catch {
          return null;
        }
      })
      .filter((x): x is Record<string, unknown> => x !== null)
      .at(0);
    if (!found) return null;
    return found as {
      verdict?: unknown;
      openFindings?: unknown;
      publication?: unknown;
      publishedHead?: unknown;
      report?: unknown;
    } | null;
  } catch {
    return null;
  }
}

/**
 * Post-`Complete`: publica el reporte canónico en el PR, siempre que haya
 * reporte y PR. Idempotente por head SHA (mismo head ya publicado → skip).
 * Best-effort: un publish fallido deja `publication: pending` y nunca
 * voltea el handoff del PR. Nunca lanza.
 */
export async function maybePublishReviewReportForJob(
  jobId: unknown,
  opts?: { repoPath?: unknown; prNumber?: unknown; branch?: unknown; run?: GhExecRun },
): Promise<PublishReviewOutcome> {
  try {
    if (typeof jobId !== "string" || jobId.length === 0) {
      return { published: false, skipped: "bad-id" };
    }
    const job = workItemStore.get(jobId);
    if (!job) return { published: false, skipped: "unknown-job" };
    const stored = readReviewReportFromTimeline(
      (job as unknown as { timeline?: unknown }).timeline,
    );
    if (!stored || typeof stored.report !== "string") {
      return { published: false, skipped: "no-report" };
    }
    const iso = (job as WorkItem).isolation as unknown as Record<string, unknown> | undefined;
    const repoPath =
      typeof opts?.repoPath === "string" && (opts.repoPath as string).length > 0
        ? (opts.repoPath as string)
        : iso && typeof iso.worktreePath === "string"
          ? (iso.worktreePath as string)
          : "";
    const branch =
      typeof opts?.branch === "string" && (opts.branch as string).length > 0
        ? (opts.branch as string)
        : iso && typeof iso.branch === "string"
          ? (iso.branch as string)
          : "";
    const prNumber =
      typeof opts?.prNumber === "number" && Number.isInteger(opts.prNumber)
        ? (opts.prNumber as number)
        : iso && typeof iso.prNumber === "number"
          ? (iso.prNumber as number)
          : 0;
    if (repoPath.trim().length === 0 || prNumber <= 0) {
      return { published: false, skipped: "no-pr-target" };
    }
    const run: GhExecRun = opts?.run ?? defaultRun;
    const head = await resolvePublishHead({ repoPath, branch, run }).catch(
      () => "unknown",
    );
    const prevPub = typeof stored.publication === "string" ? stored.publication : "";
    const prevHead = typeof stored.publishedHead === "string" ? stored.publishedHead : "";
    if (/^https?:\/\/\S+$/.test(prevPub) && prevHead !== "" && prevHead === head) {
      return { published: false, skipped: "already-published" };
    }
    // WS1b: el cuerpo se refresca ANTES de publicar (pr/head reales y prosa
    // alineada); lo publicado y lo persistido parten del mismo texto.
    const bodyToPublish = refreshReviewReportMeta(stored.report as string, {
      pr: prNumber,
      reviewedHead: head,
    });
    // Red de seguridad: reporta violaciones de integridad sin bloquear jamás
    // el publish (best-effort).
    try {
      const violations = assertReportIntegrity(bodyToPublish);
      if (violations.length > 0) {
        workItemStore.appendEvent(
          jobId,
          "system",
          `review report integrity: ${violations.join("; ")}`.slice(0, 500),
        );
      }
    } catch {
      // best-effort: la integridad nunca bloquea el publish
    }
    const res = await publishReviewReport({
      repoPath,
      prNumber,
      branch,
      headSha: head,
      body: bodyToPublish,
      run,
    });
    if (!res.ok) {
      try {
        workItemStore.appendEvent(
          jobId,
          "system",
          `review report publish failed: ${res.error}`.slice(0, 500),
          { reviewReport: { ...stored, publication: "pending" } } as unknown as Record<
            string,
            unknown
          >,
        );
      } catch {
        // best-effort
      }
      return { published: false, error: res.error };
    }
    const refreshed = refreshReviewReportMeta(bodyToPublish, { publication: res.url });
    try {
      const dir = (job as unknown as { dir?: unknown }).dir;
      if (typeof dir === "string" && dir.length > 0) {
        fs.writeFileSync(path.join(dir, "review-report.md"), refreshed, "utf-8");
      }
    } catch {
      // archivo best-effort: el evento durable es el registro
    }
    try {
      workItemStore.appendEvent(
        jobId,
        "system",
        res.duplicate
          ? `review report already published ${res.url} (reused)`
          : `review report published ${res.url}`,
        {
          reviewReport: {
            ...(stored as Record<string, unknown>),
            publication: res.url,
            publishedHead: head,
            report: refreshed.slice(0, 20000),
          },
        } as unknown as Record<string, unknown>,
      );
    } catch {
      // best-effort
    }
    return { published: true, url: res.url, duplicate: res.duplicate };
  } catch (e) {
    try {
      return {
        published: false,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      };
    } catch {
      return { published: false, error: "publish hook failed" };
    }
  }
}

/**
 * External-reviewer wait policy for the first publication: the report is
 * commented only after the bot review lands (or the wait deadline
 * expires), so bot findings travel reconciled instead of racing the bot.
 *
 * `TERMCANVAS_REVIEW_WAIT_MS` overrides the default wait (0 = publish
 * immediately, legacy behavior). `TERMCANVAS_REVIEW_BOTS` overrides the
 * reviewer logins (empty string disables the wait). Never throws.
 */
export const BOT_REVIEW_WAIT_MS_DEFAULT = 1_200_000;
export const BOT_REVIEW_WAIT_MS_MAX = 3_600_000;

export function resolveBotReviewPolicy(
  env: Record<string, string | undefined> = process.env,
): { waitMs: number; bots: string[] } {
  try {
    const rawBots =
      typeof env?.TERMCANVAS_REVIEW_BOTS === "string" ? env.TERMCANVAS_REVIEW_BOTS : undefined;
    const bots =
      rawBots === undefined
        ? ["pullfrog", "coderabbit"]
        : rawBots
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0)
            .slice(0, 10);
    if (bots.length === 0) return { waitMs: 0, bots: [] };
    const rawWait =
      typeof env?.TERMCANVAS_REVIEW_WAIT_MS === "string" ? env.TERMCANVAS_REVIEW_WAIT_MS.trim() : "";
    if (rawWait === "") return { waitMs: BOT_REVIEW_WAIT_MS_DEFAULT, bots };
    const parsed = Number.parseInt(rawWait, 10);
    if (!Number.isInteger(parsed) || parsed < 0) return { waitMs: BOT_REVIEW_WAIT_MS_DEFAULT, bots };
    return { waitMs: Math.min(parsed, BOT_REVIEW_WAIT_MS_MAX), bots };
  } catch {
    return { waitMs: BOT_REVIEW_WAIT_MS_DEFAULT, bots: ["pullfrog", "coderabbit"] };
  }
}

/** Last review findings recorded on the job (bot overlap matching). Never throws. */
/**
 * Disposiciones `fN` de la ronda de reconciliación para los bot findings:
 * parsea el `## Dispositions` del último implement report del timeline y le
 * adjunta el mensaje del feedback almacenado (match robusto por mensaje;
 * fallback por índice 1-based del feedback `f1..fn`). Vacío sin ronda o sin
 * disposiciones. Nunca lanza.
 */
function collectBotDispositions(
  timeline: unknown,
): Array<{ index: number; message: string; disposition: string; reason: string }> {
  try {
    if (!Array.isArray(timeline)) return [];
    // Provenance obligatoria: las disposiciones aplican SOLO si fueron
    // escritas por la ronda de reconciliación (evento `botReconcileRun`) y
    // el implement report es POSTERIOR a ese arranque. Sin esto, el
    // `## Dispositions` del review interno matcheaba por índice contra la
    // lista fresca de findings del bot en la primera publicación (H1).
    let runIdx = -1;
    for (let i = 0; i < timeline.length; i += 1) {
      const e = timeline[i];
      const m = e && typeof e === "object" ? (e as { meta?: unknown }).meta : null;
      if (m && typeof m === "object" && "botReconcileRun" in (m as Record<string, unknown>)) {
        runIdx = i;
      }
    }
    if (runIdx < 0) return [];
    let report = "";
    for (let i = timeline.length - 1; i > runIdx; i -= 1) {
      const e = timeline[i];
      const m = e && typeof e === "object" ? (e as { meta?: unknown }).meta : null;
      if (!m || typeof m !== "object") continue;
      const r = (m as Record<string, unknown>).implementReport;
      if (typeof r === "string" && r.trim() !== "") {
        report = r;
        break;
      }
    }
    if (report === "") return [];
    const feedback = readBotReconcileFeedback(timeline);
    const feedbackFindings =
      feedback && Array.isArray(feedback.findings) ? feedback.findings : [];
    if (feedbackFindings.length === 0) return [];
    return extractDispositions(report)
      .map((d) => {
        const m = d.id.match(/^f(\d+)$/i);
        if (!m) return null;
        const index = Number.parseInt(m[1] as string, 10);
        if (!Number.isInteger(index) || index <= 0) return null;
        const source = feedbackFindings[index - 1];
        const message =
          source && typeof (source as { message?: unknown }).message === "string"
            ? String((source as { message: string }).message)
            : "";
        return { index, message, disposition: d.disposition, reason: d.reason };
      })
      .filter(
        (d): d is { index: number; message: string; disposition: string; reason: string } =>
          d !== null,
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}

/**
 * P6b: recupera publicaciones pendientes al boot. Re-agenda el publish de los
 * reports guardados con `publication` sin URL y PR abierto (idempotente por
 * head; el wait del bot se repite acotado). Solo el dueño del pipeline la
 * llama. Cap por boot. Nunca lanza.
 */
export async function resumePendingReviewPublications(opts?: {
  limit?: number;
  run?: GhExecRun;
  env?: Record<string, string | undefined>;
  waitMs?: number;
  waitForBot?: typeof waitForBotReview;
  bots?: readonly string[];
}): Promise<{ rescheduled: number; skipped: number }> {
  const out = { rescheduled: 0, skipped: 0 };
  try {
    const limit =
      typeof opts?.limit === "number" && Number.isInteger(opts.limit) && opts.limit > 0
        ? Math.min(opts.limit, 20)
        : 5;
    for (const job of workItemStore.list()) {
      if (out.rescheduled >= limit) break;
      try {
        if (job.status !== "Complete") {
          out.skipped += 1;
          continue;
        }
        const timeline = (job as unknown as { timeline?: unknown }).timeline;
        const iso = (job as unknown as { isolation?: Record<string, unknown> | null }).isolation;
        if (!iso || iso.state !== "pr-open") {
          out.skipped += 1;
          continue;
        }
        const prNumber =
          typeof iso.prNumber === "number" && Number.isInteger(iso.prNumber) && iso.prNumber > 0
            ? (iso.prNumber as number)
            : 0;
        const repoPath = typeof iso.worktreePath === "string" ? iso.worktreePath : "";
        const branch = typeof iso.branch === "string" ? iso.branch : "";
        if (prNumber <= 0 || repoPath === "" || branch === "") {
          out.skipped += 1;
          continue;
        }
        const stored = readReviewReportFromTimeline(timeline);
        if (!stored || typeof stored.report !== "string" || stored.report === "") {
          out.skipped += 1;
          continue;
        }
        const pub = typeof stored.publication === "string" ? stored.publication : "";
        if (/^https?:\/\//.test(pub)) {
          out.skipped += 1;
          continue;
        }
        // Cap entre boots: tras 2 intentos de recovery, decide el humano.
        let resumedBefore = 0;
        if (Array.isArray(timeline)) {
          for (const e of timeline) {
            const m = e && typeof e === "object" ? (e as { meta?: unknown }).meta : null;
            if (
              m &&
              typeof m === "object" &&
              "publicationResumed" in (m as Record<string, unknown>)
            ) {
              resumedBefore += 1;
            }
          }
        }
        if (resumedBefore >= 2) {
          out.skipped += 1;
          continue;
        }
        // Drift: un reporte con head revisado REAL distinto del head actual no
        // se re-publica como si hubiera revisado el head nuevo (`unknown` es el
        // estado pre-PR normal: el refresh del publish lo fija al head actual).
        const meta = parseReviewReportMeta(stored.report);
        const reviewedHead =
          meta && typeof meta.reviewed_head === "string" ? meta.reviewed_head : "";
        const currentHead = await resolvePublishHead({
          repoPath,
          branch,
          run: opts?.run ?? defaultRun,
        }).catch(() => "unknown");
        if (reviewedHead !== "" && reviewedHead !== "unknown" && reviewedHead !== currentHead) {
          out.skipped += 1;
          continue;
        }
        const result = await scheduleReviewReportPublish(job.id, {
          repoPath,
          prNumber,
          branch,
          // Mismo hook que los caminos normales: si el bot dejó findings
          // abiertos, la ronda de reconciliación debe poder arrancar (si no,
          // el evento `botReconcile` quemaría el cap sin ronda).
          onBotReconcile: (id: string, fb: unknown) => {
            void import("../engineBridge")
              .then((m) => m.reconcileFromAnyCaller(id, fb))
              .catch(() => {});
          },
          ...(opts?.run ? { run: opts.run } : {}),
          ...(opts?.env ? { env: opts.env } : {}),
          ...(typeof opts?.waitMs === "number" ? { waitMs: opts.waitMs } : {}),
          ...(opts?.waitForBot ? { waitForBot: opts.waitForBot } : {}),
          ...(opts?.bots ? { bots: opts.bots } : {}),
        });
        if (result.mode === "skipped") {
          out.skipped += 1;
          continue;
        }
        out.rescheduled += 1;
        try {
          workItemStore.appendEvent(
            job.id,
            "system",
            `review report publish re-scheduled (boot recovery, ${result.mode})`,
            { publicationResumed: true } as unknown as Record<string, unknown>,
          );
        } catch {
          // best-effort: el estado ya quedó re-agendado
        }
      } catch {
        out.skipped += 1;
      }
    }
  } catch {
    // best-effort: el boot nunca se rompe por la recuperación
  }
  return out;
}

/**
 * P3: recupera rondas de reconciliación post-bot perdidas (el gate estaba
 * apagado al publicar, o el hook no llegó a arrancar). Prepara el evento
 * `botReconcile` (si falta) desde los findings estructurados persistidos y
 * avisa al caller vía `onBotReconcile`; el cap real sigue siendo
 * `botReconcileRun` (un start fallido se puede reintentar en el próximo
 * boot). Solo corre con el gate activo y reports publicados; los reports
 * pre-P3 sin `botFindings` estructurados se saltean honestamente. Cap por
 * boot. Solo el dueño del pipeline la llama. Nunca lanza.
 */
export async function resumeMissedBotReconcileRounds(opts?: {
  limit?: number;
  env?: Record<string, string | undefined>;
  onBotReconcile?: (jobId: string, feedback: BotReconcileFeedback) => void | Promise<void>;
}): Promise<{ prepared: number; skipped: number }> {
  const out = { prepared: 0, skipped: 0 };
  try {
    if (!resolveBotReconcilePolicy(opts?.env ?? process.env).enabled) return out;
    const limit =
      typeof opts?.limit === "number" && Number.isInteger(opts.limit) && opts.limit > 0
        ? Math.min(opts.limit, 10)
        : 3;
    for (const job of workItemStore.list()) {
      if (out.prepared >= limit) break;
      try {
        if (job.status !== "Complete") {
          out.skipped += 1;
          continue;
        }
        const iso = (job as unknown as { isolation?: Record<string, unknown> | null }).isolation;
        if (
          !iso ||
          iso.state !== "pr-open" ||
          typeof iso.branch !== "string" ||
          iso.branch === ""
        ) {
          out.skipped += 1;
          continue;
        }
        const timeline = (job as unknown as { timeline?: unknown }).timeline;
        // Cap ya consumido: no hay ronda que recuperar.
        if (hasBotReconcileRunEvent(timeline)) {
          out.skipped += 1;
          continue;
        }
        // Solo reports ya publicados; los pendientes los cubre P6 (que al
        // publicar prepara su propia ronda con el gate vigente).
        const stored = readReviewReportFromTimeline(timeline);
        const publication = typeof stored?.publication === "string" ? stored.publication : "";
        if (!/^https?:\/\//.test(publication)) {
          out.skipped += 1;
          continue;
        }
        let feedback = readBotReconcileFeedback(timeline);
        if (!feedback) {
          const structured = readBotFindingsFromTimeline(timeline);
          feedback = structured.length > 0 ? buildBotReconcileFeedback(structured) : null;
        }
        if (!feedback) {
          out.skipped += 1;
          continue;
        }
        const openCount = feedback.findings.length;
        if (!hasBotReconcileEvent(timeline)) {
          workItemStore.appendEvent(
            job.id,
            "system",
            `bot reconcile: ${openCount} open finding(s) prepared for a new revise round (cap 1, boot recovery)`,
            { botReconcile: { feedback, openCount, recovered: true } } as unknown as Record<
              string,
              unknown
            >,
          );
        }
        try {
          await opts?.onBotReconcile?.(job.id, feedback);
        } catch {
          // el hook del caller nunca rompe el boot
        }
        out.prepared += 1;
      } catch {
        out.skipped += 1;
      }
    }
  } catch {
    // best-effort: el boot nunca se rompe por la recuperación
  }
  return out;
}

function readInternalFindingsForBot(
  job: WorkItem | null | undefined,
): Array<{ id: unknown; file: unknown; state: unknown }> {
  try {
    const last = (job as unknown as { lastReview?: unknown } | undefined)?.lastReview;
    if (!last || typeof last !== "object" || Array.isArray(last)) return [];
    const findings = (last as Record<string, unknown>).findings;
    if (!Array.isArray(findings)) return [];
    return findings
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && !Array.isArray(f))
      .slice(0, 50)
      .map((f) => ({ id: f.id, file: f.file, state: f.state }));
  } catch {
    return [];
  }
}

/** Resolves the publish target from opts or the job isolation record. Never throws. */
function resolveReviewPublishTarget(
  job: WorkItem | null | undefined,
  opts?: { repoPath?: unknown; prNumber?: unknown; branch?: unknown },
): { repoPath: string; prNumber: number; branch: string } {
  try {
    const iso = (job as unknown as { isolation?: Record<string, unknown> } | undefined)?.isolation;
    const repoPath =
      typeof opts?.repoPath === "string" && opts.repoPath.length > 0
        ? opts.repoPath
        : iso && typeof iso.worktreePath === "string"
          ? (iso.worktreePath as string)
          : "";
    const branch =
      typeof opts?.branch === "string" && opts.branch.length > 0
        ? opts.branch
        : iso && typeof iso.branch === "string"
          ? (iso.branch as string)
          : "";
    const prNumber =
      typeof opts?.prNumber === "number" && Number.isInteger(opts.prNumber)
        ? opts.prNumber
        : iso && typeof iso.prNumber === "number"
          ? (iso.prNumber as number)
          : 0;
    return { repoPath, prNumber, branch };
  } catch {
    return { repoPath: "", prNumber: 0, branch: "" };
  }
}

/** Feedback de revise que consume el próximo implement (mismo shape de `reviewFeedback`). */
export interface BotReconcileFeedback {
  verdict: "revise";
  summary: string;
  findings: Array<{ message: string; severity?: string; file?: string; suggestion?: string }>;
}

/**
 * Política de reconciliación post-bot (WS-B): el override explícito del env
 * `TERMCANVAS_BOT_RECONCILE` (`1`/`0`) gana; si no está seteado vale el
 * setting persistido (`/factory/settings`, P4); sin ninguno, off. Nunca lanza.
 */
export function resolveBotReconcilePolicy(
  env: Record<string, string | undefined> = process.env,
): { enabled: boolean; source: "env" | "setting" | "default" } {
  try {
    return resolveBotReconcileGate(env);
  } catch {
    return { enabled: false, source: "default" };
  }
}

/**
 * Convierte los bot findings SIN reconciliar (status `open`) en el feedback
 * de revise que el próximo implement consume (`reviewFeedback.verdict ===
 * "revise"`, `implementPrompt.ts`): mensajes saneados, hasta 10 findings.
 * Null cuando no hay ninguno mapeable. Puro, nunca lanza.
 */
export function buildBotReconcileFeedback(findings: unknown): BotReconcileFeedback | null {
  try {
    if (!Array.isArray(findings)) return null;
    const mapped: BotReconcileFeedback["findings"] = [];
    for (const f of findings) {
      if (!f || typeof f !== "object" || Array.isArray(f)) continue;
      const r = f as Record<string, unknown>;
      const status = typeof r.status === "string" ? r.status.trim().toLowerCase() : "";
      if (status !== "open") continue;
      const message =
        typeof r.message === "string" ? r.message.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      if (message === "") continue;
      const one: BotReconcileFeedback["findings"][number] = { message };
      const file = typeof r.file === "string" ? r.file.trim().slice(0, 200) : "";
      if (file !== "") one.file = file;
      const suggestion = typeof r.suggestion === "string" ? r.suggestion.trim().slice(0, 300) : "";
      if (suggestion !== "") one.suggestion = suggestion;
      mapped.push(one);
      if (mapped.length >= 10) break;
    }
    if (mapped.length === 0) return null;
    return {
      verdict: "revise",
      summary: `Bot review sin reconciliar (${mapped.length} finding${
        mapped.length === 1 ? "" : "s"
      }): marcá cada uno Taken (fix) o Dropped (razón) antes del merge.`,
      findings: mapped,
    };
  } catch {
    return null;
  }
}

/** Cap WS-B: un solo round de reconciliación por job (evento durable en el timeline). */
export function hasBotReconcileEvent(timeline: unknown): boolean {
  try {
    if (!Array.isArray(timeline)) return false;
    return timeline.some((e) => {
      const m = e && typeof e === "object" ? (e as { meta?: unknown }).meta : null;
      return !!m && typeof m === "object" && "botReconcile" in (m as Record<string, unknown>);
    });
  } catch {
    return false;
  }
}

/**
 * Cap real de la ronda de reconciliación: el evento `botReconcileRun` que
 * escribe el starter al arrancar (`startBotReconcileRun`). Un start fallido
 * no lo escribe, así que la ronda puede reintentarse; un start exitoso la
 * cierra para siempre (cap 1). Nunca lanza.
 */
export function hasBotReconcileRunEvent(timeline: unknown): boolean {
  try {
    if (!Array.isArray(timeline)) return false;
    return timeline.some((e) => {
      const m = e && typeof e === "object" ? (e as { meta?: unknown }).meta : null;
      return !!m && typeof m === "object" && "botReconcileRun" in (m as Record<string, unknown>);
    });
  } catch {
    return false;
  }
}

/**
 * Feedback persistido por el evento `botReconcile` (restart-safe): permite
 * re-armar el run de reconciliación sin depender del callback en memoria.
 * Null cuando no hay evento o el shape es basura. Puro, nunca lanza.
 */
export function readBotReconcileFeedback(timeline: unknown): BotReconcileFeedback | null {
  try {
    if (!Array.isArray(timeline)) return null;
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const e = timeline[i];
      const m = e && typeof e === "object" ? (e as { meta?: unknown }).meta : null;
      if (!m || typeof m !== "object") continue;
      const bc = (m as Record<string, unknown>).botReconcile;
      if (!bc || typeof bc !== "object" || Array.isArray(bc)) continue;
      const fb = (bc as Record<string, unknown>).feedback;
      if (fb && typeof fb === "object" && !Array.isArray(fb)) {
        return fb as BotReconcileFeedback;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * P3: recorta los findings reconciliados al shape mínimo que viaja en el
 * evento `review report bot section` (`botFindings`) para poder reconstruir
 * el feedback de una ronda sin parsear el markdown del reporte. Puro, nunca
 * lanza.
 */
export function sanitizeBotFindingsForTimeline(
  findings: unknown,
): Array<{ id: string; status: string; message: string; file?: string; suggestion?: string }> {
  const out: Array<{ id: string; status: string; message: string; file?: string; suggestion?: string }> = [];
  try {
    if (!Array.isArray(findings)) return out;
    for (const f of findings) {
      if (!f || typeof f !== "object" || Array.isArray(f)) continue;
      const rec = f as Record<string, unknown>;
      const message =
        typeof rec.message === "string" ? rec.message.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      if (message === "") continue;
      const id = typeof rec.id === "string" ? rec.id.trim().slice(0, 80) : "";
      const status =
        typeof rec.status === "string" && rec.status.trim() !== ""
          ? rec.status.trim().toLowerCase().slice(0, 20)
          : "open";
      const file = typeof rec.file === "string" ? rec.file.trim().slice(0, 200) : "";
      const suggestion =
        typeof rec.suggestion === "string" ? rec.suggestion.trim().slice(0, 300) : "";
      out.push({
        id,
        status,
        message,
        ...(file !== "" ? { file } : {}),
        ...(suggestion !== "" ? { suggestion } : {}),
      });
      if (out.length >= 20) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * P3: último array `botFindings` estructurado persistido en el timeline (el
 * evento `review report bot section` más reciente). Vacío cuando no hay.
 * Puro, nunca lanza.
 */
export function readBotFindingsFromTimeline(
  timeline: unknown,
): Array<{ id: string; status: string; message: string; file?: string; suggestion?: string }> {
  try {
    if (!Array.isArray(timeline)) return [];
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const e = timeline[i];
      const m = e && typeof e === "object" ? (e as { meta?: unknown }).meta : null;
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      const raw = (m as Record<string, unknown>).botFindings;
      if (!Array.isArray(raw)) continue;
      return sanitizeBotFindingsForTimeline(raw);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Bloque markdown para el input `bot_findings` del run de reconciliación:
 * renumera los findings abiertos como `f1..fn` (los ids que
 * `extractDispositions` y el review saben disponer), con archivo y
 * sugerencia. Vacío cuando no hay findings mapeables. Puro, nunca lanza.
 */
export function formatBotFindingsForPrompt(feedback: unknown): string {
  try {
    if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) return "";
    const findings = (feedback as { findings?: unknown }).findings;
    if (!Array.isArray(findings)) return "";
    const lines: string[] = [];
    for (const f of findings) {
      if (!f || typeof f !== "object" || Array.isArray(f)) continue;
      const rec = f as { message?: unknown; file?: unknown; suggestion?: unknown };
      const message = typeof rec.message === "string" ? rec.message.trim() : "";
      if (message === "") continue;
      const file =
        typeof rec.file === "string" && rec.file.trim() !== "" ? ` (${rec.file.trim()})` : "";
      const suggestion =
        typeof rec.suggestion === "string" && rec.suggestion.trim() !== ""
          ? ` — Suggested fix: ${rec.suggestion.trim()}`
          : "";
      lines.push(`- f${lines.length + 1}${file} — ${message}${suggestion}`);
      if (lines.length >= 10) break;
    }
    if (lines.length === 0) return "";
    return lines.join("\n").slice(0, 4000);
  } catch {
    return "";
  }
}

/**
 * Background publication after the external reviewer: bounded wait
 * (`waitForBotReview`), mechanical reconciliation, bot section merged
 * into the report and publish. On timeout the section closes honestly
 * with the deadline-pending copy (`status: "timeout"`). Con el flag de
 * reconciliación activo y findings abiertos, prepara UNA ronda de revise
 * (cap 1) y avisa al caller vía `onBotReconcile`. Never throws.
 */
async function runDeferredBotReviewPublish(input: {
  jobId: string;
  repoPath: string;
  prNumber: number;
  branch: string;
  bots: readonly string[];
  run: GhExecRun;
  waitMs: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  waitForBot?: typeof waitForBotReview;
  /**
   * Gate de la ronda post-bot. Booleano (decisiones viejas) o thunk: con P4
   * el gate se evalúa al momento del publish (el setting puede cambiar
   * durante el wait del bot).
   */
  reconcileEnabled?: boolean | (() => boolean);
  onBotReconcile?: (jobId: string, feedback: BotReconcileFeedback) => void | Promise<void>;
}): Promise<void> {
  const publish = async (): Promise<void> => {
    try {
      await maybePublishReviewReportForJob(input.jobId, {
        repoPath: input.repoPath,
        prNumber: input.prNumber,
        branch: input.branch,
        run: input.run,
      });
    } catch {
      // best-effort: el PR ya quedó abierto
    }
  };
  try {
    const waitForBot = input.waitForBot ?? waitForBotReview;
    const waited = await waitForBot({
      repoPath: input.repoPath,
      prNumber: input.prNumber,
      run: input.run,
      bots: input.bots,
      timeoutMs: input.waitMs,
      ...(typeof input.pollMs === "number" ? { pollMs: input.pollMs } : {}),
      ...(typeof input.sleep === "function" ? { sleep: input.sleep } : {}),
    });
    const job = workItemStore.get(input.jobId);
    const stored = readReviewReportFromTimeline(job?.timeline);
    if (stored && typeof stored.report === "string" && stored.report !== "") {
      const head = await resolvePublishHead({
        repoPath: input.repoPath,
        branch: input.branch,
        run: input.run,
      }).catch(() => "unknown");
      let findings: ReturnType<typeof reconcileBotFindings> = [];
      if (waited.status === "found" && waited.findings.length > 0) {
        const since =
          waited.findings
            .map((f) => f.createdAt)
            .filter((s) => s.length > 0)
            .sort()[0] ?? "";
        const changed =
          since !== ""
            ? await changedFilesSince({ repoPath: input.repoPath, sinceIso: since, run: input.run })
            : [];
        // P4: disposiciones `fN` de la ronda (si existe): un estado terminal
        // marca `dispositioned` en vez de `open` (no bloquea readiness).
        const dispositions = collectBotDispositions(
          (job as unknown as { timeline?: unknown } | null | undefined)?.timeline,
        );
        findings = reconcileBotFindings(waited.findings, {
          internalFindings: readInternalFindingsForBot(job),
          changedFiles: changed,
          ...(dispositions.length > 0 ? { dispositions } : {}),
        });
      }
      const appended = appendBotReviewSection(stored.report, findings, {
        botReviewer: waited.reviewer,
        reviewedHead: head,
        status: waited.status,
      });
      // WS1b (endurecido): un bot finding abierto degrada header Y §1 juntos
      // (verdict REVIEW INCOMPLETE + readiness blocked, con la razón del bot);
      // sin abiertos el reporte vuelve a ready. Nunca READY con readiness
      // distinto de ready (caso PR #162). Un verdict ya no-READY se preserva.
      const updated = applyBotFindingsToReport(appended, findings, {
        reviewedHead: head,
        status: waited.status,
      });
      // WS-B: con findings del bot sin reconciliar, preparar UNA ronda de
      // revise (gate + cap 1) hacia el próximo implement. El callback del
      // caller decide si re-dispara; el engine deja el feedback durable en el
      // timeline (mismo shape que `reviewFeedback`). P2: si el gate está
      // apagado, el skip deja traza (antes era mudo: PR bloqueado y nada más).
      try {
        const openCount = findings.filter((f) => f.status === "open").length;
        const jobNow = workItemStore.get(input.jobId);
        const reconcileOn =
          typeof input.reconcileEnabled === "function"
            ? input.reconcileEnabled() === true
            : input.reconcileEnabled === true;
        if (openCount > 0 && jobNow && !hasBotReconcileEvent((jobNow as unknown as { timeline?: unknown }).timeline)) {
          if (reconcileOn) {
            const feedback = buildBotReconcileFeedback(findings);
            if (feedback) {
              workItemStore.appendEvent(
                input.jobId,
                "system",
                `bot reconcile: ${openCount} open finding(s) prepared for a new revise round (cap 1)`,
                { botReconcile: { feedback, openCount } } as unknown as Record<string, unknown>,
              );
              try {
                await input.onBotReconcile?.(input.jobId, feedback);
              } catch {
                // el hook del caller nunca rompe el publish
              }
            }
          } else {
            workItemStore.appendEvent(
              input.jobId,
              "system",
              `bot reconcile skipped: ${openCount} open finding(s) sin ronda (gate off)`,
              { botReconcileSkipped: { openCount, reason: "gate-off" } } as unknown as Record<
                string,
                unknown
              >,
            );
          }
        }
      } catch {
        // best-effort: la preparación de la ronda nunca rompe el publish
      }
      try {
        workItemStore.appendEvent(
          input.jobId,
          "system",
          `review report bot section: ${findings.length} finding(s), ${findings.filter((f) => f.status === "open").length} open (${waited.status})`,
          {
            reviewReport: { ...stored, report: updated.slice(0, 20000) },
            // P3: findings estructurados para que el boot recovery (o una
            // re-armada futura) pueda reconstruir el feedback sin parsear el
            // markdown del reporte.
            botFindings: sanitizeBotFindingsForTimeline(findings),
          } as unknown as Record<string, unknown>,
        );
      } catch {
        // best-effort: el archivo local sigue siendo la fuente
      }
    }
  } catch {
    // best-effort: publica igual el reporte sin sección de bot
  }
  await publish();
}

export interface ScheduleReviewPublishResult {
  mode: "immediate" | "deferred" | "skipped";
  skipped?: string;
  outcome?: PublishReviewOutcome;
}

/**
 * Publication entrypoint after the PR is ensured (option A): waits for
 * the external reviewer within a bounded window and publishes the report
 * reconciled; with the wait disabled (or no target) it publishes
 * immediately like before. Never throws.
 */
export async function scheduleReviewReportPublish(
  jobId: unknown,
  opts?: {
    repoPath?: unknown;
    prNumber?: unknown;
    branch?: unknown;
    run?: GhExecRun;
    env?: Record<string, string | undefined>;
    waitMs?: unknown;
    bots?: readonly string[];
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    waitForBot?: typeof waitForBotReview;
    /** WS-B: hook opcional para re-disparar la ronda de reconciliación. */
    onBotReconcile?: (jobId: string, feedback: BotReconcileFeedback) => void | Promise<void>;
  },
): Promise<ScheduleReviewPublishResult> {
  try {
    if (typeof jobId !== "string" || jobId.length === 0) {
      return { mode: "skipped", skipped: "bad-id" };
    }
    const policy = resolveBotReviewPolicy(opts?.env ?? process.env);
    const waitMs =
      typeof opts?.waitMs === "number" && Number.isInteger(opts.waitMs) && opts.waitMs >= 0
        ? Math.min(opts.waitMs as number, BOT_REVIEW_WAIT_MS_MAX)
        : policy.waitMs;
    const bots = Array.isArray(opts?.bots) ? opts.bots : policy.bots;
    const job = workItemStore.get(jobId);
    const target = resolveReviewPublishTarget(job, opts);
    if (waitMs <= 0 || bots.length === 0 || target.repoPath.trim() === "" || target.prNumber <= 0) {
      const outcome = await maybePublishReviewReportForJob(jobId, opts);
      return { mode: "immediate", outcome };
    }
    void runDeferredBotReviewPublish({
      jobId,
      repoPath: target.repoPath,
      prNumber: target.prNumber,
      branch: target.branch,
      bots,
      run: opts?.run ?? defaultRun,
      waitMs,
      // P4: el gate se evalúa recién al decidir (el setting puede cambiar
      // durante el wait del bot; el env sigue mandando si está seteado).
      reconcileEnabled: () => resolveBotReconcilePolicy(opts?.env ?? process.env).enabled,
      ...(typeof opts?.onBotReconcile === "function" ? { onBotReconcile: opts.onBotReconcile } : {}),
      ...(typeof opts?.pollMs === "number" ? { pollMs: opts.pollMs } : {}),
      ...(typeof opts?.sleep === "function" ? { sleep: opts.sleep } : {}),
      ...(typeof opts?.waitForBot === "function" ? { waitForBot: opts.waitForBot } : {}),
    });
    return { mode: "deferred" };
  } catch (e) {
    return {
      mode: "skipped",
      skipped: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * Abandon path (NO es merge: cerrar sin mergear no completa nada — la regla
 * Warp "ninguna primitiva que complete un PR" sigue intacta, el merge humano
 * sigue solo en Electron/GitHub UI). Cierra el PR abierto del job/branch
 * para el teardown del discard. Idempotente: PR ya cerrado/ausente →
 * `closed: false` honesto, nunca error. Nunca lanza.
 */export interface ClosePrForJobInput {
  readonly repoPath: string;
  readonly prNumber?: number;
  readonly branch?: string;
  readonly run?: GhExecRun;
}

export type ClosePrForJobResult =
  | { ok: true; closed: true; prNumber?: number }
  | { ok: true; closed: false; reason: string }
  | { ok: false; error: string };

export async function closePrForJob(
  input: ClosePrForJobInput,
): Promise<ClosePrForJobResult> {
  const run: GhExecRun = input?.run ?? defaultRun;
  try {
    const repoPath =
      typeof input?.repoPath === "string" ? input.repoPath : "";
    if (repoPath.trim().length === 0) {
      return { ok: false, error: "repoPath is required" };
    }
    const sel =
      typeof input?.prNumber === "number" &&
      Number.isInteger(input.prNumber) &&
      (input.prNumber as number) > 0
        ? String(input.prNumber)
        : typeof input?.branch === "string" && input.branch.length > 0
          ? (input.branch as string)
          : "";
    if (sel.length === 0) {
      return { ok: true, closed: false, reason: "sin PR ni rama: nada para cerrar" };
    }
    const current = await readPrState({
      repoPath,
      ...(typeof input?.prNumber === "number" &&
      Number.isInteger(input.prNumber) &&
      (input.prNumber as number) > 0
        ? { prNumber: input.prNumber as number }
        : {}),
      ...(typeof input?.branch === "string" && input.branch.length > 0
        ? { branch: input.branch as string }
        : {}),
      run,
    }).catch(() => null);
    if (current !== null && current.ok && current.state !== "open") {
      return { ok: true, closed: false, reason: `PR ya ${current.state}: nada para cerrar` };
    }
    try {
      await run("gh", ["pr", "close", sel], {
        cwd: repoPath,
        timeoutMs: GH_PR_CLOSE_TIMEOUT_MS,
      });
    } catch (e) {
      return { ok: false, error: sliceError(e) };
    }
    const out: { ok: true; closed: true; prNumber?: number } = {
      ok: true,
      closed: true,
    };
    if (
      typeof input?.prNumber === "number" &&
      Number.isInteger(input.prNumber) &&
      (input.prNumber as number) > 0
    ) {
      out.prNumber = input.prNumber as number;
    }
    return out;
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}

/** Post-`Complete` orchestration outcome (fail-safe, idempotent). */
export type CompletedPrOutcome =
  | { opened: true; prNumber: number; prUrl: string }
  | { opened: false; skipped?: string; error?: string };

/**
 * PR text enrichment from the job's own record: issue title (first line of
 * the daemon prompt), accepted-review summary, changed files and the
 * verification report from the timeline. All optional — a junk job still
 * gets the honest minimal PR. Puro, nunca lanza.
 */
/**
 * Detalles del PR desde el job: summary del review aceptado, archivos,
 * verificación y reporte del implement (timeline). Exportado para tests.
 * Puro, nunca lanza.
 */
export function buildPrDetailsFromJob(job: unknown): {
  title: string | undefined;
  details: PrBodyDetails;
} {
  try {
    if (!job || typeof job !== "object") return { title: undefined, details: {} };
    const rec = job as {
      prompt?: unknown;
      lastReview?: Record<string, unknown> | null;
      timeline?: Array<{ meta?: Record<string, unknown> }>;
      isolation?: {
        branch?: unknown;
        baseBranch?: unknown;
      } | null;
    };
    let createdFiles: string[] = [];
    let verification: unknown = null;
    let implementReport = "";
    let planUrl: string | undefined;
    const rev = [...(rec.timeline ?? [])].reverse();
    for (const e of rev) {
      const m = e?.meta;
      if (!m) continue;
      if (!verification && typeof m.verification === "object" && m.verification !== null) {
        verification = m.verification;
      }
      if (createdFiles.length === 0 && Array.isArray(m.createdFiles)) {
        createdFiles = (m.createdFiles as unknown[]).map(String).slice(0, 50);
      }
      if (
        implementReport === "" &&
        typeof m.implementReport === "string" &&
        m.implementReport.trim() !== ""
      ) {
        // Cap alto: los extractores acotan por sección; un corte bajo
        // decapita Contract/Seams/Validation/Discoveries (caso PR #157).
        implementReport = m.implementReport.trim().slice(0, 12000);
      }
      // Verified published-plan URL only (local paths never qualify; the
      // body renderer re-validates the http(s) shape before printing).
      if (planUrl === undefined) {
        const cand =
          typeof m.planPublication === "string"
            ? m.planPublication
            : typeof m.planUrl === "string"
              ? m.planUrl
              : "";
        if (/^https?:\/\/\S+$/.test(cand.trim())) planUrl = cand.trim().slice(0, 500);
      }
      if (verification && createdFiles.length > 0 && implementReport !== "" && planUrl !== undefined) break;
    }
    const review =
      rec.lastReview && typeof rec.lastReview === "object" ? rec.lastReview : null;
    const summary = typeof review?.summary === "string" ? review.summary : undefined;
    const reviewer =
      typeof review?.reviewerModel === "string" ? review.reviewerModel : undefined;
    const branch =
      rec.isolation && typeof rec.isolation.branch === "string"
        ? rec.isolation.branch
        : undefined;
    const baseBranch =
      rec.isolation && typeof rec.isolation.baseBranch === "string"
        ? rec.isolation.baseBranch
        : undefined;
    return {
      title: undefined,
      details: {
        ...(summary ? { summary } : {}),
        ...(reviewer ? { reviewer } : {}),
        ...(createdFiles.length > 0 ? { files: createdFiles } : {}),
        ...(verification ? { verification } : {}),
        ...(implementReport !== "" ? { implementReport } : {}),
        ...(branch ? { branch } : {}),
        ...(baseBranch ? { baseBranch } : {}),
        ...(planUrl ? { planUrl } : {}),
      },
    };
  } catch {
    return { title: undefined, details: {} };
  }
}

/**
 * Post-`Complete` hook body: opens the handoff PR once per job.
 * Guards: job known + `Complete` + isolation recorded + `prGuard` clear.
 * Outcome lands on the timeline (`pr` meta: durable path) plus the memory
 * record; failure keeps the job `Complete` with a manual hint.
 * Never throws.
 */
export async function maybeOpenPrForCompletedJob(
  jobId: unknown,
  opts?: {
    /**
     * Ronda de reconciliación post-bot (WS-2): reutiliza el PR abierto sin
     * cortar el commit/push del trabajo nuevo; el caller la dispara con el
     * run de reconciliación completado.
     */
    reconcile?: boolean;
    /** Hook WS-B: re-disparo de la ronda cuando el bot deja findings abiertos. */
    onBotReconcile?: (jobId: string, feedback: BotReconcileFeedback) => void | Promise<void>;
  },
): Promise<CompletedPrOutcome> {
  try {
    if (typeof jobId !== "string" || jobId.length === 0) {
      return { opened: false, skipped: "bad-id" };
    }
    const job = workItemStore.get(jobId);
    if (!job) return { opened: false, skipped: "unknown-job" };
    if (job.status !== "Complete") {
      return { opened: false, skipped: "not-complete" };
    }
    const iso = (job as WorkItem).isolation;
    if (
      !iso ||
      typeof iso.branch !== "string" ||
      iso.branch.length === 0 ||
      typeof iso.worktreePath !== "string" ||
      iso.worktreePath.length === 0 ||
      typeof iso.baseBranch !== "string" ||
      iso.baseBranch.length === 0
    ) {
      // Skip visible: sin jaula (job sin issue enlazada / aislamiento no
      // creado) no hay rama ni PR; el trabajo quedó en el worktree. Sin este
      // evento el accept humano se siente como "no pasó nada".
      try {
        workItemStore.appendEvent(
          jobId,
          "system",
          "pr skipped: not-isolated — job sin rama de aislamiento (sin issue enlazada); cambios quedaron en el worktree",
          { pr: { skipped: "not-isolated" } } as unknown as Record<
            string,
            unknown
          >,
        );
      } catch {
        // Best-effort; el resultado sigue siendo skip.
      }
      return { opened: false, skipped: "not-isolated" };
    }
    const guard = prGuard(job);
    if (guard.opened && opts?.reconcile !== true) {
      return { opened: false, skipped: "already-opened" };
    }
    const branchHit = iso.branch.match(/^issue-(\d+)/);
    const issueNumber = branchHit
      ? Number.parseInt(branchHit[1] as string, 10)
      : NaN;
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      try {
        workItemStore.appendEvent(
          jobId,
          "system",
          `pr skipped: bad-branch — la rama "${iso.branch}" no sigue el patrón issue-N; no se puede derivar el issue`,
          { pr: { skipped: "bad-branch", branch: iso.branch } } as unknown as Record<
            string,
            unknown
          >,
        );
      } catch {
        // Best-effort; el resultado sigue siendo skip.
      }
      return { opened: false, skipped: "bad-branch" };
    }
    // PR text: real issue title from the daemon prompt + summary/files/
    // verification from the job record (junk degrades to the old minimal PR).
    const prText = {
      ...buildPrDetailsFromJob(job),
      title: parseIssueTitleFromPrompt((job as WorkItem).prompt, issueNumber) ?? undefined,
    };
    const res = await openPrForJob({
      repoPath: iso.worktreePath,
      branch: iso.branch,
      baseBranch: iso.baseBranch,
      issueNumber,
      title: prText.title,
      details: prText.details,
      ...(opts?.reconcile === true ? { reconcile: true } : {}),
    });
    if (res.ok) {
      try {
        // No pisar un estado terminal del PR (merged/closed): el reuse
        // duplicado devuelve el PR viejo y re-marcarlo pr-open confundiría
        // al panel (carrera: el humano lo cierra durante la ronda).
        const prevState =
          iso && typeof (iso as { state?: unknown }).state === "string"
            ? ((iso as { state: string }).state)
            : "";
        (job as WorkItem).isolation = {
          ...iso,
          prNumber: res.prNumber,
          prUrl: res.prUrl,
          state:
            res.duplicate === true && prevState === "pr-merged" ? "pr-merged" : "pr-open",
        };
      } catch {
        // Memory fast path is best-effort; the timeline event is the record.
      }
      // Verified routing detail (prp-pr): base <- head plus ready/draft
      // when the post-create verification answered; duplicates are explicit.
      const route =
        typeof res.base === "string" && res.base.length > 0
          ? ` (${res.base} <- ${typeof res.head === "string" && res.head.length > 0 ? res.head : iso.branch}, ${res.draft === true ? "draft" : "ready"})`
          : "";
      const msg =
        res.duplicate === true
          ? `pr already exists #${res.prNumber} ${res.prUrl} (reused, no duplicate opened)`
          : `pr opened #${res.prNumber} ${res.prUrl}${route}`;
      try {
        workItemStore.appendEvent(
          jobId,
          "system",
          msg,
          { pr: { prNumber: res.prNumber, prUrl: res.prUrl } } as unknown as Record<
            string,
            unknown
          >,
        );
      } catch {
        // The memory record above already carries the outcome.
      }
      // P3b + revisor externo primero (option A): con el PR asegurado, la
      // publicación espera acotada al bot (pullfrog) y comenta el reporte
      // reconciliado; `TERMCANVAS_REVIEW_WAIT_MS=0` vuelve al publish
      // inmediato. Best-effort: nunca voltea el handoff.
      try {
        await scheduleReviewReportPublish(jobId, {
          repoPath: iso.worktreePath,
          prNumber: res.prNumber,
          branch: iso.branch,
          ...(typeof opts?.onBotReconcile === "function"
            ? { onBotReconcile: opts.onBotReconcile }
            : {}),
        });
      } catch {
        // best-effort; el PR ya quedó abierto
      }
      return { opened: true, prNumber: res.prNumber, prUrl: res.prUrl };
    }
    try {
      workItemStore.appendEvent(
        jobId,
        "system",
        `pr open failed: ${res.error} — manual: ${res.manualHint}`.slice(0, 500),
        { pr: { error: res.error } } as unknown as Record<string, unknown>,
      );
    } catch {
      // Honest logging is best-effort; the job stays `Complete`.
    }
    return { opened: false, error: res.error };
  } catch (e) {
    try {
      return {
        opened: false,
        error:
          e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      };
    } catch {
      return { opened: false, error: "pr hook failed" };
    }
  }
}

/** Runner por defecto re-exportado para el reconciliador de merges. */
export { defaultRun as defaultGhRun };
