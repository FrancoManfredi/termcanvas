import test from "node:test";
import assert from "node:assert/strict";
import type { IssueNodeData } from "../src/stores/issueStore.ts";
import {
  LiveIssuesAdapter,
  authorColorFor,
  blockedByTitle,
  deriveKanbanStatus,
  mapIssueNodeToKanban,
  mapPrsFromNodeAndReview,
  mapRelationsFromNode,
  mapTimelineFromNode,
  normalizeAuthor,
  normalizeIssueState,
  repoNameFromProjectId,
  resolveBlockedGate,
  toIssueLabel,
  type LiveReviewSnapshot,
} from "../src/features/warpPanel/adapters/liveIssues.ts";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_GATE_FAIL,
} from "../src/canvas/reviewVerdict.ts";

function emptyReview(
  patch: Partial<LiveReviewSnapshot> = {},
): LiveReviewSnapshot {
  return {
    primaryPrByIssue: {},
    verdictByIssue: {},
    reviewingIssueNumber: null,
    fixingIssueNumber: null,
    mergingIssueNumber: null,
    resolvingConflictIssueNumber: null,
    mergedPrNumbers: [],
    ...patch,
  };
}

function node(
  issueNumber: number,
  patch: Partial<IssueNodeData> = {},
): IssueNodeData {
  return {
    issueId: `node-${issueNumber}`,
    projectId: "C:/repos/termcanvas",
    worktreeId: "w1",
    issueNumber,
    title: `Issue ${issueNumber}`,
    body: `Body ${issueNumber}`,
    url: `https://github.com/org/termcanvas/issues/${issueNumber}`,
    labels: [],
    x: 0,
    y: 0,
    ...patch,
  };
}

function fakeDeps(
  issues: IssueNodeData[],
  review: LiveReviewSnapshot = emptyReview(),
  resolving: number | null = null,
) {
  return {
    readIssues: () => issues,
    readReview: () => review,
    readResolvingIssueNumber: () => resolving,
  };
}

// ─── Field mapping ───────────────────────────────────────────────────────────

test("live adapter maps IssueNodeData fields 1:1 (id/title/body/url/labels)", () => {
  const adapter = new LiveIssuesAdapter(
    fakeDeps([
      node(7, {
        title: "Fix the thing",
        body: "Long description",
        labels: [
          { name: "bug", color: "ff0000" },
          { name: "plain" },
        ],
      }),
    ]),
  );
  const issues = adapter.listIssues();
  assert.equal(issues.length, 1);
  const issue = issues[0];
  assert.equal(issue.id, 7);
  assert.equal(issue.number, 7);
  assert.equal(issue.title, "Fix the thing");
  assert.equal(issue.body, "Long description");
  assert.equal(
    issue.url,
    "https://github.com/org/termcanvas/issues/7",
  );
  assert.deepEqual(issue.labels, [
    { name: "bug", bg: "#ff0000", fg: "#e5e5e5" },
    { name: "plain", bg: "#27272a", fg: "#e5e5e5" },
  ]);
  assert.equal(issue.repoName, "termcanvas");
  assert.deepEqual(issue.activity, []);
});

test("toIssueLabel normalizes colors; repoNameFromProjectId takes last segment", () => {
  assert.deepEqual(toIssueLabel({ name: "a", color: "#1d4ed8" }), {
    name: "a",
    bg: "#1d4ed8",
    fg: "#e5e5e5",
  });
  assert.deepEqual(toIssueLabel({ name: "b", color: "1d4ed8" }), {
    name: "b",
    bg: "#1d4ed8",
    fg: "#e5e5e5",
  });
  assert.deepEqual(toIssueLabel({ name: "c", color: "not-a-color" }), {
    name: "c",
    bg: "#27272a",
    fg: "#e5e5e5",
  });
  assert.equal(repoNameFromProjectId("C:\\repos\\termcanvas"), "termcanvas");
  assert.equal(repoNameFromProjectId("/home/u/repos/my-proj/"), "my-proj");
  assert.equal(repoNameFromProjectId(""), "canvas");
});

