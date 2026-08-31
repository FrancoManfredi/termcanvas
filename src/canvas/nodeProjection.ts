import type { Node } from "@xyflow/react";
import type { ProjectData } from "../types";
import type { IssueNodeData } from "../stores/issueStore";
import type { IssueVisibilityFilter } from "../stores/issueVisibilityStore";

export interface TerminalNodeData {
  terminalId: string;
  projectId: string;
  worktreeId: string;
  projectName: string;
  [key: string]: unknown;
}

export type CanvasFlowNode =
  | Node<TerminalNodeData, "terminal">
  | Node<IssueNodeData, "issue">;

export function buildCanvasFlowNodes(
  projects: ProjectData[],
  positionOverrides?: Map<string, { x: number; y: number }>,
): CanvasFlowNode[] {
  const nodes: CanvasFlowNode[] = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) continue;
        const position = positionOverrides?.get(terminal.id);
        nodes.push({
          id: terminal.id,
          type: "terminal",
          position: position
            ? { x: position.x, y: position.y }
            : { x: terminal.x, y: terminal.y },
          data: {
            terminalId: terminal.id,
            projectId: project.id,
            worktreeId: worktree.id,
            projectName: project.name,
          },
          style: {
            width: terminal.width,
            height: terminal.minimized ? undefined : terminal.height,
          },
          draggable: true,
          selectable: true,
        });
      }
    }
  }
  return nodes;
}

/**
 * Whether the issue passes the active visibility filter. Closed issues are
 * filtered out of the "open" filter; a missing state counts as open so a
 * card GitHub has not reported a state for stays visible.
 */
export function issueMatchesFilter(
  issue: Record<string, unknown>,
  filter: IssueVisibilityFilter,
): boolean {
  const state = String(issue.state ?? "").toUpperCase();
  if (filter === "closed") return state === "CLOSED";
  if (filter === "all") return true;
  return state !== "CLOSED";
}

export interface BuildCanvasFlowIssueNodesOptions {
  /**
   * Which issue states to project on the canvas. Defaults to "open" so
   * resolved work keeps off the canvas unless the user asks for it.
   */
  filter?: IssueVisibilityFilter;
}

export function buildCanvasFlowIssueNodes(
  issues: IssueNodeData[],
  opts?: BuildCanvasFlowIssueNodesOptions,
): Node<IssueNodeData, "issue">[] {
  const filter = opts?.filter ?? "open";
  return issues
    .filter((issue) => issueMatchesFilter(issue, filter))
    .map((issue) => ({
    id: `issue-${issue.issueNumber}`,
    type: "issue" as const,
    position: { x: issue.x, y: issue.y },
    data: issue,
    style: { width: 960 },
    draggable: true,
    selectable: true,
  }));
}
