import { useState } from "react"
import AgentConfig from "./AgentConfig"

// ─── Data ──────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string
  name: string
  description: string
  iconBg: string
  iconColor: string
  icon: React.ReactNode
  status?: "idle" | "running" | "error"
}

const FOREMAN: Agent = {
  id: "foreman",
  name: "TermCanvas Foreman Agent",
  description:
    "Orchestrates the worktree workflow and dispatches each gated step.",
  iconBg: "rgba(139,92,246,0.14)",
  iconColor: "#a78bfa",
  icon: <ForEmanIcon />,
}

const SUB_AGENTS: Agent[] = [
  {
    id: "triage",
    name: "TermCanvas Triage Agent",
    description: "Triages repository issues and establishes task state.",
    iconBg: "rgba(148,163,184,0.10)",
    iconColor: "#94a3b8",
    icon: <TriageIcon />,
    status: "running",
  },
  {
    id: "spec",
    name: "TermCanvas Spec Agent",
    description: "Writes and drives approval of issue specifications.",
    iconBg: "rgba(249,115,22,0.12)",
    iconColor: "#fb923c",
    icon: <SpecIcon />,
    status: "idle",
  },
  {
    id: "implement",
    name: "TermCanvas Implement Agent",
    description:
      "Implements, validates, and commits code changes to the worktree.",
    iconBg: "rgba(59,130,246,0.12)",
    iconColor: "#60a5fa",
    icon: <ImplementIcon />,
    status: "running",
  },
  {
    id: "review",
    name: "TermCanvas Review Agent",
    description:
      "Reviews pull requests and routes findings to rework or human resolution.",
    iconBg: "rgba(236,72,153,0.12)",
    iconColor: "#f472b6",
    icon: <ReviewIcon />,
    status: "idle",
  },
]

// ─── SVG Icons ─────────────────────────────────────────────────────────────────

function ForEmanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="4" r="2.2" stroke="#a78bfa" strokeWidth="1.5" />
      <circle cx="4" cy="16" r="2.2" stroke="#a78bfa" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="2.2" stroke="#a78bfa" strokeWidth="1.5" />
      <path
        d="M10 6.2v4M10 10.2l-4.5 3.6M10 10.2l4.5 3.6"
        stroke="#a78bfa"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function TriageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle
        cx="10"
        cy="10"
        r="7"
        stroke="#94a3b8"
        strokeWidth="1.5"
        strokeDasharray="2.5 2.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="2" fill="#94a3b8" />
    </svg>
  )
}

function SpecIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect
        x="5"
        y="3"
        width="10"
        height="14"
        rx="2"
        stroke="#fb923c"
        strokeWidth="1.5"
      />
      <path
        d="M8 7h4M8 10h4M8 13h2"
        stroke="#fb923c"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle
        cx="14.5"
        cy="14.5"
        r="3"
        fill="rgba(249,115,22,0.14)"
        stroke="#fb923c"
        strokeWidth="1.3"
      />
      <path
        d="M13.5 14.5h2M14.5 13.5v2"
        stroke="#fb923c"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ImplementIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M6 7.5L3 10l3 2.5"
        stroke="#60a5fa"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 7.5L17 10l-3 2.5"
        stroke="#60a5fa"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 6l-3 8"
        stroke="#60a5fa"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ReviewIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M4 5a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H8l-3 3V5z"
        stroke="#f472b6"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Agent card ────────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  isForeman = false,
  onClick,
}: {
  agent: Agent
  isForeman?: boolean
  onClick?: () => void
}) {
  const [hov, setHov] = useState(false)

  return (
    <div
      onClick={onClick}
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
              fontFamily: "var(--font-sans)",
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
            fontFamily: "var(--font-sans)",
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
  )
}

// ─── New agent button ──────────────────────────────────────────────────────────

function NewAgentCard() {
  const [hov, setHov] = useState(false)
  return (
    <div
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
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          color: hov ? "#555" : "#383838",
          transition: "color 120ms",
        }}
      >
        New agent
      </span>
    </div>
  )
}

// ─── Tree connector SVG ────────────────────────────────────────────────────────

// Renders on the left side of the sub-agent block
function TreeConnector({ count }: { count: number }) {
  // Each card is ~72px tall (14px padding top+bottom + ~44px content), gap is 10px
  const CARD_H = 73
  const GAP = 10
  const totalH = count * CARD_H + (count - 1) * GAP
  const branchY = (i: number) => CARD_H / 2 + i * (CARD_H + GAP)

  return (
    <svg
      width="28"
      height={totalH}
      viewBox={`0 0 28 ${totalH}`}
      fill="none"
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
    >
      {/* Vertical line */}
      <line
        x1="14"
        y1="0"
        x2="14"
        y2={totalH}
        stroke="#2a2a2a"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      {/* Horizontal branches */}
      {Array.from({ length: count }).map((_, i) => (
        <path
          key={i}
          d={`M14 ${branchY(i)} Q14 ${branchY(i)} 28 ${branchY(i)}`}
          stroke="#2a2a2a"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      ))}
    </svg>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function AgentsPanel() {
  const [selected, setSelected] = useState<Agent | null>(null)
  if (selected)
    return <AgentConfig agent={selected} onBack={() => setSelected(null)} />
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
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
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {/* Breadcrumb */}
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--text-disabled)",
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
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text-primary)",
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 14px",
            background: "var(--text-primary)",
            color: "#0d0d0d",
            borderRadius: 7,
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
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
            agent={FOREMAN}
            isForeman
            onClick={() => setSelected(FOREMAN)}
          />

          {/* Sub-agents with tree connector */}
          <div style={{ position: "relative", marginTop: 14, paddingLeft: 52 }}>
            {/* Vertical + branches */}
            <SubTree />

            {/* Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {SUB_AGENTS.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onClick={() => setSelected(agent)}
                />
              ))}
              <NewAgentCard />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-tree connector ────────────────────────────────────────────────────────

function SubTree() {
  // count = agents + 1 (new agent card)
  const count = SUB_AGENTS.length + 1
  const CARD_H = 73
  const GAP = 10
  const totalH = count * CARD_H + (count - 1) * GAP

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
        const y = CARD_H / 2 + i * (CARD_H + GAP)
        return (
          <path
            key={i}
            d={`M12 ${y} Q20 ${y} 40 ${y}`}
            stroke="#242424"
            strokeWidth="1.5"
            strokeDasharray="3.5 3"
          />
        )
      })}
    </svg>
  )
}

// ─── Shared styles ─────────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  color: "var(--text-tertiary)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 120ms, color 120ms",
}
