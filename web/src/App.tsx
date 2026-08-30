import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ActivityBoard } from "./components/activity/ActivityBoard";
import { DashboardPage } from "./components/dashboard/DashboardPage";
import { AgentsPage } from "./components/agents/AgentsPage";
import { AutomationsPage } from "./components/automations/AutomationsPage";
import { RunsPage } from "./components/runs/RunsPage";
import { ScorersPage } from "./components/scorers/ScorersPage";
import { SkillsPage } from "./components/skills/SkillsPage";
import { RunnersPage } from "./components/runners/RunnersPage";
import { SecretsPage } from "./components/secrets/SecretsPage";
import { IntegrationsPage } from "./components/integrations/IntegrationsPage";
import { McpsPage } from "./components/mcp/McpsPage";
import { FactoryDefinitionPage } from "./components/factory-definition/FactoryDefinitionPage";
import { SettingsPage } from "./components/factory-definition/SettingsPage";
import { BenchmarksPage } from "./components/benchmarks/BenchmarksPage";
import { SelfImprovementPage } from "./components/self-improvement/SelfImprovementPage";
import { TroubleshootingPage } from "./components/help/TroubleshootingPage";
import { IntegrationsDeepDivesPage } from "./components/integrations-deep/IntegrationsDeepDivesPage";
import { InfraPage } from "./components/infra/InfraPage";
import { ValidationPage } from "./components/validation/ValidationPage";

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
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f6f6f6]">{renderContent()}</main>
    </div>
  );
}
