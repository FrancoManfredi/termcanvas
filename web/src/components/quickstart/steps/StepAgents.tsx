// StepAgents — SRP: Paso 5 — elegir agentes (informativo, guarda preferencia)

import type { AgentToggleKey } from "../../../lib/factory/domain/factory.record";

const AGENT_LABELS: Readonly<Record<AgentToggleKey, string>> = {
  triage: "Triage",
  spec: "Spec",
  implement: "Implement",
  review: "Review",
};

export interface StepAgentsProps {
  readonly agents: Readonly<Record<AgentToggleKey, boolean>>;
  readonly onToggle: (agent: AgentToggleKey) => void;
}

export function StepAgents({ agents, onToggle }: StepAgentsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(Object.keys(AGENT_LABELS) as AgentToggleKey[]).map((agent) => (
        <label key={agent} className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 focus-within:ring-2 focus-within:ring-violet-500/20">
          <span className="font-medium text-zinc-900">{AGENT_LABELS[agent]}</span>
          <input
            type="checkbox"
            checked={agents[agent]}
            disabled={agent === "implement"}
            onChange={() => onToggle(agent)}
          />
        </label>
      ))}
    </div>
  );
}
