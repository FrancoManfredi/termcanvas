import { useState } from "react"
import {
  ISSUES,
  COLUMNS,
  PHASE_LABELS,
  AWAITING_LABELS,
  type Issue,
  type IssueStatus,
  type InProgressPhase,
  type AwaitingAction,
} from "../data/issues"
import {
  IconRefresh,
  IconClose,
  IconGitHub,
  IconBranch,
  IconPlay,
  IconAgent,
  IconMerge,
  IconSession,
  IconFix,
} from "./icons"
import { type ViewMode } from "./KanbanBoard"

// ─── Color palettes ───────────────────────────────────────────────────────────

const PHASE: Record<InProgressPhase, {
  accent: string
  bg: string
  border: string
  label: string
}> = {
  implementing: {
    accent: "#22d3ee",
    bg: "rgba(34,211,238,0.07)",
    border: "rgba(34,211,238,0.22)",
    label: "#67e8f9",
  },
  reviewing: {
    accent: "#fb923c",
    bg: "rgba(251,146,60,0.07)",
    border: "rgba(251,146,60,0.22)",
    label: "#fdba74",
  },
  fixing: {
    accent: "#e879f9",
    bg: "rgba(232,121,249,0.07)",
    border: "rgba(232,121,249,0.22)",
    label: "#f0abfc",
  },
}

const AWAIT: Record<AwaitingAction, {
  accent: string
  bg: string
  border: string
  label: string
  btnBg: string
  btnHover: string
}> = {
  "review-ready": {
    accent: "#a78bfa",
    bg: "rgba(167,139,250,0.07)",
    border: "rgba(167,139,250,0.22)",
    label: "#c4b5fd",
    btnBg: "#5b21b6",
    btnHover: "#4c1d95",
  },
  "changes-requested": {
    accent: "#fbbf24",
    bg: "rgba(251,191,36,0.07)",
    border: "rgba(251,191,36,0.22)",
    label: "#fde68a",
    btnBg: "#92400e",
    btnHover: "#78350f",
  },
  "merge-ready": {
    accent: "#34d399",
    bg: "rgba(52,211,153,0.07)",
    border: "rgba(52,211,153,0.22)",
    label: "#6ee7b7",
    btnBg: "#065f46",
    btnHover: "#064e3b",
  },
}

const COL_COLOR: Record<IssueStatus, string> = {
  pending: "#6b7280",
  "in-progress": "#f59e0b",
  awaiting: "#a855f7",
  done: "#22c55e",
}

// ─── Panel ────────────────────────────────────────────────────────────────────

const DETAIL_MS = 220
const DETAIL_EASE = "cubic-bezier(0.32, 0.72, 0, 1)"

// ─── View toggle (shared visual style) ───────────────────────────────────────

function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode
  onChange: (m: ViewMode) => void
}) {
  return (
    <div
      style={{
        display: "flex",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        padding: 2,
        gap: 1,
      }}
    >
      <ToggleBtn
        active={mode === "columns"}
        label="Columns"
        onClick={() => onChange("columns")}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect
            x="1"
            y="2"
            width="4"
            height="12"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <rect
            x="6"
            y="2"
            width="4"
            height="12"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <rect
            x="11"
            y="2"
            width="4"
            height="12"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </ToggleBtn>
      <ToggleBtn
        active={mode === "collapsible"}
        label="Collapsible"
        onClick={() => onChange("collapsible")}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect
            x="1"
            y="2"
            width="14"
            height="3"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <rect
            x="1"
            y="7"
            width="14"
            height="3"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <rect
            x="1"
            y="12"
            width="14"
            height="2"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      </ToggleBtn>
    </div>
  )
}

function ToggleBtn({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 26,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        border: "none",
        cursor: "pointer",
        background: active ? "var(--bg-hover)" : "transparent",
        color: active ? "var(--text-secondary)" : "var(--text-disabled)",
        transition: "background 120ms, color 120ms",
      }}
      onMouseEnter={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.color =
            "var(--text-tertiary)"
      }}
      onMouseLeave={(e) => {
        if (!active)
          (e.currentTarget as HTMLButtonElement).style.color =
            "var(--text-disabled)"
      }}
    >
      {children}
    </button>
  )
}

