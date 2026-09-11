import { useEffect, useState } from "react";
import { KANBAN_COLUMNS, type KanbanIssue, type KanbanStatus } from "../data/kanban";
import { IconClose } from "./icons";

const STATUS_COLORS: Record<KanbanStatus, string> = {
  backlog: "#22c55e", ready: "#3b82f6", "in-progress": "#f59e0b", "in-review": "#a855f7", done: "#f97316",
};

const ANIM_MS = 220;

// ─── Sidebar section ──────────────────────────────────────────────────────────

function SideSection({ title, onEdit, children }: {
  title: string; onEdit?: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ paddingBottom: 14, borderBottom: "1px solid #1a1a1a", marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, color: "#666", letterSpacing: "0.02em" }}>{title}</span>
        {onEdit && (
          <button onClick={onEdit} style={{ width: 20, height: 20, borderRadius: 3, border: "none", background: "transparent", color: "#333", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "color 120ms, background 120ms" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color="#999"; (e.currentTarget as HTMLButtonElement).style.background="#1e1e1e"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color="#333"; (e.currentTarget as HTMLButtonElement).style.background="transparent"; }}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SideValue({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "#555" }}>{children}</span>;
}

function SideRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 26 }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "#4a4a4a" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "#4a4a4a" }}>{value}</span>
    </div>
  );
}

// ─── Activity event ───────────────────────────────────────────────────────────

function ActivityItem({ event }: { event: KanbanIssue["activity"][0] }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingBottom: 14, position: "relative" }}>
      <div style={{ position: "absolute", left: 11, top: 22, bottom: -4, width: 1, background: "#1c1c1c" }} />
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: event.actorColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, color: "#000", zIndex: 1 }}>
        {event.actor[0]}
      </div>
      <div style={{ flex: 1, paddingTop: 2 }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "#d0d0d0", fontWeight: 600 }}>{event.actor}</span>
        {" "}
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "#555" }}>{event.text}</span>
        {" "}
        {event.type === "linked-pr" && event.detail && (
          <a href={event.detailHref ?? "#"} style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "#3b82f6", textDecoration: "underline" }}>{event.detail}</a>
        )}
        {event.type === "added-label" && event.labelName && (
          <span style={{ display: "inline-block", padding: "0 7px", borderRadius: 12, background: event.labelBg, fontFamily: "var(--font-sans)", fontSize: 11, color: event.labelFg, marginLeft: 2 }}>{event.labelName}</span>
        )}
        {" "}
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "#3a3a3a" }}>{event.ago}</span>
      </div>
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

interface Props {
  issue: KanbanIssue;
  onClose: () => void;
  onStatusChange: (s: KanbanStatus) => void;
}

