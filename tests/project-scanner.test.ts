import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { ProjectScanner } from "../electron/project-scanner.ts";

test("listChildGitRepos returns direct child repositories only", async () => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "termcanvas-project-scanner-"));
  const scanner = new ProjectScanner();

  try {
    const frontendDir = path.join(rootDir, "frontend");
    const backendDir = path.join(rootDir, "backend");
    const docsDir = path.join(rootDir, "docs");
    const nestedDir = path.join(docsDir, "nested-repo");

    mkdirSync(frontendDir);
    mkdirSync(backendDir);
    mkdirSync(docsDir);
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(path.join(rootDir, ".hidden-repo"));
    mkdirSync(path.join(rootDir, "node_modules"));

    execFileSync("git", ["init"], { cwd: frontendDir, stdio: "ignore" });
    execFileSync("git", ["init"], { cwd: backendDir, stdio: "ignore" });
    execFileSync("git", ["init"], { cwd: nestedDir, stdio: "ignore" });
    execFileSync("git", ["init"], {
      cwd: path.join(rootDir, ".hidden-repo"),
      stdio: "ignore",
    });
    writeFileSync(path.join(rootDir, "README.md"), "root");

    const repos = scanner.listChildGitRepos(rootDir);

    assert.deepEqual(repos, [
      { name: "backend", path: backendDir },
      { name: "frontend", path: frontendDir },
    ]);
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
});

test("listWorktrees labels review worktrees as '<source> (review)' instead of '(detached)'", async () => {
  const repoDir = mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-review-marker-"),
  );

  try {
    writeFileSync(path.join(repoDir, "a.txt"), "hello");
    execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "ignore" });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
      { cwd: repoDir, stdio: "ignore" },
    );
    execFileSync(
      "git", ["branch", "issue-42-fix-login-bug"],
      { cwd: repoDir, stdio: "ignore" },
    );

    const reviewPath = path.join(
      repoDir, ".worktrees", "issue-42-fix-login-bug-review",
    );
    execFileSync(
      "git",
      ["worktree", "add", "--detach", reviewPath, "issue-42-fix-login-bug"],
      { cwd: repoDir, stdio: "ignore" },
    );
    // The create-review-worktree handler writes this marker file.
    const adminDir = path.join(
      repoDir, ".git", "worktrees", path.basename(reviewPath),
    );
    mkdirSync(adminDir, { recursive: true });
    writeFileSync(
      path.join(adminDir, "review-source-branch"),
      "issue-42-fix-login-bug",
      "utf-8",
    );

    const worktrees = new ProjectScanner().listWorktrees(repoDir);
    const review = worktrees.find((w) =>
      w.path.includes("issue-42-fix-login-bug-review"),
    );
    assert.ok(review, "review worktree must be listed");
    assert.equal(review.branch, "issue-42-fix-login-bug (review)");
    assert.equal(review.isPrimary, false);
  } finally {
    await rm(repoDir, { force: true, recursive: true });
  }
});
