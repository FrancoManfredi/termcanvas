import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type OnMove,
  type NodeMouseHandler,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  addProjectFromDirectoryPath,
  clearSceneFocusAndSelection,
  promptAndAddProjectToScene,
} from "./sceneCommands";
import { CanvasDragoverCue } from "./CanvasDragoverCue";
import { CanvasEmptyState } from "../components/CanvasEmptyState";
import { useCanvasDragOver } from "./useCanvasDragOver";
import { getStashedTerminalIds } from "./sceneState";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import { useDrawingStore } from "../stores/drawingStore";
import { useCanvasToolStore } from "../stores/canvasToolStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";
import { useSidebarDragStore } from "../stores/sidebarDragStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useIssueStore } from "../stores/issueStore";
import type { IssueNodeData } from "../stores/issueStore";
import { computeIssueGridPositions } from "./issueGridLayout";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_CSS,
} from "../utils/panelAnimation";
import { useT } from "../i18n/useT";
import { FamilyTreeOverlay } from "../components/FamilyTreeOverlay";
import { FocusCaretOverlay } from "../components/FocusCaretOverlay";
import { BoxSelectOverlay } from "./BoxSelectOverlay";
import { CanvasCardLayer } from "./CanvasCardLayer";
import { DrawingLayer } from "./DrawingLayer";
import { PetOverlay } from "../pet/PetOverlay";
import { useBoxSelect } from "../hooks/useBoxSelect";
import { useTrackpadSwipeFocus } from "./trackpadSwipeFocus";
import {
  publishTerminalGeometry,
  unpublishTerminalGeometry,
} from "../terminal/terminalGeometryRegistry";
import { resolveTerminalMountMode } from "../terminal/terminalRuntimePolicy";
import {
  destroyTerminalRuntime,
  setTerminalRuntimeMode,
  updateTerminalRuntime,
} from "../terminal/terminalRuntimeStore";
import { fromFlowViewport, toFlowViewport } from "./viewportAdapter";
import { buildCanvasFlowNodes, buildCanvasFlowIssueNodes } from "./nodeProjection";
import { xyflowNodeTypes, type CanvasFlowNode } from "./xyflowNodes";
import {
  getCanvasLeftInset,
  rectIntersectsCanvasViewport,
} from "./viewportBounds";
import { clampScale, zoomAtClientPoint } from "./viewportZoom";
import { resolveCollisions } from "./collisionResolver";
import { WorktreeLabelLayer } from "./WorktreeLabelLayer";
import { ClusterLinkLayer } from "./ClusterLinkLayer";
import { SpatialWaypointsLayer } from "./SpatialWaypointsLayer";
import { ContextMenu } from "../components/ContextMenu";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { createTerminalInScene } from "../actions/terminalSceneActions";
import type { TerminalType } from "../types";

const EMPTY_EDGES: never[] = [];
const WHEEL_ZOOM_SENSITIVITY = 0.005;
const SNAP_GRID: [number, number] = [10, 10];

function normalizeWheelDelta(event: React.WheelEvent): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return event.deltaY * 16;
    case WheelEvent.DOM_DELTA_PAGE:
      return event.deltaY * window.innerHeight;
    default:
      return event.deltaY;
  }
}

/**
 * Build a stable cache key for the terminal layout.
 * In the flat canvas model, each terminal's own position and size
 * determines the layout (no project/worktree container offsets).
 */
function buildLayoutKey(
  projects: ReturnType<typeof useProjectStore.getState>["projects"],
) {
  return projects
    .map((project) =>
      [
        project.id,
        project.worktrees
          .map((worktree) =>
            [
              worktree.id,
              worktree.terminals
                .map(
                  (t) =>
                    `${t.id}:${t.x},${t.y},${t.width}x${t.height}:${t.stashed ? 1 : 0}:${t.minimized ? 1 : 0}`,
                )
                .join(","),
            ].join(":"),
          )
          .join(";"),
      ].join("|"),
    )
    .join("||");
}

