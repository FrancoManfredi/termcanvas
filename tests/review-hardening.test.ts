import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fallbackFor,
  REVIEWER_ANTHROPIC,
  REVIEWER_DEFAULT,
  REVIEWER_GPT4O,
  REVIEWER_MUSE_SPARK,
} from "../headless-runtime/review/reviewModelSelector.ts";
import {
  isRetryableReviewError,
  reviewAgent,
  setReviewPromptMock,
} from "../headless-runtime/review/reviewAgent.ts";
import { writeReviewRawAtomic } from "../headless-runtime/review/reviewDisk.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { reviewService } from "../headless-runtime/review/reviewService.ts";
import { setHookSeamsForTests } from "../headless-runtime/factory/agents/agentHooks.ts";

// Ola 5 Review blindado — fallback, retryable, {result,raw} y persistido del raw.

// ── fallbackFor: los 5 casos ──

test("fallbackFor: big-pickle → MUSE_SPARK", () => {
  const fb = fallbackFor({ providerID: "opencode", modelID: "big-pickle" });
  assert.deepEqual(fb, { ...REVIEWER_MUSE_SPARK });
});

test("fallbackFor: muse-spark → DEFAULT", () => {
  const fb = fallbackFor({ providerID: "opencode-go", modelID: "muse-spark-1.2-contributor" });
  assert.deepEqual(fb, { ...REVIEWER_DEFAULT });
});