// ─── Columns layout (horizontal) ─────────────────────────────────────────────

function ColumnsLayout({
  selectedId,
  onSelect,
}: {
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <div
      style={{
        flex: 1,
        overflowX: "auto",
        overflowY: "hidden",
        display: "flex",
        gap: 14,
        padding: "16px 18px 20px",
      }}
    >
      {COLUMNS.map((col) => {
        const colIssues = ISSUES.filter((i) => i.status === col.id)
        const accent = COL_COLOR[col.id]
        return (
          <div
            key={col.id}
            style={{
              width: 260,
              minWidth: 260,
              display: "flex",
              flexDirection: "column",
              height: "100%",
              flexShrink: 0,
            }}
          >
            {/* Header */}
            <div style={{ paddingBottom: 9, flexShrink: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: accent,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: accent,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    flex: 1,
                  }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "#3a3a3a",
                  }}
                >
                  {colIssues.length}
                </span>
              </div>
            </div>
            <div
              style={{ height: 1, background: `${accent}30`, marginBottom: 8 }}
            />
            <div style={{ flex: 1, overflowY: "auto" }}>
              {colIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  selected={selectedId === issue.id}
                  onSelect={() => onSelect(issue.id)}
                />
              ))}
              {colIssues.length === 0 && (
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "#2a2a2a",
                    textAlign: "center",
                    padding: "16px 0",
                    margin: 0,
                  }}
                >
                  No issues
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ActivityPanel() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [mountedId, setMountedId] = useState<number | null>(null) // stays mounted during exit
  const [detailVisible, setDetailVisible] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("collapsible")
  const selected =
    ISSUES.find((i) => i.id === (mountedId ?? selectedId)) ?? null

  function openDetail(id: number) {
    setMountedId(id)
    setSelectedId(id)
    requestAnimationFrame(() => setDetailVisible(true))
  }

  function closeDetail() {
    setDetailVisible(false)
    setSelectedId(null)
    setTimeout(() => setMountedId(null), DETAIL_MS)
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* ── Kanban ── */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            height: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 18px",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                fontWeight: 700,
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              Activity
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-disabled)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                padding: "1px 7px",
                borderRadius: 4,
              }}
            >
              {ISSUES.length}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <ToolbarBtn
            aria-label="Fetch latest issues"
            title="Fetch latest issues"
          >
            <IconRefresh size={13} />
          </ToolbarBtn>
        </div>

        {/* Content — switches between columns and collapsible */}
        {viewMode === "columns" ? (
          <ColumnsLayout
            selectedId={selectedId}
            onSelect={(id) =>
              id === selectedId ? closeDetail() : openDetail(id)
            }
          />
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "12px 12px 32px",
            }}
          >
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                status={col.id}
                label={col.label}
                issues={ISSUES.filter((i) => i.status === col.id)}
                selectedId={selectedId}
                onSelect={(id) =>
                  id === selectedId ? closeDetail() : openDetail(id)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Detail (animated slide-in from right) ── */}
      {selected && (
        <div
          style={{
            flex: "0 0 50%",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--border)",
            overflow: "hidden",
            transform: detailVisible ? "translateX(0)" : "translateX(100%)",
            transition: `transform ${DETAIL_MS}ms ${DETAIL_EASE}`,
          }}
        >
          <IssueDetail issue={selected} onClose={closeDetail} />
        </div>
      )}
    </div>
  )
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  label,
  issues,
  selectedId,
  onSelect,
}: {
  status: IssueStatus
  label: string
  issues: Issue[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [collapsed, setCollapsed] = useState(status === "done")
  const accent = COL_COLOR[status]
  const isAgent = status === "in-progress"
  const isAwaiting = status === "awaiting"

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${
          isAwaiting
            ? "rgba(168,85,247,0.2)"
            : isAgent
              ? "rgba(245,158,11,0.15)"
              : "var(--border-subtle)"
        }`,
        background: isAwaiting
          ? "rgba(168,85,247,0.04)"
          : isAgent
            ? "rgba(245,158,11,0.03)"
            : "var(--bg-elevated)",
        marginBottom: 10,
        overflow: "visible",
      }}
    >
      {/* Column header */}
      <button
        aria-expanded={!collapsed}
        aria-label={`${label} — ${issues.length} issues`}
        onClick={() => setCollapsed((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 12px",
          background: "transparent",
          border: "none",
          borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.04)",
          cursor: "pointer",
          borderRadius: collapsed ? 8 : "8px 8px 0 0",
          transition: "background 120ms",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {/* Status dot */}
        {isAgent ? (
          <span
            className="pulse-dot"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: accent,
              flexShrink: 0,
            }}
          />
        ) : (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: accent,
              flexShrink: 0,
            }}
          />
        )}

        {/* Label */}
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            flex: 1,
            textAlign: "left",
            color: isAwaiting
              ? "#c084fc"
              : isAgent
                ? "#fbbf24"
                : status === "done"
                  ? "#4ade80"
                  : "var(--text-tertiary)",
          }}
        >
          {label}
        </span>

        {/* Context badge */}
        {isAgent && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.05em",
              color: "#b45309",
              background: "rgba(251,191,36,0.1)",
              border: "1px solid rgba(251,191,36,0.2)",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            AGENT WORKING
          </span>
        )}
        {isAwaiting && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.05em",
              color: "#a855f7",
              background: "rgba(168,85,247,0.12)",
              border: "1px solid rgba(168,85,247,0.25)",
              padding: "2px 7px",
              borderRadius: 4,
            }}
          >
            YOUR TURN
          </span>
        )}

        {/* Count */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-disabled)",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--border)",
            padding: "1px 6px",
            borderRadius: 4,
          }}
        >
          {issues.length}
        </span>

        {/* Chevron */}
        <span
          style={{
            display: "flex",
            color: "var(--text-disabled)",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 140ms",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 3.5L5 6.5L8 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {/* Cards */}
      {!collapsed && (
        <div style={{ padding: issues.length ? "3px 6px 6px" : "8px" }}>
          {issues.length === 0 ? (
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-disabled)",
                textAlign: "center",
                padding: "12px 0",
                margin: 0,
              }}
            >
              No issues
            </p>
          ) : (
            issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                selected={selectedId === issue.id}
                onSelect={() => onSelect(issue.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Compact issue row ────────────────────────────────────────────────────────

function IssueCard({
  issue,
  selected,
  onSelect,
}: {
  issue: Issue
  selected: boolean
  onSelect: () => void
}) {
  const [hov, setHov] = useState(false)
  const ph = issue.phase ? PHASE[issue.phase] : null
  const aw = issue.awaitingAction ? AWAIT[issue.awaitingAction] : null
  const col = COL_COLOR[issue.status]

  // Left accent colour for the row
  const accentColor = ph ? ph.accent : aw ? aw.accent : col

  return (
    <button
      aria-pressed={selected}
      aria-label={`Issue #${issue.id}: ${issue.title}`}
      onClick={onSelect}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 38,
        padding: "0 10px 0 0",
        borderRadius: 6,
        border: selected
          ? `1px solid ${col}44`
          : hov
            ? "1px solid #222"
            : "1px solid transparent",
        background: selected ? `${col}0c` : hov ? "#141414" : "transparent",
        cursor: "pointer",
        transition: "background 80ms, border-color 80ms",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Colored left accent bar */}
      <span
        style={{
          width: 3,
          alignSelf: "stretch",
          flexShrink: 0,
          background: selected || hov ? accentColor : "transparent",
          borderRadius: "3px 0 0 3px",
          transition: "background 80ms",
        }}
      />

      {/* Status micro-icon */}
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        {issue.status === "in-progress" && ph ? (
          <span
            className="pulse-dot"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: ph.accent,
            }}
          />
        ) : issue.status === "awaiting" && aw ? (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M10 7.5C10 9.43 8.43 11 6.5 11S3 9.43 3 7.5V4.5M3 4.5L1 6.5M3 4.5L5 6.5"
              stroke={aw.accent}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : issue.status === "done" ? (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="#22c55e" strokeWidth="1.3" />
            <path
              d="M4 6l1.5 1.5L8 4.5"
              stroke="#22c55e"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: col,
              opacity: 0.5,
            }}
          />
        )}
      </span>

      {/* Issue number */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "#3e3e3e",
          flexShrink: 0,
        }}
      >
        #{issue.id}
      </span>

      {/* Separator */}
      <span style={{ color: "#222", fontSize: 11, flexShrink: 0 }}>·</span>

      {/* Title */}
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 500,
          color: selected ? "#d4d4d4" : hov ? "#b0b0b0" : "#787878",
          flex: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          transition: "color 80ms",
        }}
      >
        {issue.title}
      </span>

      {/* Phase pill — compact */}
      {ph && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 3,
            flexShrink: 0,
            background: ph.bg,
            border: `1px solid ${ph.border}`,
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: ph.label,
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: ph.accent,
            }}
          />
          {PHASE_LABELS[issue.phase!]}
        </span>
      )}

      {/* Awaiting pill — compact */}
      {aw && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 3,
            flexShrink: 0,
            background: aw.bg,
            border: `1px solid ${aw.border}`,
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: aw.label,
          }}
        >
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: "50%",
              background: aw.accent,
            }}
          />
          {AWAITING_LABELS[issue.awaitingAction!]}
        </span>
      )}

      {/* Labels */}
      {issue.labels.slice(0, 1).map((l) => (
        <span
          key={l}
          style={{
            padding: "1px 6px",
            borderRadius: 4,
            flexShrink: 0,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid #1e1e1e",
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "#505050",
          }}
        >
          {l}
        </span>
      ))}

      {/* Branch */}
      {issue.branch && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          <IconBranch size={9} color="#1e6a8a" />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "#1e6a8a",
            }}
          >
            {issue.branch}
          </span>
        </span>
      )}

      {/* PR number */}
      {issue.prNumber && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            flexShrink: 0,
          }}
        >
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="3.5" r="1.5" fill="#4ade80" />
            <circle cx="4" cy="12.5" r="1.5" fill="#4ade80" />
            <circle cx="12" cy="6" r="1.5" fill="#4ade80" />
            <path
              d="M4 5v5M4 5c0 3 8 3 8 0"
              stroke="#4ade80"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "#4ade8050",
            }}
          >
            #{issue.prNumber}
          </span>
        </span>
      )}

      {/* Chevron */}
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        style={{
          color: hov ? "#444" : "#202020",
          flexShrink: 0,
          transition: "color 80ms",
        }}
      >
        <path
          d="M4.5 3L8 6l-3.5 3"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

