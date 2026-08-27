import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import {
  checkoutGitRef,
  getGitBranches,
  getGitCommitDetail,
  getGitLog,
  initGitRepo,
  isGitRepo,
  resolveBranchCheckoutRef,
} from "../electron/git-info.ts";

async function withTempRepo(
  fn: (repoPath: string, remotePath: string, nonRepoPath: string) => Promise<void> | void,
) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-info-test-"));
  const repoPath = path.join(baseDir, "repo");
  const remotePath = path.join(baseDir, "remote.git");
  const nonRepoPath = path.join(baseDir, "plain");

  fs.mkdirSync(repoPath);
  fs.mkdirSync(nonRepoPath);
  execSync("git init --bare remote.git", {
    cwd: baseDir,
    stdio: "pipe",
  });
  execSync("git init -b main", {
    cwd: repoPath,
    stdio: "pipe",
  });
  execSync('git config user.name "Test User"', {
    cwd: repoPath,
    stdio: "pipe",
  });
  execSync('git config user.email "test@example.com"', {
    cwd: repoPath,
    stdio: "pipe",
  });

  try {
    await fn(repoPath, remotePath, nonRepoPath);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

test("git info lists branches, topo log, commit detail, and supports checkout", async () => {
  await withTempRepo(async (repoPath, remotePath, nonRepoPath) => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "root\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "root commit"', { cwd: repoPath, stdio: "pipe" });
    execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath, stdio: "pipe" });
    execSync("git push -u origin main", { cwd: repoPath, stdio: "pipe" });

    execSync("git checkout -b feature/git-panel", { cwd: repoPath, stdio: "pipe" });
    fs.writeFileSync(path.join(repoPath, "feature.txt"), "feature line\n");
    execSync("git add feature.txt", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "feature branch commit"', { cwd: repoPath, stdio: "pipe" });
    execSync("git push -u origin feature/git-panel", { cwd: repoPath, stdio: "pipe" });

    execSync("git checkout main", { cwd: repoPath, stdio: "pipe" });
    fs.writeFileSync(path.join(repoPath, "README.md"), "root\nmain line\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "main branch commit"', { cwd: repoPath, stdio: "pipe" });
    execSync('git merge --no-ff feature/git-panel -m "merge feature branch"', {
      cwd: repoPath,
      stdio: "pipe",
    });

    assert.equal(await isGitRepo(repoPath), true);
    assert.equal(await isGitRepo(nonRepoPath), false);

    const branches = await getGitBranches(repoPath);
    const currentBranch = branches.find((branch) => branch.name === "main");
    const featureBranch = branches.find((branch) => branch.name === "feature/git-panel");
    const remoteBranch = branches.find((branch) => branch.name === "origin/feature/git-panel");

    assert.ok(currentBranch);
    assert.equal(currentBranch.isCurrent, true);
    assert.equal(currentBranch.isRemote, false);
    assert.equal(currentBranch.upstream, "origin/main");
    assert.equal(currentBranch.ahead > 0, true);
    assert.equal(currentBranch.behind, 0);
    assert.ok(featureBranch);
    assert.equal(featureBranch.isRemote, false);
    assert.ok(remoteBranch);
    assert.equal(remoteBranch.isRemote, true);

    const log = await getGitLog(repoPath, 10);
    assert.equal(log[0]?.message, "merge feature branch");
    assert.equal(log[0]?.parents.length, 2);
    assert.equal(log[0]?.refs.some((ref) => ref.includes("HEAD -> main")), true);

    const detail = await getGitCommitDetail(repoPath, log[0].hash);
    assert.match(detail.message, /merge feature branch/);
    assert.match(detail.diff, /diff --git a\/feature\.txt b\/feature\.txt/);
    assert.equal(
      detail.files.some((file) => file.name === "feature.txt"),
      true,
    );

    await checkoutGitRef(repoPath, "feature/git-panel");
    const switchedBranches = await getGitBranches(repoPath);
    const switchedCurrent = switchedBranches.find(
      (branch) => branch.name === "feature/git-panel",
    );

    assert.ok(switchedCurrent);
    assert.equal(switchedCurrent.isCurrent, true);
  });
});

test("initGitRepo turns a plain directory into a repository", async () => {
  await withTempRepo(async (_repoPath, _remotePath, nonRepoPath) => {
    assert.equal(await isGitRepo(nonRepoPath), false);

    await initGitRepo(nonRepoPath);

    assert.equal(await isGitRepo(nonRepoPath), true);
    const branches = await getGitBranches(nonRepoPath);
    assert.equal(branches.some((branch) => branch.name === "main"), true);
  });
});

test("getGitCommitDetail returns null for a missing commit hash", async () => {
  await withTempRepo(async (repoPath) => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "root\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "root commit"', { cwd: repoPath, stdio: "pipe" });

    const detail = await getGitCommitDetail(
      repoPath,
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    );

    assert.equal(detail, null);
  });
});