test("mapIssueNodeToKanban carries the linked PR number/title", () => {
  const mapped = mapIssueNodeToKanban(node(3), "in-review", {
    number: 41,
    title: "feat: fix #3",
    url: "https://github.com/org/termcanvas/pull/41",
    state: "OPEN",
  });
  assert.equal(mapped.prNumber, 41);
  assert.equal(mapped.prTitle, "feat: fix #3");
});

// ─── Derived status table ────────────────────────────────────────────────────

test("derived status: fresh issue with no workflow state is backlog", () => {
  assert.equal(deriveKanbanStatus(1, emptyReview(), null), "backlog");
});

test("derived status: active ops map to in-progress", () => {
  assert.equal(
    deriveKanbanStatus(1, emptyReview({ reviewingIssueNumber: 1 }), null),
    "in-progress",
  );
  assert.equal(
    deriveKanbanStatus(1, emptyReview({ fixingIssueNumber: 1 }), null),
    "in-progress",
  );
  assert.equal(
    deriveKanbanStatus(1, emptyReview({ mergingIssueNumber: 1 }), null),
    "in-progress",
  );
  assert.equal(
    deriveKanbanStatus(
      1,
      emptyReview({ resolvingConflictIssueNumber: 1 }),
      null,
    ),
    "in-progress",
  );
  assert.equal(deriveKanbanStatus(1, emptyReview(), 1), "in-progress");
});

test("derived status: verdict or open PR maps to in-review", () => {
  assert.equal(
    deriveKanbanStatus(1, emptyReview({ verdictByIssue: { 1: "APPROVED" } }), null),
    "in-review",
  );
  assert.equal(
    deriveKanbanStatus(
      1,
      emptyReview({ verdictByIssue: { 1: "CHANGES_REQUESTED" } }),
      null,
    ),
    "in-review",
  );
  assert.equal(
    deriveKanbanStatus(
      2,
      emptyReview({
        primaryPrByIssue: {
          2: {
            number: 50,
            title: "fix #2",
            url: "https://github.com/org/r/pull/50",
            state: "OPEN",
          },
        },
      }),
      null,
    ),
    "in-review",
  );
});

test("derived status: done requires real merge evidence, never invented", () => {
  // MERGED PR state → done.
  assert.equal(
    deriveKanbanStatus(
      4,
      emptyReview({
        primaryPrByIssue: {
          4: {
            number: 60,
            title: "fix #4",
            url: "https://github.com/org/r/pull/60",
            state: "MERGED",
          },
        },
      }),
      null,
    ),
    "done",
  );
  // Bulk-merge run reported the linked PR merged → done.
  assert.equal(
    deriveKanbanStatus(
      5,
      emptyReview({
        primaryPrByIssue: {
          5: {
            number: 61,
            title: "fix #5",
            url: "https://github.com/org/r/pull/61",
            state: "OPEN",
          },
        },
        mergedPrNumbers: [61],
      }),
      null,
    ),
    "done",
  );
  // CLOSED-but-unmerged PR is NOT completion evidence.
  assert.equal(
    deriveKanbanStatus(
      6,
      emptyReview({
        primaryPrByIssue: {
          6: {
            number: 62,
            title: "fix #6",
            url: "https://github.com/org/r/pull/62",
            state: "CLOSED",
          },
        },
      }),
      null,
    ),
    "backlog",
  );
});

test("derived status: merge evidence wins over active/fixable signals", () => {
  assert.equal(
    deriveKanbanStatus(
      9,
      emptyReview({
        primaryPrByIssue: {
          9: {
            number: 70,
            title: "fix #9",
            url: "https://github.com/org/r/pull/70",
            state: "MERGED",
          },
        },
        verdictByIssue: { 9: "CHANGES_REQUESTED" },
        fixingIssueNumber: 9,
      }),
      9,
    ),
    "done",
  );
});

