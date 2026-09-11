import { useState } from "react";
import {
  IconIssue, IconActivity, IconAgents, IconContext, IconDiagnostic,
  IconBranch, IconChevronDown, IconChevronLeft, IconClose,
} from "./icons";

export type NavSection = "issues" | "activity" | "agents" | "context" | "diagnostic";

interface NavItem {
  id: NavSection;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: "issues",     label: "Issues",             Icon: IconIssue      },
  { id: "activity",   label: "Activity",            Icon: IconActivity   },
  { id: "agents",     label: "Agents",              Icon: IconAgents     },
  { id: "context",    label: "Repository Context",  Icon: IconContext     },
  { id: "diagnostic", label: "Diagnostic",          Icon: IconDiagnostic },
];

const MOCK_REPOS = [
  { name: "term-canvas",   branch: "main" },
  { name: "api-gateway",   branch: "develop" },
  { name: "worker-nodes",  branch: "main" },
];

interface Props {
  activeSection: NavSection;
  onSectionChange: (s: NavSection) => void;
}

export default function SidePanel({ activeSection, onSectionChange }: Props) {
  const [expanded,       setExpanded]       = useState(true);
  const [repoOpen,       setRepoOpen]       = useState(true);
  const [activeRepoIdx,  setActiveRepoIdx]  = useState(0);
  const [pickerOpen,     setPickerOpen]     = useState(false);

  const activeRepo = MOCK_REPOS[activeRepoIdx];
  const W = expanded ? 232 : 52;

  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      style={{
        width: W,
        minWidth: W,
        maxWidth: W,
        background: "var(--bg-panel)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        transition: "width 200ms cubic-bezier(0.4,0,0.2,1), min-width 200ms cubic-bezier(0.4,0,0.2,1), max-width 200ms cubic-bezier(0.4,0,0.2,1)",
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
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {expanded && (
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            color: "var(--text-tertiary)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}>
            TermCanvas
          </span>
        )}
        <SidebarButton
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          onClick={() => setExpanded(v => !v)}
        >
          <span style={{ transform: expanded ? "none" : "rotate(180deg)", transition: "transform 200ms", display: "flex" }}>
            <IconChevronLeft size={14} />
          </span>
        </SidebarButton>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingTop: 4 }}>

        {/* Repository section */}
        <div style={{ padding: "4px 0" }}>

          {/* Repo header — clickable row */}
          <button
            aria-expanded={repoOpen}
            aria-label={expanded ? "Toggle repository section" : "Expand sidebar"}
            onClick={() => {
              if (!expanded) { setExpanded(true); return; }
              setRepoOpen(v => !v);
            }}
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
              cursor: "pointer",
              transition: "background 120ms",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            {expanded && (
              <span style={{
                color: "var(--text-disabled)",
                fontSize: 9,
                transition: "transform 150ms",
                transform: repoOpen ? "rotate(0deg)" : "rotate(-90deg)",
                display: "flex",
                flexShrink: 0,
              }}>
                <IconChevronDown size={9} />
              </span>
            )}
            <span style={{ color: "var(--text-tertiary)", display: "flex", flexShrink: 0 }}>
              <IconBranch size={13} />
            </span>
            {expanded && (
              <span style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--text-primary)",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textAlign: "left",
              }}>
                {activeRepo.name}
              </span>
            )}
            {expanded && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Switch repository"
                title="Switch repository"
                onClick={e => { e.stopPropagation(); setPickerOpen(v => !v); }}
                onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); setPickerOpen(v => !v); }}}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: pickerOpen ? "var(--text-primary)" : "var(--text-disabled)",
                  background: pickerOpen ? "var(--bg-hover)" : "transparent",
                  transition: "color 120ms, background 120ms",
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                  (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
                }}
                onMouseLeave={e => {
                  if (!pickerOpen) {
                    (e.currentTarget as HTMLElement).style.color = "var(--text-disabled)";
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }
                }}
              >
                <span style={{ transform: pickerOpen ? "rotate(180deg)" : "none", transition: "transform 150ms", display: "flex" }}>
                  <IconChevronDown size={9} />
                </span>
              </span>
            )}
          </button>

          {/* Repo picker */}
          {expanded && pickerOpen && (
            <div
              role="listbox"
              aria-label="Repository list"
              style={{
                margin: "2px 8px 4px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "#161616",
                overflow: "hidden",
              }}
            >
              {MOCK_REPOS.map((repo, idx) => {
                const isActive = idx === activeRepoIdx;
                return (
                  <button
                    key={repo.name}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => { setActiveRepoIdx(idx); setPickerOpen(false); }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      background: isActive ? "var(--accent-dim)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      transition: "background 100ms",
                    }}
                    onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)"; }}
                    onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                  >
                    <IconBranch size={11} color={isActive ? "var(--accent)" : "var(--text-tertiary)"} />
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: isActive ? "var(--accent)" : "var(--text-secondary)",
                      flex: 1,
                      textAlign: "left",
                    }}>
                      {repo.name}
                    </span>
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-disabled)",
                    }}>
                      {repo.branch}
                    </span>
                    {isActive && (
                      <IconClose size={9} color="var(--accent)" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Nav items */}
          {(repoOpen || !expanded) && (
            <div style={{ marginTop: 2 }}>
              {NAV_ITEMS.map(item => (
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
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{
        borderTop: "1px solid var(--border-subtle)",
        height: 44,
        display: "flex",
        alignItems: "center",
        padding: expanded ? "0 14px" : "0",
        justifyContent: expanded ? "flex-start" : "center",
        gap: 8,
        flexShrink: 0,
      }}>
        <span
          aria-label="Connected"
          title="Connected"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#22c55e",
            boxShadow: "0 0 6px #22c55e80",
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        {expanded && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>
            connected
          </span>
        )}
      </div>
    </aside>
  );
}

// ─── NavButton ────────────────────────────────────────────────────────────────

function NavButton({ item, active, expanded, onClick }: {
  item: NavItem; active: boolean; expanded: boolean; onClick: () => void;
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
        background: active ? "var(--accent-dim)" : hovered ? "var(--bg-hover)" : "transparent",
        border: "none",
        borderLeft: expanded ? (active ? "2px solid var(--accent)" : "2px solid transparent") : "none",
        cursor: "pointer",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <span style={{
        display: "flex",
        flexShrink: 0,
        color: active ? "var(--accent)" : hovered ? "var(--text-secondary)" : "var(--text-tertiary)",
        transition: "color 120ms",
      }}>
        <item.Icon size={14} />
      </span>
      {expanded && (
        <span style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: active ? "var(--text-primary)" : hovered ? "var(--text-secondary)" : "var(--text-tertiary)",
          whiteSpace: "nowrap",
          transition: "color 120ms",
        }}>
          {item.label}
        </span>
      )}
    </button>
  );
}

// ─── SidebarButton ────────────────────────────────────────────────────────────

function SidebarButton({ children, onClick, title, "aria-label": ariaLabel }: {
  children: React.ReactNode;
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
        color: "var(--text-tertiary)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 120ms, color 120ms",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text-tertiary)";
      }}
    >
      {children}
    </button>
  );
}
