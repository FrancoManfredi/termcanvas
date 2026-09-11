/**
 * warp-job-timing — B4 stalled detection + B5 session-attach wait state.
 *
 * B4 root cause: the create -> reopen -> match path IS durable
 * (`issueRef` stamped to the timeline meta, restored from job.json by
 * `scanAndRestoreBases`/`workItemStore.restoreFromDisk`, matched by
 * `readFactoryJobIssueRef`). What does NOT survive a daemon restart is
 * forward progress: `restoreJobsFromDisk`
 * (headless-runtime/factory/factoryServer.ts) restores statuses as-is but
 * never re-dispatches workers (dispatch happens only post-201), so a job
 * frozen in Building/Review fakes "in-progress" forever. A second loss
 * mode: job dirs under anchors outside the scanned bases (arbitrary
 * non-termcanvas repos) are never restored at all.
 *
 * Fix: `isFactoryJobStalled` names the frozen combination (non-terminal +
 * no daemon update past the threshold) and the panel renders it honestly
 * ("stalled — …") instead of progress. Offline: pure, zero network.
 *
 * B5 root cause: `dashboardUrl` is set only when a daemon `session.create`
 * succeeds (`syncSessionFieldsAndPersist`); per-role pipeline sessions
 * never backfill the top-level link, so a job whose MVP handshake failed
 * shows no link at ANY stage — including Review. Fix: `sessionAttachState`
 * spells out ready / attaching (with elapsed) / overdue (visible timeout)
 * / absent, and the UI titles say exactly that. Offline: pure.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_ATTACH_TIMEOUT_MS,
  STALLED_JOB_THRESHOLD_MS,
  formatElapsedShort,
  isFactoryJobStalled,
  readJobTimestampMs,
  sessionAttachState,
} from "../src/features/warpPanel/adapters/factoryJobIndex.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const NOW = 1_800_000_000_000;

function job(status: string, updatedAt: unknown): Record<string, unknown> {
  return {
    id: "job-t",
    status,
    createdAt: new Date(NOW - 3_600_000).toISOString(),
    updatedAt,
    timeline: [],
  };
}

test("readJobTimestampMs accepts epoch numbers and ISO strings, rejects junk", () => {
  assert.equal(readJobTimestampMs({ updatedAt: NOW }, "updatedAt"), NOW);
  assert.equal(
    readJobTimestampMs(
      { updatedAt: new Date(NOW).toISOString() },
      "updatedAt",
    ),
    NOW,
  );
  assert.equal(readJobTimestampMs({ updatedAt: null }, "updatedAt"), null);
  assert.equal(readJobTimestampMs({ updatedAt: "ayer" }, "updatedAt"), null);
  assert.equal(readJobTimestampMs({ updatedAt: -5 }, "updatedAt"), null);
  assert.equal(readJobTimestampMs(null, "updatedAt"), null);
  assert.equal(readJobTimestampMs({}, "missing"), null);
});

test("stalled = non-terminal job with no daemon update past the threshold", () => {
  assert.equal(
    isFactoryJobStalled(
      job("Building", new Date(NOW - STALLED_JOB_THRESHOLD_MS - 1).toISOString()),
      NOW,
    ),
    true,
  );
  assert.equal(
    isFactoryJobStalled(
      job("Review", NOW - STALLED_JOB_THRESHOLD_MS - 60_000),
      NOW,
    ),
    true,
  );
});

test("fresh, terminal, and timestamp-less jobs never read as stalled", () => {
  assert.equal(isFactoryJobStalled(job("Building", new Date(NOW).toISOString()), NOW), false);
  assert.equal(
    isFactoryJobStalled(
      job("Complete", new Date(NOW - STALLED_JOB_THRESHOLD_MS - 1).toISOString()),
      NOW,
    ),
    false,
  );
  assert.equal(
    isFactoryJobStalled(
      job("Cancelled", new Date(NOW - STALLED_JOB_THRESHOLD_MS - 1).toISOString()),
      NOW,
    ),
    false,
  );
  assert.equal(isFactoryJobStalled(job("Building", null), NOW), false);
  assert.equal(isFactoryJobStalled(job("Building", "pronto"), NOW), false);
  assert.equal(isFactoryJobStalled(null, NOW), false);
  assert.equal(isFactoryJobStalled(42, NOW), false);
});

test("sessionAttachState spells out the four honest cases", () => {
  assert.deepEqual(
    sessionAttachState({ sessionUrl: "http://x/s/1", active: true }),
    { kind: "ready", elapsedMs: null },
  );
  assert.deepEqual(
    sessionAttachState({
      sessionUrl: null,
      active: true,
      createdAtMs: NOW - 60_000,
      nowMs: NOW,
    }),
    { kind: "attaching", elapsedMs: 60_000 },
  );
  assert.deepEqual(
    sessionAttachState({
      sessionUrl: "  ",
      active: true,
      createdAtMs: NOW - SESSION_ATTACH_TIMEOUT_MS - 1_000,
      nowMs: NOW,
    }),
    { kind: "overdue", elapsedMs: SESSION_ATTACH_TIMEOUT_MS + 1_000 },
  );
  assert.deepEqual(sessionAttachState({ sessionUrl: null, active: false }), {
    kind: "absent",
    elapsedMs: null,
  });
  assert.deepEqual(sessionAttachState({}), {
    kind: "absent",
    elapsedMs: null,
  });
});

test("formatElapsedShort renders honest short ages", () => {
  assert.equal(formatElapsedShort(45_000), "45s");
  assert.equal(formatElapsedShort(180_000), "3m");
  assert.equal(formatElapsedShort(7_200_000), "2h");
  assert.equal(formatElapsedShort(4 * 86_400_000), "4d");
  assert.equal(formatElapsedShort(null), "");
  assert.equal(formatElapsedShort(Number.NaN), "");
});
