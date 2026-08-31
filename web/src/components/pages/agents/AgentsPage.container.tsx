import { useState } from "react";
import { AgentList } from "./AgentList";
import { AgentDetail } from "./AgentDetail";
import { NewAgentForm } from "./NewAgentForm";
import { useFigmaAgents } from "../../../lib/factory/hooks/useFigmaFixtures";
import type { Agent } from "../../../lib/factory/fixtures/figma.fixtures";

export function AgentsPage({ factoryName = "My factory" }: { factoryName?: string }) {
  const initial = useFigmaAgents();
  const [agents, setAgents] = useState<Agent[]>([...initial] as Agent[]);
  const [view, setView] = useState<"list" | "new" | string>("list");

  const activeAgent = view !== "list" && view !== "new" ? agents.find((a) => a.id === view) ?? null : null;

  if (view === "new") {
    return (
      <NewAgentForm
        onBack={() => setView("list")}
        onSave={(a) => {
          setAgents((prev) => [...prev, a]);
          setView(a.id);
        }}
      />
    );
  }
  if (activeAgent) return <AgentDetail agent={activeAgent} onBack={() => setView("list")} />;

  return <AgentList factoryName={factoryName} agents={agents} onSelect={setView} onNew={() => setView("new")} />;
}
