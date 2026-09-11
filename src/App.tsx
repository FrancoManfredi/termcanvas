import { useEffect } from "react";
import { CanvasRoot } from "./canvas/CanvasRoot";
import { addProjectFromDirectoryPath } from "./canvas/sceneCommands";
import { Toolbar } from "./toolbar/Toolbar";
import { BottomToolbar } from "./toolbar/BottomToolbar";
import { NotificationToast } from "./components/NotificationToast";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { FileEditorDrawer } from "./components/FileEditorDrawer";
import { PinDetailDrawer } from "./components/PinDetailDrawer";
import { initUpdaterListeners } from "./stores/updaterStore";
import { ComposerBar } from "./components/ComposerBar";
import { HandoffDragChip } from "./components/HandoffDragChip";
import { usePreferencesStore, hydrateApiKey } from "./stores/preferencesStore";
import { initPhaseModelSync } from "./stores/phaseModelSync";
import { DrawingPanel } from "./toolbar/DrawingPanel";
import { ShortcutHints } from "./components/ShortcutHints";
import { DiscoveryCue } from "./components/DiscoveryCue";
import { StatusDigest } from "./components/StatusDigest";
import { CompletionGlow } from "./components/CompletionGlow";
import { initSessionStoreIPC } from "./stores/sessionStore";
import { SearchModal } from "./components/SearchModal";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { UsageOverlay } from "./components/UsageOverlay";
import { SessionsOverlay } from "./components/SessionsOverlay";
import {
  closeTerminalInScene,
  createTerminalInScene,
  updateTerminalCustomTitleInScene,
} from "./actions/terminalSceneActions";
import { useProjectStore, generateId } from "./stores/projectStore";
import { addScannedProjectAndFocus } from "./projects/projectCreation";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePinPreloader } from "./hooks/usePinPreloader";
import { useT } from "./i18n/useT";
import { loadAllDownloadedFonts } from "./terminal/fontLoader";
import { startAutoSummaryWatcher } from "./terminal/summaryScheduler";
import { FactoryLabPage } from "./features/factoryLab/FactoryLabPage";
import { useFactoryLabStore } from "./stores/factoryLabStore";
import { WorkflowLabPage } from "./features/workflowLab/WorkflowLabPage";
import { useWorkflowLabStore } from "./stores/workflowLabStore";
import { WarpPanelShell } from "./features/warpPanel/WarpPanelShell";
import { HiddenCanvasBoundary } from "./features/warpPanel/HiddenCanvasBoundary";
import { useWarpPanelStore } from "./features/warpPanel/warpPanelStore";
import {
  shouldRunAutoSaveBackstop,
  useWorkspaceStore,
} from "./stores/workspaceStore";
import {
  readWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  snapshotState,
  type SkipRestoreSnapshot,
} from "./snapshotState";
import { appendSnapshotToHistory } from "./snapshotHistory";
import { SnapshotHistoryModal } from "./components/SnapshotHistoryModal";
import { useSnapshotHistoryStore } from "./stores/snapshotHistoryStore";
import { Hub } from "./components/Hub";
import { CanvasManagerModal } from "./components/CanvasManagerModal";
import { updateWindowTitle } from "./titleHelper";
import { resolveTerminalWithRuntimeState } from "./stores/terminalRuntimeStateStore";
import { logSlowRendererPath } from "./utils/devPerf";
import { selectAllTerminalRuntime } from "./terminal/terminalRuntimeStore";
import { performContextualSelectAll } from "./utils/contextualSelectAll";
import { hasHostBridge as hasHostBridgeFn } from "./terminal/ptyTransport";
import { mirrorHeadlessState } from "./lib/headlessStateMirror";


function isSkipRestoreSnapshot(
  snapshot: ReturnType<typeof readWorkspaceSnapshot>,
): snapshot is SkipRestoreSnapshot {
  return !!snapshot && "skipRestore" in snapshot;
}

