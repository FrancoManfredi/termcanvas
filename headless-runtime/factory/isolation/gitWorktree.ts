/**
 * Isolated git worktrees given factory jobs (Warp-style jail).
 *
 * One worktree per job, branch `issue-N[-slug]` (parity mirror owned by
 * `isolationStore.ts`). Creation attaches when the worktree or the branch
 * already exists and tracks the remote branch when remote-only. Removal
 * drops the worktree folder only — the branch is NEVER deleted by the
 * daemon, so an open PR stays reviewable.
 *
 * ESM only, `node:child_process execFile` (same primitive as Electron
 * main), explicit `timeout` option on every spawn, `maxBuffer 10 MB`,
 * single attempt per call. Every export never throws (honest unions,
 * errors sliced to 200 chars).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { buildIsolationBranchName } from "./isolationStore";
import { ghEnv } from "./gitHubPr";

/** Bound G01: `git worktree add` single attempt. */
export const GIT_WORKTREE_ADD_TIMEOUT_MS = 30000;

/** Bound G01: rev-parse / list probes, single attempt each. */
export const GIT_PROBE_TIMEOUT_MS = 10000;

/** Bound: `git worktree remove`, single attempt. */
export const GIT_WORKTREE_REMOVE_TIMEOUT_MS = 30000;

/** Output cap given every git spawn. */
export const GIT_EXEC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/** Slice width given honest error strings. */
const ERROR_SLICE = 200;

