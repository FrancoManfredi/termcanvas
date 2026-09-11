import { useState } from "react";
import type { Agent } from "./AgentsPanel";

// ─── Per-agent config data ─────────────────────────────────────────────────────

export interface AgentConfigData {
  description: string;
  mcps: { id: string; name: string; icon: string; color: string }[];
  secrets: { id: string; key: string; masked: string }[];
  harness: string;
  model: string;
  runner: string;
  host: string;
  prompt: string;
  automations: Automation[];
}

export interface Automation {
  id: string;
  trigger: string;
  description: string;
  enabled: boolean;
}

export const AGENT_CONFIGS: Record<string, AgentConfigData> = {
  foreman: {
    description: "Orchestrates the worktree workflow and dispatches each gated step.",
    mcps: [
      { id: "github", name: "GitHub",  icon: "GH", color: "#6e6e6e" },
      { id: "linear", name: "Linear",  icon: "LN", color: "#5e6ad2" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN", masked: "ghp_••••••••••••••••••••" },
      { id: "s2", key: "LINEAR_API_KEY", masked: "lin_api_••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-opus-5 (max)",
    runner: "default",
    host: "Self hosted",
    prompt: `# Foreman

You are the orchestrator agent of the TermCanvas software factory. Your role is to manage the full lifecycle of a repository issue — from triage through implementation, review, and merge.

## Responsibilities
- Dispatch sub-agents (Triage, Spec, Implement, Review) in sequence
- Gate transitions between phases based on agent outputs
- Surface blockers to the human operator via the Activity panel
- Track worktree state and clean up stale branches

## Input
You receive an issue ID and repository context. You decide which agent to invoke next based on the current issue state.

## Output
Update issue status in the kanban board and emit structured handoff payloads to the next agent in the pipeline.`,
    automations: [
      { id: "a1", trigger: "New issue labeled 'agent-ready'", description: "Auto-dispatch Triage agent when a new issue receives the agent-ready label.", enabled: true },
      { id: "a2", trigger: "PR merged to main", description: "Mark linked issue as Done and archive the worktree branch.", enabled: true },
      { id: "a3", trigger: "Issue idle for 48h", description: "Send a summary digest to the Activity panel.", enabled: false },
    ],
  },
  triage: {
    description: "Triages repository issues and establishes task state.",
    mcps: [
      { id: "github", name: "GitHub", icon: "GH", color: "#6e6e6e" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN", masked: "ghp_••••••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-sonnet-5 (high)",
    runner: "default",
    host: "Warp hosted",
    prompt: `# Triage

You are the triage agent of the TermCanvas software factory. You research the issue, reproduce bugs, and create or update the work item that tracks the work.

## Responsibilities
- Read the issue body and linked context
- Classify: bug / feature / chore / question
- Assign a priority (P0–P2) and size estimate (S/M/L/XL)
- Write a structured triage comment on the GitHub issue

## Input
Issue ID, repository URL, and recent commit log.

## Output
Structured JSON with classification, priority, size, and a one-paragraph triage summary. The orchestrator decides what happens next.`,
    automations: [
      { id: "a1", trigger: "Issue opened", description: "Automatically triage any issue opened without an assignee.", enabled: true },
      { id: "a2", trigger: "Issue reopened", description: "Re-triage an issue when it's reopened after being closed.", enabled: false },
    ],
  },
  spec: {
    description: "Writes and drives approval of issue specifications.",
    mcps: [
      { id: "github", name: "GitHub",  icon: "GH", color: "#6e6e6e" },
      { id: "notion", name: "Notion",  icon: "N",  color: "#ffffff" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN",  masked: "ghp_••••••••••••••••••••" },
      { id: "s2", key: "NOTION_SECRET", masked: "secret_••••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-opus-5 (max)",
    runner: "default",
    host: "Warp hosted",
    prompt: `# Spec

You are the spec agent of the TermCanvas software factory. You write detailed technical specifications for triaged issues and get them approved before implementation begins.

## Responsibilities
- Expand the triage summary into a full implementation spec
- Define acceptance criteria, edge cases, and affected files
- Post the spec as a comment on the GitHub issue for human review
- Iterate on the spec based on review feedback

## Input
Triage output JSON and repository file tree.

## Output
A markdown specification document. The orchestrator gates the Implement agent on human approval of this spec.`,
    automations: [
      { id: "a1", trigger: "Triage complete", description: "Auto-start spec writing after triage output is received.", enabled: true },
      { id: "a2", trigger: "Spec approved", description: "Notify the Foreman agent to dispatch Implement.", enabled: true },
    ],
  },
  implement: {
    description: "Implements, validates, and commits code changes to the worktree.",
    mcps: [
      { id: "github", name: "GitHub", icon: "GH", color: "#6e6e6e" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN", masked: "ghp_••••••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-sonnet-5 (high)",
    runner: "default",
    host: "Self hosted",
    prompt: `# Implement

You are the implement agent of the TermCanvas software factory. You turn approved specs into committed code changes on a dedicated worktree branch.

## Responsibilities
- Checkout or create the worktree branch \`issue-{n}\`
- Implement all acceptance criteria from the spec
- Run the test suite and fix failures before committing
- Open a pull request against main with a structured description

## Input
Approved spec document and current repo state.

## Output
A pull request URL. The orchestrator dispatches the Review agent once the PR is open.`,
    automations: [
      { id: "a1", trigger: "Spec approved", description: "Begin implementation as soon as the spec receives approval.", enabled: true },
      { id: "a2", trigger: "Test suite fails", description: "Pause and notify the human if tests fail after 3 retries.", enabled: true },
      { id: "a3", trigger: "Branch stale for 24h", description: "Post a status update to the Activity panel.", enabled: false },
    ],
  },
  review: {
    description: "Reviews pull requests and routes findings to rework or human resolution.",
    mcps: [
      { id: "github", name: "GitHub", icon: "GH", color: "#6e6e6e" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN", masked: "ghp_••••••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-opus-5 (max)",
    runner: "default",
    host: "Warp hosted",
    prompt: `# Review

You are the review agent of the TermCanvas software factory. You review pull requests for correctness, security, and spec compliance.

## Responsibilities
- Diff the PR against the spec acceptance criteria
- Flag security issues, logic bugs, and missing tests
- Post inline review comments on GitHub
- Route the outcome: approve (merge-ready), request changes (back to Implement), or escalate (human resolution)

## Input
Pull request diff, spec document, and test results.

## Output
A GitHub review decision with structured findings. The orchestrator routes the issue based on the outcome.`,
    automations: [
      { id: "a1", trigger: "PR opened",           description: "Begin review automatically when a PR is opened by the Implement agent.", enabled: true },
      { id: "a2", trigger: "PR updated",           description: "Re-run review when new commits are pushed to the PR branch.", enabled: true },
      { id: "a3", trigger: "Review approved",      description: "Mark the issue as merge-ready and notify the human.", enabled: true },
    ],
  },
};

const MODEL_OPTIONS   = ["claude-opus-5 (max)", "claude-sonnet-5 (high)", "claude-haiku-4-5 (fast)", "gpt-4o (high)", "gemini-2.5-pro (high)"];
const HARNESS_OPTIONS = ["Warp", "iTerm2", "Terminal.app", "VS Code"];
const RUNNER_OPTIONS  = ["default", "docker", "nix-shell", "remote-ssh"];
const HOST_OPTIONS    = ["Warp hosted", "Self hosted", "GitHub Actions", "Custom"];

const AVAILABLE_MCPS = [
  { id: "github",    name: "GitHub",    icon: "GH", color: "#6e6e6e", desc: "Read/write issues, PRs, and code" },
  { id: "linear",    name: "Linear",    icon: "LN", color: "#5e6ad2", desc: "Sync issues and project state" },
  { id: "notion",    name: "Notion",    icon: "N",  color: "#ffffff", desc: "Read and write documentation pages" },
  { id: "slack",     name: "Slack",     icon: "SL", color: "#4a154b", desc: "Send notifications and messages" },
  { id: "postgres",  name: "Postgres",  icon: "PG", color: "#336791", desc: "Query and mutate database records" },
  { id: "filesystem",name: "Filesystem",icon: "FS", color: "#888888", desc: "Read/write local files and directories" },
];

// ─── Shared UI atoms ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-disabled)", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px", width: 72, flexShrink: 0 }}>
      {children}
    </p>
  );
}

function SelectField({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", height: 36, padding: "0 32px 0 12px",
          background: "var(--bg-elevated)", border: "1px solid var(--border)",
          borderRadius: 7, color: "var(--text-secondary)",
          fontFamily: "var(--font-sans)", fontSize: 13,
          appearance: "none", cursor: "pointer", outline: "none",
        }}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-disabled)" }}>
        <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function ResourceRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 14, borderBottom: "1px solid var(--border-subtle)" }}>
      {children}
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#141414", border: "1px solid #282828", borderRadius: 12, width: 480, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>{title}</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px 20px" }}>{children}</div>
      </div>
    </div>
  );
}

function AddMcpModal({ existing, onAdd, onClose }: {
  existing: string[]; onAdd: (id: string) => void; onClose: () => void;
}) {
  return (
    <Modal title="Add MCP" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {AVAILABLE_MCPS.map(mcp => {
          const added = existing.includes(mcp.id);
          return (
            <div key={mcp.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, background: "#0f0f0f", border: `1px solid ${added ? "#2a2a2a" : "#1e1e1e"}` }}>
              <div style={{ width: 32, height: 32, borderRadius: 7, background: `${mcp.color}22`, border: `1px solid ${mcp.color}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: mcp.color }}>{mcp.icon}</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", margin: 0 }}>{mcp.name}</p>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--text-disabled)", margin: "2px 0 0" }}>{mcp.desc}</p>
              </div>
              <button
                onClick={() => { if (!added) { onAdd(mcp.id); onClose(); } }}
                disabled={added}
                style={{ height: 28, padding: "0 12px", borderRadius: 6, border: "1px solid #282828", background: added ? "transparent" : "#1e1e1e", color: added ? "var(--text-disabled)" : "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 12, cursor: added ? "default" : "pointer" }}
              >
                {added ? "Added" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function AddSecretModal({ onAdd, onClose }: { onAdd: (key: string, value: string) => void; onClose: () => void }) {
  const [key, setKey]   = useState("");
  const [value, setValue] = useState("");
  return (
    <Modal title="Add secret" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-disabled)", letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Key</label>
          <input
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="e.g. GITHUB_TOKEN"
            style={{ width: "100%", height: 36, padding: "0 12px", background: "#0f0f0f", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-disabled)", letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Value</label>
          <input
            type="password"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Paste your secret value"
            style={{ width: "100%", height: 36, padding: "0 12px", background: "#0f0f0f", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />
        </div>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--text-disabled)", margin: 0, lineHeight: 1.6 }}>
          Secrets are encrypted at rest and injected as environment variables at agent runtime. They are never logged.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ height: 34, padding: "0 16px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button
            onClick={() => { if (key && value) { onAdd(key, value); onClose(); }}}
            style={{ height: 34, padding: "0 16px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: key && value ? "pointer" : "not-allowed", opacity: key && value ? 1 : 0.4 }}
          >
            Add secret
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = "settings" | "automations";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border-subtle)", marginBottom: 28 }}>
      {(["settings", "automations"] as Tab[]).map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            height: 36, padding: "0 16px",
            background: "transparent", border: "none",
            borderBottom: active === t ? "2px solid var(--accent)" : "2px solid transparent",
            color: active === t ? "var(--text-primary)" : "var(--text-tertiary)",
            fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: active === t ? 600 : 400,
            cursor: "pointer", textTransform: "capitalize", transition: "color 120ms",
            marginBottom: -1,
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab({ config, onChange }: {
  config: AgentConfigData;
  onChange: (patch: Partial<AgentConfigData>) => void;
}) {
  const [showMcpModal,    setShowMcpModal]    = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);

  function addMcp(id: string) {
    const meta = AVAILABLE_MCPS.find(m => m.id === id)!;
    onChange({ mcps: [...config.mcps, { id: meta.id, name: meta.name, icon: meta.icon, color: meta.color }] });
  }

  function removeMcp(id: string) {
    onChange({ mcps: config.mcps.filter(m => m.id !== id) });
  }

  function addSecret(key: string, _value: string) {
    const masked = key.toLowerCase().includes("token") ? "ghp_••••••••••••••••••••" : `••••••••••••••••••••`;
    onChange({ secrets: [...config.secrets, { id: Date.now().toString(), key, masked }] });
  }

  function removeSecret(id: string) {
    onChange({ secrets: config.secrets.filter(s => s.id !== id) });
  }

  return (
    <>
      {/* Description */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>Description</h3>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-disabled)", margin: "0 0 12px" }}>Summarize what this agent is responsible for.</p>
        <textarea
          value={config.description}
          onChange={e => onChange({ description: e.target.value })}
          rows={2}
          style={{
            width: "100%", padding: "10px 13px", background: "#0f0f0f",
            border: "1px solid var(--border)", borderRadius: 8,
            color: "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 13,
            lineHeight: 1.6, resize: "vertical", outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {/* Agent resources */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>Agent resources</h3>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-disabled)", margin: "0 0 18px" }}>Attach any relevant skills or app connections for this agent.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* MCPs */}
          <ResourceRow>
            <SectionLabel>MCPs</SectionLabel>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {config.mcps.map(mcp => (
                <div key={mcp.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 8px 0 7px", borderRadius: 6, background: "#0f0f0f", border: "1px solid #282828" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: `${mcp.color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700, color: mcp.color }}>{mcp.icon}</span>
                  </div>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-secondary)" }}>{mcp.name}</span>
                  <button onClick={() => removeMcp(mcp.id)} style={{ width: 16, height: 16, border: "none", background: "transparent", color: "#3a3a3a", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.color = "var(--text-tertiary)")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#3a3a3a")}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  </button>
                </div>
              ))}
              <button onClick={() => setShowMcpModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 6, border: "1px dashed #282828", background: "transparent", color: "var(--text-disabled)", fontFamily: "var(--font-sans)", fontSize: 12, cursor: "pointer", transition: "color 120ms, border-color 120ms" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.borderColor = "#383838"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-disabled)"; e.currentTarget.style.borderColor = "#282828"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Add MCP
              </button>
            </div>
          </ResourceRow>

          {/* Secrets */}
          <ResourceRow>
            <SectionLabel>Secrets</SectionLabel>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {config.secrets.map(s => (
                <div key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 8px", borderRadius: 6, background: "#0f0f0f", border: "1px solid #282828" }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M4 5V4a2 2 0 014 0v1M3 5h6a1 1 0 011 1v4a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z" stroke="#555" strokeWidth="1.2"/></svg>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}>{s.key}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#363636" }}>{s.masked}</span>
                  <button onClick={() => removeSecret(s.id)} style={{ width: 16, height: 16, border: "none", background: "transparent", color: "#3a3a3a", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.color = "var(--text-tertiary)")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#3a3a3a")}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  </button>
                </div>
              ))}
              <button onClick={() => setShowSecretModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 6, border: "1px dashed #282828", background: "transparent", color: "var(--text-disabled)", fontFamily: "var(--font-sans)", fontSize: 12, cursor: "pointer", transition: "color 120ms, border-color 120ms" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.borderColor = "#383838"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-disabled)"; e.currentTarget.style.borderColor = "#282828"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Add secret
              </button>
            </div>
          </ResourceRow>

          {/* Harness */}
          <ResourceRow>
            <SectionLabel>Harness</SectionLabel>
            <SelectField value={config.harness} options={HARNESS_OPTIONS} onChange={v => onChange({ harness: v })} />
          </ResourceRow>

          {/* Model */}
          <ResourceRow>
            <SectionLabel>Model</SectionLabel>
            <SelectField value={config.model} options={MODEL_OPTIONS} onChange={v => onChange({ model: v })} />
          </ResourceRow>

          {/* Runner */}
          <ResourceRow>
            <SectionLabel>Runner</SectionLabel>
            <div style={{ flex: 1, position: "relative" }}>
              <select
                value={config.runner}
                onChange={e => onChange({ runner: e.target.value })}
                style={{ width: "100%", height: 36, padding: "0 32px 0 38px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 13, appearance: "none", cursor: "pointer", outline: "none" }}
              >
                {RUNNER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <path d="M11 2C6.03 2 2 6.03 2 11s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z" fill="#f59e0b" opacity=".2"/>
                <path d="M11 6v5l3 3" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-disabled)" }}>
                <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </ResourceRow>

          {/* Host */}
          <ResourceRow>
            <SectionLabel>Host</SectionLabel>
            <div style={{ flex: 1, position: "relative" }}>
              <select
                value={config.host}
                onChange={e => onChange({ host: e.target.value })}
                style={{ width: "100%", height: 36, padding: "0 32px 0 38px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 13, appearance: "none", cursor: "pointer", outline: "none" }}
              >
                {HOST_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <path d="M11 2a9 9 0 100 18A9 9 0 0011 2z" fill="#60a5fa" opacity=".2"/>
                <path d="M6 11c0-2.76 2.24-5 5-5s5 2.24 5 5M8 15.5A7.97 7.97 0 0011 16a7.97 7.97 0 003-.5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M11 6v5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-disabled)" }}>
                <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </ResourceRow>
        </div>
      </div>

      {/* Agent prompt */}
      <div>
        <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>Agent prompt</h3>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-disabled)", margin: "0 0 12px" }}>This is the base prompt the agent will use.</p>
        <textarea
          value={config.prompt}
          onChange={e => onChange({ prompt: e.target.value })}
          rows={14}
          spellCheck={false}
          style={{
            width: "100%", padding: "12px 14px",
            background: "#080808", border: "1px solid var(--border)", borderRadius: 8,
            color: "#c8c8c8", fontFamily: "var(--font-mono)", fontSize: 12,
            lineHeight: 1.75, resize: "vertical", outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {showMcpModal    && <AddMcpModal existing={config.mcps.map(m => m.id)} onAdd={addMcp} onClose={() => setShowMcpModal(false)} />}
      {showSecretModal && <AddSecretModal onAdd={addSecret} onClose={() => setShowSecretModal(false)} />}
    </>
  );
}

// ─── Automations tab ───────────────────────────────────────────────────────────

function AutomationsTab({ automations, onChange }: {
  automations: Automation[];
  onChange: (list: Automation[]) => void;
}) {
  function toggle(id: string) {
    onChange(automations.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  }

  return (
    <div>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-disabled)", margin: "0 0 20px", lineHeight: 1.6 }}>
        Automations trigger this agent automatically in response to external events.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {automations.map(a => (
          <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px", borderRadius: 9, background: "#0f0f0f", border: `1px solid ${a.enabled ? "#222" : "#1a1a1a"}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4h4l-3 2.5 1 4L7 9l-3.5 2.5 1-4L1.5 5h4z" stroke={a.enabled ? "#f59e0b" : "#3a3a3a"} strokeWidth="1.3" fill={a.enabled ? "rgba(245,158,11,0.15)" : "transparent"}/></svg>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, color: a.enabled ? "var(--text-secondary)" : "var(--text-disabled)" }}>
                  {a.trigger}
                </span>
              </div>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-disabled)", margin: 0, lineHeight: 1.55 }}>
                {a.description}
              </p>
            </div>
            {/* Toggle */}
            <button
              onClick={() => toggle(a.id)}
              aria-pressed={a.enabled}
              style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", background: a.enabled ? "var(--accent)" : "#2a2a2a", transition: "background 150ms", marginTop: 2 }}
            >
              <span style={{
                position: "absolute", top: 3, left: a.enabled ? 19 : 3,
                width: 14, height: 14, borderRadius: "50%",
                background: "#fff", transition: "left 150ms",
              }} />
            </button>
          </div>
        ))}

        {/* Add automation */}
        <button style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 42, borderRadius: 9, border: "1px dashed #242424", background: "transparent", color: "var(--text-disabled)", fontFamily: "var(--font-sans)", fontSize: 13, cursor: "pointer", transition: "color 120ms, border-color 120ms" }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.borderColor = "#333"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-disabled)"; e.currentTarget.style.borderColor = "#242424"; }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          New automation
        </button>
      </div>
    </div>
  );
}

// ─── Save bar ──────────────────────────────────────────────────────────────────

function SaveBar({ dirty, onSave, onDiscard }: { dirty: boolean; onSave: () => void; onDiscard: () => void }) {
  if (!dirty) return null;
  return (
    <div style={{
      position: "sticky", bottom: 0, left: 0, right: 0,
      borderTop: "1px solid #1e1e1e", background: "#0d0d0d",
      padding: "12px 32px", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end",
      flexShrink: 0,
    }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-disabled)", flex: 1 }}>
        Unsaved changes
      </span>
      <button onClick={onDiscard} style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontFamily: "var(--font-sans)", fontSize: 13, cursor: "pointer" }}>
        Discard
      </button>
      <button onClick={onSave} style={{ height: 32, padding: "0 16px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#fff", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
        Save changes
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AgentConfig({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const initial = AGENT_CONFIGS[agent.id] ?? AGENT_CONFIGS.triage;
  const [config,  setConfig]  = useState<AgentConfigData>(initial);
  const [saved,   setSaved]   = useState<AgentConfigData>(initial);
  const [tab,     setTab]     = useState<Tab>("settings");
  const [toasted, setToasted] = useState(false);

  const dirty = JSON.stringify(config) !== JSON.stringify(saved);

  function handleSave() {
    setSaved(config);
    setToasted(true);
    setTimeout(() => setToasted(false), 2000);
  }

  function handleDiscard() { setConfig(saved); }

  function patchConfig(patch: Partial<AgentConfigData>) {
    setConfig(prev => ({ ...prev, ...patch }));
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--bg)" }}>

      {/* Top bar */}
      <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-tertiary)", fontFamily: "var(--font-sans)", fontSize: 12, cursor: "pointer", transition: "color 120ms, background 120ms" }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-tertiary)"; e.currentTarget.style.background = "var(--bg-elevated)"; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Agents
        </button>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5L7.5 6l-3 3.5" stroke="#3a3a3a" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>{agent.name}</span>
        <div style={{ flex: 1 }} />
        {agent.status === "running" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 4, background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.18)", fontFamily: "var(--font-mono)", fontSize: 10, color: "#67e8f9" }}>
            <span className="pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "#22d3ee" }} />
            running
          </span>
        )}
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "32px 32px 0" }}>
        <div style={{ maxWidth: 680 }}>

          {/* Agent header */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <div style={{ width: 52, height: 52, borderRadius: 12, flexShrink: 0, background: agent.iconBg, border: `1px solid ${agent.iconColor}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {agent.icon}
            </div>
            <h1 style={{ fontFamily: "var(--font-sans)", fontSize: 20, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {agent.name}
            </h1>
          </div>

          {/* Tabs */}
          <TabBar active={tab} onChange={setTab} />

          {/* Tab content */}
          {tab === "settings" && (
            <SettingsTab config={config} onChange={patchConfig} />
          )}
          {tab === "automations" && (
            <AutomationsTab
              automations={config.automations}
              onChange={list => patchConfig({ automations: list })}
            />
          )}

          <div style={{ height: 60 }} />
        </div>
      </div>

      {/* Save bar */}
      <SaveBar dirty={dirty} onSave={handleSave} onDiscard={handleDiscard} />

      {/* Toast */}
      {toasted && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1a1a1a", border: "1px solid #2e2e2e", borderRadius: 8,
          padding: "10px 18px", display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 200,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#4ade80" strokeWidth="1.3"/><path d="M5.5 8l2 2L10.5 6" stroke="#4ade80" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-secondary)" }}>Changes saved</span>
        </div>
      )}
    </div>
  );
}
