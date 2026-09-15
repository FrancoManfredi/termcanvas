/**
 * headless-runtime/github-lookups.ts — read-only `gh` lookups for the
 * headless API (F2 web-local). Small duplicated spawns mirroring the
 * Electron `github:*` handlers: timeout 30s, maxBuffer 50MB. Response
 * envelopes match the bridge shapes so the web client treats both
 * identically (parity). No merge, no writes, no openUrl here.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  REVIEW_CYCLE_LABELS,
  canonicalReviewLabel,
  reviewLabelsForVerdict,
} from "../shared/review-verdict.ts";
import {
  buildApplyCycleLabelArgs,
  buildEnsureLabelArgs,
  buildLinkedPrsQuery,
  buildReviewDecisionArgs,
  buildSyncIssueLabelArgs,
  foldReviewDecision,
  parseLinkedIssueNumber,
  parseLinkedPrNodes,
  parseOwnerRepoFromRemote,
  pickPreferredPr,
  truncateReviewComments,
  type LinkedPrNode,
} from "../shared/github-remote.ts";

const GH_TIMEOUT_MS = 30_000;
const GH_MAX_BUFFER = 50 * 1024 * 1024;

export type GhExecFn = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

// Windows: el daemon corre detached (sin consola); sin windowsHide cada
// hijo abre una consola nueva (PowerShell). Nunca lanzar ventanas.
const execFileHidden = promisify(execFile);
const defaultExec: GhExecFn = ((file: string, args: string[], opts: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv }) =>
  execFileHidden(file, args, { ...opts, windowsHide: true })) as GhExecFn;

function ghEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.GH_TOKEN && process.env.GITHUB_TOKEN) {
    env.GH_TOKEN = process.env.GITHUB_TOKEN;
  }
  if (!env.GITHUB_TOKEN && process.env.GH_TOKEN) {
    env.GITHUB_TOKEN = process.env.GH_TOKEN;
  }
  return env;
}

async function resolveOwnerRepo(
  cwd: string,
  exec: GhExecFn,
): Promise<
  | { ok: true; owner: string; repo: string }
  | { ok: false; error: string }
> {
  try {
    const { stdout } = await exec("git", ["remote", "get-url", "origin"], {
      cwd,
      timeout: 10_000,
      maxBuffer: GH_MAX_BUFFER,
      env: ghEnv(),
    });
    const ref = parseOwnerRepoFromRemote(stdout);
    if (!ref) {
      return {
        ok: false,
        error: `Could not parse GitHub owner/repo from remote: ${stdout.trim()}`,
      };
    }
    return { ok: true, ...ref };
  } catch {
    return {
      ok: false,
      error: "No git remote 'origin' found. Add a GitHub remote first.",
    };
  }
}

export type LinkedPr = LinkedPrNode;

export async function findPrsForIssue(
  cwd: string,
  issueNumber: number,
  exec: GhExecFn = defaultExec,
): Promise<
  | { ok: true; prs: LinkedPr[]; preferred: LinkedPr | null }
  | { ok: false; error: string }
> {
  const ref = await resolveOwnerRepo(cwd, exec);
  if (!ref.ok) return ref;
  try {
    const { stdout } = await exec(
      "gh",
      [
        "api",
        "graphql",
        "-F",
        `owner=${ref.owner}`,
        "-F",
        `repo=${ref.repo}`,
        "-F",
        `number=${issueNumber}`,
        "-f",
        `query=${buildLinkedPrsQuery()}`,
      ],
      { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER, env: ghEnv() },
    );
    const data = JSON.parse(stdout);
    const graphqlErrors: Array<{ message: string }> = data?.errors ?? [];
    if (graphqlErrors.length > 0) {
      return { ok: false, error: `GitHub GraphQL: ${graphqlErrors[0].message}` };
    }
    const prs = parseLinkedPrNodes(data);
    return { ok: true, prs, preferred: pickPreferredPr(prs) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function getPrReviewDecision(
  cwd: string,
  prNumber: number,
  exec: GhExecFn = defaultExec,
): Promise<ReturnType<typeof foldReviewDecision> & { ok: true } | { ok: false; error: string }> {
  try {
    const { stdout } = await exec("gh", buildReviewDecisionArgs(prNumber), {
      cwd,
      timeout: GH_TIMEOUT_MS,
      maxBuffer: GH_MAX_BUFFER,
      env: ghEnv(),
    });
    return { ok: true, ...foldReviewDecision(JSON.parse(stdout)) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function getPrComments(
  cwd: string,
  prNumber: number,
  exec: GhExecFn = defaultExec,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const { stdout } = await exec(
      "gh",
      ["pr", "view", String(prNumber), "--comments"],
      { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER, env: ghEnv() },
    );
    return { ok: true, text: truncateReviewComments(stdout) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Pure-git conflict check duplicated from the Electron
 * `github:get-conflict-files` handler: fetch main + PR branch, merge
 * --no-commit in a detached throwaway worktree, read unmerged files,
 * best-effort cleanup. Read-only against the repo (no push, no label).
 */
