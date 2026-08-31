import { useState } from "react";
import { ScorersList } from "./ScorersList";
import { NewScorerForm } from "./NewScorerForm";
import { useFigmaScorers, useFigmaAgents } from "../../../lib/factory/hooks/useFigmaFixtures";
import type { Scorer } from "../../../lib/factory/fixtures/figma.fixtures";

export function ScorersPage({ factoryName = "My factory" }: { factoryName?: string }) {
  const initial = useFigmaScorers();
  const agents = useFigmaAgents();
  const [scorers, setScorers] = useState<Scorer[]>([...initial] as Scorer[]);
  const [view, setView] = useState<"list" | "new">("list");

  if (view === "new") {
    return (
      <NewScorerForm
        factoryName={factoryName}
        agents={agents}
        onBack={() => setView("list")}
        onSave={(s) => {
          setScorers((p) => [s, ...p]);
          setView("list");
        }}
      />
    );
  }

  return (
    <ScorersList
      factoryName={factoryName}
      scorers={scorers}
      agents={agents}
      onNew={() => setView("new")}
      onDelete={(id) => setScorers((p) => p.filter((s) => s.id !== id))}
    />
  );
}
