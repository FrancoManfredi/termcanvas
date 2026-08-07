import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_CONFLICT,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_PENDING,
  canonicalReviewLabel,
  effectiveReviewLabel,
  parseReviewBodyVerdict,
  reviewDecisionFromBodyVerdict,
  reviewDecisionWithFixApplied,
  reviewLabelsForVerdict,
} from "../src/canvas/reviewVerdict.ts";

// The user-requested contract: a review WITH blocking observations must end
// with the changes-requested label, a review WITHOUT any observation must end
// with the approved label, and the decision must come from the binary verdict
// line the prompt requires, not from GitHub's own reviewDecision.

test("parseReviewBodyVerdict: VEREDICTO: APROBADO is recognized as the approved verdict", () => {
  assert.equal(parseReviewBodyVerdict("VEREDICTO: APROBADO"), "APROBADO");
});

test("parseReviewBodyVerdict: verdict line with a trailing dot is still recognized", () => {
  assert.equal(parseReviewBodyVerdict("VEREDICTO: CAMBIOS_PEDIDOS."), "CAMBIOS_PEDIDOS");
});

test("parseReviewBodyVerdict: the verdict line must be the FIRST line of the body", () => {
  assert.equal(
    parseReviewBodyVerdict("El diff rompe el login.\nVEREDICTO: APROBADO"),
    null,
    "a verdict buried after prose must not count",
  );
});

test("parseReviewBodyVerdict: body without the verdict line returns null", () => {
  assert.equal(parseReviewBodyVerdict("Looks good to me"), null);
  assert.equal(parseReviewBodyVerdict(undefined), null);
  assert.equal(parseReviewBodyVerdict(null), null);
});

test("parseReviewBodyVerdict: leading/trailing whitespace around the line is tolerated", () => {
  assert.equal(parseReviewBodyVerdict("   VEREDICTO: APROBADO   "), "APROBADO");
});

test("reviewDecisionFromBodyVerdict: maps the verdict line to the UI decision", () => {
  assert.equal(reviewDecisionFromBodyVerdict("APROBADO"), "APPROVED");
  assert.equal(reviewDecisionFromBodyVerdict("CAMBIOS_PEDIDOS"), "CHANGES_REQUESTED");
  assert.equal(reviewDecisionFromBodyVerdict(null), null);
});

// Case 1 — review WITH blocking observations: label must land on
// review:comentado and the approved label must be removed.
test("reviewLabelsForVerdict: CHANGES_REQUESTED (observations) flips the label to changes-requested", () => {
  const labels = reviewLabelsForVerdict("CHANGES_REQUESTED");
  assert.deepEqual(labels, {
    target: REVIEW_LABEL_CHANGES,
    other: REVIEW_LABEL_APPROVED,
  });
});

// COMMENTED means inline observations without an explicit verdict — still
// blocks merging, so it maps to the same label as CHANGES_REQUESTED.
test("reviewLabelsForVerdict: COMMENTED (inline-only observations) also flips to changes-requested", () => {
  const labels = reviewLabelsForVerdict("COMMENTED");
  assert.deepEqual(labels, {
    target: REVIEW_LABEL_CHANGES,
    other: REVIEW_LABEL_APPROVED,
  });
});

// Case 2 — review WITHOUT any observation: label must land on
// review:aprobado and the changes label must be removed.
test("reviewLabelsForVerdict: APPROVED (no observations) flips the label to aprobado", () => {
  const labels = reviewLabelsForVerdict("APPROVED");
  assert.deepEqual(labels, {
    target: REVIEW_LABEL_APPROVED,
    other: REVIEW_LABEL_CHANGES,
  });
});

test("reviewLabelsForVerdict: no verdict yet leaves the labels untouched", () => {
  assert.equal(reviewLabelsForVerdict(null), null);
  assert.equal(reviewLabelsForVerdict("REVIEW_REQUIRED"), null);
  assert.equal(reviewLabelsForVerdict("FIX_APPLIED"), null);
});

// End-to-end of the contract for both requested cases: parse the verdict line
// from a realistic review body, derive the UI decision, and confirm the exact
// label pair the main-process handler applies.
test("full contract: review WITH blocking observations ends with changes-requested label", () => {
  const reviewBody =
    "VEREDICTO: CAMBIOS_PEDIDOS\nEl hook useEffect no limpia el listener: se acumulan suscripciones en cada remount.";
  const verdict = parseReviewBodyVerdict(reviewBody);
  const decision = reviewDecisionFromBodyVerdict(verdict);
  const labels = reviewLabelsForVerdict(decision);
  assert.equal(verdict, "CAMBIOS_PEDIDOS");
  assert.equal(decision, "CHANGES_REQUESTED");
  assert.deepEqual(labels, {
    target: "review:comentado",
    other: "review:aprobado",
  });
});

test("full contract: review WITHOUT any observation ends with aprobado label", () => {
  const reviewBody =
    "VEREDICTO: APROBADO\nTodo cubierto: tests verdes, scope exacto, sin dead code.";
  const verdict = parseReviewBodyVerdict(reviewBody);
  const decision = reviewDecisionFromBodyVerdict(verdict);
  const labels = reviewLabelsForVerdict(decision);
  assert.equal(verdict, "APROBADO");
  assert.equal(decision, "APPROVED");
  assert.deepEqual(labels, {
    target: "review:aprobado",
    other: "review:comentado",
  });
});