export default function IssueDrawer({ issue, onClose, onStatusChange }: Props) {
  const [visible, setVisible]     = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const col = KANBAN_COLUMNS.find(c => c.id === issue.status)!;

  // Mount → animate in
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Keyboard dismiss
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, ANIM_MS);
  }

  const ease = `cubic-bezier(0.32, 0.72, 0, 1)`;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.45)",
          zIndex: 40,
          opacity: visible ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ease`,
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Issue #${issue.number}: ${issue.title}`}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "min(1100px, 78vw)",
          background: "#0f0f0f",
          borderLeft: "1px solid #282828",
          display: "flex",
          flexDirection: "column",
          zIndex: 50,
          overflow: "hidden",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition: `transform ${ANIM_MS}ms ${ease}`,
        }}
      >
        {/* Top bar */}
        <div style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 0 20px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#444" }}>{issue.repoName}</span>
            <span style={{ color: "#282828", fontSize: 11 }}>/</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#666" }}>#{issue.number}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <TopBtn aria-label="Copy link"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg></TopBtn>
            <TopBtn aria-label="Pin issue"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M9.5 1.5l5 5-2 2-1.5-1L8 10.5l.5 1.5-1.5 1.5L5 11l-3 3-1.5-1.5 3-3-2.5-2L2.5 6l1.5.5 3-3-1-1.5 2-2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg></TopBtn>
            <TopBtn aria-label="More"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg></TopBtn>
            <button aria-label="Close" onClick={handleClose} style={{ width: 30, height: 30, borderRadius: 6, border: "none", background: "transparent", color: "#555", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 120ms, color 120ms" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background="#1e1e1e"; (e.currentTarget as HTMLButtonElement).style.color="#e0e0e0"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background="transparent"; (e.currentTarget as HTMLButtonElement).style.color="#555"; }}
            ><IconClose size={13} /></button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Left: main content */}
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "22px 26px 40px" }}>

            {/* Title */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 14 }}>
              <h1 style={{ fontFamily: "var(--font-sans)", fontSize: 20, fontWeight: 700, color: "#f0f0f0", lineHeight: 1.3, margin: 0, flex: 1, letterSpacing: "-0.02em" }}>
                {issue.title}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 16, fontWeight: 400, color: "#3a3a3a", marginLeft: 8 }}>#{issue.number}</span>
              </h1>
              <button aria-label="Edit title" style={{ width: 28, height: 28, borderRadius: 5, border: "none", background: "transparent", color: "#333", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "color 120ms, background 120ms" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color="#aaa"; (e.currentTarget as HTMLButtonElement).style.background="#1c1c1c"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color="#333"; (e.currentTarget as HTMLButtonElement).style.background="transparent"; }}
              ><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg></button>
            </div>

            {/* Status row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20, background: "#14532d", border: "1px solid #166534" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80" }} />
                <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, color: "#4ade80" }}>Open</span>
              </div>
              {issue.prNumber && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, background: "#0f2036", border: "1px solid #1d4ed840", cursor: "pointer" }}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="3.5" r="1.5" fill="#4ade80"/><circle cx="4" cy="12.5" r="1.5" fill="#4ade80"/><circle cx="12" cy="6" r="1.5" fill="#4ade80"/><path d="M4 5v5M4 5c0 3 8 3 8 0" stroke="#4ade80" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#4ade80" }}>#{issue.prNumber}</span>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, background: "#161616", border: "1px solid #222" }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2H4.5a1 1 0 0 0-.75 1.67.75.75 0 0 1-1.132.975A2.5 2.5 0 0 1 2 11V2.5zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.492 2.492 0 0 1 4.5 9h8V1.5z" fill="#666"/></svg>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#666" }}>FrancoManfredi/{issue.repoName}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#444", background: "#1a1a1a", border: "1px solid #2a2a2a", padding: "0 4px", borderRadius: 3 }}>Private</span>
              </div>
            </div>

            {/* Author line — compact */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: issue.authorColor, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, color: "#000", flexShrink: 0 }}>
                {issue.author[0]}
              </div>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "#888", fontWeight: 600 }}>{issue.author}</span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "#3e3e3e" }}>opened {issue.openedAgo}</span>
            </div>

            {/* Body */}
            <div style={{ paddingBottom: 24, borderBottom: "1px solid #1a1a1a", marginBottom: 24 }}>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "#909090", lineHeight: 1.75, whiteSpace: "pre-wrap", margin: 0 }}>
                {issue.body}
              </p>
            </div>
          </div>

          {/* Right sidebar */}
          <div style={{ width: 220, flexShrink: 0, borderLeft: "1px solid #1a1a1a", overflowY: "auto", padding: "14px 12px 40px" }}>

            {/* Assignees — no assign yourself, no assign to agent */}
            <SideSection title="Assignees" onEdit={() => {}}>
              {issue.assignees?.length ? (
                issue.assignees.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: a.color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 7, fontWeight: 700, color: "#000" }}>{a.initials[0]}</div>
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "#aaa" }}>{a.initials}</span>
                  </div>
                ))
              ) : (
                <SideValue>No one assigned</SideValue>
              )}
            </SideSection>

            {/* Labels */}
            <SideSection title="Labels" onEdit={() => {}}>
              {issue.labels.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {issue.labels.map(l => (
                    <span key={l.name} style={{ padding: "2px 8px", borderRadius: 12, background: l.bg, fontFamily: "var(--font-sans)", fontSize: 11, color: l.fg, fontWeight: 500 }}>{l.name}</span>
                  ))}
                </div>
              ) : (
                <SideValue>None yet</SideValue>
              )}
            </SideSection>

            {/* Status (replaces Projects) */}
            <SideSection title="Status" onEdit={() => {}}>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setStatusOpen(v => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 9px", borderRadius: 5, border: `1px solid ${STATUS_COLORS[issue.status]}40`, background: `${STATUS_COLORS[issue.status]}12`, cursor: "pointer", transition: "background 120ms", width: "100%" }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background=`${STATUS_COLORS[issue.status]}1e`}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background=`${STATUS_COLORS[issue.status]}12`}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLORS[issue.status] }} />
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: STATUS_COLORS[issue.status], fontWeight: 600, flex: 1, textAlign: "left" }}>{col.label}</span>
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none" style={{ color: STATUS_COLORS[issue.status], flexShrink: 0 }}><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                {statusOpen && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#161616", border: "1px solid #282828", borderRadius: 6, overflow: "hidden", zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
                    {KANBAN_COLUMNS.map(c => (
                      <button key={c.id} onClick={() => { onStatusChange(c.id); setStatusOpen(false); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", background: issue.status === c.id ? `${STATUS_COLORS[c.id]}14` : "transparent", border: "none", cursor: "pointer", transition: "background 90ms" }}
                        onMouseEnter={e => { if (issue.status !== c.id) (e.currentTarget as HTMLButtonElement).style.background="#1e1e1e"; }}
                        onMouseLeave={e => { if (issue.status !== c.id) (e.currentTarget as HTMLButtonElement).style.background="transparent"; }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLORS[c.id] }} />
                        <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: issue.status === c.id ? STATUS_COLORS[c.id] : "#aaa" }}>{c.label}</span>
                        {issue.status === c.id && <span style={{ marginLeft: "auto", fontSize: 11, color: STATUS_COLORS[c.id] }}>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                <SideRow label="Priority" value={issue.priority
                  ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: issue.priority === "P0" ? "#fca5a5" : issue.priority === "P1" ? "#93c5fd" : "#a8a29e" }}>{issue.priority}</span>
                  : <SideValue>—</SideValue>}
                />
              </div>
            </SideSection>

            {/* Relationships */}
            <SideSection title="Relationships" onEdit={() => {}}>
              <SideValue>None yet</SideValue>
            </SideSection>

            {/* Development */}
            {issue.prNumber && (
              <SideSection title="Development" onEdit={() => {}}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ marginTop: 2, flexShrink: 0 }}><circle cx="4" cy="3.5" r="1.5" fill="#4ade80"/><circle cx="4" cy="12.5" r="1.5" fill="#4ade80"/><circle cx="12" cy="6" r="1.5" fill="#4ade80"/><path d="M4 5v5M4 5c0 3 8 3 8 0" stroke="#4ade80" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <div>
                    <a href="#" style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "#3b82f6", textDecoration: "underline", display: "block", lineHeight: 1.4 }}>{issue.prTitle}</a>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#3a3a3a" }}>FrancoManfredi/{issue.repoName}</span>
                  </div>
                </div>
              </SideSection>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TopBtn({ children, "aria-label": al }: { children: React.ReactNode; "aria-label": string }) {
  return (
    <button aria-label={al} style={{ width: 30, height: 30, borderRadius: 5, border: "none", background: "transparent", color: "#444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "color 120ms, background 120ms" }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color="#bbb"; (e.currentTarget as HTMLButtonElement).style.background="#1c1c1c"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color="#444"; (e.currentTarget as HTMLButtonElement).style.background="transparent"; }}
    >{children}</button>
  );
}
