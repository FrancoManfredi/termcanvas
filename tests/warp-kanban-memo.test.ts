/**
 * warp-kanban-memo — B1: memoized Kanban cards bail out of the per-poll
 * re-render when content is unchanged.
 *
 * Root cause (file:line): every 2.5s poll replaces the `useWorkItemStore`
 * list identity, so `useIssues` rebuilds all N `KanbanIssue` objects and
 * `KanbanBoard` re-renders all N cards; each `IssueCard` re-ran
 * `plainPreviewFromMarkdown` (regex chain over the full body) and each
 * open drawer re-ran `renderMarkdown` (marked + DOMPurify). At N = 342
 * that is the per-tick render storm behind the "panel open = everything
 * slow" report (B1) and part of the Review-entry freeze (B3).
 *
 * Fix: `IssueCard`/`CompactIssueRow` are `memo`ized behind
 * `isSameIssueCardProps`/`isSameCompactRowProps` (rendered fields only —
 * a default shallow memo would never bail since the poll rebuilds every
 * object), the body preview is `useMemo`d on the body string, and drag
 * callbacks are stable (`useCallback` in `KanbanBoard`, id-based props).
 * Offline: pure, zero network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  isSameCompactRowProps,
  isSameIssueCardProps,
  type CompactIssueRowProps,
  type IssueCardProps,
} from "../src/features/warpPanel/components/KanbanBoard.tsx";
import type { KanbanIssue } from "../src/features/warpPanel/types.ts";

function card(overrides: Partial<KanbanIssue> = {}): KanbanIssue {
  return {
    id: 7,
    repoName: "termcanvas",
    number: 7,
    title: "Fix the freeze",
    status: "in-progress",
    body: "# Body\n\nSome **markdown** with `code` and a [link](https://example.com).",
    author: "octocat",
    authorColor: "#58a6ff",
    openedAgo: "",
    labels: [{ name: "bug", bg: "#27272a", fg: "#e5e5e5" }],
    activity: [],
    ...overrides,
  };
}

const stableOpen = (_id: number): void => {};
const stableDrag = (_id: number): void => {};
const stableEnd = (): void => {};

function props(overrides: Partial<IssueCardProps> = {}): IssueCardProps {
  return {
    issue: card(),
    isDragging: false,
    onOpen: stableOpen,
    onDragStart: stableDrag,
    onDragEnd: stableEnd,
    ...overrides,
  };
}

test("rebuilt-but-identical objects bail out (the poll case)", () => {
  assert.equal(isSameIssueCardProps(props(), props({ issue: card() })), true);
});

test("rendered content changes re-render", () => {
  assert.equal(
    isSameIssueCardProps(props(), props({ issue: card({ title: "New" }) })),
    false,
  );
  assert.equal(
    isSameIssueCardProps(props(), props({ issue: card({ body: "New" }) })),
    false,
  );
  assert.equal(
    isSameIssueCardProps(props(), props({ issue: card({ status: "done" }) })),
    false,
  );
  assert.equal(
    isSameIssueCardProps(
      props(),
      props({ issue: card({ labels: [{ name: "fix", bg: "#000", fg: "#fff" }] }) }),
    ),
    false,
  );
  assert.equal(
    isSameIssueCardProps(props(), props({ isDragging: true })),
    false,
  );
});

test("unstable callbacks re-render (parent must keep them stable)", () => {
  assert.equal(
    isSameIssueCardProps(props(), props({ onOpen: (_id: number): void => {} })),
    false,
  );
  assert.equal(
    isSameIssueCardProps(props(), props({ onDragEnd: (): void => {} })),
    false,
  );
});

test("junk never throws", () => {
  assert.equal(
    isSameIssueCardProps(
      props(),
      { ...props(), issue: null as unknown as KanbanIssue },
    ),
    false,
  );
});

test("compact rows add the column dot to the same guard", () => {
  const row = (overrides: Partial<CompactIssueRowProps> = {}): CompactIssueRowProps => ({
    ...props(),
    colDotColor: "#f59e0b",
    colDotStyle: "solid",
    ...overrides,
  });
  assert.equal(isSameCompactRowProps(row(), row({})), true);
  assert.equal(
    isSameCompactRowProps(row(), row({ colDotColor: "#22c55e" })),
    false,
  );
  assert.equal(
    isSameCompactRowProps(row(), row({ issue: card({ title: "X" }) })),
    false,
  );
});
