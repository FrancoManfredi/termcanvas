import type { AgentDefinition, FactoryDefinition } from "../../lib/factory/domain/types";


function getAgentTypeLabel(type: string): string {
  return type;
}

function getAgentTypeColor(type: string): string {
  switch (type) {
    case "FOREMAN":
    case "MAIN":
      return "bg-violet-600 text-white";
    case "TRIAGE":
      return "bg-amber-500 text-white";
    case "SPEC":
      return "bg-sky-600 text-white";
    case "IMPLEMENT":
      return "bg-emerald-600 text-white";
    case "REVIEW":
      return "bg-red-500 text-white";
    case "VERIFY":
      return "bg-zinc-700 text-white";
    case "CUSTOM":
    default:
      return "bg-zinc-500 text-white";
  }
}

function getHarnessOrModelSummary(agent: AgentDefinition, factory: FactoryDefinition): string {
  if (agent.harness) {
    const m = agent.harness.model ? ` / ${agent.harness.model}` : "";
    return `${agent.harness.type}${m}`;
  }
  if (agent.model) {
    return agent.model;
  }
  if (factory.agentDefaults.harness) {
    const h = factory.agentDefaults.harness;
    return `${h.type} (inherited)`;
  }
  if (factory.agentDefaults.model) {
    return `${factory.agentDefaults.model} (inherited)`;
  }
  return "—";
}

function getRunnerSummary(agent: AgentDefinition, factory: FactoryDefinition): string {
  const r = agent.runner ?? factory.agentDefaults.runner ?? "—";
  return r;
}

export interface AgentCardProps {
  agent: AgentDefinition;
  factory: FactoryDefinition;
  selected: boolean;
  onSelect: (name: string) => void;
}

export function AgentCard({ agent, factory, selected, onSelect }: AgentCardProps) {
  function handleClick() {
    onSelect(agent.name);
  }
  const harnessSummary = getHarnessOrModelSummary(agent, factory);
  const runnerSummary = getRunnerSummary(agent, factory);
  const color = getAgentTypeColor(agent.agentType);

  return (
    <button
      onClick={handleClick}
      aria-current={selected ? "true" : undefined}
      aria-label={`Select agent ${agent.name}`}
      className={[
        "flex w-full flex-col gap-2 rounded-[10px] border px-3 py-3 text-left transition-[background-color,box-shadow,scale] duration-150",
        selected
          ? "border-violet-300 bg-violet-50 shadow-[0_1px_3px_rgba(124,58,237,0.12)]"
          : "border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300",
      ].join(" ")}
      style={{ willChange: "transform" }}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase ${color}`}>
          {getAgentTypeLabel(agent.agentType)}
        </span>
        <span className="truncate text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">{agent.name}</span>
        {selected && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-600" aria-hidden />}
      </div>
      {agent.description && (
        <p className="line-clamp-2 text-[12.5px] leading-snug text-zinc-600">{agent.description}</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          {harnessSummary}
        </span>
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          runner: {runnerSummary}
        </span>
      </div>
      <span className="truncate font-mono text-[11px] text-zinc-400">{agent.rawPath}</span>
    </button>
  );
}

export default AgentCard;