function selectFocusedTerminalBuffer(): boolean {
  const { projects } = useProjectStore.getState();
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.focused) {
          return selectAllTerminalRuntime(terminal.id);
        }
      }
    }
  }

  return false;
}

function useWorktreeWatcher() {
  const projectCount = useProjectStore((s) => s.projects.length);
  // B1: subscribed so the effect re-arms when the panel closes (the
  // interval body reads the flag via getState — always fresh).
  const warpPanelActive = useWarpPanelStore((s) => s.warpPanelActive);

  useEffect(() => {
    if (!window.termcanvas || projectCount === 0) return;

    const inFlight = new Set<string>();
    const pending = new Set<string>();
    const latestSeqByPath = new Map<string, number>();
    let disposed = false;

    const scheduleRescan = (projectPath: string) => {
      if (inFlight.has(projectPath)) {
        pending.add(projectPath);
        return;
      }

      inFlight.add(projectPath);
      const seq = (latestSeqByPath.get(projectPath) ?? 0) + 1;
      latestSeqByPath.set(projectPath, seq);

      void window.termcanvas.project
        .rescanWorktrees(projectPath)
        .then((worktrees) => {
          if (disposed) return;
          if (latestSeqByPath.get(projectPath) !== seq) return;
          useProjectStore.getState().syncWorktrees(projectPath, worktrees);
        })
        .catch((err) => {
          if (!disposed) {
            console.error(
              `[useWorktreeWatcher] failed to rescan ${projectPath}:`,
              err,
            );
          }
        })
        .finally(() => {
          inFlight.delete(projectPath);
          if (!disposed && pending.delete(projectPath)) {
            scheduleRescan(projectPath);
          }
        });
    };

    const rescanAll = () => {
      // B1: while the Warp panel covers the canvas it owns the live view
      // (its own 2.5s factory poll). Skip the 5s per-project fs rescan
      // until the canvas is visible again — the effect re-runs (and
      // rescans immediately) when the panel closes.
      try {
        if (useWarpPanelStore.getState().warpPanelActive) return;
      } catch {
        // store unavailable — fall through to the legacy always-scan
      }
      const { projects } = useProjectStore.getState();
      for (const p of projects) {
        scheduleRescan(p.path);
      }
    };

    rescanAll();
    // Poll every 5s — simple, reliable, cross-platform
    const interval = setInterval(rescanAll, 5000);
    window.addEventListener("focus", rescanAll);

    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener("focus", rescanAll);
    };
  }, [projectCount, warpPanelActive]);
}

function useStatePersistence() {
  useEffect(() => {
    if (!window.termcanvas) return;
    window.termcanvas.state
      .load()
      .then((saved) => {
        const restored = readWorkspaceSnapshot(saved);
        if (!restored) return;
        if (isSkipRestoreSnapshot(restored)) {
          window.termcanvas.state.save({ skipRestore: false });
          return;
        }
        restoreWorkspaceSnapshot(restored);
        useWorkspaceStore.getState().setWorkspacePath(null);
        useWorkspaceStore.getState().markClean();
      })
      .catch((err) => {
        console.error("[useStatePersistence] failed to load state:", err);
      });
  }, []);
}

