import { useState } from "react";
import { AutomationsList } from "./AutomationsList";
import { NewAutomationForm } from "./NewAutomationForm";
import { useFigmaAutomations, useFigmaAgents } from "../../../lib/factory/hooks/useFigmaFixtures";
import type { Automation } from "../../../lib/factory/fixtures/figma.fixtures";

export function AutomationsPage({ factoryName = "My factory" }: { factoryName?: string }) {
  const initial = useFigmaAutomations();
  const agents = useFigmaAgents();
  const [automations, setAutomations] = useState<Automation[]>([...initial] as Automation[]);
  const [view, setView] = useState<"list" | "new">("list");

  if (view === "new") {
    return (
      <NewAutomationForm
        factoryName={factoryName}
        agents={agents}
        onBack={() => setView("list")}
        onSave={(a) => {
          setAutomations((p) => [...p, a]);
          setView("list");
        }}
      />
    );
  }

  return <AutomationsList factoryName={factoryName} automations={automations} onNew={() => setView("new")} />;
}
