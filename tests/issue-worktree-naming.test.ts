import test from "node:test";
import assert from "node:assert/strict";
import { buildIssueBranchName } from "../src/canvas/issueWorktreeNaming.ts";

test("buildIssueBranchName: standard title → kebab-case slug", () => {
  const result = buildIssueBranchName({
    issueNumber: 42,
    title: "Fix login bug",
  });
  assert.equal(result, "issue-42-fix-login-bug");
});

test("buildIssueBranchName: special characters stripped to kebab", () => {
  const result = buildIssueBranchName({
    issueNumber: 7,
    title: 'Add @auth & "quotes" support!',
  });
  assert.equal(result, "issue-7-add-auth-quotes-support");
});

test("buildIssueBranchName: slug truncated to 40 chars with trailing hyphen trim", () => {
  const longTitle =
    "This is an extremely long issue title that definitely exceeds the forty character slug limit";
  const result = buildIssueBranchName({ issueNumber: 10, title: longTitle });
  // prefix = "issue-10-" (9 chars), slug max 40
  assert.ok(result.startsWith("issue-10-"));
  const slug = result.slice("issue-10-".length);
  assert.ok(slug.length <= 40, `slug length ${slug.length} should be <= 40`);
  assert.ok(!slug.endsWith("-"), "slug should not end with hyphen");
});

test("buildIssueBranchName: injection input yields safe kebab-case", () => {
  const result = buildIssueBranchName({
    issueNumber: 99,
    title: "; rm -rf /",
  });
  assert.equal(result, "issue-99-rm-rf");
  assert.ok(!result.includes(";"), "should not contain semicolons");
  assert.ok(!result.includes("/"), "should not contain slashes");
});

test("buildIssueBranchName: consecutive hyphens collapsed", () => {
  const result = buildIssueBranchName({
    issueNumber: 1,
    title: "Fix   multiple---spaces",
  });
  assert.equal(result, "issue-1-fix-multiple-spaces");
});

test("buildIssueBranchName: leading/trailing special chars trimmed", () => {
  const result = buildIssueBranchName({
    issueNumber: 5,
    title: "  --Hello World--  ",
  });
  assert.equal(result, "issue-5-hello-world");
});

test("buildIssueBranchName: empty title yields just prefix", () => {
  const result = buildIssueBranchName({ issueNumber: 3, title: "" });
  assert.equal(result, "issue-3");
});
