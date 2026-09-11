import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { reviewService } from "../headless-runtime/review/reviewService.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";
import { setHookSeamsForTests } from "../headless-runtime/factory/agents/agentHooks.ts";
import { decideReviewNext } from "../shared/types/review.ts";

function mkTmpWorktree(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

// Ola 4 T05 — loop Building↔Review con mocks (sin LLM real, sin pnpm).

test("loop revise×1 → Building una vez, luego stay (flujo simple, termina por accept/ask_human/cap o humano)", () => {
  // Puro: decideReviewNext modela el loop sin I/O.
  assert.equal(decideReviewNext("revise", 0), "Building");
  assert.equal(decideReviewNext("revise", 1), null);
  assert.equal(decideReviewNext("revise", 99), null);
});

test("handleReview accept → Complete + .done (mock LLM, sin gastar red)", async () => {
  const worktree = mkTmpWorktree("review-loop-");
  const id = "job-review-loop01";
  workItemStore.clear();
  setReviewPromptMock(async () =>
    JSON.stringify({
      verdict: "accept",
      confidence: 0.9,
      summary: "Cambio mínimo correcto, tests pass",
      findings: [],
    }),
  );
  // Hooks post-review en no-op: el accept se prueba sin gastar LLM de hooks.
  setHookSeamsForTests({ listHookAgents: () => [] });
  try {
    workItemStore.create({ id, prompt: "crear archivo hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const before = workItemStore.get(id);
    assert.equal(before?.status, "Review");

    const after = await reviewService.handleReview(before!);
    assert.equal(after?.status, "Complete");
    assert.equal(after?.reviewCount, 1);
    assert.equal(after?.lastReview?.verdict, "accept");
    // .done creado por Review accept (Implement ya NO lo crea)
    const dir = after?.dir as string;
    assert.ok(fs.existsSync(path.join(dir, ".done")));
    assert.ok(fs.existsSync(path.join(dir, "review.json")));
  } finally {
    setReviewPromptMock(null);
    setHookSeamsForTests(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("handleReview mismo-modelo conceptual → ask_human stay Review (mock fallo parse)", async () => {
  const worktree = mkTmpWorktree("review-loop-");
  const id = "job-review-loop02";
  workItemStore.clear();
  // Mock devuelve texto no-JSON → reviewAgent convierte a ask_human
  setReviewPromptMock(async () => "esto no es json válido {{{");
  try {
    workItemStore.create({ id, prompt: "hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const before = workItemStore.get(id);
    const after = await reviewService.handleReview(before!);
    assert.equal(after?.status, "Review");
    assert.equal(after?.lastReview?.verdict, "ask_human");
    assert.equal(after?.reviewCount, 1);
  } finally {
    setReviewPromptMock(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});
