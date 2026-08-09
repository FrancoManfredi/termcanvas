import type { TerminalData, TerminalOrigin, TerminalType } from "../types";
import {
  createTerminal as createProjectTerminal,
  destroyAllStashedTerminals as destroyAllProjectStashedTerminals,
  destroyStashedTerminal as destroyProjectStashedTerminal,
  stashTerminal as stashProjectTerminal,
  unstashTerminal as unstashProjectTerminal,
  useProjectStore,
} from "../stores/projectStore";
import { destroyTerminalRuntime } from "../terminal/terminalRuntimeStore";
import { useTerminalRuntimeStateStore } from "../stores/terminalRuntimeStateStore";
import { recordRenderDiagnostic } from "../terminal/renderDiagnostics";
import { pickPlacement } from "../canvas/terminalPlacement";
import { useCanvasStore } from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import { getVisibleCanvasWorldRect } from "../canvas/viewportBounds";

interface CreateTerminalInSceneOptions {
  projectId: string;
  worktreeId: string;
  terminal?: TerminalData;
  type?: TerminalType;
  title?: string;
  initialPrompt?: string;
  autoApprove?: boolean;
  origin?: TerminalOrigin;
  parentTerminalId?: string;
  position?: { x: number; y: number };
  issueNumber?: number;
  reviewIssueNumber?: number;
  reviewPrNumber?: number;
}

interface WorktreeGroupMovePreview {
  positions: Map<string, { x: number; y: number }>;
  worktreeOffset: { x: number; y: number };
}

function snapToGrid(value: number, grid = 10) {
  return Math.round(value / grid) * grid;
}

function collectWorktreeTerminals(projectId: string, worktreeId: string) {
  const project = useProjectStore
    .getState()
    .projects.find((candidate) => candidate.id === projectId);
  const worktree = project?.worktrees.find(
    (candidate) => candidate.id === worktreeId,
  );
  return worktree?.terminals.filter((terminal) => !terminal.stashed) ?? [];
}

export function addTerminalToScene(
  projectId: string,
  worktreeId: string,
  terminal: TerminalData,
): TerminalData {
  useProjectStore.getState().addTerminal(projectId, worktreeId, terminal);
  return terminal;
}

export function buildWorktreeGroupMove(
  projectId: string,
  worktreeId: string,
  deltaX: number,
  deltaY: number,
): WorktreeGroupMovePreview | null {
  const terminals = collectWorktreeTerminals(projectId, worktreeId);
  if (terminals.length === 0) {
    return null;
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const terminal of terminals) {
    positions.set(terminal.id, {
      x: terminal.x + deltaX,
      y: terminal.y + deltaY,
    });
  }

  return {
    positions,
    worktreeOffset: { x: deltaX, y: deltaY },
  };
}

export function commitWorktreeGroupMove(
  projectId: string,
  worktreeId: string,
  preview: WorktreeGroupMovePreview,
): void {
  const terminals = collectWorktreeTerminals(projectId, worktreeId);
  if (terminals.length === 0) {
    return;
  }

  const updates = terminals.map((terminal) => {
    const next = preview.positions.get(terminal.id);
    return {
      projectId,
      worktreeId,
      terminalId: terminal.id,
      x: snapToGrid(next?.x ?? terminal.x),
      y: snapToGrid(next?.y ?? terminal.y),
    };
  });

  useProjectStore.getState().updateTerminalPositions(updates);
}

export function createTerminalInScene({
  projectId,
  worktreeId,
  terminal,
  type = "shell",
  title,
  initialPrompt,
  autoApprove,
  origin = "user",
  parentTerminalId,
  position,
  issueNumber,
  reviewIssueNumber,
  reviewPrNumber,
}: CreateTerminalInSceneOptions): TerminalData {
  const baseTerminal =
    terminal ??
    createProjectTerminal(
      type,
      title,
      initialPrompt,
      autoApprove,
      origin,
      parentTerminalId,
    );

  // Compute placement if the caller did not specify explicit x/y on the
  // terminal record. The default createTerminal() returns x=0, y=0, so we
  // treat that as "needs auto placement".
  const projectStore = useProjectStore.getState();
  const canvasState = useCanvasStore.getState();
  const viewportRect =
    typeof window !== "undefined"
      ? getVisibleCanvasWorldRect(
          canvasState.viewport,
          canvasState.rightPanelCollapsed,
          canvasState.leftPanelCollapsed,
          canvasState.leftPanelWidth,
          canvasState.rightPanelWidth,
          usePinStore.getState().openProjectPath !== null,
        )
      : undefined;
  const placement = pickPlacement({
    projects: projectStore.projects,
    projectId,
    worktreeId,
    parentTerminalId,
    width: baseTerminal.width,
    height: baseTerminal.height,
    preferredPosition: position,
    viewportRect,
  });

  const placedTerminal: TerminalData = {
    ...baseTerminal,
    x: placement.x,
    y: placement.y,
    ...(issueNumber !== undefined ? { issueNumber } : {}),
    ...(reviewIssueNumber !== undefined ? { reviewIssueNumber } : {}),
    ...(reviewPrNumber !== undefined ? { reviewPrNumber } : {}),
  };

  // Apply collision-resolved nudges to existing tiles.
  for (const nudge of placement.nudged) {
    for (const project of projectStore.projects) {
      for (const worktree of project.worktrees) {
        if (worktree.terminals.some((t) => t.id === nudge.id)) {
          projectStore.updateTerminalPosition(
            project.id,
            worktree.id,
            nudge.id,
            nudge.x,
            nudge.y,
          );
        }
      }
    }
  }

  return addTerminalToScene(projectId, worktreeId, placedTerminal);
}

