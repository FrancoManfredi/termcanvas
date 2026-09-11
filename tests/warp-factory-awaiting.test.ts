/**
 * warp-factory-awaiting — factory jobs waiting for the human move rows to
 * awaiting/YOUR TURN with acting CTAs (Approve / Respond / Accept).
 *
 * Contract under test (offline: zero network, zero jobs created):
 * - `readFactoryJobHumanNeed` (H1 → H2 → H3 → H4, active jobs only):
 *   Triage + pending spec approval → spec-approval; Triage + unanswered
 *   triage questions → triage-respond; Review + lastReview ask_human →
 *   ask-human; fallback = pending ask_human notification linked by
 *   workItemId. Terminal/junk shapes never claim a gate.
 * - `matchPendingAskHumanNotification`: pending + kind + linked job only.
 * - `readFactoryJobCostSummary` + `describeFactoryJobForPanel`: cost
 *   passthrough with the CostBadge honesty (null = off, undefined = no
 *   data yet, never an invented 0.00).
 * - `deriveActivityStatus` rows F-A1–F-A4: a waiting job is awaiting
 *   (beats generic I3 implementing); live canvas terminals (I1/I2) keep
 *   priority; no live job + a gate kind never fires.
 * - `LiveActivityAdapter` with injected poll lists: Triage/spec-pending,
 *   Triage/questions, and Review/ask_human jobs attach `factoryAwaiting`
 *   and move rows to awaiting with the honest action.
 * - `describeActivityActions` human gates: Approve/Respond/Accept enable
 *   only for the matching kind + usable job id; all refuse while any
 *   canvas op runs; Respond additionally needs a drafted answer.
 * - `invokeActivityAction` human gates: existing daemon routes via
 *   injected seams (approve → spec/approve, respond → triage/respond,
 *   accept → review/accept); junk ids/kind mismatches/busy refuse
 *   silently; failures and empty answers notify honestly; double-clicks
 *   debounce per job; throwing seams never throw.
 * - View Agent reactivity: the same job without `dashboardUrl` leaves the
 *   session CTA honestly disabled; with it (next poll) the CTA enables —
 *   the URL is never synthesized.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { IssueNodeData } from "../src/stores/issueStore.ts";
import {
  describeFactoryJobForPanel,
  matchPendingAskHumanNotification,
  readFactoryJobCostSummary,
  readFactoryJobHumanNeed,
} from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";
import { deriveActivityStatus } from "../src/features/warpPanel/adapters/activityDerivation.ts";
import type { LiveReviewSnapshot } from "../src/features/warpPanel/adapters/liveIssues.ts";
import { LiveActivityAdapter } from "../src/features/warpPanel/adapters/liveActivity.ts";
import {
  describeActivityActions,
  invokeActivityAction,
  summarizeDiscardCleaned,
  type DescribeActivityActionsArgs,
  type FactoryHumanActionResult,
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
const JOB_ID = "job-abc123";

function issueRefMeta(issueNumber = 7, repo: string | null = "org/termcanvas") {
  return {
    id: "job-7-t1",
    from: "Intake",
    to: "Triage",
    at: new Date().toISOString(),
    actor: "system",
    message: "resolve link github#7 (org/termcanvas)",
    meta: {
      issueRef: { provider: "github", issueNumber, repo, url: ISSUE_URL },
    },
  };
}

function timelineEntry(
  message: string,
  meta: Record<string, unknown>,
  from = "Triage",
) {
  return {
    id: `job-t-${message.length}-${Math.random().toString(36).slice(2, 6)}`,
    from,
    to: from,
    at: new Date().toISOString(),
    actor: "system",
    message,
    meta,
  };
}

/** Base poll-list job linked to issue #7 (active Triage by default). */
function triageJob(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOB_ID,
    prompt: "Resolve issue #7",
    worktree: "C:/repos/wt-7",
    phase: "diagnosisLlm",
    status: "Triage",
    state: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: [issueRefMeta()],
    ...patch,
  };
}

function specPendingTimeline(summary = "Add a spec-gated feature") {
  return [
    issueRefMeta(),
    timelineEntry("spec no-trivial — espera aprobación", {
      needsSpecApproval: true,
      specSummary: summary,
    }),
  ];
}

