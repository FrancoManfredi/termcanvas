export type KanbanStatus = "backlog" | "ready" | "in-progress" | "in-review" | "done";

export interface IssueLabel {
  name: string;
  bg: string;
  fg: string;
}

export interface ActivityEvent {
  id: number;
  actor: string;
  actorColor: string;
  type: "linked-pr" | "added-label" | "comment";
  text: string;
  detail?: string;
  detailHref?: string;
  labelName?: string;
  labelBg?: string;
  labelFg?: string;
  ago: string;
}

export interface KanbanIssue {
  id: number;
  repoName: string;
  number: number;
  title: string;
  status: KanbanStatus;
  body: string;
  author: string;
  authorColor: string;
  openedAgo: string;
  labels: IssueLabel[];
  prNumber?: number;
  prTitle?: string;
  assignees?: { initials: string; color: string }[];
  estimate?: number;
  priority?: "P0" | "P1" | "P2";
  size?: "S" | "M" | "L" | "XL";
  startDate?: string;
  targetDate?: string;
  milestone?: string;
  activity: ActivityEvent[];
}

const REPO = "term-canvas";

export const KANBAN_ISSUES: KanbanIssue[] = [
  // ── Backlog ──────────────────────────────────────────────────────────────────
  {
    id: 1, repoName: REPO, number: 23, status: "backlog",
    title: "Add keyboard shortcut to focus active tile",
    body: "When multiple tiles are open, there's no fast way to jump between them using the keyboard.\n\nWe should support:\n- `Cmd+1..9` to focus tiles by index\n- `Cmd+]` / `Cmd+[` to cycle forward/backward\n- Focused tile gets the cyan border and gains terminal input focus\n- Works when no modal or palette is open",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "3d ago",
    labels: [{ name: "enhancement", bg: "#1d4ed8", fg: "#bfdbfe" }, { name: "keyboard", bg: "#312e81", fg: "#c7d2fe" }],
    priority: "P1", estimate: 3, size: "M",
    activity: [],
  },
  {
    id: 2, repoName: REPO, number: 27, status: "backlog",
    title: "Right panel diff view doesn't refresh after git commit",
    body: "After committing inside a tile, the RightPanel still shows the previous diff.\n\nSteps to reproduce:\n1. Make a change in a worktree tile\n2. Run `git commit -am 'fix'` inside the tile\n3. RightPanel still shows the old diff\n\nExpected: diff clears and shows clean working tree.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "5d ago",
    labels: [{ name: "bug", bg: "#7f1d1d", fg: "#fca5a5" }, { name: "git", bg: "#1c1917", fg: "#a8a29e" }],
    priority: "P0", estimate: 2, size: "S",
    activity: [],
  },
  {
    id: 3, repoName: REPO, number: 31, status: "backlog",
    title: "Canvas zoom resets on window resize",
    body: "If you zoom to 60% and then resize the Electron window, the canvas snaps back to 100%.\n\nLikely cause: the resize handler is calling `resetTransform()` instead of only recalculating the clip bounds.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "1d ago",
    labels: [{ name: "bug", bg: "#7f1d1d", fg: "#fca5a5" }, { name: "canvas", bg: "#1e3a5f", fg: "#93c5fd" }],
    priority: "P1", estimate: 2, size: "S",
    activity: [],
  },
  // ── Ready ────────────────────────────────────────────────────────────────────
  {
    id: 4, repoName: REPO, number: 18, status: "ready",
    title: "Show toast notification on worktree creation failure",
    body: "When `git worktree add` fails (e.g. branch already exists), the error is only logged to the console. It should surface as a toast with the error message.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "6d ago",
    labels: [{ name: "ux", bg: "#134e4a", fg: "#99f6e4" }],
    priority: "P1", estimate: 1, size: "S",
    activity: [],
  },
  {
    id: 5, repoName: REPO, number: 20, status: "ready",
    title: "Support multiple simultaneous opencode sessions per worktree",
    body: "Currently only one opencode tile per worktree is enforced. Remove that restriction and allow spawning additional sessions in the same worktree dir.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "4d ago",
    labels: [{ name: "feature", bg: "#1e3a5f", fg: "#93c5fd" }],
    priority: "P2", estimate: 5, size: "L",
    activity: [],
  },
  // ── In progress ───────────────────────────────────────────────────────────────
  {
    id: 6, repoName: REPO, number: 19, status: "in-progress",
    title: "Spawn worktree from issue card in one click",
    body: "One-click flow: right-click an issue card → Resolve Issue → auto-creates `git worktree add -b issue-{n}` and opens an opencode tile with the pre-filled prompt.\n\nThis is the core interaction of the resolve-issue loop.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "12d ago",
    labels: [{ name: "feature", bg: "#1e3a5f", fg: "#93c5fd" }, { name: "ux", bg: "#134e4a", fg: "#99f6e4" }],
    prNumber: 41, prTitle: "feat: one-click worktree from issue (fix #19) #41",
    priority: "P0", estimate: 8, size: "L",
    assignees: [{ initials: "FM", color: "#22c55e" }],
    activity: [
      { id: 1, actor: "FrancoManfredi", actorColor: "#22c55e", type: "linked-pr", text: "linked a pull request that will close this issue", detail: "feat: one-click worktree (fix #19) #41", detailHref: "#", ago: "2d ago" },
      { id: 2, actor: "FrancoManfredi", actorColor: "#22c55e", type: "added-label", text: "added", labelName: "feature", labelBg: "#1e3a5f", labelFg: "#93c5fd", ago: "3d ago" },
    ],
  },
  {
    id: 7, repoName: REPO, number: 22, status: "in-progress",
    title: "Persist canvas layout to disk between sessions",
    body: "Tile positions, zoom level, and pan offset are lost when the Electron window is closed. Serialize canvas state to `~/.termcanvas/layout.json` on every meaningful change (debounced 500ms) and restore on startup.\n\nEdge cases:\n- Deleted worktree: skip orphan tiles\n- Corrupted layout: fall back to default\n- Multiple projects: namespace by project path",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "8d ago",
    labels: [{ name: "feature", bg: "#1e3a5f", fg: "#93c5fd" }, { name: "persistence", bg: "#292524", fg: "#a8a29e" }],
    prNumber: 43, prTitle: "feat: persist canvas layout (fix #22) #43",
    priority: "P1", estimate: 5, size: "M",
    assignees: [{ initials: "FM", color: "#22c55e" }],
    activity: [
      { id: 1, actor: "FrancoManfredi", actorColor: "#22c55e", type: "linked-pr", text: "linked a pull request that will close this issue", detail: "feat: persist canvas layout (fix #22) #43", detailHref: "#", ago: "1d ago" },
    ],
  },
  // ── In review ─────────────────────────────────────────────────────────────────
  {
    id: 8, repoName: REPO, number: 15, status: "in-review",
    title: "GitHub issues list shows stale data after re-fetch",
    body: "When you trigger 'Update issue status', new issues appear but closed/deleted ones remain visible. The list should be replaced (not merged) on each fetch.\n\nAlso: add a spinner on the card while the fetch is in-flight.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "18d ago",
    labels: [{ name: "bug", bg: "#7f1d1d", fg: "#fca5a5" }, { name: "github", bg: "#1c1917", fg: "#a8a29e" }],
    prNumber: 38, prTitle: "fix: replace issue list on fetch (fix #15) #38",
    priority: "P0", estimate: 3, size: "S",
    assignees: [{ initials: "FM", color: "#22c55e" }],
    milestone: "v0.5",
    activity: [
      { id: 1, actor: "FrancoManfredi", actorColor: "#22c55e", type: "linked-pr", text: "linked a pull request that will close this issue", detail: "fix: replace issue list on fetch (fix #15) #38", detailHref: "#", ago: "5d ago" },
      { id: 2, actor: "FrancoManfredi", actorColor: "#22c55e", type: "added-label", text: "added", labelName: "review:pending", labelBg: "#78350f", labelFg: "#fde68a", ago: "4d ago" },
    ],
  },
  {
    id: 9, repoName: REPO, number: 17, status: "in-review",
    title: "Tile header shows wrong worktree path on Windows",
    body: "On Windows, paths use backslashes but the tile footer renders the raw path string, breaking layout. Normalize all displayed paths to forward slashes using `.replace(/\\\\/g, '/')` before rendering.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "14d ago",
    labels: [{ name: "bug", bg: "#7f1d1d", fg: "#fca5a5" }, { name: "windows", bg: "#1c2a3a", fg: "#93c5fd" }],
    prNumber: 36, prTitle: "fix: normalize path separators on Windows (fix #17) #36",
    priority: "P1", estimate: 1, size: "S",
    activity: [
      { id: 1, actor: "FrancoManfredi", actorColor: "#22c55e", type: "linked-pr", text: "linked a pull request that will close this issue", detail: "fix: normalize path separators (fix #17) #36", detailHref: "#", ago: "3d ago" },
    ],
  },
  // ── Done ─────────────────────────────────────────────────────────────────────
  {
    id: 10, repoName: REPO, number: 11, status: "done",
    title: "Add project via drag-and-drop from Finder",
    body: "Users can drag a folder from Finder (macOS) or Explorer (Windows) onto the canvas to add a project. The app detects if it's a valid git repo, creates the project entry, and places the main worktree tile at the drop coordinates.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "24d ago",
    labels: [{ name: "feature", bg: "#1e3a5f", fg: "#93c5fd" }, { name: "ux", bg: "#134e4a", fg: "#99f6e4" }],
    prNumber: 30, prTitle: "feat: drag-and-drop project from Finder (fix #11) #30",
    priority: "P1", estimate: 5, size: "M",
    activity: [],
  },
  {
    id: 11, repoName: REPO, number: 13, status: "done",
    title: "Box-select multiple tiles and move them together",
    body: "Drag on empty canvas area creates a selection rectangle. All tiles within the rect are selected (cyan ring), dragging any of them moves the whole group. Escape or click empty area deselects.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "20d ago",
    labels: [{ name: "feature", bg: "#1e3a5f", fg: "#93c5fd" }, { name: "canvas", bg: "#1e3a5f", fg: "#93c5fd" }],
    priority: "P2", estimate: 8, size: "L",
    activity: [],
  },
  {
    id: 12, repoName: REPO, number: 9, status: "done",
    title: "Middle-click drag to pan canvas",
    body: "Pan the canvas by holding Space + drag (existing) OR middle-click + drag. This is the standard approach used by Figma, VS Code, etc.",
    author: "FrancoManfredi", authorColor: "#22c55e", openedAgo: "30d ago",
    labels: [{ name: "feature", bg: "#1e3a5f", fg: "#93c5fd" }],
    priority: "P2", estimate: 2, size: "S",
    activity: [],
  },
];

export const KANBAN_COLUMNS: {
  id: KanbanStatus;
  label: string;
  description: string;
  dotColor: string;
  dotStyle: "solid" | "outline" | "half" | "check";
}[] = [
  { id: "backlog",     label: "Backlog",     description: "This item hasn't been started",   dotColor: "#22c55e", dotStyle: "solid"   },
  { id: "ready",       label: "Ready",       description: "This is ready to be picked up",   dotColor: "#3b82f6", dotStyle: "outline" },
  { id: "in-progress", label: "In progress", description: "This is actively being worked on", dotColor: "#f59e0b", dotStyle: "half"    },
  { id: "in-review",   label: "In review",   description: "This item is in review",           dotColor: "#a855f7", dotStyle: "outline" },
  { id: "done",        label: "Done",        description: "This has been completed",          dotColor: "#f97316", dotStyle: "check"   },
];
