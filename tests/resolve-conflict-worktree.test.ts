import test from "node:test";
import assert from "node:assert/strict";
import { resolveConflictWorktree } from "../src/canvas/resolveConflictWorktree.ts";
import { buildResolveConflictPrompt } from "../src/canvas/resolveConflictPrompt.ts";

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
    worktreeId: "w-impl",
    issueNumber: 42,
    title: "Fix login bug",
    body: "Users cannot log in",
    url: "https://github.com/test/test/issues/42",
    labels: [],
    x: 100,
    y: 200,
    ...overrides,
  };
}

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    path: "/repo",
    worktrees: [
      { id: "w-impl", name: "issue-42-fix-login-bug", path: "/repo/.worktrees/issue-42-fix-login-bug" },
      { id: "w-review", name: "(detached)", path: "/repo/.worktrees/issue-42-fix-login-bug-review" },
    ],
    ...overrides,
  };
}

const openPr = {
  number: 99,
  title: "Fix login bug",
  url: "https://github.com/test/test/pull/99",
  state: "OPEN",
  headRefName: "issue-42-fix-login-bug",
  headRefOid: "abc123",
};

test("resolveConflictWorktree: reuses the implementer worktree (PR branch) and opens an autoApprove terminal", async () => {
  const terminalCalls: Array<{
    worktreeId: string;
    autoApprove: boolean;
    issueNumber?: number;
    initialPrompt: string;
  }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const arrows: Array<{ issueId: string; terminalId: string }> = [];

  const result = await resolveConflictWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () => makeProject(),
    createTerminal: (opts) => {
      terminalCalls.push({
        worktreeId: opts.worktreeId,
        autoApprove: opts.autoApprove,
        issueNumber: opts.issueNumber,
        initialPrompt: opts.initialPrompt,
      });
      return { id: "term-conflict-1" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    setResolveArrows: (fn) => {
      const next = typeof fn === "function" ? fn(arrows) : fn;
      arrows.length = 0;
      arrows.push(...(next as typeof arrows));
    },
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.worktreeId, "w-impl");
  assert.equal(terminalCalls.length, 1);
  assert.equal(
    terminalCalls[0].worktreeId,
    "w-impl",
    "conflict resolution must run in the implementer worktree, never the detached review worktree",
  );
  assert.equal(terminalCalls[0].autoApprove, true, "resolution terminal must run unattended like IMPLEMENTAR FIX");
  assert.equal(terminalCalls[0].issueNumber, 42);
  assert.ok(
    terminalCalls[0].initialPrompt.includes("gh pr view 99"),
    "prompt should reference the conflicting PR",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("issue-42-fix-login-bug"),
    "prompt should name the PR branch to push to",
  );
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].issueId, "issue-42");
  assert.equal(arrows[0].terminalId, "term-conflict-1");
  assert.equal(notifications.length, 0);
});

test("resolveConflictWorktree: no implementer worktree for the PR branch aborts with a notification", async () => {
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await resolveConflictWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () =>
      makeProject({
        worktrees: [{ id: "w-main", name: "main", path: "/repo" }],
      }),
    restoreWorktree: async () => ({ ok: false, error: "branch not found" }),
    syncWorktrees: () => {},
    getConflict: async () => ({ ok: true, conflictFiles: ["src/login.ts"] }),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, false);
  assert.equal(terminalCalls.length, 0, "no terminal without the implementer worktree");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "error");
  assert.ok(notifications[0].message.includes("issue-42-fix-login-bug"));
  assert.ok(notifications[0].message.includes("PR #99"));
});

