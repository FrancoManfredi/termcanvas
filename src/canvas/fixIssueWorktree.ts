import type { TerminalType } from "../types";
import type { IssueNodeData } from "../stores/issueStore";
import type { LinkedPr } from "../stores/issueReviewStore";
import { buildIssueFixPrompt } from "./issueFixPrompt";
import { resolveRepoContextText, resolveRequirementsText, resolveArchitectureDecisionsText } from "../utils/repoContext";

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

// Prefetch PR facts (headRefOid, last review, latest inline batch, diff file)
// so the agent gets them from the app instead of re-deriving them with gh.
type GetReviewContextFn = (
  cwd: string,
  prNumber: number,
  targetDir: string,
) => Promise<
  | { ok: true; context: string; diffFilePath: string | null }
  | { ok: false; error: string }
>;

interface FixIssueWorktreeOptions {
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
  getReviewContext?: GetReviewContextFn;
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

interface FixResult {
  ok: boolean;
  terminal?: Terminal;
  worktreeId?: string;
  error?: string;
}

/**
 * Launch a fix session for an issue whose PR was reviewed with requested
 * changes or inline comments.
 *
 * The fix must land on a worktree whose branch owns the open PR — so the
 * changes can be pushed to that same PR. The implementer worktree is located
 * by matching its branch name (`WorktreeData.name` is the branch, see
 * projectStore.syncWorktrees) against the PR's head ref; when the implementer
 * worktree no longer exists (deleted terminal, pruned checkout) it is
 * re-created from the existing branch via restoreWorktree, which re-attaches
 * the PR's head ref instead of creating a new branch.
 *
 * The terminal is opened with autoApprove ON so the fix runs unattended,
 * mirroring the RESOLVER ISSUE codepath. The caller flips the issue verdict
 * to FIX_APPLIED once the terminal exists, hiding the button until the next
 * review.
 */
export async function fixIssueWorktree(
  opts: FixIssueWorktreeOptions,
): Promise<FixResult> {
  const {
    issue,
    projectId,
    pr,
    getProject,
    restoreWorktree,
    syncWorktrees,
    getReviewContext,
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
    // branch instead of failing: the fix needs a live checkout of that exact
    // branch to push back onto the same PR.
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
      `Worktree restored for branch "${pr.headRefName}" (PR #${pr.number}) — starting the fix session.`,
    );
  }

  // Prefetch PR facts for the prompt when the IPC is wired (real app):
  // headRefOid, last review, latest inline batch, and a worktree-local diff
  // file. Optional by design — a snapshot failure must never block the fix
  // from starting; the prompt rules still let the agent fetch facts.
  let reviewContext: string | undefined;
  if (getReviewContext) {
    const snapshot = await getReviewContext(
      project.path,
      pr.number,
      implementerWorktree.path,
    );
    if (snapshot.ok && snapshot.context) {
      reviewContext = snapshot.context;
    } else {
      notify(
        "warn",
        `No se pudo precargar el contexto del PR #${pr.number} para el fix: ${
          snapshot.ok ? "contexto vacío" : snapshot.error
        }. El agente obtendrá los datos con gh.`,
      );
    }
  }

  const repoContextText = await resolveRepoContextText(project.path);
  const requirementsText = await resolveRequirementsText(project.path);
  const decisionsText = await resolveArchitectureDecisionsText(project.path);

  const terminal = createTerminal({
    projectId,
    worktreeId: implementerWorktree.id,
    type: "opencode",
    title: `Fix PR #${pr.number} (issue #${issue.issueNumber})`,
    initialPrompt: buildIssueFixPrompt({
      issueNumber: issue.issueNumber,
      title: issue.title,
      body: issue.body,
      prNumber: pr.number,
      branch: pr.headRefName,
      reviewContext,
      repoContextText,
      requirementsText,
      decisionsText,
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