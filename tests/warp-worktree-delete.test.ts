/**
 * warp-worktree-delete — item 5 (worktree delete in activity).
 *
 * The issue detail offers an explicit Delete button for the linked
 * factory job's isolated worktree, reusing `deleteFactoryJobWorktree`
 * (`DELETE /factory/jobs/:id/worktree`) with the canvas `ProjectTree`
 * conduct mirrored: explicit two-step confirm, dirty/open-PR 409
 * escalates to a force confirm, honest disabled state without a recorded
 * worktree. Daemon semantics (folder only — the branch is NEVER deleted,
 * so an open PR stays reviewable) must read verbatim in the confirm copy
 * and in the describe titles.
 *
 * Offline: injected delete seams, zero network, zero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  describeActivityActions,
  invokeActivityAction,
  type DescribeActivityActionsArgs,
} from "../src/features/warpPanel/components/activityActions.ts";
import { describeFactoryJobForPanel } from "../src/features/warpPanel/adapters/factoryIssueJobs.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

function baseArgs(
  patch: Partial<DescribeActivityActionsArgs> = {},
): DescribeActivityActionsArgs {
  return {
    issueNumber: 7,
    prNumber: null,
    prState: "unknown",
    effective: null,
    conflicted: false,
    gateStatus: "idle",
    busy: {
      resolving: false,
      reviewing: false,
      fixing: false,
      merging: false,
      resolvingConflict: false,
      anyActive: false,
    },
    ...patch,
  };
}

function byKind(
  defs: ReturnType<typeof describeActivityActions>,
): Map<string, (typeof defs)[number]> {
  return new Map(defs.map((d) => [d.kind, d]));
}

// ─── describe matrix ───────────────────────────────────────────────────────

test("describe: delete-worktree is the last action, disabled without worktree info", () => {
  const defs = describeActivityActions(baseArgs());
  assert.equal(defs.length, 19);
  assert.equal(defs[defs.length - 1].kind, "delete-worktree");
  const def = byKind(defs).get("delete-worktree");
  assert.equal(def?.label, "Delete Worktree");
  assert.equal(def?.enabled, false);
  // No worktree info at all → no title (the panel hides the block).
  assert.equal(def?.title, undefined);
});

test("describe: honest disabled states (no path / running job)", () => {
  const noPath = byKind(
    describeActivityActions(
      baseArgs({
        factoryWorktree: { jobId: "job-1", worktreePath: null, terminal: true },
      }),
    ),
  ).get("delete-worktree");
  assert.equal(noPath?.enabled, false);
  assert.match(noPath?.title ?? "", /No isolated worktree recorded/);

  const running = byKind(
    describeActivityActions(
      baseArgs({
        factoryWorktree: {
          jobId: "job-1",
          worktreePath: "C:/repos/.worktrees/issue-7",
          terminal: false,
        },
      }),
    ),
  ).get("delete-worktree");
  assert.equal(running?.enabled, false);
  assert.match(running?.title ?? "", /still running/);
});

test("describe: terminal job with a recorded path enables with folder-only copy", () => {
  const def = byKind(
    describeActivityActions(
      baseArgs({
        factoryWorktree: {
          jobId: "job-1",
          worktreePath: "C:/repos/.worktrees/issue-7",
          terminal: true,
        },
      }),
    ),
  ).get("delete-worktree");
  assert.equal(def?.enabled, true);
  // Honest scope: folder removed, branch kept.
  assert.match(def?.title ?? "", /branch is kept/);
  assert.match(def?.title ?? "", /C:\/repos\/.worktrees\/issue-7/);
});

// ─── invoke ────────────────────────────────────────────────────────────────

test("invoke: delete-worktree refuses a running job without network", async () => {
  const notices: string[] = [];
  let calls = 0;
  const outcomes: Array<{ ok: boolean; error: string }> = [];
  await invokeActivityAction("delete-worktree", 7, undefined, {
    factoryJobId: "job-1",
    factoryTerminal: false,
    factoryWorktreePath: "C:/repos/.worktrees/issue-7",
    notify: (message) => notices.push(message),
    deleteWorktreeJob: async () => {
      calls += 1;
      return { ok: true, error: "" };
    },
    onWorktreeDelete: (result) => outcomes.push(result),
  });
  assert.equal(calls, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /still running/);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].ok, false);
});

test("invoke: delete-worktree refuses without a recorded path", async () => {
  const notices: string[] = [];
  let calls = 0;
  await invokeActivityAction("delete-worktree", 7, undefined, {
    factoryJobId: "job-1",
    factoryTerminal: true,
    factoryWorktreePath: null,
    notify: (message) => notices.push(message),
    deleteWorktreeJob: async () => {
      calls += 1;
      return { ok: true, error: "" };
    },
  });
  assert.equal(calls, 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /nothing to remove/);
});

test("invoke: delete-worktree notifies folder-removed + branch-kept on success", async () => {
  const notices: string[] = [];
  const outcomes: Array<{ ok: boolean; error: string }> = [];
  const seen: Array<{ jobId: string; force: boolean }> = [];
  await invokeActivityAction("delete-worktree", 7, undefined, {
    factoryJobId: "job-1",
    factoryTerminal: true,
    factoryWorktreePath: "C:/repos/.worktrees/issue-7",
    notify: (message) => notices.push(message),
    deleteWorktreeJob: async (jobId, opts) => {
      seen.push({ jobId, force: opts.force });
      return { ok: true, error: "" };
    },
    onWorktreeDelete: (result) => outcomes.push(result),
  });
  assert.deepEqual(seen, [{ jobId: "job-1", force: false }]);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /branch was kept/);
  assert.deepEqual(outcomes, [{ ok: true, error: "" }]);
});

test("invoke: delete-worktree passes force only on the second confirm", async () => {
  const seen: boolean[] = [];
  const deps = {
    factoryJobId: "job-1",
    factoryTerminal: true as boolean | null,
    factoryWorktreePath: "C:/repos/.worktrees/issue-7" as string | null,
    notify: () => {},
    deleteWorktreeJob: async (_jobId: string, opts: { force: boolean }) => {
      seen.push(opts.force);
      return { ok: true, error: "" };
    },
  };
  await invokeActivityAction("delete-worktree", 7, undefined, deps);
  await invokeActivityAction("delete-worktree", 7, undefined, {
    ...deps,
    forceWorktreeDelete: true,
  });
  assert.deepEqual(seen, [false, true]);
});

test("invoke: dirty/open-PR refusal asks for the second confirm", async () => {
  const notices: string[] = [];
  await invokeActivityAction("delete-worktree", 7, undefined, {
    factoryJobId: "job-1",
    factoryTerminal: true,
    factoryWorktreePath: "C:/repos/.worktrees/issue-7",
    notify: (message) => notices.push(message),
    deleteWorktreeJob: async () => ({
      ok: false,
      error: "worktree has uncommitted changes (pass force to discard)",
      status: 409,
    }),
  });
  assert.equal(notices.length, 1);
  assert.match(notices[0], /confirm again to force/);
});

test("invoke: hard failure reports without a force hint", async () => {
  const notices: string[] = [];
  await invokeActivityAction("delete-worktree", 7, undefined, {
    factoryJobId: "job-1",
    factoryTerminal: true,
    factoryWorktreePath: "C:/repos/.worktrees/issue-7",
    notify: (message) => notices.push(message),
    deleteWorktreeJob: async () => {
      throw new Error("daemon down");
    },
  });
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Could not remove the worktree/);
  assert.doesNotMatch(notices[0], /confirm again to force/);
});

test("invoke: throwing notify/onWorktreeDelete never breaks the path", async () => {
  await invokeActivityAction("delete-worktree", 7, undefined, {
    factoryJobId: "job-1",
    factoryTerminal: true,
    factoryWorktreePath: "C:/repos/.worktrees/issue-7",
    notify: () => {
      throw new Error("toast down");
    },
    deleteWorktreeJob: async () => ({ ok: true, error: "" }),
    onWorktreeDelete: () => {
      throw new Error("panel down");
    },
  });
  // Reaching here without throwing is the assertion.
  assert.ok(true);
});

// ─── panel info carries the path ───────────────────────────────────────────

test("describeFactoryJobForPanel attaches the isolation worktreePath", () => {
  const info = describeFactoryJobForPanel({
    id: "job-1",
    status: "Complete",
    isolation: {
      branch: "issue-7",
      worktreePath: "C:/repos/.worktrees/issue-7",
    },
  });
  assert.equal(info?.worktreePath, "C:/repos/.worktrees/issue-7");
});

test("describeFactoryJobForPanel omits worktreePath when unrecorded", () => {
  const info = describeFactoryJobForPanel({ id: "job-1", status: "Review" });
  assert.equal(info?.worktreePath, undefined);
});
