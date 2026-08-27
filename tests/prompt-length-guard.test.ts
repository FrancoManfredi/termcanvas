import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROMPT_ARG_CHARS,
  clampPromptArg,
} from "../src/terminal/cliConfig.ts";
import {
  PROMPT_CONTEXT_MAX_CHARS,
  capPromptContextText,
} from "../shared/prompt-context-cap.ts";
import { buildIssueReviewPrompt } from "../src/canvas/issueReviewPrompt.ts";

// Windows CreateProcess hard-caps the whole command line at 32,767 chars
// (error 206 / ERROR_FILENAME_EXCED_RANGE): an oversized --prompt kills the
// PTY spawn with "Cannot create process". These guards keep every prompt on
// the safe side of that limit.
const WINDOWS_CMDLINE_LIMIT = 32_767;

test("clampPromptArg leaves prompts under the budget untouched", () => {
  const prompt = "hola mundo";
  assert.equal(clampPromptArg(prompt), prompt);
});

test("clampPromptArg caps oversized prompts with an explicit marker", () => {
  const prompt = "x".repeat(MAX_PROMPT_ARG_CHARS + 5_000);
  const clamped = clampPromptArg(prompt);
  assert.ok(
    clamped.length <= MAX_PROMPT_ARG_CHARS + 500,
    `clamped prompt must stay near the budget, got ${clamped.length}`,
  );
  assert.match(clamped, /TRUNCADO por TermCanvas/);
  assert.ok(clamped.includes("5000"), "marker must report the dropped size");
});

test("capPromptContextText leaves short context untouched", () => {
  const text = "Contexto corto del repo.";
  assert.equal(capPromptContextText(text, null), text);
});

test("capPromptContextText caps oversized context and points to the source file", () => {
  const sourcePath = "C:\\repo\\.agents\\interview\\requerimientos\\entrevista-1-sintesis.json";
  const capped = capPromptContextText("y".repeat(PROMPT_CONTEXT_MAX_CHARS * 3), sourcePath);
  assert.ok(capped.length < PROMPT_CONTEXT_MAX_CHARS + 600);
  assert.match(capped, /TEXTO TRUNCADO POR TermCanvas/);
  assert.ok(capped.includes(sourcePath), "must name the full document path");
});

test("capPromptContextText without a source path falls back to the interview dir", () => {
  const capped = capPromptContextText("z".repeat(PROMPT_CONTEXT_MAX_CHARS * 2));
  assert.match(capped, /\.agents\/interview\//);
});

// Regression for the reported failure: reviewing PR #51 of education-games
// failed to create the PTY because the active brief (49 KB) plus the active
// requirements synthesis (52 KB) were injected inline into the review prompt,
// blowing past the Windows command line limit. With both sections at their
// post-cap worst case plus a maximal prefetched reviewContext, the final
// prompt must still fit — with margin for argv quoting and the exe path.
test("worst-case review prompt fits the Windows command line limit", () => {
  const maxedOut = (ch: string) =>
    capPromptContextText(ch.repeat(60_000), "C:\\repo\\doc.json");
  const prompt = buildIssueReviewPrompt({
    issueNumber: 42,
    title: "Secrets handling with VSCode MCP json",
    prNumber: 51,
    branch: "fix-secrets-vscode-mcp-json",
    commitSha: "a".repeat(40),
    reviewTemplateFilePath: "review-template-51.json",
    // Worst case measured in main.ts: headRefOid (40) + last review body
    // capped at 800 + 10 inline comments capped at 400 each + diff/template
    // pointer lines.
    reviewContext: `[${"c".repeat(6_300)}]`,
    repoContextText: maxedOut("b"),
    requirementsText: maxedOut("r"),
  });
  assert.ok(
    prompt.length < 30_000,
    `review prompt must fit the Windows limit with margin, got ${prompt.length}`,
  );
  assert.ok(prompt.length < WINDOWS_CMDLINE_LIMIT);
});
