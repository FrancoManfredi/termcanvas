import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMergeProgressEvent,
  isFixableVerdict,
  pickLinkedPrFromIssueData,
  useIssueReviewStore,
} from "../src/stores/issueReviewStore.ts";

const openPr = {
  number: 99,
  title: "Fix login bug",
  url: "https://github.com/test/test/pull/99",
  state: "OPEN",
  headRefName: "issue-42-fix-login-bug",
  headRefOid: "abc123",
};

function resetStore() {
  useIssueReviewStore.setState({
    prsByIssue: {},
    verdictByIssue: {},
    reviewingIssueNumber: null,
    fixingIssueNumber: null,
    mergingIssueNumber: null,
    reviewHandler: null,
    fixHandler: null,
    mergeHandler: null,
    prLookupHandler: null,
  });
}

test("requestPrLookup: invokes the registered handler once with the project path", () => {
  resetStore();
  const calls: Array<[number, string | undefined]> = [];
  useIssueReviewStore.getState().registerPrLookupHandler((n, p) => calls.push([n, p]));

  useIssueReviewStore.getState().requestPrLookup(42, "/repo");
  useIssueReviewStore.getState().requestPrLookup(7);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], [42, "/repo"]);
  assert.deepEqual(calls[1], [7, undefined]);
});

test("requestPrLookup: never starts a duplicate lookup while loading", () => {
  resetStore();
  let count = 0;
  useIssueReviewStore.getState().registerPrLookupHandler(() => {
    count += 1;
  });
  useIssueReviewStore.getState().setPrStatus(42, "loading");

  useIssueReviewStore.getState().requestPrLookup(42);
  useIssueReviewStore.getState().requestPrLookup(42, "/repo");

  assert.equal(count, 0, "loading state must suppress new lookups");
});

test("requestPrLookup: a cached PR suppresses re-lookups", () => {
  resetStore();
  let count = 0;
  useIssueReviewStore.getState().registerPrLookupHandler(() => {
    count += 1;
  });

  useIssueReviewStore.getState().setPrStatus(42, openPr);
  useIssueReviewStore.getState().requestPrLookup(42);
  useIssueReviewStore.getState().requestPrLookup(42, "/repo");

  assert.equal(count, 0, "a linked PR is a settled fact — never duplicate the lookup");
});

test("requestPrLookup: force bypasses the session cache (reviews/labels may have changed)", () => {
  resetStore();
  const calls: Array<[number, string | undefined, boolean | undefined]> = [];
  useIssueReviewStore
    .getState()
    .registerPrLookupHandler((n, p, force) => calls.push([n, p, force]));

  useIssueReviewStore.getState().setPrStatus(42, openPr);
  useIssueReviewStore.getState().requestPrLookup(42, "/repo", true);

  assert.equal(
    calls.length,
    1,
    "a forced lookup re-reads a cached PR after a review/fix/merge",
  );
  assert.deepEqual(calls[0], [42, "/repo", true]);

  useIssueReviewStore.getState().requestPrLookup(42, "/repo");
  assert.equal(
    calls.length,
    1,
    "an unforced lookup after the forced one still dedups",
  );
});

test("requestPrLookup: force is suppressed while a lookup is already loading", () => {
  resetStore();
  let count = 0;
  useIssueReviewStore.getState().registerPrLookupHandler(() => {
    count += 1;
  });
  useIssueReviewStore.getState().setPrStatus(42, "loading");

  useIssueReviewStore.getState().requestPrLookup(42, "/repo", true);

  assert.equal(count, 0, "loading state must suppress even forced lookups");
});

test("requestPrLookup: a null (no-PR) result is re-checked, not cached forever", () => {
  resetStore();
  let count = 0;
  useIssueReviewStore.getState().registerPrLookupHandler(() => {
    count += 1;
  });

  useIssueReviewStore.getState().setPrStatus(7, null);
  useIssueReviewStore.getState().requestPrLookup(7);
  useIssueReviewStore.getState().requestPrLookup(7, "/repo");

  assert.equal(count, 2, "no-PR answers may go stale once the PR is created — re-lookup on every re-render/refresh");
});

test("setPrStatus/reviewing state drive the card button states", () => {
  resetStore();
  const store = useIssueReviewStore.getState();
  store.setPrStatus(42, openPr);
  assert.equal(useIssueReviewStore.getState().prsByIssue[42], openPr);
  assert.equal(
    useIssueReviewStore.getState().prsByIssue[42] === "loading",
    false,
  );

store.setReviewingIssueNumber(42);
  assert.equal(useIssueReviewStore.getState().reviewingIssueNumber, 42);
  store.setReviewingIssueNumber(null);
  assert.equal(useIssueReviewStore.getState().reviewingIssueNumber, null);
});

test("setReviewVerdict: stores the verdict per issue without leaking across issues", () => {
  resetStore();
  useIssueReviewStore.getState().setReviewVerdict(42, "CHANGES_REQUESTED");
  assert.equal(
    useIssueReviewStore.getState().verdictByIssue[42],
    "CHANGES_REQUESTED",
  );
  assert.equal(
    useIssueReviewStore.getState().verdictByIssue[7],
    undefined,
    "other issues must not inherit a verdict",
  );

  useIssueReviewStore.getState().setReviewVerdict(42, null);
  assert.equal(useIssueReviewStore.getState().verdictByIssue[42], null);
});

test("setFixingIssueNumber: marks the issue being fixed and clears back to null", () => {
  resetStore();
  const store = useIssueReviewStore.getState();
  store.setFixingIssueNumber(42);
  assert.equal(useIssueReviewStore.getState().fixingIssueNumber, 42);
  store.setFixingIssueNumber(null);
  assert.equal(useIssueReviewStore.getState().fixingIssueNumber, null);
});

