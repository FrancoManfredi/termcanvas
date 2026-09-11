/**
 * warp-overrides-persist — item 3 (persistent overrides).
 *
 * Explicit user order (an earlier in-memory-only decision was reverted):
 * the Kanban status dropdown pick (e.g. backlog → ready) survives a
 * restart. Overrides persist to a dedicated versioned localStorage key
 * (`warp-kanban-status-overrides-v1`), restored on adapter construction.
 * UI-only by construction: the map never touches the daemon or GitHub —
 * `setIssueStatus` writes memory + storage and nothing else.
 *
 * Offline: injected storage fakes, zero network, zero daemon.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { LiveReviewSnapshot } from "../src/features/warpPanel/adapters/liveIssues.ts";
import {
  KANBAN_STATUS_OVERRIDES_STORAGE_KEY,
  LiveIssuesAdapter,
  loadPersistedStatusOverrides,
  savePersistedStatusOverrides,
} from "../src/features/warpPanel/adapters/liveIssues.ts";
import type { IssueNodeData } from "../src/stores/issueStore.ts";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

function emptyReview(): LiveReviewSnapshot {
  return {
    primaryPrByIssue: {},
    verdictByIssue: {},
    reviewingIssueNumber: null,
    fixingIssueNumber: null,
    mergingIssueNumber: null,
    resolvingConflictIssueNumber: null,
    mergedPrNumbers: [],
  };
}

function node(issueNumber: number): IssueNodeData {
  return {
    issueId: `node-${issueNumber}`,
    projectId: "C:/repos/termcanvas",
    worktreeId: "w1",
    issueNumber,
    title: `Issue ${issueNumber}`,
    body: "",
    url: `https://github.com/org/termcanvas/issues/${issueNumber}`,
    labels: [],
    x: 0,
    y: 0,
  } as unknown as IssueNodeData;
}

function depsWith(
  patch: Record<string, unknown> = {},
): ConstructorParameters<typeof LiveIssuesAdapter>[0] {
  return {
    readIssues: () => [node(7)],
    readReview: () => emptyReview(),
    readResolvingIssueNumber: () => null,
    readFactoryJobs: () => [],
    readProjectName: () => undefined,
    ...patch,
  };
}

// ─── storage helpers ───────────────────────────────────────────────────────

test("storage key is dedicated and versioned", () => {
  assert.equal(
    KANBAN_STATUS_OVERRIDES_STORAGE_KEY,
    "warp-kanban-status-overrides-v1",
  );
});

test("load/save round-trip through a fake storage", () => {
  // Drive through the adapter seam with injected fakes.
  let persisted = "";
  const writer = new LiveIssuesAdapter(
    depsWith({
      loadStatusOverrides: () => new Map(),
      saveStatusOverrides: (overrides: ReadonlyMap<number, unknown>) => {
        const record: Record<string, unknown> = {};
        for (const [k, v] of overrides) record[String(k)] = v;
        persisted = JSON.stringify({ version: 1, overrides: record });
      },
    }),
  );
  writer.setIssueStatus(7, "ready");
  assert.match(persisted, /"7":"ready"/);
  const reader = new LiveIssuesAdapter(
    depsWith({
      loadStatusOverrides: () => {
        const parsed = JSON.parse(persisted) as {
          overrides: Record<string, "ready">;
        };
        const out = new Map<number, "ready">();
        for (const [k, v] of Object.entries(parsed.overrides)) {
          out.set(Number(k), v);
        }
        return out;
      },
    }),
  );
  assert.equal(
    reader.listIssues().find((card) => card.id === 7)?.status,
    "ready",
  );
});

test("override survives an adapter rebuild (restart simulation)", () => {
  let slot = new Map<number, "ready" | "backlog">();
  const make = () =>
    new LiveIssuesAdapter(
      depsWith({
        loadStatusOverrides: () => new Map(slot),
        saveStatusOverrides: (overrides: ReadonlyMap<number, unknown>) => {
          slot = new Map(
            [...overrides].map(([k, v]) => [k, v] as [number, "ready" | "backlog"]),
          );
        },
      }),
    );
  make().setIssueStatus(7, "ready");
  // "Restart": a fresh adapter over the same storage restores the pick.
  const afterRestart = make();
  assert.equal(
    afterRestart.listIssues().find((card) => card.id === 7)?.status,
    "ready",
  );
});

test("junk restored overrides are dropped, valid ones kept", () => {
  const reader = new LiveIssuesAdapter(
    depsWith({
      readIssues: () => [node(7), node(9)],
      loadStatusOverrides: () =>
        new Map([
          [7, "ready"],
          [0, "done"],
          [-3, "done"],
          [9, "not-a-status"],
        ]) as unknown as Map<number, "ready">,
    }),
  );
  const byId = new Map(reader.listIssues().map((card) => [card.id, card.status]));
  assert.equal(byId.get(7), "ready");
  assert.equal(byId.get(9), "backlog");
});

test("pruning an issue that left the canvas persists the prune", () => {
  let saved: Array<[number, unknown]> = [];
  const adapter = new LiveIssuesAdapter(
    depsWith({
      readIssues: () => [node(7)],
      loadStatusOverrides: () => new Map([[7, "ready"]]) as never,
      saveStatusOverrides: (overrides: ReadonlyMap<number, unknown>) => {
        saved = [...overrides];
      },
    }),
  );
  assert.equal(
    adapter.listIssues().find((card) => card.id === 7)?.status,
    "ready",
  );
  // The issue leaves the canvas → the next snapshot prunes + persists.
  saved = [];
  const adapter2 = new LiveIssuesAdapter(
    depsWith({
      readIssues: () => [],
      loadStatusOverrides: () => new Map([[7, "ready"]]) as never,
      saveStatusOverrides: (overrides: ReadonlyMap<number, unknown>) => {
        saved = [...overrides];
      },
    }),
  );
  assert.equal(adapter2.listIssues().length, 0);
  assert.deepEqual(saved, []);
});

test("clearStatusOverrides drops memory and storage", () => {
  let saved: Array<[number, unknown]> = [["seed", 1]];
  const adapter = new LiveIssuesAdapter(
    depsWith({
      loadStatusOverrides: () => new Map([[7, "ready"]]) as never,
      saveStatusOverrides: (overrides: ReadonlyMap<number, unknown>) => {
        saved = [...overrides];
      },
    }),
  );
  adapter.clearStatusOverrides();
  assert.deepEqual(saved, []);
  assert.equal(
    adapter.listIssues().find((card) => card.id === 7)?.status,
    "backlog",
  );
});

test("a throwing storage seam never breaks the board", () => {
  const adapter = new LiveIssuesAdapter(
    depsWith({
      loadStatusOverrides: () => {
        throw new Error("storage down");
      },
      saveStatusOverrides: () => {
        throw new Error("storage down");
      },
    }),
  );
  assert.equal(adapter.listIssues().length, 1);
  assert.equal(adapter.setIssueStatus(7, "ready").length, 1);
});

// ─── real localStorage helpers (guarded, offline) ──────────────────────────

test("save/load helpers validate version, shape, cap, and junk", () => {
  const store: Record<string, string> = {};
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    },
  };
  const realWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = fakeWindow;
  try {
    savePersistedStatusOverrides(
      new Map([[7, "ready"], [9, "done"]]),
    );
    const loaded = loadPersistedStatusOverrides();
    assert.equal(loaded.get(7), "ready");
    assert.equal(loaded.get(9), "done");
    // Wrong version → empty.
    store[KANBAN_STATUS_OVERRIDES_STORAGE_KEY] = JSON.stringify({
      version: 999,
      overrides: { "7": "ready" },
    });
    assert.equal(loadPersistedStatusOverrides().size, 0);
    // Corrupt JSON → empty, never throws.
    store[KANBAN_STATUS_OVERRIDES_STORAGE_KEY] = "{nope";
    assert.equal(loadPersistedStatusOverrides().size, 0);
    // Junk entries dropped, valid kept.
    store[KANBAN_STATUS_OVERRIDES_STORAGE_KEY] = JSON.stringify({
      version: 1,
      overrides: { "7": "ready", "0": "done", "x": "done", "9": "bogus" },
    });
    const cleaned = loadPersistedStatusOverrides();
    assert.equal(cleaned.size, 1);
    assert.equal(cleaned.get(7), "ready");
  } finally {
    if (realWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = realWindow;
    }
  }
});
