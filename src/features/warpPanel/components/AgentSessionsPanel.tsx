/**
 * Agent Sessions: una fila por etapa EXACTA del workflow (Foreman + nodos),
 * con estado real derivado del engine y el botón habilitado desde que la
 * sesión existe (el mensaje se envió), no cuando la fase termina.
 * Solo pinta; la derivación vive en `adapters/agentTimeline.ts`.
 */
import { useState } from "react";
import type { AgentStage, AgentStageState, AgentTimelineModel } from "../adapters/agentTimeline";
import { agentSessionSummary, buildAgentTimeline } from "../adapters/agentTimeline";
import type { IssueFactoryJob } from "../types";
import { openIssueInGitHub } from "./KanbanBoard";

const ERROR_ACCENT = "#f85149";

/** Opción del selector de rondas: una sesión numerada o la vigente. */
interface RoundOption {
  key: string;
  label: string;
  url: string;
  title: string;
}

/**
 * Opciones de sesión de la fila: rondas previas (R1 → Rn) + la vigente al
 * final (la que VIEW AGENT abría antes). Sin rondas → una sola opción o
 * ninguna. Orden estable para que la selección persista entre polls.
 */
function roundOptionsFor(row: AgentStage): RoundOption[] {
  try {
    const options: RoundOption[] = [];
    const seen = new Set<string>();
    const rounds = Array.isArray(row.rounds) ? [...row.rounds] : [];
    rounds.sort((a, b) => a.round - b.round);
    for (const entry of rounds) {
      try {
        if (!entry || typeof entry.round !== "number" || !entry.sessionUrl) {
          continue;
        }
        if (seen.has(entry.sessionUrl)) continue;
        seen.add(entry.sessionUrl);
        options.push({
          key: `r${entry.round}`,
          label: `R${entry.round}`,
          url: entry.sessionUrl,
          title: `Open round ${entry.round} session`,
        });
      } catch {
        // una ronda rota nunca aborta a las demás
      }
    }
    if (typeof row.sessionUrl === "string" && row.sessionUrl !== "") {
      if (!seen.has(row.sessionUrl)) {
        const current =
          typeof row.currentRound === "number" ? row.currentRound : null;
        options.push({
          key: "latest",
          label: current !== null ? `R${current}` : "LATEST",
          url: row.sessionUrl,
          title:
            current !== null
              ? `Open latest session (round ${current})`
              : "Open latest session",
        });
      }
    }
    return options;
  } catch {
    return [];
  }
}

/**
 * Selector compacto de rondas (segmented): solo aparece cuando el nodo
 * loopéo (2+ sesiones). El segmento activo abre VIEW AGENT; por defecto es
 * la sesión vigente (comportamiento previo intacto).
 */
