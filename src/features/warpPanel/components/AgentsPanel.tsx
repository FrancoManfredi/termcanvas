import { memo, useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Agent } from "../types";
import type { FactoryAgentCreateInput } from "../../../lib/factoryClient";
import { useAgents } from "../hooks/useAgents";
import AgentConfig from "./AgentConfig";
import NewAgentSection from "./NewAgentSection";

/**
 * AgentsPanel — Track B (T03).
 *
 * Verbatim port of figma/.../src/components/AgentsPanel.tsx. Only diffs
 * vs Figma: import paths, `var(--*)` -> `var(--wp-*)` token prefix, and
 * data arriving via props / `useAgents` instead of module-local
 * `FOREMAN` / `SUB_AGENTS` constants (components never fetch; the icon
 * artwork itself lives in `adapters/mockAgents.ts` and reaches the cards
 * as the `icon` ReactNode on each `Agent`).
 *
 * Selecting an agent swaps to `AgentConfig` (remounted per agent via
 * `key`) and back — config state is resolved through `useAgents`, so
 * saves persist into the adapter store. All props are optional
 * overrides; when omitted the panel is driven by `useAgents()`.
 */

export interface AgentsPanelProps {
  /** Foreman agent. Defaults to `useAgents().foreman`. */
  foreman?: Agent;
  /** Sub-agents. Defaults to `useAgents().agents`. */
  agents?: Agent[];
  /** Controlled selection. Defaults to `useAgents().selectedAgentId`. */
  selectedAgentId?: string | null;
  /** Selection callback. Defaults to `useAgents().selectAgent`. */
  onSelectAgent?: (id: string | null) => void;
}

// ─── Agent card ────────────────────────────────────────────────────────────────

// Perf Ola 3: memoized (stable `agent` refs from `useAgents` + stable
// id-based `onSelect`) so typing in AgentConfig or poll-adjacent renders
// never re-render the list rows. Default shallow memo bails correctly here
// (unlike the poll-rebuilt Issue objects — agents are `useState` seeds).
const AgentCard = memo(function AgentCard({
  agent,
  isForeman = false,
  onSelect,
}: {
  agent: Agent;
  isForeman?: boolean;
  onSelect: (id: string) => void;
}) {
  const [hov, setHov] = useState(false);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(agent.id);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${agent.name} — open configuration`}
      onClick={() => onSelect(agent.id)}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: isForeman ? "18px 20px" : "14px 18px",
        borderRadius: isForeman ? 12 : 10,
        background: hov ? "#1a1a1a" : "#141414",
        border: `1px solid ${hov ? "#333" : "#212121"}`,
        cursor: "pointer",
        transition: "background 100ms, border-color 100ms",
        width: "100%",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 10,
          flexShrink: 0,
          background: agent.iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${agent.iconColor}22`,
        }}
      >
        {agent.icon}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "var(--wp-font-sans)",
              fontSize: isForeman ? 15 : 13,
              fontWeight: 600,
              color: hov ? "#f0f0f0" : "#d4d4d4",
              letterSpacing: isForeman ? "-0.01em" : undefined,
              transition: "color 100ms",
            }}
          >
            {agent.name}
          </span>
        </div>
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 12,
            color: hov ? "#888" : "#555",
            lineHeight: 1.5,
            display: "block",
            marginTop: 2,
            transition: "color 100ms",
          }}
        >
          {agent.description}
        </span>
      </div>

      {/* Chevron */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        style={{
          color: hov ? "#555" : "#2a2a2a",
          flexShrink: 0,
          transition: "color 100ms",
        }}
      >
        <path
          d="M6 4l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
});

// ─── New agent button ──────────────────────────────────────────────────────────

