/**
 * Aislamiento por worktree para runs de workflow (Fase 7a).
 * Crea `<repo>/.worktrees/wf-<runId>` con branch `wf/<runId>` y devuelve el
 * path efectivo donde corren los nodos. Si el repo no es git, falla claro.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface WorkflowWorktree {
  path: string;
  branch: string;
}

export function isGitRepo(repoRoot: string): boolean {
  try {
    const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: repoRoot,
      encoding: "utf-8",
      windowsHide: true,
    });
    return result.status === 0 && String(result.stdout).trim() === "true";
  } catch {
    return false;
  }
}

export function prepareWorkflowWorktree(opts: {
  repoRoot: string;
  runId: string;
  baseBranch?: string;
}): WorkflowWorktree {
  if (!isGitRepo(opts.repoRoot)) {
    throw new Error(
      `isolation worktree: "${opts.repoRoot}" no es un repo git`,
    );
  }
  const worktreesDir = path.join(opts.repoRoot, ".worktrees");
  const target = path.join(worktreesDir, `wf-${opts.runId}`);
  const branch = `wf/${opts.runId}`;
  fs.mkdirSync(worktreesDir, { recursive: true });
  const args = ["worktree", "add", "-b", branch, target];
  if (opts.baseBranch && opts.baseBranch.trim().length > 0) {
    args.push(opts.baseBranch.trim());
  }
  const result = spawnSync("git", args, {
    cwd: opts.repoRoot,
    encoding: "utf-8",
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`git worktree add falló: ${output.slice(0, 300)}`);
  }
  return { path: target, branch };
}
