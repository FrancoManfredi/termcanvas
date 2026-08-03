import test from "node:test";
import assert from "node:assert/strict";
import { resolveIssueWorktree } from "../src/canvas/resolveIssueWorktree.ts";

function makeIssue(overrides: Partial<{
  issueNumber: number;
  title: string;
  body: string;
  url: string;
  labels: { name: string }[];
  issueId: string;
  projectId: string;
  worktreeId: string;
  x: number;
  y: number;
}> = {}) {
  return {
    issueId: "gh-p1-42",
    projectId: "p1",
    worktreeId: "w1",
    issueNumber: 42,
    title: "Fix login bug",
    body: "",
    url: "https://github.com/test/test/issues/42",
    labels: [],
    x: 100,
    y: 200,
    ...overrides,
  };
}

function makeTarget() {
  return {
    projectId: "p1",
    worktreeId: "w1",
    worktree: { path: "/repo" },
  };
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    path: "/repo",
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
    ],
    ...overrides,
  };
}

test("resolveIssueWorktree: happy path creates worktree and terminal", async () => {
  const createWorktreeCalls: string[] = [];
  const syncCalls: Array<{ path: string; branch: string }> = [];
  const terminalCalls: Array<{ worktreeId: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const arrows: Array<{ issueId: string; terminalId: string }> = [];

  const project = makeProject();
  const projectLookup = { projects: [project] };

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async (repoPath, branch) => {
      createWorktreeCalls.push(branch);
      return {
        ok: true,
        path: "/repo/issue-42-fix-login-bug",
        worktrees: [
          { path: "/repo", branch: "main", isPrimary: true },
          { path: "/repo/issue-42-fix-login-bug", branch: "issue-42-fix-login-bug", isPrimary: false },
        ],
      };
    },
    projectLookup,
    syncWorktrees: (_path, worktrees) => {
      for (const wt of worktrees) {
        syncCalls.push(wt);
      }
      // Simulate store mutation: add new worktree to project
      project.worktrees = [
        { id: "w1", name: "main", path: "/repo" },
        { id: "w2", name: "issue-42-fix-login-bug", path: "/repo/issue-42-fix-login-bug" },
      ];
    },
    createTerminal: (opts) => {
      terminalCalls.push({ worktreeId: opts.worktreeId });
      return { id: "term-1" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    setResolveArrows: (fn) => {
      const next = fn(arrows);
      arrows.length = 0;
      arrows.push(...(next as typeof arrows));
    },
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
  });

  assert.equal(result.ok, true);
  assert.equal(createWorktreeCalls.length, 1);
  assert.equal(createWorktreeCalls[0], "issue-42-fix-login-bug");
  assert.equal(terminalCalls.length, 1);
  assert.equal(terminalCalls[0].worktreeId, "w2");
  assert.equal(notifications.length, 0);
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].issueId, "issue-42");
  assert.equal(arrows[0].terminalId, "term-1");
});

test("resolveIssueWorktree: reuse existing worktree skips createWorktree", async () => {
  const createWorktreeCalls: string[] = [];
  const terminalCalls: Array<{ worktreeId: string }> = [];

  const project = makeProject({
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
      { id: "w-existing", name: "issue-42-fix-login-bug", path: "/repo/issue-42-fix-login-bug" },
    ],
  });

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async (_repoPath, branch) => {
      createWorktreeCalls.push(branch);
      return { ok: true, path: "/repo", worktrees: [] };
    },
    projectLookup: { projects: [project] },
    syncWorktrees: () => {},
    createTerminal: (opts) => {
      terminalCalls.push({ worktreeId: opts.worktreeId });
      return { id: "term-2" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
  });

  assert.equal(result.ok, true);
  assert.equal(createWorktreeCalls.length, 0, "should NOT call createWorktree");
  assert.equal(terminalCalls.length, 1);
  assert.equal(terminalCalls[0].worktreeId, "w-existing");
});

test("resolveIssueWorktree: failure toasts and aborts, no terminal created", async () => {
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async () => ({
      ok: false,
      error: "branch already exists at different path",
    }),
    projectLookup: { projects: [makeProject()] },
    syncWorktrees: () => {},
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "term-should-not-exist" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
  });

  assert.equal(result.ok, false);
  assert.equal(terminalCalls.length, 0, "should NOT create terminal on failure");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "error");
  assert.ok(
    notifications[0].message.includes("branch already exists"),
    "error message should include the cause",
  );
});

test("resolveIssueWorktree: terminal receives new worktreeId, not fallback", async () => {
  const terminalCalls: Array<{ worktreeId: string; projectId: string }> = [];

  const project = makeProject();
  const projectLookup = { projects: [project] };

  await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async () => ({
      ok: true,
      path: "/repo/issue-42-fix-login-bug",
      worktrees: [
        { path: "/repo", branch: "main", isPrimary: true },
        { path: "/repo/issue-42-fix-login-bug", branch: "issue-42-fix-login-bug", isPrimary: false },
      ],
    }),
    projectLookup,
    syncWorktrees: () => {
      project.worktrees = [
        { id: "w1", name: "main", path: "/repo" },
        { id: "w-new", name: "issue-42-fix-login-bug", path: "/repo/issue-42-fix-login-bug" },
      ];
    },
    createTerminal: (opts) => {
      terminalCalls.push({ worktreeId: opts.worktreeId, projectId: opts.projectId });
      return { id: "term-3" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
  });

  assert.equal(terminalCalls.length, 1);
  assert.equal(terminalCalls[0].worktreeId, "w-new", "terminal should get the NEW worktree ID");
  assert.equal(terminalCalls[0].projectId, "p1");
});

test("resolveIssueWorktree: missing issue returns error", async () => {
  const result = await resolveIssueWorktree({
    issue: undefined,
    target: makeTarget(),
    createWorktree: async () => ({ ok: true, path: "/repo", worktrees: [] }),
    projectLookup: { projects: [makeProject()] },
    syncWorktrees: () => {},
    createTerminal: () => ({ id: "x" }),
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
    initialPrompt: "",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Issue not found");
});

test("resolveIssueWorktree: createWorktree exception is caught and toasted", async () => {
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async () => {
      throw new Error("git fatal: not a git repository");
    },
    projectLookup: { projects: [makeProject()] },
    syncWorktrees: () => {},
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
    initialPrompt: "",
  });

  assert.equal(result.ok, false);
  assert.equal(terminalCalls.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "error");
  assert.ok(notifications[0].message.includes("not a git repository"));
});
