import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Resolve the MAIN repository root for a path inside a git repo — the primary
 * checkout OR a linked worktree.
 *
 * `git rev-parse --git-common-dir` returns the main repo's git dir even when
 * run from a linked worktree (linked worktrees live at
 * <main>/.git/worktrees/<name>). Worker worktrees must always be created
 * under <mainRepo>/.worktrees: joining a linked worktree path with
 * `.worktrees` nests worktrees inside each other and blows Windows' MAX_PATH
 * (260 chars) on long file names.
 *
 * Falls back to the input path when git fails (not a repo yet); the caller's
 * own git operations surface the real error afterwards.
 */
export function resolveMainRepoRoot(repoPath: string): string {
  try {
    const commonDir = execFileSync(
      "git",
      ["rev-parse", "--git-common-dir"],
      {
        cwd: repoPath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (commonDir) {
      // git prints the common dir relative to cwd; resolve against the
      // input path so both relative (".git") and absolute ("C:/repo/.git")
      // outputs land on the same anchor. <main>/.git -> <main>.
      return path.dirname(path.resolve(repoPath, commonDir));
    }
  } catch {
    // Not a git repo — nothing to anchor to.
  }
  return path.resolve(repoPath);
}
