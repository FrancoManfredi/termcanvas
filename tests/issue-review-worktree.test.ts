import test from "node:test";
import assert from "node:assert/strict";
import { reviewIssueWorktree } from "../src/canvas/reviewIssueWorktree.ts";
import { buildIssueReviewPrompt } from "../src/canvas/issueReviewPrompt.ts";

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
    body: "Users cannot log in",
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

const openPr = {
  number: 99,
  title: "Fix login bug",
  url: "https://github.com/test/test/pull/99",
  state: "OPEN",
  headRefName: "issue-42-fix-login-bug",
  headRefOid: "abc123",
};

test("reviewIssueWorktree: happy path creates a detached review worktree + terminal with autoApprove (--auto)", async () => {
  const createReviewWorktreeCalls: string[] = [];
  const createBaseNameCalls: string[] = [];
  const terminalCalls: Array<{
    worktreeId: string;
    autoApprove: boolean;
    reviewIssueNumber?: number;
    reviewPrNumber?: number;
    issueNumber?: number;
    initialPrompt: string;
  }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const arrows: Array<{ issueId: string; terminalId: string }> = [];

  const project = makeProject();
  const getProject = () => project;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: (_path, worktrees) => {
      // Simulate store mutation: add the review worktree to project
      project.worktrees = [
        { id: "w1", name: "main", path: "/repo" },
        { id: "w-review", name: "issue-42-fix-login-bug (review)", path: "/repo/.worktrees/repo-review" },
      ];
      void worktrees;
    },
    createReviewWorktree: async (repoPath, baseName, branch) => {
      createReviewWorktreeCalls.push(branch);
      createBaseNameCalls.push(baseName);
      return {
        ok: true,
        path: "/repo/.worktrees/repo-review",
        worktrees: [
          { path: "/repo", branch: "main", isPrimary: true },
          { path: "/repo/.worktrees/repo-review", branch: "(detached)", isPrimary: false },
        ],
      };
    },
    findOpenPrsForIssue: async () => ({ ok: true, prs: [openPr] }),
    createTerminal: (opts) => {
      terminalCalls.push({
        worktreeId: opts.worktreeId,
        autoApprove: opts.autoApprove,
        reviewIssueNumber: opts.reviewIssueNumber,
        reviewPrNumber: opts.reviewPrNumber,
        issueNumber: opts.issueNumber,
        initialPrompt: opts.initialPrompt,
      });
      return { id: "term-review-1" };
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
  assert.equal(createReviewWorktreeCalls.length, 1);
  assert.equal(createBaseNameCalls.length, 1);
  assert.equal(createBaseNameCalls[0], "issue-42-fix-login-bug", "review worktree must inherit the PR head branch name, not the focused worktree");
  assert.equal(createReviewWorktreeCalls[0], "issue-42-fix-login-bug", "should create review worktree at PR head branch");
  assert.equal(result.prs?.[0]?.number, 99);
  assert.equal(terminalCalls.length, 1);
  assert.equal(terminalCalls[0].worktreeId, "w-review");
  assert.equal(terminalCalls[0].autoApprove, true, "review terminal must run with --auto");
  assert.equal(terminalCalls[0].reviewIssueNumber, 42, "review terminal must carry reviewIssueNumber for cleanup");
  assert.equal(terminalCalls[0].reviewPrNumber, 99, "review terminal must carry PR number to persist the verdict");
  assert.equal(terminalCalls[0].issueNumber, 42);
  assert.ok(
    terminalCalls[0].initialPrompt.includes("gh pr view 99"),
    "prompt should include the PR number for gh pr view",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("abc123"),
    "prompt should embed the PR head commit sha for inline review commit_id",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("VEREDICTO: APROBADO o VEREDICTO: CAMBIOS_PEDIDOS"),
    "prompt should require the binary verdict line",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("pulls/99/reviews"),
    "prompt should target the /reviews endpoint for anchored comments",
  );
  assert.ok(
    !terminalCalls[0].initialPrompt.includes("\n"),
    "prompt must be a single line (opencode --prompt breaks on newlines)",
  );
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].issueId, "issue-42");
  assert.equal(arrows[0].terminalId, "term-review-1");
  assert.equal(notifications.length, 0);
});

test("reviewIssueWorktree: no linked PR warns and aborts before creating anything", async () => {
  const createReviewWorktreeCalls: unknown[] = [];
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject: () => makeProject(),
    syncWorktrees: () => {},
    createReviewWorktree: async () => {
      createReviewWorktreeCalls.push("should not be called");
      return { ok: true, path: "/repo/x", worktrees: [] };
    },
    findOpenPrsForIssue: async () => ({ ok: true, prs: [] }),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.prs?.length, 0);
  assert.equal(createReviewWorktreeCalls.length, 0, "should NOT create a worktree without a PR");
  assert.equal(terminalCalls.length, 0, "should NOT create a terminal without a PR");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "warn");
  assert.ok(notifications[0].message.includes("no open linked PR"));
});

