import { Activity, useDeferredValue, useEffect, useRef, useState } from "react";
import "./tokens.css";
import type { NavSection } from "./types";
import {
  isValidPanelSection,
  loadPersistedPanelSection,
  persistPanelSection,
  shouldEnableFactoryPoll,
} from "./panelSection";
import { activityLog } from "./activityDebug";
import { installWarpCrashRecorder } from "./warpCrashRecorder";
import { KANBAN_COLUMNS } from "./adapters/mockIssues";
import { useIssues } from "./hooks/useIssues";
import {
  splitBatches,
  shouldForcePrLookupOnMount,
} from "./hooks/useActivity";
import { useIssueReviewStore } from "../../stores/issueReviewStore";
import { useWorkItemsPolling } from "../factoryLab/hooks/useWorkItemsPolling";
import { WarpSidePanel } from "./components/WarpSidePanel";
import { KanbanBoard } from "./components/KanbanBoard";
import { IssueDrawer } from "./components/IssueDrawer";
import ActivityPanel from "./components/ActivityPanel";
import { AgentsConsole } from "./agents/AgentsConsole";
import { WorkflowsPanel } from "./workflows/components/WorkflowsPanel";
import { DependenciesPanel } from "./components/DependenciesPanel";
import { WarpPanelBoundary } from "./components/WarpPanelBoundary";

/**
 * WarpPanelShell — port of figma/Crear panel lateral interactivo src/App.tsx.
 *
 * Same state logic (activeSection, default "issues"), same fallback
 * placeholder for unimplemented sections. Root carries className="warppanel"
 * so the scoped tokens/keyframes/scrollbar/focus styles apply.
 *
 * Track A wiring: the issues section renders KanbanBoard fed by useIssues
 * (data only via the hook — components never touch adapters/fetch).
 * The drawer mounts here (shell level) so its fixed backdrop covers the
 * sidebar too; visually identical to the Figma mount inside KanbanBoard.
 *
 * Track B wiring: activity/agents render the Track B panels, which are
 * self-sufficient (internal useActivity/useAgents with optional prop
 * overrides). Shell owns activeSection; panels stay prop-pure.
 */