// ─── Issue detail ─────────────────────────────────────────────────────────────

function IssueDetail({ issue, onClose }: { issue: Issue onClose: () => void }) {
  const col = COLUMNS.find((c) => c.id === issue.status)!
  const ph = issue.phase ? PHASE[issue.phase] : null
  const aw = issue.awaitingAction ? AWAIT[issue.awaitingAction] : null
  const color = COL_COLOR[issue.status]

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 18px 12px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-disabled)",
              paddingTop: 2,
              flexShrink: 0,
            }}
          >
            #{issue.id}
          </span>
          <h2
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 15,
              fontWeight: 700,
              color: "var(--text-primary)",
              lineHeight: 1.35,
              margin: 0,
              flex: 1,
              letterSpacing: "-0.01em",
            }}
          >
            {issue.title}
          </h2>
          <button
            aria-label="Close issue detail"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 120ms, color 120ms",
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background =
                "var(--bg-hover)"
              ;(e.currentTarget as HTMLButtonElement).style.color =
                "var(--text-primary)"
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background =
                "transparent"
              ;(e.currentTarget as HTMLButtonElement).style.color =
                "var(--text-tertiary)"
            }}
          >
            <IconClose size={13} />
          </button>
        </div>

        {/* Status + labels */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              borderRadius: 5,
              background: `${color}14`,
              border: `1px solid ${color}40`,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              color: color,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: color,
              }}
            />
            {col.label}
          </span>
          {issue.labels.map((l) => (
            <span
              key={l}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-tertiary)",
              }}
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "16px 18px",
        }}
      >
        {/* Phase timeline */}
        {issue.status === "in-progress" && issue.phase && (
          <PhaseTimeline current={issue.phase} started={issue.phaseStarted} />
        )}

        {/* Awaiting context */}
        {aw && issue.awaitingAction && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              borderRadius: 8,
              background: aw.bg,
              border: `1px solid ${aw.border}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: aw.accent,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: aw.label,
                  letterSpacing: "0.01em",
                }}
              >
                {AWAITING_LABELS[issue.awaitingAction]}
              </span>
            </div>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                color: `${aw.label}bb`,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {AWAIT_DESC[issue.awaitingAction]}
            </p>
          </div>
        )}

        {/* Branch / PR / agent meta */}
        {(issue.branch || issue.prNumber || issue.assignee) && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 13px",
              borderRadius: 7,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {issue.branch && (
              <MetaRow label="branch" value={issue.branch} color="#38bdf8" />
            )}
            {issue.prNumber && (
              <MetaRow
                label="PR"
                value={`#${issue.prNumber}`}
                color="#4ade80"
              />
            )}
            {issue.assignee && (
              <MetaRow
                label="agent"
                value={issue.assignee}
                color="var(--text-secondary)"
              />
            )}
          </div>
        )}

        {/* Description */}
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            color: "var(--text-tertiary)",
            lineHeight: 1.75,
            whiteSpace: "pre-wrap",
            margin: 0,
          }}
        >
          {issue.body}
        </p>

        {/* Dates */}
        <div
          style={{
            marginTop: 20,
            paddingTop: 14,
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            gap: 24,
          }}
        >
          <DateInfo label="opened" value={issue.createdAt} />
          <DateInfo label="updated" value={issue.updatedAt} />
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid var(--border-subtle)",
          padding: "10px 16px",
          display: "flex",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <ActionBtn
          label="GitHub"
          secondary
          icon={<IconGitHub size={13} />}
          bg="#161616"
          hoverBg="#1e1e1e"
          border="1px solid var(--border)"
          textColor="var(--text-tertiary)"
        />
        <PrimaryBtn issue={issue} aw={aw} />
      </div>
    </div>
  )
}

