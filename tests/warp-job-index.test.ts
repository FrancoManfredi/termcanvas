/**
 * warp-job-index — B3: one poll-list index per snapshot instead of a
 * per-row full-list scan.
 *
 * Root cause (file:line):
 * - src/features/warpPanel/adapters/liveIssues.ts (snapshot loop):
 *   `findActiveFactoryJobForIssue(factoryJobs, n, repo)` per issue.
 * - src/features/warpPanel/adapters/liveActivity.ts (snapshot loop): same.
 * Each call re-reads every job's `issueRef` (memory key + timeline
 * reverse-scan), so one 2.5s tick costs O(N x M x T) per adapter
 * (N = issues, M = jobs, T = timeline depth) — ~117k ref reads per
 * adapter per tick at N = M = 342, x2 adapters, plus a markdown
 * re-render per row. Entering Review adds a timeline event + `lastReview`,
 * which rebuilds the list identity and retriggers the whole storm on the
 * exact tick the user watches — the freeze.
 *
 * Fix: `buildFactoryJobIndex` reads each job's ref ONCE per snapshot
 * (O(M x T)); rows resolve via `findActiveFactoryJobForIssueIndexed`
 * (map get + active check over 0-1 candidates). Same match semantics
 * (number equality, repo-must-agree-when-both-known, active only,
 * first-in-list-order wins). Offline: zero network, zero jobs created.
 *
 * Counts (static, not wall-clock benchmarks): linear worst case per
 * adapter per tick = N x M ref reads (no-match rows scan everything);
 * indexed = M ref reads + N map gets.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFactoryJobIndex,
  findActiveFactoryJobForIssueIndexed,
  getFactoryJobIndex,
} from "../src/features/warpPanel/adapters/factoryJobIndex.ts";
import { findActiveFactoryJobForIssue } from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

function activeJob(
  id: string,
  issueNumber: number,
  opts: {
    status?: string;
    repo?: string | null;
    memoryRef?: boolean;
    timelineOnly?: boolean;
  } = {},
): Record<string, unknown> {
  const ref = {
    provider: "github",
    issueNumber,
    repo: opts.repo ?? "owner/repo",
    url: `https://github.com/owner/repo/issues/${issueNumber}`,
  };
  const timeline: Array<Record<string, unknown>> = [
    {
      id: `${id}-t0`,
      from: "Intake",
      to: opts.status ?? "Building",
      at: new Date().toISOString(),
      actor: "system",
      message: "created",
      meta: { issueRef: { ...ref } },
    },
  ];
  return {
    id,
    status: opts.status ?? "Building",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline,
    ...(opts.memoryRef === false ? {} : { issueRef: { ...ref } }),
  };
}

test("index groups by issue number and skips jobs without a ref", () => {
  const jobs = [
    activeJob("job-1", 7),
    activeJob("job-2", 7),
    activeJob("job-3", 9),
    { id: "job-noref", status: "Building" },
    null,
    42,
  ];
  const index = buildFactoryJobIndex(jobs);
  assert.equal(index.get(7)?.length, 2);
  assert.equal(index.get(9)?.length, 1);
  assert.equal(index.has(11), false);
});

test("indexed lookup matches the linear helper on mixed shapes", () => {
  const jobs = [
    activeJob("job-a", 1, { status: "Intake", repo: "owner/repo" }),
    activeJob("job-b", 2, { status: "Review", repo: "other/repo" }),
    activeJob("job-c", 1, { status: "Complete", repo: "owner/repo" }),
    activeJob("job-d", 3, { status: "Building", repo: null }),
    { id: "junk", status: "Building" },
  ];
  const index = buildFactoryJobIndex(jobs);
  const cases: Array<[number, string | null | undefined]> = [
    [1, "owner/repo"],
    [1, null],
    [2, "owner/repo"],
    [2, "other/repo"],
    [3, "anything/repo"],
    [4, "owner/repo"],
  ];
  for (const [n, repo] of cases) {
    const viaIndex = findActiveFactoryJobForIssueIndexed(index, n, repo);
    const viaLinear = findActiveFactoryJobForIssue(jobs, n, repo);
    assert.deepEqual(
      viaIndex === null ? null : (viaIndex as { id: string }).id,
      viaLinear === null ? null : (viaLinear as { id: string }).id,
      `issue #${n} repo=${repo}`,
    );
  }
});

test("terminal jobs never match (queued Intake counts as active)", () => {
  const jobs = [
    activeJob("job-intake", 5, { status: "Intake" }),
    activeJob("job-done", 6, { status: "Complete" }),
    activeJob("job-cancel", 8, { status: "Cancelled" }),
  ];
  const index = buildFactoryJobIndex(jobs);
  assert.equal(
    (findActiveFactoryJobForIssueIndexed(index, 5) as { id: string }).id,
    "job-intake",
  );
  assert.equal(findActiveFactoryJobForIssueIndexed(index, 6), null);
  assert.equal(findActiveFactoryJobForIssueIndexed(index, 8), null);
});

test("B4 restart simulation: timeline-only ref still matches (memory key lost)", () => {
  const job = activeJob("job-restart", 12, { memoryRef: false });
  assert.ok(!("issueRef" in job));
  const index = buildFactoryJobIndex([job]);
  assert.equal(
    (findActiveFactoryJobForIssueIndexed(index, 12) as { id: string }).id,
    "job-restart",
  );
  assert.deepEqual(
    (findActiveFactoryJobForIssue([job], 12) as { id: string }).id,
    "job-restart",
  );
});

test("junk inputs never throw and read as no-match", () => {
  assert.equal(findActiveFactoryJobForIssueIndexed(null, 1), null);
  assert.equal(findActiveFactoryJobForIssueIndexed(undefined, 1), null);
  assert.equal(
    findActiveFactoryJobForIssueIndexed(new Map(), 0, "owner/repo"),
    null,
  );
  assert.equal(
    findActiveFactoryJobForIssueIndexed(new Map([[1, [null]]]), 1),
    null,
  );
  assert.deepEqual(
    [...buildFactoryJobIndex(null).entries()],
    [],
  );
  assert.deepEqual([...buildFactoryJobIndex(42).entries()], []);
});

test("342x342 parity: indexed and linear agree on every row", () => {
  const N = 342;
  const jobs: unknown[] = [];
  for (let i = 1; i <= N; i += 1) {
    // Sparse links: every 3rd issue has an active job, every 7th a
    // terminal one (must not match), rest have no job at all.
    if (i % 3 === 0) jobs.push(activeJob(`job-live-${i}`, i));
    if (i % 7 === 0) {
      jobs.push(activeJob(`job-old-${i}`, i, { status: "Complete" }));
    }
  }
  const index = buildFactoryJobIndex(jobs);
  // Static op counts for the report (no wall-clock benchmark):
  // linear worst case per adapter per tick = N rows x M jobs ref reads.
  const linearWorstCase = N * jobs.length;
  // indexed = M ref reads (one pass) + N map gets.
  const indexedOps = jobs.length + N;
  assert.ok(
    indexedOps < linearWorstCase,
    `indexed (${indexedOps}) must stay far below linear worst case (${linearWorstCase})`,
  );
  for (let n = 1; n <= N; n += 1) {
    const viaIndex = findActiveFactoryJobForIssueIndexed(index, n, "owner/repo");
    const viaLinear = findActiveFactoryJobForIssue(jobs, n, "owner/repo");
    assert.deepEqual(
      viaIndex === null ? null : (viaIndex as { id: string }).id,
      viaLinear === null ? null : (viaLinear as { id: string }).id,
      `row #${n}`,
    );
  }
});

// ─── Ola B3: shared memoized index (one build per payload) ───────────────
// Both adapters + detail used to build 3 indexes per tick over the same
// array. `getFactoryJobIndex` builds once per array identity (WeakMap) so
// a tick costs a single O(M x T) build shared by all readers — and zero
// builds in steady state (the `setWorkItems` identity guard keeps the
// array, so every tick is a cache hit).

test("same array identity returns the same index instance", () => {
  const jobs = [activeJob("job-1", 7), activeJob("job-2", 9)];
  const first = getFactoryJobIndex(jobs);
  const second = getFactoryJobIndex(jobs);
  assert.equal(second, first, "cache hit: identical instance");
  assert.equal(first.get(7)?.length, 1);
  assert.equal(first.get(9)?.length, 1);
});

test("new identity rebuilds with equal content", () => {
  const jobs = [activeJob("job-1", 7)];
  const first = getFactoryJobIndex(jobs);
  const clone: unknown[] = JSON.parse(JSON.stringify(jobs)) as unknown[];
  const second = getFactoryJobIndex(clone);
  assert.notEqual(second, first, "different array → different instance");
  assert.deepEqual(
    [...second.entries()].map(([k, v]) => [k, v.length]),
    [...first.entries()].map(([k, v]) => [k, v.length]),
  );
});

test("shared index resolves through the indexed lookup", () => {
  const jobs = [activeJob("job-1", 7)];
  const index = getFactoryJobIndex(jobs);
  assert.equal(
    (findActiveFactoryJobForIssueIndexed(index, 7, "owner/repo") as { id: string }).id,
    "job-1",
  );
});

test("junk never throws and reads empty", () => {
  assert.deepEqual([...getFactoryJobIndex(null).entries()], []);
  assert.deepEqual([...getFactoryJobIndex(42).entries()], []);
  assert.deepEqual([...getFactoryJobIndex("junk").entries()], []);
});
