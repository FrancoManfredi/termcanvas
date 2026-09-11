import test from "node:test";
import assert from "node:assert/strict";
import {
  decideReviewNext,
  isPactReviewJob,
  buildAskHumanResult,
} from "../shared/types/review.ts";
import {
  canTransition,
  ALLOWED_TRANSITIONS,
} from "../shared/types/workItem.ts";

// Ola 4 T05 — transiciones Review + pact guard + ask_human.

test("ALLOWED_TRANSITIONS.Review incluye Complete, Building, Triage, Cancelled", () => {
  assert.deepEqual(
    [...ALLOWED_TRANSITIONS.Review].sort(),
    ["Building", "Cancelled", "Complete", "Triage"].sort(),
  );
  assert.equal(canTransition("Review", "Complete"), true);
  assert.equal(canTransition("Review", "Building"), true);
  assert.equal(canTransition("Review", "Triage"), true);
  assert.equal(canTransition("Building", "Review"), true);
});

test("decideReviewNext: accept→Complete, revise→Building 1 vez, ask_human→stay", () => {
  assert.equal(decideReviewNext("accept", 0), "Complete");
  assert.equal(decideReviewNext("accept", 2), "Complete");
  assert.equal(decideReviewNext("revise", 0), "Building");
  assert.equal(decideReviewNext("revise", 1), null);
  assert.equal(decideReviewNext("revise", 99), null);
  assert.equal(decideReviewNext("ask_human", 0), null);
  assert.equal(decideReviewNext("ask_human", 2), null);
});

test("pact jobs nunca Review", () => {
  assert.equal(isPactReviewJob({ id: "job-abc123", prompt: "playground-x", worktree: "C:\\tmp" }), true);
  assert.equal(isPactReviewJob({ id: "job-f10-xyz", prompt: "hola", worktree: "C:\\r" }), true);
  assert.equal(isPactReviewJob({ id: "playground-1", prompt: "x", worktree: "C:\\r" }), true);
  assert.equal(
    isPactReviewJob({ id: "job-mtkreal01", prompt: "crear carpeta Hola", worktree: "C:\\repo" }),
    false,
  );
});

test("buildAskHumanResult no gasta LLM y respeta attempt 1..3", () => {
  const r = buildAskHumanResult({
    workItemId: "job-review-abc02",
    reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
    reviewAttempt: 1,
    summary: "mismo modelo — sin gastar LLM",
  });
  assert.equal(r.verdict, "ask_human");
  assert.deepEqual(r.findings, []);
  assert.equal(r.reviewAttempt, 1);
  assert.ok(r.reviewedAt.length > 0);
});