test("reviewIssueWorktree: PR lookup failure toasts and aborts", async () => {
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject: () => makeProject(),
    syncWorktrees: () => {},
    createReviewWorktree: async () => ({ ok: true, path: "/repo/x", worktrees: [] }),
    findOpenPrsForIssue: async () => ({ ok: false, error: "gh not authenticated" }),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, false);
  assert.equal(terminalCalls.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "error");
  assert.ok(notifications[0].message.includes("gh not authenticated"));
});

test("reviewIssueWorktree: create failure toasts and aborts", async () => {
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject: () => makeProject(),
    syncWorktrees: () => {},
    createReviewWorktree: async () => ({
      ok: false,
      error: "fatal: could not create worktree",
    }),
    findOpenPrsForIssue: async () => ({ ok: true, prs: [openPr] }),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, false);
  assert.equal(terminalCalls.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "error");
  assert.ok(notifications[0].message.includes("could not create worktree"));
});

test("reviewIssueWorktree: matches review worktree despite Windows path separator mismatch", async () => {
  const terminalCalls: Array<{ worktreeId: string }> = [];

  const project = makeProject();
  const getProject = () => project;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: () => {
      project.worktrees = [
        { id: "w1", name: "main", path: "C:\\repo" },
        { id: "w-win", name: "issue-42-fix-login-bug (review)", path: "C:/repo/.worktrees/repo-review" },
      ];
    },
    createReviewWorktree: async () => ({
      ok: true,
      path: "C:\\repo\\.worktrees\\repo-review",
      worktrees: [
        { path: "C:/repo", branch: "main", isPrimary: true },
        { path: "C:/repo/.worktrees/repo-review", branch: "(detached)", isPrimary: false },
      ],
    }),
    findOpenPrsForIssue: async () => ({ ok: true, prs: [openPr] }),
    createTerminal: (opts) => {
      terminalCalls.push({ worktreeId: opts.worktreeId });
      return { id: "term-win-review" };
    },
    notify: (type, message) => {
      throw new Error(`unexpected notification: ${type} ${message}`);
    },
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(terminalCalls.length, 1, "terminal MUST be created on first review click");
  assert.equal(terminalCalls[0].worktreeId, "w-win");
});