export async function getConflictFiles(
  cwd: string,
  branch: string,
  prNumber: number,
  exec: GhExecFn = defaultExec,
  joinPath: (dir: string, ...parts: string[]) => string = defaultJoinPath,
): Promise<{ ok: true; conflictFiles: string[] } | { ok: false; error: string }> {
  const gitOpts = {
    timeout: GH_TIMEOUT_MS,
    maxBuffer: GH_MAX_BUFFER,
    env: ghEnv(),
  };
  const worktreePath = joinPath(cwd, ".worktrees", `conflict-check-${prNumber}`);
  try {
    await exec("git", ["fetch", "origin", "main"], { cwd, ...gitOpts });
    await exec("git", ["fetch", "origin", `refs/heads/${branch}`], {
      cwd,
      ...gitOpts,
    });
    await exec(
      "git",
      ["worktree", "add", "--detach", worktreePath, `origin/${branch}`],
      { cwd, ...gitOpts },
    );
    let conflictFiles: string[] = [];
    try {
      await exec("git", ["merge", "origin/main", "--no-commit", "--no-ff"], {
        cwd: worktreePath,
        ...gitOpts,
      });
      // Clean merge → the branch already integrates with main.
    } catch {
      // Conflict (expected) or a real failure: the unmerged file list is
      // the ground truth either way.
      const { stdout } = await exec(
        "git",
        ["diff", "--name-only", "--diff-filter=U"],
        { cwd: worktreePath, ...gitOpts },
      );
      conflictFiles = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return { ok: true, conflictFiles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    try {
      await exec("git", ["merge", "--abort"], { cwd: worktreePath, ...gitOpts });
    } catch {
      // No MERGE_HEAD — nothing to abort.
    }
    try {
      await exec("git", ["worktree", "remove", "--force", worktreePath], {
        cwd,
        ...gitOpts,
      });
    } catch {
      // Best-effort cleanup.
    }
  }
}

function defaultJoinPath(dir: string, ...parts: string[]): string {
  return [dir, ...parts].join("/");
}

export type ReviewLabelVerdict =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "REVIEW_REQUIRED"
  | "FIX_APPLIED"
  | null;

async function runGh(
  exec: GhExecFn,
  cwd: string,
  args: string[],
  timeout = GH_TIMEOUT_MS,
): Promise<string> {
  const { stdout } = await exec("gh", args, {
    cwd,
    timeout,
    maxBuffer: GH_MAX_BUFFER,
    env: ghEnv(),
  });
  return stdout;
}

async function ensureLabel(
  exec: GhExecFn,
  cwd: string,
  label: string,
): Promise<void> {
  try {
    await runGh(exec, cwd, buildEnsureLabelArgs(label), 15_000);
  } catch {
    // Already exists — applying below surfaces the real problem if any.
  }
}

async function issueNumberForPr(
  exec: GhExecFn,
  cwd: string,
  prNumber: number,
): Promise<number | null> {
  try {
    const body = await runGh(
      exec,
      cwd,
      ["pr", "view", String(prNumber), "--json", "body", "--jq", ".body"],
      GH_TIMEOUT_MS,
    );
    return parseLinkedIssueNumber(body);
  } catch {
    return null;
  }
}

// Mirror the canonical review-cycle label onto the issue. Best-effort by
// design — the mirror must never break the main flow.
async function syncReviewLabelToIssue(
  exec: GhExecFn,
  cwd: string,
  issueNumber: number,
  canonical: string | null,
): Promise<void> {
  try {
    for (const label of REVIEW_CYCLE_LABELS) {
      await ensureLabel(exec, cwd, label);
    }
    await runGh(
      exec,
      cwd,
      buildSyncIssueLabelArgs(issueNumber, canonical, REVIEW_CYCLE_LABELS),
      15_000,
    );
  } catch (err) {
  }
}

/**
 * Flip the PR label matching a review verdict (duplicated from the
 * Electron `github:apply-review-label` handler). Null verdict = no-op.
 */
export async function applyReviewLabel(
  cwd: string,
  prNumber: number,
  verdict: ReviewLabelVerdict,
  exec: GhExecFn = defaultExec,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const labels = reviewLabelsForVerdict(verdict);
    if (!labels) return { ok: true };
    await ensureLabel(exec, cwd, labels.target);
    await ensureLabel(exec, cwd, labels.other);
    await ensureLabel(exec, cwd, "review:fix-aplicado");
    await ensureLabel(exec, cwd, "review:pendiente");
    await runGh(
      exec,
      cwd,
      [
        "issue", "edit", String(prNumber),
        "--add-label", labels.target,
        "--remove-label", labels.other,
        "--remove-label", "review:fix-aplicado",
        "--remove-label", "review:pendiente",
      ],
      15_000,
    );
    const issueNumber = await issueNumberForPr(exec, cwd, prNumber);
    if (issueNumber !== null) {
      await syncReviewLabelToIssue(exec, cwd, issueNumber, labels.target);
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Apply an exact review-cycle label to a PR and mirror it (duplicated from
 * the Electron `github:apply-cycle-label` handler). Rejects labels outside
 * the cycle without spawning anything.
 */
export async function applyCycleLabel(
  cwd: string,
  prNumber: number,
  issueNumber: number | null,
  label: string,
  exec: GhExecFn = defaultExec,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!(REVIEW_CYCLE_LABELS as readonly string[]).includes(label)) {
      return { ok: false, error: `Label fuera del ciclo de review: ${label}` };
    }
    await ensureLabel(exec, cwd, label);
    await runGh(
      exec,
      cwd,
      buildApplyCycleLabelArgs(prNumber, label, REVIEW_CYCLE_LABELS),
      15_000,
    );
    if (issueNumber !== null) {
      await syncReviewLabelToIssue(exec, cwd, issueNumber, label);
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Mirror the PR's canonical cycle label onto the issue (duplicated from
 * the Electron `github:sync-issue-review-label` handler).
 */
export async function syncIssueReviewLabel(
  cwd: string,
  issueNumber: number,
  prLabels: string[],
  exec: GhExecFn = defaultExec,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await syncReviewLabelToIssue(
      exec,
      cwd,
      issueNumber,
      canonicalReviewLabel(prLabels),
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
