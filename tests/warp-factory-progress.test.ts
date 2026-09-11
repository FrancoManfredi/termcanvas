/**
 * warp-factory-progress — Resolve moves rows to in-progress, with live
 * Warp cycle stages and an honest View Agent link.
 *
 * Root cause under test: the warp panel resolves via factory jobs, but the
 * shared `useWorkItemsPolling` 2.5s loop used to mount ONLY inside
 * FactoryLabPage — mutually exclusive with WarpPanelShell in App.tsx — so
 * the poll list stayed empty while the panel was open and resolved rows
 * never reached In Progress. The fix mounts the same singleton-guarded
 * loop in the shell (zero new polls) and matches rows by `issueRef`.
 *
 * Contract under test (offline: zero network, zero jobs created):
 * - `isFactoryJobActive`: queued family (Intake/Foreman/Triage, legacy
 *   queued) counts exactly like running (Building/Review, legacy
 *   running); terminal frees the row; unknown/junk never claims busy.
 * - `findActiveFactoryJobForIssue`: a fresh queued job carrying the
 *   `issueRef` timeline meta matches (pending → in-progress core).
 * - `readFactoryJobStage`: verbatim daemon stages in pipeline order with
 *   queued/running families; legacy state fallback; unknown → null; the
 *   record `phase` seed (e.g. "diagnosisLlm") is never read as a stage.
 * - `readFactoryJobSessionLink`: daemon-built `dashboardUrl` passes
 *   through; `sessionId` alone is NEVER synthesized into a URL.
 * - `deriveActivityStatus` + `deriveKanbanStatus`: factory-active rows
 *   are in-progress (kanban via the SAME shared helper, not a copy).
 * - `LiveIssuesAdapter` / `LiveActivityAdapter` with injected poll lists:
 *   kanban cards move; activity rows attach the live stage + session URL.
 * - `describeActivityActions` session ("View Agent"): enabled with a live
 *   URL, honest-disabled without one, legacy-enabled when factory info is
 *   absent (pre-existing call sites).
 * - `invokeActivityAction("session")`: opens the injected live URL, never
 *   opens without one (no dead tabs).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { IssueNodeData } from "../src/stores/issueStore.ts";
import {
  FACTORY_STAGE_LANES,
  describeFactoryJobForPanel,
  findActiveFactoryJobForIssue,
  isFactoryJobActive,
  readFactoryJobForemanDecision,
  readFactoryJobHookAgents,
  readFactoryJobSessionLink,
  readFactoryJobStage,
  readFactoryJobTriageDecision,
} from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";
import { deriveActivityStatus } from "../src/features/warpPanel/adapters/activityDerivation.ts";
import {
  LiveIssuesAdapter,
  deriveKanbanStatus,
  type LiveReviewSnapshot,
} from "../src/features/warpPanel/adapters/liveIssues.ts";
import { LiveActivityAdapter } from "../src/features/warpPanel/adapters/liveActivity.ts";
import {
  describeActivityActions,
  invokeActivityAction,
  type DescribeActivityActionsArgs,
} from "../src/features/warpPanel/components/activityActions.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const ISSUE_URL = "https://github.com/org/termcanvas/issues/7";
const SESSION_URL = "http://127.0.0.1:20274/abc123/session/ses-live-1";

function issueRefMeta(issueNumber = 7, repo: string | null = "org/termcanvas") {
  return {
    id: "job-7-t1",
    from: "Intake",
    to: "Intake",
    at: new Date().toISOString(),
    actor: "system",
    message: "resolve link github#7 (org/termcanvas)",
    meta: {
      issueRef: { provider: "github", issueNumber, repo, url: ISSUE_URL },
    },
  };
}

/** Fresh resolve job: queued behind the worker (Intake, legacy queued). */
function queuedJob(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "job-abc123",
    prompt: "Resolve issue #7",
    worktree: "C:/repos/wt-7",
    phase: "diagnosisLlm",
    status: "Intake",
    state: "queued",
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
  } as IssueNodeData;
}

function baseArgs(
  patch: Partial<DescribeActivityActionsArgs> = {},
): DescribeActivityActionsArgs {
  return {
    issueNumber: 7,
    prNumber: null,
    prState: "unknown",
    effective: null,
    conflicted: false,
    gateStatus: "idle",
    busy: {
      resolving: false,
      reviewing: false,
      fixing: false,
      merging: false,
      resolvingConflict: false,
      anyActive: false,
    },
    ...patch,
  };
}

function byKind(defs: ReturnType<typeof describeActivityActions>) {
  return new Map(defs.map((d) => [d.kind, d]));
}

// ─── Active detection: queued counts ─────────────────────────────────────────