test("reviewIssueWorktree: missing issue returns error", async () => {
  const result = await reviewIssueWorktree({
    issue: undefined,
    target: makeTarget(),
    getProject: () => makeProject(),
    syncWorktrees: () => {},
    createReviewWorktree: async () => ({ ok: true, path: "/repo", worktrees: [] }),
    findOpenPrsForIssue: async () => ({ ok: true, prs: [openPr] }),
    createTerminal: () => ({ id: "x" }),
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Issue not found");
});

test("reviewIssueWorktree: injects prefetched PR context into the prompt when the IPC snapshot succeeds", async () => {
  const terminalCalls: Array<{ initialPrompt: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const snapshotTargetDirs: string[] = [];

  const project = makeProject();
  const getProject = () => project;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: () => {
      project.worktrees = [
        { id: "w1", name: "main", path: "/repo" },
        { id: "w-review", name: "issue-42-fix-login-bug (review)", path: "/repo/.worktrees/repo-review" },
      ];
    },
    createReviewWorktree: async () => ({
      ok: true,
      path: "/repo/.worktrees/repo-review",
      worktrees: [
        { path: "/repo", branch: "main", isPrimary: true },
        { path: "/repo/.worktrees/repo-review", branch: "(detached)", isPrimary: false },
      ],
    }),
    findOpenPrsForIssue: async () => ({ ok: true, prs: [openPr] }),
    getReviewContext: async (_cwd, prNumber, targetDir) => {
      snapshotTargetDirs.push(targetDir);
      assert.equal(prNumber, 99);
      if (targetDir === "") {
        return {
          ok: true,
          context: "",
          diffFilePath: null,
          templateFilePath: null,
          headRefOid: "abc123",
          lastReviewCommitId: "old456",
        };
      }
      assert.equal(targetDir, "/repo/.worktrees/repo-review");
      return {
        ok: true,
        context: "PR head (headRefOid): abc123 | Última review: COMMENTED (commit old456)",
        diffFilePath: "review-context-99.diff",
        templateFilePath: "review-template-99.json",
        headRefOid: "abc123",
        lastReviewCommitId: "old456",
      };
    },
    createTerminal: (opts) => {
      terminalCalls.push({ initialPrompt: opts.initialPrompt });
      return { id: "term-review-ctx" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(snapshotTargetDirs.length, 2, "gate probe + snapshot must both hit the IPC");
  assert.equal(snapshotTargetDirs[0], "", "gate probe must not write any file");
  assert.equal(terminalCalls.length, 1);
  assert.ok(
    terminalCalls[0].initialPrompt.includes("CONTEXTO INYECTADO POR LA APP"),
    "prompt must carry the prefetched PR context",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("PR head (headRefOid): abc123"),
    "prompt must embed the snapshot headRefOid",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("review-template-99.json"),
    "prompt must reference the pre-generated JSON skeleton",
  );
  assert.ok(
    terminalCalls[0].initialPrompt.includes("NO changes el event ni la estructura"),
    "prompt must tell the agent to keep the fixed skeleton schema",
  );
  assert.ok(
    !terminalCalls[0].initialPrompt.includes("\n"),
    "context injection must keep the prompt single-line",
  );
  assert.equal(notifications.length, 0, "successful snapshot must not warn");
});

test("reviewIssueWorktree: snapshot failure warns but does not block the review", async () => {
  const terminalCalls: Array<{ initialPrompt: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const project = makeProject();
  const getProject = () => project;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: () => {
      project.worktrees = [
        { id: "w1", name: "main", path: "/repo" },
        { id: "w-review", name: "issue-42-fix-login-bug (review)", path: "/repo/.worktrees/repo-review" },
      ];
    },
    createReviewWorktree: async () => ({
      ok: true,
      path: "/repo/.worktrees/repo-review",
      worktrees: [
        { path: "/repo", branch: "main", isPrimary: true },
        { path: "/repo/.worktrees/repo-review", branch: "(detached)", isPrimary: false },
      ],
    }),
    findOpenPrsForIssue: async () => ({ ok: true, prs: [openPr] }),
    getReviewContext: async () => ({ ok: false, error: "gh not authenticated" }),
    createTerminal: (opts) => {
      terminalCalls.push({ initialPrompt: opts.initialPrompt });
      return { id: "term-review-ctx-fail" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true, "review must still start when the snapshot fails");
  assert.equal(terminalCalls.length, 1);
  assert.ok(
    !terminalCalls[0].initialPrompt.includes("CONTEXTO INYECTADO"),
    "no context block when the snapshot failed",
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "warn");
  assert.ok(notifications[0].message.includes("gh not authenticated"));
});

test("reviewIssueWorktree: skips the review when the last review already covered the current head commit", async () => {
  const createReviewWorktreeCalls: unknown[] = [];
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject: () => makeProject(),
    syncWorktrees: () => {},
    createReviewWorktree: async () => {
      createReviewWorktreeCalls.push("should not be called");
      return { ok: true, path: "/repo/x", worktrees: [] };
    },
    findOpenPrsForIssue: async () => ({ ok: true, prs: [openPr] }),
    getReviewContext: async () => ({
      ok: true,
      context: "",
      diffFilePath: null,
      templateFilePath: null,
      headRefOid: "abc123",
      lastReviewCommitId: "abc123",
    }),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true, "same OID must be reported as skipped");
  assert.equal(createReviewWorktreeCalls.length, 0, "must not create a worktree for a duplicated review");
  assert.equal(terminalCalls.length, 0, "must not open a terminal when the last review already covers the head");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "info");
  assert.ok(notifications[0].message.includes("abc123"), "skip notice should name the reviewed commit");
  assert.ok(
    notifications[0].message.includes("no hay commits nuevos"),
    "skip notice should explain the anti-duplicate reasoning",
  );
});

test("reviewIssueWorktree: gate probe failure or missing commit id must not block the review", async () => {
  const terminalCalls: Array<{ worktreeId: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const project = makeProject();
  const getProject = () => project;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: () => {
      project.worktrees = [
        { id: "w1", name: "main", path: "/repo" },
        { id: "w-review", name: "issue-42-fix-login-bug (review)", path: "/repo/.worktrees/repo-review" },
      ];
    },
    createReviewWorktree: async () => ({
      ok: true,
      path: "/repo/.worktrees/repo-review",
      worktrees: [
        { path: "/repo", branch: "main", isPrimary: true },
        { path: "/repo/.worktrees/repo-review", branch: "(detached)", isPrimary: false },
      ],
    }),
    findOpenPrsForIssue: async () => ({ ok: true, prs: [openPr] }),
    // Probe answers, but a review without a commit id makes the OID comparison
    // impossible: the gate must yield and the review must proceed. The real
    // snapshot still yields its normal context.
    getReviewContext: async (_cwd, _prNumber, targetDir) => ({
      ok: true,
      context:
        targetDir === ""
          ? ""
          : "PR head (headRefOid): abc123 | Sin reviews aún",
      diffFilePath: null,
      templateFilePath: null,
      headRefOid: "abc123",
      lastReviewCommitId: null,
    }),
    createTerminal: (opts) => {
      terminalCalls.push({ worktreeId: opts.worktreeId });
      return { id: "term-review-yield" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, undefined, "unknown last-review commit must not skip");
  assert.equal(terminalCalls.length, 1, "review must open when the gate cannot prove a duplicate");
  assert.equal(terminalCalls[0].worktreeId, "w-review");
  assert.equal(notifications.length, 0);
});

test("buildIssueReviewPrompt: single line with strict mandatory issue-body read", () => {
  const prompt = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "deadbeef",
  });

  assert.ok(!prompt.includes("\n"), "prompt must be one line");
  assert.ok(prompt.includes("issue #7 — Broken button"));
  assert.ok(prompt.includes("gh pr view 12"));
  assert.ok(prompt.includes("gh pr diff 12"));
  assert.ok(
    prompt.includes("LECTURA OBLIGATORIA DEL ISSUE"),
    "prompt must demand a strict mandatory read of the full issue body",
  );
  assert.ok(
    prompt.includes("gh issue view 7 --json title,body"),
    "prompt must name the exact gh command to read the full body",
  );
  assert.ok(
    prompt.includes("PROHIBIDO armar la review sin haberlo leído"),
    "reading the body must be enforced, not optional",
  );
  assert.ok(prompt.includes("[review-7]"));
  assert.ok(
    prompt.includes("VEREDICTO: APROBADO o VEREDICTO: CAMBIOS_PEDIDOS"),
    "prompt must require the binary verdict line in the review body",
  );
  assert.ok(
    !prompt.includes("--approve"),
    "review event is COMMENT, never the CLI --approve flag",
  );
  assert.ok(
    !prompt.includes("--request-changes"),
    "review event is COMMENT, never the CLI --request-changes flag",
  );
  assert.ok(prompt.includes("NUNCA crees una rama nueva"), "must forbid creating branches");
  assert.ok(
    prompt.includes("NO mergees el PR existente") || prompt.includes("no merge"),
    "must forbid merging",
  );
});

test("buildIssueReviewPrompt: never inlines the issue body text", () => {
  const prompt = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "deadbeef",
  });

  assert.ok(
    !prompt.includes("First line Second line"),
    "the flattened issue body must NOT be injected into the prompt",
  );
  assert.ok(
    !prompt.includes("Users cannot log in"),
    "no stray issue-body fragments in the prompt",
  );
});

test("buildIssueReviewPrompt: instructs inline comments via REST API with commit sha", () => {
  const prompt = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "deadbeef",
  });

  assert.ok(prompt.includes("repos/{owner}/{repo}/pulls/12/reviews"), "must target the pull reviews REST endpoint");
  assert.ok(prompt.includes("--method POST --input"), "review JSON must be posted from a file, not -f flags");
  assert.ok(prompt.includes('"side": "RIGHT"'), "must pin line comments to the new file version");
  assert.ok(prompt.includes("deadbeef"), "must embed the PR head commit sha for commit_id");
  assert.ok(prompt.includes("headRefOid"), "must compare headRefOid before deciding the mechanism");
  assert.ok(
    prompt.includes("nunca un gh pr comment"),
    "must explicitly ban the plain-comment fallback: every round posts an anchored review via /reviews",
  );
  assert.ok(prompt.includes("rtk"), "must warn against wrappers that hide stdout");
});

test("buildIssueReviewPrompt: Copilot-style anchored comments on PR-less files only", () => {
  const prompt = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
  });

  assert.ok(prompt.includes("--name-only"), "must restrict inline comments to files modified by the PR");
  assert.ok(prompt.includes('"path": "ruta/relativa/al/archivo.ext"'), "each inline comment must carry a relative file path");
  assert.ok(prompt.includes('"line": 42'), "must anchor each comment to an exact diff line");
  assert.ok(prompt.includes('"side": "RIGHT"'), "inline comments must pin the new file side");
  assert.ok(prompt.includes('"event": "COMMENT"'), "review event must always be COMMENT");
  assert.ok(prompt.includes("start_line"), "must anchor the comment start line");
  assert.ok(prompt.includes("end_line"), "must anchor the comment end line");
  assert.ok(prompt.includes("suggested_fix"), "must suggest a fix for each comment");
  assert.ok(prompt.includes("NO enumera líneas"), "review body must NOT list line numbers as text");
  assert.ok(prompt.includes("gh pr diff 12 JUSTO ANTES"), "must re-read the diff right before generating comments");
  assert.ok(prompt.includes(".review.json"), "review JSON must be staged in a worktree-local temp file");
});

