/**
 * review-rerun — RE-REVISAR (flujo simple, sin reintentos).
 *
 * POST /factory/jobs/:id/review/rerun: UN solo turno del review agent
 * sobre un job en `Complete`, SIN mover su status. El veredicto se anexa
 * al timeline + raw a disco y viaja en la respuesta.
 * Guards: 404 ausente, 409 si no es Complete / pact / review en curso.
 *
 * Offline con review mock (cero red, cero daemon, cero LLM).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { runReviewRerun } from "../headless-runtime/review/reviewRerun.ts";
import { setReviewPromptMock } from "../headless-runtime/review/reviewAgent.ts";

const TEST_TIMEOUT_MS = 30_000;

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "review-rerun-"));
}

function rmRf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function toComplete(id: string, worktree: string): void {
  workItemStore.create({ id, prompt: "hacer algo", worktree });
  workItemStore.transition(id, "Foreman", "foreman", "t");
  workItemStore.transition(id, "Building", "foreman", "t");
  workItemStore.transition(id, "Review", "runner", "t");
  workItemStore.transition(id, "Complete", "system", "t");
}

function mockVerdict(verdict: string, summary: string, findings: unknown[] = []) {
  setReviewPromptMock(async () =>
    JSON.stringify({ verdict, confidence: 0.9, summary, findings }),
  );
}

// ── Guards ──

test("rerun 404 ante id inválido o ausente", { timeout: TEST_TIMEOUT_MS }, async () => {
  workItemStore.clear();
  try {
    assert.deepEqual(await runReviewRerun(""), { ok: false, code: 404, error: "job not found: " });
    assert.deepEqual(await runReviewRerun("job-no-existe-rr"), {
      ok: false,
      code: 404,
      error: "job not found: job-no-existe-rr",
    });
  } finally {
    workItemStore.clear();
  }
});

test("rerun 409 si no está Complete", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeTmp();
  workItemStore.clear();
  try {
    const id = "job-rerun-notdone01";
    workItemStore.create({ id, prompt: "hacer algo", worktree: wt });
    workItemStore.transition(id, "Foreman", "foreman", "t");
    workItemStore.transition(id, "Building", "foreman", "t");
    const out = await runReviewRerun(id);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.code, 409);
    assert.match(out.error, /solo jobs Complete/);
    assert.equal(workItemStore.get(id)?.status, "Building");
  } finally {
    workItemStore.clear();
    rmRf(wt);
  }
});

test("rerun 409 si hay review en curso (lock tomado)", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeTmp();
  workItemStore.clear();
  try {
    const id = "job-rerun-lock01";
    toComplete(id, wt);
    assert.equal(workItemStore.acquireReviewLock(id), true);
    try {
      const out = await runReviewRerun(id);
      assert.deepEqual(out, { ok: false, code: 409, error: "review en curso para este job" });
    } finally {
      workItemStore.releaseReviewLock(id);
    }
  } finally {
    workItemStore.clear();
    rmRf(wt);
  }
});

// ── Camino feliz ──

test("rerun corre el review sin mover status y anexa timeline+raw", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeTmp();
  workItemStore.clear();
  mockVerdict("accept", "todo bien en la re-revisión");
  try {
    const id = "job-rerun-ok01";
    toComplete(id, wt);
    const out = await runReviewRerun(id);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.id, id);
    assert.equal(out.status, "Complete");
    assert.equal(out.verdict, "accept");
    assert.equal(out.findings, 0);
    assert.equal(out.attempt, 1);
    assert.equal(workItemStore.get(id)?.status, "Complete", "el status no se mueve");
    const tl = workItemStore.get(id)?.timeline ?? [];
    assert.ok(
      tl.some((e) => e.message.startsWith("review: re-run accept")),
      "evento de re-run en timeline",
    );
    const dir = workItemStore.get(id)?.dir as string;
    assert.ok(
      fs.existsSync(path.join(dir, "review-raw-1.txt")),
      "raw del re-run en disco",
    );
  } finally {
    setReviewPromptMock(null);
    workItemStore.clear();
    rmRf(wt);
  }
});

test("rerun con revise no reabre nada: solo reporta", { timeout: TEST_TIMEOUT_MS }, async () => {
  const wt = makeTmp();
  workItemStore.clear();
  mockVerdict("revise", "falta cubrir un caso", [
    { id: "f1", axis: "tests", severity: "major", message: "falta test" },
  ]);
  try {
    const id = "job-rerun-rev01";
    toComplete(id, wt);
    const out = await runReviewRerun(id);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.verdict, "revise");
    assert.equal(out.findings, 1);
    assert.equal(workItemStore.get(id)?.status, "Complete", "ni revise mueve el status");
  } finally {
    setReviewPromptMock(null);
    workItemStore.clear();
    rmRf(wt);
  }
});
