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
import { resolveIssueWorktree } from "./resolveIssueWorktree";
import { reviewIssueWorktree } from "./reviewIssueWorktree";
import { fixIssueWorktree } from "./fixIssueWorktree";
import { resolveConflictWorktree } from "./resolveConflictWorktree";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_CONFLICT,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_GATE_FAIL,
  REVIEW_LABEL_PENDING,
  canonicalReviewLabel,
  effectiveReviewLabel,
} from "./reviewVerdict";
import { overrideGateForIssue } from "./issueGate";
import { buildIssueResolvePrompt } from "./issueResolvePrompt";
import { resolveRepoContextText, resolveRequirementsText } from "../utils/repoContext";
import { reuseTerminalForIssue } from "../actions/terminalSceneActions";
import { useTerminalRuntimeStateStore } from "../stores/terminalRuntimeStateStore";
import { useIssueStore, type IssueNodeData } from "../stores/issueStore";
import { useIssueVisibilityStore } from "../stores/issueVisibilityStore";
import { useIssueResolveStore } from "../stores/issueResolveStore";
import { useIssueActivityStore } from "../stores/issueActivityStore";
import {
  applyMergeProgressEvent,
  pickLinkedPrFromIssueData,
  useIssueReviewStore,
} from "../stores/issueReviewStore";
import { MergeProgressPanel } from "../components/MergeProgressPanel";
import { useIssueSyncStore } from "../stores/issueSyncStore";
import { computeIssueGridPositions, packIssuePositions } from "./issueGridLayout";
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
  hasLiveReviewOnWorktree,
  setTerminalRuntimeMode,
  updateTerminalRuntime,
} from "../terminal/terminalRuntimeStore";
import { fromFlowViewport, toFlowViewport } from "./viewportAdapter";
import { buildCanvasFlowNodes, buildCanvasFlowIssueNodes, issueMatchesFilter } from "./nodeProjection";
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
  const issueVisibilityFilter = useIssueVisibilityStore((state) => state.filter);
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

  const isFetchingIssues = useIssueSyncStore((s) => s.isFetchingIssues);
  const resolvingIssueNumber = useIssueResolveStore(
    (s) => s.resolvingIssueNumber,
  );
  const isResolving = resolvingIssueNumber !== null;

  const [issueContextMenu, setIssueContextMenu] = useState<{
    clientX: number;
    clientY: number;
    issueNumber: number;
  } | null>(null);

  // Per-issue linked PR cache lives in the review store so the IssueNode
  // footer button and the context menu share the same lookup state:
  // "loading" while the async lookup runs, null when the issue has no
  // linked PR, otherwise the PR record itself.
  const issuePrs = useIssueReviewStore((s) => s.prsByIssue);
  const issueVerdicts = useIssueReviewStore((s) => s.verdictByIssue);
  const issueLabels = useIssueReviewStore((s) => s.labelsByIssue);
  const issueConflicts = useIssueReviewStore((s) => s.conflictByIssue);
  // Multi-PR maps: the full open-PR list and per-PR verdict/label/conflict
  // state so the context menu can act on each PR of the issue separately.
  const issueOpenPrs = useIssueReviewStore((s) => s.openPrsByIssue);
  const issueVerdictsByPr = useIssueReviewStore((s) => s.verdictByPr);
  const issueLabelsByPr = useIssueReviewStore((s) => s.labelsByPr);
  const issueConflictsByPr = useIssueReviewStore((s) => s.conflictByPr);
  const reviewingIssueNumber = useIssueReviewStore(
    (s) => s.reviewingIssueNumber,
  );
  const isReviewing = reviewingIssueNumber !== null;
  const fixingIssueNumber = useIssueReviewStore(
    (s) => s.fixingIssueNumber,
  );
  const mergingIssueNumber = useIssueReviewStore(
    (s) => s.mergingIssueNumber,
  );
  const mergingApprovedPrs = useIssueReviewStore(
    (s) => s.mergingApprovedPrs,
  );
  const resolvingConflictIssueNumber = useIssueReviewStore(
    (s) => s.resolvingConflictIssueNumber,
  );

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

  // Look up the linked PRs for an issue so the REVISAR SOLUCIÓN action can be
  // disabled whenever there is no solution to review yet. Results are cached
  // per issue for the session; a projectPath is used when the caller knows
  // the issue's own repo (card footer button), otherwise falls back to the
  // focused worktree (context menu). Multi-PR: every open PR is recorded in
  // openPrsByIssue and each one gets its own verdict/labels/conflict state so
  // the context menu can act on the RIGHT PR.
  const checkLinkedPr = useCallback(
    (issueNumber: number, projectPath?: string, force?: boolean) => {
      const reviewStore = useIssueReviewStore.getState();
      // A null result is re-checked, not cached forever: the PR may be created
      // after the first lookup and the button must enable on the next refresh.
      // force=true re-reads even a settled PR — reviews/labels may have
      // changed since the first lookup (a fresh review must override the
      // card's frozen state), so state-changing flows refresh explicitly.
      const cached = reviewStore.prsByIssue[issueNumber];
      if (!force && cached !== undefined && cached !== null) return;
      const path =
        projectPath ?? resolveContextMenuTarget()?.worktree.path;
      if (!path) return;
      reviewStore.setPrStatus(issueNumber, "loading");
      void window.termcanvas.github
        .findOpenPrsForIssue(path, issueNumber)
        .then((result) => {
          const prs = result.ok ? result.prs : [];
          // The card's primary PR stays the first open one (legacy contract
          // for the footer button and per-issue badges); the full list lives
          // in openPrsByIssue for per-PR actions.
          useIssueReviewStore
            .getState()
            .setPrStatus(issueNumber, prs[0] ?? null);
          useIssueReviewStore.getState().setOpenPrs(issueNumber, prs);
          if (!result.ok || prs.length === 0) return;
          for (const pr of prs) {
            // Narrowed copy: TS does not propagate param narrowing into
            // nested closures, and applyReviewLabel needs the PR number.
            const prNumber = pr.number;
            const prState = pr.state;
            void window.termcanvas.github
              .getPrReviewDecision(path, prNumber)
              .then((decisionResult) => {
                if (!decisionResult.ok) return;
                // Per-PR state — each reviewed PR keeps its own verdict and
                // labels so the menu can fix/merge the exact PR that asked.
                const store = useIssueReviewStore.getState();
                store.setPrVerdict(issueNumber, prNumber, decisionResult.reviewDecision);
                store.setPrLabels(issueNumber, prNumber, decisionResult.labels);
                store.setPrConflict(
                  issueNumber,
                  prNumber,
                  decisionResult.labels.includes("conflicto:main"),
                );
                // Mirror the primary PR onto the legacy per-issue maps so the
                // card badge and existing gates keep working unchanged.
                if (prNumber === prs[0]?.number) {
                  store.setReviewVerdict(issueNumber, decisionResult.reviewDecision);
                  store.setIssueLabels(issueNumber, decisionResult.labels);
                  store.setConflictStatus(
                    issueNumber,
                    decisionResult.labels.includes("conflicto:main"),
                  );
                }
                // The "conflicto:main" label is real repo state (set by the
                // mergeador) — re-read it on every lookup so the
                // RESOLVER CONFLICTO button survives reloads.
                if (prNumber === prs[0]?.number) {
                  useIssueReviewStore
                    .getState()
                    .setConflictStatus(
                      issueNumber,
                      decisionResult.labels.includes("conflicto:main"),
                    );
                }
                // Materialize the verdict label from this deterministic
                // read path too: the terminal-exit flip can be skipped when
                // the app closes mid-review, and the bulk merge gates on
                // the label. Idempotent — ensure+add/remove, safe to repeat.
                if (decisionResult.reviewDecision) {
                  void window.termcanvas.github
                    .applyReviewLabel(
                      path,
                      prNumber,
                      decisionResult.reviewDecision,
                    )
                    .catch((error) => {
                      console.error(
                        "[review] failed to apply review label:",
                        error,
                      );
                    });
                }
                // Materialize the labels the review prompts never post —
                // the prompts only run while their terminal is open, so a
                // mid-flight close would otherwise strand the PR:
                // 1) "review:fix-aplicado": the head moved past the commit
                //    the newest review evaluated, so the fix (or conflict
                //    resolution) landed and awaits re-review. Only promoted
                //    over lesser states (pendiente/comentado); aprobado and
                //    conflicto keep their precedence.
                // 2) "review:pendiente": a brand-new PR (no cycle label yet)
                //    starts its cycle pending, as the resolve prompt would.
                // applyCycleLabel is idempotent (add target, clear the rest
                // of the cycle), so re-running on every lookup is safe.
                const canonicalLabel = canonicalReviewLabel(
                  decisionResult.labels,
                );
                const fixAppliedTargets: Array<string | null> = [
                  null,
                  REVIEW_LABEL_PENDING,
                  REVIEW_LABEL_CHANGES,
                ];
                if (
                  decisionResult.reviewDecision === "FIX_APPLIED" &&
                  fixAppliedTargets.includes(canonicalLabel)
                ) {
                  void window.termcanvas.github
                    .applyCycleLabel(
                      path,
                      prNumber,
                      issueNumber,
                      REVIEW_LABEL_FIX_APPLIED,
                    )
                    .catch((error) => {
                      console.error(
                        "[review] failed to apply fix-applied label:",
                        error,
                      );
                    });
                }
                const pendingDecision =
                  decisionResult.reviewDecision === null ||
                  decisionResult.reviewDecision === "REVIEW_REQUIRED";
                if (
                  canonicalLabel === null &&
                  pendingDecision &&
                  prState === "OPEN"
                ) {
                  void window.termcanvas.github
                    .applyCycleLabel(
                      path,
                      prNumber,
                      issueNumber,
                      REVIEW_LABEL_PENDING,
                    )
                    .catch((error) => {
                      console.error(
                        "[review] failed to apply pending label:",
                        error,
                      );
                    });
                }
                // Mirror the PR's canonical review-cycle label onto the
                // associated issue (best-effort, idempotent): the issue must
                // reflect the PR state in EVERY state — approved, changes,
                // conflict, fix applied, pending. The canonical derivation
                // self-corrects stale label combinations on each refresh.
                void window.termcanvas.github
                  .syncIssueReviewLabel(
                    path,
                    issueNumber,
                    decisionResult.labels,
                  )
                  .catch((error) => {
                    console.error(
                      "[review] failed to sync issue label:",
                      error,
                    );
                  });
              })
              .catch(() => {});
          }
        })
        .catch(() => {
          useIssueReviewStore.getState().setPrStatus(issueNumber, null);
        });
    },
    [resolveContextMenuTarget],
  );

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

  const handleIssueFetchError = useCallback(
    (
      result: Extract<
        Awaited<ReturnType<typeof window.termcanvas.github.fetchIssues>>,
        { ok: false }
      >,
    ) => {
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
    },
    [],
  );

  // Seed the review store with the native linked-PR data the main issues
  // query already fetched, so the card button is correct without an extra
  // IPC round trip. Never overwrites an IPC lookup result that ran first.
  const seedPrFromIssueData = useCallback(
    (issueNumber: number, raw: Record<string, unknown>) => {
      const reviewStore = useIssueReviewStore.getState();
      if (reviewStore.prsByIssue[issueNumber] !== undefined) return;
      const pr = pickLinkedPrFromIssueData(raw);
      if (pr) reviewStore.setPrStatus(issueNumber, pr);
    },
    [],
  );

  const syncIssuesToCanvas = useCallback(
    async (basePos: { x: number; y: number }) => {
      const target = resolveContextMenuTarget();
      if (!target) {
        console.warn("[gh-issues] resolveContextMenuTarget returned null");
        return;
      }

      console.log("[gh-issues] Fetching issues for worktree:", target.worktree.path);
      useIssueSyncStore.getState().setFetchingIssues(true);
      try {
        const result = await window.termcanvas.github.fetchIssues(
          target.worktree.path,
        );

        console.log("[gh-issues] IPC result:", JSON.stringify({ ok: result.ok, count: result.ok ? result.issues.length : 0, code: result.ok ? undefined : (result as { code: string }).code }));

        if (!result.ok) {
          handleIssueFetchError(result);
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
            seedPrFromIssueData(issueNum, raw);
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
          seedPrFromIssueData(issueNum, raw);
          addedCount++;
        }

        if (addedCount === 0) {
          useNotificationStore
            .getState()
            .notify("info", "Issues are up to date — no changes from GitHub.");
        } else {
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
        useIssueSyncStore.getState().setFetchingIssues(false);
      }
    },
    [resolveContextMenuTarget, handleIssueFetchError, seedPrFromIssueData],
  );

  const handleIssueContextMenuPick = useCallback(async () => {
    if (!contextMenu) return;
    await syncIssuesToCanvas({ x: contextMenu.flowX, y: contextMenu.flowY });
  }, [contextMenu, syncIssuesToCanvas]);

  const handleFetchIssuesFromPanel = useCallback(async () => {
    // No context-menu position available: lay the issue grid out from
    // the center of the current viewport.
    const center = reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: Math.max(window.innerHeight / 2 - 80, 80),
    });
    await syncIssuesToCanvas(center);
  }, [reactFlow, syncIssuesToCanvas]);

  useEffect(() => {
    useIssueSyncStore
      .getState()
      .registerFetchIssuesHandler(handleFetchIssuesFromPanel);
    return () => {
      useIssueSyncStore.getState().registerFetchIssuesHandler(null);
    };
  }, [handleFetchIssuesFromPanel]);

  const handleRefreshIssues = useCallback(async () => {
    const target = resolveContextMenuTarget();
    if (!target) return;

    console.log("[gh-issues] Refreshing issues for worktree:", target.worktree.path);
    useIssueSyncStore.getState().setFetchingIssues(true);
    try {
      const result = await window.termcanvas.github.fetchIssues(
        target.worktree.path,
      );

      if (!result.ok) {
        handleIssueFetchError(result);
        return;
      }

      const issueStore = useIssueStore.getState();
      const cardsOnCanvas = issueStore.issues.size;
      let updatedCount = 0;

      // Refresh metadata (state, title, labels) only for issues that
      // already have a card on the canvas. New issues are NOT added here.
      for (const raw of result.issues) {
        const issueNum = raw.number as number;
        if (!issueStore.hasIssue(issueNum)) continue;
        const issueId = `gh-${target.projectId}-${issueNum}`;
        issueStore.updateIssue(issueNum, {
          ...raw,
          issueId,
          projectId: target.projectId,
          worktreeId: target.worktreeId,
          issueNumber: issueNum,
          __worktreePath: target.worktree.path,
        } as Partial<IssueNodeData>);
        updatedCount++;
      }

      if (cardsOnCanvas === 0) {
        useNotificationStore
          .getState()
          .notify(
            "info",
            "No issue cards on the canvas to update — add issues first with \"Traer issues de GitHub\".",
          );
      } else if (updatedCount === 0) {
        // Same success banner as the full sync: nothing changed because
        // every card already reflects the latest state from GitHub.
        useNotificationStore
          .getState()
          .notify(
            "info",
            "Issues are up to date — no changes from GitHub.",
          );
      } else {
        console.log(`[gh-issues] Refreshed ${updatedCount} issues`);
        useNotificationStore
          .getState()
          .notify(
            "info",
            `Updated ${updatedCount} issue${updatedCount !== 1 ? "s" : ""} from GitHub.`,
          );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useNotificationStore
        .getState()
        .notify("error", `GitHub Issues: ${message}`);
    } finally {
      useIssueSyncStore.getState().setFetchingIssues(false);
    }
  }, [resolveContextMenuTarget, handleIssueFetchError]);

  const handleResolveIssue = useCallback(
    async (issueNumber: number) => {
      if (useIssueResolveStore.getState().resolvingIssueNumber !== null) return;
      const target = resolveContextMenuTarget();
      if (!target) return;
      const issueStore = useIssueStore.getState();
      const issue = issueStore.getIssue(issueNumber);
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
      const project = useProjectStore
        .getState()
        .projects.find((p) => p.id === target.projectId);
      const repoContextText = await resolveRepoContextText(project?.path);
      const requirementsText = await resolveRequirementsText(project?.path);
      const promptInput = {
        issueNumber: issue.issueNumber,
        title: issue.title,
        body: issue.body,
        repoContextText,
        requirementsText,
      };
      const initialPrompt = buildIssueResolvePrompt(promptInput, "new");
      let resumePrompt = buildIssueResolvePrompt(promptInput, "resume");
      // If the reviewer requested changes, surface their feedback in the
      // resume prompt so the implementer addresses it on the next turn
      // instead of rediscovering it.
      void (async () => {
        const verdict =
          useIssueReviewStore.getState().verdictByIssue[issue.issueNumber];
        if (verdict !== "CHANGES_REQUESTED") return;
        try {
          const prResult = await window.termcanvas.github.findPrForIssue(
            target.worktree.path,
            issue.issueNumber,
          );
          if (!prResult.ok || !prResult.pr) return;
          const feedback = await window.termcanvas.github.getPrComments(
            target.worktree.path,
            prResult.pr.number,
          );
          if (!feedback.ok || !feedback.text) return;
          resumePrompt +=
            ` | FEEDBACK DEL REVIEW DEL PR #${prResult.pr.number}: el reviewer pidió cambios. ` +
            `Corregí los puntos señalados antes de continuar y luego volvé a abrir el flujo de revisión (gh pr review de nuevo). ` +
            `Comentarios del review:\n${feedback.text}`;
        } catch (error) {
          console.error("[resolve] error leyendo feedback del review:", error);
        }
      })();
      const isIssueTerminalLive = (terminalId: string): boolean => {
        const runtime = useTerminalRuntimeStateStore.getState().terminals[terminalId];
        if (runtime?.ptyId != null) return true;
        for (const p of useProjectStore.getState().projects) {
          for (const w of p.worktrees) {
            const t = w.terminals.find((x) => x.id === terminalId);
            if (t) return t.ptyId != null;
          }
        }
        return false;
      };
      const centerOnIssueTerminal = (terminalId: string) => {
        const node = reactFlow.getNode(terminalId);
        if (!node) return;
        const w = typeof node.measured?.width === "number" ? node.measured.width : 300;
        const h = typeof node.measured?.height === "number" ? node.measured.height : 200;
        void reactFlow.setCenter(
          node.position.x + w / 2,
          node.position.y + h / 2,
          { zoom: reactFlow.getZoom(), duration: 300 },
        );
      };
      useIssueActivityStore
        .getState()
        .recordActivity(target.worktree.path, issue.issueNumber, "resolve");
      useIssueResolveStore.getState().setResolvingIssueNumber(issue.issueNumber);
      void resolveIssueWorktree({
        issue,
        target,
        createWorktree: (repoPath, branch) =>
          window.termcanvas.project.createWorktree(repoPath, branch),
        getProject: (projectId) =>
          useProjectStore
            .getState()
            .projects.find((p) => p.id === projectId),
        syncWorktrees: (projectPath, worktrees) =>
          useProjectStore.getState().syncWorktrees(projectPath, worktrees),
        createTerminal: createTerminalInScene,
        notify: (type, message) =>
          useNotificationStore.getState().notify(type, message),
        setResolveArrows,
        issueNodeId,
        position: flowCenter,
        initialPrompt,
        resumePrompt,
        isIssueTerminalLive,
      })
        .then((result) => {
          if (!result.ok || !result.case || !result.terminal) return;
          const terminalId = result.terminal.id;
          if (
            result.case === "created" ||
            result.case === "reused"
          ) {
            // Focus the tile so the terminal runtime actually
            // spawns the CLI. Without focus the tile stays inert
            // and a second "RESOLVER ISSUE" click is required to
            // resume it.
            useProjectStore.getState().setFocusedTerminal(terminalId);
            centerOnIssueTerminal(terminalId);
            return;
          }
          if (result.case === "resumed" && result.reusedExisting) {
            void reuseTerminalForIssue({
              projectId: target.projectId,
              worktreeId: result.worktreeId ?? target.worktreeId,
              terminalId,
              resumePrompt,
            });
            centerOnIssueTerminal(terminalId);
          }
        })
        .finally(() => {
          useIssueResolveStore.getState().setResolvingIssueNumber(null);
        });
    },
    [reactFlow, resolveContextMenuTarget],
  );

  useEffect(() => {
    useIssueResolveStore.getState().registerResolveHandler(handleResolveIssue);
    return () => {
      useIssueResolveStore.getState().registerResolveHandler(null);
    };
  }, [handleResolveIssue]);

  const handleReviewIssue = useCallback(
    (issueNumber: number, prNumber?: number) => {
      if (useIssueResolveStore.getState().resolvingIssueNumber !== null) return;
      if (useIssueReviewStore.getState().reviewingIssueNumber !== null) return;
      if (useIssueReviewStore.getState().fixingIssueNumber !== null) return;
      const target = resolveContextMenuTarget();
      if (!target) return;
      const issueStore = useIssueStore.getState();
      const issue = issueStore.getIssue(issueNumber);
      if (!issue) return;
      // Measure the actual issue card DOM rect and convert to flow coords —
      // same placement contract as RESOLVER ISSUE.
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
      const centerOnReviewTerminal = (terminalId: string) => {
        const node = reactFlow.getNode(terminalId);
        if (!node) return;
        const w = typeof node.measured?.width === "number" ? node.measured.width : 300;
        const h = typeof node.measured?.height === "number" ? node.measured.height : 200;
        void reactFlow.setCenter(
          node.position.x + w / 2,
          node.position.y + h / 2,
          { zoom: reactFlow.getZoom(), duration: 300 },
        );
      };
      useIssueActivityStore
        .getState()
        .recordActivity(target.worktree.path, issue.issueNumber, "review");
      useIssueReviewStore.getState().setReviewingIssueNumber(issue.issueNumber);
      void reviewIssueWorktree({
        issue,
        target,
        getProject: (projectId) =>
          useProjectStore
            .getState()
            .projects.find((p) => p.id === projectId),
        syncWorktrees: (projectPath, worktrees) =>
          useProjectStore.getState().syncWorktrees(projectPath, worktrees),
        createReviewWorktree: (repoPath, baseName, branch) =>
          window.termcanvas.project.createReviewWorktree(
            repoPath,
            baseName,
            branch,
          ),
        removeWorktree: (repoPath, worktreePath, force) =>
          window.termcanvas.project.removeWorktree(
            repoPath,
            worktreePath,
            force,
          ),
        isReviewWorktreeInUse: (worktreeId) =>
          hasLiveReviewOnWorktree(worktreeId),
        findOpenPrsForIssue: (cwd, number) =>
          window.termcanvas.github.findOpenPrsForIssue(cwd, number),
        getReviewContext: (cwd, number, targetDir) =>
          window.termcanvas.github.getReviewContext(cwd, number, targetDir),
        createTerminal: createTerminalInScene,
        notify: (type, message) =>
          useNotificationStore.getState().notify(type, message),
        setResolveArrows,
        issueNodeId,
        position: flowCenter,
        onlyPrNumber: prNumber,
      })
        .then((result) => {
          if (!result.ok || !result.terminals || result.terminals.length === 0) {
            return;
          }
          // Focus the first tile so the terminal runtime actually spawns the
          // CLI; the remaining review terminals of the other open PRs spawn
          // with the built-in stagger and run unattended with --auto.
          const terminalId = result.terminals[0].id;
          useProjectStore.getState().setFocusedTerminal(terminalId);
          centerOnReviewTerminal(terminalId);
        })
        .finally(() => {
          useIssueReviewStore.getState().setReviewingIssueNumber(null);
        });
    },
    [reactFlow, resolveContextMenuTarget],
  );

  // Apply the reviewer's requested changes on the SAME PR. Only reachable
  // while the review verdict is COMMENTED/CHANGES_REQUESTED (the context menu
  // gates it); the fix runs in the implementer worktree so the push updates
  // the existing PR. Once the terminal is created the verdict flips to
  // FIX_APPLIED so the menu item disappears until the next review.
  const handleFixIssue = useCallback(
    (issueNumber: number, prNumber?: number) => {
      if (useIssueResolveStore.getState().resolvingIssueNumber !== null) return;
      if (useIssueReviewStore.getState().reviewingIssueNumber !== null) return;
      if (useIssueReviewStore.getState().fixingIssueNumber !== null) return;
      const target = resolveContextMenuTarget();
      if (!target) return;
      const issueStore = useIssueStore.getState();
      const issue = issueStore.getIssue(issueNumber);
      if (!issue) return;
      const reviewStore = useIssueReviewStore.getState();
      // The exact PR that asked for changes: prNumber (multi-PR menu) or the
      // issue's primary PR (footer button / single-PR issues).
      const pr =
        prNumber !== undefined
          ? (reviewStore.openPrsByIssue[issueNumber] ?? []).find(
              (p) => p.number === prNumber,
            )
          : reviewStore.prsByIssue[issueNumber];
      if (!pr || typeof pr === "string") return;
      // Gate on the persisted cycle label (source of truth) with the
      // in-memory verdict as fallback, mirroring the context menu. The
      // per-PR verdict/labels win over the primary when a specific PR was
      // targeted.
      const prLabels =
        prNumber !== undefined
          ? reviewStore.labelsByPr[issueNumber]?.[prNumber] ??
            reviewStore.labelsByIssue[issueNumber] ??
            []
          : reviewStore.labelsByIssue[issueNumber] ?? [];
      const prVerdict =
        prNumber !== undefined
          ? reviewStore.verdictByPr[issueNumber]?.[prNumber] ??
            reviewStore.verdictByIssue[issueNumber]
          : reviewStore.verdictByIssue[issueNumber];
      const effective = effectiveReviewLabel(prLabels, prVerdict);
      if (effective !== REVIEW_LABEL_CHANGES) return;
      // Measure the actual issue card DOM rect and convert to flow coords —
      // same placement contract as RESOLVER ISSUE / REVISAR SOLUCIÓN.
      const issueNodeId = `issue-${issue.issueNumber}`;
      const issueEl = document.querySelector(`[data-id="${issueNodeId}"]`);
      const rect = issueEl?.getBoundingClientRect();
      if (!rect) return;
      const screenCenter = { x: rect.left + rect.width / 2, y: rect.bottom + 12 };
      let flowCenter = reactFlow.screenToFlowPosition(screenCenter);
      const stored = usePreferencesStore.getState().defaultTerminalSize;
      const tileW = stored?.w ?? useTileDimensionsStore.getState().w;
      flowCenter = { x: flowCenter.x - tileW / 2, y: flowCenter.y };
      const centerOnFixTerminal = (terminalId: string) => {
        const node = reactFlow.getNode(terminalId);
        if (!node) return;
        const w = typeof node.measured?.width === "number" ? node.measured.width : 300;
        const h = typeof node.measured?.height === "number" ? node.measured.height : 200;
        void reactFlow.setCenter(
          node.position.x + w / 2,
          node.position.y + h / 2,
          { zoom: reactFlow.getZoom(), duration: 300 },
        );
      };
      useIssueActivityStore
        .getState()
        .recordActivity(target.worktree.path, issue.issueNumber, "fix");
      useIssueReviewStore.getState().setFixingIssueNumber(issue.issueNumber);
      void fixIssueWorktree({
        issue,
        projectId: target.projectId,
        pr,
        getProject: (projectId) =>
          useProjectStore
            .getState()
            .projects.find((p) => p.id === projectId),
        restoreWorktree: (repoPath, branch) =>
          window.termcanvas.project.restoreWorktree(repoPath, branch),
        syncWorktrees: (projectPath, worktrees) =>
          useProjectStore.getState().syncWorktrees(projectPath, worktrees),
        getReviewContext: (cwd, number, targetDir) =>
          window.termcanvas.github.getReviewContext(cwd, number, targetDir),
        createTerminal: createTerminalInScene,
        notify: (type, message) =>
          useNotificationStore.getState().notify(type, message),
        setResolveArrows,
        issueNodeId,
        position: flowCenter,
      })
        .then((result) => {
          if (!result.ok || !result.terminal) return;
          const terminalId = result.terminal.id;
          // Focus the tile so the terminal runtime actually spawns the CLI.
          useProjectStore.getState().setFocusedTerminal(terminalId);
          centerOnFixTerminal(terminalId);
          // The fix is underway — flip the badge so the button disappears
          // until the reviewer takes another look. Mirror per-PR when the
          // fix targeted a specific PR.
          useIssueReviewStore
            .getState()
            .setReviewVerdict(issue.issueNumber, "FIX_APPLIED");
          if (prNumber !== undefined) {
            useIssueReviewStore
              .getState()
              .setPrVerdict(issue.issueNumber, prNumber, "FIX_APPLIED");
          }
        })
        .finally(() => {
          useIssueReviewStore.getState().setFixingIssueNumber(null);
        });
    },
    [reactFlow, resolveContextMenuTarget],
  );

  // Resolve a merge conflict on the SAME PR after the mergeador flagged it
  // with the "conflicto:main" label. Only reachable while the card carries a
  // real PR and the conflict flag is set (the context menu gates it); like
  // the fix flow it runs in the implementer worktree so the resolution push
  // updates the existing PR. The conflict flag stays until the agent removes
  // the label.
  const handleResolveConflict = useCallback(
    (issueNumber: number, prNumber?: number) => {
      if (
        useIssueReviewStore.getState().resolvingConflictIssueNumber !== null
      ) {
        return;
      }
      if (useIssueResolveStore.getState().resolvingIssueNumber !== null) return;
      if (useIssueReviewStore.getState().reviewingIssueNumber !== null) return;
      if (useIssueReviewStore.getState().fixingIssueNumber !== null) return;
      const target = resolveContextMenuTarget();
      if (!target) return;
      const issueStore = useIssueStore.getState();
      const issue = issueStore.getIssue(issueNumber);
      if (!issue) return;
      const reviewStore = useIssueReviewStore.getState();
      const pr =
        prNumber !== undefined
          ? (reviewStore.openPrsByIssue[issueNumber] ?? []).find(
              (p) => p.number === prNumber,
            )
          : reviewStore.prsByIssue[issueNumber];
      if (!pr || typeof pr === "string") return;
      const conflicted =
        prNumber !== undefined
          ? reviewStore.conflictByPr[issueNumber]?.[prNumber] ?? false
          : reviewStore.conflictByIssue[issueNumber] === true;
      if (!conflicted) return;
      // Measure the actual issue card DOM rect and convert to flow coords —
      // same placement contract as RESOLVER ISSUE / REVISAR SOLUCIÓN.
      const issueNodeId = `issue-${issue.issueNumber}`;
      const issueEl = document.querySelector(`[data-id="${issueNodeId}"]`);
      const rect = issueEl?.getBoundingClientRect();
      if (!rect) return;
      const screenCenter = { x: rect.left + rect.width / 2, y: rect.bottom + 12 };
      let flowCenter = reactFlow.screenToFlowPosition(screenCenter);
      const stored = usePreferencesStore.getState().defaultTerminalSize;
      const tileW = stored?.w ?? useTileDimensionsStore.getState().w;
      flowCenter = { x: flowCenter.x - tileW / 2, y: flowCenter.y };
      const centerOnConflictTerminal = (terminalId: string) => {
        const node = reactFlow.getNode(terminalId);
        if (!node) return;
        const w = typeof node.measured?.width === "number" ? node.measured.width : 300;
        const h = typeof node.measured?.height === "number" ? node.measured.height : 200;
        void reactFlow.setCenter(
          node.position.x + w / 2,
          node.position.y + h / 2,
          { zoom: reactFlow.getZoom(), duration: 300 },
        );
      };
      useIssueReviewStore
        .getState()
        .setResolvingConflictIssueNumber(issue.issueNumber);
      void resolveConflictWorktree({
        issue,
        projectId: target.projectId,
        pr,
        getProject: (projectId) =>
          useProjectStore
            .getState()
            .projects.find((p) => p.id === projectId),
        restoreWorktree: (repoPath, branch) =>
          window.termcanvas.project.restoreWorktree(repoPath, branch),
        syncWorktrees: (projectPath, worktrees) =>
          useProjectStore.getState().syncWorktrees(projectPath, worktrees),
        getConflict: (repoPath, branch, prNumber) =>
          window.termcanvas.github.getConflictFiles(repoPath, branch, prNumber),
        createTerminal: createTerminalInScene,
        notify: (type, message) =>
          useNotificationStore.getState().notify(type, message),
        setResolveArrows,
        issueNodeId,
        position: flowCenter,
      })
        .then((result) => {
          if (!result.ok || !result.terminal) return;
          const terminalId = result.terminal.id;
          // Focus the tile so the terminal runtime actually spawns the CLI.
          useProjectStore.getState().setFocusedTerminal(terminalId);
          centerOnConflictTerminal(terminalId);
        })
        .finally(() => {
          useIssueReviewStore
            .getState()
            .setResolvingConflictIssueNumber(null);
        });
    },
    [reactFlow, resolveContextMenuTarget],
  );

  // Escape manual del gate de calidad: "Revisar igual" quita gate:fallo,
  // deja review:pendiente y lanza la review igual. El gate es una ayuda, no
  // un dictador.
  const handleOverrideGate = useCallback(
    async (issueNumber: number, prNumber?: number) => {
      const target = resolveContextMenuTarget();
      if (!target) return;
      let pr = prNumber;
      if (pr === undefined) {
        const primary = useIssueReviewStore.getState().prsByIssue[issueNumber];
        if (primary == null || primary === "loading") return;
        pr = primary.number;
      }
      const ok = await overrideGateForIssue({
        repoPath: target.worktree.path,
        issueNumber,
        prNumber: pr,
      });
      if (ok) {
        handleReviewIssue(issueNumber, pr);
      }
    },
    [resolveContextMenuTarget, handleReviewIssue],
  );

  // Merge the reviewed PR once the reviewer verdict is APPROVED. Only
  // reachable while the card carries a real PR and an APPROVED verdict (the
  // context menu gates it); a merge needs no terminal — the action runs
  // directly against GitHub and the verdict badge is cleared on success.
  const handleMergeIssue = useCallback(
    (issueNumber: number, prNumber?: number) => {
      if (useIssueReviewStore.getState().mergingIssueNumber !== null) return;
      const target = resolveContextMenuTarget();
      if (!target) return;
      const issueStore = useIssueStore.getState();
      const issue = issueStore.getIssue(issueNumber);
      if (!issue) return;
      const reviewStore = useIssueReviewStore.getState();
      const pr =
        prNumber !== undefined
          ? (reviewStore.openPrsByIssue[issueNumber] ?? []).find(
              (p) => p.number === prNumber,
            )
          : reviewStore.prsByIssue[issueNumber];
      if (!pr || typeof pr === "string") return;
      // Gate on the persisted cycle label (source of truth) with the
      // in-memory verdict as fallback, mirroring the context menu.
      const prLabels =
        prNumber !== undefined
          ? reviewStore.labelsByPr[issueNumber]?.[prNumber] ??
            reviewStore.labelsByIssue[issueNumber] ??
            []
          : reviewStore.labelsByIssue[issueNumber] ?? [];
      const prVerdict =
        prNumber !== undefined
          ? reviewStore.verdictByPr[issueNumber]?.[prNumber] ??
            reviewStore.verdictByIssue[issueNumber]
          : reviewStore.verdictByIssue[issueNumber];
      const effective = effectiveReviewLabel(prLabels, prVerdict);
      if (effective !== REVIEW_LABEL_APPROVED) return;
      useIssueActivityStore
        .getState()
        .recordActivity(target.worktree.path, issue.issueNumber, "merge");
      useIssueReviewStore.getState().setMergingIssueNumber(issue.issueNumber);
      window.termcanvas.github
        .mergePr(target.worktree.path, pr.number)
        .then((result) => {
          if (result.ok) {
            useNotificationStore
              .getState()
              .notify("info", `PR #${pr.number} merged successfully.`);
            useIssueReviewStore
              .getState()
              .setReviewVerdict(issue.issueNumber, null);
            if (prNumber !== undefined) {
              useIssueReviewStore
                .getState()
                .setPrVerdict(issue.issueNumber, prNumber, null);
            }
            // Force a re-read of the PR so the card leaves the approved
            // state immediately (the PR is now merged; the session cache
            // would otherwise keep it APPROVED forever).
            useIssueReviewStore
              .getState()
              .requestPrLookup(issue.issueNumber, target.worktree.path, true);
          } else {
            useNotificationStore
              .getState()
              .notify("error", `Merge PR #${pr.number}: ${result.error}`);
          }
        })
        .catch((error) => {
          useNotificationStore
            .getState()
            .notify(
              "error",
              `Merge PR #${pr.number}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
        })
        .finally(() => {
          useIssueReviewStore.getState().setMergingIssueNumber(null);
        });
    },
    [resolveContextMenuTarget],
  );

  // Bulk-merge every open PR carrying the "review:aprobado" label, one by
  // one, in the main process (which test-merges each against origin/main in a
  // throwaway worktree). Clean PRs come back in `merged`; conflicting PRs in
  // `conflicted` and were tagged with "conflicto:main", which flips the
  // RESOLVER CONFLICTO button on for their issue cards.
  const handleMergeApprovedPrs = useCallback(() => {
    const target = resolveContextMenuTarget();
    if (!target) return;
    const reviewStore = useIssueReviewStore.getState();
    if (reviewStore.mergingApprovedPrs) return;
    if (reviewStore.mergingIssueNumber !== null) return;
    const notify = useNotificationStore.getState().notify;
    reviewStore.setMergingApprovedPrs(true);
    const issueForPr = (prNumber: number): number | undefined => {
      const state = useIssueReviewStore.getState();
      for (const [issueNumber, status] of Object.entries(state.prsByIssue)) {
        if (status && typeof status === "object" && status.number === prNumber) {
          return Number(issueNumber);
        }
      }
      // Multi-PR: a merged PR may not be the issue's primary — scan the full
      // open-PR lists too so its verdict/conflict update lands on the right
      // issue card.
      for (const [issueNumber, prs] of Object.entries(state.openPrsByIssue)) {
        if (prs.some((p) => p.number === prNumber)) {
          return Number(issueNumber);
        }
      }
      return undefined;
    };
    void window.termcanvas.github
      .mergeApprovedPrs(target.worktree.path)
      .then((result) => {
        if (!result.ok) {
          notify("error", `Mergear PRs aprobados: ${result.error}`);
          return;
        }
        const { merged, conflicted } = result.summary;
        for (const prNumber of merged) {
          const issueNumber = issueForPr(prNumber);
          if (issueNumber !== undefined) {
            useIssueReviewStore
              .getState()
              .setReviewVerdict(issueNumber, null);
            useIssueReviewStore
              .getState()
              .setPrVerdict(issueNumber, prNumber, null);
          }
        }
        for (const conflict of conflicted) {
          const issueNumber = issueForPr(conflict.number);
          if (issueNumber !== undefined) {
            useIssueReviewStore
              .getState()
              .setConflictStatus(issueNumber, true);
            useIssueReviewStore
              .getState()
              .setPrConflict(issueNumber, conflict.number, true);
          }
        }
        console.log(
          `[mergeador] summary: merged=[${merged.join(", ")}] conflicted=[${conflicted.map((c) => `#${c.number} (${c.files.length} files)`).join(", ")}]`,
        );
        if (merged.length === 0 && conflicted.length === 0) {
          notify("info", "No hay PRs aprobados para mergear.");
        } else if (merged.length > 0 && conflicted.length === 0) {
          notify("info", `PRs aprobados mergeados: #${merged.join(", #")}.`);
        } else if (merged.length === 0 && conflicted.length > 0) {
          notify(
            "warn",
            `PRs con conflicto contra main: #${conflicted.map((c) => c.number).join(", #")} — revisá el comentario [mergeador] en el PR y usá RESOLVER CONFLICTO en la card.`,
          );
        } else {
          notify(
            "warn",
            `Mergeados: #${merged.join(", #")}. Con conflicto: #${conflicted.map((c) => c.number).join(", #")} (archivos en el comentario [mergeador]) — usá RESOLVER CONFLICTO en la card.`,
          );
        }
      })
      .catch((error) => {
        notify(
          "error",
          `Mergear PRs aprobados: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      })
      .finally(() => {
        useIssueReviewStore.getState().setMergingApprovedPrs(false);
      });
  }, [resolveContextMenuTarget]);

  // Forward the bulk-merge progress stream (github:merge-approved-prs) into
  // the issue review store, which drives the MergeProgressPanel.
  useEffect(() => {
    const unsubscribe = window.termcanvas.github.onMergeProgress((event) => {
      applyMergeProgressEvent(useIssueReviewStore.getState(), event);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const reviewStore = useIssueReviewStore.getState();
    reviewStore.registerReviewHandler(handleReviewIssue);
    reviewStore.registerFixHandler(handleFixIssue);
    reviewStore.registerMergeHandler(handleMergeIssue);
    reviewStore.registerResolveConflictHandler(handleResolveConflict);
    reviewStore.registerPrLookupHandler(checkLinkedPr);
    return () => {
      const current = useIssueReviewStore.getState();
      current.registerReviewHandler(null);
      current.registerFixHandler(null);
      current.registerMergeHandler(null);
      current.registerResolveConflictHandler(null);
      current.registerPrLookupHandler(null);
    };
  }, [handleReviewIssue, handleFixIssue, handleMergeIssue, checkLinkedPr]);

  const projectedNodes = useMemo(() => {
    const terminalNodes = buildCanvasFlowNodes(projects);

    const issues = useIssueStore.getState().getAllIssues();
    console.log(`[projectedNodes] terminals=${terminalNodes.length}, issues=${issues.length}, issueVersion=${issueVersion}`);
    const issueNodes = issues.length > 0
      ? buildCanvasFlowIssueNodes(issues, { filter: issueVisibilityFilter })
      : [];

    return [...issueNodes, ...terminalNodes];
  }, [layoutKey, issueVersion, issueVisibilityFilter]);
  const [nodes, setNodes, onNodesChange] =
    useNodesState<CanvasFlowNode>(projectedNodes);

  useEffect(() => {
    // Re-pack the visible issue cards whenever the issue set or the active
    // visibility filter changes: hidden closed cards must not leave holes
    // behind, so the survivors are re-flowed consecutively by number. The
    // positions are written back into the store so a scene capture persists
    // the packed layout.
    const all = useIssueStore.getState().getAllIssues();
    const visible = all.filter((issue) =>
      issueMatchesFilter(issue, issueVisibilityFilter),
    );
    if (visible.length === 0) return;
    useIssueStore.getState().applyPackedLayout(packIssuePositions(visible));
  }, [issueVersion, issueVisibilityFilter]);

  useEffect(() => {
    setNodes((currentNodes) => {
      const existing = new Map(currentNodes.map((n) => [n.id, n]));
      return projectedNodes.map((pn) => {
        const cur = existing.get(pn.id);
        // Issue cards always follow the packed store layout — the re-pack
        // effect moves them, so a stale node position must not win here.
        if (pn.type === "issue") return pn;
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
      const issueNumber = (node.data as Record<string, unknown>).number as number;
      setIssueContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        issueNumber,
      });
      // Kick off the linked-PR lookup for this issue so the menu can show
      // whether a review is possible (falls back to the focused worktree
      // repo; the card footer button already started its own lookup).
      checkLinkedPr(issueNumber);
    },
    [checkLinkedPr],
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
                  {
                    label: isFetchingIssues
                      ? "Cargando issues..."
                      : "Actualizar estado de issues",
                    onClick: () => {
                      void handleRefreshIssues();
                    },
                  } as const,
                  {
                    label: mergingApprovedPrs
                      ? "Mergeando PRs aprobados..."
                      : "MERGEAR PRs APROBADOS",
                    disabled:
                      mergingApprovedPrs || mergingIssueNumber !== null
                        ? (true as const)
                        : undefined,
                    onClick: () => handleMergeApprovedPrs(),
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

      {issueContextMenu && (() => {
        const issueNumber = issueContextMenu.issueNumber;
        const menuPrState = issuePrs[issueNumber];
        const menuVerdict = issueVerdicts[issueNumber];
        const openPrs = issueOpenPrs[issueNumber] ?? [];
        // The menu gates derive from the PR's persisted cycle label (source
        // of truth) with the in-memory verdict as fallback: an approved PR
        // whose label flip was missed would otherwise show MERGEAR PR with
        // no approval, and a changes-requested review would hide IMPLEMENTAR
        // FIX forever.
        const menuEffective = effectiveReviewLabel(
          issueLabels[issueNumber] ?? [],
          menuVerdict,
        );
        // Per-PR effective cycle state for multi-PR issues, so each open PR
        // gets its own fix/merge/conflict/review actions instead of the menu
        // acting only on the primary PR.
        const prEffective = (prNumber: number) =>
          effectiveReviewLabel(
            issueLabelsByPr[issueNumber]?.[prNumber] ??
              issueLabels[issueNumber] ??
              [],
            issueVerdictsByPr[issueNumber]?.[prNumber] ??
              issueVerdicts[issueNumber] ??
              null,
          );
        return (
        <ContextMenu
          x={issueContextMenu.clientX}
          y={issueContextMenu.clientY}
          items={[
            {
              label: isResolving ? "Resolviendo issue..." : "RESOLVER ISSUE",
              onClick: () => handleResolveIssue(issueNumber),
            },
            (() => {
              if (menuPrState === "loading") {
                return {
                  label: "Buscando PR...",
                  disabled: true as const,
                  onClick: () => {},
                };
              }
              if (menuPrState == null) {
                return {
                  label: "REVISAR SOLUCIÓN (sin PR)",
                  disabled: true as const,
                  onClick: () => {},
                };
              }
              return {
                label: isReviewing
                  ? "Revisando solución..."
                  : menuEffective === REVIEW_LABEL_GATE_FAIL
                    ? "REVISAR SOLUCIÓN (gate:fallo — ver card)"
                    : openPrs.length > 1
                      ? `REVISAR SOLUCIÓN (${openPrs.length} PRs)`
                      : `REVISAR SOLUCIÓN (PR #${menuPrState.number})`,
                disabled:
                  isReviewing || menuEffective === REVIEW_LABEL_GATE_FAIL
                    ? (true as const)
                    : undefined,
                onClick: () => handleReviewIssue(issueNumber),
              };
            })(),
            // Per-PR actions. Each open PR of the issue gets its own line:
            // re-review just that PR, apply its fix, resolve its conflict or
            // merge it — without touching the other open PRs.
            ...openPrs.flatMap((pr) => {
              const effective = prEffective(pr.number);
              const conflicted =
                issueConflictsByPr[issueNumber]?.[pr.number] ?? false;
              const items: Array<{
                label: string;
                disabled?: boolean;
                onClick: () => void;
              }> = [];
              if (openPrs.length > 1) {
                items.push({
                  label: isReviewing
                    ? "Revisando..."
                    : effective === REVIEW_LABEL_GATE_FAIL
                      ? `REVISAR SOLO PR #${pr.number} (gate:fallo)`
                      : `REVISAR SOLO PR #${pr.number}`,
                  disabled:
                    isReviewing || effective === REVIEW_LABEL_GATE_FAIL
                      ? (true as const)
                      : undefined,
                  onClick: () => handleReviewIssue(issueNumber, pr.number),
                });
              }
              if (effective === REVIEW_LABEL_GATE_FAIL) {
                items.push({
                  label: `REVISAR IGUAL (PR #${pr.number})`,
                  onClick: () => void handleOverrideGate(issueNumber, pr.number),
                });
              }
              if (effective === REVIEW_LABEL_CHANGES) {
                items.push({
                  label:
                    fixingIssueNumber !== null
                      ? "Aplicando fix..."
                      : `IMPLEMENTAR FIX (PR #${pr.number})`,
                  disabled:
                    fixingIssueNumber !== null ? (true as const) : undefined,
                  onClick: () => handleFixIssue(issueNumber, pr.number),
                });
              }
              if (conflicted && pr.state === "OPEN") {
                items.push({
                  label:
                    resolvingConflictIssueNumber !== null
                      ? "Resolviendo conflicto..."
                      : `RESOLVER CONFLICTO (PR #${pr.number})`,
                  disabled:
                    resolvingConflictIssueNumber !== null
                      ? (true as const)
                      : undefined,
                  onClick: () =>
                    handleResolveConflict(issueNumber, pr.number),
                });
              }
              if (
                effective === REVIEW_LABEL_APPROVED &&
                pr.state === "OPEN"
              ) {
                items.push({
                  label:
                    mergingIssueNumber !== null
                      ? "Mergeando PR..."
                      : `MERGEAR PR #${pr.number}`,
                  disabled:
                    mergingIssueNumber !== null ? (true as const) : undefined,
                  onClick: () => handleMergeIssue(issueNumber, pr.number),
                });
              }
              return items;
            }),
            // Legacy single-PR actions for issues whose open-PR lookup has
            // not landed yet (menu opened before checkLinkedPr resolves): the
            // primary PR's fix/merge/conflict as before.
            ...(openPrs.length === 0
              ? [
                  ...(menuEffective === REVIEW_LABEL_CHANGES
                    ? [
                        {
                          label:
                            fixingIssueNumber !== null
                              ? "Aplicando fix..."
                              : "IMPLEMENTAR FIX",
                          disabled:
                            fixingIssueNumber !== null
                              ? (true as const)
                              : undefined,
                          onClick: () => handleFixIssue(issueNumber),
                        } as const,
                      ]
                    : []),
                  ...(menuEffective === REVIEW_LABEL_GATE_FAIL
                    ? [
                        {
                          label: "REVISAR IGUAL (quita gate:fallo)",
                          onClick: () => void handleOverrideGate(issueNumber),
                        } as const,
                      ]
                    : []),
                  ...(issueConflicts[issueNumber] === true &&
                  menuPrState !== null &&
                  menuPrState !== "loading"
                    ? [
                        {
                          label:
                            resolvingConflictIssueNumber !== null
                              ? "Resolviendo conflicto..."
                              : "RESOLVER CONFLICTO",
                          disabled:
                            resolvingConflictIssueNumber !== null
                              ? (true as const)
                              : undefined,
                          onClick: () => handleResolveConflict(issueNumber),
                        } as const,
                      ]
                    : []),
                  ...(menuEffective === REVIEW_LABEL_APPROVED &&
                  menuPrState !== null &&
                  menuPrState !== "loading"
                    ? [
                        {
                          label:
                            mergingIssueNumber !== null
                              ? "Mergeando PR..."
                              : `MERGEAR PR (#${menuPrState.number})`,
                          disabled:
                            mergingIssueNumber !== null
                              ? (true as const)
                              : undefined,
                          onClick: () => handleMergeIssue(issueNumber),
                        } as const,
                      ]
                    : []),
                ]
              : []),
          ]}
          onClose={() => setIssueContextMenu(null)}
        />
        );
      })()}

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

      <MergeProgressPanel />
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
