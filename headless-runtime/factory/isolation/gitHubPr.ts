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
import type { WorkItem } from "../../../shared/types/workItem";
import { buildPrBody, buildPrTitle, prGuard, parseIssueTitleFromPrompt, type PrBodyDetails } from "./isolationStore";

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
}

export type OpenPrForJobResult =
  | { ok: true; prNumber: number; prUrl: string }
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
 * Worktree sucio o limpio (`git status --porcelain`, trimmed). Null cuando
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
    const out = await input.run("git", ["status", "--porcelain"], {
      cwd: repoPath,
      timeoutMs: GIT_STATUS_TIMEOUT_MS,
    });
    return String(out?.stdout ?? "").trim();
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
];

/** Archivos exactos que el commit jamás incluye (locks del toolchain). */
const COMMIT_EXCLUDE_EXACT: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

/** Tope de paths por `git add --` (misma cota que el reporte de cambios). */
const COMMIT_MAX_PATHS = 50;

/**
 * True si la ruta relativa puede entrar al commit del PR (pura, nunca
 * lanza). Fuera: ruido de toolchain/daemon (`node_modules/`, `dist/`,
 * `logs/`, `.agents/...`, worktrees) y `*.log`. Todo lo demás pasa,
 * incluido el código y tests del issue.
 */
export function isCommittablePath(p: unknown): boolean {
  try {
    if (typeof p !== "string" || p.length === 0) return false;
    const norm = p.replace(/\\/g, "/").replace(/^\.\//, "");
    if (norm.length === 0 || norm.startsWith("/") || norm.includes("..")) return false;
    const lower = norm.toLowerCase();
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
 * Soporta `XY PATH`, renombres `R  old -> new` (toma el destino) y paths
 * entrecomillados. Deduplica, acota a `COMMIT_MAX_PATHS`, ignora basura.
 */
export function parsePorcelainPaths(porcelain: unknown): string[] {
  try {
    if (typeof porcelain !== "string" || porcelain.length === 0) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const rawLine of porcelain.split("\n")) {
      try {
        const line = rawLine.length > 3 ? rawLine.slice(3) : rawLine.trim();
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
    if (candidates.length > 0) {
      try {
        await run("git", ["add", "--", ...candidates], {
          cwd: repoPath,
          timeoutMs: GIT_COMMIT_TIMEOUT_MS,
        });
      } catch (e) {
        return { ok: false, error: sliceError(`git add failed: ${e instanceof Error ? e.message : String(e)}`) };
      }
    } else if (Array.isArray(input?.allowedPaths) && input.allowedPaths.length > 0) {
      return { ok: false, error: "nothing committable after exclusions: node_modules/logs/.agents/dist quedan fuera del PR" };
    } else if (typeof input?.knownStatus === "string") {
      return { ok: false, error: "nothing committable after exclusions: node_modules/logs/.agents/dist quedan fuera del PR" };
    } else {
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
    try {
      await run(
        "git",
        [
          "-c",
          `user.name=${FACTORY_GIT_USER_NAME}`,
          "-c",
          `user.email=${FACTORY_GIT_USER_EMAIL}`,
          "commit",
          "-m",
          `factory: implement issue #${n} (handoff)`,
        ],
        { cwd: repoPath, timeoutMs: GIT_COMMIT_TIMEOUT_MS },
      );
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
    const title = buildPrTitle(n, input?.title);
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
    if (status !== "" && status !== null) {
      const committed = await commitWorktreeChanges({
        repoPath,
        issueNumber: n,
        run,
        knownStatus: status,
        allowedPaths: input?.allowedPaths,
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
    const body = buildPrBody(n, input?.title, input?.details);
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
    // The PR exists now: tag it pendiente best-effort so the panel can
    // derive it without a live watcher (factory path has no terminal).
    await applyPendingLabelBestEffort(run, repoPath, parsed.prNumber);
    return { ok: true, prNumber: parsed.prNumber, prUrl: parsed.prUrl };
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

/**
 * Abandon path (NO es merge: cerrar sin mergear no completa nada — la regla
 * Warp "ninguna primitiva que complete un PR" sigue intacta, el merge humano
 * sigue solo en Electron/GitHub UI). Cierra el PR abierto del job/branch
 * para el teardown del discard. Idempotente: PR ya cerrado/ausente →
 * `closed: false` honesto, nunca error. Nunca lanza.
 */
export interface ClosePrForJobInput {
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
function buildPrDetailsFromJob(job: unknown): {
  title: string | undefined;
  details: PrBodyDetails;
} {
  try {
    if (!job || typeof job !== "object") return { title: undefined, details: {} };
    const rec = job as {
      prompt?: unknown;
      lastReview?: Record<string, unknown> | null;
      timeline?: Array<{ meta?: Record<string, unknown> }>;
    };
    let createdFiles: string[] = [];
    let verification: unknown = null;
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
      if (verification && createdFiles.length > 0) break;
    }
    const review =
      rec.lastReview && typeof rec.lastReview === "object" ? rec.lastReview : null;
    const summary = typeof review?.summary === "string" ? review.summary : undefined;
    const reviewer =
      typeof review?.reviewerModel === "string" ? review.reviewerModel : undefined;
    return {
      title: undefined,
      details: {
        ...(summary ? { summary } : {}),
        ...(reviewer ? { reviewer } : {}),
        ...(createdFiles.length > 0 ? { files: createdFiles } : {}),
        ...(verification ? { verification } : {}),
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
    if (guard.opened) return { opened: false, skipped: "already-opened" };
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
    });
    if (res.ok) {
      try {
        (job as WorkItem).isolation = {
          ...iso,
          prNumber: res.prNumber,
          prUrl: res.prUrl,
          state: "pr-open",
        };
      } catch {
        // Memory fast path is best-effort; the timeline event is the record.
      }
      try {
        workItemStore.appendEvent(
          jobId,
          "system",
          `pr opened #${res.prNumber} ${res.prUrl}`,
          { pr: { prNumber: res.prNumber, prUrl: res.prUrl } } as unknown as Record<
            string,
            unknown
          >,
        );
      } catch {
        // The memory record above already carries the outcome.
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