function questionsTimeline(questions: string[] = ["Which area?", "What goal?"]) {
  return [
    issueRefMeta(),
    timelineEntry("triage triage (simple)", {
      triage: {
        decision: "triage",
        scope: "needs input",
        complexity: "simple",
        openQuestions: questions,
        reason: "ambiguous prompt",
        confidence: 0.6,
      },
    }),
  ];
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

function busyArgs(
  patch: Partial<DescribeActivityActionsArgs> = {},
): DescribeActivityActionsArgs {
  return baseArgs({
    busy: {
      resolving: false,
      reviewing: true,
      fixing: false,
      merging: false,
      resolvingConflict: false,
      anyActive: true,
    },
    ...patch,
  });
}

function byKind(defs: ReturnType<typeof describeActivityActions>) {
  return new Map(defs.map((d) => [d.kind, d]));
}

function okSeam(calls: { count: number }): () => Promise<FactoryHumanActionResult> {
  return async () => {
    calls.count += 1;
    return { ok: true, error: "" };
  };
}

function failSeam(
  calls: { count: number },
  error = "job not in Triage (status=Foreman)",
): () => Promise<FactoryHumanActionResult> {
  return async () => {
    calls.count += 1;
    return { ok: false, error };
  };
}

// ─── H0: parked turn (bootInterrupted) dominates every other gate ────────

test("need H0: Building + bootInterrupted marker is resume", () => {
  const need = readFactoryJobHumanNeed(
    triageJob({
      status: "Building",
      state: "running",
      timeline: [
        issueRefMeta(),
        timelineEntry("daemon reiniciado: turno interrumpido", {
          bootInterrupted: true,
          fromStatus: "Building",
        }),
      ],
    }),
  );
  assert.ok(need !== null);
  assert.equal(need.kind, "resume");
  assert.equal(need.jobId, JOB_ID);
});

test("need H0: resumed marker clears the park (falls through to other gates)", () => {
  const need = readFactoryJobHumanNeed(
    triageJob({
      status: "Building",
      state: "running",
      timeline: [
        issueRefMeta(),
        timelineEntry("daemon reiniciado: turno interrumpido", {
          bootInterrupted: true,
        }),
        timelineEntry("turno retomado por humano", { resumed: true }),
      ],
    }),
  );
  assert.equal(need, null);
});

test("need H0: marker on non-worker status reports nothing", () => {
  const need = readFactoryJobHumanNeed(
    triageJob({
      status: "Triage",
      timeline: [
        issueRefMeta(),
        timelineEntry("daemon reiniciado: turno interrumpido", {
          bootInterrupted: true,
        }),
      ],
    }),
  );
  assert.equal(need, null);
});

// ─── H1: spec approval ─────────────────────────────────────────────────────
test("need H1: Triage + specApprovalPending extra is spec-approval", () => {
  const need = readFactoryJobHumanNeed(
    triageJob({
      specApprovalPending: true,
      spec: {
        summary: "Build it",
        acceptanceCriteria: ["done"],
        targetFiles: [],
        trivial: false,
        openQuestions: [],
      },
    }),
  );
  assert.ok(need !== null);
  assert.equal(need.kind, "spec-approval");
  assert.equal(need.jobId, JOB_ID);
  assert.equal(need.specSummary, "Build it");
});

test("need H1: Triage + timeline needsSpecApproval meta (no extras) works", () => {
  const need = readFactoryJobHumanNeed(
    triageJob({ timeline: specPendingTimeline("Ship v2") }),
  );
  assert.ok(need !== null);
  assert.equal(need.kind, "spec-approval");
  assert.equal(need.specSummary, "Ship v2");
});

test("need H1: spec meta outside Triage, or terminal jobs, report nothing", () => {
  assert.equal(
    readFactoryJobHumanNeed(
      triageJob({ status: "Building", timeline: specPendingTimeline() }),
    ),
    null,
    "not in Triage = no spec gate",
  );
  assert.equal(
    readFactoryJobHumanNeed(
      triageJob({ status: "Complete", state: "done", timeline: specPendingTimeline() }),
    ),
    null,
    "terminal frees the row even with a stale meta",
  );
});

// ─── H2: triage questions ──────────────────────────────────────────────────

test("need H2: Triage + extras openQuestions is triage-respond", () => {
  const need = readFactoryJobHumanNeed(
    triageJob({
      triage: {
        decision: "triage",
        scope: "x",
        complexity: "simple",
        openQuestions: ["Which area?", "  ", "What goal?"],
        reason: "ambiguous",
        confidence: 0.6,
      },
    }),
  );
  assert.ok(need !== null);
  assert.equal(need.kind, "triage-respond");
  assert.deepEqual(need.questions, ["Which area?", "What goal?"]);
});

test("need H2: timeline meta questions work; answered jobs report nothing", () => {
  const need = readFactoryJobHumanNeed(
    triageJob({ timeline: questionsTimeline() }),
  );
  assert.ok(need !== null);
  assert.equal(need.kind, "triage-respond");
  assert.equal(need.questions?.length, 2);

  const answered = readFactoryJobHumanNeed(
    triageJob({
      timeline: [
        ...questionsTimeline(),
        timelineEntry("triage respond (1 respuestas)", {
          triageRespond: { answers: ["The API area"] },
        }),
      ],
    }),
  );
  assert.equal(answered, null, "answered triage is not a gate");
});

test("need H2: empty questions, non-Triage, and terminal report nothing", () => {
  assert.equal(
    readFactoryJobHumanNeed(triageJob({ timeline: [issueRefMeta()] })),
    null,
  );
  assert.equal(
    readFactoryJobHumanNeed(
      triageJob({ status: "Building", timeline: questionsTimeline() }),
    ),
    null,
  );
  assert.equal(
    readFactoryJobHumanNeed(
      triageJob({
        status: "Cancelled",
        state: "error",
        timeline: questionsTimeline(),
      }),
    ),
    null,
  );
});

test("need precedence: spec approval beats triage questions", () => {
  const need = readFactoryJobHumanNeed(
    triageJob({
      timeline: [...specPendingTimeline(), ...questionsTimeline().slice(1)],
    }),
  );
  assert.ok(need !== null);
  assert.equal(need.kind, "spec-approval");
});

// ─── H3: ask_human review ──────────────────────────────────────────────────

function reviewJob(patch: Record<string, unknown> = {}) {
  return triageJob({
    status: "Review",
    state: "running",
    reviewCount: 2,
    lastReview: {
      workItemId: JOB_ID,
      reviewerModel: { providerID: "a", modelID: "b" },
      verdict: "ask_human",
      confidence: 0.5,
      summary: "Ambiguous scope",
      findings: [],
      reviewAttempt: 3,
      reviewedAt: new Date().toISOString(),
    },
    ...patch,
  });
}

test("need H3: Review + lastReview ask_human is ask-human", () => {
  const need = readFactoryJobHumanNeed(reviewJob());
  assert.ok(need !== null);
  assert.equal(need.kind, "ask-human");
  assert.equal(need.jobId, JOB_ID);
  assert.equal(need.reviewSummary, "Ambiguous scope");
});

test("need H3: accept verdicts, non-Review, and terminal report nothing", () => {
  const accepted = reviewJob();
  (accepted.lastReview as Record<string, unknown>).verdict = "accept";
  assert.equal(readFactoryJobHumanNeed(accepted), null);

  const wrongStatus = reviewJob({ status: "Building" });
  assert.equal(readFactoryJobHumanNeed(wrongStatus), null);

  const terminal = reviewJob({ status: "Complete", state: "done" });
  assert.equal(readFactoryJobHumanNeed(terminal), null);
});

// ─── H4: pending-notification fallback ─────────────────────────────────────

function askHumanNotification(patch: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    kind: "ask_human",
    workItemId: JOB_ID,
    title: "Needs you",
    body: "Decide",
    at: new Date().toISOString(),
    acked: false,
    ...patch,
  };
}

