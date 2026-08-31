import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ProjectScanner } from "../electron/project-scanner.ts";
import {
  createWorkspaceFixture,
  startHeadlessServer,
  stopHeadlessServer,
} from "./headless-runtime-test-helpers.ts";

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    body: await response.json(),
  };
}

function initRepo(repoPath: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repoPath,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "TermCanvas Test"], {
    cwd: repoPath,
    stdio: "pipe",
  });
  fs.writeFileSync(path.join(repoPath, "README.md"), "hello\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath, stdio: "pipe" });
}

test("worktree routes create, list, and remove git worktrees while syncing project state", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const harness = await startHeadlessServer({
    workspaceDir,
    projectScanner: new ProjectScanner(),
  });

  try {
    const created = await fetchJson(`${harness.baseUrl}/worktree/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: repoPath,
        branch: "feature/cloud",
      }),
    });

    assert.equal(created.status, 200);
    assert.ok(fs.existsSync(created.body.path));
    assert.equal(created.body.branch, "feature/cloud");
    assert.equal(harness.projectStore.getProjects().length, 1);
    assert.equal(harness.projectStore.getProjects()[0].worktrees.length, 2);

    const listed = await fetchJson(
      `${harness.baseUrl}/worktree/list?repo=${encodeURIComponent(repoPath)}`,
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 2);
    assert.equal(
      listed.body.some((worktree: { branch: string }) => worktree.branch === "feature/cloud"),
      true,
    );

    const removed = await fetchJson(
      `${harness.baseUrl}/worktree?repo=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(created.body.path)}&force=true`,
      {
        method: "DELETE",
      },
    );
    assert.equal(removed.status, 200);
    assert.equal(removed.body.ok, true);
    assert.equal(fs.existsSync(created.body.path), false);
    assert.equal(harness.projectStore.getProjects()[0].worktrees.length, 1);
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("creating a worktree from a linked worktree lands in the main repo, not nested", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const harness = await startHeadlessServer({
    workspaceDir,
    projectScanner: new ProjectScanner(),
  });

  try {
    // First worktree: created with the main repo as target.
    const first = await fetchJson(`${harness.baseUrl}/worktree/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoPath, branch: "feature/one" }),
    });
    assert.equal(first.status, 200);
    const firstPath = first.body.path as string;
    assert.ok(fs.existsSync(firstPath));
    assert.ok(path.dirname(firstPath).endsWith(".worktrees"));

    // Second worktree: the caller passes the LINKED worktree as the repo
    // (a focused issue worktree). The new worktree must be created under
    // the main repo's .worktrees, never inside the linked worktree.
    const second = await fetchJson(`${harness.baseUrl}/worktree/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: firstPath, branch: "feature/two" }),
    });
    assert.equal(second.status, 200);
    const secondPath = second.body.path as string;
    assert.ok(fs.existsSync(secondPath));
    // Windows may resolve the same directory via its 8.3 short alias
    // (ESTUDI~1) in one path and the long form in another, so compare the
    // physical directory identity instead of strings. Both parents being
    // the same directory proves the second worktree landed in the main
    // repo's .worktrees AND was not nested inside the first worktree.
    const secondParent = path.dirname(secondPath);
    const firstParent = path.dirname(firstPath);
    assert.equal(
      fs.statSync(secondParent).ino,
      fs.statSync(firstParent).ino,
      `expected second worktree under the main repo's .worktrees (${firstParent}), got ${secondPath}`,
    );

    // Both worktrees are visible to the main repo's listing.
    const listed = await fetchJson(
      `${harness.baseUrl}/worktree/list?repo=${encodeURIComponent(repoPath)}`,
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 3);
  } finally {
    await stopHeadlessServer(harness);
  }
});