// ─── Adapter behavior: overrides, lookup, empty ──────────────────────────────

test("live adapter end-to-end: derived columns across a mixed board", () => {
  const adapter = new LiveIssuesAdapter(
    fakeDeps(
      [node(1), node(2), node(3), node(4)],
      emptyReview({
        fixingIssueNumber: 2,
        verdictByIssue: { 3: "APPROVED" },
        primaryPrByIssue: {
          4: {
            number: 44,
            title: "fix #4",
            url: "https://github.com/org/r/pull/44",
            state: "MERGED",
          },
        },
      }),
    ),
  );
  const byId = new Map(adapter.listIssues().map((i) => [i.id, i.status]));
  assert.equal(byId.get(1), "backlog");
  assert.equal(byId.get(2), "in-progress");
  assert.equal(byId.get(3), "in-review");
  assert.equal(byId.get(4), "done");
});

test("setIssueStatus layers a session-only override over derived status", () => {
  const issues = [node(1), node(2)];
  const review = emptyReview({ fixingIssueNumber: 1 });
  const adapter = new LiveIssuesAdapter(fakeDeps(issues, review));

  assert.equal(
    adapter.listIssues().find((i) => i.id === 1)?.status,
    "in-progress",
  );
  const after = adapter.setIssueStatus(1, "ready");
  assert.equal(after.find((i) => i.id === 1)?.status, "ready");
  // Untouched issues keep their derived status.
  assert.equal(after.find((i) => i.id === 2)?.status, "backlog");
  // The override is session-only: the underlying fake stores never changed.
  assert.equal(review.fixingIssueNumber, 1);
  assert.deepEqual(review.verdictByIssue, {});
  // Clearing overrides restores derivation.
  adapter.clearStatusOverrides();
  assert.equal(
    adapter.listIssues().find((i) => i.id === 1)?.status,
    "in-progress",
  );
});

test("getIssue returns clones per id; unknown id is undefined", () => {
  const adapter = new LiveIssuesAdapter(fakeDeps([node(11)]));
  assert.equal(adapter.getIssue(11)?.title, "Issue 11");
  assert.equal(adapter.getIssue(999), undefined);
});

test("empty canvas is honest: zero issues → empty list, no mocks", () => {
  const adapter = new LiveIssuesAdapter(fakeDeps([]));
  assert.deepEqual(adapter.listIssues(), []);
  assert.equal(adapter.getIssue(1), undefined);
});

// ─── Defensive normalization (live payload is not always an array) ──────────

test("labels as a bare string normalizes to [] (non-array → [])", () => {
  const bad = node(21, {
    labels: "bug" as unknown as IssueNodeData["labels"],
  });
  const adapter = new LiveIssuesAdapter(fakeDeps([bad]));
  const issues = adapter.listIssues();
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].labels, []);
});

test("labels undefined normalizes to [] without throwing", () => {
  const bad = node(22, {
    labels: undefined as unknown as IssueNodeData["labels"],
  });
  const adapter = new LiveIssuesAdapter(fakeDeps([bad]));
  assert.deepEqual(adapter.listIssues()[0].labels, []);
});

test("labels null normalizes to [] without throwing", () => {
  const bad = node(23, {
    labels: null as unknown as IssueNodeData["labels"],
  });
  const adapter = new LiveIssuesAdapter(fakeDeps([bad]));
  assert.deepEqual(adapter.listIssues()[0].labels, []);
});

test("mixed labels: bare strings map to { name }, junk is dropped", () => {
  const bad = node(24, {
    labels: [
      "bug",
      null,
      42,
      { name: "ok", color: "ff0000" },
      { name: 123 },
      "",
      "  ",
      { name: "  spaced  " },
    ] as unknown as IssueNodeData["labels"],
  });
  const adapter = new LiveIssuesAdapter(fakeDeps([bad]));
  const issues = adapter.listIssues();
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].labels, [
    { name: "bug", bg: "#27272a", fg: "#e5e5e5" },
    { name: "ok", bg: "#ff0000", fg: "#e5e5e5" },
    { name: "  spaced  ".trim(), bg: "#27272a", fg: "#e5e5e5" },
  ]);
});

