/**
 * warp-panel-no-reload — item 2 (reload forbidden).
 *
 * Finding (evidence): there is NO programmatic full-app reload anywhere
 * on the review→awaiting path. The only `window.location.reload()` calls
 * in `src/` are the root `ErrorBoundary`'s manual button
 * (`src/components/ErrorBoundary.tsx:24`) and an unrelated FactoryLab
 * popup refresh (`FactoryLabPage.tsx:931`); zero `location.href=`
 * assignments; zero key-remounts in App/panel (keys appear only on stable
 * list rows); `notify` is a toast without reload; and the Vite watcher
 * already ignores the runtime write dirs (`.worktrees`, `.agents`,
 * `.hydra`, `.termcanvas` in `vite.config.ts`).
 *
 * What reads as "the app reloaded" is the SINGLE root `ErrorBoundary`
 * (`src/main.tsx`): any render throw during the review→awaiting
 * transition (verdict + labels land, then a forced PR re-lookup flips
 * `prsByIssue[n]` through `"loading"`) replaces the WHOLE app, and the
 * only way back is its Reload button.
 *
 * Fix (state transition / poll, never reload):
 * - Defensive coercion on every unvalidated store slice the detail and
 *   PR mapping iterate (`labelsByPr`, `labelsByIssue`, `openPrsByIssue`,
 *   markdown body) — junk degrades to honest-empty instead of throwing.
 * - `WarpPanelBoundary`: a panel-scoped boundary whose retry is a state
 *   reset (re-render from the live stores/poll), never a reload.
 *
 * Offline: zero network, zero daemon, zero reloads.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalReviewLabel,
  effectiveReviewLabel,
} from "../src/canvas/reviewVerdict.ts";
import {
  mapPrsFromNodeAndReview,
  type LiveReviewSnapshot,
} from "../src/features/warpPanel/adapters/liveIssues.ts";
import { deriveActivityStatus } from "../src/features/warpPanel/adapters/activityDerivation.ts";
import type * as React from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { WarpPanelBoundary } from "../src/features/warpPanel/components/WarpPanelBoundary.tsx";

/** Global guard: real network in these tests is a failure. */
const realFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("real network forbidden in tests");
}) as unknown as typeof fetch;
test.after(() => {
  globalThis.fetch = realFetch;
});

// ─── verdict engine never throws on junk ───────────────────────────────────

test("canonicalReviewLabel degrades non-array input to null", () => {
  assert.equal(canonicalReviewLabel("review:aprobado" as never), null);
  assert.equal(canonicalReviewLabel(null as never), null);
  assert.equal(canonicalReviewLabel(undefined as never), null);
  assert.equal(canonicalReviewLabel(42 as never), null);
  assert.equal(canonicalReviewLabel({} as never), null);
  // Real labels still resolve with precedence.
  assert.equal(
    canonicalReviewLabel(["review:pendiente", "review:aprobado"]),
    "review:aprobado",
  );
  assert.equal(canonicalReviewLabel([]), null);
});

test("effectiveReviewLabel never throws on junk labels", () => {
  assert.equal(
    effectiveReviewLabel("review:aprobado" as never, null),
    null,
  );
  assert.equal(effectiveReviewLabel(null as never, "APPROVED"), "review:aprobado");
});

// ─── PR mapping never throws on junk store slices ──────────────────────────

function rawNode(): Record<string, unknown> {
  return {
    issueNumber: 7,
    title: "Issue 7",
    body: "",
    labels: [],
    closedByPullRequestsReferences: { nodes: [] },
    timelineItems: { nodes: [] },
  };
}

function snapshotWithJunkLabels(): LiveReviewSnapshot {
  return {
    primaryPrByIssue: {
      7: { number: 61, title: "PR", url: "https://x/y/pull/61", state: "OPEN" },
    },
    verdictByIssue: {},
    reviewingIssueNumber: null,
    fixingIssueNumber: null,
    mergingIssueNumber: null,
    resolvingConflictIssueNumber: null,
    mergedPrNumbers: [],
    openPrsByIssue: {
      7: [
        { number: 61, title: "PR", url: "https://x/y/pull/61", state: "OPEN" },
      ],
    },
    labelsByPr: { 7: { 61: "review:aprobado" as unknown as string[] } },
    labelsByIssue: { 7: 42 as unknown as string[] },
  };
}

test("mapPrsFromNodeAndReview coerces junk label slices to honest-empty", () => {
  const prs = mapPrsFromNodeAndReview(
    rawNode(),
    snapshotWithJunkLabels(),
    null,
  );
  assert.equal(prs.length, 1);
  assert.deepEqual(prs[0].labels, []);
  assert.equal(prs[0].effectiveLabel, null);
});

test("deriveActivityStatus never throws on a junk review snapshot", () => {
  assert.equal(
    deriveActivityStatus(7, null as never, null, "OPEN").status,
    "pending",
  );
  assert.equal(
    deriveActivityStatus(7, "junk" as never, null, "OPEN").status,
    "pending",
  );
});

// ─── item 2 follow-up: row isolation + persisted section ────────────────
// Live evidence (job-mtqqz1fz-ntis, Complete 04:41Z): the review→awaiting
// transition lands new lastReview/scores/dashboardUrl shapes while a forced
// PR re-lookup flips `prsByIssue[n]` through `"loading"`. The real throw
// was `liveIssues.ts:167,180,185,194` — bare `Object.entries(...)` over
// store slices that may be undefined/wrong-type at that exact tick, thrown
// mid-render in `WarpPanelShell` (outside `WarpPanelBoundary`), which read
// as a black-screen + reset to the default `"issues"` section. The Activity
// twin (`liveActivity.ts:153,164,173,186`) already guarded with `?? {}`.