function NewAgentCard({ onCreate }: { onCreate: () => void }) {
  const [hov, setHov] = useState(false);
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCreate();
    }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Create new agent"
      onClick={onCreate}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "14px 18px",
        borderRadius: 10,
        background: hov ? "rgba(255,255,255,0.02)" : "transparent",
        border: `1px dashed ${hov ? "#383838" : "#242424"}`,
        cursor: "pointer",
        transition: "background 120ms, border-color 120ms",
        width: "100%",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M7 1v12M1 7h12"
          stroke={hov ? "#555" : "#383838"}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          fontFamily: "var(--wp-font-sans)",
          fontSize: 13,
          color: hov ? "#555" : "#383838",
          transition: "color 120ms",
        }}
      >
        New agent
      </span>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function AgentsPanel({
  foreman: foremanProp,
  agents: agentsProp,
  selectedAgentId: selectedProp,
  onSelectAgent,
}: AgentsPanelProps) {
  // Data enters via props or the data hook — never via direct fetch.
  const {
    foreman: hookForeman,
    agents: hookAgents,
    selectedAgentId: hookSelectedId,
    selectAgent: hookSelectAgent,
    getConfig,
    saveConfig,
    createAgent,
    deleteAgent,
    refreshAgents,
    creating,
  } = useAgents();
  const [showNewAgent, setShowNewAgent] = useState(false);
  const openNewAgent = useCallback(() => setShowNewAgent(true), []);
  const closeNewAgent = useCallback(() => setShowNewAgent(false), []);

  // Fusiona una vez la lista real del daemon (agentes creados fuera de los
  // seeds, ej. playwright-tester). Silencioso offline: los seeds quedan.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (alive) await refreshAgents();
      } catch {
        // silencioso: offline → seeds
      }
    })();
    return () => {
      alive = false;
    };
    // Intencional: una fusión por montaje (el panel remonta por navegación).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const foreman = foremanProp ?? hookForeman;
  const agents = agentsProp ?? hookAgents;
  const selectedId = selectedProp !== undefined ? selectedProp : hookSelectedId;
  const selectAgent = onSelectAgent ?? hookSelectAgent;

  // Perf Ola 3: stable id-based select — the memoized `AgentCard` rows bail
  // out unless this ref (or their agent data) changes. Inline per-row
  // closures would re-render every row on every parent render.
  const handleSelect = useCallback(
    (id: string): void => {
      selectAgent(id);
    },
    [selectAgent],
  );

  const handleCreateAgent = useCallback(
    async (input: FactoryAgentCreateInput): Promise<{ ok: boolean; error?: string }> => {
      const res = await createAgent(input);
      if (res.ok) {
        setShowNewAgent(false);
        selectAgent(input.name.trim());
      }
      return res;
    },
    [createAgent, selectAgent],
  );

  const allAgents: Agent[] = [foreman, ...agents];
  const selected: Agent | null =
    selectedId === null
      ? null
      : (allAgents.find((agent) => agent.id === selectedId) ?? null);

  // Alta como sección (igual que AgentConfig), no modal.
  if (showNewAgent && !selected) {
    return (
      <NewAgentSection
        onBack={closeNewAgent}
        onSubmit={handleCreateAgent}
        submitting={creating}
      />
    );
  }

  const handleDeleteAgent = useCallback(
    async (agentId: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await deleteAgent(agentId);
      if (res.ok) selectAgent(null);
      return res;
    },
    [deleteAgent, selectAgent],
  );

  if (selected) {
    const config = getConfig(selected.id);
    // Every known agent ships a config seed; the guard below is purely
    // defensive so the prop contract of AgentConfig stays total.
    if (config === undefined) return null;
    return (
      <AgentConfig
        key={selected.id}
        agent={selected}
        config={config}
        onBack={() => selectAgent(null)}
        onDeleteAgent={handleDeleteAgent}
        onSaveConfig={(agentId, patch) => {
          saveConfig(agentId, patch);
        }}
      />
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--wp-bg)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 18px",
          borderBottom: "1px solid var(--wp-border-subtle)",
          flexShrink: 0,
        }}
      >
        {/* Breadcrumb */}
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 13,
            color: "var(--wp-text-disabled)",
            fontWeight: 500,
          }}
        >
          term-canvas
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M4.5 2.5L7.5 6l-3 3.5"
            stroke="#3a3a3a"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--wp-text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          Agents
        </span>

        <div style={{ flex: 1 }} />

        {/* Search */}
        <button aria-label="Search" style={iconBtnStyle}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle
              cx="7"
              cy="7"
              r="5"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M11 11l3 3"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Filter */}
        <button aria-label="Filter" style={iconBtnStyle}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4h12M4 8h8M6 12h4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* New */}
        <button
          aria-label="Create new agent"
          onClick={openNewAgent}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 14px",
            background: "var(--wp-text-primary)",
            color: "#0d0d0d",
            borderRadius: 7,
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--wp-font-sans)",
            fontSize: 13,
            fontWeight: 700,
            transition: "opacity 120ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          New
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 4.5L6 7.5l3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "24px 24px 40px",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {/* Foreman card */}
          <AgentCard
            agent={foreman}
            isForeman
            onSelect={handleSelect}
          />

          {/* Sub-agents with tree connector */}
          <div style={{ position: "relative", marginTop: 14, paddingLeft: 52 }}>
            {/* Vertical + branches */}
            <SubTree count={agents.length + 1} />

            {/* Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onSelect={handleSelect}
                />
              ))}
              <NewAgentCard onCreate={openNewAgent} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-tree connector ────────────────────────────────────────────────────────

function SubTree({ count }: { count: number }) {
  const CARD_H = 73;
  const GAP = 10;
  const totalH = count * CARD_H + (count - 1) * GAP;

  return (
    <svg
      width="40"
      height={totalH}
      viewBox={`0 0 40 ${totalH}`}
      fill="none"
      style={{ position: "absolute", left: 8, top: 0, pointerEvents: "none" }}
    >
      {/* Vertical trunk */}
      <line
        x1="12"
        y1="0"
        x2="12"
        y2={totalH - CARD_H / 2}
        stroke="#242424"
        strokeWidth="1.5"
        strokeDasharray="3.5 3"
      />
      {/* Horizontal branches to each card */}
      {Array.from({ length: count }).map((_, i) => {
        const y = CARD_H / 2 + i * (CARD_H + GAP);
        return (
          <path
            key={i}
            d={`M12 ${y} Q20 ${y} 40 ${y}`}
            stroke="#242424"
            strokeWidth="1.5"
            strokeDasharray="3.5 3"
          />
        );
      })}
    </svg>
  );
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const iconBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 7,
  border: "1px solid var(--wp-border)",
  background: "var(--wp-bg-elevated)",
  color: "var(--wp-text-tertiary)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 120ms, color 120ms",
};