test("need H4: pending ask_human notification linked by jobId is ask-human", () => {
  // Active job, no structured signal legible (Building, no extras).
  const job = triageJob({ status: "Building", timeline: [issueRefMeta()] });
  assert.equal(readFactoryJobHumanNeed(job), null, "no signal, no gate");
  const need = readFactoryJobHumanNeed(job, [askHumanNotification()]);
  assert.ok(need !== null);
  assert.equal(need.kind, "ask-human");
  assert.equal(need.jobId, JOB_ID);
});

test("need H4: acked, other-kind, other-job, and junk never match", () => {
  const job = triageJob({ status: "Building", timeline: [issueRefMeta()] });
  assert.equal(
    readFactoryJobHumanNeed(job, [askHumanNotification({ acked: true })]),
    null,
  );
  assert.equal(
    readFactoryJobHumanNeed(job, [askHumanNotification({ kind: "spec-approval" })]),
    null,
  );
  assert.equal(
    readFactoryJobHumanNeed(job, [askHumanNotification({ workItemId: "job-other" })]),
    null,
  );
  assert.equal(readFactoryJobHumanNeed(job, []), null);
  assert.equal(readFactoryJobHumanNeed(job, null), null);
  // Terminal job + pending notification: completion wins, no gate.
  const done = triageJob({
    status: "Complete",
    state: "done",
    timeline: [issueRefMeta()],
  });
  assert.equal(readFactoryJobHumanNeed(done, [askHumanNotification()]), null);
});

test("matchPendingAskHumanNotification: direct matcher guards", () => {
  assert.deepEqual(
    matchPendingAskHumanNotification([askHumanNotification()], JOB_ID),
    { notificationId: "n-1" },
  );
  assert.equal(matchPendingAskHumanNotification([askHumanNotification()], ""), null);
  assert.equal(matchPendingAskHumanNotification([askHumanNotification()], null), null);
  assert.equal(matchPendingAskHumanNotification("junk", JOB_ID), null);
  assert.equal(matchPendingAskHumanNotification([null, 42], JOB_ID), null);
});

test("need: junk and inactive shapes never claim a gate", () => {
  assert.equal(readFactoryJobHumanNeed(null), null);
  assert.equal(readFactoryJobHumanNeed({}), null);
  assert.equal(readFactoryJobHumanNeed("queued"), null);
  assert.equal(readFactoryJobHumanNeed(triageJob({ id: "" })), null);
  assert.equal(readFactoryJobHumanNeed({ status: "Planning" }), null);
  assert.equal(readFactoryJobHumanNeed({ status: "Complete" }), null);
});

// ─── Cost passthrough ──────────────────────────────────────────────────────

