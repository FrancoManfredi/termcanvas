import test from "node:test";
import assert from "node:assert/strict";
import type { IssueNodeData } from "../src/stores/issueStore.ts";
import type { IssueActivityEntry } from "../src/stores/issueActivityStore.ts";
import type { LiveReviewSnapshot } from "../src/features/warpPanel/adapters/liveIssues.ts";
import {
  assigneeForIssue,
  branchForIssue,
  deriveActivityStatus,
  mapIssueNodeToActivity,
  phaseStartedForIssue,
} from "../src/features/warpPanel/adapters/activityDerivation.ts";
import {
  describeActivityActions,
  invokeActivityAction,
  type ActivityActionDef,
  type DescribeActivityActionsArgs,
} from "../src/features/warpPanel/components/activityActions.ts";
import { LiveActivityAdapter } from "../src/features/warpPanel/adapters/liveActivity.ts";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_GATE_FAIL,
  REVIEW_LABEL_PENDING,
} from "../src/canvas/reviewVerdict.ts";
import { useIssueResolveStore } from "../src/stores/issueResolveStore.ts";
import { useIssueReviewStore } from "../src/stores/issueReviewStore.ts";

// ─── Shared fakes ──────────────────────────────────────────────────────────

function baseReview(
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

function linkedPr(number: number, state = "OPEN") {
  return {
    number,
    title: `Fix #7 (${number})`,
    url: `https://github.com/org/termcanvas/pull/${number}`,
    state,
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

function baseArgs(
  patch: Partial<DescribeActivityActionsArgs> = {},
): DescribeActivityActionsArgs {
  return {
    issueNumber: 7,
    prNumber: 50,
    prState: "OPEN",
    effective: REVIEW_LABEL_PENDING,
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

function byKind(defs: ActivityActionDef[]) {
  return new Map(defs.map((d) => [d.kind, d]));
}

// ─── Derivation table A1–A9 (first match wins) ─────────────────────────────

test("A1: done requires real merge evidence or CLOSED state, never invented", () => {
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({ primaryPrByIssue: { 7: linkedPr(50, "MERGED") } }),
      null,
    ),
    { status: "done" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({
        primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
        mergedPrNumbers: [50],
      }),
      null,
    ),
    { status: "done" },
  );
  assert.deepEqual(
    deriveActivityStatus(7, baseReview(), null, "CLOSED"),
    { status: "done" },
  );
  // Fresh OPEN issue: never done.
  assert.deepEqual(deriveActivityStatus(7, baseReview(), null, "OPEN"), {
    status: "pending",
  });
  assert.deepEqual(deriveActivityStatus(7, baseReview(), null), {
    status: "pending",
  });
});

test("A2: fixing flow or FIX_APPLIED verdict maps to in-progress/fixing", () => {
  assert.deepEqual(
    deriveActivityStatus(7, baseReview({ fixingIssueNumber: 7 }), null),
    { status: "in-progress", phase: "fixing" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({ labelsByIssue: { 7: [REVIEW_LABEL_FIX_APPLIED] } }),
      null,
    ),
    { status: "in-progress", phase: "fixing" },
  );
});

test("A3: reviewing flow or running gate maps to in-progress/reviewing", () => {
  assert.deepEqual(
    deriveActivityStatus(7, baseReview({ reviewingIssueNumber: 7 }), null),
    { status: "in-progress", phase: "reviewing" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({
        primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
        gateByPr: { 7: { 50: { status: "running", reportPath: null } } },
      }),
      null,
    ),
    { status: "in-progress", phase: "reviewing" },
  );
});

test("A4: resolving flow maps to in-progress/implementing", () => {
  assert.deepEqual(deriveActivityStatus(7, baseReview(), 7), {
    status: "in-progress",
    phase: "implementing",
  });
});

test("A5: aprobado on an OPEN PR maps to ready/merge-ready", () => {
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({
        primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
        labelsByIssue: { 7: [REVIEW_LABEL_APPROVED] },
      }),
      null,
    ),
    { status: "ready", awaitingAction: "merge-ready" },
  );
});

test("A6: comentado maps to awaiting/changes-requested", () => {
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({
        primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
        labelsByIssue: { 7: [REVIEW_LABEL_CHANGES] },
      }),
      null,
    ),
    { status: "awaiting", awaitingAction: "changes-requested" },
  );
});

test("A7: pendiente — or a brand-new OPEN PR — reads ready/merge-ready (neutral OPEN PR, nothing blocking)", () => {
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({
        primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
        labelsByIssue: { 7: [REVIEW_LABEL_PENDING] },
      }),
      null,
    ),
    { status: "ready", awaitingAction: "merge-ready" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({ primaryPrByIssue: { 7: linkedPr(50, "OPEN") } }),
      null,
    ),
    { status: "ready", awaitingAction: "merge-ready" },
  );
});

