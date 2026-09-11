/**
 * warp-pr-chain — item 4 (PR checkability, renderer-side slice).
 *
 * The daemon opens the handoff PR once per job on first `Complete`
 * (`maybeOpenPrForCompletedJob`) and records branch + PR link on the job's
 * `isolation` record. The UI reads the EXISTING 2.5s poll list
 * (`GET /factory/jobs` → `toListItem`), so the branch/PR fields must
 * travel in the list item — previously only the timeline reverse-scan
 * carried them, and the memory fast-path never hit from poll data.
 *
 * Under test:
 * - `toListItem` / `toDetail` project `isolation` (additive, omitted when
 *   absent or branch-less — honest-empty, never invented).
 * - The projected item feeds the renderer readers directly:
 *   `readFactoryJobIsolation` (memory fast path, no timeline scan) and
 *   `readFactoryJobPrLink` (PR URL alive to the UI).
 * - Junk isolation (non-record, branch-less) projects nothing.
 *
 * Offline: pure projections, zero network, zero daemon. (The daemon-side
 * chain — verify-sink stalls, GH_TOKEN setup, push/pr-create guards — is
 * reported with file:line evidence in the batch report; the token itself
 * is operational and never hardcoded.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  toDetail,
  toListItem,
} from "../headless-runtime/workItem/jobView.ts";
import {
  readFactoryJobIsolation,
  readFactoryJobPrLink,
} from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

function workItem(patch: Record<string, unknown> = {}): never {
  return {
    id: "job-pr-1",
    prompt: "# Resolve issue #7 — Label test",
    worktree: "C:/repos/termcanvas/.worktrees/issue-7",
    phase: "diagnosisLlm",
    status: "Complete",
    state: "done",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: [],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir: ".agents/factory/job-pr-1",
    dotDonePath: ".agents/factory/job-pr-1/.done",
    runnerId: "linux-build",
    logs: [],
    ...patch,
  } as never;
}

const ISOLATION = {
  branch: "issue-7",
  baseBranch: "main",
  worktreePath: "C:/repos/termcanvas/.worktrees/issue-7",
  repoRoot: "C:/repos/termcanvas",
  prNumber: 61,
  prUrl: "https://github.com/org/termcanvas/pull/61",
  state: "pr-open",
};

// ─── toListItem ────────────────────────────────────────────────────────────

test("toListItem projects the isolation record (branch + PR alive)", () => {
  const item = toListItem(workItem({ isolation: { ...ISOLATION } })) as Record<
    string,
    unknown
  >;
  assert.deepEqual(item.isolation, ISOLATION);
});

test("toListItem omits isolation when absent (honest-empty)", () => {
  const item = toListItem(workItem()) as Record<string, unknown>;
  assert.ok(!("isolation" in item));
});

test("toListItem omits branch-less/error isolation records", () => {
  const branchLess = toListItem(
    workItem({ isolation: { error: "isolation unavailable" } }),
  ) as Record<string, unknown>;
  assert.ok(!("isolation" in branchLess));
  const junk = toListItem(
    workItem({ isolation: "issue-7" }),
  ) as Record<string, unknown>;
  assert.ok(!("isolation" in junk));
});

test("toListItem keeps unknown isolation keys out of the poll shape", () => {
  const item = toListItem(
    workItem({
      isolation: { ...ISOLATION, secret: "nope", createdAt: "2026-01-01" },
    }),
  ) as Record<string, unknown>;
  const projected = item.isolation as Record<string, unknown>;
  assert.ok(!("secret" in projected));
  assert.ok(!("createdAt" in projected));
  assert.equal(projected.branch, "issue-7");
});

// ─── toDetail ──────────────────────────────────────────────────────────────

test("toDetail projects the isolation record too", () => {
  const item = toDetail(workItem({ isolation: { ...ISOLATION } })) as Record<
    string,
    unknown
  >;
  assert.deepEqual(item.isolation, ISOLATION);
});

test("toDetail omits isolation when absent", () => {
  const item = toDetail(workItem()) as Record<string, unknown>;
  assert.ok(!("isolation" in item));
});

// ─── renderer readers over the projected item ──────────────────────────────

test("projected list item feeds readFactoryJobIsolation via the fast path", () => {
  // No timeline at all: the memory record alone must satisfy the reader.
  const item = toListItem(workItem({ isolation: { ...ISOLATION } }));
  const isolation = readFactoryJobIsolation(item);
  assert.equal(isolation?.branch, "issue-7");
  assert.equal(
    isolation?.worktreePath,
    "C:/repos/termcanvas/.worktrees/issue-7",
  );
  assert.equal(isolation?.prNumber, 61);
});

test("projected list item feeds readFactoryJobPrLink (PR URL alive)", () => {
  const item = toListItem(workItem({ isolation: { ...ISOLATION } }));
  const link = readFactoryJobPrLink(item);
  assert.equal(link?.prUrl, "https://github.com/org/termcanvas/pull/61");
  assert.equal(link?.prNumber, 61);
});

test("timeline pr meta still resolves the link when isolation is absent", () => {
  const item = toListItem(
    workItem({
      timeline: [
        {
          id: "t1",
          from: "Complete",
          to: "Complete",
          at: new Date().toISOString(),
          actor: "system",
          message: "pr opened #61 https://github.com/org/termcanvas/pull/61",
          meta: {
            pr: {
              prNumber: 61,
              prUrl: "https://github.com/org/termcanvas/pull/61",
            },
          },
        },
      ],
    }),
  );
  const link = readFactoryJobPrLink(item);
  assert.equal(link?.prUrl, "https://github.com/org/termcanvas/pull/61");
});