test("cost: null passes through (off), absent is undefined, junk is undefined", () => {
  assert.equal(readFactoryJobCostSummary(triageJob({ costSummary: null })), null);
  assert.equal(readFactoryJobCostSummary(triageJob()), undefined);
  assert.equal(readFactoryJobCostSummary(triageJob({ costSummary: 42 })), undefined);
  assert.equal(readFactoryJobCostSummary(null), undefined);
});

test("panel snapshot threads costSummary; absent stays absent", () => {
  const summary = {
    llmCalls: 3,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    estimatedUSD: 0.0042,
    basis: "estimated-chars/4",
    ratesRef: "factory.yaml",
  };
  const info = describeFactoryJobForPanel(
    triageJob({ status: "Building", costSummary: summary }),
  );
  assert.ok(info !== null);
  assert.deepEqual(info.costSummary, summary);

  const off = describeFactoryJobForPanel(
    triageJob({ status: "Building", costSummary: null }),
  );
  assert.ok(off !== null);
  assert.equal(off.costSummary, null);

  const none = describeFactoryJobForPanel(triageJob({ status: "Building" }));
  assert.ok(none !== null);
  assert.equal("costSummary" in none, false);
});

// ─── Derivation rows F-A1–F-A4 ─────────────────────────────────────────────

test("derivation: waiting job is awaiting (beats generic I3 implementing)", () => {
  for (const kind of ["spec-approval", "triage-respond", "ask-human"] as const) {
    assert.deepEqual(
      deriveActivityStatus(7, emptyReview(), null, "OPEN", true, kind),
      { status: "awaiting", awaitingAction: kind },
      `${kind} maps 1:1 onto the awaiting action`,
    );
  }
});

test("derivation: live canvas terminals (I1/I2) keep priority over the gate", () => {
  assert.deepEqual(
    deriveActivityStatus(
      7,
      { ...emptyReview(), fixingIssueNumber: 7 },
      null,
      "OPEN",
      true,
      "spec-approval",
    ),
    { status: "in-progress", phase: "fixing" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      7,
      { ...emptyReview(), reviewingIssueNumber: 7 },
      null,
      "OPEN",
      true,
      "triage-respond",
    ),
    { status: "in-progress", phase: "reviewing" },
  );
});

test("derivation: gate without a live job, or junk kinds, never fires", () => {
  assert.deepEqual(
    deriveActivityStatus(7, emptyReview(), null, "OPEN", false, "spec-approval").status,
    "pending",
  );
  assert.deepEqual(
    deriveActivityStatus(7, emptyReview(), null, "OPEN", true, "merge-ready"),
    { status: "in-progress", phase: "implementing" },
    "canvas awaiting kinds are not factory gates (falls to I3)",
  );
  assert.deepEqual(
    deriveActivityStatus(7, emptyReview(), null, "OPEN", true, null),
    { status: "in-progress", phase: "implementing" },
  );
});

// ─── Adapter: rows move + need attaches ────────────────────────────────────

function activityAdapterWith(jobs: unknown[], notifications: unknown[] = []) {
  return new LiveActivityAdapter({
    readIssues: () => [node(7)],
    readReview: () => ({ ...emptyReview(), headRefByIssue: {} }),
    readResolvingIssueNumber: () => null,
    readProjectName: () => undefined,
    readActivityByRepo: () => ({}),
    readFactoryJobs: () => jobs,
    readNotifications: () => notifications,
  });
}

test("adapter: spec-pending job is awaiting/spec-approval with need attached", () => {
  const rows = activityAdapterWith([
    triageJob({ timeline: specPendingTimeline("Ship it") }),
  ]).listActivityIssues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "awaiting");
  assert.equal(rows[0].awaitingAction, "spec-approval");
  assert.deepEqual(rows[0].factoryAwaiting, {
    kind: "spec-approval",
    jobId: JOB_ID,
    specSummary: "Ship it",
  });
  assert.ok(rows[0].factory, "stage snapshot still attached");
});

test("adapter: questions job is awaiting/triage-respond with questions", () => {
  const rows = activityAdapterWith([
    triageJob({ timeline: questionsTimeline(["Q1?", "Q2?"]) }),
  ]).listActivityIssues();
  assert.equal(rows[0].status, "awaiting");
  assert.equal(rows[0].awaitingAction, "triage-respond");
  assert.deepEqual(rows[0].factoryAwaiting?.questions, ["Q1?", "Q2?"]);
});

test("adapter: ask_human job is awaiting/ask-human with review summary", () => {
  const rows = activityAdapterWith([reviewJob()]).listActivityIssues();
  assert.equal(rows[0].status, "awaiting");
  assert.equal(rows[0].awaitingAction, "ask-human");
  assert.equal(rows[0].factoryAwaiting?.reviewSummary, "Ambiguous scope");
});