export function WarpPanelShell() {
  // Shared factory poll (SINGLE 2.5s loop — the hook refcounts mounts, so
  // zero new polls): the warp panel resolves issues via factory jobs, but
  // FactoryLabPage (the previous only mount) is mutually exclusive with
  // this shell in App.tsx. Without this mount the poll list stays empty
  // while the panel is open and resolved rows never reach In Progress.
  // Perf Ola 1: paused in Agents (config-only, user-approved stale) so the
  // 2.5s setWorkItems storm stops re-rendering the Agents editor while typing.
  const [activeSection, setActiveSectionState] = useState<NavSection>(() => {
    try {
      return loadPersistedPanelSection();
    } catch {
      return "issues";
    }
  });
  useWorkItemsPolling(
    shouldEnableFactoryPoll(activeSection),
    "summary",
    false,
  );
  useEffect(() => {
    activityLog("WarpPanelShell: sección activa", {
      activeSection,
      factoryPoll: shouldEnableFactoryPoll(activeSection),
    });
  }, [activeSection]);
  // Crash ring (offline hunt, not a guess): window error/unhandledrejection
  // recorder mounted at the very top of the panel. Never throws, never
  // blocks; the section is read via ref so the handler always sees the
  // current value. Read it in DevTools → Application → Local Storage →
  // `warp-last-crash` (ring of 3: { at, message, stack ≤500 chars, section }).
  const sectionRef = useRef<NavSection>(activeSection);
  sectionRef.current = activeSection;
  useEffect(() => {
    try {
      return installWarpCrashRecorder(() => sectionRef.current);
    } catch {
      return undefined;
    }
  }, []);
  // Persisted section (item 2): survives transitions/remounts like the
  // rest of the warp UI state — see `panelSection.ts`.
  const setActiveSection = (section: NavSection): void => {
    activityLog("WarpPanelShell.setActiveSection", {
      from: activeSection,
      to: section,
    });
    try {
      if (!isValidPanelSection(section)) return;
      setActiveSectionState(section);
      persistPanelSection(section);
    } catch {
      // A bad section never breaks the shell.
    }
  };
  const { issues, openIssueId, openIssue, closeIssue, changeStatus } =
    useIssues();

  // Perf P1c: pre-warm del PR cache en background al abrir el panel (una
  // sola vez por montaje, nunca en Agents). Tricket lento y no-forzado de
  // los no-cacheados para que el primer switch a Issues/Activity encuentre
  // verdicts ya resueltos en vez de pagar N lookups forzados de golpe. El
  // mount de cada sección igual gatea lo que falte (fuerza solo no-cache).
  const warmedRef = useRef(false);
  useEffect(() => {
    if (warmedRef.current) return;
    if (activeSection === "agents") return;
    // Espera datos reales: con lista vacía no hay nada que precalentar y
    // el efecto reintenta cuando el poll pueble `issues`.
    if (!Array.isArray(issues) || issues.length === 0) return;
    warmedRef.current = true;
    let cancelled = false;
    const timers: number[] = [];
    const clearTimers = (): void => {
      for (const t of timers) {
        try {
          window.clearTimeout(t);
        } catch {
          // noop
        }
      }
      timers.length = 0;
    };
    const warm = (): void => {
      if (cancelled) return;
      try {
        const state = useIssueReviewStore.getState();
        const pending = issues.filter((issue) => {
          try {
            return shouldForcePrLookupOnMount(
              state.prsByIssue[issue.id],
              issue.status,
            );
          } catch {
            return false;
          }
        }).slice(0, 24);
        const batches = splitBatches(pending, 6);
        batches.forEach((batch, i) => {
          timers.push(
            window.setTimeout(() => {
              if (cancelled) return;
              try {
                const live = useIssueReviewStore.getState();
                for (const issue of batch) {
                  live.requestPrLookup(
                    issue.id,
                    issue.worktreePath || undefined,
                    false,
                  );
                }
              } catch {
                // best-effort
              }
            }, i * 400),
          );
        });
      } catch {
        // best-effort
      }
    };
    let idleId: number | null = null;
    let fallbackTimer: number | null = null;
    try {
      const ric = (
        window as unknown as {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number },
          ) => number;
          cancelIdleCallback?: (id: number) => void;
        }
      ).requestIdleCallback;
      if (typeof ric === "function") {
        idleId = ric.call(window, () => warm(), { timeout: 3000 });
      } else {
        fallbackTimer = window.setTimeout(warm, 1200);
      }
    } catch {
      // best-effort: sin warm no se rompe nada
    }
    return () => {
      cancelled = true;
      clearTimers();
      try {
        if (idleId !== null) {
          (
            window as unknown as {
              cancelIdleCallback?: (id: number) => void;
            }
          ).cancelIdleCallback?.(idleId);
        }
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      } catch {
        // noop
      }
    };
  }, [issues, activeSection]);

  // Row isolation: a mistyped `issues` slice (bad hydrate) degrades to
  // no drawer instead of throwing mid-render in the shell (outside
  // `WarpPanelBoundary`).
  const openIssueData = (() => {
    try {
      if (openIssueId == null) return null;
      if (!Array.isArray(issues)) return null;
      return (issues.find((i) => i?.id === openIssueId) ?? null) as
        | (typeof issues)[number]
        | null;
    } catch {
      return null;
    }
  })();

  // Perf Ola B4: deferred content section — the sidebar highlights instantly
  // on `activeSection` while the heavy board (snapshot + N rows) swaps when
  // React is ready. No unmount/remount churn mid-transition, no skeleton
  // flash: the previous section simply stays painted one beat longer.
  const deferredSection = useDeferredValue(activeSection);
  const showDeferredIssues = deferredSection === "issues";
  const showDeferredActivity = deferredSection === "activity";
  const showDeferredAgents = deferredSection === "agents";
  const showDeferredWorkflows = deferredSection === "workflows";
  const showDeferredDependencies = deferredSection === "dependencies";
  // Perf P2: keep-alive por sección (React 19 `<Activity>`): volver a una
  // sección ya no remonta (scroll, selección y draft se conservan) y los
  // effects se destruyen al ocultar (sin trabajo fantasma). Las secciones
  // se montan LAZY en la primera visita para no pagar 3 snapshots en la
  // apertura; los memos + guards absorben los re-renders depriorizados en
  // oculto. Memoria extra: 3 listas en DOM (asumido por el usuario).
  // Workflows queda fuera del keep-alive: React Flow mide mal su contenedor
  // bajo `display:none` y el estado de la sección es barato de recrear.
  const [seenSections, setSeenSections] = useState<Record<NavSection, boolean>>(() => ({
    issues: activeSection === "issues",
    activity: activeSection === "activity",
    agents: activeSection === "agents",
    workflows: activeSection === "workflows",
    context: activeSection === "context",
    diagnostic: activeSection === "diagnostic",
    dependencies: activeSection === "dependencies",
  }));
  useEffect(() => {
    setSeenSections((seen) =>
      seen[deferredSection] ? seen : { ...seen, [deferredSection]: true },
    );
  }, [deferredSection]);  return (
    <div
      className="warppanel"
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        background: "var(--wp-bg)",
        fontFamily: "var(--wp-font-sans)",
      }}
    >
      <WarpSidePanel
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />

      <main
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "var(--wp-bg)",
        }}
      >
        {/* Panel-scoped boundary (item 2): a render throw inside the
            panel recovers here by state — never via the root boundary's
            full-app reload. */}
        <WarpPanelBoundary>
          {seenSections.issues && (
            <Activity mode={showDeferredIssues ? "visible" : "hidden"}>
              <KanbanBoard
                issues={issues}
                columns={KANBAN_COLUMNS}
                onStatusChange={changeStatus}
                onOpenIssue={openIssue}
              />
            </Activity>
          )}
          {seenSections.activity && (
            <Activity mode={showDeferredActivity ? "visible" : "hidden"}>
              <ActivityPanel />
            </Activity>
          )}
          {seenSections.agents && (
            <Activity mode={showDeferredAgents ? "visible" : "hidden"}>
              <AgentsConsole />
            </Activity>
          )}
          {showDeferredWorkflows && <WorkflowsPanel />}
          {seenSections.dependencies && (
            <Activity mode={showDeferredDependencies ? "visible" : "hidden"}>
              <DependenciesPanel />
            </Activity>
          )}
          {!showDeferredIssues && !showDeferredActivity && !showDeferredAgents && !showDeferredWorkflows && !showDeferredDependencies && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--wp-font-mono)",
                  fontSize: 11,
                  color: "#2e2e2e",
                }}
              >
                {activeSection}
              </span>
            </div>
          )}
        </WarpPanelBoundary>
      </main>

      {openIssueData && (
        <IssueDrawer
          issue={openIssueData}
          columns={KANBAN_COLUMNS}
          onClose={closeIssue}
          onStatusChange={(s) => changeStatus(openIssueData.id, s)}
        />
      )}
    </div>
  );
}
