import { lazy, Suspense, useState, useCallback } from "react";
import { Sidebar } from "./components/shell/Sidebar";
import { ErrorBoundary } from "./components/shell/ErrorBoundary";
import { WizardShell } from "./components/wizard/WizardShell";
import { StepConnectHost } from "./components/wizard/steps/StepConnectHost";
import { StepSelectRepo } from "./components/wizard/steps/StepSelectRepo";
import { StepPersonality } from "./components/wizard/steps/StepPersonality";
import { StepConfigureAgents } from "./components/wizard/steps/StepConfigureAgents";
import { StepTrackers } from "./components/wizard/steps/StepTrackers";
import { StepStartup } from "./components/wizard/steps/StepStartup";
import { DEFAULT_NAV_ITEM, assertNever } from "./nav";
import type { NavItemId } from "./nav";
import type { FactoryConfig } from "./components/wizard/wizard.types";

const AgentsPage = lazy(() => import("./components/pages/agents/AgentsPage.container").then((m) => ({ default: m.AgentsPage })));
const ActivityPage = lazy(() => import("./components/pages/activity/ActivityPage.container").then((m) => ({ default: m.ActivityPage })));
const RunsPage = lazy(() => import("./components/pages/runs/RunsPage.container").then((m) => ({ default: m.RunsPage })));
const AutomationsPage = lazy(() => import("./components/pages/automations/AutomationsPage.container").then((m) => ({ default: m.AutomationsPage })));
const ScorersPage = lazy(() => import("./components/pages/scorers/ScorersPage.container").then((m) => ({ default: m.ScorersPage })));
const PlaceholderPage = lazy(() => import("./components/pages/placeholders/PlaceholderPage").then((m) => ({ default: m.PlaceholderPage })));

type AppMode = "wizard" | "app";
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export default function App() {
  const [mode, setMode] = useState<AppMode>("wizard");
  const [step, setStep] = useState<WizardStep>(1);
  const [activeItem, setActiveItem] = useState<NavItemId>(DEFAULT_NAV_ITEM);
  const [config, setConfigState] = useState<FactoryConfig>({ selectedRepo: null, factoryName: "", foremanName: "", description: "", agents: { triage: true, spec: true, code: true, review: true }, trackers: { linear: false, jira: false } });
  const factoryName = config.factoryName || "My factory";
  const setConfig = useCallback((p: Partial<FactoryConfig>) => setConfigState((prev) => ({ ...prev, ...p })), []);
  const goNext = useCallback(() => setStep((s) => Math.min(s + 1, 6) as WizardStep), []);
  const goBack = useCallback(() => setStep((s) => Math.max(s - 1, 1) as WizardStep), []);

  function renderContent() {
    switch (activeItem) {
      case "Team Runs":
      case "MCPs and apps":
      case "Secrets":
      case "Integrations":
        return <PlaceholderPage label={activeItem} />;
      case "Dashboard":
      case "Self-improvement":
      case "Factory definition":
      case "Settings":
        return <PlaceholderPage label={activeItem} />;
      case "Agents":
        return <AgentsPage factoryName={factoryName} />;
      case "Activity":
        return <ActivityPage factoryName={factoryName} />;
      case "Runs":
        return <RunsPage factoryName={factoryName} />;
      case "Automations":
        return <AutomationsPage factoryName={factoryName} />;
      case "Scorers":
        return <ScorersPage factoryName={factoryName} />;
      default:
        return assertNever(activeItem);
    }
  }

  if (mode === "wizard") {
    if (step === 6) return <StepStartup onOpenFactory={() => setMode("app")} />;
    return (
      <WizardShell onExit={() => setStep(1)} step={step} total={5}>
        {step === 1 && <StepConnectHost onNext={goNext} />}
        {step === 2 && <StepSelectRepo selectedId={config.selectedRepo?.id ?? null} onSelect={(r) => setConfig({ selectedRepo: r })} onNext={goNext} onBack={goBack} />}
        {step === 3 && <StepPersonality config={config} onChange={setConfig} onNext={goNext} onBack={goBack} />}
        {step === 4 && <StepConfigureAgents config={config} onChange={setConfig} onNext={goNext} onBack={goBack} />}
        {step === 5 && <StepTrackers config={config} onChange={setConfig} onNext={() => setStep(6)} onBack={goBack} />}
      </WizardShell>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white text-zinc-900 antialiased">
      <Sidebar factoryName={factoryName} activePage={activeItem} onNav={setActiveItem} />
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
        <ErrorBoundary>
          <Suspense fallback={<div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">Loading…</div>}>{renderContent()}</Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
