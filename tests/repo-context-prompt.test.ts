import test from "node:test";
import assert from "node:assert/strict";
import { buildIssueFixPrompt } from "../src/canvas/issueFixPrompt.ts";
import { buildIssueReviewPrompt } from "../src/canvas/issueReviewPrompt.ts";
import { buildIssueResolvePrompt } from "../src/canvas/issueResolvePrompt.ts";
import { buildResolveConflictPrompt } from "../src/canvas/resolveConflictPrompt.ts";

const REPO_CONTEXT = "# Misión\n\nTermCanvas automatiza orquestadores.\nSegunda línea de intención.";

const builders: Array<{ name: string; build: () => string }> = [
  {
    name: "resolve",
    build: () =>
      buildIssueResolvePrompt(
        {
          issueNumber: 1,
          title: "Issue title",
          body: "Body",
          repoContext: REPO_CONTEXT,
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
        repoContext: REPO_CONTEXT,
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
        repoContext: REPO_CONTEXT,
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
        repoContext: REPO_CONTEXT,
      }),
  },
];

test("all orchestrator prompts inject the repository context at the start", () => {
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(
      prompt.includes("CONTEXTO DEL REPOSITORIO"),
      `${name} prompt must include the repo context section`,
    );
    assert.ok(
      prompt.includes("TermCanvas automatiza orquestadores"),
      `${name} prompt must include the repo context content`,
    );
    assert.ok(
      prompt.indexOf("CONTEXTO DEL REPOSITORIO") <
        prompt.indexOf("issue #1"),
      `${name} prompt must put the repo context before the task`,
    );
  }
});

test("all orchestrator prompts flatten the repo context to a single line", () => {
  for (const { name, build } of builders) {
    const prompt = build();
    assert.ok(!prompt.includes("\n"), `${name} prompt must stay one line`);
    assert.ok(
      !prompt.includes("Segunda línea de intención.") ||
        prompt.includes(
          "TermCanvas automatiza orquestadores. Segunda línea de intención.",
        ),
      `${name} prompt must flatten the multi-line repo context`,
    );
  }
});

test("without repo context the prompts are unchanged (no empty section)", () => {
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
      `${name} prompt must not emit the section without context`,
    );
  }
});