test("active: queued family (Intake/Foreman/Triage, legacy queued) counts like running", () => {
  for (const status of ["Intake", "Foreman", "Triage"]) {
    assert.equal(
      isFactoryJobActive({ status }),
      true,
      `${status} is agent work in flight`,
    );
  }
  for (const status of ["Building", "Review"]) {
    assert.equal(isFactoryJobActive({ status }), true, `${status} is active`);
  }
  assert.equal(isFactoryJobActive({ state: "queued" }), true);
  assert.equal(isFactoryJobActive({ state: "running" }), true);
});

test("active: terminal frees the row; unknown/junk never claims busy", () => {
  assert.equal(isFactoryJobActive({ status: "Complete" }), false);
  assert.equal(isFactoryJobActive({ status: "Cancelled" }), false);
  assert.equal(isFactoryJobActive({ state: "done" }), false);
  assert.equal(isFactoryJobActive({ state: "error" }), false);
  assert.equal(isFactoryJobActive({ status: "Planning" }), false);
  assert.equal(isFactoryJobActive({}), false);
  assert.equal(isFactoryJobActive(null), false);
  assert.equal(isFactoryJobActive("queued"), false);
});

// ─── Match: pending queued job → in-progress ─────────────────────────────────

test("match: fresh queued job with issueRef timeline meta matches the issue", () => {
  const found = findActiveFactoryJobForIssue(
    [queuedJob()],
    7,
    "org/termcanvas",
  );
  assert.ok(found !== null, "queued resolve job matches");
});

test("match: terminal, repo mismatch, and ref-less jobs never match", () => {
  assert.equal(
    findActiveFactoryJobForIssue(
      [queuedJob({ status: "Complete", state: "done" })],
      7,
      "org/termcanvas",
    ),
    null,
  );
  assert.equal(
    findActiveFactoryJobForIssue([queuedJob()], 7, "org/other-repo"),
    null,
  );
  assert.equal(
    findActiveFactoryJobForIssue(
      [queuedJob({ timeline: [] })],
      7,
      "org/termcanvas",
    ),
    null,
  );
  // Null repo on either side falls back to number-only (old links match).
  assert.ok(
    findActiveFactoryJobForIssue([queuedJob()], 7, null) !== null,
  );
});

// ─── Stages: verbatim daemon cycle ───────────────────────────────────────────

test("stages: lanes are the real daemon statuses in pipeline order", () => {
  assert.deepEqual([...FACTORY_STAGE_LANES], [
    "Intake",
    "Foreman",
    "Triage",
    "Building",
    "Review",
    "Complete",
  ]);
  const order = ["Intake", "Foreman", "Triage", "Building", "Review", "Complete"];
  let prev = -1;
  for (const status of order) {
    const stage = readFactoryJobStage({ status });
    assert.ok(stage !== null, `${status} recognized`);
    assert.equal(stage.label, status, "label is the verbatim status");
    assert.ok(stage.stepIndex > prev, "pipeline order");
    assert.equal(stage.stepCount, 6);
    prev = stage.stepIndex;
  }
});

test("stages: queued vs running families documented on the read", () => {
  for (const status of ["Intake", "Foreman", "Triage"]) {
    assert.equal(readFactoryJobStage({ status })?.family, "queued");
    assert.equal(readFactoryJobStage({ status })?.terminal, false);
  }
  for (const status of ["Building", "Review"]) {
    assert.equal(readFactoryJobStage({ status })?.family, "running");
    assert.equal(readFactoryJobStage({ status })?.terminal, false);
  }
  assert.equal(readFactoryJobStage({ status: "Complete" })?.terminal, true);
  const cancelled = readFactoryJobStage({ status: "Cancelled" });
  assert.equal(cancelled?.terminal, true);
  assert.equal(cancelled?.family, "terminal");
});

test("stages: legacy state fallback; unknown and phase-only shapes read null", () => {
  assert.equal(readFactoryJobStage({ state: "queued" })?.status, "Intake");
  assert.equal(readFactoryJobStage({ state: "running" })?.status, "Building");
  assert.equal(readFactoryJobStage({ state: "done" })?.terminal, true);
  assert.equal(readFactoryJobStage({ status: "Planning" }), null);
  assert.equal(readFactoryJobStage({}), null);
  assert.equal(readFactoryJobStage(null), null);
  // The record `phase` seed is an intake seed, never a pipeline position.
  assert.equal(readFactoryJobStage({ phase: "diagnosisLlm" }), null);
});

// ─── Session link: daemon-built URL only ─────────────────────────────────────