function useAutoSave() {
  useEffect(() => {
    if (!window.termcanvas) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const saveSnapshot = async () => {
      const startedAt = performance.now();
      try {
        await window.termcanvas.state.save(snapshotState());
        useWorkspaceStore.setState((state) => ({
          ...state,
          lastSavedAt: Date.now(),
        }));
        // Throttled history capture rides on the autosave heartbeat — see
        // MIN_HISTORY_INTERVAL_MS in snapshotHistory.ts. Awaiting the autosave
        // first guarantees state.json and the history slot agree.
        void appendSnapshotToHistory();
      } catch (err) {
        console.error("[useAutoSave] failed to save recovery snapshot:", err);
      } finally {
        logSlowRendererPath("App.autoSaveSnapshot", startedAt, {
          thresholdMs: 20,
        });
      }
    };

    const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
      if (state.dirty && state.lastDirtyAt !== prev.lastDirtyAt) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          void saveSnapshot();
        }, 5000);
      }

      if (!state.dirty && prev.dirty && debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    });

    const backstopTimer = setInterval(() => {
      const { dirty, lastDirtyAt, lastSavedAt } = useWorkspaceStore.getState();
      if (shouldRunAutoSaveBackstop({ dirty, lastDirtyAt, lastSavedAt })) {
        void saveSnapshot();
      }
    }, 60_000);

    return () => {
      unsubscribe();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      clearInterval(backstopTimer);
    };
  }, []);
}

function useWorkspaceOpen() {
  useEffect(() => {
    const handler = (e: Event) => {
      const { dirty } = useWorkspaceStore.getState();
      if (dirty && !window.confirm("Unsaved changes will be lost. Continue?")) {
        return;
      }

      const raw = (e as CustomEvent<string>).detail;
      try {
        const restored = readWorkspaceSnapshot(raw);
        if (!restored || isSkipRestoreSnapshot(restored)) {
          return;
        }
        restoreWorkspaceSnapshot(restored);
        useWorkspaceStore.getState().setWorkspacePath(null);
        useWorkspaceStore.getState().markClean();
      } catch (err) {
        console.error(
          "[useWorkspaceOpen] failed to parse workspace file:",
          err,
        );
      }
    };
    window.addEventListener("termcanvas:open-workspace", handler);
    return () =>
      window.removeEventListener("termcanvas:open-workspace", handler);
  }, []);
}


