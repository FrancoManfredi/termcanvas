import type { TerminalType } from "../types";
import type { IssueNodeData } from "../stores/issueStore";
import { buildIssueBranchName } from "./issueWorktreeNaming";

interface ResolveTarget {
  projectId: string;
  worktreeId: string;
  worktree: { path: string };
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

interface ProjectForLookup {
  id: string;
  path: string;
  worktrees: { id: string; name?: string; path: string }[];
}

interface Terminal {
  id: string;
}

interface ResolveIssueWorktreeOptions {
  issue: IssueNodeData | undefined;
  target: ResolveTarget;
  createWorktree: CreateWorktreeFn;
  projectLookup: { projects: ProjectForLookup[] };
  syncWorktrees: (projectPath: string, worktrees: { path: string; branch: string; isPrimary: boolean }[]) => void;
  createTerminal: (opts: {
    projectId: string;
    worktreeId: string;
    type: TerminalType;
    title: string;
    initialPrompt: string;
    autoApprove: boolean;
    position: { x: number; y: number };
  }) => Terminal;
  notify: (type: "error" | "warn" | "info", message: string) => void;
  setResolveArrows?: React.Dispatch<React.SetStateAction<Array<{ issueId: string; terminalId: string }>>>;
  issueNodeId: string;
  position: { x: number; y: number };
  initialPrompt: string;
}

interface ResolveResult {
  ok: boolean;
  terminal?: Terminal;
  error?: string;
}

/**
 * Pure logic for resolving an issue into an isolated worktree terminal.
 * Extracted from XyFlowCanvas for testability.
 */
export async function resolveIssueWorktree(
  opts: ResolveIssueWorktreeOptions,
): Promise<ResolveResult> {
  const {
    issue,
    target,
    createWorktree,
    projectLookup,
    syncWorktrees,
    createTerminal,
    notify,
    setResolveArrows,
    issueNodeId,
    position,
    initialPrompt,
  } = opts;

  if (!issue) {
    return { ok: false, error: "Issue not found" };
  }

  try {
    const branchName = buildIssueBranchName(issue);

    const project = projectLookup.projects.find(
      (p) => p.id === target.projectId,
    );
    if (!project) {
      return { ok: false, error: "Project not found" };
    }

    const existingWorktree = project.worktrees.find(
      (w) => w.name === branchName,
    );

    let worktreeId: string;
    if (existingWorktree) {
      worktreeId = existingWorktree.id;
    } else {
      const result = await createWorktree(target.worktree.path, branchName);
      if (!result.ok) {
        notify("error", `Failed to create issue worktree: ${result.error}`);
        return { ok: false, error: result.error };
      }
      syncWorktrees(project.path, result.worktrees);
      const syncedProject = projectLookup.projects.find(
        (p) => p.id === target.projectId,
      );
      const newWorktree = syncedProject?.worktrees.find(
        (w) => w.path === result.path,
      );
      if (!newWorktree) {
        return { ok: false, error: "Worktree not found after sync" };
      }
      worktreeId = newWorktree.id;
    }

    const terminal = createTerminal({
      projectId: target.projectId,
      worktreeId,
      type: "opencode",
      title: `Issue #${issue.issueNumber}`,
      initialPrompt,
      autoApprove: true,
      position,
    });

    setResolveArrows?.((prev) => [
      ...prev,
      { issueId: issueNodeId, terminalId: terminal.id },
    ]);

    return { ok: true, terminal };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notify("error", `Failed to create issue worktree: ${message}`);
    return { ok: false, error: message };
  }
}
