import type { TerminalType } from "../types";
import type { IssueNodeData } from "../stores/issueStore";
import { buildIssueBranchName } from "./issueWorktreeNaming";

interface ResolveTarget {
  projectId: string;
  worktreeId: string;
  worktree: { path: string };
}

// git reports worktree paths with forward slashes even on Windows
// (C:/repo/.worktrees/x), while path.join produces backslashes
// (C:\repo\.worktrees\x). Normalize before comparing so the freshly
// created worktree is found by path regardless of the separator style.
function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, "/");
}

interface CreateWorktreeResult {
  ok: true;
  path: string;
  worktrees: { path: string; branch: string; isPrimary: boolean }[];
}

interface CreateWorktreeError {
  ok: false;
  error: string;
}

type CreateWorktreeFn = (
  repoPath: string,
  branch: string,
) => Promise<CreateWorktreeResult | CreateWorktreeError>;

interface ProjectWorktreeForLookup {
  id: string;
  name?: string;
  path: string;
  terminals?: {
    id: string;
    type?: TerminalType;
    title?: string;
    issueNumber?: number;
  }[];
}

interface ProjectForLookup {
  id: string;
  path: string;
  worktrees: ProjectWorktreeForLookup[];
}

interface Terminal {
  id: string;
}

type ResolveCase = "created" | "resumed" | "reused";

interface ResolveIssueWorktreeOptions {
  issue: IssueNodeData | undefined;
  target: ResolveTarget;
  createWorktree: CreateWorktreeFn;
  // Live lookup, not a snapshot: the store replaces its state object on
  // every sync, so a captured array would never see the freshly created
  // worktree and CASE C would fail with "Worktree not found after sync".
  getProject: (projectId: string) => ProjectForLookup | undefined;
  syncWorktrees: (projectPath: string, worktrees: { path: string; branch: string; isPrimary: boolean }[]) => void;
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
  setResolveArrows?: React.Dispatch<React.SetStateAction<Array<{ issueId: string; terminalId: string }>>>;
  issueNodeId: string;
  position: { x: number; y: number };
  initialPrompt: string;
  resumePrompt?: string;
  isIssueTerminalLive?: (terminalId: string) => boolean;
}

interface ResolveResult {
  ok: boolean;
  case?: ResolveCase;
  terminal?: Terminal;
  worktreeId?: string;
  reusedExisting?: boolean;
  error?: string;
}

/**
 * Find the terminal tied to an issue inside a worktree.
 *
 * Primary key: the `issueNumber` metadata written on resolve-created terminals.
 * Legacy fallback: title `Issue #N` on an opencode tile (pre-metadata sessions).
 */
function findIssueTerminal(
  worktree: ProjectWorktreeForLookup,
  issueNumber: number,
): { id: string; type?: TerminalType; title?: string } | undefined {
  return worktree.terminals?.find(
    (t) =>
      t.issueNumber === issueNumber ||
      (t.type === "opencode" && t.title === `Issue #${issueNumber}`),
  );
}

/**
 * Pure logic for resolving an issue into an isolated worktree terminal.
 * Extracted from XyFlowCanvas for testability.
 *
 * - CASE C (`created`): no worktree yet → create worktree + branch + terminal
 *   with the normal "new issue" prompt.
 * - CASE A (`resumed`): worktree exists but no live opencode session → reuse
 *   the existing (dead/demoted) tile when present, otherwise spawn a fresh
 *   terminal in the same worktree, always with the resume prompt.
 * - CASE B (`reused`): worktree exists AND a live opencode session is already
 *   open for the issue → do not create anything, just surface the existing
 *   terminal for focus.
 */
export async function resolveIssueWorktree(
  opts: ResolveIssueWorktreeOptions,
): Promise<ResolveResult> {
  const {
    issue,
    target,
    createWorktree,
    getProject,
    syncWorktrees,
    createTerminal,
    notify,
    setResolveArrows,
    issueNodeId,
    position,
    initialPrompt,
    resumePrompt,
    isIssueTerminalLive,
  } = opts;

  if (!issue) {
    return { ok: false, error: "Issue not found" };
  }

  try {
    const branchName = buildIssueBranchName(issue);

    const project = getProject(target.projectId);
    if (!project) {
      return { ok: false, error: "Project not found" };
    }

    const existingWorktree = project.worktrees.find(
      (w) => w.name === branchName,
    );

    let worktreeId: string;
    let terminal: Terminal;
    let resolvedCase: ResolveCase;
    let reusedExisting = false;

    if (existingWorktree) {
      worktreeId = existingWorktree.id;
      const candidate = findIssueTerminal(existingWorktree, issue.issueNumber);
      const candidateLive = candidate
        ? (isIssueTerminalLive?.(candidate.id) ?? false)
        : false;

      if (candidate && candidateLive && candidate.type === "opencode") {
        resolvedCase = "reused";
        terminal = { id: candidate.id };
        notify("info", "Ya hay una sesión activa para este issue");
      } else if (candidate) {
        resolvedCase = "resumed";
        reusedExisting = true;
        terminal = { id: candidate.id };
      } else {
        resolvedCase = "resumed";
        terminal = createTerminal({
          projectId: target.projectId,
          worktreeId,
          type: "opencode",
          title: `Issue #${issue.issueNumber}`,
          initialPrompt: resumePrompt ?? initialPrompt,
          autoApprove: true,
          position,
          issueNumber: issue.issueNumber,
        });
      }
    } else {
      const result = await createWorktree(target.worktree.path, branchName);
      if (!result.ok) {
        notify("error", `Failed to create issue worktree: ${result.error}`);
        return { ok: false, error: result.error };
      }
      syncWorktrees(project.path, result.worktrees);
      const syncedProject = getProject(target.projectId);
      const newWorktree = syncedProject?.worktrees.find(
        (w) => normalizePathForCompare(w.path) === normalizePathForCompare(result.path),
      );
      if (!newWorktree) {
        return { ok: false, error: "Worktree not found after sync" };
      }
      worktreeId = newWorktree.id;
      resolvedCase = "created";
      terminal = createTerminal({
        projectId: target.projectId,
        worktreeId,
        type: "opencode",
        title: `Issue #${issue.issueNumber}`,
        initialPrompt,
        autoApprove: true,
        position,
        issueNumber: issue.issueNumber,
      });
    }

    setResolveArrows?.((prev) =>
      prev.some((a) => a.terminalId === terminal.id)
        ? prev
        : [...prev, { issueId: issueNodeId, terminalId: terminal.id }],
    );

    return {
      ok: true,
      case: resolvedCase,
      terminal,
      worktreeId,
      reusedExisting,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify("error", `Failed to create issue worktree: ${message}`);
    return { ok: false, error: message };
  }
}