test("A8: merge/conflict-resolve busy alone maps to plain in-progress", () => {
  assert.deepEqual(
    deriveActivityStatus(7, baseReview({ mergingIssueNumber: 7 }), null),
    { status: "in-progress" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({ resolvingConflictIssueNumber: 7 }),
      null,
    ),
    { status: "in-progress" },
  );
});

test("A9: fresh canvas issue with no workflow state is pending", () => {
  assert.deepEqual(deriveActivityStatus(7, baseReview(), null), {
    status: "pending",
  });
});

// ─── Mapping honesty ───────────────────────────────────────────────────────

test("mapping: node fields pass through 1:1; url/worktreePath honest", () => {
  const mapped = mapIssueNodeToActivity(
    node(7, {
      title: "Fix the thing",
      body: "Long description",
      labels: [{ name: "bug", color: "ff0000" }, { name: "plain" }],
      createdAt: "2026-08-14",
      updatedAt: "2026-08-30",
      __worktreePath: "C:/repos/termcanvas",
    } as Partial<IssueNodeData>),
    { status: "pending" },
    baseReview(),
  );
  assert.equal(mapped.id, 7);
  assert.equal(mapped.title, "Fix the thing");
  assert.equal(mapped.body, "Long description");
  assert.deepEqual(mapped.labels, ["bug", "plain"]);
  assert.equal(mapped.createdAt, "2026-08-14");
  assert.equal(mapped.updatedAt, "2026-08-30");
  assert.equal(mapped.url, "https://github.com/org/termcanvas/issues/7");
  assert.equal(mapped.worktreePath, "C:/repos/termcanvas");
  assert.equal(mapped.branch, undefined);
  assert.equal(mapped.prNumber, undefined);
  assert.equal(mapped.assignee, undefined);
});

test("mapping: merge-ready propagates on ready rows (footer CTAs), stays absent otherwise", () => {
  const ready = mapIssueNodeToActivity(
    node(7),
    { status: "ready", awaitingAction: "merge-ready" },
    baseReview(),
  );
  assert.equal(ready.status, "ready");
  assert.equal(ready.awaitingAction, "merge-ready");
  const pending = mapIssueNodeToActivity(
    node(7),
    { status: "pending", awaitingAction: "merge-ready" },
    baseReview(),
  );
  assert.equal(pending.awaitingAction, undefined);
  const awaiting = mapIssueNodeToActivity(
    node(7),
    { status: "awaiting", awaitingAction: "resume" },
    baseReview(),
  );
  assert.equal(awaiting.awaitingAction, "resume");
});

test("mapping: malformed nodes degrade honestly, never throw", () => {
  const bad = mapIssueNodeToActivity(
    node(7, {
      issueNumber: "7" as unknown as number,
      title: 123 as unknown as string,
      body: null as unknown as string,
      url: 42 as unknown as string,
    }),
    { status: "pending" },
    baseReview(),
  );
  assert.equal(bad.id, 0);
  assert.equal(bad.title, "");
  assert.equal(bad.body, "");
  assert.equal(bad.url, undefined);
  const junkDerived = mapIssueNodeToActivity(
    node(8),
    { status: "bogus" } as unknown as { status: "pending" },
    baseReview(),
  );
  assert.equal(junkDerived.status, "pending");
});

test("mapping: prNumber resolves from the primary PR, else stays absent", () => {
  const withPr = mapIssueNodeToActivity(
    node(7),
    { status: "awaiting", awaitingAction: "review-ready" },
    baseReview({ primaryPrByIssue: { 7: linkedPr(50, "OPEN") } }),
  );
  assert.equal(withPr.prNumber, 50);
  const withoutPr = mapIssueNodeToActivity(
    node(7),
    { status: "pending" },
    baseReview(),
  );
  assert.equal(withoutPr.prNumber, undefined);
});

test("mapping: conflicted threads from conflictByPr (canvas prConflicted parity)", () => {
  const conflicted = mapIssueNodeToActivity(
    node(7),
    { status: "ready", awaitingAction: "merge-ready" },
    baseReview({
      primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
      conflictByPr: { 7: { 50: true } },
    }),
  );
  assert.equal(conflicted.conflicted, true);
  const clean = mapIssueNodeToActivity(
    node(7),
    { status: "ready", awaitingAction: "merge-ready" },
    baseReview({
      primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
      conflictByPr: { 7: { 50: false } },
    }),
  );
  assert.equal(clean.conflicted, undefined);
  const otherPr = mapIssueNodeToActivity(
    node(7),
    { status: "ready", awaitingAction: "merge-ready" },
    baseReview({
      primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
      conflictByPr: { 7: { 51: true } },
    }),
  );
  assert.equal(otherPr.conflicted, undefined);
  const noPr = mapIssueNodeToActivity(
    node(7),
    { status: "pending" },
    baseReview({ conflictByPr: { 7: { 50: true } } }),
  );
  assert.equal(noPr.conflicted, undefined);
});