// The canonical label is what the issue mirror applies: the single state a PR
// is in, derived from its raw labels. Conflict beats approved (a conflicting
// PR must never merge), approved beats fix-applied (re-review is done), and
// fix-applied beats changes-requested (the fixes were pushed, re-review is
// pending). Labels outside the cycle are ignored.
test("canonicalReviewLabel: no cycle labels returns null", () => {
  assert.equal(canonicalReviewLabel([]), null);
  assert.equal(canonicalReviewLabel(["bug", "status:approved"]), null);
});

test("canonicalReviewLabel: a single cycle label wins", () => {
  assert.equal(canonicalReviewLabel([REVIEW_LABEL_APPROVED]), REVIEW_LABEL_APPROVED);
  assert.equal(canonicalReviewLabel([REVIEW_LABEL_PENDING]), REVIEW_LABEL_PENDING);
});

test("canonicalReviewLabel: conflicto:main beats review:aprobado", () => {
  assert.equal(
    canonicalReviewLabel([REVIEW_LABEL_APPROVED, REVIEW_LABEL_CONFLICT]),
    REVIEW_LABEL_CONFLICT,
  );
});

test("canonicalReviewLabel: review:aprobado beats review:fix-aplicado", () => {
  assert.equal(
    canonicalReviewLabel([REVIEW_LABEL_FIX_APPLIED, REVIEW_LABEL_APPROVED]),
    REVIEW_LABEL_APPROVED,
  );
});

test("canonicalReviewLabel: review:fix-aplicado beats review:comentado", () => {
  assert.equal(
    canonicalReviewLabel([REVIEW_LABEL_CHANGES, REVIEW_LABEL_FIX_APPLIED]),
    REVIEW_LABEL_FIX_APPLIED,
  );
});

// effectiveReviewLabel is the card/menu gate: the PR's persisted cycle label
// is the source of truth (it survives reloads), and the in-memory verdict
// only fills the gap while a transition is live (e.g. the reviewer just
// approved but the label flip has not been re-read yet).
test("effectiveReviewLabel: persisted labels win over the in-memory verdict", () => {
  assert.equal(
    effectiveReviewLabel([REVIEW_LABEL_CHANGES], "APPROVED"),
    REVIEW_LABEL_CHANGES,
    "a request-changes label must override a stale APPROVED verdict",
  );
  assert.equal(
    effectiveReviewLabel([REVIEW_LABEL_FIX_APPLIED], "APPROVED"),
    REVIEW_LABEL_FIX_APPLIED,
    "fix-applied must keep MERGEAR PR off until re-review approves",
  );
  assert.equal(
    effectiveReviewLabel([REVIEW_LABEL_CONFLICT], "APPROVED"),
    REVIEW_LABEL_CONFLICT,
    "conflict must block merging regardless of the verdict",
  );
});

test("effectiveReviewLabel: no cycle labels falls back to the in-memory verdict", () => {
  assert.equal(
    effectiveReviewLabel([], "APPROVED"),
    REVIEW_LABEL_APPROVED,
    "a live approval must surface before the label is re-read",
  );
  assert.equal(
    effectiveReviewLabel([], "CHANGES_REQUESTED"),
    REVIEW_LABEL_CHANGES,
  );
  assert.equal(
    effectiveReviewLabel([], "COMMENTED"),
    REVIEW_LABEL_CHANGES,
    "inline-only comments still open the fix flow",
  );
  assert.equal(
    effectiveReviewLabel([], "FIX_APPLIED"),
    REVIEW_LABEL_FIX_APPLIED,
  );
  assert.equal(
    effectiveReviewLabel([], "REVIEW_REQUIRED"),
    REVIEW_LABEL_PENDING,
  );
});

test("effectiveReviewLabel: unrelated labels and empty state resolve to null", () => {
  assert.equal(effectiveReviewLabel([], null), null);
  assert.equal(effectiveReviewLabel(["bug", "status:approved"], null), null);
  assert.equal(effectiveReviewLabel(["bug", "status:approved"], "APPROVED"), REVIEW_LABEL_APPROVED);
});

// reviewDecisionWithFixApplied folds the derived "fix applied, awaiting
// re-review" state: when the PR head moved PAST the commit the newest review
// evaluated, that review's decision is stale — a fix (or conflict
// resolution) landed after it, so the PR must wait for a fresh review.
test("reviewDecisionWithFixApplied: head moved past the reviewed commit folds to FIX_APPLIED", () => {
  assert.equal(
    reviewDecisionWithFixApplied("CHANGES_REQUESTED", "abc123", "abc120"),
    "FIX_APPLIED",
  );
  assert.equal(
    reviewDecisionWithFixApplied("APPROVED", "abc123", "abc120"),
    "FIX_APPLIED",
    "an approval also goes stale when the head moves after it",
  );
});

test("reviewDecisionWithFixApplied: head still at the reviewed commit keeps the decision", () => {
  assert.equal(
    reviewDecisionWithFixApplied("CHANGES_REQUESTED", "abc120", "abc120"),
    "CHANGES_REQUESTED",
  );
  assert.equal(
    reviewDecisionWithFixApplied("APPROVED", "abc120", "abc120"),
    "APPROVED",
  );
});

test("reviewDecisionWithFixApplied: missing inputs leave the decision untouched", () => {
  assert.equal(reviewDecisionWithFixApplied(null, "abc123", "abc120"), null);
  assert.equal(reviewDecisionWithFixApplied("APPROVED", null, "abc120"), "APPROVED");
  assert.equal(reviewDecisionWithFixApplied("APPROVED", "abc123", null), "APPROVED");
  assert.equal(reviewDecisionWithFixApplied(null, null, null), null);
});
