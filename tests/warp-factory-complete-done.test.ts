/**
 * warp-factory-complete-done — item 1 (DONE SOLO ON MERGE, B1 reverted).
 *
 * Explicit user order: `done` requires PR merged or issue CLOSED only.
 * A terminal factory `Complete` (Review → Complete via accept) NEVER
 * settles done on its own (rows D2/6b removed):
 * - `Complete` + OPEN PR → `ready / merge-ready` (Activity Ready to Merge
 *   section; the human accept behind `Complete` is the approval) and
 *   `in-review` (Kanban via the existing OPEN-PR row — no new Kanban row).
 * - `Complete` without a PR and without merge evidence → `pending`
 *   (Activity) / `backlog` (Kanban): honest, nothing invented.
 *
 * Rules under test (never invented done):
 * - done claims require REAL merge evidence (linked PR MERGED / mergedPrNumbers
 *   / CLOSED issue) — never a `Complete` flag alone.
 * - `Cancelled` / legacy `error` / active / unknown shapes never match.
 * - Row C1 (Activity) sits after A1/A2 but before A3: settled
 *   aprobado/comentado keep priority, but an unlabeled OPEN PR from a
 *   completed job invites a merge instead of a second review. Live work
 *   (I1–I4), human gates (F-A) and an ACTIVE job still beat C1.
 *
 * Offline: zero network, zero jobs created, zero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { LiveReviewSnapshot } from "../src/features/warpPanel/adapters/liveIssues.ts";
import {
  deriveKanbanStatus,
  LiveIssuesAdapter,
} from "../src/features/warpPanel/adapters/liveIssues.ts";
import {
  deriveActivityStatus,
  mapIssueNodeToActivity,
} from "../src/features/warpPanel/adapters/activityDerivation.ts";
import { LiveActivityAdapter } from "../src/features/warpPanel/adapters/liveActivity.ts";
import {
  findCompletedFactoryJobForIssue,
  isFactoryJobCompleted,
} from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";
import {
  buildFactoryJobIndex,
  findCompletedFactoryJobForIssueIndexed,
} from "../src/features/warpPanel/adapters/factoryJobIndex.ts";
import type { IssueNodeData } from "../src/stores/issueStore.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const ISSUE_URL = "https://github.com/org/termcanvas/issues/7";

function issueRefMeta(issueNumber = 7, repo: string | null = "org/termcanvas") {
  return {
    id: `job-ref-${issueNumber}`,
    from: "Intake",
    to: "Triage",
    at: new Date().toISOString(),
    actor: "system",
    message: `resolve link github#${issueNumber}`,
    meta: {
      issueRef: {
        provider: "github",
        issueNumber,
        repo,
        url: `https://github.com/org/termcanvas/issues/${issueNumber}`,
      },
    },
  };
}

/** Poll-list job linked to issue #7 with a chosen status shape. */
function linkedJob(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "job-complete-1",
    prompt: "Resolve issue #7",
    worktree: "C:/repos/wt-7",
    phase: "diagnosisLlm",
    status: "Complete",
    state: "done",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: [issueRefMeta()],
    ...patch,
  };
}

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
  patch: Record<string, unknown> = {},
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
  } as unknown as IssueNodeData;
}

// ─── isFactoryJobCompleted ─────────────────────────────────────────────────

test("isFactoryJobCompleted: Complete/done match; Cancelled/error/active/junk do not", () => {
  assert.equal(isFactoryJobCompleted({ status: "Complete" }), true);
  assert.equal(isFactoryJobCompleted({ state: "done" }), true);
  assert.equal(isFactoryJobCompleted({ status: "Cancelled" }), false);
  assert.equal(isFactoryJobCompleted({ state: "error" }), false);
  assert.equal(isFactoryJobCompleted({ status: "Review" }), false);
  assert.equal(isFactoryJobCompleted({ status: "Triage" }), false);
  assert.equal(isFactoryJobCompleted({ status: "Building" }), false);
  assert.equal(isFactoryJobCompleted({}), false);
  assert.equal(isFactoryJobCompleted(null), false);
  assert.equal(isFactoryJobCompleted("Complete"), false);
});

// ─── findCompletedFactoryJobForIssue ────────────────────────────────────────

test("findCompletedFactoryJobForIssue matches by issueRef + Complete only", () => {
  const jobs = [linkedJob()];
  assert.equal(findCompletedFactoryJobForIssue(jobs, 7, "org/termcanvas"), jobs[0]);
  // Wrong issue / wrong repo / bad input never match.
  assert.equal(findCompletedFactoryJobForIssue(jobs, 8, "org/termcanvas"), null);
  assert.equal(findCompletedFactoryJobForIssue(jobs, 7, "other/repo"), null);
  assert.equal(findCompletedFactoryJobForIssue(jobs, 0), null);
  assert.equal(findCompletedFactoryJobForIssue(null, 7), null);
  // Terminal-but-cancelled and active jobs never match.
  assert.equal(
    findCompletedFactoryJobForIssue(
      [linkedJob({ status: "Cancelled", state: "error" })],
      7,
      "org/termcanvas",
    ),
    null,
  );
  assert.equal(
    findCompletedFactoryJobForIssue(
      [linkedJob({ status: "Review", state: "running" })],
      7,
      "org/termcanvas",
    ),
    null,
  );
  // Null repo on either side falls back to number-only (old links).
  const repoLess = linkedJob({ timeline: [issueRefMeta(7, null)] });
  assert.equal(
    findCompletedFactoryJobForIssue([repoLess], 7, "org/termcanvas"),
    repoLess,
  );
  assert.equal(
    findCompletedFactoryJobForIssue([repoLess], 7, null),
    repoLess,
  );
});