test("branchForIssue: head ref wins, else issue-{n} while resolving, else absent", () => {
  assert.equal(branchForIssue(7, "feature/fix-7", null), "feature/fix-7");
  assert.equal(branchForIssue(7, "  ", 7), "issue-7");
  assert.equal(branchForIssue(7, null, 7), "issue-7");
  assert.equal(branchForIssue(7, null, null), undefined);
  assert.equal(branchForIssue(7, undefined, 3), undefined);
});

test("assigneeForIssue: deterministic role strings, never a person lookup", () => {
  assert.equal(
    assigneeForIssue(
      7,
      { status: "in-progress", phase: "fixing" },
      baseReview({ fixingIssueNumber: 7 }),
    ),
    "opencode-agent",
  );
  assert.equal(
    assigneeForIssue(
      7,
      { status: "awaiting", awaitingAction: "merge-ready" },
      baseReview(),
    ),
    "reviewer-agent",
  );
  // The canvas-only Review Issue flow was removed from the warp panel:
  // legacy `review-ready` rows no longer resolve to a reviewer agent.
  assert.equal(
    assigneeForIssue(
      7,
      { status: "awaiting", awaitingAction: "review-ready" },
      baseReview(),
    ),
    undefined,
  );
  assert.equal(
    assigneeForIssue(
      7,
      { status: "awaiting", awaitingAction: "changes-requested" },
      baseReview(),
    ),
    undefined,
  );
  assert.equal(
    assigneeForIssue(
      7,
      { status: "ready", awaitingAction: "merge-ready" },
      baseReview(),
    ),
    "reviewer-agent",
  );
  assert.equal(
    assigneeForIssue(7, { status: "pending" }, baseReview()),
    undefined,
  );
});

test("phaseStartedForIssue: latest activity entry wins, else updatedAt", () => {
  const at = Date.UTC(2026, 7, 30, 10, 5);
  const entries: IssueActivityEntry[] = [
    { type: "resolve", at: at - 1000 },
    { type: "review", at },
  ];
  const date = new Date(at);
  const pad = (v: number): string => String(v).padStart(2, "0");
  const expected =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  assert.equal(phaseStartedForIssue(entries, "2026-08-01"), expected);
  assert.equal(phaseStartedForIssue([], "2026-08-01"), "2026-08-01");
  assert.equal(phaseStartedForIssue(undefined, undefined), undefined);
  assert.equal(phaseStartedForIssue(null, ""), undefined);
});

// ─── describe: guard matrix ────────────────────────────────────────────────

test("describe: returns the full CTA set in stable order", () => {
  assert.deepEqual(
    describeActivityActions(baseArgs()).map((d) => d.kind),
    [
      "resolve",
      "session",
      "review",
      "fix",
      "merge",
      "conflict",
      "view-report",
      "override-gate",
      "approve-spec",
      "reject-spec",
      "resume",
      "discard",
      "re-review",
      "triage-respond",
      "review-accept",
      "review-reject",
      "review-retry",
      "github",
      "delete-worktree",
    ],
  );
});

test("describe: resolve + session keep Figma labels and honest busy state", () => {
  const idle = byKind(describeActivityActions(baseArgs()));
  assert.equal(idle.get("resolve")?.label, "Resolve Issue");
  assert.equal(idle.get("resolve")?.enabled, true);
  assert.equal(idle.get("session")?.label, "View Agent");
  assert.equal(idle.get("session")?.enabled, true);
  const busy = byKind(
    describeActivityActions(
      baseArgs({
        busy: { ...baseArgs().busy, resolving: true, anyActive: true },
      }),
    ),
  );
  assert.equal(busy.get("resolve")?.label, "Resolve Issue…");
  assert.equal(busy.get("resolve")?.enabled, false);
  // Session is a no-op placeholder: never disabled.
  assert.equal(busy.get("session")?.enabled, true);
  const github = byKind(describeActivityActions(baseArgs())).get("github");
  assert.equal(github?.label, "View Issue");
  assert.equal(github?.enabled, true);
});

