/**
 * Post-cap (cota MAX_REVIEW_ROUNDS = 1, flujo simple): el review LLM corre
 * 1 vez con revise automático; el siguiente turno con rondas agotadas (el
 * job vuelve a Review con un `revise` ya emitido y count>=MAX) no gasta
 * otro LLM-call, el humano juzga el retrabajo. Puro, offline.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_REVIEW_ROUNDS } from "../shared/types/review.ts";
import { isPostReviseReview } from "../headless-runtime/review/reviewService.ts";

test("post-cap: revise previo + count>=MAX → true", () => {
  assert.equal(
    isPostReviseReview({ lastReview: { verdict: "revise" } }, MAX_REVIEW_ROUNDS),
    true,
  );
  assert.equal(
    isPostReviseReview({ lastReview: { verdict: "revise" } }, MAX_REVIEW_ROUNDS + 1),
    true,
  );
});

test("con rondas restantes el loop sigue (false)", () => {
  assert.equal(
    isPostReviseReview({ lastReview: { verdict: "revise" } }, 0),
    false,
  );
  assert.equal(
    isPostReviseReview({ lastReview: { verdict: "revise" } }, MAX_REVIEW_ROUNDS - 1),
    false,
  );
});

test("primer review o veredictos no-revise → false", () => {
  assert.equal(isPostReviseReview({ lastReview: null }, 0), false);
  assert.equal(isPostReviseReview({}, 0), false);
  assert.equal(
    isPostReviseReview({ lastReview: { verdict: "revise" } }, 0),
    false,
  );
  assert.equal(
    isPostReviseReview({ lastReview: { verdict: "accept" } }, MAX_REVIEW_ROUNDS),
    false,
  );
  assert.equal(
    isPostReviseReview({ lastReview: { verdict: "ask_human" } }, MAX_REVIEW_ROUNDS),
    false,
  );
});

test("junk nunca lanza ni marca post-cap", () => {
  assert.equal(isPostReviseReview(null, 1), false);
  assert.equal(isPostReviseReview("x", 1), false);
  assert.equal(isPostReviseReview([], 1), false);
  assert.equal(isPostReviseReview({ lastReview: 42 }, 1), false);
  assert.equal(isPostReviseReview({ lastReview: { verdict: "revise" } }, "1"), false);
});
