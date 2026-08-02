import test from "node:test";
import assert from "node:assert/strict";

test("useIssueStore addIssue deduplicates by number", async () => {
  const { useIssueStore } = await import("../src/stores/issueStore.ts");

  useIssueStore.getState().clearIssues();

  const issue = {
    issueId: "test-1",
    projectId: "p1",
    worktreeId: "w1",
    issueNumber: 42,
    title: "Test Issue",
    body: "",
    url: "https://github.com/test/test/issues/42",
    labels: [],
    x: 100,
    y: 200,
  };

  useIssueStore.getState().addIssue(issue);
  assert.equal(useIssueStore.getState().hasIssue(42), true);
  assert.equal(useIssueStore.getState().getAllIssues().length, 1);

  // Adding same issue again should not duplicate
  useIssueStore.getState().addIssue(issue);
  assert.equal(useIssueStore.getState().getAllIssues().length, 1);

  useIssueStore.getState().clearIssues();
});

test("useIssueStore hasIssue returns false for missing", async () => {
  const { useIssueStore } = await import("../src/stores/issueStore.ts");

  useIssueStore.getState().clearIssues();
  assert.equal(useIssueStore.getState().hasIssue(999), false);
});

test("useIssueStore removeIssue removes by number", async () => {
  const { useIssueStore } = await import("../src/stores/issueStore.ts");

  useIssueStore.getState().clearIssues();

  useIssueStore.getState().addIssue({
    issueId: "test-2",
    projectId: "p1",
    worktreeId: "w1",
    issueNumber: 10,
    title: "Remove Me",
    body: "",
    url: "https://github.com/test/test/issues/10",
    labels: [],
    x: 100,
    y: 200,
  });

  assert.equal(useIssueStore.getState().hasIssue(10), true);
  useIssueStore.getState().removeIssue(10);
  assert.equal(useIssueStore.getState().hasIssue(10), false);

  useIssueStore.getState().clearIssues();
});

test("useIssueStore addIssue only adds new issues", async () => {
  const { useIssueStore } = await import("../src/stores/issueStore.ts");

  useIssueStore.getState().clearIssues();

  useIssueStore.getState().addIssue({
    issueId: "test-3a",
    projectId: "p1",
    worktreeId: "w1",
    issueNumber: 1,
    title: "First",
    body: "",
    url: "https://github.com/test/test/issues/1",
    labels: [],
    x: 100,
    y: 200,
  });

  useIssueStore.getState().addIssue({
    issueId: "test-3b",
    projectId: "p1",
    worktreeId: "w1",
    issueNumber: 2,
    title: "Second",
    body: "",
    url: "https://github.com/test/test/issues/2",
    labels: [],
    x: 350,
    y: 200,
  });

  assert.equal(useIssueStore.getState().getAllIssues().length, 2);
  assert.equal(useIssueStore.getState().hasIssue(1), true);
  assert.equal(useIssueStore.getState().hasIssue(2), true);
  assert.equal(useIssueStore.getState().hasIssue(3), false);

  useIssueStore.getState().clearIssues();
});

test("useIssueStore hydrateIssues replaces all", async () => {
  const { useIssueStore } = await import("../src/stores/issueStore.ts");

  useIssueStore.getState().clearIssues();

  useIssueStore.getState().addIssue({
    issueId: "old",
    projectId: "p1",
    worktreeId: "w1",
    issueNumber: 1,
    title: "Old",
    body: "",
    url: "",
    labels: [],
    x: 100,
    y: 200,
  });

  useIssueStore.getState().hydrateIssues([
    {
      issueId: "new-1",
      projectId: "p1",
      worktreeId: "w1",
      issueNumber: 100,
      title: "New 1",
      body: "",
      url: "",
      labels: [],
      x: 100,
      y: 200,
    },
    {
      issueId: "new-2",
      projectId: "p1",
      worktreeId: "w1",
      issueNumber: 200,
      title: "New 2",
      body: "",
      url: "",
      labels: [],
      x: 350,
      y: 200,
    },
  ]);

  assert.equal(useIssueStore.getState().hasIssue(1), false);
  assert.equal(useIssueStore.getState().hasIssue(100), true);
  assert.equal(useIssueStore.getState().hasIssue(200), true);
  assert.equal(useIssueStore.getState().getAllIssues().length, 2);

  useIssueStore.getState().clearIssues();
});