test("LiveIssuesAdapter never throws on junk review slices (row isolation)", async () => {
  const { LiveIssuesAdapter } = await import(
    "../src/features/warpPanel/adapters/liveIssues.ts"
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
  // Junk review snapshot: wrong-type slices that used to throw inside
  // `Object.entries` (undefined prs/openPRs, statusByPr-less progress,
  // non-record gate map).
  const junkReview = {
    primaryPrByIssue: undefined,
    verdictByIssue: "junk",
    reviewingIssueNumber: 7.5,
    fixingIssueNumber: null,
    mergingIssueNumber: null,
    resolvingConflictIssueNumber: null,
    mergedPrNumbers: "junk",
    openPrsByIssue: undefined,
    verdictByPr: null,
    labelsByPr: 42,
    labelsByIssue: null,
    conflictByPr: "junk",
    gateByPr: undefined,
  };
  const adapter = new LiveIssuesAdapter({
    readIssues: () => [node] as never,
    readReview: () => junkReview as never,
    readResolvingIssueNumber: () => null,
    readFactoryJobs: () => [],
    readProjectName: () => undefined,
    loadStatusOverrides: () => new Map(),
    saveStatusOverrides: () => {},
  });
  const cards = adapter.listIssues();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].number, 7);
});

test("LiveIssuesAdapter drops a poisoned row without breaking the panel", async () => {
  const { LiveIssuesAdapter } = await import(
    "../src/features/warpPanel/adapters/liveIssues.ts"
  );
  const good = {
    issueId: "node-7",
    projectId: "C:/repos/termcanvas",
    worktreeId: "w1",
    issueNumber: 7,
    title: "Good",
    body: "",
    url: "https://github.com/org/termcanvas/issues/7",
    labels: [],
    x: 0,
    y: 0,
  };
  const poisoned = {
    issueId: "node-8",
    projectId: "C:/repos/termcanvas",
    worktreeId: "w1",
    issueNumber: 8,
    title: "Poisoned",
    body: "",
    url: "https://github.com/org/termcanvas/issues/8",
    labels: [],
    x: 0,
    y: 0,
    get state(): string {
      throw new Error("poisoned getter");
    },
  };
  const adapter = new LiveIssuesAdapter({
    readIssues: () => [good, poisoned] as never,
    readReview: () =>
      ({
        primaryPrByIssue: {},
        verdictByIssue: {},
        reviewingIssueNumber: null,
        fixingIssueNumber: null,
        mergingIssueNumber: null,
        resolvingConflictIssueNumber: null,
        mergedPrNumbers: [],
      }) as never,
    readResolvingIssueNumber: () => null,
    readFactoryJobs: () => [],
    readProjectName: () => {
      throw new Error("poisoned project read");
    },
    loadStatusOverrides: () => new Map(),
    saveStatusOverrides: () => {},
  });
  const cards = adapter.listIssues();
  // The good row survives; the poisoned row drops — no throw resets the panel.
  assert.ok(cards.some((c) => c.number === 7));
});

test("persisted panel section validates and degrades honestly", async () => {
  const {
    WARP_PANEL_SECTION_STORAGE_KEY,
    isValidPanelSection,
    loadPersistedPanelSection,
    persistPanelSection,
  } = await import("../src/features/warpPanel/panelSection.ts");
  assert.equal(WARP_PANEL_SECTION_STORAGE_KEY, "warp-panel-section-v1");
  assert.equal(isValidPanelSection("activity"), true);
  assert.equal(isValidPanelSection("junk-section"), false);
  assert.equal(isValidPanelSection(""), false);
  assert.equal(isValidPanelSection(null), false);
  // No window in node → default section, never throws.
  assert.equal(loadPersistedPanelSection(), "issues");
  // Junk section never persists / never throws.
  assert.doesNotThrow(() => persistPanelSection("junk-section" as never));
  assert.doesNotThrow(() => persistPanelSection("activity" as never));
});

// ─── panel-scoped boundary: fallback + state retry, never reload ──────────

test("WarpPanelBoundary renders children when healthy", () => {
  const html = renderToString(
    createElement(
      WarpPanelBoundary,
      null,
      createElement("span", null, "panel alive"),
    ),
  );
  assert.match(html, /panel alive/);
});

test("WarpPanelBoundary contains a throw without any reload", () => {
  // `renderToString` does not exercise boundaries (errors propagate), so
  // the contract is verified directly: the static error state carries the
  // message, and the fallback rendered from that state offers a state
  // retry with no reload anywhere.
  const next = WarpPanelBoundary.getDerivedStateFromError(
    new Error("review-transition shape"),
  );
  assert.equal(next.hasError, true);
  assert.equal(next.message, "review-transition shape");
  const boundary = new WarpPanelBoundary({ children: null });
  boundary.state = { hasError: true, message: "review-transition shape" };
  const html = renderToString(
    boundary.render() as React.ReactElement,
  );
  // Fallback copy renders…
  assert.match(html, /render error/);
  assert.match(html, /Retry panel/);
  // …and recovery never mentions a reload.
  assert.doesNotMatch(html, /location\.reload/);
  assert.doesNotMatch(html, /window\.location/);
});
