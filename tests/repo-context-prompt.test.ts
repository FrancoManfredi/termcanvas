import test from "node:test";
import assert from "node:assert/strict";
import { buildIssueFixPrompt } from "../src/canvas/issueFixPrompt.ts";
import { buildIssueReviewPrompt } from "../src/canvas/issueReviewPrompt.ts";
import { buildIssueResolvePrompt } from "../src/canvas/issueResolvePrompt.ts";
import { buildResolveConflictPrompt } from "../src/canvas/resolveConflictPrompt.ts";
import { REPO_CONTEXT_FILE } from "../src/utils/repoContext.ts";

const REPO_PATH = "C:/repo";
const CONTEXT_FILE_PATH = `${REPO_PATH}/${REPO_CONTEXT_FILE}`;

const builders: Array<{ name: string; build: () => string }> = [
  {
    name: "resolve",
    build: () =>
      buildIssueResolvePrompt(
        {
          issueNumber: 1,
          title: "Issue title",
          body: "Body",
          repoPath: REPO_PATH,
        },
        "new",
      ),
  },
  {
    name: "fix",
    build: () =>
      buildIssueFixPrompt({
        issueNumber: 1,
        title: "Issue title",
        body: "Body",
        prNumber: 12,
        branch: "issue-1",
        repoPath: REPO_PATH,
      }),
  },
  {
    name: "review",
    build: () =>
      buildIssueReviewPrompt({
        issueNumber: 1,
        title: "Issue title",
        body: "Body",
        prNumber: 12,
        branch: "issue-1",
        repoPath: REPO_PATH,
      }),
  },
  {
    name: "conflict",
    build: () =>
      buildResolveConflictPrompt({
        issueNumber: 1,
        title: "Issue title",
        prNumber: 12,
        branch: "issue-1",
        repoPath: REPO_PATH,
      }),
  },
];

test("all orchestrator prompts point the agent at the repo-context file", () => {
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(
      prompt.includes("CONTEXTO DEL REPOSITORIO"),
      `${name} prompt must include the repo context section`,
    );
    assert.ok(
      prompt.includes(CONTEXT_FILE_PATH),
      `${name} prompt must reference the repo-context file path`,
    );
    assert.ok(
      prompt.indexOf("CONTEXTO DEL REPOSITORIO") <
        prompt.indexOf("issue #1"),
      `${name} prompt must put the repo context before the task`,
    );
  }
});

test("all orchestrator prompts stay a single line", () => {
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(!prompt.includes("\n"), `${name} prompt must stay one line`);
  }
});

test("without a repo path the prompts are unchanged (no empty section)", () => {
  const without = {
    resolve: buildIssueResolvePrompt(
      { issueNumber: 1, title: "Issue title", body: "Body" },
      "new",
    ),
    fix: buildIssueFixPrompt({
      issueNumber: 1,
      title: "Issue title",
      body: "Body",
      prNumber: 12,
      branch: "issue-1",
    }),
    review: buildIssueReviewPrompt({
      issueNumber: 1,
      title: "Issue title",
      body: "Body",
      prNumber: 12,
      branch: "issue-1",
    }),
    conflict: buildResolveConflictPrompt({
      issueNumber: 1,
      title: "Issue title",
      prNumber: 12,
      branch: "issue-1",
    }),
  };
  for (const [name, prompt] of Object.entries(without)) {
    assert.ok(
      !prompt.includes("CONTEXTO DEL REPOSITORIO"),
      `${name} prompt must not emit the section without a repo path`,
    );
  }
});

test("repoPath with trailing slashes is normalized before referencing the file", () => {
  const prompt = buildIssueResolvePrompt(
    { issueNumber: 1, title: "Issue title", body: "Body", repoPath: "C:/repo//" },
    "new",
  );
  assert.ok(prompt.includes(CONTEXT_FILE_PATH), "trailing slashes are stripped");
  assert.ok(!prompt.includes("C:/repo///"), "no doubled slashes in the path");
});