function shaOf(repoPath: string, ref: string): string {
  return execSync(`git rev-parse ${ref}`, {
    cwd: repoPath,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString().trim();
}

test("resolveBranchCheckoutRef heals a PR head that only exists on origin", async () => {
  await withTempRepo(async (repoPath, remotePath) => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "root\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "root commit"', { cwd: repoPath, stdio: "pipe" });
    execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath, stdio: "pipe" });
    execSync("git push -u origin main", { cwd: repoPath, stdio: "pipe" });

    // The PR branch was pushed from another machine: it exists on origin
    // only and this clone never fetched it — the state that used to make
    // `git worktree add --detach` die with "fatal: invalid reference".
    execSync(
      "git push origin main:refs/heads/refactor/knip-dead-code-44",
      { cwd: repoPath, stdio: "pipe" },
    );

    const resolved = await resolveBranchCheckoutRef(
      repoPath,
      "refactor/knip-dead-code-44",
    );

    if (!resolved.ok) {
      assert.fail(`expected the origin-only PR head to resolve: ${resolved.error}`);
    }
    assert.equal(resolved.ref, "origin/refactor/knip-dead-code-44");
    assert.equal(resolved.source, "origin");
    assert.equal(resolved.hasLocal, false);

    // The resolved ref must materialize the detached review worktree.
    const reviewPath = path.join(
      repoPath,
      ".worktrees",
      "knip-review",
    );
    execSync(
      `git worktree add --detach "${reviewPath}" ${resolved.ref}`,
      { cwd: repoPath, stdio: "pipe" },
    );
    assert.equal(shaOf(reviewPath, "HEAD"), shaOf(repoPath, "main"));
  });
});

test("resolveBranchCheckoutRef refreshes a stale origin ref before resolving", async () => {
  await withTempRepo(async (repoPath, remotePath) => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "v1\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "v1"', { cwd: repoPath, stdio: "pipe" });
    execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath, stdio: "pipe" });
    execSync("git push -u origin main", { cwd: repoPath, stdio: "pipe" });
    execSync("git push origin main:refs/heads/pr-branch", { cwd: repoPath, stdio: "pipe" });
    execSync("git fetch origin", { cwd: repoPath, stdio: "pipe" });

    // The PR advances on GitHub while this clone stays behind: its
    // refs/remotes/origin/pr-branch is now stale.
    fs.writeFileSync(path.join(repoPath, "README.md"), "v1\nv2\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "v2"', { cwd: repoPath, stdio: "pipe" });
    execSync("git push origin main:refs/heads/pr-branch", { cwd: repoPath, stdio: "pipe" });

    const resolved = await resolveBranchCheckoutRef(repoPath, "pr-branch");

    if (!resolved.ok) {
      assert.fail(`expected the stale ref to resolve: ${resolved.error}`);
    }
    assert.equal(resolved.source, "origin");
    assert.equal(
      shaOf(repoPath, resolved.ref),
      shaOf(repoPath, "main"),
      "the internal fetch must update the stale remote-tracking ref",
    );
  });
});

test("resolveBranchCheckoutRef falls back to the local branch without a usable origin", async () => {
  await withTempRepo(async (repoPath) => {
    // No `origin` remote at all: the fetch inside the resolver fails and the
    // local branch must still be returned so offline reviews keep working.
    fs.writeFileSync(path.join(repoPath, "README.md"), "root\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "root commit"', { cwd: repoPath, stdio: "pipe" });
    execSync("git branch feature/offline", { cwd: repoPath, stdio: "pipe" });

    const resolved = await resolveBranchCheckoutRef(repoPath, "feature/offline");

    if (!resolved.ok) {
      assert.fail(`expected the local branch to resolve: ${resolved.error}`);
    }
    assert.equal(resolved.ref, "feature/offline");
    assert.equal(resolved.source, "local");
  });
});

test("resolveBranchCheckoutRef flags an existing local branch so restore attaches instead of -b", async () => {
  await withTempRepo(async (repoPath, remotePath) => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "root\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "root commit"', { cwd: repoPath, stdio: "pipe" });
    execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath, stdio: "pipe" });
    execSync("git push -u origin main", { cwd: repoPath, stdio: "pipe" });

    // The implementer branch exists BOTH locally (its worktree was deleted,
    // leaving an orphaned branch) and on origin — the state that made
    // `worktree add -b` die with "fatal: a branch named ... already exists".
    execSync("git branch pr-branch", { cwd: repoPath, stdio: "pipe" });
    execSync("git push origin pr-branch", { cwd: repoPath, stdio: "pipe" });

    const resolved = await resolveBranchCheckoutRef(repoPath, "pr-branch");

    if (!resolved.ok) {
      assert.fail(`expected the orphaned local branch to resolve: ${resolved.error}`);
    }
    assert.equal(resolved.hasLocal, true);

    // The restore path must attach the existing branch — the exact command
    // that used to be skipped in favor of the crashing `-b` variant.
    const wtPath = path.join(repoPath, ".worktrees", "pr-branch");
    execSync(`git worktree add "${wtPath}" pr-branch`, { cwd: repoPath, stdio: "pipe" });
    assert.equal(shaOf(wtPath, "HEAD"), shaOf(repoPath, "pr-branch"));
  });
});

test("resolveBranchCheckoutRef reports a clear error for an unreachable ref", async () => {
  await withTempRepo(async (repoPath, remotePath) => {
    fs.writeFileSync(path.join(repoPath, "README.md"), "root\n");
    execSync("git add README.md", { cwd: repoPath, stdio: "pipe" });
    execSync('git commit -m "root commit"', { cwd: repoPath, stdio: "pipe" });
    execSync(`git remote add origin "${remotePath}"`, { cwd: repoPath, stdio: "pipe" });

    const resolved = await resolveBranchCheckoutRef(repoPath, "ghost/branch");

    assert.equal(resolved.ok, false);
    if (!resolved.ok) {
      assert.match(
        resolved.error,
        /Branch "ghost\/branch" not found locally or on origin/,
      );
    }
  });
});
