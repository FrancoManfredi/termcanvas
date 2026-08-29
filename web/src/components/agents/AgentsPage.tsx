import { useMemo, useState } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import type { AgentDefinition } from "../../lib/factory/domain/types";
import { AgentCard } from "./AgentCard";
import { AgentDetail } from "./AgentDetail";


function sortAgentsForDisplay(agents: AgentDefinition[]): AgentDefinition[] {
  const order: Record<string, number> = {
    FOREMAN: 0,
    MAIN: 0,
    TRIAGE: 1,
    SPEC: 2,
    IMPLEMENT: 3,
    REVIEW: 4,
    VERIFY: 5,
    CUSTOM: 99,
  };
  const sorted = [...agents].sort((a, b) => {
    const ao = order[a.agentType] ?? 99;
    const bo = order[b.agentType] ?? 99;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
  return sorted;
}

function getSelectedAgent(agents: AgentDefinition[], selectedName: string | null): AgentDefinition | null {
  if (!selectedName) {
    return agents[0] ?? null;
  }
  const found = agents.find((a) => a.name === selectedName) ?? null;
  return found ?? agents[0] ?? null;
}

export function AgentsPage() {
  const bundleResult = useFactoryBundle();

  const [selectedName, setSelectedName] = useState<string | null>(null);

  function handleSelect(name: string) {
    setSelectedName(name);
  }

  const content = useMemo(() => {
    if (!bundleResult.ok) {
      return { error: bundleResult.issues.map((i) => i.message).join("; "), factory: null, agents: [] as AgentDefinition[] };
    }
    const sorted = sortAgentsForDisplay(bundleResult.value!.agents);
    return { error: null, factory: bundleResult.value!.factory, agents: sorted };
  }, [bundleResult]);

  const selectedAgent = useMemo(() => {
    return getSelectedAgent(content.agents, selectedName);
  }, [content.agents, selectedName]);

  if (content.error) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
        <div className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-4 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Agents</span>
        </div>
        <div className="p-4 text-sm text-red-600">{content.error}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
      {/* Breadcrumb */}
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Agents</span>
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">{content.agents.length}</span>
        </div>
        <span className="text-[11px] font-medium text-zinc-500">GitHub-backed — read-only</span>
      </div>

      {/* Management intro */}
      <div className="border-b border-zinc-200 bg-white px-4 py-3">
        <p className="text-[13px] font-medium text-zinc-900">
          Agents — Foreman + defaults (Triage/Spec/Implement/Review) + custom
        </p>
        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
          Factory: {content.factory!.name} · Alias: {content.factory!.alias ?? "—"} · Each agent: description, agentType, harness/model, runner, workerHost, mcpServers, secrets, instructions (agent.md). Read-only via dashboard, edit in Git.
        </p>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* List pane — SRP: only list, no detail logic */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-zinc-200 bg-[#f8f8f8] lg:max-w-[380px]">
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {content.agents.map((agent) => {
                return (
                  <AgentCard
                    key={agent.name}
                    agent={agent}
                    factory={content.factory!}
                    selected={selectedAgent?.name === agent.name}
                    onSelect={handleSelect}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Detail pane — SRP: only shows selected agent, DIP via props */}
        <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex">
          {selectedAgent && content.factory ? (
            <AgentDetail agent={selectedAgent} factory={content.factory} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">No agent selected</div>
          )}
        </div>
      </div>

      {/* Mobile detail overlay */}
      {selectedAgent && content.factory && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-zinc-200 bg-white lg:hidden">
          <AgentDetail agent={selectedAgent} factory={content.factory} />
        </div>
      )}
    </div>
  );
}

export default AgentsPage;