// Two-round contract: the second round (after a real fix moved the PR head)
// must ALSO produce an anchored review via /reviews — the same endpoint as
// round one — never a plain `gh pr comment`. The anti-duplicate rule only
// forbids re-reviewing the SAME commit.
test("buildIssueReviewPrompt: injects prefetched context without breaking the one-line contract", () => {
  const prompt = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "deadbeef",
    reviewContext:
      "PR head (headRefOid): f00d | Última review: COMMENTED (commit deadbeef) | Diff del PR disponible en review-context-12.diff",
  });

  assert.ok(!prompt.includes("\n"), "prompt must stay single-line with injected context");
  assert.ok(
    prompt.includes("CONTEXTO INYECTADO POR LA APP"),
    "prompt must mark the prefetched context block",
  );
  assert.ok(prompt.includes("abc123") || prompt.includes("f00d"), "snapshot headRefOid must be embedded");
  assert.ok(
    prompt.includes("no corras gh para obtener estos datos"),
    "prompt should tell the agent not to re-derive the injected facts",
  );
});

test("buildIssueReviewPrompt: prefetched review context keeps the one-line contract", () => {
  const prompt = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "deadbeef",
    reviewContext:
      "PR head (headRefOid): f00d | Última review: CAMBIOS_PEDIDOS (commit deadbeef)",
  });

  assert.ok(!prompt.includes("\n"), "prompt must stay single-line");
  assert.ok(
    prompt.includes("CONTEXTO INYECTADO POR LA APP"),
    "prompt must carry the prefetched context",
  );
  assert.ok(prompt.includes("f00d"), "context headRefOid must be embedded");
});