test("invalid issueNumber nodes are dropped from the snapshot", () => {
  for (const badNumber of [0, -3, 1.5, NaN, "7", null, undefined]) {
    const bad = node(7, {
      issueNumber: badNumber as unknown as number,
    });
    const adapter = new LiveIssuesAdapter(fakeDeps([bad]));
    assert.deepEqual(
      adapter.listIssues(),
      [],
      `issueNumber ${String(badNumber)} should be dropped`,
    );
  }
  // A valid sibling still passes through alongside a dropped row.
  const mixed = new LiveIssuesAdapter(
    fakeDeps([
      node(7, { issueNumber: "7" as unknown as number }),
      node(8),
    ]),
  );
  const issues = mixed.listIssues();
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, 8);
});

test("non-string title/body/url and missing projectId use honest defaults", () => {
  const bad = node(25, {
    title: 123 as unknown as string,
    body: { text: "x" } as unknown as string,
    url: 42 as unknown as string,
    projectId: undefined as unknown as string,
  });
  const mapped = mapIssueNodeToKanban(bad, "backlog", null);
  assert.equal(mapped.title, "");
  assert.equal(mapped.body, "");
  assert.equal(mapped.url, undefined);
  assert.equal(mapped.repoName, "canvas");
});

// ─── GitHub fidelity batch (state / author / sort / done) ─────────────────

test("normalizeAuthor: login string and { login } object map; missing → honest empty", () => {
  assert.equal(normalizeAuthor("octocat"), "octocat");
  assert.equal(normalizeAuthor("  octocat  "), "octocat");
  assert.equal(normalizeAuthor({ login: "hubot", avatarUrl: "https://x/y.png" }), "hubot");
  assert.equal(normalizeAuthor(undefined), "");
  assert.equal(normalizeAuthor(null), "");
  assert.equal(normalizeAuthor(42), "");
  assert.equal(normalizeAuthor({}), "");
  assert.equal(normalizeAuthor({ login: 7 }), "");
});

test("author maps 1:1 from real data; legacy nodes stay honestly empty (never 'unknown')", () => {
  const fromString = mapIssueNodeToKanban(
    node(30, { author: "octocat" }),
    "backlog",
    null,
  );
  assert.equal(fromString.author, "octocat");

  const fromObject = mapIssueNodeToKanban(
    node(31, { author: { login: "hubot", avatarUrl: "https://x/y.png" } }),
    "backlog",
    null,
  );
  assert.equal(fromObject.author, "hubot");

  const legacy = mapIssueNodeToKanban(node(32), "backlog", null);
  assert.equal(legacy.author, "");
  assert.notEqual(legacy.author, "unknown");
});

test("authorColorFor: unknown author is neutral gray; logins are deterministic", () => {
  assert.equal(authorColorFor(""), "#6b7280");
  assert.equal(authorColorFor("octocat"), authorColorFor("octocat"));
  assert.notEqual(authorColorFor("octocat"), "#6b7280");
});

test("normalizeIssueState: only exact OPEN/CLOSED pass through", () => {
  assert.equal(normalizeIssueState("OPEN"), "OPEN");
  assert.equal(normalizeIssueState("CLOSED"), "CLOSED");
  assert.equal(normalizeIssueState("open"), undefined);
  assert.equal(normalizeIssueState("MERGED"), undefined);
  assert.equal(normalizeIssueState(null), undefined);
  assert.equal(normalizeIssueState(undefined), undefined);
  assert.equal(normalizeIssueState(42), undefined);
});

