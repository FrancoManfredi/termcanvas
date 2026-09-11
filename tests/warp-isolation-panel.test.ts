/**
 * T02 — Warp isolation panel surface, offline unit suite.
 *
 * Covers DESIGN-isolation §9 Eng B (≥12): `readFactoryJobIsolation`
 * incl. malformed/absent, `readFactoryJobPrLink` never-synthesized,
 * `IssueFactoryJob` branch/pr display mapping via
 * `describeFactoryJobForPanel`, and `deleteFactoryJobWorktree` fallback
 * shape — all offline (`node:test`, injected fetch fakes, zero
 * network/daemon).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  describeFactoryJobForPanel,
  readFactoryJobIsolation,
  readFactoryJobPrLink,
  sanitizeFactoryJobIsolation,
  FACTORY_ISOLATION_META_KEY,
  FACTORY_PR_META_KEY,
} from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";
import {
  deleteFactoryJobWorktree,
  FACTORY_WORKTREE_DELETE_TIMEOUT_MS,
  type FactoryFetch,
} from "../src/lib/factoryClient.ts";

/** Meta keys ride the T01 contract (memory object + timeline durable path). */
test("contract: panel meta keys match the daemon isolation/pr keys", () => {
  assert.equal(FACTORY_ISOLATION_META_KEY, "isolation");
  assert.equal(FACTORY_PR_META_KEY, "pr");
});

// ── readFactoryJobIsolation: absent / malformed / memory / timeline ──

test("isolation absent reads honest-empty (null, never invented)", () => {
  assert.equal(readFactoryJobIsolation(null), null);
  assert.equal(readFactoryJobIsolation(undefined), null);
  assert.equal(readFactoryJobIsolation({}), null);
  assert.equal(readFactoryJobIsolation({ id: "job-1", status: "Building" }), null);
  assert.equal(readFactoryJobIsolation({ isolation: null, timeline: [] }), null);
});

test("isolation reads the memory record with branch + optionals", () => {
  const job = {
    id: "job-1",
    status: "Building",
    isolation: {
      branch: "issue-60-probe",
      baseBranch: "main",
      worktreePath: "C:/repo/.worktrees/issue-60-probe",
      repoRoot: "C:/repo",
      state: "created",
      createdAt: "2026-09-07T12:00:00.000Z",
    },
  };
  const found = readFactoryJobIsolation(job);
  assert.ok(found !== null);
  assert.equal(found.branch, "issue-60-probe");
  assert.equal(found.baseBranch, "main");
  assert.equal(found.worktreePath, "C:/repo/.worktrees/issue-60-probe");
  assert.equal(found.state, "created");
});

test("isolation ignores a malformed memory record and falls to the timeline", () => {
  const job = {
    id: "job-1",
    status: "Building",
    isolation: { baseBranch: "main" },
    timeline: [
      {
        id: "t0",
        at: "2026-09-07T12:00:00.000Z",
        meta: {
          [FACTORY_ISOLATION_META_KEY]: {
            branch: "issue-60-from-disk",
            baseBranch: "main",
            worktreePath: "C:/repo/.worktrees/issue-60-from-disk",
            repoRoot: "C:/repo",
            state: "created",
          },
        },
      },
    ],
  };
  const found = readFactoryJobIsolation(job);
  assert.ok(found !== null);
  assert.equal(found.branch, "issue-60-from-disk");
});

test("isolation newest timeline entry wins (restart-from-disk durable path)", () => {
  const record = (branch: string) => ({
    branch,
    baseBranch: "main",
    worktreePath: `C:/repo/.worktrees/${branch}`,
    repoRoot: "C:/repo",
    state: "created",
  });
  const job = {
    id: "job-1",
    status: "Review",
    timeline: [
      { id: "t0", meta: { [FACTORY_ISOLATION_META_KEY]: record("issue-60-old") } },
      { id: "t1", meta: { [FACTORY_ISOLATION_META_KEY]: { junk: true } } },
      { id: "t2", meta: { [FACTORY_ISOLATION_META_KEY]: record("issue-60-new") } },
    ],
  };
  assert.equal(readFactoryJobIsolation(job)?.branch, "issue-60-new");
});