function TerminalRuntimeLayer({
  projects,
  viewport,
  rightPanelCollapsed,
  rightPanelWidth,
  leftPanelCollapsed,
  leftPanelWidth,
  taskDrawerOpen,
}: {
  projects: ReturnType<typeof useProjectStore.getState>["projects"];
  viewport: ReturnType<typeof useCanvasStore.getState>["viewport"];
  rightPanelCollapsed: boolean;
  rightPanelWidth: number;
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  taskDrawerOpen: boolean;
}) {
  const managedTerminalIdsRef = useRef<Set<string>>(new Set());
  const publishedTerminalIdsRef = useRef<Set<string>>(new Set());

  const runtimeMetas = useMemo(
    () =>
      projects.flatMap((project) =>
        project.worktrees.flatMap((worktree) =>
          worktree.terminals.map((terminal) => ({
            projectId: project.id,
            terminal,
            worktreeId: worktree.id,
            worktreePath: worktree.path,
          })),
        ),
      ),
    [projects],
  );

  // Flat terminal entries — no project/worktree offset calculation needed
  const terminalEntries = useMemo(
    () =>
      projects.flatMap((project) =>
        project.worktrees.flatMap((worktree) =>
          worktree.terminals
            .filter((t) => !t.stashed)
            .map((terminal) => ({
              absoluteRect: {
                x: terminal.x,
                y: terminal.y,
                w: terminal.width,
                h: terminal.height,
              },
              project,
              terminal,
              worktree,
            })),
        ),
      ),
    [projects],
  );

  useEffect(() => {
    const nextTerminalIds = new Set<string>();

    for (const meta of runtimeMetas) {
      nextTerminalIds.add(meta.terminal.id);
      updateTerminalRuntime(meta);
    }

    const stashedIds = getStashedTerminalIds(projects);
    for (const terminalId of managedTerminalIdsRef.current) {
      if (!nextTerminalIds.has(terminalId) && !stashedIds.has(terminalId)) {
        destroyTerminalRuntime(terminalId, {
          caller: "TerminalRuntimeLayer.runtimeMetasEffect",
          reason: "terminal_removed_from_runtime_metas",
        });
      }
    }

    managedTerminalIdsRef.current = nextTerminalIds;
  }, [runtimeMetas]);

  useEffect(() => {
    const nextTerminalIds = new Set<string>();

    for (const entry of terminalEntries) {
      nextTerminalIds.add(entry.terminal.id);
      publishTerminalGeometry({
        h: entry.absoluteRect.h,
        projectId: entry.project.id,
        terminalId: entry.terminal.id,
        worktreeId: entry.worktree.id,
        w: entry.absoluteRect.w,
        x: entry.absoluteRect.x,
        y: entry.absoluteRect.y,
      });
    }

    for (const terminalId of publishedTerminalIdsRef.current) {
      if (!nextTerminalIds.has(terminalId)) {
        unpublishTerminalGeometry(terminalId);
      }
    }

    publishedTerminalIdsRef.current = nextTerminalIds;
  }, [terminalEntries]);

  useEffect(() => {
    const visibleEntryIds = new Set(
      terminalEntries.map((entry) => entry.terminal.id),
    );

    for (const project of projects) {
      for (const worktree of project.worktrees) {
        for (const terminal of worktree.terminals) {
          if (!visibleEntryIds.has(terminal.id)) {
            setTerminalRuntimeMode(terminal.id, "parked", {
              caller: "TerminalRuntimeLayer.visibilityEffect",
              reason: "terminal_missing_from_visible_entries",
            });
          }
        }
      }
    }

    for (const entry of terminalEntries) {
      const visible = rectIntersectsCanvasViewport(
        entry.absoluteRect,
        viewport,
        rightPanelCollapsed,
        leftPanelCollapsed,
        leftPanelWidth,
        rightPanelWidth,
        taskDrawerOpen,
      );
      setTerminalRuntimeMode(
        entry.terminal.id,
        resolveTerminalMountMode({
          focused: entry.terminal.focused,
          visible,
        }),
        {
          caller: "TerminalRuntimeLayer.visibilityEffect",
          detail: {
            visible,
          },
          reason: "viewport_visibility_recomputed",
        },
      );
    }
  }, [
    leftPanelCollapsed,
    leftPanelWidth,
    projects,
    rightPanelCollapsed,
    rightPanelWidth,
    taskDrawerOpen,
    terminalEntries,
    viewport,
  ]);

  useEffect(
    () => () => {
      for (const terminalId of managedTerminalIdsRef.current) {
        destroyTerminalRuntime(terminalId, {
          caller: "TerminalRuntimeLayer.cleanup",
          reason: "terminal_runtime_layer_unmount",
        });
      }

      for (const terminalId of publishedTerminalIdsRef.current) {
        unpublishTerminalGeometry(terminalId);
      }
    },
    [],
  );

  return null;
}