test("describe: review enabled when OPEN + idle (canvas title)", () => {
  const def = byKind(describeActivityActions(baseArgs())).get("review");
  assert.equal(def?.label, "Review Issue");
  assert.equal(def?.enabled, true);
  assert.equal(def?.title, "Review PR #50");
});

test("describe: review disabled without PR, closed PR, or busy ops", () => {
  const noPr = byKind(
    describeActivityActions(baseArgs({ prNumber: null, prState: "unknown" })),
  ).get("review");
  assert.equal(noPr?.enabled, false);
  assert.equal(noPr?.title, undefined);
  const closed = byKind(
    describeActivityActions(baseArgs({ prState: "MERGED" })),
  ).get("review");
  assert.equal(closed?.enabled, false);
  assert.equal(closed?.title, "PR #50 no está abierto");
  for (const flag of [
    "resolving",
    "reviewing",
    "fixing",
    "merging",
    "resolvingConflict",
  ] as const) {
    const def = byKind(
      describeActivityActions(
        baseArgs({ busy: { ...baseArgs().busy, [flag]: true, anyActive: true } }),
      ),
    ).get("review");
    assert.equal(def?.enabled, false, `busy.${flag} should disable review`);
  }
  const busyLabel = byKind(
    describeActivityActions(
      baseArgs({
        busy: { ...baseArgs().busy, reviewing: true, anyActive: true },
      }),
    ),
  ).get("review");
  assert.equal(busyLabel?.label, "Review Issue…");
});

test("describe: review blocked by gate fail/running (canvas titles)", () => {
  const fail = byKind(
    describeActivityActions(
      baseArgs({ effective: REVIEW_LABEL_GATE_FAIL, gateStatus: "fail" }),
    ),
  ).get("review");
  assert.equal(fail?.enabled, false);
  assert.equal(
    fail?.title,
    "El gate de calidad falló: revisá el reporte o forzá con 'Revisar igual'",
  );
  const running = byKind(
    describeActivityActions(baseArgs({ gateStatus: "running" })),
  ).get("review");
  assert.equal(running?.enabled, false);
  assert.equal(
    running?.title,
    "El gate de calidad está corriendo sobre el PR…",
  );
});

test("describe: fix only for review:comentado with canvas title", () => {
  const ok = byKind(
    describeActivityActions(baseArgs({ effective: REVIEW_LABEL_CHANGES })),
  ).get("fix");
  assert.equal(ok?.label, "Implement Fix");
  assert.equal(ok?.enabled, true);
  assert.equal(ok?.title, "Aplicar fix al PR #50");
  const wrong = byKind(describeActivityActions(baseArgs())).get("fix");
  assert.equal(wrong?.enabled, false);
  const busyLabel = byKind(
    describeActivityActions(
      baseArgs({
        effective: REVIEW_LABEL_CHANGES,
        busy: { ...baseArgs().busy, fixing: true, anyActive: true },
      }),
    ),
  ).get("fix");
  assert.equal(busyLabel?.label, "Implement Fix…");
  assert.equal(busyLabel?.enabled, false);
});

test("describe: merge only for aprobado + OPEN with busy … variant", () => {
  const ok = byKind(
    describeActivityActions(baseArgs({ effective: REVIEW_LABEL_APPROVED })),
  ).get("merge");
  assert.equal(ok?.label, "Merge PR");
  assert.equal(ok?.enabled, true);
  assert.equal(ok?.title, "Merge PR #50");
  const pending = byKind(describeActivityActions(baseArgs())).get("merge");
  assert.equal(pending?.enabled, false);
  const busyMerge = byKind(
    describeActivityActions(
      baseArgs({
        effective: REVIEW_LABEL_APPROVED,
        busy: { ...baseArgs().busy, merging: true, anyActive: true },
      }),
    ),
  ).get("merge");
  assert.equal(busyMerge?.label, "Merge PR…");
  assert.equal(busyMerge?.enabled, false);
});