test("adapter: H4 fallback activates from threaded notifications", () => {
  const job = triageJob({ status: "Building", timeline: [issueRefMeta()] });
  const idle = activityAdapterWith([job]).listActivityIssues()[0];
  assert.equal(idle.status, "in-progress", "no signal = generic implementing");

  const waiting = activityAdapterWith([job], [askHumanNotification()]).listActivityIssues()[0];
  assert.equal(waiting.status, "awaiting");
  assert.equal(waiting.awaitingAction, "ask-human");
  assert.equal(waiting.factoryAwaiting?.jobId, JOB_ID);
});

// ─── View Agent reactivity ─────────────────────────────────────────────────

test("view agent: session CTA flips disabled→enabled when dashboardUrl arrives", () => {
  // "Next poll" = a NEW array with new item objects (the shared job index
  // memoizes by array identity — mutating in place is not a real poll and
  // would keep serving the stale index).
  const holder: { jobs: Record<string, unknown>[] } = {
    jobs: [triageJob({ status: "Building" })],
  };
  const adapter = new LiveActivityAdapter({
    readIssues: () => [node(7)],
    readReview: () => ({ ...emptyReview(), headRefByIssue: {} }),
    readResolvingIssueNumber: () => null,
    readProjectName: () => undefined,
    readActivityByRepo: () => ({}),
    readFactoryJobs: () => holder.jobs,
    readNotifications: () => [],
  });

  const before = adapter.listActivityIssues()[0];
  assert.equal(before.factory?.sessionUrl, undefined);
  const beforeDef = byKind(
    describeActivityActions(
      baseArgs({
        factory: {
          available: true,
          active: true,
          sessionUrl: before.factory?.sessionUrl ?? null,
        },
      }),
    ),
  ).get("session");
  assert.equal(beforeDef?.enabled, false, "no live link yet = disabled");

  // Next poll: the daemon attached the session — same job id, new field.
  holder.jobs = [{ ...holder.jobs[0], dashboardUrl: SESSION_URL }];
  const after = adapter.listActivityIssues()[0];
  assert.equal(after.factory?.sessionUrl, SESSION_URL, "no synthesis, passthrough");
  const afterDef = byKind(
    describeActivityActions(
      baseArgs({
        factory: {
          available: true,
          active: true,
          sessionUrl: after.factory?.sessionUrl ?? null,
        },
      }),
    ),
  ).get("session");
  assert.equal(afterDef?.enabled, true, "URL arrival enables reactively");
});

// ─── Describe guards: human gates ──────────────────────────────────────────

test("describe: approve/respond/accept enable only for the matching gate", () => {
  const spec = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "spec-approval", jobId: JOB_ID },
      }),
    ),
  );
  assert.equal(spec.get("approve-spec")?.enabled, true);
  assert.ok((spec.get("approve-spec")?.title ?? "").length > 0);
  assert.equal(spec.get("reject-spec")?.label, "Reject Spec");
  assert.equal(spec.get("reject-spec")?.enabled, true);
  assert.ok((spec.get("reject-spec")?.title ?? "").length > 0);
  assert.equal(spec.get("triage-respond")?.enabled, false);
  assert.equal(spec.get("review-accept")?.enabled, false);

  const triage = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "triage-respond", jobId: JOB_ID },
        triageAnswersReady: true,
      }),
    ),
  );
  assert.equal(triage.get("triage-respond")?.enabled, true);
  assert.equal(triage.get("approve-spec")?.enabled, false);

  const human = byKind(
    describeActivityActions(
      baseArgs({ factoryAwaiting: { kind: "ask-human", jobId: JOB_ID } }),
    ),
  );
  assert.equal(human.get("review-accept")?.label, "Accept");
  assert.equal(human.get("review-accept")?.enabled, true);
  assert.equal(human.get("review-reject")?.label, "Reject");
  assert.equal(human.get("review-reject")?.enabled, true);
});

test("describe: human gates refuse while busy, without job id, or without answers", () => {
  const busy = byKind(
    describeActivityActions(
      busyArgs({ factoryAwaiting: { kind: "spec-approval", jobId: JOB_ID } }),
    ),
  );
  assert.equal(busy.get("approve-spec")?.enabled, false);
  assert.ok(
    (busy.get("approve-spec")?.title ?? "").length > 0,
    "disabled carries the reason",
  );
  assert.equal(busy.get("reject-spec")?.enabled, false);
  assert.ok(
    (busy.get("reject-spec")?.title ?? "").length > 0,
    "reject disabled carries the reason",
  );

  const noId = byKind(
    describeActivityActions(
      baseArgs({ factoryAwaiting: { kind: "spec-approval", jobId: "  " } }),
    ),
  );
  assert.equal(noId.get("approve-spec")?.enabled, false);

  const noAnswers = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "triage-respond", jobId: JOB_ID },
        triageAnswersReady: false,
      }),
    ),
  );
  assert.equal(noAnswers.get("triage-respond")?.enabled, false);
  assert.match(
    noAnswers.get("triage-respond")?.title ?? "",
    /at least one answer/,
  );

  const absent = byKind(describeActivityActions(baseArgs()));
  assert.equal(absent.get("approve-spec")?.enabled, false);
  assert.equal(absent.get("reject-spec")?.enabled, false);
  assert.equal(absent.get("resume")?.enabled, false);
  assert.equal(absent.get("triage-respond")?.enabled, false);
  assert.equal(absent.get("review-accept")?.enabled, false);
  assert.equal(absent.get("review-reject")?.enabled, false);
});

