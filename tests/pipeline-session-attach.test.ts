// pipeline-session-attach: orphan jobs get a session without new timers,
// and Triage parking carries fresh questions. Offline: zero network
// (fetch forbidden; triage runs on its mock seam).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";
import { opencodeServerManager } from "../headless-runtime/opencodeServerManager.ts";
import {
  isPipelineLive,
  markPipelineLive,
  resetPipelineLiveForTests,
} from "../headless-runtime/factory/pipelineLive.ts";
import { ensureJobSessionAttached } from "../headless-runtime/factory/factoryServer.ts";
import { refreshTriageQuestionsBestEffort } from "../headless-runtime/implement/implementService.ts";
import { setTriagePromptMock } from "../headless-runtime/triage/triageAgent.ts";
import { getLatestTriage } from "../headless-runtime/triage/triageFlow.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const createdIds: string[] = [];
const createdDirs: string[] = [];

function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attach-test-"));
  createdDirs.push(dir);
  return dir;
}

function mkJob(id: string): void {
  const dir = mkTmp();
  workItemStore.create({ id, prompt: `prompt de prueba ${id}`, worktree: dir });
  createdIds.push(id);
}

function toTriage(id: string): void {
  workItemStore.transition(id, "Foreman", "system", "t → Foreman");
  workItemStore.transition(id, "Triage", "foreman", "f2e2 triaged");
}

test.afterEach(() => {
  for (const id of createdIds.splice(0)) {
    try {
      workItemStore.delete(id);
    } catch {}
  }
  for (const dir of createdDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  try {
    setTriagePromptMock(null);
  } catch {}
  try {
    resetPipelineLiveForTests();
  } catch {}
  try {
    opencodeServerManager.setTestClient(null);
  } catch {}
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test("pipelineLive flag: off by default, arms and resets", () => {
  assert.equal(isPipelineLive(), false);
  markPipelineLive();
  assert.equal(isPipelineLive(), true);
  resetPipelineLiveForTests();
  assert.equal(isPipelineLive(), false);
});

test("ensureJobSessionAttached is inert without pipelineLive (no network, no spawn)", async () => {
  const id = "job-attach-off-1";
  mkJob(id);
  await ensureJobSessionAttached(id);
  const wi = workItemStore.get(id) as unknown as Record<string, unknown>;
  assert.equal(wi.sessionId, undefined);
});

test("ensureJobSessionAttached attaches via manager client (no spawn, no network)", async () => {
  markPipelineLive();
  // Manager test client: URL known + healthy without network, so
  // tryCreate reuses it (no spawn) and create resolves canned (no network).
  opencodeServerManager.setTestClient(
    {
      session: {
        create: async () => ({ data: { id: "ses_test123" } }),
        prompt: async () => ({ data: { info: { role: "assistant" }, parts: [] } }),
        promptAsync: async () => ({ data: {} }),
      },
    } as never,
    "http://127.0.0.1:9",
  );
  try {
    const id = "job-attach-ok-1";
    mkJob(id);
    await ensureJobSessionAttached(id);
    const wi = workItemStore.get(id) as unknown as Record<string, unknown>;
    assert.equal(wi.sessionId, "ses_test123");
    assert.ok(
      typeof wi.dashboardUrl === "string" &&
        (wi.dashboardUrl as string).includes("ses_test123"),
      "dashboardUrl must link the session",
    );
    // Idempotent: second call is a no-op with the link present.
    await ensureJobSessionAttached(id);
    assert.equal(
      (workItemStore.get(id) as unknown as Record<string, unknown>).sessionId,
      "ses_test123",
    );
  } finally {
    opencodeServerManager.setTestClient(null);
  }
});

test("refreshTriageQuestionsBestEffort is inert without pipelineLive", async () => {
  const id = "job-refresh-off-1";
  mkJob(id);
  toTriage(id);
  setTriagePromptMock(async () =>
    JSON.stringify({
      decision: "triage",
      scope: "x",
      complexity: "simple",
      openQuestions: ["P?"],
      reason: "r",
      confidence: 0.8,
    }),
  );
  refreshTriageQuestionsBestEffort(id);
  await sleep(400);
  assert.equal(getLatestTriage({ timeline: workItemStore.get(id)?.timeline }), null);
});

test("refreshTriageQuestionsBestEffort persists fresh questions on Triage parking", async () => {
  markPipelineLive();
  const id = "job-refresh-on-1";
  mkJob(id);
  toTriage(id);
  setTriagePromptMock(async () =>
    JSON.stringify({
      decision: "triage",
      scope: "needs input",
      complexity: "simple",
      openQuestions: ["Which area?", "What goal?"],
      reason: "ambiguous prompt",
      confidence: 0.88,
    }),
  );
  refreshTriageQuestionsBestEffort(id);
  await sleep(600);
  const found = getLatestTriage({ timeline: workItemStore.get(id)?.timeline });
  assert.ok(found, "parked Triage job must carry triage findings");
  assert.deepEqual(found && found.openQuestions, ["Which area?", "What goal?"]);
});
