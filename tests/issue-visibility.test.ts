import test from "node:test";
import assert from "node:assert/strict";

import { buildCanvasFlowIssueNodes } from "../src/canvas/nodeProjection.ts";
import type { IssueNodeData } from "../src/stores/issueStore.ts";

function makeIssue(number: number, state: string): IssueNodeData {
  return {
    issueId: `gh-proj-${number}`,
    projectId: "p1",
    worktreeId: "w1",
    issueNumber: number,
    title: `Issue ${number}`,
    body: "",
    url: `https://github.com/test/test/issues/${number}`,
    labels: [],
    x: 100,
    y: 200,
    state,
  } as unknown as IssueNodeData;
}

test("buildCanvasFlowIssueNodes hides closed issues by default", () => {
  const nodes = buildCanvasFlowIssueNodes([
    issue(1, "OPEN"),
    issue(2, "CLOSED"),
    issue(3, "closed"),
  ]);

  const ids = nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["issue-1"]);
});

test("buildCanvasFlowIssueNodes shows closed issues when filter is all", () => {
  const nodes = buildCanvasFlowIssueNodes(
    [issue(1, "OPEN"), issue(2, "CLOSED")],
    { filter: "all" },
  );

  const ids = nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["issue-1", "issue-2"]);
});

test("buildCanvasFlowIssueNodes treats missing state as open", () => {
  const nodes = buildCanvasFlowIssueNodes([issue(4, "")]);
  assert.deepEqual(nodes.map((n) => n.id), ["issue-4"]);
});

test("issueVisibilityStore filter persists to localStorage", async () => {
  const { useIssueVisibilityStore } = await import(
    "../src/stores/issueVisibilityStore.ts"
  );

  // Ensure a clean slate before mutating the store.
  useIssueVisibilityStore.getState().setFilter("open");
  assert.equal(useIssueVisibilityStore.getState().filter, "open");

  useIssueVisibilityStore.getState().setFilter("closed");
  assert.equal(useIssueVisibilityStore.getState().filter, "closed");

  useIssueVisibilityStore.getState().setFilter("all");
  assert.equal(useIssueVisibilityStore.getState().filter, "all");
});

function issue(number: number, state: string): IssueNodeData {
  return makeIssue(number, state);
}