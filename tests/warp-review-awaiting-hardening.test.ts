/**
 * warp-review-awaiting-hardening — review→awaiting transition audit.
 *
 * The reset review→awaiting still reads as a black screen (1s) back to the
 * default section after the describe/snapshot hardening, so the throw is
 * elsewhere. This suite pins the remaining suspects with offline
 * transition shapes (loading→object, null→verdict, empty→full) plus the
 * crash recorder contract and the section-restore order.
 *
 * Offline: zero network, zero daemon, zero reloads.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  describeActivityActions,
  type DescribeActivityActionsArgs,
} from "../src/features/warpPanel/components/activityActions.ts";
import {
  asRecordSlice,
  asStringList,
  prStateForIssue,
} from "../src/features/warpPanel/components/ActivityPanel.tsx";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_PENDING,
} from "../src/canvas/reviewVerdict.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

// ─── transition-shape helpers ────────────────────────────────────────────

function baseArgs(
  patch: Partial<DescribeActivityActionsArgs> = {},
): DescribeActivityActionsArgs {
  return {
    issueNumber: 7,
    prNumber: 50,
    prState: "OPEN",
    effective: REVIEW_LABEL_PENDING,
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

// ─── prStateForIssue: loading→object, null→object, mistyped maps ─────────

test("prStateForIssue never throws on mistyped store slices", () => {
  assert.equal(prStateForIssue(undefined, undefined, 7, 50), "unknown");
  assert.equal(prStateForIssue(null, null, 7, 50), "unknown");
  assert.equal(prStateForIssue("loading", "loading", 7, 50), "unknown");
  assert.equal(prStateForIssue(42, 42, 7, 50), "unknown");
  assert.equal(prStateForIssue([], [], 7, 50), "unknown");
  assert.equal(prStateForIssue({}, {}, 7, null), "unknown");
});

test("prStateForIssue tracks the loading→object flip honestly", () => {
  // Lookup in flight: primary entry is the "loading" sentinel.
  assert.equal(
    prStateForIssue({ 7: "loading" }, {}, 7, 50),
    "loading",
  );
  assert.equal(
    prStateForIssue({ 7: "loading" }, {}, 7, null),
    "loading",
  );
  // Lookup landed: real PR object resolves its stored state.
  assert.equal(
    prStateForIssue(
      {
        7: {
          number: 50,
          title: "PR",
          url: "https://x/y/pull/50",
          state: "OPEN",
          headRefName: "issue-7",
          headRefOid: "abc",
        },
      },
      {},
      7,
      50,
    ),
    "OPEN",
  );
  // Open-PRs list wins over the primary entry; junk entries are skipped.
  assert.equal(
    prStateForIssue(
      {},
      { 7: [null, "loading", { number: 50, state: "OPEN" }] },
      7,
      50,
    ),
    "OPEN",
  );
  // Wrong-type open entry degrades to unknown, never throws.
  assert.equal(
    prStateForIssue({}, { 7: "loading" }, 7, 50),
    "unknown",
  );
});

test("asRecordSlice/asStringList degrade transition flips to honest-empty", () => {
  assert.equal(asRecordSlice(undefined), null);
  assert.equal(asRecordSlice(null), null);
  assert.equal(asRecordSlice("loading"), null);
  assert.equal(asRecordSlice([]), null);
  assert.deepEqual(asRecordSlice({ 7: 1 }), { 7: 1 });
  assert.deepEqual(asStringList(undefined), []);
  assert.deepEqual(asStringList(null), []);
  assert.deepEqual(asStringList("loading"), []);
  assert.deepEqual(asStringList({ 0: "a" }), []);
  assert.deepEqual(asStringList(["a", 42, null, "b"]), ["a", "b"]);
});

// ─── describeActivityActions: junk factoryAwaiting / factory / args ──────

test("describeActivityActions never throws on junk transition shapes", () => {
  const junkAwaiting = ["loading", "x", 42, [], {}];
  for (const kind of junkAwaiting) {
    const defs = describeActivityActions(
      baseArgs({ factoryAwaiting: { kind, jobId: "job-1" } as never }),
    );
    assert.equal(defs.length, 20);
  }
  const junkJobId = [undefined, null, 42, "", "  ", [], {}];
  for (const jobId of junkJobId) {
    const defs = describeActivityActions(
      baseArgs({
        factoryAwaiting: { kind: "spec-approval", jobId } as never,
      }),
    );
    assert.equal(defs.length, 20);
    assert.equal(
      defs.find((d) => d.kind === "approve-spec")?.enabled,
      false,
    );
  }
  // Wrong-type factory object degrades to honest-disabled session.
  const defsFactory = describeActivityActions(
    baseArgs({ factory: "loading" as never }),
  );
  assert.equal(defsFactory.length, 20);
  // Mistyped top-level args degrade to the disabled matrix, never throw.
  for (const junk of [undefined, null, "loading", 42, []]) {
    const defs = describeActivityActions(junk as never);
    assert.equal(defs.length, 20);
  }
});

test("describeActivityActions enables the matching gate on valid shapes", () => {
  const approve = describeActivityActions(
    baseArgs({
      factoryAwaiting: { kind: "spec-approval", jobId: "job-1" },
    }),
  );
  assert.equal(
    approve.find((d) => d.kind === "approve-spec")?.enabled,
    true,
  );
  const respondClosed = describeActivityActions(
    baseArgs({
      factoryAwaiting: { kind: "triage-respond", jobId: "job-1" },
    }),
  );
  assert.equal(
    respondClosed.find((d) => d.kind === "triage-respond")?.enabled,
    false,
  );
  const respondReady = describeActivityActions(
    baseArgs({
      factoryAwaiting: { kind: "triage-respond", jobId: "job-1" },
      triageAnswersReady: true,
    }),
  );
  assert.equal(
    respondReady.find((d) => d.kind === "triage-respond")?.enabled,
    true,
  );
  const merge = describeActivityActions(
    baseArgs({ effective: REVIEW_LABEL_APPROVED }),
  );
  assert.equal(merge.find((d) => d.kind === "merge")?.enabled, true);
});

// ─── liveActivity reader: junk slices (parity with liveIssues) ───────────

test("LiveActivityAdapter never throws on junk review slices", async () => {
  const { LiveActivityAdapter } = await import(
    "../src/features/warpPanel/adapters/liveActivity.ts"
  );
  const node = {
    issueId: "node-7",
    projectId: "C:/repos/termcanvas",
    worktreeId: "w1",
    issueNumber: 7,
    title: "Issue 7",
    body: "Body",
    url: "https://github.com/org/termcanvas/issues/7",
    labels: [],
    x: 0,
    y: 0,
  };
  const adapter = new LiveActivityAdapter({
    readIssues: () => [node] as never,
    readReview: () =>
      ({
        primaryPrByIssue: undefined,
        verdictByIssue: "junk",
        reviewingIssueNumber: 7.5,
        fixingIssueNumber: null,
        mergingIssueNumber: null,
        resolvingConflictIssueNumber: null,
        mergedPrNumbers: "junk",
        openPrsByIssue: { 7: "loading" },
        verdictByPr: null,
        labelsByPr: 42,
        labelsByIssue: null,
        conflictByPr: "junk",
        gateByPr: undefined,
        headRefByIssue: "junk",
      }) as never,
    readResolvingIssueNumber: () => null,
    readProjectName: () => undefined,
    readActivityByRepo: () => ({}),
    readFactoryJobs: () => [],
    readNotifications: () => [],
  });
  const issues = adapter.listActivityIssues();
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, 7);
});

// ─── crash recorder: ring of 3, trims, never throws ──────────────────────

function withFakeWindow(
  storage: Record<string, string>,
  opts: { throwingSet?: boolean; throwingGet?: boolean } = {},
): { listeners: Record<string, ((e: unknown) => void)[]>; restore: () => void } {
  const prev = (globalThis as unknown as Record<string, unknown>).window;
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => {
        if (opts.throwingGet === true) throw new Error("get boom");
        return Object.hasOwn(storage, key) ? storage[key] : null;
      },
      setItem: (key: string, value: string) => {
        if (opts.throwingSet === true) throw new Error("quota boom");
        storage[key] = String(value);
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    },
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      listeners[type] = [...(listeners[type] ?? []), handler];
    },
    removeEventListener: (type: string, handler: (e: unknown) => void) => {
      listeners[type] = (listeners[type] ?? []).filter((h) => h !== handler);
    },
  };
  (globalThis as unknown as Record<string, unknown>).window = fakeWindow;
  return {
    listeners,
    restore: () => {
      if (prev === undefined) {
        delete (globalThis as unknown as Record<string, unknown>).window;
      } else {
        (globalThis as unknown as Record<string, unknown>).window = prev;
      }
    },
  };
}

test("crash recorder keeps a ring of 3 with trimmed stack, never throws", async () => {
  const storage: Record<string, string> = {};
  const { restore } = withFakeWindow(storage);
  try {
    const {
      WARP_LAST_CRASH_STORAGE_KEY,
      readWarpLastCrash,
      recordWarpCrash,
    } = await import("../src/features/warpPanel/warpCrashRecorder.ts");
    assert.equal(WARP_LAST_CRASH_STORAGE_KEY, "warp-last-crash");
    assert.deepEqual(readWarpLastCrash(), []);
    const big = `Error: boom\n${"x".repeat(2000)}`;
    const err = new Error("review-transition shape");
    err.stack = big;
    recordWarpCrash(err, "activity");
    recordWarpCrash(new Error("second"), "activity");
    recordWarpCrash("plain-string crash", "issues");
    recordWarpCrash(new Error("fourth — drops the first"), "agents");
    const ring = readWarpLastCrash();
    assert.equal(ring.length, 3);
    for (const entry of ring) {
      assert.ok(typeof entry.at === "string" && entry.at !== "");
      assert.ok(typeof entry.message === "string" && entry.message !== "");
      assert.ok(typeof entry.stack === "string");
      assert.ok(entry.stack.length <= 500);
      assert.ok(typeof entry.section === "string");
    }
    // Corrupt payload degrades to empty, never throws.
    storage["warp-last-crash"] = "{not-json";
    assert.deepEqual(readWarpLastCrash(), []);
    storage["warp-last-crash"] = JSON.stringify([{ junk: true }, null, 42]);
    const cleaned = readWarpLastCrash();
    assert.ok(Array.isArray(cleaned));
  } finally {
    restore();
  }
});

test("crash recorder never throws on hostile storage or getters", async () => {
  const storage: Record<string, string> = {};
  const { restore } = withFakeWindow(storage, { throwingSet: true });
  try {
    const { recordWarpCrash, installWarpCrashRecorder } = await import(
      "../src/features/warpPanel/warpCrashRecorder.ts"
    );
    assert.doesNotThrow(() => recordWarpCrash(new Error("x"), "activity"));
    assert.doesNotThrow(() =>
      installWarpCrashRecorder(() => {
        throw new Error("getter boom");
      }),
    );
  } finally {
    restore();
  }
  // No window at all (SSR/node): every entry point is a safe noop.
  const prev = (globalThis as unknown as Record<string, unknown>).window;
  delete (globalThis as unknown as Record<string, unknown>).window;
  try {
    const {
      readWarpLastCrash,
      recordWarpCrash,
      installWarpCrashRecorder,
    } = await import("../src/features/warpPanel/warpCrashRecorder.ts");
    assert.deepEqual(readWarpLastCrash(), []);
    assert.doesNotThrow(() => recordWarpCrash(new Error("x"), "activity"));
    assert.doesNotThrow(() => installWarpCrashRecorder(() => "activity"));
  } finally {
    if (prev !== undefined) {
      (globalThis as unknown as Record<string, unknown>).window = prev;
    }
  }
});

test("crash recorder captures window error/unhandledrejection with section", async () => {
  const storage: Record<string, string> = {};
  const { listeners, restore } = withFakeWindow(storage);
  try {
    const { readWarpLastCrash, installWarpCrashRecorder } = await import(
      "../src/features/warpPanel/warpCrashRecorder.ts"
    );
    let section = "activity";
    const cleanup = installWarpCrashRecorder(() => section);
    // Idempotent reinstall only refreshes the getter.
    installWarpCrashRecorder(() => section);
    assert.ok((listeners["error"] ?? []).length >= 1);
    assert.ok((listeners["unhandledrejection"] ?? []).length >= 1);
    for (const handler of listeners["error"] ?? []) {
      handler({ error: new Error("render boom"), message: "render boom" });
    }
    section = "awaiting-now-activity";
    for (const handler of listeners["unhandledrejection"] ?? []) {
      handler({ reason: new Error("async boom") });
    }
    // Junk events never break the handler.
    for (const handler of listeners["error"] ?? []) {
      handler(null);
      handler("string-event");
    }
    const ring = readWarpLastCrash();
    assert.ok(ring.length >= 1 && ring.length <= 3);
    assert.ok(
      ring.some((e) => e.section === "activity") ||
        ring.some((e) => e.section === "awaiting-now-activity"),
    );
    assert.doesNotThrow(() => cleanup());
  } finally {
    restore();
  }
});

// ─── section restore runs before the first render ────────────────────────

test("panel section restores before the first render (lazy initializer)", async () => {
  const {
    WARP_PANEL_SECTION_STORAGE_KEY,
    isValidPanelSection,
    loadPersistedPanelSection,
  } = await import("../src/features/warpPanel/panelSection.ts");
  assert.equal(WARP_PANEL_SECTION_STORAGE_KEY, "warp-panel-section-v1");
  assert.equal(isValidPanelSection("activity"), true);
  assert.equal(isValidPanelSection("junk"), false);
  // No window in node → default section, never throws (restore is sync).
  assert.equal(loadPersistedPanelSection(), "issues");
  // The shell must restore synchronously in the useState initializer (no
  // late effect that would flash the "issues" default after a remount).
  const shell = readFileSync(
    join(repoRoot, "src", "features", "warpPanel", "WarpPanelShell.tsx"),
    "utf8",
  );
  assert.match(
    shell,
    /useState<NavSection>\(\(\)\s*=>\s*\{[\s\S]*?loadPersistedPanelSection\(\)/,
  );
  assert.match(shell, /installWarpCrashRecorder/);
  // The boundary records into the same ring (render throws may never reach
  // the window handler).
  const boundary = readFileSync(
    join(
      repoRoot,
      "src",
      "features",
      "warpPanel",
      "components",
      "WarpPanelBoundary.tsx",
    ),
    "utf8",
  );
  assert.match(boundary, /recordWarpCrash/);
});