test("session link: dashboardUrl passes through; sessionId alone never invents a URL", () => {
  const link = readFactoryJobSessionLink(
    queuedJob({ dashboardUrl: SESSION_URL, sessionId: "ses-live-1" }),
  );
  assert.deepEqual(link, { jobId: "job-abc123", sessionUrl: SESSION_URL });
  assert.equal(
    readFactoryJobSessionLink(queuedJob({ sessionId: "ses-live-1" })),
    null,
    "no dashboardUrl = no link (renderer cannot know the opencode base)",
  );
  assert.equal(readFactoryJobSessionLink(queuedJob()), null);
  assert.equal(
    readFactoryJobSessionLink(queuedJob({ dashboardUrl: "not-a-url" })),
    null,
  );
  assert.equal(
    readFactoryJobSessionLink(queuedJob({ dashboardUrl: "http://127.0.0.1:4096" })),
    null,
    "the bare opencode base is NOT a live session link (dead-port guard)",
  );
  assert.equal(readFactoryJobSessionLink(null), null);
});

// ─── Routing decisions: Foreman / Triage ─────────────────────────────────────

test("decisions: summary projections read verbatim; junk degrades to null", () => {
  const job = queuedJob({
    foreman: {
      decision: "needs_triage",
      reason: "fallback: LLM no disponible — session.create fallo",
      confidence: 0.52,
      retryable: true,
    },
    triage: {
      decision: "building",
      reason: "triage LLM no disponible, defiere al foreman",
      confidence: 0.5,
      fallback: true,
    },
  });
  assert.deepEqual(readFactoryJobForemanDecision(job), {
    decision: "needs_triage",
    reason: "fallback: LLM no disponible — session.create fallo",
    confidence: 0.52,
    retryable: true,
  });
  assert.deepEqual(readFactoryJobTriageDecision(job), {
    decision: "building",
    reason: "triage LLM no disponible, defiere al foreman",
    confidence: 0.5,
    fallback: true,
  });
  assert.equal(readFactoryJobForemanDecision(queuedJob()), null);
  assert.equal(readFactoryJobTriageDecision(queuedJob()), null);
  assert.equal(readFactoryJobForemanDecision({ foreman: { reason: "x" } }), null);
  assert.equal(readFactoryJobTriageDecision({ triage: "junk" }), null);
  assert.equal(readFactoryJobForemanDecision(null), null);
});

test("hook roster: readFactoryJobHookAgents sanitiza y describe adjunta hookAgents", () => {
  const job = queuedJob({
    hookAgents: [
      { name: "playwright-tester", stage: "post-review", blocking: false },
      { name: "gate", stage: "pre-build", blocking: true },
      { name: "playwright-tester", stage: "post-review" },
      { name: "", stage: "post-review" },
      { name: "sin-stage" },
      "junk",
    ],
  });
  assert.deepEqual(readFactoryJobHookAgents(job), [
    { name: "playwright-tester", stage: "post-review", blocking: false },
    { name: "gate", stage: "pre-build", blocking: true },
  ]);
  const info = describeFactoryJobForPanel(job);
  assert.ok(info);
  assert.deepEqual(info.hookAgents, [
    { name: "playwright-tester", stage: "post-review", blocking: false },
    { name: "gate", stage: "pre-build", blocking: true },
  ]);
  assert.equal(readFactoryJobHookAgents(queuedJob()), null, "sin roster = null");
  assert.equal(readFactoryJobHookAgents({ hookAgents: [] }), null);
  assert.equal(readFactoryJobHookAgents(null), null);
});

test("decisions: timeline meta is the full-view fallback; panel info attaches them", () => {
  const withTimeline = queuedJob({
    timeline: [
      issueRefMeta(),
      {
        id: "job-7-t2",
        from: "Foreman",
        to: "Triage",
        at: new Date().toISOString(),
        actor: "foreman",
        message: "triaged",
        meta: {
          foremanDecision: {
            decision: "needs_triage",
            reason: "needs context",
            confidence: 0.6,
          },
          triage: { decision: "triage", reason: "ambiguous", confidence: 0.4 },
        },
      },
    ],
  });
  assert.equal(readFactoryJobForemanDecision(withTimeline)?.decision, "needs_triage");
  assert.equal(readFactoryJobTriageDecision(withTimeline)?.decision, "triage");
  const info = describeFactoryJobForPanel(withTimeline);
  assert.ok(info);
  assert.equal(info.foremanDecision?.decision, "needs_triage");
  assert.equal(info.foremanDecision?.reason, "needs context");
  assert.equal(info.triageDecision?.decision, "triage");
});

test("panel snapshot: stage + session combined; unknown job shape stays null", () => {
  const info = describeFactoryJobForPanel(
    queuedJob({ status: "Building", dashboardUrl: SESSION_URL }),
  );
  assert.ok(info !== null);
  assert.equal(info.jobId, "job-abc123");
  assert.equal(info.stage, "Building");
  assert.equal(info.stageLabel, "Building");
  assert.equal(info.family, "running");
  assert.equal(info.sessionUrl, SESSION_URL);
  assert.equal(info.terminal, false);
  assert.equal(describeFactoryJobForPanel({ status: "Nope" }), null);
  assert.equal(describeFactoryJobForPanel(null), null);
});