test("buildIssueReviewPrompt: uses the pre-generated JSON skeleton when the app wrote it", () => {
  const prompt = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "deadbeef",
    reviewContext: "PR head (headRefOid): f00d",
    reviewTemplateFilePath: "review-template-12.json",
  });

  assert.ok(
    prompt.includes("review-template-12.json"),
    "prompt must reference the pre-generated skeleton path",
  );
  assert.ok(
    prompt.includes("USÁ EL ESQUELETO PRE-GENERADO"),
    "prompt must instruct the agent to use the skeleton instead of inventing the schema",
  );
  assert.ok(
    prompt.includes("commit_id"),
    "skeleton rule must mention the commit_id already loaded",
  );
  assert.ok(
    prompt.includes("NO changes el event ni la estructura"),
    "agent must not alter the fixed schema",
  );
  assert.ok(
    prompt.includes("--input review-template-12.json"),
    "skeleton must be posted from the file via --input",
  );
  assert.ok(!prompt.includes("\n"), "template rule must keep the prompt single-line");
});

test("buildIssueReviewPrompt: no skeleton rule without the pre-generated template file", () => {
  const prompt = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "deadbeef",
  });

  assert.ok(
    !prompt.includes("USÁ EL ESQUELETO PRE-GENERADO"),
    "no skeleton instruction when the app did not write the template file",
  );
});

test("buildIssueReviewPrompt: two real rounds both post anchored reviews via /reviews", () => {
  // Round 1: reviewer sees the original head commit.
  const round1 = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "aaaa111",
  });
  // Round 2: implementer pushed a real fix — new head commit.
  const round2 = buildIssueReviewPrompt({
    issueNumber: 7,
    title: "Broken button",
    prNumber: 12,
    branch: "issue-7-broken-button",
    commitSha: "bbbb222",
  });

  for (const [roundName, prompt] of [
    ["round 1", round1],
    ["round 2", round2],
  ] as const) {
    assert.ok(
      prompt.includes("repos/{owner}/{repo}/pulls/12/reviews"),
      `${roundName} must POST an anchored review via /reviews`,
    );
    assert.ok(
      prompt.includes("nunca un gh pr comment"),
      `${roundName} must explicitly ban the plain-comment fallback`,
    );
    assert.ok(
      prompt.includes("headRefOid"),
      `${roundName} must compare headRefOid before deciding`,
    );
  }

  // Each round embeds ITS OWN commit sha so the review anchors to the state
  // that was actually under review.
  assert.ok(round1.includes("aaaa111"), "round 1 embeds its head commit sha");
  assert.ok(round2.includes("bbbb222"), "round 2 embeds the NEW head commit sha after the fix");
  assert.ok(
    !round1.includes("bbbb222"),
    "round 1 must not reference the later commit",
  );
});

