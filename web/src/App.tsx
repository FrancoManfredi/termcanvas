import { lazy, Suspense, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FactoryGlossary } from "./components/factories/FactoryGlossary";
import { useSelectedFactory } from "./lib/factory/hooks/useFactories";
import { DEFAULT_NAV_ITEM, assertNever } from "./nav";
import type { NavItemId } from "./nav";
import { HelpNavProvider } from "./components/help/HelpLinks";

const QuickstartWizard = lazy(() => import("./components/quickstart/QuickstartWizard").then((m) => ({ default: m.QuickstartWizard })));
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

export default function App() {
  const [activeItem, setActiveItem] = useState<NavItemId>(getInitialNav);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // R4: el nombre sale de la factory seleccionada en el workspace, no de un literal.
  const selectedFactory = useSelectedFactory();

  function handleNavigate(item: NavItemId) {
    setActiveItem(item);
  }

  function handleToggleSidebar() {
    setSidebarCollapsed((v) => !v);
  }

  // Exhaustive switch: adding a NavItemId without its case turns this `default` into a type error.
  function renderContent() {
    switch (activeItem) {
      case "Quickstart":
        return <QuickstartWizard onComplete={() => setActiveItem("Activity")} />;
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
        // US-006: la triada va arriba como banda fija; abajo, el troubleshooting de §18.
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
        {/* 19 lazy() pages with no protection before: a failing chunk used to blank the whole app. */}
        <ErrorBoundary>
          <HelpNavProvider navigate={handleNavigate}>
            <Suspense fallback={<div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">Cargando...</div>}>{renderContent()}</Suspense>
          </HelpNavProvider>
        </ErrorBoundary>
      </main>
    </div>
  );
}