test("describe: conflict + gate rows gate on flags, not on guesses", () => {
  const off = byKind(describeActivityActions(baseArgs()));
  assert.equal(off.get("conflict")?.label, "Resolver conflicto");
  assert.equal(off.get("conflict")?.enabled, false);
  assert.equal(off.get("view-report")?.label, "Ver reporte");
  assert.equal(off.get("view-report")?.enabled, false);
  assert.equal(off.get("override-gate")?.label, "Revisar igual");
  assert.equal(off.get("override-gate")?.enabled, false);
  const on = byKind(
    describeActivityActions(
      baseArgs({
        conflicted: true,
        effective: REVIEW_LABEL_GATE_FAIL,
        gateStatus: "fail",
      }),
    ),
  );
  assert.equal(on.get("conflict")?.enabled, true);
  assert.equal(on.get("conflict")?.title, "Resolver conflicto del PR #50");
  assert.equal(on.get("view-report")?.enabled, true);
  assert.equal(
    on.get("view-report")?.title,
    "Ver el reporte del gate del PR #50",
  );
  // Override refuses while any op is active (single invoke per click).
  assert.equal(on.get("override-gate")?.enabled, true);
  const gateBusy = byKind(
    describeActivityActions(
      baseArgs({
        effective: REVIEW_LABEL_GATE_FAIL,
        gateStatus: "fail",
        busy: { ...baseArgs().busy, reviewing: true, anyActive: true },
      }),
    ),
  );
  assert.equal(gateBusy.get("override-gate")?.enabled, false);
  const calm = byKind(
    describeActivityActions(
      baseArgs({ effective: REVIEW_LABEL_GATE_FAIL, gateStatus: "fail" }),
    ),
  );
  assert.equal(calm.get("override-gate")?.enabled, true);
  assert.equal(
    calm.get("override-gate")?.title,
    "Forzar la review del PR #50 (quita gate:fallo)",
  );
});

// ─── invoke wiring (injected fakes — zero network, zero daemon) ────────────

function fakeHandlers() {
  const calls: Array<{ handler: string; n: number; pr?: number }> = [];
  return {
    calls,
    deps: {
      resolveHandler: (n: number) => {
        calls.push({ handler: "resolve", n });
      },
      reviewHandler: (n: number, pr?: number) => {
        calls.push({ handler: "review", n, pr });
      },
      fixHandler: (n: number, pr?: number) => {
        calls.push({ handler: "fix", n, pr });
      },
      mergeHandler: (n: number, pr?: number) => {
        calls.push({ handler: "merge", n, pr });
      },
      resolveConflictHandler: (n: number, pr?: number) => {
        calls.push({ handler: "conflict", n, pr });
      },
    },
  };
}

test("invoke: resolve creates a factory job; refuses while resolving; validates input", async () => {
  const created: Array<{
    prompt: string;
    worktree: string;
    phase: string;
    issueRef: unknown;
  }> = [];
  const notes: string[] = [];
  const deps = {
    worktreePath: "C:/repos/termcanvas",
    issue: {
      title: "Fix the thing",
      body: "Long description",
      labels: ["bug"],
      url: "https://github.com/org/termcanvas/issues/7",
    },
    factoryJobs: [],
    checkFactoryHealth: async () => ({ ok: true as const, error: "" }),
    createFactoryJob: async (input: {
      prompt: string;
      worktree: string;
      phase: string;
      issueRef: unknown;
    }) => {
      created.push(input);
      return { ok: true, id: "job-7", error: "" };
    },
    notify: (message: string) => {
      notes.push(message);
    },
  };
  await invokeActivityAction("resolve", 7, undefined, deps);
  assert.equal(created.length, 1);
  assert.equal(created[0].worktree, "C:/repos/termcanvas");
  assert.equal(created[0].phase, "diagnosisLlm");
  assert.ok(created[0].prompt.includes("Fix the thing"));
  assert.deepEqual(created[0].issueRef, {
    provider: "github",
    issueNumber: 7,
    repo: "org/termcanvas",
    url: "https://github.com/org/termcanvas/issues/7",
  });
  assert.equal(notes.length, 1);
  // Canvas-terminal busy still refuses (silent backstop).
  await invokeActivityAction("resolve", 7, undefined, {
    ...deps,
    busy: { resolving: true },
  });
  assert.equal(created.length, 1);
  // Invalid issue numbers resolve silently (never throw, never create).
  await invokeActivityAction("resolve", 0, undefined, deps);
  await invokeActivityAction("resolve", -3, undefined, deps);
  assert.equal(created.length, 1);
});

test("invoke: review/fix call refs with (n, pr); refuse while busy", async () => {
  const fake = fakeHandlers();
  await invokeActivityAction("review", 7, 50, fake.deps);
  await invokeActivityAction("fix", 7, 50, fake.deps);
  assert.deepEqual(fake.calls, [
    { handler: "review", n: 7, pr: 50 },
    { handler: "fix", n: 7, pr: 50 },
  ]);
  fake.calls.length = 0;
  await invokeActivityAction("review", 7, 50, {
    ...fake.deps,
    busy: { reviewing: true },
  });
  await invokeActivityAction("fix", 7, 50, {
    ...fake.deps,
    busy: { fixing: true },
  });
  await invokeActivityAction("review", 7, 50, {
    ...fake.deps,
    busy: { resolving: true },
  });
  assert.deepEqual(fake.calls, []);
});