function RoundPicker({
  rowId,
  options,
  activeKey,
  onSelect,
}: {
  rowId: string;
  options: RoundOption[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <span
      role="group"
      aria-label={`Session rounds for ${rowId}`}
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        border: "1px solid var(--wp-border-subtle)",
        borderRadius: 6,
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {options.map((option, index) => {
        const active = option.key === activeKey;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            title={option.title}
            aria-label={option.title}
            onClick={() => onSelect(option.key)}
            style={{
              height: 22,
              display: "flex",
              alignItems: "center",
              padding: "0 7px",
              background: active ? "var(--wp-accent-dim)" : "transparent",
              border: "none",
              borderLeft:
                index === 0 ? "none" : "1px solid var(--wp-border-subtle)",
              boxShadow: active
                ? "inset 0 0 0 1px var(--wp-accent-border)"
                : "none",
              color: active
                ? "var(--wp-text-primary)"
                : "var(--wp-text-disabled)",
              fontFamily: "var(--wp-font-mono)",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.05em",
              cursor: "pointer",
              transition: "background 110ms, color 110ms",
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.background = "var(--wp-bg-hover)";
                e.currentTarget.style.color = "var(--wp-text-secondary)";
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--wp-text-disabled)";
              }
            }}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

function AgentSessionRow({ row }: { row: AgentStage }) {
  const options = roundOptionsFor(row);
  const defaultKey =
    options.length > 0 ? options[options.length - 1]!.key : "";
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const active =
    options.find((option) => option.key === selectedKey) ??
    options.find((option) => option.key === defaultKey) ??
    null;
  const url = active?.url ?? row.sessionUrl;
  const enabled =
    typeof url === "string" && url !== "" && /^https?:\/\//i.test(url);
  const label = row.label.toUpperCase();
  const color = stateColor(row.state);
  const isSystem = row.kind === "system";
  const targetSuffix =
    active !== null && options.length >= 2 ? ` (${active.label})` : "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 10,
          fontWeight: 600,
          color: enabled
            ? "var(--wp-text-secondary)"
            : "var(--wp-text-disabled)",
          letterSpacing: "0.06em",
          minWidth: 90,
        }}
      >
        {label}
      </span>
      <span
        title={
          isSystem
            ? "System-owned stage — runs in the worktree, no agent session"
            : row.agent !== null
              ? `agent: ${row.agent}`
              : "agent: pending"
        }
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 9,
          color: "var(--wp-text-disabled)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {isSystem ? "system check" : (row.agent ?? "—")}
      </span>
      <span
        style={{
          fontFamily: "var(--wp-font-mono)",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.05em",
          color,
        }}
      >
        {stateLabel(row.state)}
      </span>
      {isSystem ? (
        <span
          title="System-owned verification — no agent session to open"
          style={{
            height: 28,
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            borderRadius: 6,
            border: "1px solid var(--wp-border-subtle)",
            background: "transparent",
            fontFamily: "var(--wp-font-mono)",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: "var(--wp-text-disabled)",
          }}
        >
          SYSTEM
        </span>
      ) : (
        <>
          <RoundPicker
            rowId={label}
            options={options}
            activeKey={active?.key ?? ""}
            onSelect={setSelectedKey}
          />
          <button
            type="button"
            disabled={!enabled}
            title={
              enabled
                ? `Open the ${label} agent session in a new tab${targetSuffix}`
                : `The ${label} session is not available yet — it appears as soon as the agent message is sent`
            }
            aria-label={
              enabled
                ? `View ${label} agent session${targetSuffix}`
                : `${label} agent session not available yet`
            }
            onClick={() => {
              if (!enabled || url === null || url === undefined) return;
              try {
                openIssueInGitHub(url);
              } catch {
                // apertura best-effort
              }
            }}
            style={{
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "0 12px",
              borderRadius: 6,
              border: "1px solid var(--wp-border)",
              background: enabled ? "var(--wp-bg)" : "transparent",
              color: enabled
                ? "var(--wp-text-secondary)"
                : "var(--wp-text-disabled)",
              fontFamily: "var(--wp-font-sans)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.02em",
              cursor: enabled ? "pointer" : "not-allowed",
              opacity: enabled ? 1 : 0.55,
              transition: "background 110ms, color 110ms",
            }}
            onMouseEnter={(e) => {
              if (enabled) {
                e.currentTarget.style.background = "var(--wp-bg-hover)";
                e.currentTarget.style.color = "var(--wp-text-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (enabled) {
                e.currentTarget.style.background = "var(--wp-bg)";
                e.currentTarget.style.color = "var(--wp-text-secondary)";
              }
            }}
          >
            VIEW AGENT
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 2.5H9.5V8M9.5 2.5L2.5 9.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

function stateLabel(state: AgentStageState): string {
  switch (state) {
    case "running":
      return "RUNNING";
    case "completed":
      return "DONE";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    case "skipped":
      return "SKIPPED";
    case "waiting-gate":
      return "WAITING";
    default:
      return "PENDING";
  }
}

function stateColor(state: AgentStageState): string {
  switch (state) {
    case "running":
      return "var(--wp-status-progress)";
    case "completed":
      return "var(--wp-status-done)";
    case "waiting-gate":
      return "var(--wp-status-awaiting)";
    case "failed":
    case "cancelled":
      return ERROR_ACCENT;
    default:
      return "var(--wp-text-disabled)";
  }
}

export function AgentSessionsPanel({
  factory,
  opencodeIssue = null,
}: {
  factory: IssueFactoryJob | null | undefined;
  /** Daemon opencode health when NOT healthy (why sessions are missing). */
  opencodeIssue?: string | null;
}) {
  const [open, setOpen] = useState(true);
  if (!factory) return null;
  const timeline: AgentTimelineModel = buildAgentTimeline(factory);
  const rows = timeline.stages;
  if (rows.length === 0) return null;
  const summary = agentSessionSummary(rows);
  const agentsTotal = summary.agentTotal;
  const available = summary.available;

  return (
    <div
      style={{
        marginTop: 12,
        borderRadius: 7,
        background: "var(--wp-bg-elevated)",
        border: "1px solid var(--wp-border-subtle)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={
          summary.systemTotal > 0
            ? `Agent sessions — ${available} of ${agentsTotal} available, ${summary.systemTotal} system-owned`
            : `Agent sessions — ${available} of ${agentsTotal} available`
        }
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 13px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--wp-text-disabled)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            flex: 1,
            textAlign: "left",
          }}
        >
          Agent sessions
        </span>
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "var(--wp-text-disabled)",
          }}
        >
          {`${available}/${agentsTotal}`}
        </span>
        <span
          style={{
            display: "flex",
            color: "var(--wp-text-disabled)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
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
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "4px 13px 12px",
          }}
        >
          {available === 0 &&
          typeof opencodeIssue === "string" &&
          opencodeIssue !== "" ? (
            <p
              style={{
                margin: 0,
                padding: "7px 9px",
                borderRadius: 5,
                background: "rgba(248,81,73,0.07)",
                border: "1px solid rgba(248,81,73,0.25)",
                fontFamily: "var(--wp-font-mono)",
                fontSize: 10,
                lineHeight: 1.5,
                color: "#f0a8a2",
                wordBreak: "break-word",
              }}
            >
              {`No live sessions — ${opencodeIssue}. The daemon starts the agent server on demand; fix the daemon/opencode binary and the sessions appear here.`}
            </p>
          ) : null}
          {rows.map((row: AgentStage) => (
            <AgentSessionRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

export default AgentSessionsPanel;
