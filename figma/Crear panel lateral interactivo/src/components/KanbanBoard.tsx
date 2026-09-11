import { useState } from "react"
import {
  KANBAN_ISSUES,
  KANBAN_COLUMNS,
  type KanbanIssue,
  type KanbanStatus,
} from "../data/kanban"
import IssueDrawer from "./IssueDrawer"
import { IconRefresh } from "./icons"

// ─── View toggle ──────────────────────────────────────────────────────────────

export type ViewMode = "columns" | "collapsible"

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

// ─── Status dot ───────────────────────────────────────────────────────────────

function StatusDot({
  color,
  dotStyle,
  size = 10,
}: {
  color: string
  dotStyle: "solid" | "outline" | "half" | "check"
  size?: number
}) {
  const s: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  }
  if (dotStyle === "solid") return <span style={{ ...s, background: color }} />
  if (dotStyle === "outline")
    return <span style={{ ...s, border: `2px solid ${color}` }} />
  if (dotStyle === "check")
    return (
      <span style={{ ...s, background: color }}>
        <svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 8 8"
          fill="none"
        >
          <path
            d="M1.5 4L3.5 6L6.5 2.5"
            stroke="#fff"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  return (
    <span
      style={{
        ...s,
        border: `2px solid ${color}`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "50%",
          height: "100%",
          background: color,
        }}
      />
    </span>
  )
}

// ─── Issue card (shared by both views) ───────────────────────────────────────

