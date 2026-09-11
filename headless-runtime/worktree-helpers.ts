import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Local worktree helpers — independent copy for headless-runtime.
 * Previously shared via separate package, now duplicated here so
 * headless-runtime is self-contained.
 */

export function resolveMainRepoRoot(repoPath: string): string {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { windowsHide: true,
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (commonDir) {
      return path.dirname(path.resolve(repoPath, commonDir));
    }
  } catch {
    // Not a git repo — nothing to anchor to.
  }
  return path.resolve(repoPath);
}

export function buildGitWorktreeRemoveArgs(worktreePath: string): string[] {
  return ["worktree", "remove", worktreePath, "--force"];
}

export function buildGitWorktreeAddArgs(
  branch: string,
  worktreePath: string,
  baseBranch: string,
): string[] {
  return ["worktree", "add", "-b", branch, worktreePath, baseBranch];
}

export function validateWorktreePath(repoPath: string, worktreePath: string): string {
  const resolvedRepo = path.resolve(repoPath);
  const resolvedWorktree = path.resolve(worktreePath);
  const relative = path.relative(resolvedRepo, resolvedWorktree);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Worktree must be inside the repo: ${resolvedWorktree} is not under ${resolvedRepo}`,
    );
  }

  return resolvedWorktree;
}
