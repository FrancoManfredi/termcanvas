/**
 * Aislamiento por worktree (Fase 7a).
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWorkflow, type LoadedWorkflow } from "../headless-runtime/workflows/executor.ts";
import { parseWorkflowDefinition } from "../headless-runtime/workflows/loader.ts";

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} falló: ${result.stderr}`);
  }
}

function loaded(yaml: string, dir: string): LoadedWorkflow {
  const sourcePath = path.join(dir, "workflow.yaml");
  fs.writeFileSync(sourcePath, yaml, "utf-8");
  return {
    def: parseWorkflowDefinition(yaml, sourcePath),
    source: yaml,
    sourcePath,
    digest: crypto.createHash("sha256").update(yaml).digest("hex"),
    dir,
  };
}

const writeYaml = `name: wt
description: worktree
nodes:
  - id: write
    bash: |
      node -e "require('fs').writeFileSync('changed.txt','x')"
`;

test("isolation worktree: los nodos corren en el worktree y el repo queda limpio", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "wf-wt-"));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "test@test.com"]);
  git(repo, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(repo, "README.md"), "hola\n", "utf-8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);

  const runsDir = path.join(repo, ".agents", "factory", "workflow-runs");
  const run = await runWorkflow(loaded(writeYaml, repo), {
    cwd: repo,
    runsDir,
    repoRoot: repo,
    isolation: "worktree",
  });
  assert.equal(run.status, "completed");
  assert.ok(run.worktree, "el run debe registrar el worktree");
  assert.ok(fs.existsSync(path.join(run.worktree!.path, "changed.txt")));
  assert.equal(fs.existsSync(path.join(repo, "changed.txt")), false);
  assert.match(run.worktree!.branch, /^wf\//);
  git(repo, ["worktree", "remove", "--force", run.worktree!.path]);
});

test("isolation worktree: repo no-git falla con mensaje claro", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-wt-nogit-"));
  await assert.rejects(
    runWorkflow(loaded(writeYaml, tmp), {
      cwd: tmp,
      runsDir: path.join(tmp, "runs"),
      repoRoot: tmp,
      isolation: "worktree",
    }),
    /no es un repo git/,
  );
});
