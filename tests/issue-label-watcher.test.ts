import test from "node:test";
import assert from "node:assert/strict";
import {
  watchIssuePrLabels,
  type IssueLabelWatcherDeps,
  type PrDecisionResult,
  type PrLookupResult,
} from "../src/canvas/issueLabelWatcher.ts";

function prResult(
  pr: { number: number; state: string } | null,
): PrLookupResult {
  return { ok: true, pr };
}

function decisionResult(
  reviewDecision: PrDecisionResult["reviewDecision"],
  labels: string[],
): PrDecisionResult {
  return { ok: true, reviewDecision, labels };
}

interface ScriptedDeps {
  deps: IssueLabelWatcherDeps;
  findQueue: PrLookupResult[];
  decisionQueue: PrDecisionResult[];
  applied: Array<{ prNumber: number; label: string }>;
  notified: Array<{ kind: string; message: string }>;
  live: { value: boolean };
}

function scriptedDeps(): ScriptedDeps {
  const state: ScriptedDeps = {
    deps: {
      findPrForIssue: async () => state.findQueue.shift() ?? prResult(null),
      getPrReviewDecision: async () =>
        state.decisionQueue.shift() ?? decisionResult(null, []),
      applyCycleLabel: async (_repoPath, prNumber, _issue, label) => {
        state.applied.push({ prNumber, label });
        return { ok: true };
      },
      isLive: () => state.live.value,
      notify: (kind, message) => {
        state.notified.push({ kind, message });
      },
    },
    findQueue: [],
    decisionQueue: [],
    applied: [],
    notified: [],
    live: { value: true },
  };
  return state;
}

async function waitUntil(cond: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("resolve flow: applies review:pendiente once the PR appears, then stops", async () => {
  const s = scriptedDeps();
  s.findQueue = [
    prResult(null),
    prResult(null),
    prResult({ number: 12, state: "OPEN" }),
  ];
  s.decisionQueue = [decisionResult("REVIEW_REQUIRED", [])];

  const stop = watchIssuePrLabels(s.deps, {
    repoPath: "C:/repo",
    issueNumber: 7,
    intervalMs: 5,
    timeoutMs: 2000,
  });

  await waitUntil(() => s.applied.length === 1);
  stop();
  assert.equal(s.applied[0].label, "review:pendiente");
  assert.equal(s.applied[0].prNumber, 12);
  assert.ok(
    s.notified.some((n) => n.message.includes("review:pendiente aplicado")),
    "must notify the applied label",
  );
});

test("fix flow: applies review:fix-aplicado once the head passes the review commit", async () => {
  const s = scriptedDeps();
  s.findQueue = [
    prResult({ number: 12, state: "OPEN" }),
    prResult({ number: 12, state: "OPEN" }),
  ];
  s.decisionQueue = [
    decisionResult("CHANGES_REQUESTED", ["review:comentado"]),
    decisionResult("FIX_APPLIED", ["review:comentado"]),
  ];

  const stop = watchIssuePrLabels(s.deps, {
    repoPath: "C:/repo",
    issueNumber: 7,
    intervalMs: 5,
    timeoutMs: 2000,
  });

  await waitUntil(() => s.applied.length === 1);
  stop();
  assert.equal(s.applied[0].label, "review:fix-aplicado");
  assert.equal(s.applied[0].prNumber, 12);
});

test("already materialized: stops without applying anything", async () => {
  const s = scriptedDeps();
  s.findQueue = [prResult({ number: 12, state: "OPEN" })];
  s.decisionQueue = [decisionResult(null, ["review:pendiente"])];

  const stop = watchIssuePrLabels(s.deps, {
    repoPath: "C:/repo",
    issueNumber: 7,
    intervalMs: 5,
    timeoutMs: 2000,
  });

  await waitUntil(() => s.findQueue.length === 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  stop();
  assert.equal(s.applied.length, 0, "no label needed");
});

test("terminal gone: stops without applying anything", async () => {
  const s = scriptedDeps();
  s.live.value = false;
  s.findQueue = [prResult({ number: 12, state: "OPEN" })];

  const stop = watchIssuePrLabels(s.deps, {
    repoPath: "C:/repo",
    issueNumber: 7,
    intervalMs: 5,
    timeoutMs: 2000,
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  stop();
  assert.equal(s.applied.length, 0, "must not label after the terminal died");
});

test("timeout: stops with a warning and never labels", async () => {
  const s = scriptedDeps();
  s.findQueue = [
    prResult({ number: 12, state: "OPEN" }),
    prResult({ number: 12, state: "OPEN" }),
  ];
  s.decisionQueue = [
    decisionResult("CHANGES_REQUESTED", ["review:comentado"]),
    decisionResult("CHANGES_REQUESTED", ["review:comentado"]),
  ];

  const stop = watchIssuePrLabels(s.deps, {
    repoPath: "C:/repo",
    issueNumber: 7,
    intervalMs: 5,
    timeoutMs: 30,
  });

  await waitUntil(() => s.notified.some((n) => n.kind === "warn"));
  stop();
  assert.equal(s.applied.length, 0);
});