test("invoke: merge/conflict call refs; refuse while their op runs", async () => {
  const fake = fakeHandlers();
  await invokeActivityAction("merge", 7, 50, fake.deps);
  await invokeActivityAction("conflict", 7, 50, fake.deps);
  assert.deepEqual(fake.calls, [
    { handler: "merge", n: 7, pr: 50 },
    { handler: "conflict", n: 7, pr: 50 },
  ]);
  fake.calls.length = 0;
  await invokeActivityAction("merge", 7, 50, {
    ...fake.deps,
    busy: { merging: true },
  });
  await invokeActivityAction("conflict", 7, 50, {
    ...fake.deps,
    busy: { resolvingConflict: true },
  });
  assert.deepEqual(fake.calls, []);
});

test("invoke: override-gate chains review on ok, skips it on failure", async () => {
  const fake = fakeHandlers();
  const store = useIssueReviewStore.getState();
  store.setPrLabels(7, 50, [REVIEW_LABEL_GATE_FAIL]);
  const overrides: Array<{ repo: string; n: number; pr: number }> = [];
  try {
    await invokeActivityAction("override-gate", 7, 50, {
      ...fake.deps,
      worktreePath: "C:/repos/termcanvas",
      overrideGate: async (opts) => {
        overrides.push({
          repo: opts.repoPath,
          n: opts.issueNumber,
          pr: opts.prNumber,
        });
        return true;
      },
    });
    assert.deepEqual(overrides, [
      { repo: "C:/repos/termcanvas", n: 7, pr: 50 },
    ]);
    assert.deepEqual(fake.calls, [{ handler: "review", n: 7, pr: 50 }]);
    fake.calls.length = 0;
    await invokeActivityAction("override-gate", 7, 50, {
      ...fake.deps,
      worktreePath: "C:/repos/termcanvas",
      overrideGate: async () => false,
    });
    assert.deepEqual(fake.calls, []);
    // No-op without a PR number (never touches the override bridge).
    let touched = false;
    await invokeActivityAction("override-gate", 7, undefined, {
      ...fake.deps,
      overrideGate: async () => {
        touched = true;
        return true;
      },
    });
    assert.equal(touched, false);
  } finally {
    store.setPrLabels(7, 50, []);
  }
});

test("invoke: override-gate refuses when the live gate did not fail", async () => {
  const fake = fakeHandlers();
  let touched = false;
  await invokeActivityAction("override-gate", 7, 50, {
    ...fake.deps,
    worktreePath: "C:/repos/termcanvas",
    overrideGate: async () => {
      touched = true;
      return true;
    },
  });
  assert.equal(touched, false);
  assert.deepEqual(fake.calls, []);
});

test("invoke: view-report delivers content; null on read error; honest empty", async () => {
  const reports: Array<{ path: string; content: string | null }> = [];
  await invokeActivityAction("view-report", 7, 50, {
    reportPath: "/tmp/gate-50.json",
    readFile: async (path) => ({
      type: "text",
      content: `content-of:${String(path)}`,
    }),
    onReport: (report) => {
      reports.push(report);
    },
  });
  assert.deepEqual(reports, [
    { path: "/tmp/gate-50.json", content: "content-of:/tmp/gate-50.json" },
  ]);
  reports.length = 0;
  await invokeActivityAction("view-report", 7, 50, {
    reportPath: "/tmp/gate-50.json",
    readFile: async () => {
      throw new Error("unreadable");
    },
    onReport: (report) => {
      reports.push(report);
    },
  });
  assert.deepEqual(reports, [{ path: "/tmp/gate-50.json", content: null }]);
  reports.length = 0;
  // No path anywhere (nor live): honest empty delivery, never throws.
  await invokeActivityAction("view-report", 424242, undefined, {
    onReport: (report) => {
      reports.push(report);
    },
  });
  assert.deepEqual(reports, [{ path: "", content: null }]);
});

test("invoke: github passes the URL through; session/unknown are no-ops", async () => {
  const opened: string[] = [];
  await invokeActivityAction("github", 7, undefined, {
    issueUrl: "https://github.com/org/termcanvas/issues/7",
    openUrl: (url) => {
      opened.push(url);
    },
  });
  assert.deepEqual(opened, ["https://github.com/org/termcanvas/issues/7"]);
  // Injected opener without a URL: never called (bridge no-ops).
  let called = false;
  await invokeActivityAction("github", 7, undefined, {
    openUrl: () => {
      called = true;
    },
  });
  assert.equal(called, false);
  const fake = fakeHandlers();
  await invokeActivityAction("session", 7, undefined, fake.deps);
  await invokeActivityAction("bogus" as "session", 7, undefined, fake.deps);
  assert.deepEqual(fake.calls, []);
});