test("mapIssueNodeToKanban carries githubState; junk state stays absent", () => {
  const open = mapIssueNodeToKanban(node(40, { state: "OPEN" }), "backlog", null);
  assert.equal(open.githubState, "OPEN");
  const closed = mapIssueNodeToKanban(
    node(41, { state: "CLOSED" }),
    "backlog",
    null,
  );
  assert.equal(closed.githubState, "CLOSED");
  const junk = mapIssueNodeToKanban(
    node(42, { state: "MERGED" }),
    "backlog",
    null,
  );
  assert.equal(junk.githubState, undefined);
  const legacy = mapIssueNodeToKanban(node(43), "backlog", null);
  assert.equal(legacy.githubState, undefined);
});

test("derived status: CLOSED issue state maps to done from real data", () => {
  assert.equal(deriveKanbanStatus(1, emptyReview(), null, "CLOSED"), "done");
  assert.equal(deriveKanbanStatus(1, emptyReview(), null, "OPEN"), "backlog");
  // Legacy nodes without state are never inferred closed.
  assert.equal(deriveKanbanStatus(1, emptyReview(), null, undefined), "backlog");
  assert.equal(deriveKanbanStatus(1, emptyReview(), null, null), "backlog");
});

test("derived status: CLOSED issue wins over active workflow signals", () => {
  assert.equal(
    deriveKanbanStatus(
      9,
      emptyReview({ fixingIssueNumber: 9, verdictByIssue: { 9: "APPROVED" } }),
      9,
      "CLOSED",
    ),
    "done",
  );
});

test("live adapter end-to-end: CLOSED issues land in done; list sorts by number descending", () => {
  const adapter = new LiveIssuesAdapter(
    fakeDeps([
      node(3, { state: "OPEN", author: "octocat" }),
      node(30, { state: "CLOSED", author: { login: "hubot" } }),
      node(7, { state: "OPEN" }),
    ]),
  );
  const issues = adapter.listIssues();
  assert.deepEqual(
    issues.map((i) => i.number),
    [30, 7, 3],
  );
  const byId = new Map(issues.map((i) => [i.id, i]));
  assert.equal(byId.get(30)?.status, "done");
  assert.equal(byId.get(30)?.author, "hubot");
  assert.equal(byId.get(30)?.githubState, "CLOSED");
  assert.equal(byId.get(3)?.status, "backlog");
  assert.equal(byId.get(3)?.author, "octocat");
  assert.equal(byId.get(7)?.author, "");
});

// ─── Canvas relation parity (relations / timeline / PRs / gate) ────────────

function relationNode(patch: Record<string, unknown> = {}) {
  return patch;
}

test("mapRelationsFromNode: parent/blockedBy/blocking/subIssues with canvas labels", () => {
  const raw: Record<string, unknown> = {
    parent: relationNode({
      number: 1,
      title: "Epic",
      url: "https://github.com/org/r/issues/1",
      state: "OPEN",
    }),
    blockedBy: {
      nodes: [
        {
          number: 2,
          title: "Blocker",
          url: "https://github.com/org/r/issues/2",
          state: "CLOSED",
        },
      ],
    },
    blocking: {
      nodes: [
        {
          number: 3,
          title: "Blocked",
          url: "https://github.com/org/r/issues/3",
          state: "OPEN",
        },
      ],
    },
    subIssues: {
      nodes: [
        {
          number: 4,
          title: "Subtask",
          url: "https://github.com/org/r/issues/4",
          state: "OPEN",
        },
      ],
    },
  };
  assert.deepEqual(mapRelationsFromNode(raw), [
    {
      number: 1,
      title: "Epic",
      url: "https://github.com/org/r/issues/1",
      state: "OPEN",
      kind: "parent",
      label: "Parent",
    },
    {
      number: 2,
      title: "Blocker",
      url: "https://github.com/org/r/issues/2",
      state: "CLOSED",
      kind: "blockedBy",
      label: "Blocked by",
    },
    {
      number: 3,
      title: "Blocked",
      url: "https://github.com/org/r/issues/3",
      state: "OPEN",
      kind: "blocking",
      label: "Blocking",
    },
    {
      number: 4,
      title: "Subtask",
      url: "https://github.com/org/r/issues/4",
      state: "OPEN",
      kind: "subIssue",
      label: "Sub-issue",
    },
  ]);
});

