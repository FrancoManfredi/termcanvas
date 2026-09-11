/**
 * factory-session-worktree — B2: opencode sessions open with the job's
 * effective worktree (isolation jail), not the termcanvas repo root.
 *
 * Root cause (file:line):
 * - headless-runtime/foreman/foreman.ts (createForemanSession):
 *   `directory = workItem.worktree` (raw anchor, jail ignored).
 * - headless-runtime/triage/triageFlow.ts (runTriageForJob):
 *   `worktreePath: workItem.worktree` (raw anchor, jail ignored).
 * - headless-runtime/spec/specFlow.ts (runSpecForJob):
 *   `worktreePath: workItem.worktree` (raw anchor, jail ignored).
 * - headless-runtime/factory/factoryServer.ts (tryCreateOpencodeSession):
 *   `resolveOpencodeDirectory(job.worktree)` on the anchor, before/ignoring
 *   the post-201 isolation record.
 * implementService/reviewService already used `effectiveWorktreeFor` — the
 * foreman/triage/spec trio was the gap, so their sessions ran with the
 * anchor cwd (termcanvas repo root via the resolve fallback) while the
 * real work happens in the isolated `issue-N` worktree.
 *
 * Fix: every session.create site resolves through
 * `resolveSessionWorktree` (jail when recorded — memory fast path, then
 * timeline durable path — else the resolved anchor). Offline: zero
 * network, zero jobs created, explicit timeouts untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveSessionWorktree } from "../headless-runtime/factory/isolation/sessionWorktree.ts";
import { effectiveWorktreeFor } from "../headless-runtime/factory/isolation/isolationStore.ts";
import { runTriageForJob } from "../headless-runtime/triage/triageFlow.ts";
import {
  setTriagePromptMock,
  type TriageAgentInput,
} from "../headless-runtime/triage/triageAgent.ts";
import { runSpecForJob } from "../headless-runtime/spec/specFlow.ts";
import {
  setSpecPromptMock,
  type SpecAgentInput,
} from "../headless-runtime/spec/specAgent.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const ANCHOR = path.resolve("canvas-anchor-repo");
const JAIL = path.resolve("jail-issue-42");

function jailTimeline(worktreePath: string): Array<Record<string, unknown>> {
  return [
    {
      id: "job-x-t0",
      from: "Intake",
      to: "Intake",
      at: new Date().toISOString(),
      actor: "user",
      message: "created Intake",
    },
    {
      id: "job-x-t1",
      from: "Intake",
      to: "Foreman",
      at: new Date().toISOString(),
      actor: "system",
      message: "isolation created branch=issue-42-x",
      meta: {
        isolation: {
          branch: "issue-42-x",
          baseBranch: "main",
          worktreePath,
          repoRoot: ANCHOR,
          state: "created",
          createdAt: new Date().toISOString(),
        },
      },
    },
  ];
}

test("memory jail wins over the anchor", () => {
  assert.equal(
    resolveSessionWorktree({
      worktree: ANCHOR,
      isolation: { worktreePath: JAIL },
    }),
    JAIL,
  );
});

test("timeline durable jail wins after a daemon restart (memory lost)", () => {
  assert.equal(
    resolveSessionWorktree({ worktree: ANCHOR, timeline: jailTimeline(JAIL) }),
    JAIL,
  );
});

test("no jail recorded falls back to the resolved anchor (legacy in-place)", () => {
  assert.equal(resolveSessionWorktree({ worktree: ANCHOR }), ANCHOR);
  assert.equal(
    resolveSessionWorktree({ worktree: "relative-anchor" }),
    path.resolve("relative-anchor"),
  );
});

test("junk never throws and never invents a repo root", () => {
  assert.equal(typeof resolveSessionWorktree({}), "string");
  assert.equal(typeof resolveSessionWorktree(null), "string");
  assert.equal(typeof resolveSessionWorktree(undefined), "string");
  assert.equal(typeof resolveSessionWorktree({ worktree: 42 }), "string");
});

test("single-resolver parity with effectiveWorktreeFor on fixtures", () => {
  const fixtures = [
    { worktree: ANCHOR, isolation: { worktreePath: JAIL } },
    { worktree: ANCHOR, timeline: jailTimeline(JAIL) },
    { worktree: ANCHOR },
  ];
  for (const fixture of fixtures) {
    assert.equal(
      resolveSessionWorktree(fixture),
      effectiveWorktreeFor(fixture),
    );
  }
});

test("runTriageForJob forwards the jail to the session input (not the anchor)", async () => {
  let seen: TriageAgentInput | null = null;
  setTriagePromptMock(async (input) => {
    seen = input;
    return null;
  });
  try {
    await runTriageForJob({
      id: "job-b2-triage",
      prompt: "Fix the thing",
      worktree: ANCHOR,
      isolation: {
        branch: "issue-42-x",
        baseBranch: "main",
        worktreePath: JAIL,
        repoRoot: ANCHOR,
      },
      timeline: [],
    });
  } finally {
    setTriagePromptMock(null);
  }
  assert.ok(seen !== null);
  assert.equal((seen as unknown as TriageAgentInput).worktreePath, JAIL);
});

test("runSpecForJob forwards the jail to the session input (not the anchor)", async () => {
  let seen: SpecAgentInput | null = null;
  setSpecPromptMock(async (input) => {
    seen = input;
    return null;
  });
  try {
    await runSpecForJob({
      id: "job-b2-spec",
      prompt: "Fix the thing",
      worktree: ANCHOR,
      isolation: {
        branch: "issue-42-x",
        baseBranch: "main",
        worktreePath: JAIL,
        repoRoot: ANCHOR,
      },
      timeline: [],
    });
  } finally {
    setSpecPromptMock(null);
  }
  assert.ok(seen !== null);
  assert.equal((seen as unknown as SpecAgentInput).worktreePath, JAIL);
});