test("resolveConflictWorktree: missing project returns error without side effects", async () => {
  const terminalCalls: unknown[] = [];
  const result = await resolveConflictWorktree({
    issue: makeIssue(),
    projectId: "missing",
    pr: openPr,
    getProject: () => undefined,
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Project not found");
  assert.equal(terminalCalls.length, 0);
});

test("resolveConflictWorktree: missing issue returns error", async () => {
  const terminalCalls: unknown[] = [];
  const result = await resolveConflictWorktree({
    issue: undefined,
    projectId: "p1",
    pr: openPr,
    getProject: () => makeProject(),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Issue not found");
  assert.equal(terminalCalls.length, 0);
});

test("buildResolveConflictPrompt: single line with the merge contract", () => {
  const prompt = buildResolveConflictPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
  });

  assert.ok(!prompt.includes("\n"), "prompt must be one line");
  assert.ok(prompt.includes("issue #7"));
  assert.ok(prompt.includes("gh pr view 12 --comments"), "must read the [mergeador] comment with the file list");
  assert.ok(prompt.includes("[mergeador]"), "must reference the mergeador comment");
  assert.ok(prompt.includes("git merge origin/main"), "must merge main into the branch");
  assert.ok(prompt.includes("merge: resolve conflicts with main for #12"), "must use the exact conventional commit message");
  assert.ok(prompt.includes("git push origin issue-7-broken-button"), "must push the existing branch");
  assert.ok(prompt.includes("[fix-conflicto-7]"));
  assert.ok(
    !prompt.includes("gh issue edit"),
    "must not flip cycle labels via gh (the app manages them)",
  );
  assert.ok(prompt.includes("conflicto:main"), "must reference the real conflict label");
  assert.ok(prompt.includes("los gestiona la app automáticamente"), "must leave the cycle labels to the app");
  assert.ok(!prompt.includes("gh pr create"), "must never create a new PR");
  assert.ok(prompt.includes("NUNCA crees una rama o PR nuevo"), "must forbid new branches/PRs");
  assert.ok(prompt.includes("intención original de cada lado"), "must resolve by the original intent of each side");
  assert.ok(prompt.includes("nunca uses git merge --abort"), "must never abort the merge");
});

test("buildResolveConflictPrompt: injected file list replaces the gh lookups", () => {
  const prompt = buildResolveConflictPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    conflictFiles: ["src/login.ts", "src/store.ts"],
  });

  assert.ok(!prompt.includes("\n"), "prompt must be one line");
  assert.ok(prompt.includes("src/login.ts, src/store.ts"), "must inject the app-resolved file list");
  assert.ok(prompt.includes("NO hace falta correr gh pr view"), "must say the gh lookup is not needed");
  assert.ok(!prompt.includes("gh pr view 12 --comments"), "must not ask to re-derive the file list with gh");
  assert.ok(!prompt.includes("[mergeador]"), "must not require reading the mergeador comment");
  assert.ok(prompt.includes("git merge origin/main"), "must still merge main into the branch");
  assert.ok(prompt.includes("merge: resolve conflicts with main for #12"), "must keep the exact commit message");
});

test("resolveConflictWorktree: injects the app-resolved conflict files into the prompt", async () => {
  const terminalCalls: Array<{ initialPrompt: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await resolveConflictWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () => makeProject(),
    getConflict: async () => ({
      ok: true,
      conflictFiles: ["src/login.ts", "src/store.ts"],
    }),
    createTerminal: (opts) => {
      terminalCalls.push({ initialPrompt: opts.initialPrompt });
      return { id: "term-conflict-1" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(terminalCalls.length, 1);
  assert.ok(
    terminalCalls[0].initialPrompt.includes("src/login.ts, src/store.ts"),
    "prompt must carry the app-resolved file list",
  );
  assert.ok(
    !terminalCalls[0].initialPrompt.includes("gh pr view 99"),
    "prompt must not ask the agent to re-derive the file list",
  );
  assert.ok(
    notifications.some((n) => n.type === "info" && n.message.includes("archivo(s) en conflicto")),
    "must inform the user how many files conflict",
  );
});

test("resolveConflictWorktree: skips the session when the branch already merges cleanly", async () => {
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await resolveConflictWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () => makeProject(),
    getConflict: async () => ({ ok: true, conflictFiles: [] }),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true, "a clean merge must skip the resolution session");
  assert.equal(terminalCalls.length, 0, "no terminal when there is nothing to resolve");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "info");
  assert.ok(notifications[0].message.includes("ya integra limpio"));
});

test("resolveConflictWorktree: falls back to the standard prompt when the conflict probe fails", async () => {
  const terminalCalls: Array<{ initialPrompt: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await resolveConflictWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () => makeProject(),
    getConflict: async () => ({ ok: false, error: "git exploded" }),
    createTerminal: (opts) => {
      terminalCalls.push({ initialPrompt: opts.initialPrompt });
      return { id: "term-conflict-1" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, true);
  assert.equal(terminalCalls.length, 1, "a failed probe must not block resolution");
  assert.ok(
    terminalCalls[0].initialPrompt.includes("gh pr view 99"),
    "must fall back to the gh-based instruction",
  );
  assert.ok(
    notifications.some((n) => n.type === "warn" && n.message.includes("git exploded")),
    "must warn that the probe failed",
  );
});

test("resolveConflictWorktree: no getConflict provider keeps the standard prompt", async () => {
  const terminalCalls: Array<{ initialPrompt: string }> = [];

  const result = await resolveConflictWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () => makeProject(),
    createTerminal: (opts) => {
      terminalCalls.push({ initialPrompt: opts.initialPrompt });
      return { id: "term-conflict-1" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, true);
  assert.equal(terminalCalls.length, 1);
  assert.ok(
    terminalCalls[0].initialPrompt.includes("gh pr view 99"),
    "without the provider the agent reads the [mergeador] comment itself",
  );
});