// ─── Invoke: human gates act via existing routes ───────────────────────────

test("describe: resume enables only for the parked gate", () => {
  const parked = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "resume", jobId: JOB_ID },
      }),
    ),
  );
  assert.equal(parked.get("resume")?.label, "Retomar trabajo");
  assert.equal(parked.get("resume")?.enabled, true);
  assert.ok((parked.get("resume")?.title ?? "").length > 0);
  assert.equal(parked.get("approve-spec")?.enabled, false);

  const other = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "spec-approval", jobId: JOB_ID },
      }),
    ),
  );
  assert.equal(other.get("resume")?.enabled, false);
});

// ─── Invoke: human gates act via existing routes ───────────────────────────

test("invoke: approve-spec notifies success; daemon errors surface honestly", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("approve-spec", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "spec-approval",
    approveSpecJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], new RegExp(JOB_ID));
  assert.match(notices[0], /resumes in Foreman/);

  const failCalls = { count: 0 };
  const failNotices: string[] = [];
  await invokeActivityAction("approve-spec", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "spec-approval",
    approveSpecJob: failSeam(failCalls),
    notify: (message: string) => {
      failNotices.push(message);
    },
  });
  assert.equal(failCalls.count, 1);
  assert.equal(failNotices.length, 1);
  assert.match(failNotices[0], /Could not approve/);
  assert.match(failNotices[0], /not in Triage/);
});

test("invoke: reject-spec notifies success; daemon errors surface honestly", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("reject-spec", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "spec-approval",
    rejectSpecJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], new RegExp(JOB_ID));
  assert.match(notices[0], /new brief/);

  const failCalls = { count: 0 };
  const failNotices: string[] = [];
  await invokeActivityAction("reject-spec", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "spec-approval",
    rejectSpecJob: failSeam(failCalls),
    notify: (message: string) => {
      failNotices.push(message);
    },
  });
  assert.equal(failCalls.count, 1);
  assert.equal(failNotices.length, 1);
  assert.match(failNotices[0], /Could not reject/);
  assert.match(failNotices[0], /not in Triage/);
});

test("invoke: resume notifies success; daemon errors surface honestly", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("resume", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "resume",
    resumeJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], new RegExp(JOB_ID));
  assert.match(notices[0], /picks it up/);

  const failCalls = { count: 0 };
  const failNotices: string[] = [];
  await invokeActivityAction("resume", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "resume",
    resumeJob: failSeam(failCalls),
    notify: (message: string) => {
      failNotices.push(message);
    },
  });
  assert.equal(failCalls.count, 1);
  assert.equal(failNotices.length, 1);
  assert.match(failNotices[0], /Could not resume/);
});

test("describe: discard mirrors the parked gate (no retomar trabajo)", () => {
  const parked = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "resume", jobId: JOB_ID },
      }),
    ),
  );
  assert.equal(parked.get("discard")?.label, "No retomar trabajo");
  assert.equal(parked.get("discard")?.enabled, true);
  assert.ok((parked.get("discard")?.title ?? "").length > 0);

  const other = byKind(
    describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "spec-approval", jobId: JOB_ID },
      }),
    ),
  );
  assert.equal(other.get("discard")?.enabled, false);

  const busy = byKind(
    describeActivityActions(
      busyArgs({
        factoryAwaiting: { kind: "resume", jobId: JOB_ID },
      }),
    ),
  );
  assert.equal(busy.get("discard")?.enabled, false);

  const absent = byKind(describeActivityActions(baseArgs()));
  assert.equal(absent.get("discard")?.enabled, false);
});

test("invoke: discard notifies success; daemon errors surface honestly", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("discard", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "resume",
    discardJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], new RegExp(JOB_ID));
  assert.match(notices[0], /branch\/worktree\/job removed/);

  const failCalls = { count: 0 };
  const failNotices: string[] = [];
  await invokeActivityAction("discard", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "resume",
    discardJob: failSeam(failCalls, "job already error"),
    notify: (message: string) => {
      failNotices.push(message);
    },
  });
  assert.equal(failCalls.count, 1);
  assert.equal(failNotices.length, 1);
  assert.match(failNotices[0], /Could not discard/);

  const staleCalls = { count: 0 };
  const staleNotices: string[] = [];
  await invokeActivityAction("discard", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "ask-human",
    discardJob: okSeam(staleCalls),
    notify: (message: string) => {
      staleNotices.push(message);
    },
  });
  assert.equal(staleCalls.count, 0, "stale kind mismatch refuses silently");
  assert.equal(staleNotices.length, 0);
});