test("reviewIssueWorktree: prunes an abandoned review worktree left from a dead session before creating a fresh copy", async () => {
  const removeCalls: Array<{ path: string; force: boolean | undefined }> = [];
  const createCalls: string[] = [];
  const terminalCalls: Array<{ worktreeId: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const prWithSameBranch = { ...openPr, number: 101 };

  const project = makeProject({
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
      // Leftover copy of a previous review session for the same head branch.
      { id: "w-stale", name: "issue-42-fix-login-bug (review)", path: "/repo/.worktrees/issue-42-fix-login-bug-review" },
    ],
  });
  const getProject = () => project;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: (path, worktrees) => {
      void path;
      project.worktrees = worktrees.map((w) => ({
        id: w.path === project.path ? "w1" : "w-fresh",
        name: w.path === project.path ? "main" : "issue-42-fix-login-bug (review)",
        path: w.path,
      }));
    },
    createReviewWorktree: async (_rp, baseName, _branch) => {
      createCalls.push(baseName);
      return {
        ok: true,
        path: "/repo/.worktrees/issue-42-fix-login-bug-review",
        worktrees: [
          { path: "/repo", branch: "main", isPrimary: true },
          { path: "/repo/.worktrees/issue-42-fix-login-bug-review", branch: "(detached)", isPrimary: false },
        ],
      };
    },
    removeWorktree: async (_rp, path, force) => {
      removeCalls.push({ path, force });
      return {
        ok: true,
        worktrees: [
          { path: "/repo", branch: "main", isPrimary: true },
            { path: "/repo/.worktrees/issue-42-fix-login-bug-review", branch: "(detached)", isPrimary: false },
        ],
      };
    },
    isReviewWorktreeInUse: () => false,
    findOpenPrsForIssue: async () => ({ ok: true, prs: [prWithSameBranch] }),
    createTerminal: (opts) => {
      terminalCalls.push({ worktreeId: opts.worktreeId });
      return { id: "term-fresh" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(removeCalls.length, 1, "stale worktree must be removed before creating");
  assert.equal(removeCalls[0].path, "/repo/.worktrees/issue-42-fix-login-bug-review");
  assert.equal(removeCalls[0].force, true, "stale copy is disposable, force removal");
  assert.equal(createCalls.length, 1, "fresh review worktree MUST be created after the prune");
  assert.equal(terminalCalls.length, 1);
  assert.ok(
    notifications.some((n) => n.type === "info" && n.message.includes("abandonado")),
    "should inform the user that the abandoned copy was cleaned up",
  );
});

test("reviewIssueWorktree: keeps a review worktree the user is actively reviewing", async () => {
  const removeCalls: unknown[] = [];
  const terminalCalls: Array<{ worktreeId: string }> = [];
  const prWithBranch = { ...openPr, number: 102 };

  const project = makeProject({
    worktrees: [
      { id: "w1", name: "main", path: "/repo" },
      { id: "w-live", name: "issue-42-fix-login-bug (review)", path: "/repo/.worktrees/issue-42-fix-login-bug-review" },
    ],
  });
  const getProject = () => project;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: (path, worktrees) => {
      void path;
      void worktrees;
    },
    createReviewWorktree: async () => ({
      ok: true,
      path: "/repo/.worktrees/issue-42-fix-login-bug-review",
      worktrees: [
        { path: "/repo", branch: "main", isPrimary: true },
        { path: "/repo/.worktrees/issue-42-fix-login-bug-review", branch: "(detached)", isPrimary: false },
      ],
    }),
    removeWorktree: async (path, p, force) => {
      removeCalls.push({ path, p, force });
      return { ok: true, worktrees: [] };
    },
    isReviewWorktreeInUse: () => true,
    findOpenPrsForIssue: async () => ({ ok: true, prs: [prWithBranch] }),
    createTerminal: (opts) => {
      terminalCalls.push({ worktreeId: opts.worktreeId });
      return { id: "term-live" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(removeCalls.length, 0, "a worktree under an active review must NEVER be pruned");
  assert.equal(terminalCalls.length, 1);
});

test("reviewIssueWorktree: reviews EVERY open PR with one worktree + terminal per PR", async () => {
  const pr1 = openPr;
  const pr2 = {
    ...openPr,
    number: 100,
    title: "Fix login bug (alternative)",
    headRefName: "issue-42-alternative",
    headRefOid: "def456",
  };
  const createCalls: string[] = [];
  const terminalCalls: Array<{
    worktreeId: string;
    title: string;
    reviewPrNumber?: number;
    position: { x: number; y: number };
  }> = [];
  const arrows: Array<{ issueId: string; terminalId: string }> = [];

  const project = makeProject();
  const getProject = () => project;
  let createCount = 0;
  const mkPath = (baseName: string) => `/repo/.worktrees/${baseName}-review`;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: (_path, worktrees) => {
      project.worktrees = worktrees.map((w, i) => ({
        id: i === 0 ? "w1" : `w-review-${createCount}`,
        name: w.path,
        path: w.path,
      }));
    },
    createReviewWorktree: async (_repoPath, baseName, branch) => {
      createCount += 1;
      createCalls.push(branch);
      const path = mkPath(baseName);
      return {
        ok: true,
        path,
        worktrees: [
          { path: "/repo", branch: "main", isPrimary: true },
          { path, branch: "(detached)", isPrimary: false },
        ],
      };
    },
    findOpenPrsForIssue: async () => ({ ok: true, prs: [pr1, pr2] }),
    createTerminal: (opts) => {
      terminalCalls.push({
        worktreeId: opts.worktreeId,
        title: opts.title,
        reviewPrNumber: opts.reviewPrNumber,
        position: opts.position,
      });
      return { id: `term-${opts.reviewPrNumber}` };
    },
    notify: (_type, _message) => {},
    setResolveArrows: (fn) => {
      const next = typeof fn === "function" ? fn(arrows) : fn;
      arrows.length = 0;
      arrows.push(...(next as typeof arrows));
    },
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(createCalls.length, 2, "one review worktree per open PR");
  assert.deepEqual(createCalls, ["issue-42-fix-login-bug", "issue-42-alternative"]);
  assert.equal(terminalCalls.length, 2, "one review terminal per open PR");
  assert.equal(terminalCalls[0].reviewPrNumber, 99);
  assert.equal(terminalCalls[1].reviewPrNumber, 100);
  assert.ok(terminalCalls[0].title.includes("PR #99"));
  assert.ok(terminalCalls[1].title.includes("PR #100"));
  assert.deepEqual(result.terminals?.map((t) => t.id), ["term-99", "term-100"]);
  assert.deepEqual(terminalCalls[0].position, { x: 100, y: 200 });
  assert.deepEqual(terminalCalls[1].position, { x: 124, y: 224 });
  assert.equal(arrows.length, 2, "one arrow per review terminal");
});

test("reviewIssueWorktree: same head branch across PRs is disambiguated with a -pr<N> suffix", async () => {
  const pr1 = openPr;
  const pr2 = { ...openPr, number: 100 };
  const createBaseNames: string[] = [];
  const terminalCalls: Array<{ reviewPrNumber?: number }> = [];

  const project = makeProject();
  const getProject = () => project;
  let createCount = 0;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: (_path, worktrees) => {
      project.worktrees = worktrees.map((w, i) => ({
        id: i === 0 ? "w1" : `w-review-${createCount}`,
        name: w.path,
        path: w.path,
      }));
    },
    createReviewWorktree: async (_repoPath, baseName, _branch) => {
      createCount += 1;
      createBaseNames.push(baseName);
      const path = `/repo/.worktrees/${baseName}-review`;
      return {
        ok: true,
        path,
        worktrees: [
          { path: "/repo", branch: "main", isPrimary: true },
          { path, branch: "(detached)", isPrimary: false },
        ],
      };
    },
    findOpenPrsForIssue: async () => ({ ok: true, prs: [pr1, pr2] }),
    createTerminal: (opts) => {
      terminalCalls.push({ reviewPrNumber: opts.reviewPrNumber });
      return { id: `term-${opts.reviewPrNumber}` };
    },
    notify: (_type, _message) => {},
    issueNodeId: "issue-42",
    position: { x: 100, y: 200 },
  });

  assert.equal(result.ok, true);
  assert.equal(terminalCalls.length, 2, "both PRs sharing a branch still get reviewed");
  assert.deepEqual(createBaseNames, [
    "issue-42-fix-login-bug",
    "issue-42-fix-login-bug-pr100",
  ]);
});

test("reviewIssueWorktree: all PRs skipped by the anti-duplicate gate → skipped result, nothing created", async () => {
  const createCalls: unknown[] = [];
  const terminalCalls: unknown[] = [];

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject: () => makeProject(),
    syncWorktrees: () => {},
    createReviewWorktree: async () => {
      createCalls.push("should not be called");
      return { ok: true, path: "/repo/x", worktrees: [] };
    },
    findOpenPrsForIssue: async () => ({
      ok: true,
      prs: [openPr, { ...openPr, number: 100 }],
    }),
    getReviewContext: async () => ({
      ok: true,
      context: "",
      diffFilePath: null,
      templateFilePath: null,
      headRefOid: "abc123",
      lastReviewCommitId: "abc123",
    }),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: () => {},
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true, "every open PR already reviewed → skipped");
  assert.equal(createCalls.length, 0);
  assert.equal(terminalCalls.length, 0);
  assert.equal(result.prs?.length, 2);
});

test("reviewIssueWorktree: one PR fails to create, the other still gets reviewed", async () => {
  const pr2 = { ...openPr, number: 100, headRefName: "issue-42-alternative", headRefOid: "def456" };
  const terminalCalls: Array<{ reviewPrNumber?: number }> = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const project = makeProject();
  const getProject = () => project;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: () => {},
    createReviewWorktree: async (_repoPath, baseName) => {
      if (baseName === "issue-42-fix-login-bug") {
        return { ok: false, error: "fatal: could not create worktree" };
      }
      const path = "/repo/.worktrees/issue-42-alternative-review";
      project.worktrees = [
        { id: "w1", name: "main", path: "/repo" },
        { id: "w-review-2", name: "issue-42-alternative (review)", path },
      ];
      return {
        ok: true,
        path,
        worktrees: [
          { path: "/repo", branch: "main", isPrimary: true },
          { path, branch: "(detached)", isPrimary: false },
        ],
      };
    },
    findOpenPrsForIssue: async () => ({
      ok: true,
      prs: [openPr, pr2],
    }),
    createTerminal: (opts) => {
      terminalCalls.push({ reviewPrNumber: opts.reviewPrNumber });
      return { id: `term-${opts.reviewPrNumber}` };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
  });

  assert.equal(result.ok, true, "one successful review keeps the run successful");
  assert.equal(terminalCalls.length, 1);
  assert.equal(terminalCalls[0].reviewPrNumber, 100);
  assert.ok(
    notifications.some(
      (n) => n.type === "error" && n.message.includes("could not create worktree"),
    ),
    "the failed PR must be surfaced to the user",
  );
});

