import test from "node:test";
import assert from "node:assert/strict";
import { fixIssueWorktree } from "../src/canvas/fixIssueWorktree.ts";
import { buildIssueFixPrompt } from "../src/canvas/issueFixPrompt.ts";

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

test("fixIssueWorktree: reuses the implementer worktree (PR branch) and opens an autoApprove terminal", async () => {
  const terminalCalls: Array<{
    worktreeId: string;
    autoApprove: boolean;
    issueNumber?: number;
    initialPrompt: string;
  }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const arrows: Array<{ issueId: string; terminalId: string }> = [];

  const result = await fixIssueWorktree({
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
      return { id: "term-fix-1" };
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
    "fix must run in the implementer worktree, never the detached review worktree",
  );
  assert.equal(terminalCalls[0].autoApprove, true, "fix terminal must run unattended like RESOLVER ISSUE");
  assert.equal(terminalCalls[0].issueNumber, 42);
  assert.ok(
    terminalCalls[0].initialPrompt.includes("gh pr view 99"),
    "prompt should reference the reviewed PR",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("issue-42-fix-login-bug"),
    "prompt should name the PR branch to push to",
  );
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].issueId, "issue-42");
  assert.equal(arrows[0].terminalId, "term-fix-1");
  assert.equal(notifications.length, 0);
});

test("buildIssueFixPrompt: prefetched context replaces the state queries but keeps the review contract", () => {
  const prompt = buildIssueFixPrompt({
    issueNumber: 7,
    title: "Broken button",
    body: "Body",
    prNumber: 12,
    branch: "issue-7-broken-button",
    reviewContext:
      "PR head (headRefOid): f00d | Última review: CAMBIOS_PEDIDOS (commit deadbeef) | Diff del PR disponible en review-context-12.diff",
  });

  assert.ok(prompt.includes("\n"), "injected context must keep the fix prompt multiline");
  assert.ok(
    prompt.includes("CONTEXTO INYECTADO POR LA APP"),
    "fix prompt must carry the prefetched context block",
  );
  assert.ok(
    prompt.includes("no corras gh para obtener estos datos"),
    "prompt should tell the agent not to re-derive the injected facts",
  );
  // The review comments the fix MUST answer are still fetched by the agent:
  // injection replaces state queries, not the contract feedback.
  assert.ok(prompt.includes("pulls/12/comments"), "must still fetch inline comments");
  assert.ok(prompt.includes("gh pr comment 12"), "must still document the fix on the PR");
});

test("fixIssueWorktree: injects prefetched PR context into the fix prompt", async () => {
  const terminalCalls: Array<{ initialPrompt: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];

const result = await fixIssueWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () => makeProject(),
    syncWorktrees: () => {},
    restoreWorktree: async () => ({ ok: true, path: "/repo/x", worktrees: [] }),
    getReviewContext: async (_cwd, prNumber, targetDir) => {
      assert.equal(prNumber, 99);
      assert.equal(targetDir, "/repo/.worktrees/issue-42-fix-login-bug");
      return {
        ok: true,
        context: "PR head (headRefOid): abc123 | Última review: CAMBIOS_PEDIDOS",
        diffFilePath: "review-context-99.diff",
      };
    },
    createTerminal: (opts) => {
      terminalCalls.push({ initialPrompt: opts.initialPrompt });
      return { id: "term-fix-ctx" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(terminalCalls.length, 1);
  assert.ok(
    terminalCalls[0].initialPrompt.includes("CONTEXTO INYECTADO POR LA APP"),
    "fix prompt must carry the prefetched context",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("\n"),
    "fix prompt must stay multiline",
  );
  assert.equal(notifications.length, 0);
});

test("fixIssueWorktree: snapshot failure warns but does not block the fix", async () => {
  const terminalCalls: Array<{ initialPrompt: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await fixIssueWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () => makeProject(),
    restoreWorktree: async () => ({ ok: true, path: "/repo/x", worktrees: [] }),
    getReviewContext: async () => ({ ok: false, error: "gh not authenticated" }),
    createTerminal: (opts) => {
      terminalCalls.push({ initialPrompt: opts.initialPrompt });
      return { id: "term-fix-fail" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true, "fix must still start when the snapshot fails");
  assert.equal(terminalCalls.length, 1);
  assert.ok(
    !terminalCalls[0].initialPrompt.includes("CONTEXTO INYECTADO"),
    "no context block when the snapshot failed",
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "warn");
  assert.ok(notifications[0].message.includes("gh not authenticated"));
});

test("fixIssueWorktree: no implementer worktree for the PR branch aborts with a notification", async () => {
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await fixIssueWorktree({
    issue: makeIssue(),
    projectId: "p1",
    pr: openPr,
    getProject: () =>
      makeProject({
        worktrees: [{ id: "w-main", name: "main", path: "/repo" }],
      }),
    restoreWorktree: async () => ({ ok: false, error: "branch not found" }),
    getReviewContext: async () => ({ ok: false, error: "no" }),
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

test("fixIssueWorktree: missing project returns error without side effects", async () => {
  const terminalCalls: unknown[] = [];
  const result = await fixIssueWorktree({
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

test("fixIssueWorktree: missing issue returns error", async () => {
  const terminalCalls: unknown[] = [];
  const result = await fixIssueWorktree({
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

test("buildIssueFixPrompt: single line with issue body flattened", () => {
  const prompt = buildIssueFixPrompt({
    issueNumber: 7,
    title: "Broken button",
    body: "First line\nSecond line",
    prNumber: 12,
    branch: "issue-7-broken-button",
  });

  assert.ok(prompt.includes("\n"), "prompt must be multiline markdown");
  assert.ok(prompt.includes("issue #7 — Broken button"));
  assert.ok(prompt.includes("gh pr view 12 --json headRefOid"), "must confirm the head commit");
  assert.ok(prompt.includes("issue-7-broken-button"), "prompt must name the branch to push");
  assert.ok(prompt.includes("First line Second line"), "body newlines flattened to spaces");
  assert.ok(prompt.includes("[fix-7]"));
  assert.ok(prompt.includes("NUNCA crees una rama o PR nuevo"), "must forbid new branches/PRs");
  assert.ok(prompt.includes("git push origin issue-7-broken-button"), "must instruct pushing the existing branch");
});

test("buildIssueFixPrompt: the review comments are the contract", () => {
  const prompt = buildIssueFixPrompt({
    issueNumber: 7,
    title: "Broken button",
    body: "Body",
    prNumber: 12,
    branch: "issue-7-broken-button",
  });

  assert.ok(prompt.includes("pulls/12/comments"), "must fetch inline review comments");
  assert.ok(prompt.includes("pulls/12/reviews"), "must fetch the review rounds");
  assert.ok(prompt.includes("la review MÁS RECIENTE"), "must only answer the latest round");
  assert.ok(prompt.includes("gh pr comment 12"), "must document the fix on the PR");
  assert.ok(prompt.includes("EXACTAMENTE el fix pedido"), "must forbid scope creep");
  assert.ok(prompt.includes('"no bloqueante"'), "must distinguish non-blocking observations");
  assert.ok(!prompt.includes("gh issue edit"), "must not touch cycle labels (the app manages them)");
  assert.ok(!prompt.includes("gh label create"), "must not create labels (the app manages them)");
  assert.ok(!prompt.includes("gh pr create"), "must never create a new PR");
});