function XyFlowCanvasInner() {
  const t = useT();
  const viewport = useCanvasStore((state) => state.viewport);
  const isAnimating = useCanvasStore((state) => state.isAnimating);
  const rightPanelCollapsed = useCanvasStore(
    (state) => state.rightPanelCollapsed,
  );
  const leftPanelCollapsed = useCanvasStore(
    (state) => state.leftPanelCollapsed,
  );
  const leftPanelWidth = useCanvasStore((state) => state.leftPanelWidth);
  const rightPanelWidth = useCanvasStore((state) => state.rightPanelWidth);
  const taskDrawerOpen = usePinStore(
    (state) => state.openProjectPath !== null,
  );
  const projects = useProjectStore((state) => state.projects);
  const issueVersion = useIssueStore((state) => state.issueVersion);
  const drawingEnabled = usePreferencesStore((state) => state.drawingEnabled);
  const petEnabled = usePreferencesStore((state) => state.petEnabled);
  const activityHeatmapEnabled = usePreferencesStore(
    (state) => state.activityHeatmapEnabled,
  );
  const animationBlur = usePreferencesStore((state) => state.animationBlur);
  const drawingTool = useDrawingStore((state) => state.tool);
  const canvasTool = useCanvasToolStore((state) => state.tool);
  const spaceHeld = useCanvasToolStore((state) => state.spaceHeld);
  const { handleMouseDown: handleBoxSelectMouseDown } = useBoxSelect();
  const layoutKey = useMemo(() => buildLayoutKey(projects), [projects]);
  const leftOffset = getCanvasLeftInset(
    leftPanelCollapsed,
    leftPanelWidth,
    taskDrawerOpen,
  );
  const sidebarDragging = useSidebarDragStore((s) => s.active);
  const isDrawing = drawingEnabled && drawingTool !== "select";
  const isPanMode = canvasTool === "hand" || spaceHeld;
  const [isPanning, setIsPanning] = useState(false);
  const previousAnimatingRef = useRef(isAnimating);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  useTrackpadSwipeFocus(canvasContainerRef);

  const reactFlow = useReactFlow();
  const [contextMenu, setContextMenu] = useState<{
    clientX: number;
    clientY: number;
    flowX: number;
    flowY: number;
  } | null>(null);

  const [ghErrorDialog, setGhErrorDialog] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const [isFetchingIssues, setIsFetchingIssues] = useState(false);

  const [issueContextMenu, setIssueContextMenu] = useState<{
    clientX: number;
    clientY: number;
    issueNumber: number;
  } | null>(null);

  const [resolveArrows, setResolveArrows] = useState<
    Array<{ issueId: string; terminalId: string }>
  >([]);

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      const flow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        flowX: flow.x,
        flowY: flow.y,
      });
    },
    [reactFlow],
  );

  const resolveContextMenuTarget = useCallback(() => {
    const {
      focusedProjectId,
      focusedWorktreeId,
      projects: currentProjects,
    } = useProjectStore.getState();
    let projectId = focusedProjectId;
    let worktreeId = focusedWorktreeId;
    if (!projectId || !worktreeId) {
      const fallbackProject = currentProjects[0];
      const fallbackWorktree = fallbackProject?.worktrees[0];
      if (!fallbackProject || !fallbackWorktree) {
        return null;
      }
      projectId = fallbackProject.id;
      worktreeId = fallbackWorktree.id;
    }
    const project = currentProjects.find((p) => p.id === projectId);
    const worktree = project?.worktrees.find((w) => w.id === worktreeId);
    if (!project || !worktree) return null;
    return { projectId, worktreeId, worktree };
  }, []);

  const handleContextMenuPick = useCallback(
    (type: TerminalType) => {
      if (!contextMenu) return;
      const target = resolveContextMenuTarget();
      if (!target) return;
      createTerminalInScene({
        projectId: target.projectId,
        worktreeId: target.worktreeId,
        type,
        position: { x: contextMenu.flowX, y: contextMenu.flowY },
      });
    },
    [contextMenu, resolveContextMenuTarget],
  );

  const handleIssueContextMenuPick = useCallback(async () => {
    if (!contextMenu) return;
    const target = resolveContextMenuTarget();
    if (!target) {
      console.warn("[gh-issues] resolveContextMenuTarget returned null");
      return;
    }

    console.log("[gh-issues] Fetching issues for worktree:", target.worktree.path);
    setIsFetchingIssues(true);
    try {
      const result = await window.termcanvas.github.fetchIssues(
        target.worktree.path,
      );

      console.log("[gh-issues] IPC result:", JSON.stringify({ ok: result.ok, count: result.ok ? result.issues.length : 0, code: result.ok ? undefined : (result as { code: string }).code }));

      if (!result.ok) {
        const notify = useNotificationStore.getState().notify;
        notify("error", `GitHub Issues: ${result.error}`);

        let dialogMessage = result.error;
        if (result.code === "not-installed") {
          dialogMessage =
            "The GitHub CLI (gh) is not installed.\n\nInstall it from: https://cli.github.com\n\nAfter installation, restart TermCanvas.";
        } else if (result.code === "not-authenticated") {
          dialogMessage =
            "The GitHub CLI is not authenticated.\n\nRun: gh auth login\n\nThen try again.";
        } else if (result.code === "network") {
          dialogMessage =
            "Network error while fetching issues.\n\nCheck your internet connection and try again.";
        }

        setGhErrorDialog({
          title: "GitHub Issues Error",
          message: dialogMessage,
        });
        return;
      }

      if (result.issues.length === 0) {
        useNotificationStore
          .getState()
          .notify("info", "No open issues found in this repository.");
        return;
      }

      const issueStore = useIssueStore.getState();
      let addedCount = 0;

      // Sort issues by number ascending (1, 2, 3...)
      const sorted = [...result.issues].sort((a, b) => (a.number as number) - (b.number as number));

      // Compute grid positions starting from the context menu click point
      const basePos = { x: contextMenu.flowX, y: contextMenu.flowY };

      for (let i = 0; i < sorted.length; i++) {
        const raw = sorted[i];
        const issueNum = raw.number as number;
        const issueId = `gh-${target.projectId}-${issueNum}`;

        if (issueStore.hasIssue(issueNum)) {
          // Refresh existing issue metadata from GitHub
          issueStore.updateIssue(issueNum, {
            ...raw,
            issueId,
            projectId: target.projectId,
            worktreeId: target.worktreeId,
            issueNumber: issueNum,
            __worktreePath: target.worktree.path,
          } as Partial<IssueNodeData>);
          addedCount++;
          continue;
        }

        const pos = computeIssueGridPositions(basePos, i);
        issueStore.addIssue({
          ...raw,
          issueId,
          projectId: target.projectId,
          worktreeId: target.worktreeId,
          issueNumber: issueNum,
          x: pos.x,
          y: pos.y,
          __worktreePath: target.worktree.path,
        } as unknown as IssueNodeData);
        addedCount++;
      }

      if (addedCount === 0) {
        useNotificationStore
          .getState()
          .notify("info", "Issues are up to date — no changes from GitHub.");
      } else {
        const newIssues = addedCount - (result.issues.length - addedCount > 0 ? 0 : 0);
        console.log(`[gh-issues] Synced ${addedCount} issues (new + refreshed)`);
        useNotificationStore
          .getState()
          .notify("info", `Synced ${addedCount} issue${addedCount !== 1 ? "s" : ""} from GitHub.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useNotificationStore
        .getState()
        .notify("error", `GitHub Issues: ${message}`);
    } finally {
      setIsFetchingIssues(false);
    }
  }, [contextMenu, resolveContextMenuTarget]);

  const projectedNodes = useMemo(() => {
    const terminalNodes = buildCanvasFlowNodes(projects);

    const issues = useIssueStore.getState().getAllIssues();
    console.log(`[projectedNodes] terminals=${terminalNodes.length}, issues=${issues.length}, issueVersion=${issueVersion}`);
    const issueNodes = issues.length > 0
      ? buildCanvasFlowIssueNodes(issues)
      : [];

    return [...issueNodes, ...terminalNodes];
  }, [layoutKey, issueVersion]);
  const [nodes, setNodes, onNodesChange] =
    useNodesState<CanvasFlowNode>(projectedNodes);

  useEffect(() => {
    setNodes((currentNodes) => {
      const existing = new Map(currentNodes.map((n) => [n.id, n]));
      return projectedNodes.map((pn) => {
        const cur = existing.get(pn.id);
        // Preserve user-dragged positions for existing nodes of the same type
        if (cur && cur.type === pn.type) {
          return { ...pn, position: cur.position };
        }
        return pn;
      });
    });
  }, [projectedNodes, setNodes]);

  useEffect(
    () => () => {
      useCanvasStore.getState().registerViewportAdapter(null);
    },
    [],
  );

  const handleInit = useCallback(
    (reactFlow: ReactFlowInstance<CanvasFlowNode>) => {
      useCanvasStore.getState().registerViewportAdapter({
        setViewport: (nextViewport, options) => {
          void reactFlow.setViewport(
            {
              x: nextViewport.x,
              y: nextViewport.y,
              zoom: nextViewport.scale,
            },
            options,
          );
        },
        getViewport: () => {
          const current = reactFlow.getViewport();
          return fromFlowViewport(current);
        },
      });
      useCanvasStore
        .getState()
        .syncViewportFromRenderer(fromFlowViewport(reactFlow.getViewport()));
    },
    [],
  );

  const handleMove = useCallback<OnMove>(
    (_event, nextViewport) => {
      const vp = fromFlowViewport(nextViewport);
      const snapped = {
        x: Math.round(vp.x),
        y: Math.round(vp.y),
        scale: vp.scale,
      };

      // Snap viewport translation to integer pixels during pan. When the
      // transform has fractional coordinates, 1px borders / background dots /
      // text edges render across sub-pixel boundaries and snap between pixel
      // grids frame-to-frame. This produces the "stutter" and eye-strain the
      // user describes as "low grid adhesion". Rounding forces the GPU
      // compositor to align to physical pixels, eliminating the jitter.
      if (snapped.x !== vp.x || snapped.y !== vp.y) {
        reactFlow.setViewport(
          { x: snapped.x, y: snapped.y, zoom: snapped.scale },
          { duration: 0 },
        );
      }

      useCanvasStore.getState().syncViewportFromRenderer(snapped);
    },
    [reactFlow],
  );

  const handleMoveEnd = useCallback<OnMove>((_event, nextViewport) => {
    const vp = fromFlowViewport(nextViewport);
    const snapped = {
      x: Math.round(vp.x),
      y: Math.round(vp.y),
      scale: vp.scale,
    };
    useCanvasStore.getState().commitViewportFromRenderer(snapped);
  }, []);

  const handlePaneClick = useCallback(() => {
    clearSceneFocusAndSelection();
  }, []);

  const handleNodeClick = useCallback<NodeMouseHandler<CanvasFlowNode>>(
    (_event, node) => {
      if (spaceHeld) return;

      // Issue nodes: handled by the card's own buttons, not here
      if (node.type === "issue") {
        return;
      }

      // Terminal nodes: focus worktree
      if (node.type === "terminal") {
        const { projectId, worktreeId } = node.data;
        useProjectStore.getState().setFocusedWorktree(projectId, worktreeId);
      }
    },
    [spaceHeld],
  );

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: CanvasFlowNode) => {
      event.preventDefault();
      if (node.type !== "issue") return;
      setIssueContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        issueNumber: (node.data as Record<string, unknown>).number as number,
      });
    },
    [],
  );

  const handleNodeDragStart = useCallback<OnNodeDrag<CanvasFlowNode>>(() => {
    // No-op in flat canvas — no bringToFront needed
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag<CanvasFlowNode>>(
    (_event, node) => {
      // Issue nodes: no store update needed (positions are ephemeral per session)
      if (node.type === "issue") {
        return;
      }

      // Terminal nodes: write position back to store
      if (node.type !== "terminal") return;
      const { projectId, worktreeId, terminalId } = node.data;
      const snappedX =
        Math.round(node.position.x / SNAP_GRID[0]) * SNAP_GRID[0];
      const snappedY =
        Math.round(node.position.y / SNAP_GRID[1]) * SNAP_GRID[1];
      useProjectStore
        .getState()
        .updateTerminalPosition(
          projectId,
          worktreeId,
          terminalId,
          snappedX,
          snappedY,
        );

      // Resolve collisions after drag
      const allProjects = useProjectStore.getState().projects;
      const allRects = allProjects.flatMap((p) =>
        p.worktrees.flatMap((w) =>
          w.terminals
            .filter((t) => !t.stashed)
            .map((t) => ({
              id: t.id,
              x: t.id === terminalId ? snappedX : t.x,
              y: t.id === terminalId ? snappedY : t.y,
              width: t.width,
              height: t.height,
            })),
        ),
      );
      const resolved = resolveCollisions(allRects, 8, terminalId);
      const updatePos = useProjectStore.getState().updateTerminalPosition;
      for (const rect of resolved) {
        if (rect.id === terminalId) continue;
        const original = allRects.find((r) => r.id === rect.id);
        if (original && (original.x !== rect.x || original.y !== rect.y)) {
          for (const p of allProjects) {
            for (const w of p.worktrees) {
              if (w.terminals.some((t) => t.id === rect.id)) {
                updatePos(p.id, w.id, rect.id, rect.x, rect.y);
              }
            }
          }
        }
      }
    },
    [],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) {
        return;
      }

      const file = files[0];
      const dirPath = window.termcanvas.fs.getFilePath(file);
      if (!dirPath) {
        return;
      }

      await addProjectFromDirectoryPath(dirPath, t);
    },
    [t],
  );

  const { state: dragOverState, handlers: dragOverHandlers } =
    useCanvasDragOver({ onDrop: handleDrop });

  const handleAddProject = useCallback(async () => {
    await promptAndAddProjectToScene(t);
  }, [t]);

  const handleWheelCapture = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const isPinch = event.ctrlKey || event.metaKey;

      // Pinch (Cmd/Ctrl + wheel, or trackpad pinch which Chromium
      // synthesises as ctrlKey=true): always zoom canvas, regardless of
      // cursor position. Terminal has no zoom concept.
      if (isPinch) {
        event.preventDefault();
        event.stopPropagation();

        const delta = normalizeWheelDelta(event);
        if (Math.abs(delta) < 0.001) {
          return;
        }

        const scaleFactor = Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY);
        const nextViewport = zoomAtClientPoint({
          clientX: event.clientX,
          clientY: event.clientY,
          leftPanelCollapsed,
          leftPanelWidth,
          taskDrawerOpen,
          nextScale: clampScale(viewport.scale * scaleFactor),
          viewport,
        });

        useCanvasStore.getState().setViewport(nextViewport);
        return;
      }

      // Non-pinch wheel: this handler now owns ALL canvas pan, since
      // React Flow's panOnScroll is disabled. The single exception is
      // when the cursor is over any terminal descendant — focused or
      // unfocused, xterm or wterm. In that case the event is allowed
      // to bubble to the terminal engine for scrollback; the canvas
      // does not pan.
      const target = event.target;

      // XXX: debug — log EVERY wheel event unconditionally so we can
      // diagnose why terminals don't receive scroll. Remove after fix
      // is confirmed. Use window.__TC_DEBUG_WHEEL__ = 1 to mute after
      // initial diagnosis (set to 0 or delete to re-enable).
      const DEBUG_MUTED = (window as any).__TC_DEBUG_WHEEL__ === 1;
      if (!DEBUG_MUTED) {
        const targetTag = target instanceof Element ? target.tagName : String(target);
        const targetClass = target instanceof Element ? (target as Element).className : "";
        const hitHandoff = target instanceof Element ? target.closest("[data-handoff-terminal-id]") !== null : false;
        const hitRfNode = target instanceof Element ? target.closest(".react-flow__node-terminal") !== null : false;
        const hitWterm = target instanceof Element ? target.closest(".tc-wterm-host") !== null : false;
        const hitXterm = target instanceof Element ? target.closest(".tc-xterm-host") !== null : false;
        console.log(
          "%c[tc:wheel]%c target=%c%s.%s%c | rf-node=%s | handoff=%s | xterm=%s | wterm=%s",
          "color:#58a6ff;font-weight:bold", "",
          "color:#f0c040", targetTag, targetClass, "",
          hitRfNode, hitHandoff, hitXterm, hitWterm,
        );
      }

      if (target instanceof Element) {
        const isTerminalNode =
          target.closest("[data-handoff-terminal-id]") !== null ||
          target.closest(".react-flow__node-terminal") !== null ||
          target.closest(".tc-wterm-host") !== null ||
          target.closest(".tc-xterm-host") !== null;
        if (isTerminalNode) {
          if (!DEBUG_MUTED) console.log("%c[tc:wheel]%c → PASSTHROUGH to terminal", "color:#58a6ff;font-weight:bold", "");
          return;
        }
      }

      if (!DEBUG_MUTED) console.log("%c[tc:wheel]%c → canvas pan (dx=%s, dy=%s)", "color:#58a6ff;font-weight:bold", "", event.deltaX.toFixed(1), event.deltaY.toFixed(1));

      event.preventDefault();
      event.stopPropagation();

      // Read viewport fresh from the store, not from the closure.
      // Wheel events fire 60+/s; closure-captured viewport stays stale
      // until React re-renders, so multiple in-flight events would all
      // base off the same old position and overwrite each other.
      const current = useCanvasStore.getState().viewport;
      // 0.5 matches React Flow's panOnScrollSpeed default. Keeps the
      // pan speed consistent with what users were used to before this
      // change, and is what handleMove's snap was tuned for.
      const PAN_SPEED = 0.5;
      useCanvasStore.getState().setViewport({
        ...current,
        x: Math.round(current.x - event.deltaX * PAN_SPEED),
        y: Math.round(current.y - event.deltaY * PAN_SPEED),
      });
    },
    [leftPanelCollapsed, leftPanelWidth, taskDrawerOpen, viewport],
  );

  const handleContainerMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isPanMode && event.button === 0) {
        setIsPanning(true);
      }
      handleBoxSelectMouseDown(event);
    },
    [handleBoxSelectMouseDown, isPanMode],
  );

  useEffect(() => {
    if (!isPanning) return;
    const stop = () => setIsPanning(false);
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, [isPanning]);

  // XXX: debug — native DOM wheel listener on the outer canvas
  // container. This runs independently of React's synthetic events
  // and confirms whether native wheel events reach this div at all.
  // Remove after the terminal scroll fix is confirmed.
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    let nativeCount = 0;
    const onNativeWheel = (e: WheelEvent) => {
      nativeCount++;
      // Log first 5 events, then every 50th
      if (nativeCount <= 5 || nativeCount % 50 === 0) {
        console.log(
          "%c[tc:wheel:native]%c #%d phase=%s target=%s.%s | dx=%s dy=%s ctrl=%s",
          "color:#ff6b6b;font-weight:bold", "",
          nativeCount,
          e.eventPhase === 1 ? "CAPTURE" : e.eventPhase === 2 ? "TARGET" : "BUBBLE",
          (e.target as Element).tagName ?? "?",
          (e.target as Element).className ?? "",
          e.deltaX.toFixed(1), e.deltaY.toFixed(1),
          e.ctrlKey || e.metaKey,
        );
      }
      if (nativeCount === 5) {
        console.log(
          "%c[tc:wheel:native]%c suppressing further per-event logs (logging every 50th)",
          "color:#ff6b6b;font-weight:bold", "",
        );
      }
    };
    el.addEventListener("wheel", onNativeWheel, true); // capture phase
    return () => el.removeEventListener("wheel", onNativeWheel, true);
  }, []);

  // isPanning takes precedence over isPanMode for the cursor: if the
  // user holds Space, presses the mouse, then releases Space before
  // mouseup, the gesture is still in flight and the cursor must keep
  // saying "grabbing". Without this, the cursor snaps back to default
  // mid-drag.
  const cursorClass = isDrawing
    ? "cursor-crosshair"
    : isPanning
      ? "cursor-grabbing"
      : isPanMode
        ? "cursor-grab"
        : "";

  // Cursors set on the outer div lose to the `cursor: text !important`
  // rule that .tc-xterm-host / .xterm enforces inside terminal tiles.
  // Toggle body classes that the matching CSS overrides target so the
  // pan cursor wins everywhere on the canvas, not just over empty
  // pane.
  useEffect(() => {
    const body = document.body;
    body.classList.toggle("tc-canvas-pan-mode", isPanMode || isPanning);
    body.classList.toggle("tc-canvas-pan-grabbing", isPanning);
    return () => {
      body.classList.remove("tc-canvas-pan-mode");
      body.classList.remove("tc-canvas-pan-grabbing");
    };
  }, [isPanMode, isPanning]);

  return (
    <div
      ref={canvasContainerRef}
      className={`fixed top-0 right-0 bottom-0 overflow-hidden canvas-bg ${cursorClass}`}
      data-activity-heatmap={activityHeatmapEnabled ? "true" : undefined}
      style={{
        left: leftOffset,
        transition: sidebarDragging
          ? undefined
          : `left ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}`,
      }}
      onMouseDownCapture={handleContainerMouseDown}
      onWheelCapture={handleWheelCapture}
      onDragEnter={dragOverHandlers.onDragEnter}
      onDragOver={dragOverHandlers.onDragOver}
      onDragLeave={dragOverHandlers.onDragLeave}
      onDrop={dragOverHandlers.onDrop}
    >
      <TerminalRuntimeLayer
        projects={projects}
        viewport={viewport}
        rightPanelCollapsed={rightPanelCollapsed}
        rightPanelWidth={rightPanelWidth}
        leftPanelCollapsed={leftPanelCollapsed}
        leftPanelWidth={leftPanelWidth}
        taskDrawerOpen={taskDrawerOpen}
      />
      <ReactFlow
        className="tc-xyflow"
        style={{
          willChange: isAnimating ? "transform" : undefined,
          filter:
            animationBlur > 0 && isAnimating
              ? `blur(${animationBlur}px)`
              : "none",
          transition: animationBlur > 0 ? "filter 0.15s ease" : "none",
        }}
        defaultViewport={toFlowViewport(viewport)}
        nodes={nodes}
        edges={EMPTY_EDGES}
        nodeTypes={xyflowNodeTypes}
        onInit={handleInit}
        onNodesChange={onNodesChange}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        nodesConnectable={false}
        nodesDraggable={!isPanMode}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        // In Hand mode (or Space-held), left+middle both pan. In Move
        // mode, only middle-button pans — the left button is reserved
        // for marquee on empty canvas (handled by useBoxSelect) and
        // node drag (handled by React Flow's nodesDraggable).
        panOnDrag={isPanMode ? [0, 1] : [1]}
        snapToGrid
        snapGrid={SNAP_GRID}
        zoomOnScroll={false}
        zoomOnPinch={false}
        minZoom={0.1}
        maxZoom={2}
        // Runtime park/live policy already downshifts offscreen terminals to
        // preview mode. Letting React Flow also cull offscreen nodes causes
        // TerminalTile remount churn during viewport animation and focus
        // cycling, which in turn destabilizes xterm/WebGL lifecycle.
        preventScrolling
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={2} color="var(--border)" />
      </ReactFlow>

      {resolveArrows.length > 0 && (
        <svg
          className="pointer-events-none"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 30,
          }}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="resolve-arrowhead"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#58a6ff" />
            </marker>
          </defs>
          {resolveArrows.map((arrow) => {
            const issueEl = document.querySelector(`[data-id="${arrow.issueId}"]`);
            const termEl = document.querySelector(`[data-id="${arrow.terminalId}"]`);
            if (!issueEl || !termEl) return null;
            const ir = issueEl.getBoundingClientRect();
            const tr = termEl.getBoundingClientRect();
            // Arrow from bottom-center of issue to top-center of terminal (screen-space)
            const x1 = ir.left + ir.width / 2;
            const y1 = ir.bottom;
            const x2 = tr.left + tr.width / 2;
            const y2 = tr.top;
            return (
              <line
                key={`${arrow.issueId}-${arrow.terminalId}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#58a6ff"
                strokeWidth="2"
                strokeDasharray="6 3"
                markerEnd="url(#resolve-arrowhead)"
              />
            );
          })}
        </svg>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.clientX}
          y={contextMenu.clientY}
          items={[
            {
              label: t.canvas_empty_action,
              onClick: () => {
                void handleAddProject();
              },
            },
            { type: "separator" },
            ...(resolveContextMenuTarget()
              ? [
                  {
                    label: isFetchingIssues
                      ? "Cargando issues..."
                      : "Traer issues de GitHub",
                    onClick: () => {
                      void handleIssueContextMenuPick();
                    },
                  } as const,
                ]
              : []),
            {
              label: "New Shell",
              onClick: () => handleContextMenuPick("shell"),
            },
            {
              label: "New Claude",
              onClick: () => handleContextMenuPick("claude"),
            },
            {
              label: "New Codex",
              onClick: () => handleContextMenuPick("codex"),
            },
            {
              label: "New Gemini",
              onClick: () => handleContextMenuPick("gemini"),
            },
            {
              label: "New Lazygit",
              onClick: () => handleContextMenuPick("lazygit"),
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      {issueContextMenu && (
        <ContextMenu
          x={issueContextMenu.clientX}
          y={issueContextMenu.clientY}
          items={[
            {
              label: "RESOLVER ISSUE",
              onClick: () => {
                const target = resolveContextMenuTarget();
                if (!target) return;
                const issueStore = useIssueStore.getState();
                const issue = issueStore.getIssue(issueContextMenu.issueNumber);
                if (!issue) return;
                // Measure the actual issue card DOM rect and convert to flow coords
                const issueNodeId = `issue-${issue.issueNumber}`;
                const issueEl = document.querySelector(`[data-id="${issueNodeId}"]`);
                const rect = issueEl?.getBoundingClientRect();
                if (!rect) return;
                // Bottom-center of the card in screen-space → convert to flow-space
                const screenCenter = { x: rect.left + rect.width / 2, y: rect.bottom + 12 };
                let flowCenter = reactFlow.screenToFlowPosition(screenCenter);
                // Center the terminal: subtract half terminal width in FLOW units
                const stored = usePreferencesStore.getState().defaultTerminalSize;
                const tileW = stored?.w ?? useTileDimensionsStore.getState().w;
                flowCenter = { x: flowCenter.x - tileW / 2, y: flowCenter.y };
                const terminal = createTerminalInScene({
                  projectId: target.projectId,
                  worktreeId: target.worktreeId,
                  type: "opencode",
                  title: `Issue #${issue.issueNumber}`,
                  initialPrompt: `Resolvé el issue #${issue.issueNumber} — ${issue.title} — usando SDD con el pipeline completo y estricto. | PRECONDICIONES (ya definidas, no preguntes): Ejecución auto, gatekeeper entre fases, no pausar salvo problema real. Artefactos: openspec y engram, ambos. PRs: auto-chain. Presupuesto de review: 800 líneas. PRs encadenados: stacked-to-main. | ALCANCE: el issue aprobado es el contrato, no agregues requisitos fuera de su scope, no inventes features, no te saltes no-goals. | BODY ORIGINAL DEL ISSUE: ${(issue.body ?? "").replace(/\n/g, " ")} | PIPELINE (todas las fases en orden, sin omitir ninguna, sin pausar entre fases): sdd-new (explore + propose) -> spec -> design -> tasks -> apply -> verify -> archive. | RESTRICCIONES: work-unit commits con conventional commits (type(scope): desc), shellcheck en todo script modificado, sin Co-Authored-By ni atribuciones AI, actualizar docs si cambia el comportamiento. | LOGGING PARA DEBUG MANUAL: Como el usuario va a probar manualmente el resultado antes de que se archive el cambio, agregá logging generoso y descriptivo en el código que toques — no solo para vos, para que un humano pueda ver en la consola exactamente qué está pasando paso a paso al usar la feature/fix en vivo: logueá con un prefijo identificable, ej: [fix-<nombre-del-change>] o [feature-<nombre>], para poder filtrarlos fácil en devtools. Logueá en los puntos de decisión clave (ej: "¿se detectó el target correcto?", "¿el evento se está bloqueando o dejando pasar?"), no solo al principio/final de una función. Si el fix depende de una condición (ej: un selector de DOM, un estado de store), logueá el valor real evaluado en cada intento, no solo "true/false" — mostrá el dato concreto que se comparó. Estos logs pueden quedar en el código final (no los borres antes de archivar) — el usuario los va a usar para reportar bugs con evidencia concreta en vez de descripciones vagas. Si en el futuro se decide sacarlos, será un cambio aparte. | GESTIÓN DEL ISSUE: NO cierres el issue manualmente, el cierre ocurre automático al mergear el PR vía "Closes #${issue.issueNumber}". Podés comentar avances con gh issue comment, no es obligatorio. No modifiques relaciones blocked-by/blocking/parent sin comentarlo primero. | ENTREGA FINAL: después de verify creá el PR con la skill branch-pr, branch type/descripcion, body con "Closes #${issue.issueNumber}", un solo label type:*, esperar checks automatizados. | AL TERMINAR RESUMÍ: 1) qué se implementó por fase, 2) evidencia de verify, 3) URL del PR.`,
                  autoApprove: true,
                  position: flowCenter,
                });
                setResolveArrows((prev) => [
                  ...prev,
                  { issueId: issueNodeId, terminalId: terminal.id },
                ]);
              },
            },
          ]}
          onClose={() => setIssueContextMenu(null)}
        />
      )}

      {ghErrorDialog && (
        <ConfirmDialog
          open
          title={ghErrorDialog.title}
          body={ghErrorDialog.message}
          confirmLabel="OK"
          onConfirm={() => setGhErrorDialog(null)}
          onCancel={() => setGhErrorDialog(null)}
        />
      )}

      <ClusterLinkLayer />

      <BoxSelectOverlay />
      <CanvasCardLayer />
      {drawingEnabled && <DrawingLayer />}
      {petEnabled && <PetOverlay />}

      <WorktreeLabelLayer />

      <SpatialWaypointsLayer />

      <FamilyTreeOverlay />

      <CanvasDragoverCue
        active={dragOverState.isDragOver}
        showChip={
          dragOverState.isDragOver &&
          dragOverState.isFolderDrop &&
          projects.length > 0
        }
      />

      {projects.length === 0 && (
        <CanvasEmptyState isDragOver={dragOverState.isDragOver} />
      )}
    </div>
  );
}

export function XyFlowCanvas() {
  return (
    <ReactFlowProvider>
      <XyFlowCanvasInner />
      <FocusCaretOverlay />
    </ReactFlowProvider>
  );
}