test("mapRelationsFromNode: junk rows are dropped, missing fields stay honest", () => {
  assert.deepEqual(mapRelationsFromNode({}), []);
  assert.deepEqual(
    mapRelationsFromNode({
      parent: { title: "no number" },
      blockedBy: { nodes: [null, 42, { number: 0 }, { number: 5 }] },
      blocking: "junk",
      subIssues: null,
    }),
    [
      {
        number: 5,
        title: "",
        url: "",
        state: "OPEN",
        kind: "blockedBy",
        label: "Blocked by",
      },
    ],
  );
});

test("mapTimelineFromNode: canvas event-kind derivation with actor and label colors", () => {
  const raw: Record<string, unknown> = {
    timelineItems: {
      nodes: [
        {
          actor: { login: "octocat" },
          label: { name: "bug", color: "ff0000" },
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          actor: { login: "hubot" },
          milestoneTitle: "v1.0",
          createdAt: "2026-01-02T00:00:00Z",
        },
        {
          previousTitle: "Old",
          currentTitle: "New",
          createdAt: "2026-01-03T00:00:00Z",
        },
        {
          actor: { login: "octocat" },
          source: { __typename: "PullRequest", number: 50 },
          createdAt: "2026-01-04T00:00:00Z",
        },
        {
          actor: { login: "octocat" },
          subject: { id: "x" },
          isCrossRepository: true,
          createdAt: "2026-01-05T00:00:00Z",
        },
        {
          subject: { id: "y" },
          createdAt: "2026-01-06T00:00:00Z",
        },
        { createdAt: "2026-01-07T00:00:00Z" },
      ],
    },
  };
  const timeline = mapTimelineFromNode(raw);
  assert.deepEqual(
    timeline.map((e) => e.kind),
    [
      "labeled",
      "milestoned",
      "renamed-title",
      "cross-referenced",
      "connected",
      "disconnected",
      "updated",
    ],
  );
  // Label name/color pass through for the canvas-style label pill.
  assert.equal(timeline[0].actor, "octocat");
  assert.equal(timeline[0].labelName, "bug");
  assert.equal(timeline[0].labelColor, "ff0000");
  assert.equal(timeline[1].milestoneTitle, "v1.0");
  assert.equal(timeline[2].previousTitle, "Old");
  assert.equal(timeline[2].currentTitle, "New");
  // Missing actor stays honest (never fabricated).
  assert.equal(timeline[5].actor, "");
  assert.equal(timeline[6].createdAt, "2026-01-07T00:00:00Z");
});

test("mapPrsFromNodeAndReview: node Development fallback carries the PR link", () => {
  const raw: Record<string, unknown> = {
    issueNumber: 9,
    closedByPullRequestsReferences: {
      nodes: [
        {
          __typename: "PullRequest",
          number: 50,
          title: "feat: fix #9",
          url: "https://github.com/org/r/pull/50",
          state: "OPEN",
        },
      ],
    },
  };
  const prs = mapPrsFromNodeAndReview(raw, emptyReview());
  assert.equal(prs.length, 1);
  assert.equal(prs[0].prNumber, 50);
  assert.equal(prs[0].url, "https://github.com/org/r/pull/50");
  assert.equal(prs[0].title, "feat: fix #9");
  assert.equal(prs[0].state, "OPEN");
  assert.equal(prs[0].verdict, null);
  assert.equal(prs[0].effectiveLabel, null);
  assert.equal(prs[0].conflicted, false);
  assert.equal(prs[0].gateStatus, "idle");
});