test("sanitize requires branch and drops malformed optionals", () => {
  assert.equal(sanitizeFactoryJobIsolation({}), null);
  assert.equal(sanitizeFactoryJobIsolation({ branch: "" }), null);
  assert.equal(sanitizeFactoryJobIsolation({ branch: 42 }), null);
  const clean = sanitizeFactoryJobIsolation({
    branch: "issue-7-x",
    prNumber: -3,
    prUrl: "not-a-url",
    state: "",
  });
  assert.ok(clean !== null);
  assert.equal(clean.branch, "issue-7-x");
  assert.equal(clean.prNumber, undefined);
  assert.equal(clean.prUrl, undefined);
  assert.equal(clean.state, undefined);
});

// ── readFactoryJobPrLink: never synthesized ──

test("pr link absent reads null (no PR yet is honest-empty)", () => {
  assert.equal(readFactoryJobPrLink({ id: "job-1", status: "Building" }), null);
  assert.equal(
    readFactoryJobPrLink({ isolation: { branch: "issue-7-x" } }),
    null,
  );
});

test("pr link returns the daemon-built URL from the memory record", () => {
  const job = {
    id: "job-1",
    status: "Complete",
    isolation: {
      branch: "issue-60-probe",
      baseBranch: "main",
      worktreePath: "C:/repo/.worktrees/issue-60-probe",
      repoRoot: "C:/repo",
      state: "pr-open",
      prNumber: 61,
      prUrl: "https://github.com/o/r/pull/61",
    },
  };
  const link = readFactoryJobPrLink(job);
  assert.ok(link !== null);
  assert.equal(link.prUrl, "https://github.com/o/r/pull/61");
  assert.equal(link.prNumber, 61);
});

test("pr link is never synthesized from a bare number and rejects junk URLs", () => {
  assert.equal(
    readFactoryJobPrLink({ isolation: { branch: "issue-7-x", prNumber: 61 } }),
    null,
  );
  assert.equal(
    readFactoryJobPrLink({
      isolation: { branch: "issue-7-x", prUrl: "ftp://o/r/1", prNumber: 1 },
    }),
    null,
  );
  assert.equal(
    readFactoryJobPrLink({
      isolation: { branch: "issue-7-x", prUrl: "  ", prNumber: 1 },
    }),
    null,
  );
});

test("pr link reads the timeline pr meta durable path", () => {
  const job = {
    id: "job-1",
    status: "Complete",
    isolation: { branch: "issue-60-probe" },
    timeline: [
      {
        id: "t9",
        meta: {
          [FACTORY_PR_META_KEY]: {
            prNumber: 61,
            prUrl: "https://github.com/o/r/pull/61",
          },
        },
      },
    ],
  };
  const link = readFactoryJobPrLink(job);
  assert.ok(link !== null);
  assert.equal(link.prUrl, "https://github.com/o/r/pull/61");
  assert.equal(link.prNumber, 61);
});

// ── IssueFactoryJob display mapping ──

test("describe attaches branch + pr link to the panel snapshot", () => {
  const info = describeFactoryJobForPanel({
    id: "job-1",
    status: "Review",
    isolation: {
      branch: "issue-60-probe",
      baseBranch: "main",
      worktreePath: "C:/repo/.worktrees/issue-60-probe",
      repoRoot: "C:/repo",
      state: "pr-open",
      prNumber: 61,
      prUrl: "https://github.com/o/r/pull/61",
    },
  });
  assert.ok(info !== null);
  assert.equal(info.branch, "issue-60-probe");
  assert.equal(info.prNumber, 61);
  assert.equal(info.prUrl, "https://github.com/o/r/pull/61");
  assert.equal(info.stage, "Review");
});

