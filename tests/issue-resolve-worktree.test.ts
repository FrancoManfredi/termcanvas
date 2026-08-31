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
  const terminalCalls: Array<{ worktreeId: string; issueNumber?: number }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const arrows: Array<{ issueId: string; terminalId: string }> = [];

  const project = makeProject();
  const getProject = () => project;

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
    getProject,
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
      terminalCalls.push({ worktreeId: opts.worktreeId, issueNumber: opts.issueNumber });
      return { id: "term-1" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    setResolveArrows: (fn) => {
      const next = typeof fn === "function" ? fn(arrows) : fn;
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
  assert.equal(terminalCalls[0].issueNumber, 42, "terminal should carry issueNumber metadata");
  assert.equal(result.case, "created");
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
    getProject: () => project,
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
    getProject: () => makeProject(),
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
  const getProject = () => project;

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
    getProject,
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

test("resolveIssueWorktree: CASE C matches new worktree despite Windows path separator mismatch", async () => {
  const terminalCalls: Array<{ worktreeId: string }> = [];

  // git reports paths with forward slashes (C:/...), but the renderer builds
  // the expected path with path.join (C:\...). Both must resolve to the same
  // worktree so the terminal is created on the FIRST resolve click.
  const project = makeProject();
  const getProject = () => project;

  await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async () => ({
      ok: true,
      path: "C:\\repo\\issue-42-fix-login-bug",
      worktrees: [
        { path: "C:/repo", branch: "main", isPrimary: true },
        { path: "C:/repo/issue-42-fix-login-bug", branch: "issue-42-fix-login-bug", isPrimary: false },
      ],
    }),
    getProject,
    syncWorktrees: () => {
      project.worktrees = [
        { id: "w1", name: "main", path: "C:\\repo" },
        { id: "w-win", name: "issue-42-fix-login-bug", path: "C:/repo/issue-42-fix-login-bug" },
      ];
    },
    createTerminal: (opts) => {
      terminalCalls.push({ worktreeId: opts.worktreeId });
      return { id: "term-win" };
    },
    notify: (type, message) => {
      throw new Error(`unexpected notification: ${type} ${message}`);
    },
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
  });

  assert.equal(terminalCalls.length, 1, "terminal MUST be created on first resolve");
  assert.equal(terminalCalls[0].worktreeId, "w-win");
});

test("resolveIssueWorktree: missing issue returns error", async () => {
  const result = await resolveIssueWorktree({
    issue: undefined,
    target: makeTarget(),
    createWorktree: async () => ({ ok: true, path: "/repo", worktrees: [] }),
    getProject: () => makeProject(),
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
    getProject: () => makeProject(),
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

test("resolveIssueWorktree: CASE B reuses live opencode session, creates nothing", async () => {
  const createWorktreeCalls: string[] = [];
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const arrows: Array<{ issueId: string; terminalId: string }> = [];

  const project = makeProject({
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
      {
        id: "w-existing",
        name: "issue-42-fix-login-bug",
        path: "/repo/issue-42-fix-login-bug",
        terminals: [
          { id: "t-live", type: "opencode", title: "Issue #42", issueNumber: 42 },
        ],
      },
    ],
  });

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async (repoPath, branch) => {
      createWorktreeCalls.push(branch);
      return { ok: true, path: "/repo", worktrees: [] };
    },
    getProject: () => project,
    syncWorktrees: () => {},
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "term-should-not-exist" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    setResolveArrows: (fn) => {
      const next = typeof fn === "function" ? fn(arrows) : fn;
      arrows.length = 0;
      arrows.push(...(next as typeof arrows));
    },
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
    resumePrompt: "retomá",
    isIssueTerminalLive: (terminalId) => terminalId === "t-live",
  });

  assert.equal(result.ok, true);
  assert.equal(result.case, "reused");
  assert.equal(result.terminal?.id, "t-live");
  assert.equal(result.worktreeId, "w-existing");
  assert.equal(result.reusedExisting, false);
  assert.equal(createWorktreeCalls.length, 0, "should NOT create a worktree");
  assert.equal(terminalCalls.length, 0, "should NOT create a terminal");
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].terminalId, "t-live");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "info");
  assert.ok(notifications[0].message.includes("Ya hay una sesión activa"));
});