test("mapPrsFromNodeAndReview: store open PRs win and carry verdict/labels/conflict/gate", () => {
  const raw: Record<string, unknown> = {
    issueNumber: 9,
    closedByPullRequestsReferences: {
      nodes: [
        {
          __typename: "PullRequest",
          number: 1,
          title: "stale",
          url: "https://github.com/org/r/pull/1",
          state: "CLOSED",
        },
      ],
    },
  };
  const review = emptyReview({
    openPrsByIssue: {
      9: [
        {
          number: 50,
          title: "feat: fix #9",
          url: "https://github.com/org/r/pull/50",
          state: "OPEN",
        },
      ],
    },
    verdictByPr: { 9: { 50: "APPROVED" } },
    labelsByPr: { 9: { 50: [REVIEW_LABEL_APPROVED] } },
    conflictByPr: { 9: { 50: true } },
    gateByPr: {
      9: { 50: { status: "fail", reportPath: "/tmp/gate-50.json" } },
    },
  });
  const prs = mapPrsFromNodeAndReview(raw, review);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].prNumber, 50);
  assert.equal(prs[0].url, "https://github.com/org/r/pull/50");
  assert.equal(prs[0].verdict, "APPROVED");
  assert.deepEqual(prs[0].labels, [REVIEW_LABEL_APPROVED]);
  assert.equal(prs[0].effectiveLabel, REVIEW_LABEL_APPROVED);
  assert.equal(prs[0].conflicted, true);
  assert.equal(prs[0].gateStatus, "fail");
  assert.equal(prs[0].gateReportPath, "/tmp/gate-50.json");
});

test("mapPrsFromNodeAndReview: persisted labels win over the in-memory verdict", () => {
  const raw: Record<string, unknown> = { issueNumber: 9 };
  const review = emptyReview({
    openPrsByIssue: {
      9: [
        {
          number: 50,
          title: "feat: fix #9",
          url: "https://github.com/org/r/pull/50",
          state: "OPEN",
        },
      ],
    },
    verdictByIssue: { 9: "APPROVED" },
    labelsByIssue: { 9: [REVIEW_LABEL_GATE_FAIL] },
  });
  const prs = mapPrsFromNodeAndReview(raw, review);
  assert.equal(prs[0].verdict, "APPROVED");
  assert.equal(prs[0].effectiveLabel, REVIEW_LABEL_GATE_FAIL);
});

test("toIssueLabel matches the canvas card `#${color}` convention", () => {
  // GitHub hex without `#` (the shape the canvas assumes).
  assert.equal(toIssueLabel({ name: "bug", color: "ff0000" }).bg, "#ff0000");
  // With-`#` input is preserved, never doubled.
  assert.equal(toIssueLabel({ name: "bug", color: "#ff0000" }).bg, "#ff0000");
  // Missing color falls back (canvas falls back to #30363d; the board
  // normalizes to its neutral pill — both render a neutral pill).
  assert.equal(toIssueLabel({ name: "plain" }).bg, "#27272a");
  const mapped = mapIssueNodeToKanban(
    node(7, { labels: [{ name: "bug", color: "d73a4a" }] }),
    "backlog",
    null,
  );
  assert.deepEqual(mapped.labels, [
    { name: "bug", bg: "#d73a4a", fg: "#e5e5e5" },
  ]);
});

test("mapIssueNodeToKanban carries worktreePath/projectId for handler cwd", () => {
  const mapped = mapIssueNodeToKanban(
    node(7, {
      projectId: "C:/repos/termcanvas",
      __worktreePath: "C:/repos/termcanvas",
    } as Partial<IssueNodeData>),
    "backlog",
    null,
  );
  assert.equal(mapped.worktreePath, "C:/repos/termcanvas");
  assert.equal(mapped.projectId, "C:/repos/termcanvas");
  const legacy = mapIssueNodeToKanban(
    node(8, {
      projectId: undefined as unknown as string,
    }),
    "backlog",
    null,
  );
  assert.equal(legacy.worktreePath, undefined);
  assert.equal(legacy.projectId, undefined);
});