export function App() {
  useWorktreeWatcher();
  usePinPreloader();
  useStatePersistence();
  useAutoSave();
  useWorkspaceOpen();
  // Web-local (F4): sin bridge no hay state.load(); espejamos los
  // proyectos del daemon headless una vez al arrancar (solo lectura).
  useEffect(() => {
    if (hasHostBridgeFn()) return;
    void mirrorHeadlessState().then((result) => {
      if (result.ok) {
        console.info(`[web] mirrored ${result.projects} project(s) from headless`);
      }
    });
  }, []);
  useKeyboardShortcuts();
  const t = useT();
  const composerEnabled = usePreferencesStore((s) => s.composerEnabled);
  const globalSearchEnabled = usePreferencesStore((s) => s.globalSearchEnabled);
  const drawingEnabled = usePreferencesStore((s) => s.drawingEnabled);
  const summaryEnabled = usePreferencesStore((s) => s.summaryEnabled);
  const completionGlowEnabled = usePreferencesStore(
    (s) => s.completionGlowEnabled,
  );
  // B1: single subscription, read by the background-loop gates below and
  // the mount branch further down (one subscription, no duplicates).
  const warpPanelActive = useWarpPanelStore((s) => s.warpPanelActive);

  useEffect(() => {
    if (!summaryEnabled) return;
    // B1: the hidden canvas keeps no visible titles to summarize while the
    // panel covers it — pause the auto-summary sweep until return (the
    // effect re-arms on close; in-flight summaries finish, none start).
    if (warpPanelActive) return;
    return startAutoSummaryWatcher();
  }, [summaryEnabled, warpPanelActive]);

  useEffect(() => initUpdaterListeners(), []);
  useEffect(() => {
    void useSnapshotHistoryStore.getState().refresh();
  }, []);
  useEffect(() => {
    void hydrateApiKey();
    initPhaseModelSync();
  }, []);
  useEffect(() => {
    if (!window.termcanvas?.sessions) return;
    return initSessionStoreIPC();
  }, []);

  useEffect(() => {
    if (!window.termcanvas?.menu) return;
    const removeOpenFolderListener = window.termcanvas.menu.onOpenFolder(
      async (dirPath: string) => {
        await addProjectFromDirectoryPath(dirPath, t);
      },
    );
    const removeSelectAllListener = window.termcanvas.menu.onSelectAll(() => {
      performContextualSelectAll(
        document.activeElement,
        selectFocusedTerminalBuffer,
      );
    });

    return () => {
      removeOpenFolderListener();
      removeSelectAllListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    loadAllDownloadedFonts();
  }, []);

  // Hidrata el McpManager del proceso principal con la config por proyecto (state.json)
  // y mantiene .agents/mcp.json para que context-sync lo espeje cross-device.
  useEffect(() => {
    if (!window.termcanvas?.mcp) return;
    const { projects } = useProjectStore.getState();
    for (const p of projects) {
      if (p.mcp) void window.termcanvas.mcp.hydrateConfig(p.id, p.mcp, p.path).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const unsubscribe = useWorkspaceStore.subscribe(() => updateWindowTitle());
    updateWindowTitle();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const api = {
      getProjects: () => {
        const { projects } = useProjectStore.getState();
        return JSON.parse(
          JSON.stringify(
            projects.map((p: any) => ({
              id: p.id,
              name: p.name,
              path: p.path,
              collapsed: p.collapsed,
              worktrees: p.worktrees.map((w: any) => ({
                id: w.id,
                name: w.name,
                path: w.path,
                terminals: w.terminals.map((t: any) => {
                  const liveTerminal = resolveTerminalWithRuntimeState(t);
                  return {
                    id: liveTerminal.id,
                    title: liveTerminal.title,
                    customTitle: liveTerminal.customTitle,
                    starred: liveTerminal.starred,
                    type: liveTerminal.type,
                    status: liveTerminal.status,
                    ptyId: liveTerminal.ptyId,
                    width: liveTerminal.width,
                    height: liveTerminal.height,
                    parentTerminalId: liveTerminal.parentTerminalId,
                  };
                }),
              })),
            })),
          ),
        );
      },

      addProject: (projectData: any) => {
        useProjectStore.getState().addProject(projectData);
        return true;
      },

      removeProject: (projectId: string) => {
        useProjectStore.getState().removeProject(projectId);
        return true;
      },

      addTerminal: (
        projectId: string,
        worktreeId: string,
        type: string,
        prompt?: string,
        autoApprove?: boolean,
        parentTerminalId?: string | null,
      ) => {
        const terminal = createTerminalInScene({
          projectId,
          worktreeId,
          type: type as any,
          initialPrompt: prompt,
          autoApprove,
          origin: "agent",
          parentTerminalId: parentTerminalId ?? undefined,
        });
        return JSON.parse(JSON.stringify(terminal));
      },

      removeTerminal: (
        projectId: string,
        worktreeId: string,
        terminalId: string,
      ) => {
        closeTerminalInScene(projectId, worktreeId, terminalId);
        return true;
      },

      syncWorktrees: (projectPath: string, worktrees: any[]) => {
        useProjectStore.getState().syncWorktrees(projectPath, worktrees);
        return true;
      },

      getTerminal: (terminalId: string) => {
        const { projects } = useProjectStore.getState();
        for (const p of projects) {
          for (const w of p.worktrees) {
            const t = w.terminals.find((t: any) => t.id === terminalId);
            if (t) {
              const liveTerminal = resolveTerminalWithRuntimeState(t);
              return JSON.parse(
                JSON.stringify({
                  id: liveTerminal.id,
                  title: liveTerminal.title,
                  customTitle: liveTerminal.customTitle,
                  starred: liveTerminal.starred,
                  type: liveTerminal.type,
                  status: liveTerminal.status,
                  ptyId: liveTerminal.ptyId,
                  width: liveTerminal.width,
                  height: liveTerminal.height,
                  parentTerminalId: liveTerminal.parentTerminalId,
                  projectId: p.id,
                  worktreeId: w.id,
                  worktreePath: w.path,
                }),
              );
            }
          }
        }
        return null;
      },

      setCustomTitle: (terminalId: string, customTitle: string) => {
        const { projects } = useProjectStore.getState();
        for (const p of projects) {
          for (const w of p.worktrees) {
            const t = w.terminals.find((t) => t.id === terminalId);
            if (t) {
              updateTerminalCustomTitleInScene(
                p.id,
                w.id,
                terminalId,
                customTitle,
              );
              return true;
            }
          }
        }
        throw new Error("Terminal not found");
      },
    };

    (window as any).__tcApi = api;
    return () => {
      delete (window as any).__tcApi;
    };
  }, []);

  const factoryLabActive = useFactoryLabStore((s) => s.factoryLabActive);
  const workflowLabActive = useWorkflowLabStore((s) => s.workflowLabActive);
  // (warpPanelActive is subscribed once near the top — reused here.)
  // The hidden canvas tree depends on the Electron host bridge. Without it
  // (web renderer) its handlers would not exist anyway, so skip mounting it.
  // In Electron the bridge exists and the tree stays mounted to keep handlers alive.
  const hasHostBridge =
    typeof window !== "undefined" &&
    Boolean((window as unknown as { termcanvas?: unknown }).termcanvas);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]">
      <Toolbar />
      {workflowLabActive ? (
        <div className="fixed left-0 right-0 bottom-0 top-11 z-20 flex flex-col bg-[var(--bg)] overflow-hidden" role="main" aria-label="Workflows">
          <WorkflowLabPage />
        </div>
      ) : factoryLabActive ? (
        <div className="fixed left-0 right-0 bottom-0 top-11 z-20 flex flex-col bg-[var(--bg)] overflow-hidden" role="main" aria-label="Factory Lab">
          <FactoryLabPage />
        </div>
      ) : warpPanelActive ? (
        <>
          {/*
           * Keep the canvas tree mounted while the Warp panel is active.
           * XyFlowCanvas registers the issue handlers (resolve/review/merge/
           * fix/conflict) with cleanup on unmount that resets them to null,
           * so unmounting here leaves the panel with dead buttons. Hiding
           * with display:none preserves handlers and scene state. ReactFlow
           * re-measures via ResizeObserver when visible again, and terminal
           * positions live in the project store (source of truth), so the
           * layout restores exactly on return.
           *
           * The hidden tree is isolated in HiddenCanvasBoundary (fallback null)
           * so a host crash from the hidden canvas can never replace the Warp
           * panel. It is only mounted when the Electron bridge exists.
           */}
          {hasHostBridge ? (
            <HiddenCanvasBoundary>
              <div style={{ display: "none" }} aria-hidden="true">
                <LeftPanel />
                <RightPanel />
                <CanvasRoot />
                <BottomToolbar />
              </div>
            </HiddenCanvasBoundary>
          ) : null}
          <div className="fixed left-0 right-0 bottom-0 top-11 z-20 flex flex-col bg-[var(--bg)] overflow-hidden" role="main" aria-label="Warp Panel">
            <WarpPanelShell />
          </div>
        </>
      ) : (
        <>
          <LeftPanel />
          <RightPanel />
          <CanvasRoot />
          <BottomToolbar />
        </>
      )}
      {drawingEnabled && <DrawingPanel />}
      {completionGlowEnabled && <CompletionGlow />}
      <ShortcutHints />
      <DiscoveryCue />
      <StatusDigest />
      {composerEnabled && <ComposerBar />}
      <HandoffDragChip />
      <NotificationToast />
      {globalSearchEnabled && <SearchModal />}
      <CommandPalette />
      <SnapshotHistoryModal />
      <UsageOverlay />
      <SessionsOverlay />
      <FileEditorDrawer />
      <PinDetailDrawer />
      <Hub />
      <CanvasManagerModal />
    </div>
  );
}
