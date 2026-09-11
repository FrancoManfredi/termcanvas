import type {
  Issue,
  IssueStatus,
  InProgressPhase,
  AwaitingAction,
  ActivityColumn,
} from "../types";
import type { ActivityAdapter } from "./types";

/**
 * Mock activity dataset — copied verbatim from
 * figma/Crear panel lateral interactivo/src/data/issues.ts.
 * Copied, never imported from figma/.
 */

export const ISSUES: Issue[] = [
  {
    id: 23,
    title: "Add keyboard shortcut to focus active tile",
    body: "When multiple tiles are open, there's no fast way to jump between them using the keyboard. We should support Cmd+1..9 to focus tiles by index, and Cmd+] / Cmd+[ to cycle through them.\n\nAcceptance criteria:\n- Cmd+1 focuses the first tile, Cmd+2 the second, etc.\n- Cmd+] cycles forward, Cmd+[ cycles backward\n- Focused tile gets the cyan border and gains terminal input focus\n- Works when a modal or palette is not open",
    labels: ["enhancement", "keyboard"],
    status: "pending",
    createdAt: "2026-08-14",
    updatedAt: "2026-08-14",
  },
  {
    id: 27,
    title: "Right panel diff view doesn't refresh after git commit",
    body: "After committing inside a tile, the RightPanel still shows the previous diff. The diff view should auto-refresh when a commit event is detected.\n\nSteps to reproduce:\n1. Make a change in a worktree tile\n2. Run `git commit -am 'fix'` inside the tile\n3. RightPanel still shows the old diff\n\nExpected: diff clears and shows clean working tree.",
    labels: ["bug", "git"],
    status: "pending",
    createdAt: "2026-08-18",
    updatedAt: "2026-08-19",
  },
  {
    id: 31,
    title: "Canvas zoom resets on window resize",
    body: "If you zoom to 60% and then resize the Electron window, the canvas snaps back to 100%. The viewport transform should be preserved across window resize events.\n\nLikely cause: the resize handler is calling `resetTransform()` instead of only recalculating the clip bounds.",
    labels: ["bug", "canvas"],
    status: "pending",
    createdAt: "2026-08-21",
    updatedAt: "2026-08-21",
  },
  {
    id: 19,
    title: "Spawn worktree from issue card in one click",
    body: "Currently creating a worktree requires opening the LeftPanel, right-clicking, and filling a dialog. This issue tracks the one-click flow: right-click an issue card → Resolve Issue → auto-creates `git worktree add -b issue-{n}` and opens an opencode tile with the pre-filled prompt.\n\nThis is the core interaction of the resolve-issue loop and should feel instant.",
    labels: ["feature", "worktrees", "ux"],
    status: "in-progress",
    assignee: "opencode-agent",
    branch: "issue-19",
    phase: "implementing",
    phaseStarted: "2026-08-28 14:32",
    createdAt: "2026-08-10",
    updatedAt: "2026-08-28",
  },
  {
    id: 22,
    title: "Persist canvas layout to disk between sessions",
    body: "Tile positions, zoom level, and pan offset are lost when the Electron window is closed. We should serialize the canvas state to `~/.termcanvas/layout.json` on every meaningful change (debounced 500ms) and restore it on startup.\n\nEdge cases to handle:\n- Worktree deleted externally: skip orphan tiles\n- Layout file corrupted: fall back to default grid\n- Multiple projects: namespace by project path",
    labels: ["feature", "persistence"],
    status: "in-progress",
    assignee: "opencode-agent",
    branch: "issue-22",
    phase: "fixing",
    phaseStarted: "2026-08-29 09:15",
    createdAt: "2026-08-12",
    updatedAt: "2026-08-29",
  },
  {
    id: 15,
    title: "GitHub issues list shows stale data after re-fetch",
    body: "When you trigger 'Update issue status', new issues appear but closed/deleted ones remain visible. The list should be replaced (not merged) on each fetch, and issues no longer returned by `gh issue list` should be removed from the canvas.\n\nAlso: add a visual indicator (spinner on the card) while the fetch is in-flight.",
    labels: ["bug", "github"],
    status: "awaiting",
    assignee: "reviewer-agent",
    branch: "issue-15",
    prNumber: 41,
    awaitingAction: "merge-ready",
    createdAt: "2026-08-05",
    updatedAt: "2026-08-30",
  },
  {
    id: 17,
    title: "Tile header shows wrong worktree path on Windows",
    body: "On Windows paths use backslashes but the tile footer renders the raw path string which breaks layout and looks wrong. Normalize all displayed paths to forward slashes using `path.posix` or a simple `.replace(/\\/g, '/')` before rendering.",
    labels: ["bug", "windows"],
    status: "awaiting",
    branch: "issue-17",
    prNumber: 43,
    awaitingAction: "changes-requested",
    createdAt: "2026-08-07",
    updatedAt: "2026-08-30",
  },
  {
    id: 20,
    title: "Box-select snaps to grid incorrectly at high zoom",
    body: "When zoomed in past 150%, the box-select rectangle doesn't align with the visual tile boundaries. The selection rect is calculated in screen space but tiles are in canvas space, causing a mismatch when zoom != 1.",
    labels: ["bug", "canvas", "selection"],
    status: "awaiting",
    branch: "issue-20",
    prNumber: 45,
    awaitingAction: "triage-respond",
    createdAt: "2026-08-20",
    updatedAt: "2026-08-30",
  },
  {
    id: 11,
    title: "Add project via drag-and-drop from Finder",
    body: "Users should be able to drag a folder from Finder (macOS) or Explorer (Windows) directly onto the canvas to add a project. The app should detect that it's a valid git repo, create the project entry, and place the main worktree tile at the drop coordinates.",
    labels: ["feature", "ux"],
    status: "done",
    branch: "issue-11",
    createdAt: "2026-07-28",
    updatedAt: "2026-08-22",
  },
  {
    id: 13,
    title: "Box-select multiple tiles and move them together",
    body: "Drag on empty canvas area creates a selection rectangle. All tiles within the rect are selected (cyan ring), and dragging any of them moves the entire group. Escape or click on empty area deselects.\n\nShipped in v0.4.",
    labels: ["feature", "canvas"],
    status: "done",
    branch: "issue-13",
    createdAt: "2026-08-01",
    updatedAt: "2026-08-25",
  },
];