// ─── Phase timeline ───────────────────────────────────────────────────────────

const PHASES: InProgressPhase[] = ["implementing", "reviewing", "fixing"]

function PhaseTimeline({
  current,
  started,
}: {
  current: InProgressPhase
  started?: string
}) {
  const idx = PHASES.indexOf(current)
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "12px 14px 14px",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-disabled)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          margin: "0 0 14px",
        }}
      >
        Agent progress
      </p>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {PHASES.map((phase, i) => {
          const pc = PHASE[phase]
          const done = i < idx
          const active = i === idx
          return (
            <div
              key={phase}
              style={{ display: "flex", alignItems: "flex-start", flex: 1 }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  flex: 1,
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: active || done ? pc.accent : "var(--bg-hover)",
                    border: active
                      ? `2px solid ${pc.accent}`
                      : done
                        ? "none"
                        : "2px solid var(--border)",
                    boxShadow: active ? `0 0 10px ${pc.accent}60` : "none",
                    transition: "all 200ms",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    lineHeight: 1.4,
                    textAlign: "center",
                    color: active
                      ? pc.label
                      : done
                        ? "var(--text-tertiary)"
                        : "var(--text-disabled)",
                  }}
                >
                  {PHASE_LABELS[phase]}
                </span>
              </div>
              {i < PHASES.length - 1 && (
                <div
                  style={{
                    height: 1,
                    flex: 1,
                    background: done
                      ? "rgba(255,255,255,0.1)"
                      : "var(--border-subtle)",
                    marginTop: 5,
                    minWidth: 8,
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
      {started && (
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-disabled)",
            margin: "10px 0 0",
          }}
        >
          Phase started {started}
        </p>
      )}
    </div>
  )
}

// ─── Awaiting descriptions ────────────────────────────────────────────────────

const AWAIT_DESC: Record<AwaitingAction, string> = {
  "review-ready":
    "The agent finished implementing. Review the diff and approve or request changes.",
  "changes-requested":
    "The review returned change requests. Trigger the fix agent to address them.",
  "merge-ready":
    "The PR has been approved and all checks pass. Merge when ready.",
}

// ─── Primary action button ────────────────────────────────────────────────────

function PrimaryBtn({
  issue,
  aw,
}: {
  issue: Issue
  aw: typeof AWAIT[AwaitingAction] | null
}) {
  if (issue.status === "pending")
    return (
      <ActionBtn
        label="Resolve Issue"
        icon={<IconPlay size={12} />}
        bg="var(--accent)"
        hoverBg="var(--accent-hover)"
      />
    )

  if (issue.status === "in-progress")
    return (
      <ActionBtn
        label="View Agent"
        icon={<IconAgent size={13} />}
        bg="#1d4ed8"
        hoverBg="#1e40af"
      />
    )

  if (issue.status === "awaiting" && aw && issue.awaitingAction) {
    const labels: Record<AwaitingAction, string> = {
      "review-ready": "Review Issue",
      "changes-requested": "Implement Fix",
      "merge-ready": "Merge PR",
    }
    const icons: Record<AwaitingAction, React.ReactNode> = {
      "review-ready": <IconAgent size={13} />,
      "changes-requested": <IconFix size={13} />,
      "merge-ready": <IconMerge size={13} />,
    }
    return (
      <ActionBtn
        label={labels[issue.awaitingAction]}
        icon={icons[issue.awaitingAction]}
        bg={aw.btnBg}
        hoverBg={aw.btnHover}
      />
    )
  }

  if (issue.status === "done")
    return (
      <ActionBtn
        label="View Session"
        secondary
        icon={<IconSession size={13} />}
        bg="var(--bg-elevated)"
        hoverBg="var(--bg-hover)"
        border="1px solid var(--border)"
        textColor="var(--text-tertiary)"
      />
    )

  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ActionBtn({
  label,
  icon,
  bg,
  hoverBg,
  secondary = false,
  border,
  textColor = "#fff",
}: {
  label: string
  icon: React.ReactNode
  bg: string
  hoverBg: string
  secondary?: boolean
  border?: string
  textColor?: string
}) {
  return (
    <button
      style={{
        flex: 1,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        borderRadius: 6,
        border: border ?? "none",
        background: bg,
        color: textColor,
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "background 110ms",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = bg)}
    >
      {icon}
      {label}
    </button>
  )
}

function MetaRow({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-disabled)",
          width: 42,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color }}>
        {value}
      </span>
    </div>
  )
}

function DateInfo({ label, value }: { label: string value: string }) {
  return (
    <div>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--text-disabled)",
          margin: "0 0 3px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-tertiary)",
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  )
}

function ToolbarBtn({
  children,
  "aria-label": ariaLabel,
  title,
}: {
  children: React.ReactNode
  "aria-label"?: string
  title?: string
}) {
  return (
    <button
      aria-label={ariaLabel}
      title={title}
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        color: "var(--text-tertiary)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 120ms, color 120ms",
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background =
          "var(--bg-hover)"
        ;(e.currentTarget as HTMLButtonElement).style.color =
          "var(--text-primary)"
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background =
          "var(--bg-elevated)"
        ;(e.currentTarget as HTMLButtonElement).style.color =
          "var(--text-tertiary)"
      }}
    >
      {children}
    </button>
  )
}