test("describe leaves branch/pr absent when the job has no isolation", () => {
  const info = describeFactoryJobForPanel({ id: "job-1", status: "Building" });
  assert.ok(info !== null);
  assert.equal(info.branch, undefined);
  assert.equal(info.prNumber, undefined);
  assert.equal(info.prUrl, undefined);
});

test("describe ignores malformed isolation without breaking the stage", () => {
  const info = describeFactoryJobForPanel({
    id: "job-1",
    status: "Building",
    isolation: { branch: "", prUrl: "junk" },
  });
  assert.ok(info !== null);
  assert.equal(info.stage, "Building");
  assert.equal(info.branch, undefined);
  assert.equal(info.prUrl, undefined);
});

// ── deleteFactoryJobWorktree client ──

const TEST_PORT = 19877;

/** Real-network guard: the suite only ever uses the injected fetch. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests (pass fetchFn)");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  init?: RequestInit;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FactoryFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as FactoryFetch & { calls: Call[] };
  fn.calls = calls;
  return fn;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("delete uses a named timeout and the canonical worktree path", async () => {
  assert.ok(
    FACTORY_WORKTREE_DELETE_TIMEOUT_MS > 0 &&
      FACTORY_WORKTREE_DELETE_TIMEOUT_MS <= 60000,
  );
  const fetchFn = mockFetch(() =>
    jsonRes({ ok: true, id: "job-1", path: "C:/w", state: "cleaned" }),
  );
  const res = await deleteFactoryJobWorktree("job-1", {
    fetchFn,
    port: TEST_PORT,
  });
  assert.equal(res.ok, true);
  assert.equal(
    fetchFn.calls[0].url,
    `http://127.0.0.1:${TEST_PORT}/factory/jobs/job-1/worktree`,
  );
  assert.equal(fetchFn.calls[0].init?.method, "DELETE");
  if (res.ok) {
    assert.equal(res.data.path, "C:/w");
    assert.equal(res.data.state, "cleaned");
  }
});

test("delete sends force only when asked and parses the 200 shape", async () => {
  const fetchFn = mockFetch(() =>
    jsonRes({ ok: true, id: "job-9", path: "C:/w", state: "cleaned" }),
  );
  const res = await deleteFactoryJobWorktree("job-9", {
    fetchFn,
    port: TEST_PORT,
    force: true,
  });
  assert.equal(res.ok, true);
  assert.match(String(fetchFn.calls[0].init?.body ?? ""), /force/);
  const plain = mockFetch(() =>
    jsonRes({ ok: true, id: "job-9", path: "C:/w", state: "cleaned" }),
  );
  await deleteFactoryJobWorktree("job-9", { fetchFn: plain, port: TEST_PORT });
  assert.doesNotMatch(String(plain.calls[0].init?.body ?? ""), /force/);
});

test("delete invalid id never touches the network (honest fallback)", async () => {
  const fetchFn = mockFetch(() => jsonRes({ ok: true }));
  const res = await deleteFactoryJobWorktree("../x", {
    fetchFn,
    port: TEST_PORT,
  });
  assert.equal(res.ok, false);
  assert.equal(fetchFn.calls.length, 0);
  assert.equal(res.data.path, null);
  assert.equal(res.data.state, null);
});

test("delete transport failure and 409 keep the honest fallback, never throw", async () => {
  const down = mockFetch(() => {
    throw new Error("boom");
  });
  const r1 = await deleteFactoryJobWorktree("job-1", {
    fetchFn: down,
    port: TEST_PORT,
  });
  assert.equal(r1.ok, false);
  assert.equal(r1.data.path, null);
  const refused = mockFetch(() =>
    jsonRes({ error: "PR is still open (pass force to remove anyway)" }, 409),
  );
  const r2 = await deleteFactoryJobWorktree("job-1", {
    fetchFn: refused,
    port: TEST_PORT,
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.status, 409);
  assert.match(String((r2 as { error?: string }).error ?? ""), /open/i);
});