test("setMergingIssueNumber: marks the issue being merged and clears back to null", () => {
  resetStore();
  const store = useIssueReviewStore.getState();
  store.setMergingIssueNumber(42);
  assert.equal(useIssueReviewStore.getState().mergingIssueNumber, 42);
  store.setMergingIssueNumber(null);
  assert.equal(useIssueReviewStore.getState().mergingIssueNumber, null);
});

test("mergeHandler: registered handler is invoked with the issue number", () => {
  resetStore();
  const calls: number[] = [];
  useIssueReviewStore.getState().registerMergeHandler((n) => calls.push(n));
  useIssueReviewStore.getState().mergeHandler?.(42);
  assert.deepEqual(calls, [42]);
});

test("isFixableVerdict: only COMMENTED and CHANGES_REQUESTED open the fix flow", () => {
  assert.equal(isFixableVerdict("COMMENTED"), true);
  assert.equal(isFixableVerdict("CHANGES_REQUESTED"), true);
  assert.equal(isFixableVerdict("APPROVED"), false, "approved PRs need no fix");
  assert.equal(isFixableVerdict("REVIEW_REQUIRED"), false, "never reviewed");
  assert.equal(isFixableVerdict("FIX_APPLIED"), false, "fix already applied");
  assert.equal(isFixableVerdict(null), false, "no verdict yet");
  assert.equal(isFixableVerdict(undefined), false);
});
test("pickLinkedPrFromIssueData: prefers the OPEN PR over merged ones", () => {
  const pr = pickLinkedPrFromIssueData({
    closedByPullRequestsReferences: {
      nodes: [
        { number: 5, title: "old", state: "MERGED" },
        { number: 6, title: "fix(answer): respond to issue #1 with 2+2=4", state: "OPEN", headRefName: "issue-1-answer" },
      ],
    },
  });
  assert.ok(pr);
  assert.equal(pr.number, 6);
  assert.equal(pr.state, "OPEN");
  assert.equal(pr.headRefName, "issue-1-answer");
});

test("pickLinkedPrFromIssueData: falls back to the first node when none are OPEN", () => {
  const pr = pickLinkedPrFromIssueData({
    closedByPullRequestsReferences: {
      nodes: [{ number: 9, title: "merged pr", state: "MERGED" }],
    },
  });
  assert.ok(pr);
  assert.equal(pr.number, 9);
});

test("pickLinkedPrFromIssueData: returns null when the field is absent or empty", () => {
  assert.equal(pickLinkedPrFromIssueData(undefined), null);
  assert.equal(pickLinkedPrFromIssueData({}), null);
  assert.equal(
    pickLinkedPrFromIssueData({ closedByPullRequestsReferences: { nodes: [] } }),
    null,
  );
});

test("applyMergeProgressEvent: start resets the panel state with all PRs pending", () => {
  resetStore();
  const state = useIssueReviewStore.getState();
  state.beginMergeProgress([1]);
  state.finishMergeProgress();

  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "start",
    prNumbers: [14, 15],
  });

  const progress = useIssueReviewStore.getState().mergeProgress;
  assert.ok(progress);
  assert.deepEqual(progress.prNumbers, [14, 15]);
  assert.deepEqual(progress.statusByPr, { 14: "pending", 15: "pending" });
  assert.equal(progress.finished, false);
  assert.equal(progress.error, null);
  assert.equal(progress.log.length, 0);
});

test("applyMergeProgressEvent: pr-start + steps mark the PR working and log Spanish labels", () => {
  resetStore();
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "start",
    prNumbers: [14],
  });
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "pr-start",
    prNumber: 14,
  });
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "step",
    prNumber: 14,
    phase: "test-merge",
  });

  const progress = useIssueReviewStore.getState().mergeProgress;
  assert.ok(progress);
  assert.equal(progress.statusByPr[14], "working");
  assert.deepEqual(progress.log, [
    { prNumber: 14, message: "Procesando PR #14..." },
    { prNumber: 14, message: "Probando integración con main" },
  ]);
});

test("applyMergeProgressEvent: pr-merged marks the PR merged and logs the outcome", () => {
  resetStore();
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "start",
    prNumbers: [14, 15],
  });
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "pr-merged",
    prNumber: 14,
  });
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "pr-conflicted",
    prNumber: 15,
    files: ["conflict-test.txt"],
  });

  const progress = useIssueReviewStore.getState().mergeProgress;
  assert.ok(progress);
  assert.equal(progress.statusByPr[14], "merged");
  assert.equal(progress.statusByPr[15], "conflicted");
  assert.equal(
    progress.log[1].message,
    "Conflicto al integrar con main: conflict-test.txt",
  );
});

test("applyMergeProgressEvent: done finishes the run and error finishes with the message", () => {
  resetStore();
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "start",
    prNumbers: [14],
  });
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "pr-error",
    prNumber: 14,
    message: "boom",
  });
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "done",
    merged: [14],
    conflicted: [],
  });

  let progress = useIssueReviewStore.getState().mergeProgress;
  assert.ok(progress);
  assert.equal(progress.finished, true);
  assert.equal(progress.statusByPr[14], "error");

  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "start",
    prNumbers: [15],
  });
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "error",
    message: "repo missing",
  });
  progress = useIssueReviewStore.getState().mergeProgress;
  assert.ok(progress);
  assert.equal(progress.finished, true);
  assert.equal(progress.error, "repo missing");
});

test("dismissMergeProgress: closes the panel without affecting other state", () => {
  resetStore();
  applyMergeProgressEvent(useIssueReviewStore.getState(), {
    type: "start",
    prNumbers: [14],
  });
  useIssueReviewStore.getState().dismissMergeProgress();
  assert.equal(useIssueReviewStore.getState().mergeProgress, null);
});