export const COLUMNS: ActivityColumn[] = [
  { id: "pending",     label: "Pending",     color: "#555555", dimColor: "#55555520" },
  { id: "in-progress", label: "In Progress", color: "#f59e0b", dimColor: "#f59e0b18" },
  { id: "awaiting",    label: "Awaiting You", color: "#a855f7", dimColor: "#a855f718" },
  { id: "done",        label: "Done",         color: "#22c55e", dimColor: "#22c55e18" },
];

export const PHASE_LABELS: Record<InProgressPhase, string> = {
  implementing: "Implementing",
  reviewing:    "Reviewing",
  fixing:       "Implementing Fix",
};

export const AWAITING_LABELS: Record<AwaitingAction, string> = {
  "review-ready":       "Review Issue",
  "changes-requested":  "Implement Fix",
  "merge-ready":        "Merge PR",
  "spec-approval":      "Approve Spec",
  "triage-respond":     "Answer Questions",
  "ask-human":          "Accept Review",
  "resume":             "Retomar trabajo",
};

/** Re-exported status union for column lookups (mirrors issues.ts usage). */
export type { IssueStatus };

/* ─── Mock adapter (read-only snapshot, no fetch/timers) ──────────────── */

function cloneIssue(issue: Issue): Issue {
  return { ...issue, labels: [...issue.labels] };
}

const store: Issue[] = ISSUES.map(cloneIssue);

export class MockActivityAdapter implements ActivityAdapter {
  listActivityIssues(): Issue[] {
    return store.map(cloneIssue);
  }

  getActivityIssue(id: number): Issue | undefined {
    const found = store.find((issue) => issue.id === id);
    return found ? cloneIssue(found) : undefined;
  }
}

export const mockActivityAdapter: ActivityAdapter = new MockActivityAdapter();