test("invoke: defaults read handler refs from the live stores (resolve excluded: factory contract)", async () => {
  const calls: Array<{ handler: string; n: number; pr?: number }> = [];
  const prevReview = useIssueReviewStore.getState().reviewHandler;
  useIssueReviewStore
    .getState()
    .registerReviewHandler((n: number, pr?: number) => {
      calls.push({ handler: "review", n, pr });
    });
  try {
    await invokeActivityAction("review", 11, 60);
    assert.deepEqual(calls, [{ handler: "review", n: 11, pr: 60 }]);
  } finally {
    useIssueReviewStore.getState().registerReviewHandler(prevReview);
  }
});

test("invoke: resolve never touches the canvas resolve handler (factory contract lock)", async () => {
  const resolved: number[] = [];
  const prevResolve = useIssueResolveStore.getState().resolveHandler;
  useIssueResolveStore.getState().registerResolveHandler((n: number) => {
    resolved.push(n);
  });
  try {
    await invokeActivityAction("resolve", 12, undefined, {
      worktreePath: "C:/repos/termcanvas",
      factoryJobs: [],
      checkFactoryHealth: async () => ({ ok: true, error: "" }),
      createFactoryJob: async () => ({ ok: false, id: null, error: "offline" }),
      notify: () => {},
    });
    assert.deepEqual(resolved, []);
  } finally {
    useIssueResolveStore.getState().registerResolveHandler(prevResolve);
  }
});

// ─── Membership rule: real repo cases (FrancoManfredi/test-orquestador) ───

test("membership: #46 fix-aplicado + OPEN PR is in-progress/fixing", () => {
  // #46 "Label test: fix": issue + PR #47 both carry review:fix-aplicado.
  assert.deepEqual(
    deriveActivityStatus(
      46,
      baseReview({
        primaryPrByIssue: { 46: linkedPr(47, "OPEN") },
        labelsByPr: { 46: { 47: [REVIEW_LABEL_FIX_APPLIED] } },
      }),
      null,
    ),
    { status: "in-progress", phase: "fixing" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      46,
      baseReview({
        primaryPrByIssue: { 46: linkedPr(47, "OPEN") },
        labelsByIssue: { 46: [REVIEW_LABEL_FIX_APPLIED] },
      }),
      null,
    ),
    { status: "in-progress", phase: "fixing" },
  );
});

test("membership: #44 pendiente + OPEN PR is ready/merge-ready (neutral OPEN PR, nothing blocking)", () => {
  // #44 "Label test: pending": issue + PR #45 both carry review:pendiente.
  // A neutral OPEN PR is reviewable evidence → Ready to Merge section.
  // Merge stays disabled until aprobado (shared action matrix).
  assert.deepEqual(
    deriveActivityStatus(
      44,
      baseReview({
        primaryPrByIssue: { 44: linkedPr(45, "OPEN") },
        labelsByPr: { 44: { 45: [REVIEW_LABEL_PENDING] } },
      }),
      null,
    ),
    { status: "ready", awaitingAction: "merge-ready" },
  );
});

test("membership: blocked PRs (conflicto/gate-fallo) stay pending (not mergeable)", () => {
  assert.deepEqual(
    deriveActivityStatus(
      44,
      baseReview({
        primaryPrByIssue: { 44: linkedPr(45, "OPEN") },
        labelsByPr: { 44: { 45: ["conflicto:main"] } },
      }),
      null,
    ),
    { status: "pending" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      44,
      baseReview({
        primaryPrByIssue: { 44: linkedPr(45, "OPEN") },
        labelsByPr: { 44: { 45: ["gate:fallo"] } },
      }),
      null,
    ),
    { status: "pending" },
  );
});

test("membership: #1 comentado + OPEN PR is awaiting/changes-requested", () => {
  // #1 "Issue 1": PR #6 carries review:comentado. The extra
  // `status:approved` label is NOT a cycle label and is ignored.
  assert.deepEqual(
    deriveActivityStatus(
      1,
      baseReview({
        primaryPrByIssue: { 1: linkedPr(6, "OPEN") },
        labelsByPr: { 1: { 6: ["status:approved", REVIEW_LABEL_CHANGES] } },
      }),
      null,
    ),
    { status: "awaiting", awaitingAction: "changes-requested" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      1,
      baseReview({
        primaryPrByIssue: { 1: linkedPr(6, "OPEN") },
        labelsByIssue: { 1: [REVIEW_LABEL_CHANGES] },
      }),
      null,
    ),
    { status: "awaiting", awaitingAction: "changes-requested" },
  );
});

