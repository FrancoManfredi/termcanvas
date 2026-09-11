/**
 * F1-T2 — webhook intake suite (service + jobCreate, 100% offline).
 * `npx tsx --test tests/integrations-webhook-intake.test.ts` (offline, no daemon).
 *
 * Covers the T2 DONE slice for intake:
 * - liveMode:false (default) refuses with an honest 409 and creates NO job
 *   (mock-local behavior byte-exact).
 * - Invalid events refuse with a 400; garbage input never throws.
 * - Dedupe: the same eventId twice yields created then skipped-dedupe
 *   (writer called exactly once).
 * - Filter reject yields skipped-filter with a one-line explain string.
 * - Reply-continues-item via jobCreate: same threadId twice yields ONE job
 *   (201 then 200 continued, same jobId, no dup); replyTo resolves the
 *   parent; old jobs without refs never match (restore-tolerant).
 * - Service continue path reuses the same jobId through injected writers.
 *
 * Sandbox: `TERMCANVAS_FACTORY_DIR` points at a tmpdir; job worktrees are
 * tmpdirs. The global `fetch` is guarded: this suite is offline, so any
 * real network call fails the run. ESM only, zero `require()`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "intake-test-"));
const SANDBOX_FACTORY = path.join(SANDBOX_ROOT, "factory");
fs.mkdirSync(SANDBOX_FACTORY, { recursive: true });
process.env.TERMCANVAS_FACTORY_DIR = SANDBOX_FACTORY;

import {
  handleIntakeEvent,
  resetIntakeDedupeForTests,
} from "../headless-runtime/factory/integrations/integrationService.ts";
import type { IntakeOptions } from "../headless-runtime/factory/integrations/integrationService.ts";
import {
  createJobWithIntegrationRef,
  findJobIdByIntegrationThread,
  findJobIdForIntake,
  getIntegrationRef,
  stampIntegrationRef,
} from "../headless-runtime/factory/jobs/jobCreate.ts";
import { workItemStore } from "../headless-runtime/workItem/workItemStore.ts";

// ── Offline guard: intake creates jobs locally, never touches network ──

let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("real network forbidden in tests (intake is offline)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
  assert.equal(fetchCalls, 0, "suite is offline: fetch never called");
});

test.beforeEach(() => {
  try {
    resetIntakeDedupeForTests();
  } catch {
    // reset never blocks a test
  }
});

// ── Fakes (injected writers: the service never touches disk here) ──

interface FakeJob {
  id: string;
  threadId: string;
  messages: string[];
}

function makeFakeWriters() {
  const jobs = new Map<string, FakeJob>();
  let n = 0;
  const calls: string[] = [];
  return {
    jobs,
    calls,
    findJob: (threadId: string, replyTo: string | null): string | null => {
      try {
        if (typeof replyTo === "string" && replyTo.length > 0) {
          for (const j of jobs.values()) {
            if (j.threadId === replyTo) return j.id;
          }
        }
        for (const j of jobs.values()) {
          if (j.threadId === threadId) return j.id;
        }
        return null;
      } catch {
        return null;
      }
    },
    createJob: (input: {
      prompt: string;
      worktree: string;
      threadId: string;
      replyTo: string | null;
      eventId: string;
      provider: "linear" | "slack";
      liveMode: boolean;
    }) => {
      calls.push(input.threadId);
      n += 1;
      const id = `job-fake-${n}`;
      jobs.set(id, { id, threadId: input.threadId, messages: [input.prompt] });
      return { ok: true as const, jobId: id, continued: false as const };
    },
    appendToJob: (jobId: string, message: string): boolean => {
      const j = jobs.get(jobId);
      if (!j) return false;
      j.messages.push(message);
      return true;
    },
  };
}

function liveOpts(
  over?: Partial<IntakeOptions>,
  writers?: ReturnType<typeof makeFakeWriters>,
): IntakeOptions {
  const w = writers ?? makeFakeWriters();
  return {
    live: {
      liveMode: true,
      provider: "linear",
      vaultRef: "TERMCANVAS_TEST_F1T2_MISSING",
      webhookSecretRef: "",
      allowPostBack: true,
    },
    jobs: { findJob: w.findJob, createJob: w.createJob, appendToJob: w.appendToJob },
    ...over,
  };
}

function intakeEvent(over?: Record<string, unknown>) {
  return {
    provider: "linear",
    threadId: "LIN-42",
    title: "Fix the badge",
    body: "the badge shows USD 0.00 as data",
    labels: ["factory"],
    eventId: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ...over,
  };
}

// ── liveMode:false default: mock-local intact, zero jobs ──

test("liveMode:false refuses intake with 409 and creates no job", { timeout: 15000 }, async () => {
  const w = makeFakeWriters();
  const res = await handleIntakeEvent(intakeEvent(), {
    live: {
      liveMode: false,
      provider: "linear",
      vaultRef: "",
      webhookSecretRef: "",
      allowPostBack: true,
    },
    jobs: { findJob: w.findJob, createJob: w.createJob, appendToJob: w.appendToJob },
  });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, 409);
  assert.equal(w.calls.length, 0);
});

test("missing yaml live block defaults to off (409, no job)", { timeout: 15000 }, async () => {
  const w = makeFakeWriters();
  const res = await handleIntakeEvent(intakeEvent(), {
    factoryDir: SANDBOX_FACTORY,
    jobs: { findJob: w.findJob, createJob: w.createJob, appendToJob: w.appendToJob },
  });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, 409);
  assert.equal(w.calls.length, 0);
});

// ── validation: invalid events refuse, garbage never throws ──

test("invalid intake events refuse with 400", { timeout: 15000 }, async () => {
  const w = makeFakeWriters();
  const opts = liveOpts({}, w);
  for (const bad of [
    intakeEvent({ threadId: "" }),
    intakeEvent({ title: "" }),
    intakeEvent({ provider: "email" }),
    { nope: true },
    null,
    "evt",
    42,
  ]) {
    const res = await handleIntakeEvent(bad, opts);
    assert.equal(res.ok, false, `must refuse ${JSON.stringify(bad)?.slice(0, 60)}`);
    if (!res.ok) assert.equal(res.code, 400);
  }
  assert.equal(w.calls.length, 0);
});

// ── create → dedupe ──

test("matched event creates one job; same eventId dedupes", { timeout: 15000 }, async () => {
  const w = makeFakeWriters();
  const opts = liveOpts({}, w);
  const ev = intakeEvent({ eventId: "evt-dedupe-1" });
  const first = await handleIntakeEvent(ev, opts);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.outcome, "created");
  assert.ok(typeof first.jobId === "string" && first.jobId.length > 0);
  const second = await handleIntakeEvent(ev, opts);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.outcome, "skipped-dedupe");
  assert.equal(w.calls.length, 1);
});

// ── filter reject ──

test("filter mismatch skips with a one-line explain and no job", { timeout: 15000 }, async () => {
  const w = makeFakeWriters();
  const opts = liveOpts(
    {
      live: {
        liveMode: true,
        provider: "linear",
        vaultRef: "TERMCANVAS_TEST_F1T2_MISSING",
        webhookSecretRef: "",
        allowPostBack: true,
        filter: { field: "label", equals: "no-such-label" },
      },
    },
    w,
  );
  const res = await handleIntakeEvent(intakeEvent({ eventId: "evt-filter-1" }), opts);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.outcome, "skipped-filter");
  assert.equal(res.jobId, null);
  assert.ok(res.explain.length > 0);
  assert.equal(res.explain.includes("\n"), false);
  assert.equal(w.calls.length, 0);
});

// ── service continue path reuses the job ──

test("reply on a known thread continues the same job (no dup)", { timeout: 15000 }, async () => {
  const w = makeFakeWriters();
  const opts = liveOpts({}, w);
  const created = await handleIntakeEvent(
    intakeEvent({ threadId: "LIN-7", eventId: "evt-c-1" }),
    opts,
  );
  assert.equal(created.ok, true);
  if (!created.ok || created.jobId === null) return;
  const reply = await handleIntakeEvent(
    intakeEvent({ threadId: "LIN-7", replyTo: "LIN-7", eventId: "evt-c-2", title: "re: badge" }),
    opts,
  );
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.equal(reply.outcome, "continued");
  assert.equal(reply.jobId, created.jobId);
  assert.equal(w.calls.length, 1);
  assert.equal(w.jobs.get(created.jobId)?.messages.length, 2);
});

// ── jobCreate real store: create, lookup, continue, restore-tolerant ──

function tmpWorktree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "intake-job-"));
  return dir;
}

test("jobCreate stamps the ref and continues the same job on reply", { timeout: 15000 }, () => {
  const worktree = tmpWorktree();
  const thread = `T-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const first = createJobWithIntegrationRef({
    prompt: "intake: fix the badge",
    worktree,
    ref: { provider: "linear", threadId: thread, eventId: "e-1", liveMode: true },
  });
  assert.equal(first.status, 201);
  assert.equal(first.continued, false);
  assert.ok(typeof first.jobId === "string" && first.jobId.length > 0);
  const jobId = first.jobId as string;
  try {
    assert.equal(findJobIdByIntegrationThread(thread), jobId);
    assert.equal(findJobIdForIntake(thread, null), jobId);
    assert.equal(findJobIdForIntake("other-thread", thread), jobId);
    const ref = getIntegrationRef(jobId);
    assert.ok(ref !== null && ref.threadId === thread && ref.provider === "linear");
    const reply = createJobWithIntegrationRef({
      prompt: "intake reply",
      worktree,
      replyTo: thread,
      ref: { provider: "linear", threadId: thread, eventId: "e-2", liveMode: true },
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.continued, true);
    assert.equal(reply.jobId, jobId);
  } finally {
    try {
      workItemStore.delete(jobId);
    } catch {
      // cleanup is best-effort
    }
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // cleanup is best-effort
    }
  }
});

test("jobCreate lookups are restore-tolerant (unknowns are null/false)", { timeout: 15000 }, () => {
  assert.equal(findJobIdByIntegrationThread("T-NEVER-EXISTED"), null);
  assert.equal(findJobIdByIntegrationThread(""), null);
  assert.equal(findJobIdByIntegrationThread(null), null);
  assert.equal(findJobIdForIntake(null, null), null);
  assert.equal(getIntegrationRef("job-missing"), null);
  assert.equal(getIntegrationRef(""), null);
  assert.equal(stampIntegrationRef("job-missing", { provider: "linear", threadId: "t", eventId: "e" }), false);
  assert.equal(stampIntegrationRef("job-missing", { nope: true }), false);
  const bad = createJobWithIntegrationRef({
    prompt: "x",
    worktree: tmpWorktree(),
    ref: { provider: "linear", threadId: "", eventId: "e" },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.jobId, null);
});
