// warp-triage-awaiting-bridge: triage questions park the row in
// AWAITING YOU end to end (daemon timeline -> poll extras -> gate ->
// derivation), and answers release it. Offline: zero network, zero daemon.
// The full chain already existed piece-wise; this locks the SEAMS:
// persistTriage-shaped timeline -> triageSpecExtras -> poll item ->
// readFactoryJobHumanNeed -> deriveActivityStatus.
import test from "node:test";
import assert from "node:assert/strict";
import { triageSpecExtras } from "../headless-runtime/factory/triageSpec/triageSpecService.ts";
import { readFactoryJobHumanNeed } from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";
import { deriveActivityStatus } from "../src/features/warpPanel/adapters/activityDerivation.ts";

const ISSUE_URL = "https://github.com/org/termcanvas/issues/7";
const JOB_ID = "job-bridge-7";

function issueRefMeta() {
  return {
    id: "job-7-t0",
    from: "Intake",
    to: "Triage",
    at: new Date().toISOString(),
    actor: "system",
    message: "resolve link github#7 (org/termcanvas)",
    meta: {
      issueRef: {
        provider: "github",
        issueNumber: 7,
        repo: "org/termcanvas",
        url: ISSUE_URL,
      },
    },
  };
}

// Same shape persistTriage writes (timeline meta `triage` + triage.json).
function questionsTimeline(questions: string[]) {
  return [
    issueRefMeta(),
    {
      id: "job-7-t1",
      from: "Foreman",
      to: "Triage",
      at: new Date().toISOString(),
      actor: "foreman",
      message: "triaged: needs input",
      meta: {
        triage: {
          decision: "triage",
          scope: "needs input",
          complexity: "simple",
          openQuestions: questions,
          reason: "ambiguous prompt",
          confidence: 0.88,
        },
      },
    },
  ];
}

const EMPTY_REVIEW = {
  primaryPrByIssue: {},
  verdictByIssue: {},
  reviewingIssueNumber: null,
  fixingIssueNumber: null,
  mergingIssueNumber: null,
  resolvingConflictIssueNumber: null,
  mergedPrNumbers: [],
};

test("daemon extras carry the triage questions to the poll item", () => {
  const extras = triageSpecExtras(
    questionsTimeline(["Which area?", "What goal?"]),
    "Triage",
  ) as Record<string, { openQuestions?: unknown }>;
  assert.ok(extras.triage, "extras must include triage");
  assert.deepEqual(extras.triage.openQuestions, ["Which area?", "What goal?"]);
});

test("questions in Triage park the row in awaiting/triage-respond", () => {
  const timeline = questionsTimeline(["Which area?", "What goal?"]);
  const extras = triageSpecExtras(timeline, "Triage") as Record<string, unknown>;
  const pollJob = {
    id: JOB_ID,
    status: "Triage",
    state: "queued",
    timeline,
    ...extras,
  };
  const need = readFactoryJobHumanNeed(pollJob, []);
  assert.ok(need, "a waiting job must report a human need");
  assert.equal(need && need.kind, "triage-respond");
  assert.equal(need && need.jobId, JOB_ID);
  assert.deepEqual(need && need.questions, ["Which area?", "What goal?"]);
  const derived = deriveActivityStatus(
    7,
    EMPTY_REVIEW as never,
    null,
    "OPEN",
    true,
    (need && need.kind) as string,
    false,
  );
  assert.equal(derived.status, "awaiting");
  assert.equal(derived.awaitingAction, "triage-respond");
});

test("answered questions release the gate (no stale awaiting)", () => {
  const timeline = questionsTimeline(["Which area?"]);
  timeline.push({
    id: "job-7-t2",
    from: "Triage",
    to: "Triage",
    at: new Date().toISOString(),
    actor: "user",
    message: "triage respond (1 respuestas): Q1: The API area",
    meta: { triageRespond: { answers: ["The API area"] } },
  });
  const extras = triageSpecExtras(timeline, "Triage") as Record<string, unknown>;
  const pollJob = {
    id: JOB_ID,
    status: "Triage",
    state: "queued",
    timeline,
    ...extras,
  };
  assert.equal(readFactoryJobHumanNeed(pollJob, []), null);
});

test("empty questions never park the row", () => {
  const timeline = questionsTimeline([]);
  const extras = triageSpecExtras(timeline, "Triage") as Record<string, unknown>;
  const pollJob = {
    id: JOB_ID,
    status: "Triage",
    state: "queued",
    timeline,
    ...extras,
  };
  assert.equal(readFactoryJobHumanNeed(pollJob, []), null);
});