test("live adapter end-to-end: relations/timeline/prs flow into the snapshot", () => {
  const adapter = new LiveIssuesAdapter(
    fakeDeps(
      [
        node(9, {
          parent: { number: 1, title: "Epic", url: "https://g/i/1" },
          subIssues: { nodes: [{ number: 10, title: "Sub" }] },
          timelineItems: {
            nodes: [{ actor: { login: "octocat" }, label: { name: "bug" } }],
          },
          closedByPullRequestsReferences: {
            nodes: [
              {
                __typename: "PullRequest",
                number: 50,
                title: "fix",
                url: "https://github.com/org/r/pull/50",
                state: "OPEN",
              },
            ],
          },
        } as Partial<IssueNodeData>),
      ],
      emptyReview(),
    ),
  );
  const issue = adapter.getIssue(9);
  assert.equal(issue?.relations?.length, 2);
  assert.deepEqual(
    issue?.relations?.map((r) => r.label),
    ["Parent", "Sub-issue"],
  );
  assert.equal(issue?.timeline?.length, 1);
  assert.equal(issue?.timeline?.[0].kind, "labeled");
  assert.equal(issue?.prs?.length, 1);
  assert.equal(
    issue?.prs?.[0].url,
    "https://github.com/org/r/pull/50",
  );
});

test("resolveBlockedGate: OPEN blocker blocks, CLOSED blocker frees", () => {
  assert.deepEqual(
    resolveBlockedGate([
      {
        number: 2,
        title: "Blocker",
        url: "",
        state: "OPEN",
        kind: "blockedBy",
        label: "Blocked by",
      },
    ]),
    { blocked: true, blockers: [2] },
  );
  assert.deepEqual(
    resolveBlockedGate([
      {
        number: 2,
        title: "Blocker",
        url: "",
        state: "CLOSED",
        kind: "blockedBy",
        label: "Blocked by",
      },
    ]),
    { blocked: false, blockers: [] },
  );
});

test("resolveBlockedGate: only blockedBy counts, sorted and deduplicated", () => {
  assert.deepEqual(
    resolveBlockedGate([
      {
        number: 9,
        title: "x",
        url: "",
        state: "OPEN",
        kind: "blockedBy",
        label: "Blocked by",
      },
      {
        number: 3,
        title: "y",
        url: "",
        state: "OPEN",
        kind: "blockedBy",
        label: "Blocked by",
      },
      {
        number: 9,
        title: "dup",
        url: "",
        state: "OPEN",
        kind: "blockedBy",
        label: "Blocked by",
      },
      {
        number: 7,
        title: "z",
        url: "",
        state: "OPEN",
        kind: "blocking",
        label: "Blocking",
      },
      {
        number: 1,
        title: "e",
        url: "",
        state: "OPEN",
        kind: "parent",
        label: "Parent",
      },
    ]),
    { blocked: true, blockers: [3, 9] },
  );
});

test("resolveBlockedGate: never throws, unknown state stays blocking", () => {
  assert.deepEqual(resolveBlockedGate(undefined), {
    blocked: false,
    blockers: [],
  });
  assert.deepEqual(resolveBlockedGate("junk"), {
    blocked: false,
    blockers: [],
  });
  assert.deepEqual(resolveBlockedGate([null, 42, { kind: "blockedBy" }]), {
    blocked: false,
    blockers: [],
  });
  // Absent/junk state is NOT done — unknown never unblocks.
  assert.deepEqual(
    resolveBlockedGate([
      {
        number: 5,
        title: "",
        url: "",
        state: "",
        kind: "blockedBy",
        label: "Blocked by",
      },
    ]),
    { blocked: true, blockers: [5] },
  );
});

test("blockedByTitle: honest singular/plural titles, never throws", () => {
  assert.equal(
    blockedByTitle([12]),
    "Bloqueado por #12 — se puede resolver cuando esté cerrado",
  );
  assert.equal(
    blockedByTitle([9, 3]),
    "Bloqueado por #3, #9 — se puede resolver cuando estén cerrados",
  );
  assert.equal(blockedByTitle([]), "Bloqueado por otro issue");
});
