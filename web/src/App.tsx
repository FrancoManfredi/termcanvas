import { lazy, Suspense, useState } from "react";
import { Sidebar } from "./components/Sidebar";

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
const FactoryDefinitionPage = lazy(() => import("./components/factory-definition/FactoryDefinitionPage").then((m) => ({ default: m.FactoryDefinitionPage })));
const SettingsPage = lazy(() => import("./components/factory-definition/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const BenchmarksPage = lazy(() => import("./components/benchmarks/BenchmarksPage").then((m) => ({ default: m.BenchmarksPage })));
const SelfImprovementPage = lazy(() => import("./components/self-improvement/SelfImprovementPage").then((m) => ({ default: m.SelfImprovementPage })));
const TroubleshootingPage = lazy(() => import("./components/help/TroubleshootingPage").then((m) => ({ default: m.TroubleshootingPage })));
const IntegrationsDeepDivesPage = lazy(() => import("./components/integrations-deep/IntegrationsDeepDivesPage").then((m) => ({ default: m.IntegrationsDeepDivesPage })));
const InfraPage = lazy(() => import("./components/infra/InfraPage").then((m) => ({ default: m.InfraPage })));
const ValidationPage = lazy(() => import("./components/validation/ValidationPage").then((m) => ({ default: m.ValidationPage })));

export default function App() {
  const [activeItem, setActiveItem] = useState("Activity");

  function handleNavigate(item: string) {
    setActiveItem(item);
  }

  function renderContent() {
    switch (activeItem) {
      case "Dashboard":
        return <DashboardPage />;
      case "Activity":
        return <ActivityBoard />;
      case "Agents":
        return <AgentsPage />;
      case "Automations":
        return <AutomationsPage />;
      case "Runs":
        return <RunsPage scope="factory" factoryName="payments-factory" />;
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
      case "Factory definition":
        return <FactoryDefinitionPage />;
      case "Settings":
        return <SettingsPage />;
      case "Secrets":
        return <SecretsPage />;
      case "Integrations":
        return <IntegrationsPage />;
      case "MCPs and apps":
        return <McpsPage />;
      case "Self-improvement":
        return <SelfImprovementPage />;
      case "Troubleshooting":
      case "Help":
        return <TroubleshootingPage />;
      case "Integrations Deep Dives":
      case "GitLab Deep Dive":
      case "Slack Deep Dive":
      case "Linear Deep Dive":
      case "Jira Deep Dive":
        return <IntegrationsDeepDivesPage />;
      case "Infra":
        return <InfraPage />;
      case "Validation":
        return <ValidationPage />;
      default:
        return (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
              <p className="text-sm font-medium text-zinc-700">{activeItem}</p>
              <p className="mt-1 text-xs text-zinc-500">Vista en construcción — próximo paso</p>
            </div>
          </div>
        );
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f6f6] text-zinc-900 antialiased">
      <Sidebar activeItem={activeItem} onNavigate={handleNavigate} />
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f6f6f6]">
        <Suspense fallback={<div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">Cargando...</div>}>{renderContent()}</Suspense>
      </main>
    </div>
  );
}