test("indexed completed finder agrees with the linear finder", () => {
  const jobs = [
    linkedJob({ id: "job-a" }),
    linkedJob({ id: "job-b", status: "Review", state: "running" }),
  ];
  const index = buildFactoryJobIndex(jobs);
  const linear = findCompletedFactoryJobForIssue(jobs, 7, "org/termcanvas");
  const indexed = findCompletedFactoryJobForIssueIndexed(
    index,
    7,
    "org/termcanvas",
  );
  assert.equal(indexed, linear);
  assert.equal(
    (indexed as Record<string, unknown>)?.id,
    "job-a",
  );
  assert.equal(findCompletedFactoryJobForIssueIndexed(index, 8), null);
  assert.equal(findCompletedFactoryJobForIssueIndexed(null, 7), null);
});

// ─── Activity derivation (row C1 replaces D2) ─────────────────────────────

test("activity: factoryCompleted alone never settles done (DONE SOLO ON MERGE)", () => {
  // Bare row + Complete, no PR, no merge evidence → pending (honest).
  const derived = deriveActivityStatus(
    7,
    emptyReview(),
    null,
    "OPEN",
    false,
    null,
    true,
  );
  assert.equal(derived.status, "pending");
});

test("activity: Complete + OPEN PR invites a merge (C1)", () => {
  const derived = deriveActivityStatus(
    7,
    emptyReview({
      primaryPrByIssue: {
        7: { number: 61, title: "PR", url: "https://x/y/pull/61", state: "OPEN" },
      },
    }),
    null,
    "OPEN",
    false,
    null,
    true,
  );
  assert.deepEqual(derived, {
    status: "ready",
    awaitingAction: "merge-ready",
  });
});

test("activity: done still requires real merge evidence", () => {
  // MERGED PR → done even with a Complete flag present.
  assert.deepEqual(
    deriveActivityStatus(
      7,
      emptyReview({
        primaryPrByIssue: {
          7: { number: 61, title: "PR", url: "https://x/y/pull/61", state: "MERGED" },
        },
      }),
      null,
      "OPEN",
      false,
      null,
      true,
    ),
    { status: "done" },
  );
  // CLOSED issue → done even with a Complete flag present.
  assert.deepEqual(
    deriveActivityStatus(7, emptyReview(), null, "CLOSED", false, null, true),
    { status: "done" },
  );
});

test("activity: without completion the same row stays pending (no invented done)", () => {
  assert.equal(
    deriveActivityStatus(7, emptyReview(), null, "OPEN", false, null, false)
      .status,
    "pending",
  );
  assert.equal(
    deriveActivityStatus(7, emptyReview(), null, "OPEN", false, null, null)
      .status,
    "pending",
  );
  assert.equal(
    deriveActivityStatus(7, emptyReview(), null, "OPEN").status,
    "pending",
  );
});

test("activity: live work and settled labels beat the C1 merge invitation", () => {
  // Active factory job wins over the completed one (re-resolve in flight).
  assert.deepEqual(
    deriveActivityStatus(7, emptyReview(), null, "OPEN", true, null, true),
    { status: "in-progress", phase: "implementing" },
  );
  // Running canvas review wins.
  assert.deepEqual(
    deriveActivityStatus(
      7,
      emptyReview({ reviewingIssueNumber: 7 }),
      null,
      "OPEN",
      false,
      null,
      true,
    ),
    { status: "in-progress", phase: "reviewing" },
  );
  // A waiting human gate wins (spec approval).
  assert.deepEqual(
    deriveActivityStatus(7, emptyReview(), null, "OPEN", true, "spec-approval", true),
    { status: "awaiting", awaitingAction: "spec-approval" },
  );
  // Settled comentado keeps priority over C1 (needs a fix, not a merge).
  assert.deepEqual(
    deriveActivityStatus(
      7,
      emptyReview({
        primaryPrByIssue: {
          7: { number: 61, title: "PR", url: "https://x/y/pull/61", state: "OPEN" },
        },
        labelsByIssue: { 7: ["review:comentado"] },
      }),
      null,
      "OPEN",
      false,
      null,
      true,
    ),
    { status: "awaiting", awaitingAction: "changes-requested" },
  );
  // Settled aprobado still maps to merge-ready (A1, same visible row as C1).
  assert.deepEqual(
    deriveActivityStatus(
      7,
      emptyReview({
        primaryPrByIssue: {
          7: { number: 61, title: "PR", url: "https://x/y/pull/61", state: "OPEN" },
        },
        labelsByIssue: { 7: ["review:aprobado"] },
      }),
      null,
      "OPEN",
      false,
      null,
      false,
    ),
    { status: "ready", awaitingAction: "merge-ready" },
  );
});