test("reviewIssueWorktree: onlyPrNumber reviews just that PR, not the other open ones", async () => {
  const pr2 = { ...openPr, number: 100, headRefName: "issue-42-alt", headRefOid: "def456" };
  const createCalls: string[] = [];
  const terminalCalls: Array<{ reviewPrNumber?: number }> = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const project = makeProject();
  const getProject = () => project;
  let createCount = 0;

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject,
    syncWorktrees: (_path, worktrees) => {
      project.worktrees = worktrees.map((w, i) => ({
        id: i === 0 ? "w1" : `w-review-${createCount}`,
        name: w.path,
        path: w.path,
      }));
    },
    createReviewWorktree: async (_repoPath, baseName, _branch) => {
      createCount += 1;
      createCalls.push(baseName);
      const path = `/repo/.worktrees/${baseName}-review`;
      return {
        ok: true,
        path,
        worktrees: [
          { path: "/repo", branch: "main", isPrimary: true },
          { path, branch: "(detached)", isPrimary: false },
        ],
      };
    },
    findOpenPrsForIssue: async () => ({
      ok: true,
      prs: [openPr, pr2],
    }),
    createTerminal: (opts) => {
      terminalCalls.push({ reviewPrNumber: opts.reviewPrNumber });
      return { id: `term-${opts.reviewPrNumber}` };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
    onlyPrNumber: 100,
  });

  assert.equal(result.ok, true);
  assert.equal(terminalCalls.length, 1, "only the targeted PR is reviewed");
  assert.equal(terminalCalls[0].reviewPrNumber, 100);
  assert.equal(createCalls.length, 1);
  assert.ok(
    !createCalls.includes("issue-42-fix-login-bug"),
    "the other open PR must not get a review worktree",
  );
  assert.equal(notifications.length, 0);
});

test("reviewIssueWorktree: onlyPrNumber warns when the PR is not an open PR of the issue", async () => {
  const createCalls: unknown[] = [];
  const terminalCalls: unknown[] = [];
  const notifications: Array<{ type: string; message: string }> = [];

  const result = await reviewIssueWorktree({
    issue: makeIssue(),
    target: makeTarget(),
    getProject: () => makeProject(),
    syncWorktrees: () => {},
    createReviewWorktree: async () => {
      createCalls.push("should not be called");
      return { ok: true, path: "/repo/x", worktrees: [] };
    },
    findOpenPrsForIssue: async () => ({
      ok: true,
      prs: [openPr],
    }),
    createTerminal: (opts) => {
      terminalCalls.push(opts);
      return { id: "x" };
    },
    notify: (type, message) => notifications.push({ type, message }),
    issueNodeId: "issue-42",
    position: { x: 0, y: 0 },
    onlyPrNumber: 500,
  });

  assert.equal(result.ok, false);
  assert.equal(terminalCalls.length, 0);
  assert.equal(createCalls.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "warn");
  assert.ok(notifications[0].message.includes("no es un PR abierto"));
});
