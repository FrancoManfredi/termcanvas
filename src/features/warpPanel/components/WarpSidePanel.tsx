import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  IconIssue,
  IconActivity,
  IconAgents,
  IconWorkflow,
  IconContext,
  IconDiagnostic,
  IconTerminal,
  IconBranch,
  IconChevronLeft,
} from "./warpIcons";
import type { NavSection } from "../types";
import { useProjectStore } from "../../../stores/projectStore";
import { useWorkItemStore } from "../../../stores/workItemStore";

/**
 * WarpSidePanel — port of figma/Crear panel lateral interactivo
 * src/components/SidePanel.tsx.
 *
 * Verbatim JSX, inline styles, hover handlers, timings, cursors.
 * Mechanical substitution only: var(--*) → var(--wp-*) (scoped tokens),
 * NavSection type from shared ../types, icons from ./warpIcons.
 * The repo picker is component-local UI state per the design (draw-state
 * never enters adapters); its entries resolve to real project-store names
 * by projectId, never mock data or owner/repo slugs.
 */

interface NavItem {
  id: NavSection;
  label: string;
  Icon: ComponentType<{ size?: number; color?: string }>;
}

const DEPENDENCIES_ITEM: NavItem = { id: "dependencies", label: "Dependencies", Icon: IconTerminal };

const PROJECT_NAV_ITEMS: NavItem[] = [
  { id: "issues", label: "Issues", Icon: IconIssue },
  { id: "activity", label: "Activity", Icon: IconActivity },
  { id: "agents", label: "Agents", Icon: IconAgents },
  { id: "workflows", label: "Workflows", Icon: IconWorkflow },
  { id: "context", label: "Repository Context", Icon: IconContext },
  { id: "diagnostic", label: "Diagnostic", Icon: IconDiagnostic },
];

/**
 * Project entry for the repo picker. Only the human project-store name is
 * shown in the header (never the GitHub owner/repo slug). Branch is the
 * primary worktree branch for secondary context in the dropdown.
 */
interface WarpProjectRepo {
  projectId: string;
  name: string;
  branch: string;
}

/**
 * Pure repo-picker derivation (perf Ola 1, offline-testable).
 * A mistyped store slice degrades to honest-empty instead of throwing.
 */
export function deriveWarpRepos(projects: unknown): WarpProjectRepo[] {
  try {
    if (!Array.isArray(projects)) return [];
    return (projects as unknown[])
      .filter(
        (p): p is NonNullable<typeof p> =>
          p !== null && typeof p === "object" && !Array.isArray(p),
      )
      .map((p) => {
        try {
          const worktrees = Array.isArray(
            (p as { worktrees?: unknown }).worktrees,
          )
            ? ((p as { worktrees: unknown[] }).worktrees as {
                isPrimary?: unknown;
                name?: unknown;
              }[])
            : [];
          const primary =
            worktrees.find((w) => w?.isPrimary === true) ??
            worktrees[0] ??
            null;
          const id =
            typeof (p as { id?: unknown }).id === "string"
              ? ((p as { id: string }).id)
              : "";
          const name =
            typeof (p as { name?: unknown }).name === "string"
              ? ((p as { name: string }).name)
              : "";
          const branch =
            primary !== null && typeof primary.name === "string"
              ? primary.name
              : "";
          return { projectId: id, name, branch };
        } catch {
          return { projectId: "", name: "", branch: "" };
        }
      })
      .filter((r) => r.projectId !== "" || r.name !== "");
  } catch {
    return [];
  }
}

interface WarpSidePanelProps {
  activeSection: NavSection;
  onSectionChange: (s: NavSection) => void;
}