test("fallbackFor: anthropic → GPT4O", () => {
  const fb = fallbackFor({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" });
  assert.deepEqual(fb, { ...REVIEWER_GPT4O });
});

test("fallbackFor: openai → ANTHROPIC", () => {
  const fb = fallbackFor({ providerID: "openai", modelID: "gpt-4o" });
  assert.deepEqual(fb, { ...REVIEWER_ANTHROPIC });
});

test("fallbackFor: resto → DEFAULT", () => {
  const fb = fallbackFor({ providerID: "desconocido", modelID: "foo-123" });
  assert.deepEqual(fb, { ...REVIEWER_DEFAULT });
});

// ── isRetryableReviewError (doctrina no-resend: solo transporte) ──

test("isRetryableReviewError: timeout/abort FALSE (el modelo seguía pensando: reenviar duplica)", () => {
  assert.equal(isRetryableReviewError("timeout 20000ms review session.prompt"), false);
  assert.equal(isRetryableReviewError("Timeout 8000ms review session.create"), false);
  assert.equal(isRetryableReviewError("abort review session.prompt"), false);
  assert.equal(isRetryableReviewError("aborted"), false);
});

test("isRetryableReviewError: UnknownError / unexpected server error true", () => {
  assert.equal(
    isRetryableReviewError(
      '{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}',
    ),
    true,
  );
  assert.equal(isRetryableReviewError("Unexpected server error"), true);
  assert.equal(isRetryableReviewError("UnknownError: Unexpected server error"), true);
});

test("isRetryableReviewError: error vacío {} true", () => {
  assert.equal(isRetryableReviewError("{}"), true);
  assert.equal(isRetryableReviewError(""), true);
  assert.equal(isRetryableReviewError("   "), true);
});

test("isRetryableReviewError: econn/fetch true (transporte: la request nunca se estableció)", () => {
  assert.equal(isRetryableReviewError("econnreset socket hang up"), true);
  assert.equal(isRetryableReviewError("fetch failed"), true);
});

test("isRetryableReviewError: error de validación zod false", () => {
  assert.equal(
    isRetryableReviewError('review JSON parse error: no object — raw=no es json'),
    false,
  );
  assert.equal(
    isRetryableReviewError('[{"code":"invalid_type","expected":"string","path":["summary"]}]'),
    false,
  );
  assert.equal(isRetryableReviewError("mock parse fallo: review JSON parse error"), false);
});

// ── {result,raw} vía mock ──

test("consume vía mock devuelve {result,raw} con raw == string mockeado", async () => {
  const mocked = JSON.stringify({
    verdict: "accept",
    confidence: 0.9,
    summary: "ok blindado",
    findings: [],
  });
  setReviewPromptMock(async () => mocked);
  try {
    const out = await reviewAgent.consume({
      workItemId: "job-review-harden01",
      worktreePath: os.tmpdir(),
      reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
      reviewAttempt: 1,
      prompt: "hola",
    });
    assert.equal(out.raw, mocked);
    assert.equal(out.result.verdict, "accept");
    assert.equal(out.result.workItemId, "job-review-harden01");
  } finally {
    setReviewPromptMock(null);
  }
});

test("consume con parse-fail preserva raw crudo", async () => {
  const bad = "esto no es json válido {{{";
  setReviewPromptMock(async () => bad);
  try {
    const out = await reviewAgent.consume({
      workItemId: "job-review-harden02",
      worktreePath: os.tmpdir(),
      reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
      reviewAttempt: 1,
      prompt: "hola",
    });
    assert.equal(out.raw, bad);
    assert.equal(out.result.verdict, "ask_human");
  } finally {
    setReviewPromptMock(null);
  }
});

test("consume sin-SDK/mock-null devuelve raw null", async () => {
  setReviewPromptMock(async () => null);
  try {
    const out = await reviewAgent.consume({
      workItemId: "job-review-harden03",
      worktreePath: os.tmpdir(),
      reviewerModel: { providerID: "opencode", modelID: "big-pickle" },
      reviewAttempt: 1,
      prompt: "hola",
    });
    assert.equal(out.raw, null);
    assert.equal(out.result.verdict, "ask_human");
  } finally {
    setReviewPromptMock(null);
  }
});

// ── writeReviewRawAtomic unitario ──

test("writeReviewRawAtomic: null no escribe ni lanza", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-raw-"));
  try {
    writeReviewRawAtomic(dir, 1, null);
    assert.equal(fs.existsSync(path.join(dir, "review-raw-1.txt")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeReviewRawAtomic: acota a 64KB", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-raw-"));
  try {
    const big = "x".repeat(70 * 1024);
    writeReviewRawAtomic(dir, 2, big);
    const st = fs.statSync(path.join(dir, "review-raw-2.txt"));
    assert.equal(st.size, 64 * 1024);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── persistido del raw en disco tras handleReview ──

function mkTmpWorktree(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("handleReview con mock escribe review-raw-1.txt", async () => {
  const worktree = mkTmpWorktree("review-harden-");
  const id = "job-review-harden10";
  workItemStore.clear();
  const mocked = JSON.stringify({
    verdict: "accept",
    confidence: 0.92,
    summary: "Cambio mínimo correcto",
    findings: [],
  });
  setReviewPromptMock(async () => mocked);
  // Hooks post-review en no-op: el accept se prueba sin gastar LLM de hooks.
  setHookSeamsForTests({ listHookAgents: () => [] });
  try {
    workItemStore.create({ id, prompt: "crear archivo hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const before = workItemStore.get(id);
    const after = await reviewService.handleReview(before!);
    assert.equal(after?.status, "Complete");
    const dir = (after?.dir as string) ?? path.join(worktree, ".agents", "factory", id);
    const rawPath = path.join(dir, "review-raw-1.txt");
    assert.ok(fs.existsSync(rawPath), "debe existir review-raw-1.txt");
    assert.equal(fs.readFileSync(rawPath, "utf-8"), mocked);
  } finally {
    setReviewPromptMock(null);
    setHookSeamsForTests(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});

test("handleReview con parse-fail también escribe el raw", async () => {
  const worktree = mkTmpWorktree("review-harden-");
  const id = "job-review-harden11";
  workItemStore.clear();
  const bad = "esto no es json válido {{{";
  setReviewPromptMock(async () => bad);
  try {
    workItemStore.create({ id, prompt: "hola", worktree, phase: "diagnosisLlm" });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    workItemStore.transition(id, "Review", "runner", "verification passed → Review");
    const before = workItemStore.get(id);
    const after = await reviewService.handleReview(before!);
    assert.equal(after?.status, "Review");
    assert.equal(after?.lastReview?.verdict, "ask_human");
    const dir = (after?.dir as string) ?? path.join(worktree, ".agents", "factory", id);
    const rawPath = path.join(dir, "review-raw-1.txt");
    assert.ok(fs.existsSync(rawPath), "parse-fail también debe persistir review-raw-1.txt");
    assert.equal(fs.readFileSync(rawPath, "utf-8"), bad);
  } finally {
    setReviewPromptMock(null);
    workItemStore.clear();
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {}
  }
});
