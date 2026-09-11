import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ProjectScanner } from "../electron/project-scanner.ts";
import { resolveBranchCheckoutRef } from "../electron/git-info.ts";
import {
  buildGitWorktreeAddArgs,
  buildGitWorktreeRemoveArgs,
  resolveMainRepoRoot,
  validateWorktreePath,
} from "./worktree-helpers.ts";
import type { ProjectStore } from "./project-store.ts";
import { ensureProjectTracked } from "./project-sync.ts";

export interface WorktreeInfo {
  path: string;
  branch: string;
  isPrimary: boolean;
}

export interface WorktreeControl {
  list(repoPath: string): WorktreeInfo[];
  create(input: {
    repoPath: string;
    branch: string;
    worktreePath?: string;
    baseBranch?: string;
  }): {
    path: string;
    branch: string;
    base_branch: string;
    worktrees: WorktreeInfo[];
  };
  remove(input: {
    repoPath: string;
    worktreePath: string;
    force?: boolean;
  }): {
    ok: true;
    path: string;
    worktrees: WorktreeInfo[];
  };
  createReview(input: {
    repoPath: string;
    baseName: string;
    branch: string;
  }): Promise<{
    path: string;
    worktrees: WorktreeInfo[];
  }>;
  restore(input: {
    repoPath: string;
    branch: string;
  }): Promise<{
    path: string;
    worktrees: WorktreeInfo[];
  }>;
}

function getCurrentBranch(repoPath: string): string {
  try {
    // Windows: sin windowsHide cada git abre una consola (PowerShell).
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "main";
  }
}

function defaultWorktreePath(mainRoot: string, branch: string): string {
  // Always create under the MAIN repo's .worktrees. repoPath may be a
  // linked worktree; nesting a worktree inside it blows Windows' MAX_PATH
  // (260 chars) on long file names.
  return path.join(
    mainRoot,
    ".worktrees",
    branch.replace(/[\\/]/g, "-"),
  );
}