/**
 * Reuse an existing (dead or demoted) terminal tile for an issue session.
 *
 * Resets the tile back to an opencode terminal armed with the resume prompt,
 * kills any leftover shell PTY so the runtime re-spawns opencode on focus, and
 * focuses the tile.
 */
export async function reuseTerminalForIssue(input: {
  projectId: string;
  worktreeId: string;
  terminalId: string;
  resumePrompt: string;
}): Promise<void> {
  const store = useProjectStore.getState();

  // Recover the previous opencode session in this issue's worktree so the
  // respawned CLI resumes (`-s <id>`) instead of opening a fresh conversation.
  // When a CLI process exits the runtime demotes the tile and clears the
  // persisted sessionId, so we re-look it up from the opencode DB by cwd.
  const worktree = store.projects
    .find((project) => project.id === input.projectId)
    ?.worktrees.find((candidate) => candidate.id === input.worktreeId);
  if (worktree?.path && window.termcanvas?.session) {
    try {
      const found = await window.termcanvas.session.findOpenCode(worktree.path);
      if (found?.sessionId) {
        store.setTerminalSessionId(
          input.projectId,
          input.worktreeId,
          input.terminalId,
          found.sessionId,
        );
      }
    } catch (error) {
      console.error("[reuseTerminalForIssue] failed to resolve opencode session:", error);
    }
  }

  store.updateTerminalType(input.projectId, input.worktreeId, input.terminalId, "opencode");
  store.updateTerminalInitialPrompt(
    input.projectId,
    input.worktreeId,
    input.terminalId,
    input.resumePrompt,
  );
  destroyTerminalRuntime(input.terminalId, {
    caller: "reuseTerminalForIssue",
    reason: "resume_issue_session",
  });
  // Drop any stale runtime overlay (e.g. the `sessionId: undefined` written on
  // demotion) so the re-created runtime resolves the persisted sessionId.
  useTerminalRuntimeStateStore.getState().clearTerminal(input.terminalId);
  focusTerminalInScene(input.terminalId);
}

export function focusTerminalInScene(
  terminalId: string | null,
  options?: { focusComposer?: boolean; focusInput?: boolean },
): void {
  recordRenderDiagnostic({
    kind: "focus_terminal_in_scene",
    terminalId: terminalId ?? undefined,
    data: {
      focus_composer: options?.focusComposer ?? false,
      focus_input: options?.focusInput ?? false,
    },
  });
  useProjectStore.getState().setFocusedTerminal(terminalId, options);
}

export function closeTerminalInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  destroyTerminalRuntime(terminalId, {
    caller: "closeTerminalInScene",
    reason: "close_terminal",
  });
  useProjectStore.getState().removeTerminal(projectId, worktreeId, terminalId);
}

/**
 * ¿Sigue viva la terminal en la escena? Sirve para detectar que el usuario
 * cerró el tile mientras una sesión de agente corría en él.
 */
export function terminalExistsInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): boolean {
  return (
    useProjectStore
      .getState()
      .projects.find((p) => p.id === projectId)
      ?.worktrees.find((w) => w.id === worktreeId)
      ?.terminals.some((t) => t.id === terminalId) ?? false
  );
}

export function updateTerminalCustomTitleInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
  customTitle: string,
): void {
  useProjectStore
    .getState()
    .updateTerminalCustomTitle(projectId, worktreeId, terminalId, customTitle);
}

export function toggleTerminalStarredInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  useProjectStore
    .getState()
    .toggleTerminalStarred(projectId, worktreeId, terminalId);
}

export function toggleTerminalMinimizeInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  useProjectStore
    .getState()
    .toggleTerminalMinimize(projectId, worktreeId, terminalId);
}

export function stashTerminalInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  stashProjectTerminal(projectId, worktreeId, terminalId);
}

export function unstashTerminalInScene(terminalId: string): void {
  unstashProjectTerminal(terminalId);
}

export function destroyStashedTerminalInScene(terminalId: string): void {
  destroyProjectStashedTerminal(terminalId);
}

export function destroyAllStashedTerminalsInScene(): void {
  destroyAllProjectStashedTerminals();
}