test("invoke: discard appends the daemon teardown summary to the notify", async () => {
  const notices: string[] = [];
  await invokeActivityAction("discard", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "resume",
    discardJob: async () => ({
      ok: true,
      error: "",
      summary: "PR closed: 1, branch deleted: 1, job deleted: yes",
    }),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Discarded job/);
  assert.match(notices[0], /PR closed: 1/);
  assert.match(notices[0], /job deleted: yes/);
});

test("summarizeDiscardCleaned: honest teardown summary (skips visible, junk empty)", () => {
  const full = summarizeDiscardCleaned({
    cleaned: {
      prClosed: ["PR #42"],
      branchDeleted: ["issue-7"],
      worktreeRemoved: ["/wt"],
      deleted: ["a.txt", "b.txt"],
      restored: ["c.txt"],
      skipped: [],
      jobDeleted: true,
    },
  });
  assert.match(full, /PR closed: 1/);
  assert.match(full, /branch deleted: 1/);
  assert.match(full, /worktree removed: 1/);
  assert.match(full, /files deleted\/restored: 2\/1/);
  assert.match(full, /job deleted: yes/);

  const partial = summarizeDiscardCleaned({
    cleaned: {
      prClosed: [],
      branchDeleted: [],
      worktreeRemoved: [],
      deleted: [],
      restored: [],
      skipped: ["(rama: no se pudo borrar issue-7)", "(PR: fallo)", "(x)", "(y)"],
      jobDeleted: false,
    },
  });
  assert.match(partial, /job deleted: NO/);
  assert.match(partial, /skipped:/);
  assert.match(partial, /no se pudo borrar/);
  assert.match(partial, /…/, "skips beyond the cap degrade to an ellipsis");

  assert.equal(summarizeDiscardCleaned(null), "");
  assert.equal(summarizeDiscardCleaned({ cleaned: { jobDeleted: "yes" } }), summarizeDiscardCleaned({ cleaned: {} }));
});

test("describe: discard enables for merge-ready rows with a linked job (No mergear)", () => {
  const ready = byKind(
    describeActivityActions(
      baseArgs({
        mergeReadyJobId: JOB_ID,
      }),
    ),
  );
  assert.equal(ready.get("discard")?.label, "No retomar trabajo");
  assert.equal(ready.get("discard")?.enabled, true);
  assert.match(ready.get("discard")?.title ?? "", /Don't merge/);

  const noId = byKind(describeActivityActions(baseArgs({ mergeReadyJobId: "  " })));
  assert.equal(noId.get("discard")?.enabled, false);

  const busy = byKind(
    describeActivityActions(busyArgs({ mergeReadyJobId: JOB_ID })),
  );
  assert.equal(busy.get("discard")?.enabled, false);
});

test("describe: re-review enables for merge-ready rows with a linked job", () => {
  const ready = byKind(
    describeActivityActions(
      baseArgs({
        mergeReadyJobId: JOB_ID,
      }),
    ),
  );
  assert.equal(ready.get("re-review")?.label, "Re-revisar");
  assert.equal(ready.get("re-review")?.enabled, true);
  assert.ok((ready.get("re-review")?.title ?? "").length > 0);

  const noId = byKind(describeActivityActions(baseArgs({ mergeReadyJobId: null })));
  assert.equal(noId.get("re-review")?.enabled, false);

  const busy = byKind(
    describeActivityActions(busyArgs({ mergeReadyJobId: JOB_ID })),
  );
  assert.equal(busy.get("re-review")?.enabled, false);
});

test("invoke: re-review notifies the verdict; daemon errors surface honestly", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("re-review", 7, undefined, {
    factoryJobId: JOB_ID,
    rerunReviewJob: async (jobId: string) => {
      calls.count += 1;
      assert.equal(jobId, JOB_ID);
      return { ok: true, error: "", summary: "re-review revise (2 findings): falta test" };
    },
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /re-review revise/);

  const failCalls = { count: 0 };
  const failNotices: string[] = [];
  await invokeActivityAction("re-review", 7, undefined, {
    factoryJobId: JOB_ID,
    rerunReviewJob: failSeam(failCalls, "solo jobs Complete se pueden re-revisar"),
    notify: (message: string) => {
      failNotices.push(message);
    },
  });
  assert.equal(failCalls.count, 1);
  assert.equal(failNotices.length, 1);
  assert.match(failNotices[0], /Could not re-review/);

  const gatedCalls = { count: 0 };
  const gatedNotices: string[] = [];
  await invokeActivityAction("re-review", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "ask-human",
    rerunReviewJob: okSeam(gatedCalls),
    notify: (message: string) => {
      gatedNotices.push(message);
    },
  });
  assert.equal(gatedCalls.count, 0, "gated rows use their own buttons");
  assert.equal(gatedNotices.length, 0);
});

test("invoke: discard from merge-ready rows needs no gate kind", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("discard", 7, undefined, {
    factoryJobId: JOB_ID,
    discardJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /branch\/worktree\/job removed/);
});