// ─── Kanban derivation (row 6b removed) ────────────────────────────────────

test("kanban: factoryCompleted alone never settles done (DONE SOLO ON MERGE)", () => {
  assert.equal(
    deriveKanbanStatus(7, emptyReview(), null, "OPEN", false, true),
    "backlog",
  );
});

test("kanban: Complete + OPEN PR stays in-review via the existing OPEN row", () => {
  assert.equal(
    deriveKanbanStatus(
      7,
      emptyReview({
        primaryPrByIssue: {
          7: { number: 61, title: "PR", url: "https://x/y/pull/61", state: "OPEN" },
        },
      }),
      null,
      "OPEN",
      false,
      true,
    ),
    "in-review",
  );
});

test("kanban: done still requires real merge evidence", () => {
  assert.equal(
    deriveKanbanStatus(
      7,
      emptyReview({
        primaryPrByIssue: {
          7: { number: 61, title: "PR", url: "https://x/y/pull/61", state: "MERGED" },
        },
      }),
      null,
      "OPEN",
      false,
      true,
    ),
    "done",
  );
  assert.equal(
    deriveKanbanStatus(7, emptyReview(), null, "CLOSED", false, true),
    "done",
  );
});

test("kanban: without completion the same card stays backlog", () => {
  assert.equal(
    deriveKanbanStatus(7, emptyReview(), null, "OPEN", false, false),
    "backlog",
  );
  assert.equal(
    deriveKanbanStatus(7, emptyReview(), null, "OPEN"),
    "backlog",
  );
});

test("kanban: busy and in-review rows beat a completed job", () => {
  assert.equal(
    deriveKanbanStatus(7, emptyReview(), null, "OPEN", true, true),
    "in-progress",
  );
  assert.equal(
    deriveKanbanStatus(
      7,
      emptyReview({
        primaryPrByIssue: {
          7: { number: 61, title: "PR", url: "https://x/y/pull/61", state: "OPEN" },
        },
      }),
      null,
      "OPEN",
      false,
      true,
    ),
    "in-review",
  );
});

// ─── Adapters end to end ───────────────────────────────────────────────────

test("liveActivity: completed poll job without a PR stays pending (no invented done)", () => {
  const adapter = new LiveActivityAdapter({
    readIssues: () => [node(7)],
    readReview: () => emptyReview() as never,
    readResolvingIssueNumber: () => null,
    readProjectName: () => undefined,
    readActivityByRepo: () => ({}),
    readFactoryJobs: () => [linkedJob()],
    readNotifications: () => [],
  });
  const rows = adapter.listActivityIssues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "pending");
  // Mapping stays honest: no phase, no awaiting action on a pending row.
  assert.equal(rows[0].phase, undefined);
  assert.equal(rows[0].awaitingAction, undefined);
});

test("liveActivity: cancelled poll job never invents done", () => {
  const adapter = new LiveActivityAdapter({
    readIssues: () => [node(7)],
    readReview: () => emptyReview() as never,
    readResolvingIssueNumber: () => null,
    readProjectName: () => undefined,
    readActivityByRepo: () => ({}),
    readFactoryJobs: () => [
      linkedJob({ status: "Cancelled", state: "error" }),
    ],
    readNotifications: () => [],
  });
  assert.equal(adapter.listActivityIssues()[0].status, "pending");
});

test("liveIssues: completed poll job without merge evidence stays backlog", () => {
  const adapter = new LiveIssuesAdapter({
    readIssues: () => [node(7)],
    readReview: () => emptyReview(),
    readResolvingIssueNumber: () => null,
    readFactoryJobs: () => [linkedJob()],
    readProjectName: () => undefined,
  });
  const cards = adapter.listIssues();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].status, "backlog");
});

test("liveIssues: cancelled poll job never invents done", () => {
  const adapter = new LiveIssuesAdapter({
    readIssues: () => [node(7)],
    readReview: () => emptyReview(),
    readResolvingIssueNumber: () => null,
    readFactoryJobs: () => [
      linkedJob({ status: "Cancelled", state: "error" }),
    ],
    readProjectName: () => undefined,
  });
  assert.equal(adapter.listIssues()[0].status, "backlog");
});

test("activity mapping: done row keeps identity fields honest", () => {
  const mapped = mapIssueNodeToActivity(
    node(7),
    { status: "done" },
    emptyReview(),
    undefined,
    undefined,
  );
  assert.equal(mapped.id, 7);
  assert.equal(mapped.status, "done");
  assert.equal(mapped.url, ISSUE_URL);
});