test("resolveIssueWorktree: CASE A reuses dead node, no new worktree or terminal", async () => {
  const createWorktreeCalls: string[] = [];
  const terminalCalls: unknown[] = [];

  const project = makeProject({
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
      {
        id: "w-existing",
        name: "issue-42-fix-login-bug",
        path: "/repo/issue-42-fix-login-bug",
        terminals: [
          { id: "t-dead", type: "shell", title: "Issue #42", issueNumber: 42 },
        ],
      },
    ],
  });

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async (repoPath, branch) => {
      createWorktreeCalls.push(branch);
      return { ok: true, path: "/repo", worktrees: [] };
    },
    getProject: () => project,
    syncWorktrees: () => {},
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "term-should-not-exist" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
    resumePrompt: "retomá",
    isIssueTerminalLive: () => false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.case, "resumed");
  assert.equal(result.reusedExisting, true);
  assert.equal(result.terminal?.id, "t-dead");
  assert.equal(result.worktreeId, "w-existing");
  assert.equal(createWorktreeCalls.length, 0);
  assert.equal(terminalCalls.length, 0, "should reuse the existing tile, not spawn a new one");
});

test("resolveIssueWorktree: CASE A-bis spawns terminal in existing worktree with resume prompt", async () => {
  const createWorktreeCalls: string[] = [];
  const terminalCalls: Array<{ worktreeId: string; initialPrompt: string; issueNumber?: number }> = [];

  const project = makeProject({
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
      {
        id: "w-existing",
        name: "issue-42-fix-login-bug",
        path: "/repo/issue-42-fix-login-bug",
        terminals: [],
      },
    ],
  });

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async (repoPath, branch) => {
      createWorktreeCalls.push(branch);
      return { ok: true, path: "/repo", worktrees: [] };
    },
    getProject: () => project,
    syncWorktrees: () => {},
    createTerminal: (opts) => {
      terminalCalls.push({
        worktreeId: opts.worktreeId,
        initialPrompt: opts.initialPrompt,
        issueNumber: opts.issueNumber,
      });
      return { id: "term-resumed" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
    resumePrompt: "retomá la sesión",
  });

  assert.equal(result.ok, true);
  assert.equal(result.case, "resumed");
  assert.equal(result.reusedExisting, false);
  assert.equal(createWorktreeCalls.length, 0);
  assert.equal(terminalCalls.length, 1);
  assert.equal(terminalCalls[0].worktreeId, "w-existing");
  assert.equal(terminalCalls[0].initialPrompt, "retomá la sesión");
  assert.equal(terminalCalls[0].issueNumber, 42);
});

test("resolveIssueWorktree: legacy terminal matched by title fallback when no issueNumber metadata", async () => {
  const terminalCalls: unknown[] = [];

  const project = makeProject({
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
      {
        id: "w-existing",
        name: "issue-42-fix-login-bug",
        path: "/repo/issue-42-fix-login-bug",
        terminals: [
          { id: "t-legacy", type: "opencode", title: "Issue #42" },
        ],
      },
    ],
  });

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async () => ({ ok: true, path: "/repo", worktrees: [] }),
    getProject: () => project,
    syncWorktrees: () => {},
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
    resumePrompt: "retomá",
    isIssueTerminalLive: () => false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.case, "resumed");
  assert.equal(result.reusedExisting, true);
  assert.equal(result.terminal?.id, "t-legacy");
  assert.equal(terminalCalls.length, 0);
});

test("resolveIssueWorktree: arrow is not duplicated when the terminal is already mapped", async () => {
  const arrows: Array<{ issueId: string; terminalId: string }> = [
    { issueId: "issue-42", terminalId: "t-dead" },
  ];

  const project = makeProject({
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
      {
        id: "w-existing",
        name: "issue-42-fix-login-bug",
        path: "/repo/issue-42-fix-login-bug",
        terminals: [
          { id: "t-dead", type: "shell", title: "Issue #42", issueNumber: 42 },
        ],
      },
    ],
  });

  const result = await resolveIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    createWorktree: async () => ({ ok: true, path: "/repo", worktrees: [] }),
    getProject: () => project,
    syncWorktrees: () => {},
    createTerminal: () => ({ id: "x" }),
    notify: () => {},
    setResolveArrows: (fn) => {
      const next = typeof fn === "function" ? fn([...arrows]) : fn;
      arrows.length = 0;
      arrows.push(...(next as typeof arrows));
    },
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
    initialPrompt: "resolve it",
    resumePrompt: "retomá",
    isIssueTerminalLive: () => false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.case, "resumed");
  assert.equal(arrows.length, 1, "arrow should not be duplicated");
  assert.equal(arrows[0].terminalId, "t-dead");
});