test("membership: live merge/conflict work beats settled labels", () => {
  // A merge running on an aprobado PR is agent work, not "your turn".
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({
        mergingIssueNumber: 7,
        primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
        labelsByIssue: { 7: [REVIEW_LABEL_APPROVED] },
      }),
      null,
    ),
    { status: "in-progress" },
  );
  assert.deepEqual(
    deriveActivityStatus(
      7,
      baseReview({
        resolvingConflictIssueNumber: 7,
        primaryPrByIssue: { 7: linkedPr(50, "OPEN") },
        labelsByIssue: { 7: [REVIEW_LABEL_CHANGES] },
      }),
      null,
    ),
    { status: "in-progress" },
  );
});

// ─── Blocked-by gate (shared canvas/panel rule) ──────────────────────────

test("mapping: node relations flow into the row for the resolve gate", () => {
  const withBlocker = mapIssueNodeToActivity(
    node(7, {
      blockedBy: {
        nodes: [{ number: 12, title: "Blocker", url: "", state: "OPEN" }],
      },
    } as Partial<IssueNodeData>),
    { status: "pending" },
    baseReview(),
  );
  assert.equal(withBlocker.relations?.length, 1);
  assert.equal(withBlocker.relations?.[0].kind, "blockedBy");
  assert.equal(withBlocker.relations?.[0].number, 12);
  const clean = mapIssueNodeToActivity(
    node(8),
    { status: "pending" },
    baseReview(),
  );
  assert.deepEqual(clean.relations, []);
});

test("describe: resolve refuses while blocked, honest title", () => {
  const blocked = byKind(
    describeActivityActions(baseArgs({ blockedByBlockers: [12] })),
  ).get("resolve");
  assert.equal(blocked?.enabled, false);
  assert.equal(
    blocked?.title,
    "Bloqueado por #12 — se puede resolver cuando esté cerrado",
  );
  const free = byKind(describeActivityActions(baseArgs())).get("resolve");
  assert.equal(free?.enabled, true);
  assert.equal(free?.title, undefined);
});

test("invoke: resolve refuses while blocked by an OPEN issue", async () => {
  const created: string[] = [];
  const base = {
    worktreePath: "C:/repos/termcanvas",
    factoryJobs: [],
    checkFactoryHealth: async () => ({ ok: true as const, error: "" }),
    createFactoryJob: async () => {
      created.push("job");
      return { ok: true, id: "job-7", error: "" };
    },
    notify: () => {},
  };
  await invokeActivityAction("resolve", 7, undefined, {
    ...base,
    blockedByBlockers: [12],
  });
  assert.deepEqual(created, []);
  await invokeActivityAction("resolve", 7, undefined, {
    ...base,
    blockedByBlockers: [],
  });
  assert.deepEqual(created, ["job"]);
});

// ─── C2 watchdog: stalled rows carry the flag at list level ─────────────
// A linked job with no daemon update past the threshold (#67-class: 40h in
// Triage) must be visible WITHOUT opening the detail (which already shows
// it). The row's `factory.stalled` drives the chip in `IssueCard`.

function stalledJob(id: string, issueNumber: number): unknown {
  return {
    id,
    status: "Triage",
    state: "queued",
    phase: "diagnosisLlm",
    worktree: "C:/repos/termcanvas",
    runnerId: "linux-build",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    timeline: [],
    issueRef: {
      provider: "github",
      issueNumber,
      repo: "org/termcanvas",
      url: `https://github.com/org/termcanvas/issues/${issueNumber}`,
    },
  };
}

function stalledAdapter(jobs: unknown[]): LiveActivityAdapter {
  return new LiveActivityAdapter({
    readIssues: () => [node(7), node(8)],
    readReview: () => ({ ...baseReview(), headRefByIssue: {} }) as never,
    readResolvingIssueNumber: () => null,
    readProjectName: () => "termcanvas",
    readActivityByRepo: () => ({}),
    readFactoryJobs: () => jobs,
    readNotifications: () => [],
  });
}

test("row carries factory.stalled for jobs past the threshold", () => {
  const rows = stalledAdapter([stalledJob("job-old", 7)]).listActivityIssues();
  const row = rows.find((r) => r.id === 7);
  assert.ok(row, "row 7 listed");
  assert.equal(row?.factory?.stalled, true);
  const fresh = stalledAdapter([]).listActivityIssues();
  assert.equal(
    fresh.find((r) => r.id === 7)?.factory?.stalled ?? false,
    false,
    "no job = no stalled flag invented",
  );
});