function IssueCard({
  issue,
  onOpen,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  issue: KanbanIssue
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: isDragging ? "#111" : hov ? "#1c1c1c" : "#161616",
        border: isDragging
          ? "1px dashed #333"
          : hov
            ? "1px solid #333"
            : "1px solid #212121",
        borderRadius: 6,
        padding: "10px 11px",
        marginBottom: 5,
        cursor: "pointer",
        opacity: isDragging ? 0.35 : 1,
        transition: "background 90ms, border-color 90ms, opacity 100ms",
        userSelect: "none",
      }}
    >
      {/* Repo + number */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginBottom: 5,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="3.5" r="1.5" fill="#4a4a4a" />
          <circle cx="4" cy="12.5" r="1.5" fill="#4a4a4a" />
          <circle cx="12" cy="6" r="1.5" fill="#4a4a4a" />
          <path
            d="M4 5v5M4 5c0 3 8 3 8 0"
            stroke="#4a4a4a"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "#555",
          }}
        >
          {issue.repoName} #{issue.number}
        </span>
      </div>

      {/* Title */}
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 500,
          color: hov ? "#f0f0f0" : "#c8c8c8",
          lineHeight: 1.45,
          margin: "0 0 8px",
          transition: "color 90ms",
        }}
      >
        {issue.title}
      </p>

      {/* Badges — no size, no estimate */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        {issue.priority && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 5px",
              borderRadius: 3,
              background:
                issue.priority === "P0"
                  ? "#7f1d1d"
                  : issue.priority === "P1"
                    ? "#1e3a5f"
                    : "#1c1917",
              color:
                issue.priority === "P0"
                  ? "#fca5a5"
                  : issue.priority === "P1"
                    ? "#93c5fd"
                    : "#a8a29e",
            }}
          >
            {issue.priority}
          </span>
        )}
        {issue.prNumber && (
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
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
                color: "#4ade8070",
              }}
            >
              #{issue.prNumber}
            </span>
          </span>
        )}
        {issue.labels.slice(0, 1).map((l) => (
          <span
            key={l.name}
            style={{
              padding: "1px 6px",
              borderRadius: 10,
              background: l.bg,
              fontFamily: "var(--font-sans)",
              fontSize: 9,
              color: l.fg,
            }}
          >
            {l.name}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Compact row (collapsible view only) ─────────────────────────────────────

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  P0: { bg: "#7f1d1d", fg: "#fca5a5" },
  P1: { bg: "#1e3a5f", fg: "#93c5fd" },
  P2: { bg: "#1c1917", fg: "#a8a29e" },
}

function CompactIssueRow({
  issue,
  colDotColor,
  colDotStyle,
  onOpen,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  issue: KanbanIssue
  colDotColor: string
  colDotStyle: "solid" | "outline" | "half" | "check"
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  const [hov, setHov] = useState(false)
  const pri = issue.priority ? PRIORITY_STYLE[issue.priority] : null

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = "move"; onDragStart() }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        height: 36, padding: "0 10px",
        borderRadius: 5,
        background: isDragging ? "#111" : hov ? "#161616" : "transparent",
        border: isDragging ? "1px dashed #2a2a2a" : hov ? "1px solid #222" : "1px solid transparent",
        cursor: "pointer", opacity: isDragging ? 0.35 : 1,
        transition: "background 80ms, border-color 80ms",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {/* Status dot */}
      <StatusDot color={colDotColor} dotStyle={colDotStyle} size={7} />

      {/* Issue number */}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#404040", flexShrink: 0 }}>
        #{issue.number}
      </span>

      {/* Separator */}
      <span style={{ color: "#222", fontSize: 10, flexShrink: 0 }}>·</span>

      {/* Title */}
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500,
        color: hov ? "#d4d4d4" : "#909090",
        flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
        transition: "color 80ms",
      }}>
        {issue.title}
      </span>

      {/* Priority */}
      {pri && (
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
          padding: "1px 5px", borderRadius: 3,
          background: pri.bg, color: pri.fg, flexShrink: 0,
        }}>
          {issue.priority}
        </span>
      )}

      {/* Labels — first one */}
      {issue.labels[0] && (
        <span style={{
          padding: "1px 6px", borderRadius: 10, flexShrink: 0,
          background: issue.labels[0].bg,
          fontFamily: "var(--font-sans)", fontSize: 9, color: issue.labels[0].fg,
        }}>
          {issue.labels[0].name}
        </span>
      )}

      {/* PR link */}
      {issue.prNumber && (
        <span style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="3.5" r="1.5" fill="#4ade80" />
            <circle cx="4" cy="12.5" r="1.5" fill="#4ade80" />
            <circle cx="12" cy="6" r="1.5" fill="#4ade80" />
            <path d="M4 5v5M4 5c0 3 8 3 8 0" stroke="#4ade80" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#4ade8055" }}>
            #{issue.prNumber}
          </span>
        </span>
      )}

      {/* Assignees */}
      {issue.assignees?.slice(0, 2).map((a, i) => (
        <span key={i} style={{
          width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
          background: a.color, display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-mono)", fontSize: 7, color: "#000", fontWeight: 700,
          marginLeft: i > 0 ? -4 : 0,
        }}>
          {a.initials[0]}
        </span>
      ))}

      {/* Chevron */}
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ color: hov ? "#444" : "#252525", flexShrink: 0, transition: "color 80ms" }}>
        <path d="M4.5 3L8 6l-3.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// ─── Columns view ─────────────────────────────────────────────────────────────