export function WarpSidePanel({
  activeSection,
  onSectionChange,
}: WarpSidePanelProps) {
  const [expanded, setExpanded] = useState(true);

  // Real projects from the canvas store. Header shows ONLY the project
  // name resolved by projectId; nothing is invented when absent. A
  // mistyped store slice (bad hydrate on the review→awaiting transition)
  // degrades to the honest-empty list instead of throwing on `.map`.
  const projects = useProjectStore((s) => s.projects);
  const focusedProjectId = useProjectStore((s) => s.focusedProjectId);
  // Ola C3: el circuit-breaker del poll tiñe el punto de conexión
  // (primitivo estable: solo re-renderiza al cambiar el flag).
  const pollDegraded = useWorkItemStore((s) => s.pollDegraded);
  // Perf Ola 1: memoized so unrelated project-store churn (terminal ticks
  // that keep the array identity) doesn't rebuild + re-render the header
  // every tick. Derivation itself is the pure `deriveWarpRepos` above.
  const repos: WarpProjectRepo[] = useMemo(
    () => deriveWarpRepos(projects),
    [projects],
  );
  const focusedIdx = repos.findIndex((r) => r.projectId === focusedProjectId);
  const safeIdx =
    repos.length === 0
      ? -1
      : Math.min(Math.max(focusedIdx >= 0 ? focusedIdx : 0, 0), repos.length - 1);
  const activeRepo = safeIdx >= 0 ? repos[safeIdx] : null;
  const activeName = activeRepo?.name ?? "No project";
  const activeBranch = activeRepo?.branch ?? "";
  const W = expanded ? 232 : 52;

  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      style={{
        width: W,
        minWidth: W,
        maxWidth: W,
        background: "var(--wp-bg-panel)",
        borderRight: "1px solid var(--wp-border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        transition:
          "width 200ms cubic-bezier(0.4,0,0.2,1), min-width 200ms cubic-bezier(0.4,0,0.2,1), max-width 200ms cubic-bezier(0.4,0,0.2,1)",
        overflow: "hidden",
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: expanded ? "space-between" : "center",
          padding: expanded ? "0 10px 0 16px" : "0",
          borderBottom: "1px solid var(--wp-border-subtle)",
          flexShrink: 0,
        }}
      >
        {expanded && (
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 11,
              fontWeight: 500,
              color: "var(--wp-text-tertiary)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            TermCanvas
          </span>
        )}
        <SidebarButton
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          onClick={() => setExpanded((v) => !v)}
        >
          <span
            style={{
              transform: expanded ? "none" : "rotate(180deg)",
              transition: "transform 200ms",
              display: "flex",
            }}
          >
            <IconChevronLeft size={14} />
          </span>
        </SidebarButton>
      </div>

      {/* ── Body ── */}
      <div
        style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingTop: 4 }}
      >
        {/* Dependencies first: machine-global tools, above the project card */}
        <div style={{ padding: "4px 0" }}>
          <NavButton
            item={DEPENDENCIES_ITEM}
            active={activeSection === DEPENDENCIES_ITEM.id}
            expanded={expanded}
            onClick={() => {
              if (!expanded) setExpanded(true);
              onSectionChange(DEPENDENCIES_ITEM.id);
            }}
          />
        </div>

        {/* Repository section — static header, no picker dropdown */}
        <div style={{ padding: "4px 0" }}>
          {/* Repo header — static row (project name + branch, never a slug) */}
          <div
            aria-label="Active repository"
            style={{
              width: "100%",
              height: 40,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: expanded ? "0 8px 0 14px" : "0",
              justifyContent: expanded ? "flex-start" : "center",
              background: "transparent",
              border: "none",
            }}
          >
            <span
              style={{
                color: "var(--wp-text-tertiary)",
                display: "flex",
                flexShrink: 0,
              }}
            >
              <IconBranch size={13} />
            </span>
            {expanded && (
              <span
                style={{
                  fontFamily: "var(--wp-font-mono)",
                  fontSize: 12,
                  color: "var(--wp-text-primary)",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "left",
                }}
              >
                {activeName}
              </span>
            )}
            {expanded && activeBranch !== "" && (
              <span
                style={{
                  fontFamily: "var(--wp-font-mono)",
                  fontSize: 10,
                  color: "var(--wp-text-disabled)",
                  flexShrink: 0,
                }}
              >
                {activeBranch}
              </span>
            )}
          </div>

          {/* Nav items */}
          <div style={{ marginTop: 2 }}>
            {PROJECT_NAV_ITEMS.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={activeSection === item.id}
                expanded={expanded}
                onClick={() => {
                  if (!expanded) setExpanded(true);
                  onSectionChange(item.id);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div
        style={{
          borderTop: "1px solid var(--wp-border-subtle)",
          height: 44,
          display: "flex",
          alignItems: "center",
          padding: expanded ? "0 14px" : "0",
          justifyContent: expanded ? "flex-start" : "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          aria-label={pollDegraded ? "Degraded" : "Connected"}
          title={
            pollDegraded
              ? "Poll degraded — factory is slow, refreshing 1 of 4 ticks"
              : "Connected"
          }
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: pollDegraded ? "#f59e0b" : "#22c55e",
            boxShadow: pollDegraded ? "0 0 6px #f59e0b80" : "0 0 6px #22c55e80",
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        {expanded && (
          <span
            style={{
              fontFamily: "var(--wp-font-mono)",
              fontSize: 11,
              color: "var(--wp-text-tertiary)",
            }}
          >
            {pollDegraded ? "degraded" : "connected"}
          </span>
        )}
      </div>
    </aside>
  );
}

// ─── NavButton ────────────────────────────────────────────────────────────────

function NavButton({
  item,
  active,
  expanded,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      aria-current={active ? "page" : undefined}
      title={!expanded ? item.label : undefined}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        height: 38,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: expanded ? "0 12px 0 30px" : "0",
        justifyContent: expanded ? "flex-start" : "center",
        background: active
          ? "var(--wp-accent-dim)"
          : hovered
            ? "var(--wp-bg-hover)"
            : "transparent",
        border: "none",
        borderLeft: expanded
          ? active
            ? "2px solid var(--wp-accent)"
            : "2px solid transparent"
          : "none",
        cursor: "pointer",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <span
        style={{
          display: "flex",
          flexShrink: 0,
          color: active
            ? "var(--wp-accent)"
            : hovered
              ? "var(--wp-text-secondary)"
              : "var(--wp-text-tertiary)",
          transition: "color 120ms",
        }}
      >
        <item.Icon size={14} />
      </span>
      {expanded && (
        <span
          style={{
            fontFamily: "var(--wp-font-sans)",
            fontSize: 13,
            fontWeight: active ? 600 : 400,
            color: active
              ? "var(--wp-text-primary)"
              : hovered
                ? "var(--wp-text-secondary)"
                : "var(--wp-text-tertiary)",
            whiteSpace: "nowrap",
            transition: "color 120ms",
          }}
        >
          {item.label}
        </span>
      )}
    </button>
  );
}

// ─── SidebarButton ────────────────────────────────────────────────────────────

function SidebarButton({
  children,
  onClick,
  title,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  title?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "none",
        background: "transparent",
        color: "var(--wp-text-tertiary)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 120ms, color 120ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--wp-bg-hover)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--wp-text-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--wp-text-tertiary)";
      }}
    >
      {children}
    </button>
  );
}
