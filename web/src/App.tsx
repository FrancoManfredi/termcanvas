import { lazy, Suspense, useEffect, useState, useSyncExternalStore, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FactoryGlossary } from "./components/factories/FactoryGlossary";
import { useSelectedFactory, useFactoryWorkspaceStore } from "./lib/factory/hooks/useFactories";
import { isQuickstartFullscreenEnabled } from "./lib/factory/config/featureFlags";
import { DEFAULT_NAV_ITEM, assertNever } from "./nav";
import type { NavItemId } from "./nav";
import { HelpNavProvider } from "./components/help/HelpLinks";

const QuickstartWizard = lazy(() => import("./components/quickstart/QuickstartWizard").then((m) => ({ default: m.QuickstartWizard })));
const QuickstartFullscreen = lazy(() => import("./components/quickstart/QuickstartFullscreen").then((m) => ({ default: m.QuickstartFullscreen })));
const ActivityBoard = lazy(() => import("./components/activity/ActivityBoard").then((m) => ({ default: m.ActivityBoard })));
const DashboardPage = lazy(() => import("./components/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const AgentsPage = lazy(() => import("./components/agents/AgentsPage").then((m) => ({ default: m.AgentsPage })));
const AutomationsPage = lazy(() => import("./components/automations/AutomationsPage").then((m) => ({ default: m.AutomationsPage })));
const RunsPage = lazy(() => import("./components/runs/RunsPage").then((m) => ({ default: m.RunsPage })));
const ScorersPage = lazy(() => import("./components/scorers/ScorersPage").then((m) => ({ default: m.ScorersPage })));
const SkillsPage = lazy(() => import("./components/skills/SkillsPage").then((m) => ({ default: m.SkillsPage })));
const RunnersPage = lazy(() => import("./components/runners/RunnersPage").then((m) => ({ default: m.RunnersPage })));
const SecretsPage = lazy(() => import("./components/secrets/SecretsPage").then((m) => ({ default: m.SecretsPage })));
const IntegrationsPage = lazy(() => import("./components/integrations/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })));
const McpsPage = lazy(() => import("./components/mcp/McpsPage").then((m) => ({ default: m.McpsPage })));
const McpStubPage = lazy(() => import("./components/mcp/McpStubPage").then((m) => ({ default: m.McpStubPage })));
const FactoryApiPage = lazy(() => import("./components/factory-api/FactoryApiPage").then((m) => ({ default: m.FactoryApiPage })));
const FactoryDefinitionPage = lazy(() => import("./components/factory-definition/FactoryDefinitionPage").then((m) => ({ default: m.FactoryDefinitionPage })));
const SettingsPage = lazy(() => import("./components/factory-definition/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const BenchmarksPage = lazy(() => import("./components/benchmarks/BenchmarksPage").then((m) => ({ default: m.BenchmarksPage })));
const SelfImprovementPage = lazy(() => import("./components/self-improvement/SelfImprovementPage").then((m) => ({ default: m.SelfImprovementPage })));
const TroubleshootingPage = lazy(() => import("./components/help/TroubleshootingPage").then((m) => ({ default: m.TroubleshootingPage })));
const IntegrationsDeepDivesPage = lazy(() => import("./components/integrations-deep/IntegrationsDeepDivesPage").then((m) => ({ default: m.IntegrationsDeepDivesPage })));
const GitHubRoutingPage = lazy(() => import("./components/routing/GitHubRoutingPage").then((m) => ({ default: m.GitHubRoutingPage })));
const InfraPage = lazy(() => import("./components/infra/InfraPage").then((m) => ({ default: m.InfraPage })));
const ValidationPage = lazy(() => import("./components/validation/ValidationPage").then((m) => ({ default: m.ValidationPage })));

function getInitialNav(): NavItemId {
  if (typeof window === "undefined") return DEFAULT_NAV_ITEM;
  const hash = window.location.hash.slice(1);
  if (["setup", "work-not-starting", "two-runs", "runs-stuck", "no-pr", "factory-api", "setting-up", "work-isnt-starting", "runs-and-work-items"].includes(hash)) {
    return "Troubleshooting";
  }
  return DEFAULT_NAV_ITEM;
}

function useFactoryCount(): number {
  const store = useFactoryWorkspaceStore();
  // useSyncExternalStore before render shell — evita flash
  const count = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.list().length,
    () => 0,
  );
  return count;
}

function isQuickstartPath(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return p === "/quickstart" || p === "/quickstart/";
}

export default function App() {
  const [activeItem, setActiveItem] = useState<NavItemId>(getInitialNav);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const selectedFactory = useSelectedFactory();
  const factoryCount = useFactoryCount();
  const [path, setPath] = useState(() => (typeof window !== "undefined" ? window.location.pathname : "/"));

  const handleNavigate = useCallback((item: NavItemId) => {
    setActiveItem(item);
  }, []);

  function handleToggleSidebar() {
    setSidebarCollapsed((v) => !v);
  }

  // Alias /quickstart vía pushState sin react-router
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const flagOn = isQuickstartFullscreenEnabled();
  const shouldFullscreen = flagOn && factoryCount === 0;
  const quickstartAlias = isQuickstartPath();

  // Si es /quickstart con 0 factories → fullscreen igual
  // Si es /factory/:uid/dashboard → mostrar Dashboard directo
  const isFactoryDashboardPath = path.startsWith("/factory/") && path.endsWith("/dashboard");

  if (shouldFullscreen || quickstartAlias) {
    // Evita flash: primera pintura ya es fullscreen si count 0
    // Si estamos en alias /quickstart pero ya hay factories, mostrar fullscreen igual? Solo si count 0
    const showFullscreen = shouldFullscreen || (quickstartAlias && factoryCount === 0);
    if (showFullscreen) {
      return (
        <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center p-6 text-sm text-zinc-500">Cargando...</div>}>
          <ErrorBoundary>
            <QuickstartFullscreen
              onComplete={(uid) => {
                // Tras crear, navegar a dashboard de esa factory
                try {
                  window.history.pushState(null, "", `/factory/${encodeURIComponent(uid)}/dashboard`);
                  setPath(`/factory/${encodeURIComponent(uid)}/dashboard`);
                } catch {
                  // ignore
                }
                setActiveItem("Dashboard");
              }}
            />
          </ErrorBoundary>
        </Suspense>
      );
    }
  }

  // Si pathname es /factory/:uid/dashboard, render DashboardPage directo sin gate
  if (isFactoryDashboardPath) {
    return (
      <div className="flex h-screen overflow-hidden bg-canvas text-zinc-900 antialiased">
        <Sidebar
          activeItem="Dashboard"
          onNavigate={handleNavigate}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={handleToggleSidebar}
        />
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas">
          <ErrorBoundary>
            <HelpNavProvider navigate={handleNavigate}>
              <Suspense fallback={<div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">Cargando...</div>}>
                <DashboardPage />
              </Suspense>
            </HelpNavProvider>
          </ErrorBoundary>
        </main>
      </div>
    );
  }

  function renderContent() {
    switch (activeItem) {
      case "Quickstart":
        return (
          <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Cargando...</div>}>
            <QuickstartWizard
              onComplete={(uid) => {
                try {
                  if (uid) {
                    window.history.pushState(null, "", `/factory/${encodeURIComponent(uid)}/dashboard`);
                    setPath(`/factory/${encodeURIComponent(uid)}/dashboard`);
                  }
                } catch {
                  // ignore
                }
                setActiveItem("Dashboard");
              }}
            />
          </Suspense>
        );
      case "Dashboard":
        return <DashboardPage />;
      case "Activity":
        return <ActivityBoard />;
      case "Agents":
        return <AgentsPage />;
      case "Automations":
        return <AutomationsPage />;
      case "Runs":
        return <RunsPage scope="factory" factoryName={selectedFactory?.name ?? "payments-factory"} />;
      case "Team Runs":
        return <RunsPage scope="team" />;
      case "Runners":
        return <RunnersPage />;
      case "Scorers":
        return <ScorersPage />;
      case "Skills":
        return <SkillsPage />;
      case "Benchmarks":
        return <BenchmarksPage />;
      case "MCP tools":
        return <McpStubPage />;
      case "Factory API":
        return <FactoryApiPage />;
      case "Factory definition":
        return <FactoryDefinitionPage />;
      case "Settings":
        return <SettingsPage />;
      case "Self-improvement":
        return <SelfImprovementPage />;
      case "Troubleshooting":
        return <TroubleshootingPage />;
      case "Infra":
        return <InfraPage />;
      case "Validation":
        return <ValidationPage />;
      case "Integrations Deep Dives":
        return <IntegrationsDeepDivesPage />;
      case "GitHub routing":
        return <GitHubRoutingPage />;
      case "GitLab Deep Dive":
        return <IntegrationsDeepDivesPage initialTab="gitlab" />;
      case "Slack Deep Dive":
        return <IntegrationsDeepDivesPage initialTab="slack" />;
      case "Linear Deep Dive":
        return <IntegrationsDeepDivesPage initialTab="linear" />;
      case "Jira Deep Dive":
        return <IntegrationsDeepDivesPage initialTab="jira" />;
      case "Schedule Deep Dive":
        return <IntegrationsDeepDivesPage initialTab="schedule" />;
      case "Factory Deep Dive":
        return <IntegrationsDeepDivesPage initialTab="factory" />;
      case "Secrets":
        return <SecretsPage />;
      case "Integrations":
        return <IntegrationsPage />;
      case "MCPs and apps":
        return <McpsPage />;
      case "Help":
        return (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
            <FactoryGlossary />
            <TroubleshootingPage />
          </div>
        );
      default:
        return assertNever(activeItem);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-zinc-900 antialiased">
      <Sidebar
        activeItem={activeItem}
        onNavigate={handleNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleSidebar}
      />
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas">
        <ErrorBoundary>
          <HelpNavProvider navigate={handleNavigate}>
            <Suspense fallback={<div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">Cargando...</div>}>{renderContent()}</Suspense>
          </HelpNavProvider>
        </ErrorBoundary>
      </main>
    </div>
  );
}