function ColumnsView({
  issues,
  draggingId,
  overCol,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  issues: KanbanIssue[]
  draggingId: number | null
  overCol: KanbanStatus | null
  onOpen: (id: number) => void
  onDragStart: (id: number) => void
  onDragEnd: () => void
  onDragOver: (col: KanbanStatus) => void
  onDrop: (col: KanbanStatus) => void
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
      {KANBAN_COLUMNS.map((col) => {
        const colIssues = issues.filter((i) => i.status === col.id)
        const isOver = overCol === col.id && draggingId != null
        return (
          <div
            key={col.id}
            style={{
              width: 272,
              minWidth: 272,
              display: "flex",
              flexDirection: "column",
              height: "100%",
              flexShrink: 0,
            }}
            onDragOver={(e) => {
              e.preventDefault()
              onDragOver(col.id)
            }}
            onDrop={(e) => {
              e.preventDefault()
              onDrop(col.id)
            }}
          >
            {/* Header */}
            <div style={{ paddingBottom: 10, flexShrink: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 5,
                }}
              >
                <StatusDot
                  color={col.dotColor}
                  dotStyle={col.dotStyle}
                  size={10}
                />
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#d4d4d4",
                    flex: 1,
                  }}
                >
                  {col.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "#444",
                  }}
                >
                  {colIssues.length}
                </span>
                <ColBtn aria-label={`Options for ${col.label}`}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <circle cx="3" cy="8" r="1.4" />
                    <circle cx="8" cy="8" r="1.4" />
                    <circle cx="13" cy="8" r="1.4" />
                  </svg>
                </ColBtn>
                <ColBtn aria-label={`Add to ${col.label}`}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M6 1v10M1 6h10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </ColBtn>
              </div>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 11,
                  color: "#383838",
                  margin: 0,
                  paddingLeft: 16,
                  lineHeight: 1.4,
                }}
              >
                {col.description}
              </p>
            </div>
            <div
              style={{
                height: 1,
                background: isOver ? col.dotColor + "70" : "#1c1c1c",
                marginBottom: 8,
                transition: "background 120ms",
              }}
            />
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                paddingRight: 1,
                background: isOver ? col.dotColor + "07" : "transparent",
                borderRadius: 6,
                transition: "background 120ms",
              }}
            >
              {colIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onOpen={() => onOpen(issue.id)}
                  onDragStart={() => onDragStart(issue.id)}
                  onDragEnd={onDragEnd}
                  isDragging={draggingId === issue.id}
                />
              ))}
              {isOver && (
                <div
                  style={{
                    height: 52,
                    borderRadius: 6,
                    border: `2px dashed ${col.dotColor}50`,
                    background: col.dotColor + "09",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: col.dotColor + "70",
                    marginBottom: 6,
                  }}
                >
                  Move here
                </div>
              )}
            </div>
            <button
              style={{
                width: "100%",
                height: 28,
                marginTop: 5,
                borderRadius: 5,
                border: "1px dashed #1e1e1e",
                background: "transparent",
                color: "#333",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                flexShrink: 0,
                transition: "all 120ms",
              }}
              onMouseEnter={(e) => {
                const b = e.currentTarget as HTMLButtonElement
                b.style.borderColor = "#333"
                b.style.color = "#666"
                b.style.background = "#141414"
              }}
              onMouseLeave={(e) => {
                const b = e.currentTarget as HTMLButtonElement
                b.style.borderColor = "#1e1e1e"
                b.style.color = "#333"
                b.style.background = "transparent"
              }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 1v10M1 6h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Add item
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Collapsible view ─────────────────────────────────────────────────────────

function CollapsibleView({
  issues,
  onOpen,
  draggingId,
  onDragStart,
  onDragEnd,
}: {
  issues: KanbanIssue[]
  onOpen: (id: number) => void
  draggingId: number | null
  onDragStart: (id: number) => void
  onDragEnd: () => void
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "12px 18px 32px",
      }}
    >
      {KANBAN_COLUMNS.map((col) => {
        const colIssues = issues.filter((i) => i.status === col.id)
        return (
          <CollapsibleSection
            key={col.id}
            col={col}
            issues={colIssues}
            onOpen={onOpen}
            draggingId={draggingId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        )
      })}
    </div>
  )
}

function CollapsibleSection({
  col,
  issues,
  onOpen,
  draggingId,
  onDragStart,
  onDragEnd,
}: {
  col: typeof KANBAN_COLUMNS[0]
  issues: KanbanIssue[]
  onOpen: (id: number) => void
  draggingId: number | null
  onDragStart: (id: number) => void
  onDragEnd: () => void
}) {
  const [open, setOpen] = useState(col.id !== "done")
  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid #1c1c1c`,
        background: "#0c0c0c",
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <button
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 13px",
          background: "transparent",
          border: "none",
          borderBottom:
            open && issues.length > 0 ? "1px solid #161616" : "none",
          cursor: "pointer",
          transition: "background 120ms",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <StatusDot color={col.dotColor} dotStyle={col.dotStyle} size={9} />
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            fontWeight: 700,
            color: "#c0c0c0",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            flex: 1,
            textAlign: "left",
          }}
        >
          {col.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "#3a3a3a",
            background: "#141414",
            border: "1px solid #1e1e1e",
            padding: "1px 6px",
            borderRadius: 4,
          }}
        >
          {issues.length}
        </span>
        <span
          style={{
            display: "flex",
            color: "#3a3a3a",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 150ms",
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
      {open && issues.length > 0 && (
        <div style={{ padding: "3px 6px 6px" }}>
          {issues.map((issue) => (
            <CompactIssueRow
              key={issue.id}
              issue={issue}
              colDotColor={col.dotColor}
              colDotStyle={col.dotStyle}
              onOpen={() => onOpen(issue.id)}
              onDragStart={() => onDragStart(issue.id)}
              onDragEnd={onDragEnd}
              isDragging={draggingId === issue.id}
            />
          ))}
        </div>
      )}
      {open && issues.length === 0 && (
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "#2a2a2a",
            textAlign: "center",
            padding: "12px 0",
            margin: 0,
          }}
        >
          No issues
        </p>
      )}
    </div>
  )
}

