import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveReviewer } from "../headless-runtime/review/reviewModelSelector.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { reviewService } from "../headless-runtime/review/reviewService.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";
import { setHookSeamsForTests } from "../headless-runtime/factory/agents/agentHooks.ts";
import {
  WorkItemSchema,
  createWorkItemInput,
} from "../shared/types/workItem.ts";

// Ola 4.1 — revisor explícito (reviewerRef) elegido por el usuario.

test("resolveReviewer: explícito distinto se usa directo (source explicit)", () => {
  const sel = resolveReviewer(
    { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
    { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  );
  assert.equal(sel.source, "explicit");
  assert.equal(sel.shouldAskHuman, false);
  assert.equal(sel.reviewerModel.providerID, "anthropic");
  assert.equal(sel.reviewerModel.modelID, "claude-sonnet-4-20250514");
});

test("resolveReviewer: explícito igual al builder → ask_human sin LLM", () => {
  const sel = resolveReviewer(
    { providerID: "opencode", modelID: "big-pickle" },
    { providerID: "opencode", modelID: "big-pickle" },
  );
  assert.equal(sel.source, "explicit");
  assert.equal(sel.shouldAskHuman, true);
  assert.match(sel.reason, /igual al builder/);
});

test("resolveReviewer: sin explícito → automático disjunto (source auto)", () => {
  const sel = resolveReviewer(
    { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
    undefined,
  );
  assert.equal(sel.source, "auto");
  assert.equal(sel.shouldAskHuman, false);
  assert.equal(sel.reviewerModel.modelID, "big-pickle");
});

test("resolveReviewer: explícito inválido → cae al automático", () => {
  const sel = resolveReviewer(
    { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
    { providerID: "  ", modelID: "" },
  );
  assert.equal(sel.source, "auto");
  assert.equal(sel.reviewerModel.modelID, "big-pickle");
});

test("contrato: createWorkItemInput + schema con reviewerRef, y compat sin él", () => {
  const wi = createWorkItemInput({
    id: "job-review-ref00",
    prompt: "p",
    worktree: "/tmp/x",
    modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
    reviewerRef: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  });
  assert.equal(wi.reviewerRef?.modelID, "claude-sonnet-4-20250514");
  const parsed = WorkItemSchema.parse(JSON.parse(JSON.stringify(wi)));
  assert.equal(parsed.reviewerRef?.providerID, "anthropic");

  // Jobs viejos sin reviewerRef siguen parseando (compat Ola 1-4)
  const legacy = createWorkItemInput({ id: "job-review-ref99", prompt: "p", worktree: "/tmp/x" });
  assert.equal(legacy.reviewerRef, undefined);
  const parsedLegacy = WorkItemSchema.parse(JSON.parse(JSON.stringify(legacy)));
  assert.equal(parsedLegacy.reviewerRef, undefined);
});

test("handleReview usa el revisor explícito (mock accept → Complete)", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "review-ref-"));
  const id = "job-review-ref01";
  workItemStore.clear();
  let mockCalls = 0;
  setReviewPromptMock(async () => {
    mockCalls++;
    return JSON.stringify({ verdict: "accept", confidence: 0.9, summary: "ok", findings: [] });
  });
  // Hooks post-review en no-op: el accept se prueba sin gastar LLM de hooks.
  setHookSeamsForTests({ listHookAgents: () => [] });
  try {
    workItemStore.create({
      id,
      prompt: "crear carpeta X",
      worktree,
      phase: "diagnosisLlm",
      modelRef: { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
      reviewerRef: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
    });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "system", "t");
    const out = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(out?.status, "Complete");
    assert.equal(mockCalls, 1);
    const stored = workItemStore.get(id)!;
    assert.equal(stored.lastReview?.reviewerModel.modelID, "claude-sonnet-4-20250514");
    assert.ok(
      (stored.timeline ?? []).some((e) => e.message.includes("revisor explícito")),
      "timeline debe trazar el revisor explícito usado",
    );
  } finally {
    setReviewPromptMock(null);
    setHookSeamsForTests(null);
  }
});

test("handleReview con explícito igual al builder → ask_human sin gastar LLM", async () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "review-ref-"));
  const id = "job-review-ref02";
  workItemStore.clear();
  let mockCalls = 0;
  setReviewPromptMock(async () => {
    mockCalls++;
    return JSON.stringify({ verdict: "accept", confidence: 0.9, summary: "ok", findings: [] });
  });
  try {
    workItemStore.create({
      id,
      prompt: "crear carpeta Y",
      worktree,
      phase: "diagnosisLlm",
      modelRef: { providerID: "opencode", modelID: "big-pickle" },
      reviewerRef: { providerID: "opencode", modelID: "big-pickle" },
    });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "system", "t");
    const out = await reviewService.handleReview(workItemStore.get(id)!);
    assert.equal(out?.status, "Review");
    assert.equal(mockCalls, 0);
    assert.equal(workItemStore.get(id)?.lastReview?.verdict, "ask_human");
  } finally {
    setReviewPromptMock(null);
  }
});
