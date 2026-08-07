import type { TerminalType } from "../types";
import type { IssueNodeData } from "../stores/issueStore";
import type { LinkedPr } from "../stores/issueReviewStore";
import { buildResolveConflictPrompt } from "./resolveConflictPrompt";

interface ProjectWorktreeForLookup {
  id: string;
  name?: string;
  path: string;
}

interface ProjectForLookup {
  id: string;
  path: string;
  worktrees: ProjectWorktreeForLookup[];
}

interface Terminal {
  id: string;
}

interface ResolveConflictWorktreeOptions {
  issue: IssueNodeData | undefined;
  projectId: string;
  pr: LinkedPr;
  // Live lookup, not a snapshot: the store replaces its state object on
  // every sync, so a captured array would never see a freshly created or
  // renamed worktree.
  getProject: (projectId: string) => ProjectForLookup | undefined;
  restoreWorktree: (
    repoPath: string,
    branch: string,
  ) => Promise<
    | {
        ok: true;
        path: string;
        worktrees: { path: string; branch: string; isPrimary: boolean }[];
      }
    | { ok: false; error: string }
  >;
  syncWorktrees: (
    projectPath: string,
    worktrees: { path: string; branch: string; isPrimary: boolean }[],
  ) => void;
  // Optional live delegation to the main process: runs a throwaway test-merge
  // against origin/main and returns the unmerged file list. When it reports
  // NO conflicts the branch is already clean — the runner skips the session
  // (the user clicked RESOLVER CONFLICTO while the conflict label was stale).
  // When it reports a list, those files are injected into the prompt so the
  // agent does not re-derive them with gh. On any failure the runner falls
  // back to the gh-based instruction (fails-open, like the review context).
  getConflict?: (
    repoPath: string,
    branch: string,
    prNumber: number,
  ) => Promise<
    | { ok: true; conflictFiles: string[] }
    | { ok: false; error: string }
  >;
  createTerminal: (opts: {
    projectId: string;
    worktreeId: string;
    type: TerminalType;
    title: string;
    initialPrompt: string;
    autoApprove: boolean;
    position: { x: number; y: number };
    issueNumber?: number;
  }) => Terminal;
  notify: (type: "error" | "warn" | "info", message: string) => void;
  setResolveArrows?: React.Dispatch<
    React.SetStateAction<Array<{ issueId: string; terminalId: string }>>
  >;
  issueNodeId: string;
  position: { x: number; y: number };
}

interface ResolveConflictResult {
  ok: boolean;
  skipped?: boolean;
  terminal?: Terminal;
  worktreeId?: string;
  error?: string;
}

/**
 * Launch a conflict-resolution session for a PR the mergeador flagged with
 * the "conflicto:main" label.
 *
 * Like the fix flow this does NOT create a fresh branch: the resolution must
 * land on a worktree whose branch owns the open PR — so the merge commit can
 * be pushed to that same PR. The implementer worktree is located by matching
 * its branch name against the PR's head ref; when the implementer worktree no
 * longer exists (deleted terminal, pruned checkout) it is re-created from the
 * existing branch via restoreWorktree, which re-attaches the PR's head ref
 * instead of creating a new branch.
 *
 * The terminal is opened with autoApprove ON so the resolution runs
 * unattended, mirroring the IMPLEMENTAR FIX codepath.
 */
export async function resolveConflictWorktree(
  opts: ResolveConflictWorktreeOptions,
): Promise<ResolveConflictResult> {
  const {
    issue,
    projectId,
    pr,
    getProject,
    restoreWorktree,
    syncWorktrees,
    getConflict,
    createTerminal,
    notify,
    setResolveArrows,
    issueNodeId,
    position,
  } = opts;

  const project = getProject(projectId);
  if (!project) {
    return { ok: false, error: "Project not found" };
  }

  if (!issue) {
    return { ok: false, error: "Issue not found" };
  }

  // WorktreeData.name === the git branch (projectStore.syncWorktrees maps
  // {path, branch, isPrimary} -> WorktreeData.name). The review worktree is
  // detached ("(detached)") so only the implementer worktree matches.
  let implementerWorktree = project.worktrees.find(
    (w) => w.name === pr.headRefName,
  );
  if (!implementerWorktree) {
    // The implementer worktree may have been deleted (terminal closed and
    // checkout pruned) while the PR stayed open. Restore it from the PR's
    // branch instead of failing: the merge commit needs a live checkout of
    // that exact branch to push back onto the same PR.
    const restore = await restoreWorktree(project.path, pr.headRefName);
    if (!restore.ok) {
      const message = `No worktree found for branch "${pr.headRefName}" (PR #${pr.number}) and it could not be restored: ${restore.error}.`;
      notify("error", message);
      return { ok: false, error: message };
    }
    syncWorktrees(project.path, restore.worktrees);
    const syncedProject = getProject(projectId);
    implementerWorktree = syncedProject?.worktrees.find(
      (w) => w.name === pr.headRefName,
    );
    if (!implementerWorktree) {
      const message = `Worktree restored for branch "${pr.headRefName}" (PR #${pr.number}) but not visible in the project yet — try again.`;
      notify("error", message);
      return { ok: false, error: message };
    }
    notify(
      "info",
      `Worktree restored for branch "${pr.headRefName}" (PR #${pr.number}) — starting conflict resolution.`,
    );
  }

  // Resolve the real conflict state BEFORE opening the session: the app runs
  // a throwaway test-merge (never touching the implementer worktree) and
  // returns the unmerged files. No files ⇒ the branch is already clean against
  // main and opening a resolution session would be busywork, so this gates on
  // that like the review runner gates on the reviewed commit id.
  let conflictFiles: string[] | undefined;
  if (getConflict) {
    const conflict = await getConflict(project.path, pr.headRefName, pr.number);
    if (conflict.ok) {
      if (conflict.conflictFiles.length === 0) {
        const message = `Rama "${pr.headRefName}" (PR #${pr.number}) ya integra limpio contra main: no hay conflictos que resolver.`;
        notify("info", message);
        return { ok: true, skipped: true, worktreeId: implementerWorktree.id };
      }
      conflictFiles = conflict.conflictFiles;
      notify(
        "info",
        `PR #${pr.number}: ${conflictFiles.length} archivo(s) en conflicto con main (${conflictFiles.join(", ")}).`,
      );
    } else {
      // Fails-open: the app could not test the merge, so the agent reads the
      // [mergeador] comment and derives the file list itself.
      notify(
        "warn",
        `No se pudieron detectar los conflictos del PR #${pr.number} (${conflict.error}). El agente los resolverá con la instrucción estándar.`,
      );
    }
  }

  const terminal = createTerminal({
    projectId,
    worktreeId: implementerWorktree.id,
    type: "opencode",
    title: `Resolve conflict PR #${pr.number} (issue #${issue.issueNumber})`,
    initialPrompt: buildResolveConflictPrompt({
      issueNumber: issue.issueNumber,
      title: issue.title,
      prNumber: pr.number,
      branch: pr.headRefName,
      conflictFiles,
    }),
    autoApprove: true,
    position,
    issueNumber: issue.issueNumber,
  });

  setResolveArrows?.((prev) =>
    prev.some((a) => a.terminalId === terminal.id)
      ? prev
      : [...prev, { issueId: issueNodeId, terminalId: terminal.id }],
  );

  return { ok: true, terminal, worktreeId: implementerWorktree.id };
}