function ColBtn({
  children,
  "aria-label": al,
}: {
  children: React.ReactNode
  "aria-label": string
}) {
  return (
    <button
      aria-label={al}
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        border: "none",
        background: "transparent",
        color: "#3a3a3a",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "color 120ms, background 120ms",
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.color = "#999"
        ;(e.currentTarget as HTMLButtonElement).style.background = "#1c1c1c"
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.color = "#3a3a3a"
        ;(e.currentTarget as HTMLButtonElement).style.background = "transparent"
      }}
    >
      {children}
    </button>
  )
}

// ─── Board ────────────────────────────────────────────────────────────────────

export default function KanbanBoard() {
  const [issues, setIssues] = useState<KanbanIssue[]>(KANBAN_ISSUES)
  const [viewMode, setViewMode] = useState<ViewMode>("columns")
  const [openId, setOpenId] = useState<number | null>(null)
  const [draggingId, setDragging] = useState<number | null>(null)
  const [overCol, setOverCol] = useState<KanbanStatus | null>(null)
  const openIssue = issues.find((i) => i.id === openId) ?? null

  const handleDrop = (col: KanbanStatus) => {
    if (draggingId == null) return
    setIssues((prev) =>
      prev.map((i) => (i.id === draggingId ? { ...i, status: col } : i)),
    )
    setDragging(null)
    setOverCol(null)
  }

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
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
          }}
        >
          Issues
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
          {issues.length}
        </span>
        <div style={{ flex: 1 }} />
        {/* Filter */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 30,
            padding: "0 10px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="#555" strokeWidth="1.4" />
            <path
              d="M11 11l3 3"
              stroke="#555"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <input
            placeholder="Filter by keyword"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              color: "var(--text-secondary)",
              width: 140,
            }}
          />
        </label>
        {/* View toggle */}
        <ViewToggle mode={viewMode} onChange={setViewMode} />
        <button
          aria-label="Fetch issues"
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
          <IconRefresh size={13} />
        </button>
      </div>

      {/* Content */}
      {viewMode === "columns" ? (
        <ColumnsView
          issues={issues}
          draggingId={draggingId}
          overCol={overCol}
          onOpen={setOpenId}
          onDragStart={(id) => {
            setDragging(id)
            setOverCol(null)
          }}
          onDragEnd={() => {
            setDragging(null)
            setOverCol(null)
          }}
          onDragOver={setOverCol}
          onDrop={handleDrop}
        />
      ) : (
        <CollapsibleView
          issues={issues}
          onOpen={setOpenId}
          draggingId={draggingId}
          onDragStart={(id) => {
            setDragging(id)
            setOverCol(null)
          }}
          onDragEnd={() => {
            setDragging(null)
            setOverCol(null)
          }}
        />
      )}

      {/* Drawer */}
      {openIssue && (
        <IssueDrawer
          issue={openIssue}
          onClose={() => setOpenId(null)}
          onStatusChange={(newStatus) =>
            setIssues((prev) =>
              prev.map((i) =>
                i.id === openIssue.id ? { ...i, status: newStatus } : i,
              ),
            )
          }
        />
      )}
    </div>
  )
}