/** Injectable spawn (tests pass a fake; production uses execFile). */
export type GitExecRun = (
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

const execFileAsync = promisify(execFile);

/**
 * Production spawn: argv array (no shell, slug-safe branch names cannot
 * inject), explicit timeout, capped buffer, plain env passthrough.
 */
function defaultRun(
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<GitExecResult> {
  return execFileAsync(cmd, [...args], {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    maxBuffer: GIT_EXEC_MAX_BUFFER_BYTES,
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
    return "git call failed";
  }
}

/** Per-job in-flight guard: concurrent ensure calls given one job collapse. */
const ensureInFlight = new Set<string>();

export interface EnsureIsolatedWorktreeInput {
  readonly repoAnchor: string;
  readonly issueNumber: number;
  readonly title?: unknown;
  readonly baseBranch?: string;
  readonly jobId?: string;
  readonly run?: GitExecRun;
  /**
   * Seam testeable para los excludes locales (default: fs real). El
   * contenido nunca se commitea (vive en `$GIT_DIR/info/exclude`).
   */
  readonly readTextFile?: (file: string) => string | null;
  readonly writeTextFile?: (file: string, content: string) => void;
}

/** Marca de los excludes locales del factory (idempotencia por contenido). */
const WORKTREE_EXCLUDE_MARKER = "termcanvas-factory local excludes";

/**
 * Ruido de daemon/toolchain + review aids del ciclo que jamás debe ser
 * commiteable ni listado. Espejo de los filtros de `gitHubPr.ts` (los
 * archivos de review van anclados a la raíz; `review/` a cualquier nivel).
 */
const WORKTREE_LOCAL_EXCLUDES =
  ".agents/\n" +
  "logs/\n" +
  "*.log\n" +
  "/artifacts/scope.md\n" +
  "/scope.md\n" +
  "/plan.md\n" +
  "/triage.md\n" +
  "/discoveries.json\n" +
  "/discoveries.md\n" +
  "review/\n";

export type EnsureIsolatedWorktreeResult =
  | {
      ok: true;
      worktreePath: string;
      branch: string;
      baseBranch: string;
      repoRoot: string;
      attached: boolean;
    }
  | { ok: false; error: string };

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Excludes locales del worktree recién creado (`$GIT_DIR/info/exclude`):
 * `.agents/`, `logs/`, `*.log` y las review aids del ciclo (`scope.md`,
 * `plan.md`, `triage.md`, `discoveries.*`, `artifacts/scope.md`,
 * `review/`) — ruido del daemon y ayudas que el commit selectivo ya
 * filtra, pero que tampoco deben ensuciar `git status` ni depender del
 * `.gitignore` del repo target (fix PRs +1M líneas, issue #69/#70; aids
 * coladas al commit en PR #158). Vive fuera del worktree (nunca
 * commiteado), idempotente por marcador, best-effort (nunca rompe el
 * ensure). Nunca lanza.
 */
async function ensureWorktreeLocalExcludesBestEffort(
  run: GitExecRun,
  worktreePath: string,
  readTextFile?: (file: string) => string | null,
  writeTextFile?: (file: string, content: string) => void,
): Promise<void> {
  try {
    if (!worktreePath || worktreePath.trim().length === 0) return;
    const read =
      readTextFile ??
      ((file: string): string | null => {
        try {
          return fs.readFileSync(file, "utf-8");
        } catch {
          return null;
        }
      });
    const write =
      writeTextFile ??
      ((file: string, content: string): void => {
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
        } catch {
          // best-effort
        }
        fs.writeFileSync(file, content, "utf-8");
      });
    let gitDir = "";
    try {
      const out = await run("git", ["rev-parse", "--absolute-git-dir"], {
        cwd: worktreePath,
        timeoutMs: GIT_PROBE_TIMEOUT_MS,
      });
      gitDir = String(out?.stdout ?? "").trim();
    } catch {
      return;
    }
    if (gitDir.length === 0) return;
    const excludeFile = path.join(gitDir, "info", "exclude");
    let prev: string | null = null;
    try {
      prev = read(excludeFile);
    } catch {
      prev = null;
    }
    if (typeof prev === "string" && prev.includes(WORKTREE_EXCLUDE_MARKER)) return;
    const base = typeof prev === "string" ? prev.replace(/\s+$/, "") : "";
    const snippet = `# ${WORKTREE_EXCLUDE_MARKER} (daemon noise, never committed)\n${WORKTREE_LOCAL_EXCLUDES}`;
    try {
      write(excludeFile, base.length > 0 ? `${base}\n${snippet}` : `${snippet}`);
    } catch {
      // best-effort
    }
  } catch {
    // best-effort: los excludes nunca rompen el ensure
  }
}

/**
 * Create (or attach) the isolated worktree given one job. Idempotent per
 * job id: a second call given the same key attaches, never duplicates.
 * Never throws.
 */
export async function ensureIsolatedWorktree(
  input: EnsureIsolatedWorktreeInput,
): Promise<EnsureIsolatedWorktreeResult> {
  const run: GitExecRun = input?.run ?? defaultRun;
  try {
    const n = input?.issueNumber;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      return { ok: false, error: "invalid issueNumber" };
    }
    const anchor =
      typeof input?.repoAnchor === "string" ? input.repoAnchor : "";
    if (anchor.trim().length === 0) {
      return { ok: false, error: "repoAnchor is required" };
    }
    const branch = buildIsolationBranchName({
      issueNumber: n,
      title: input?.title,
    });
    const key =
      typeof input?.jobId === "string" && input.jobId.length > 0
        ? input.jobId
        : branch;
    if (ensureInFlight.has(key)) {
      return { ok: false, error: `isolation already in flight given ${key}` };
    }
    ensureInFlight.add(key);
    try {
      let repoRoot = "";
      try {
        const rootOut = await run(
          "git",
          ["rev-parse", "--show-toplevel"],
          { cwd: anchor, timeoutMs: GIT_PROBE_TIMEOUT_MS },
        );
        repoRoot = rootOut.stdout.trim();
      } catch (e) {
        return {
          ok: false,
          error: sliceError(
            `not a git repository: ${e instanceof Error ? e.message : String(e)}`,
          ),
        };
      }
      if (repoRoot.length === 0) {
        return { ok: false, error: "not a git repository" };
      }
      let base =
        typeof input?.baseBranch === "string" ? input.baseBranch.trim() : "";
      if (base.length === 0) {
        try {
          const head = await run(
            "git",
            ["rev-parse", "--abbrev-ref", "HEAD"],
            { cwd: repoRoot, timeoutMs: GIT_PROBE_TIMEOUT_MS },
          );
          base = head.stdout.trim();
        } catch {
          base = "";
        }
        if (base.length === 0 || base === "HEAD") base = "main";
      }
      const worktreePath = path.join(repoRoot, ".worktrees", branch);
      const want = `worktree ${normalizeSlashes(worktreePath)}`;
      try {
        const listed = await run(
          "git",
          ["worktree", "list", "--porcelain"],
          { cwd: repoRoot, timeoutMs: GIT_PROBE_TIMEOUT_MS },
        );
        const known = listed.stdout
          .split("\n")
          .map((l) => normalizeSlashes(l.trim()))
          .some((l) => l === want);
        if (known) {
          await ensureWorktreeLocalExcludesBestEffort(
            run,
            worktreePath,
            input?.readTextFile,
            input?.writeTextFile,
          );
          return {
            ok: true,
            worktreePath,
            branch,
            baseBranch: base,
            repoRoot,
            attached: true,
          };
        }
      } catch {
        // Probe miss: fall through to the create path.
      }
      let localBranch = false;
      try {
        await run(
          "git",
          ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
          { cwd: repoRoot, timeoutMs: GIT_PROBE_TIMEOUT_MS },
        );
        localBranch = true;
      } catch {
        localBranch = false;
      }
      if (localBranch) {
        await run("git", ["worktree", "add", worktreePath, branch], {
          cwd: repoRoot,
          timeoutMs: GIT_WORKTREE_ADD_TIMEOUT_MS,
        });
        await ensureWorktreeLocalExcludesBestEffort(
          run,
          worktreePath,
          input?.readTextFile,
          input?.writeTextFile,
        );
        return {
          ok: true,
          worktreePath,
          branch,
          baseBranch: base,
          repoRoot,
          attached: true,
        };
      }
      let remoteBranch = false;
      try {
        await run(
          "git",
          ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`],
          { cwd: repoRoot, timeoutMs: GIT_PROBE_TIMEOUT_MS },
        );
        remoteBranch = true;
      } catch {
        remoteBranch = false;
      }
      if (remoteBranch) {
        await run(
          "git",
          [
            "worktree",
            "add",
            "--track",
            "-b",
            branch,
            worktreePath,
            `origin/${branch}`,
          ],
          { cwd: repoRoot, timeoutMs: GIT_WORKTREE_ADD_TIMEOUT_MS },
        );
        await ensureWorktreeLocalExcludesBestEffort(
          run,
          worktreePath,
          input?.readTextFile,
          input?.writeTextFile,
        );
        return {
          ok: true,
          worktreePath,
          branch,
          baseBranch: base,
          repoRoot,
          attached: true,
        };
      }
      await run("git", ["worktree", "add", "-b", branch, worktreePath, base], {
        cwd: repoRoot,
        timeoutMs: GIT_WORKTREE_ADD_TIMEOUT_MS,
      });
      await ensureWorktreeLocalExcludesBestEffort(
        run,
        worktreePath,
        input?.readTextFile,
        input?.writeTextFile,
      );
      return {
        ok: true,
        worktreePath,
        branch,
        baseBranch: base,
        repoRoot,
        attached: false,
      };
    } finally {
      ensureInFlight.delete(key);
    }
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}

export interface RemoveIsolatedWorktreeInput {
  readonly worktreePath: string;
  readonly force?: boolean;
  readonly cwd?: string;
  readonly run?: GitExecRun;
}

export type RemoveIsolatedWorktreeResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Remove the worktree folder (explicit human cleanup only). The branch is
 * kept on purpose. Never throws.
 */
export async function removeIsolatedWorktree(
  input: RemoveIsolatedWorktreeInput,
): Promise<RemoveIsolatedWorktreeResult> {
  const run: GitExecRun = input?.run ?? defaultRun;
  try {
    const target =
      typeof input?.worktreePath === "string" ? input.worktreePath : "";
    if (target.trim().length === 0) {
      return { ok: false, error: "worktreePath is required" };
    }
    const cwd =
      typeof input?.cwd === "string" && input.cwd.length > 0
        ? input.cwd
        : path.dirname(target);
    const args =
      input?.force === true
        ? ["worktree", "remove", "--force", target]
        : ["worktree", "remove", target];
    await run("git", args, {
      cwd,
      timeoutMs: GIT_WORKTREE_REMOVE_TIMEOUT_MS,
    });
    try {
      await run("git", ["worktree", "prune"], {
        cwd,
        timeoutMs: GIT_PROBE_TIMEOUT_MS,
      });
    } catch {
      // Prune is hygiene; the removal already landed.
    }
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}

/**
 * Porcelain dirt check used by the DELETE guard (fail-closed upstream:
 * a check miss counts as dirty). Never throws.
 */
export async function isWorkingTreeDirty(input: {
  worktreePath: string;
  run?: GitExecRun;
}): Promise<{ ok: true; dirty: boolean } | { ok: false; error: string }> {
  const run: GitExecRun = input?.run ?? defaultRun;
  try {
    const target =
      typeof input?.worktreePath === "string" ? input.worktreePath : "";
    if (target.trim().length === 0) {
      return { ok: false, error: "worktreePath is required" };
    }
    const out = await run("git", ["status", "--porcelain"], {
      cwd: target,
      timeoutMs: GIT_PROBE_TIMEOUT_MS,
    });
    return { ok: true, dirty: out.stdout.trim().length > 0 };
  } catch (e) {
    return { ok: false, error: sliceError(e) };
  }
}