test("invoke: triage-respond sends cleaned answers; empty answers never hit the seam", async () => {
  const seen: { jobId: string; answers: string[] }[] = [];
  const notices: string[] = [];
  await invokeActivityAction("triage-respond", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "triage-respond",
    triageAnswers: ["  The API area  ", "", "  ", "v2"],
    respondTriageJob: async (jobId: string, answers: string[]) => {
      seen.push({ jobId, answers });
      return { ok: true, error: "" };
    },
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.deepEqual(seen, [{ jobId: JOB_ID, answers: ["The API area", "v2"] }]);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /resumes in Foreman/);

  const blocked = { count: 0 };
  const emptyNotices: string[] = [];
  await invokeActivityAction("triage-respond", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "triage-respond",
    triageAnswers: ["   ", ""],
    respondTriageJob: failSeam(blocked),
    notify: (message: string) => {
      emptyNotices.push(message);
    },
  });
  assert.equal(blocked.count, 0, "empty answers never reach the daemon");
  assert.equal(emptyNotices.length, 1);
  assert.match(emptyNotices[0], /at least one answer/);
});

test("invoke: review-accept notifies Review → Complete", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("review-accept", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "ask-human",
    acceptReviewJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.match(notices[0], /Review → Complete/);
});

test("invoke: review-reject notifies Review → Building; guards refuse silently", async () => {
  const calls = { count: 0 };
  const notices: string[] = [];
  await invokeActivityAction("review-reject", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "ask-human",
    rejectReviewJob: okSeam(calls),
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(calls.count, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /rejected/);
  assert.match(notices[0], /Building/);

  const failCalls = { count: 0 };
  const failNotices: string[] = [];
  await invokeActivityAction("review-reject", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "ask-human",
    rejectReviewJob: failSeam(failCalls),
    notify: (message: string) => {
      failNotices.push(message);
    },
  });
  assert.equal(failCalls.count, 1);
  assert.equal(failNotices.length, 1);
  assert.match(failNotices[0], /Could not reject/);

  // Wrong gate kind refuses silently (stale button after the poll moved on).
  const stale: string[] = [];
  await invokeActivityAction("review-reject", 7, undefined, {
    factoryJobId: JOB_ID,
    factoryAwaitingKind: "triage-respond",
    rejectReviewJob: okSeam({ count: 0 }),
    notify: (message: string) => {
      stale.push(message);
    },
  });
  assert.deepEqual(stale, []);
});

test("invoke: human-gate guards refuse silently (junk id, kind mismatch, busy)", async () => {
  for (const deps of [
    { factoryJobId: "", approveSpecJob: okSeam({ count: 0 }) },
    { factoryJobId: "../x", approveSpecJob: okSeam({ count: 0 }) },
    {
      factoryJobId: JOB_ID,
      factoryAwaitingKind: "triage-respond",
      approveSpecJob: okSeam({ count: 0 }),
    },
    {
      factoryJobId: JOB_ID,
      busy: { reviewing: true },
      approveSpecJob: okSeam({ count: 0 }),
    },
    {
      // anyActive alone (no individual flag) still refuses at invoke.
      factoryJobId: JOB_ID,
      busy: { anyActive: true },
      approveSpecJob: okSeam({ count: 0 }),
    },
  ]) {
    const notices: string[] = [];
    await invokeActivityAction("approve-spec", 7, undefined, {
      ...deps,
      notify: (message: string) => {
        notices.push(message);
      },
    });
    assert.deepEqual(notices, [], `silent refuse for ${JSON.stringify(deps.factoryJobId)}`);
  }
  // Unknown issue numbers refuse as well.
  const notices: string[] = [];
  await invokeActivityAction("approve-spec", -1, undefined, {
    factoryJobId: JOB_ID,
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.deepEqual(notices, []);
});

test("invoke: throwing seams never throw; concurrent clicks debounce per job", async () => {
  const notices: string[] = [];
  await invokeActivityAction("approve-spec", 7, undefined, {
    factoryJobId: JOB_ID,
    approveSpecJob: async () => {
      throw new Error("boom");
    },
    notify: (message: string) => {
      notices.push(message);
    },
  });
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Could not approve/);

  // Second click while the first POST is in flight debounces silently.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = { count: 0 };
  const slowSeam = async (): Promise<FactoryHumanActionResult> => {
    calls.count += 1;
    await gate;
    return { ok: true, error: "" };
  };
  const quiet: string[] = [];
  const first = invokeActivityAction("approve-spec", 7, undefined, {
    factoryJobId: JOB_ID,
    approveSpecJob: slowSeam,
    notify: (message: string) => {
      quiet.push(message);
    },
  });
  const second = invokeActivityAction("approve-spec", 7, undefined, {
    factoryJobId: JOB_ID,
    approveSpecJob: slowSeam,
    notify: (message: string) => {
      quiet.push(message);
    },
  });
  release();
  await Promise.all([first, second]);
  assert.equal(calls.count, 1, "single invoke per click per job");
  assert.equal(quiet.length, 1, "debounced click stays silent");
});
