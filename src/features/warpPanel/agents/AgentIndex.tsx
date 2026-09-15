import { useMemo, useState } from "react";
import type { AgentSummary } from "../types";
import type { AgentsLoadState } from "../hooks/useAgents";
import { formatModelShort } from "./agentDraft";
import { AgentIcon, isAgentIconKey } from "./agentIcons";
import { isCoreAgentId } from "./newAgentForm";

/**
 * AgentIndex — rail izquierdo del console: búsqueda real y grupos
 * (Foreman, Core, Custom). Cada fila muestra la metadata real que el daemon
 * devuelve en la lista (ícono, modelo, counts). Sin status falsos.
 */

export interface AgentIndexProps {
  agents: AgentSummary[];
  state: AgentsLoadState;
  error: string | null;
  selectedName: string | null;
  dirty: boolean;
  onSelect: (name: string) => void;
  onRetry: () => void;
}

function AgentRow({
  agent,
  selected,
  dirty,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  dirty: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      type="button"
      className="ag-row"
      aria-current={selected}
      onClick={() => onSelect(agent.name)}
    >
      <span className="ag-glyph" aria-hidden="true">
        {isAgentIconKey(agent.icon) ? (
          <AgentIcon icon={agent.icon} size={15} />
        ) : (
          (agent.name || "?").slice(0, 1).toUpperCase()
        )}
      </span>
      <span className="ag-row-main">
        <span className="ag-row-name">
          {agent.name}
          {dirty ? <span className="ag-dirty-dot" title="Unsaved changes" /> : null}
        </span>
        <span className="ag-row-desc">{agent.description || "No description yet."}</span>
        <span className="ag-row-desc" style={{ fontFamily: "var(--wp-font-mono)" }}>
          {formatModelShort(agent.model)}
          {agent.skills.length > 0 ? `  ${agent.skills.length} skills` : ""}
          {agent.mcps.length > 0 ? `  ${agent.mcps.length} mcps` : ""}
        </span>
      </span>
    </button>
  );
}

export function AgentIndex({
  agents,
  state,
  error,
  selectedName,
  dirty,
  onSelect,
  onRetry,
}: AgentIndexProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(q) ||
        agent.description.toLowerCase().includes(q) ||
        agent.model.toLowerCase().includes(q),
    );
  }, [agents, query]);

  const groups = useMemo(() => {
    const foreman: AgentSummary[] = [];
    const core: AgentSummary[] = [];
    const custom: AgentSummary[] = [];
    for (const agent of filtered) {
      if (agent.name === "foreman") foreman.push(agent);
      else if (isCoreAgentId(agent.name)) core.push(agent);
      else custom.push(agent);
    }
    return { foreman, core, custom };
  }, [filtered]);

  return (
    <div className="ag-index">
      <div className="ag-index-tools">
        <input
          className="ag-input"
          type="search"
          value={query}
          placeholder="Search agents..."
          aria-label="Search agents"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="ag-list">
        {state === "loading" ? (
          <div className="ag-skeleton" aria-label="Loading agents">
            <div className="ag-skeleton-row" />
            <div className="ag-skeleton-row" />
            <div className="ag-skeleton-row" />
          </div>
        ) : state === "offline" ? (
          <div className="ag-banner" role="status">
            <span>Daemon unreachable. {error ?? "No agents loaded."}</span>
            <button type="button" className="ag-btn ag-btn--sm" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : agents.length === 0 ? (
          <div className="ag-empty">
            <span className="ag-empty-title">No agents yet</span>
            <span className="ag-empty-body">
              Create your first agent with the New agent button. Every agent is a
              single agent.md file under factory/agents/.
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="ag-empty">
            <span className="ag-empty-title">No matches</span>
            <span className="ag-empty-body">Try a different search.</span>
          </div>
        ) : (
          <>
            {groups.foreman.length > 0 ? (
              <div className="ag-group">
                <div className="ag-group-label">Foreman</div>
                {groups.foreman.map((agent) => (
                  <AgentRow
                    key={agent.name}
                    agent={agent}
                    selected={agent.name === selectedName}
                    dirty={dirty && agent.name === selectedName}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ) : null}
            {groups.core.length > 0 ? (
              <div className="ag-group">
                <div className="ag-group-label">Core</div>
                {groups.core.map((agent) => (
                  <AgentRow
                    key={agent.name}
                    agent={agent}
                    selected={agent.name === selectedName}
                    dirty={dirty && agent.name === selectedName}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ) : null}
            {groups.custom.length > 0 ? (
              <div className="ag-group">
                <div className="ag-group-label">Custom</div>
                {groups.custom.map((agent) => (
                  <AgentRow
                    key={agent.name}
                    agent={agent}
                    selected={agent.name === selectedName}
                    dirty={dirty && agent.name === selectedName}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
