/**
 * Cota de rondas implement↔review (flujo simple, sin reintentos): UNA sola
 * ronda automática (MAX_REVIEW_ROUNDS = 1). Review 1 puede dar revise
 * (→ Building), review 2 es terminal (accept o ask_human parado en Review).
 * `isPostReviseReview` evita el 2º LLM-review tras agotar: con rondas
 * restantes devuelve false, agotadas devuelve true. Puro + servicio con
 * mocks, offline.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decideReviewNext, MAX_REVIEW_ROUNDS } from "../shared/types/review.ts";
import { isPostReviseReview, reviewService } from "../headless-runtime/review/reviewService.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

test("MAX_REVIEW_ROUNDS es 1 (flujo simple)", () => {
  assert.equal(MAX_REVIEW_ROUNDS, 1);
});

test("decideReviewNext: tabla completa de la cota", () => {
  assert.equal(decideReviewNext("revise", 0), "Building", "ronda 1 sigue");
  for (const count of [1, 2, 99]) {
    assert.equal(decideReviewNext("revise", count), null, `count=${count} → stay ask_human`);
  }
  assert.equal(decideReviewNext("accept", 1), "Complete", "accept tardío igual completa");
});

test("isPostReviseReview: false con rondas restantes, true agotadas", () => {
  const revised = { lastReview: { verdict: "revise" } };
  assert.equal(isPostReviseReview(revised, 0), false);
  assert.equal(isPostReviseReview(revised, 1), true, "agotada: humano juzga sin LLM-call");
  assert.equal(isPostReviseReview(revised, 99), true);
  assert.equal(isPostReviseReview({ lastReview: { verdict: "accept" } }, 1), false);
});

test("servicio: 1º revise vuelve a Building; 2º turno es ask_human sin LLM-call", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "review-cap-"));
  const id = "job-review-cap01";
  workItemStore.clear();
  let llmCalls = 0;
  setReviewPromptMock(async () => {
    llmCalls += 1;
    return JSON.stringify({
      verdict: "revise",
      confidence: 0.8,
      summary: `todavía falta (llamada ${llmCalls})`,
      findings: [{ id: "f1", axis: "tests", severity: "major", message: "falta test" }],
    });
  });
  try {
    workItemStore.create({ id, prompt: "hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    // Sin rondas consumidas: el próximo handleReview es la 1ª.
    const seed = workItemStore.get(id)!;
    (seed as unknown as Record<string, unknown>).reviewCount = 0;
    (seed as unknown as Record<string, unknown>).lastReview = undefined;
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const first = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(first?.status, "Building", "1ª ronda: revise vuelve a Building");
    assert.equal(llmCalls, 1, "la 1ª ronda sí corre LLM-review");
    // Vuelta a Review con la ronda consumida → post-cap sin LLM-call.
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const second = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(second?.status, "Review", "agotada: stay Review");
    assert.equal(second?.lastReview?.verdict, "ask_human");
    assert.equal(llmCalls, 1, "el turno post-cap no gasta LLM-call");
    assert.match(second?.lastReview?.summary ?? "", /agotadas/);
  } finally {
    setReviewPromptMock(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});