// ─── Derivation: both sections move ──────────────────────────────────────────

test("activity derivation: factory-active row is in-progress/implementing", () => {
  assert.deepEqual(deriveActivityStatus(7, emptyReview(), null, "OPEN", true), {
    status: "in-progress",
    phase: "implementing",
  });
  assert.deepEqual(
    deriveActivityStatus(7, emptyReview(), null, "OPEN", false).status,
    "pending",
  );
});

test("kanban derivation: factory-active card is in-progress (same rule)", () => {
  assert.equal(
    deriveKanbanStatus(7, emptyReview(), null, "OPEN", true),
    "in-progress",
  );
  assert.equal(
    deriveKanbanStatus(7, emptyReview(), null, "OPEN", false),
    "backlog",
  );
  assert.equal(deriveKanbanStatus(7, emptyReview(), null, "OPEN"), "backlog");
});

test("kanban adapter: card with an active queued job moves to in-progress", () => {
  const withJob = new LiveIssuesAdapter({
    readIssues: () => [node(7)],
    readReview: () => emptyReview(),
    readResolvingIssueNumber: () => null,
    readFactoryJobs: () => [queuedJob()],
  });
  const issues = withJob.listIssues();
  assert.equal(issues.length, 1);
  assert.equal(issues[0].status, "in-progress");

  const withoutJob = new LiveIssuesAdapter({
    readIssues: () => [node(7)],
    readReview: () => emptyReview(),
    readResolvingIssueNumber: () => null,
    readFactoryJobs: () => [],
  });
  assert.equal(withoutJob.listIssues()[0].status, "backlog");
});

test("activity adapter: row with an active queued job is in-progress with live stage + session", () => {
  const adapter = new LiveActivityAdapter({
    readIssues: () => [node(7)],
    readReview: () => ({
      ...emptyReview(),
      headRefByIssue: {},
    }),
    readResolvingIssueNumber: () => null,
    readProjectName: () => undefined,
    readActivityByRepo: () => ({}),
    readFactoryJobs: () => [
      queuedJob({ status: "Triage", dashboardUrl: SESSION_URL }),
    ],
  });
  const issues = adapter.listActivityIssues();
  assert.equal(issues.length, 1);
  const row = issues[0];
  assert.equal(row.status, "in-progress");
  assert.equal(row.phase, "implementing");
  assert.ok(row.factory, "live factory snapshot attached");
  assert.equal(row.factory?.stage, "Triage");
  assert.equal(row.factory?.family, "queued");
  assert.equal(row.factory?.sessionUrl, SESSION_URL);

  const idle = new LiveActivityAdapter({
    readIssues: () => [node(7)],
    readReview: () => ({ ...emptyReview(), headRefByIssue: {} }),
    readResolvingIssueNumber: () => null,
    readProjectName: () => undefined,
    readActivityByRepo: () => ({}),
    readFactoryJobs: () => [],
  });
  const idleRow = idle.listActivityIssues()[0];
  assert.equal(idleRow.status, "pending");
  assert.equal(idleRow.factory, undefined);
});

// ─── View Agent: live URL or honest disabled ─────────────────────────────────

test("describe: session opens the live URL when present, disables honestly without one", () => {
  const live = byKind(
    describeActivityActions(
      baseArgs({ factory: { available: true, active: true, sessionUrl: SESSION_URL } }),
    ),
  ).get("session");
  assert.equal(live?.label, "View Agent");
  assert.equal(live?.enabled, true);

  const starting = byKind(
    describeActivityActions(
      baseArgs({ factory: { available: true, active: true, sessionUrl: null } }),
    ),
  ).get("session");
  assert.equal(starting?.enabled, false, "no live link yet = disabled");
  assert.ok(
    typeof starting?.title === "string" && starting.title.length > 0,
    "disabled carries the reason",
  );

  // Legacy call sites without factory info keep the enabled placeholder.
  const legacy = byKind(describeActivityActions(baseArgs())).get("session");
  assert.equal(legacy?.label, "View Agent");
  assert.equal(legacy?.enabled, true);
});

test("invoke: session opens the live URL; without one it never opens a dead tab", async () => {
  const opened: string[] = [];
  await invokeActivityAction("session", 7, undefined, {
    sessionUrl: SESSION_URL,
    openUrl: (url: string) => {
      opened.push(url);
    },
  });
  assert.deepEqual(opened, [SESSION_URL]);

  const openedNone: string[] = [];
  const notices: string[] = [];
  await invokeActivityAction("session", 7, undefined, {
    sessionUrl: null,
    openUrl: (url: string) => {
      openedNone.push(url);
    },
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.deepEqual(openedNone, [], "never opens without a live URL");
  assert.equal(notices.length, 1, "honest feedback instead of a dead click");
  assert.ok(notices[0].length > 0);
});