export function createWorktreeControl(input: {
  projectStore: ProjectStore;
  projectScanner: ProjectScanner;
  onMutation?: () => void;
}): WorktreeControl {
  return {
    list(repoPath) {
      const repo = path.resolve(repoPath);
      return input.projectScanner.listWorktrees(repo);
    },
    create({ repoPath, branch, worktreePath, baseBranch }) {
      const repo = path.resolve(repoPath);
      const mainRoot = resolveMainRepoRoot(repo);
      const resolvedWorktree = validateWorktreePath(
        mainRoot,
        worktreePath ? path.resolve(worktreePath) : defaultWorktreePath(mainRoot, branch),
      );
      const base = baseBranch?.trim() || getCurrentBranch(repo);
      execFileSync("git", buildGitWorktreeAddArgs(branch, resolvedWorktree, base), {
        cwd: repo,
        encoding: "utf-8",
        windowsHide: true,
      });

      const tracked = ensureProjectTracked({
        projectStore: input.projectStore,
        projectScanner: input.projectScanner,
        repoPath: repo,
        onMutation: input.onMutation,
      });

      return {
        path: resolvedWorktree,
        branch,
        base_branch: base,
        worktrees: tracked.project.worktrees.map((worktree) => ({
          path: worktree.path,
          branch: worktree.name,
          isPrimary: worktree.path === tracked.project.path,
        })),
      };
    },
    remove({ repoPath, worktreePath, force }) {
      const repo = path.resolve(repoPath);
      const resolvedWorktree = validateWorktreePath(repo, worktreePath);
      const args = force
        ? buildGitWorktreeRemoveArgs(resolvedWorktree)
        : ["worktree", "remove", resolvedWorktree];
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf-8",
        windowsHide: true,
      });

      const tracked = ensureProjectTracked({
        projectStore: input.projectStore,
        projectScanner: input.projectScanner,
        repoPath: repo,
        onMutation: input.onMutation,
      });

      return {
        ok: true,
        path: resolvedWorktree,
        worktrees: tracked.project.worktrees.map((worktree) => ({
          path: worktree.path,
          branch: worktree.name,
          isPrimary: worktree.path === tracked.project.path,
        })),
      };
    },

    // Detached review copy duplicated from the Electron
    // `project:create-review-worktree` handler: orphan cleanup, ref
    // resolution (fetch from origin when needed), detached checkout,
    // review-source-branch marker. The PR branch stays bound to the
    // implementer's worktree — the reviewer never creates branches.
    async createReview({ repoPath, baseName, branch }) {
      const trimmedBase = (baseName ?? "").trim();
      if (!trimmedBase) {
        throw Object.assign(new Error("Worktree base name is required"), {
          status: 400,
        });
      }
      if (/[\\/:*?"<>|]/.test(trimmedBase)) {
        throw Object.assign(new Error("Invalid worktree base name"), {
          status: 400,
        });
      }
      const trimmedBranch = (branch ?? "").trim();
      if (!trimmedBranch) {
        throw Object.assign(new Error("Branch name is required"), {
          status: 400,
        });
      }
      if (
        /[\s~^:?*\[\]\\]/.test(trimmedBranch) ||
        trimmedBranch.startsWith("-")
      ) {
        throw Object.assign(new Error("Invalid branch name"), {
          status: 400,
        });
      }

      const repo = path.resolve(repoPath);
      const repoRoot = resolveMainRepoRoot(repo);
      const sanitizedDirName = trimmedBase.replace(/[\\/]/g, "-");
      const worktreePath = path.join(
        repoRoot,
        ".worktrees",
        `${sanitizedDirName}-review`,
      );

      // Self-heal ORPHANED review directories (killed sessions can leave
      // the directory while git no longer registers it). Registered
      // worktrees (a live review) are never touched here.
      try {
        const registeredOut = execFileSync(
          "git",
          ["worktree", "list", "--porcelain"],
          { cwd: repo, encoding: "utf-8", windowsHide: true },
        );
        const registered = new Set(
          registeredOut
            .split(/\r?\n/)
            .filter((line) => line.startsWith("worktree "))
            .map((line) => path.resolve(line.slice("worktree ".length))),
        );
        if (
          fs.existsSync(worktreePath) &&
          !registered.has(path.resolve(worktreePath))
        ) {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
      } catch {
        // Listing failed; the create below surfaces the error.
      }

      const resolved = await resolveBranchCheckoutRef(repo, trimmedBranch);
      if (!resolved.ok) {
        throw Object.assign(new Error(resolved.error), { status: 400 });
      }
      try {
        execFileSync(
          "git",
          ["worktree", "add", "--detach", worktreePath, resolved.ref],
          { cwd: repo, encoding: "utf-8", windowsHide: true },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw Object.assign(new Error(message), { status: 400 });
      }
      try {
        const adminDir = path.join(
          repoRoot,
          ".git",
          "worktrees",
          path.basename(worktreePath),
        );
        fs.mkdirSync(adminDir, { recursive: true });
        fs.writeFileSync(
          path.join(adminDir, "review-source-branch"),
          trimmedBranch,
          "utf-8",
        );
      } catch {
        // Cosmetic only — the review worktree still works without it.
      }

      const tracked = ensureProjectTracked({
        projectStore: input.projectStore,
        projectScanner: input.projectScanner,
        repoPath: repo,
        onMutation: input.onMutation,
      });
      return {
        path: worktreePath,
        worktrees: tracked.project.worktrees.map((worktree) => ({
          path: worktree.path,
          branch: worktree.name,
          isPrimary: worktree.path === tracked.project.path,
        })),
      };
    },

    // Re-create a worktree for a branch whose checkout no longer exists,
    // duplicated from the Electron `project:restore-worktree` handler: the
    // branch must already exist (locally or on origin) because this restores
    // the PR head ref instead of creating a fresh branch.
    async restore({ repoPath, branch }) {
      const trimmedBranch = (branch ?? "").trim();
      if (!trimmedBranch) {
        throw Object.assign(new Error("Branch name is required"), {
          status: 400,
        });
      }
      if (
        /[\s~^:?*\[\\]/.test(trimmedBranch) ||
        trimmedBranch.startsWith("-")
      ) {
        throw Object.assign(new Error("Invalid branch name"), {
          status: 400,
        });
      }

      const repo = path.resolve(repoPath);
      const repoRoot = resolveMainRepoRoot(repo);
      const worktreePath = path.join(
        repoRoot,
        ".worktrees",
        trimmedBranch.replace(/[\\/]/g, "-"),
      );

      const resolved = await resolveBranchCheckoutRef(repo, trimmedBranch);
      if (!resolved.ok) {
        throw Object.assign(new Error(resolved.error), { status: 400 });
      }
      try {
        if (resolved.hasLocal) {
          execFileSync("git", ["worktree", "add", worktreePath, trimmedBranch], {
            cwd: repo,
            encoding: "utf-8",
            windowsHide: true,
          });
        } else {
          execFileSync(
            "git",
            ["worktree", "add", "-b", trimmedBranch, worktreePath, `origin/${trimmedBranch}`],
            { cwd: repo, encoding: "utf-8", windowsHide: true },
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw Object.assign(new Error(message), { status: 400 });
      }

      const tracked = ensureProjectTracked({
        projectStore: input.projectStore,
        projectScanner: input.projectScanner,
        repoPath: repo,
        onMutation: input.onMutation,
      });
      return {
        path: worktreePath,
        worktrees: tracked.project.worktrees.map((worktree) => ({
          path: worktree.path,
          branch: worktree.name,
          isPrimary: worktree.path === tracked.project.path,
        })),
      };
    },
  };
}
