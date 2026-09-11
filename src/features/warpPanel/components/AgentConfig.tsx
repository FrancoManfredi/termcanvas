import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Agent, AgentConfigData, Automation } from "../types";
import { getFactoryAgentBody, getFactoryAgentFull, saveFactoryAgentBody, saveFactoryAgentFull } from "../../../lib/factoryClient";
import { AGENT_TOOL_OPTIONS, isCoreAgentId } from "./newAgentForm";
import StagePicker from "./StagePicker";

/**
 * AgentConfig — Track B (T03).
 *
 * Verbatim port of figma/.../src/components/AgentConfig.tsx. Only diffs
 * vs Figma: import paths (`Agent` / `AgentConfigData` / `Automation`
 * from shared `../types`, never from `./AgentsPanel` or a local
 * `AGENT_CONFIGS` copy), `var(--*)` -> `var(--wp-*)` token prefix, and
 * data arriving via props instead of the module-local `AGENT_CONFIGS`
 * map (components never fetch — `AgentsPanel` resolves `config` through
 * `useAgents().getConfig()` and persists drafts through
 * `useAgents().saveConfig()` via `onSaveConfig`).
 *
 * Local-only state (config draft, tab, modals, toast) stays colocated
 * here, exactly as in Figma.
 */

export interface AgentConfigProps {
  agent: Agent;
  config: AgentConfigData;
  onBack: () => void;
  onSaveConfig: (agentId: string, patch: Partial<AgentConfigData>) => void;
  /** Baja del agente (solo no-core; ausente = sin danger zone). */
  onDeleteAgent?: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
}

const MODEL_OPTIONS = [
  "claude-opus-5 (max)",
  "claude-sonnet-5 (high)",
  "claude-haiku-4-5 (fast)",
  "gpt-4o (high)",
  "gemini-2.5-pro (high)",
];
const HARNESS_OPTIONS = ["Warp", "iTerm2", "Terminal.app", "VS Code"];
const RUNNER_OPTIONS = ["default", "docker", "nix-shell", "remote-ssh"];
const HOST_OPTIONS = [
  "Warp hosted",
  "Self hosted",
  "GitHub Actions",
  "Custom",
];

const AVAILABLE_MCPS = [
  { id: "github", name: "GitHub", icon: "GH", color: "#6e6e6e", desc: "Read/write issues, PRs, and code" },
  { id: "linear", name: "Linear", icon: "LN", color: "#5e6ad2", desc: "Sync issues and project state" },
  { id: "notion", name: "Notion", icon: "N", color: "#ffffff", desc: "Read and write documentation pages" },
  { id: "slack", name: "Slack", icon: "SL", color: "#4a154b", desc: "Send notifications and messages" },
  { id: "postgres", name: "Postgres", icon: "PG", color: "#336791", desc: "Query and mutate database records" },
  { id: "filesystem", name: "Filesystem", icon: "FS", color: "#888888", desc: "Read/write local files and directories" },
];

const TOAST_MS = 2000;

// Perf Ola 3: in-memory agent.md cache per agent — navigating back to
// an already-visited agent reuses the fetched body + frontmatter instead
// of hitting the daemon again. Module-level by design (survives the
// per-agent remount).
const agentFullCache = new Map<string, { body: string; frontmatter: Record<string, unknown> }>();

/** Extrae string[] del frontmatter (tools) o undefined si ausente. */
function frontmatterStringList(fm: Record<string, unknown>, key: string): string[] | undefined {
  try {
    const v = fm[key];
    if (v === undefined) return undefined;
    if (Array.isArray(v)) {
      return (v as unknown[]).filter((x): x is string => typeof x === "string");
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Extrae string del frontmatter o undefined si ausente. */
function frontmatterString(fm: Record<string, unknown>, key: string): string | undefined {
  try {
    const v = fm[key];
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Perf Ola 3: field-level dirty check (offline-testable).
 * Replaces the per-render `JSON.stringify(config) !== JSON.stringify(saved)`
 * over the full agent.md prompt — two stringifies of a multi-KB body per
 * keystroke is the typing jank. Compares scalars directly and lists by
 * identity fields (same semantics, no serialization). Never throws
 * (degrades to dirty so the Save bar never hides edits).
 */
export function isAgentConfigDirty(
  a: AgentConfigData,
  b: AgentConfigData,
): boolean {
  try {
    if (a === b) return false;
    if (!a || !b) return true;
    if (
      a.description !== b.description ||
      a.harness !== b.harness ||
      a.model !== b.model ||
      a.runner !== b.runner ||
      a.host !== b.host ||
      a.prompt !== b.prompt
    ) {
      return true;
    }
    const am = Array.isArray(a.mcps) ? a.mcps : [];
    const bm = Array.isArray(b.mcps) ? b.mcps : [];
    if (am.length !== bm.length) return true;
    for (let i = 0; i < am.length; i += 1) {
      if (am[i]?.id !== bm[i]?.id) return true;
    }
    const as = Array.isArray(a.secrets) ? a.secrets : [];
    const bs = Array.isArray(b.secrets) ? b.secrets : [];
    if (as.length !== bs.length) return true;
    for (let i = 0; i < as.length; i += 1) {
      if (as[i]?.id !== bs[i]?.id || as[i]?.key !== bs[i]?.key) return true;
    }
    // Frontmatter real (opcionales: solo comparan cuando alguno lo trae).
    if (
      a.tools !== undefined || b.tools !== undefined ||
      a.stage !== undefined || b.stage !== undefined ||
      a.blocking !== undefined || b.blocking !== undefined ||
      a.mode !== undefined || b.mode !== undefined ||
      a.agentType !== undefined || b.agentType !== undefined
    ) {
      const al = Array.isArray(a.tools) ? [...a.tools].sort().join(",") : "";
      const bl = Array.isArray(b.tools) ? [...b.tools].sort().join(",") : "";
      if (al !== bl) return true;
      if ((a.stage ?? "") !== (b.stage ?? "")) return true;
      if ((a.blocking ?? false) !== (b.blocking ?? false)) return true;
      if ((a.mode ?? "") !== (b.mode ?? "")) return true;
      if ((a.agentType ?? "") !== (b.agentType ?? "")) return true;
    }
    const aa = Array.isArray(a.automations) ? a.automations : [];
    const ba = Array.isArray(b.automations) ? b.automations : [];
    if (aa.length !== ba.length) return true;
    for (let i = 0; i < aa.length; i += 1) {
      if (aa[i]?.id !== ba[i]?.id || aa[i]?.enabled !== ba[i]?.enabled) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

// ─── Shared UI atoms ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontFamily: "var(--wp-font-mono)", fontSize: 10, color: "var(--wp-text-disabled)", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px", width: 72, flexShrink: 0 }}>
      {children}
    </p>
  );
}

function SelectField({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", height: 36, padding: "0 32px 0 12px",
          background: "var(--wp-bg-elevated)", border: "1px solid var(--wp-border)",
          borderRadius: 7, color: "var(--wp-text-secondary)",
          fontFamily: "var(--wp-font-sans)", fontSize: 13,
          appearance: "none", cursor: "pointer", outline: "none",
        }}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--wp-text-disabled)" }}>
        <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ResourceRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 14, borderBottom: "1px solid var(--wp-border-subtle)" }}>
      {children}
    </div>
  );
}

// ─── Modals ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Escape dismisses on top of the Figma backdrop-click path.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#141414", border: "1px solid #282828", borderRadius: 12, width: 480, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 14, fontWeight: 700, color: "var(--wp-text-primary)", flex: 1 }}>{title}</span>
          <button aria-label={`Close ${title} dialog`} onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent", color: "var(--wp-text-tertiary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
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
        {AVAILABLE_MCPS.map((mcp) => {
          const added = existing.includes(mcp.id);
          return (
            <div key={mcp.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, background: "#0f0f0f", border: `1px solid ${added ? "#2a2a2a" : "#1e1e1e"}` }}>
              <div style={{ width: 32, height: 32, borderRadius: 7, background: `${mcp.color}22`, border: `1px solid ${mcp.color}33`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 9, fontWeight: 700, color: mcp.color }}>{mcp.icon}</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 13, fontWeight: 600, color: "var(--wp-text-secondary)", margin: 0 }}>{mcp.name}</p>
                <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 11, color: "var(--wp-text-disabled)", margin: "2px 0 0" }}>{mcp.desc}</p>
              </div>
              <button
                onClick={() => { if (!added) { onAdd(mcp.id); onClose(); } }}
                disabled={added}
                style={{ height: 28, padding: "0 12px", borderRadius: 6, border: "1px solid #282828", background: added ? "transparent" : "#1e1e1e", color: added ? "var(--wp-text-disabled)" : "var(--wp-text-secondary)", fontFamily: "var(--wp-font-sans)", fontSize: 12, cursor: added ? "default" : "pointer" }}
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
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  return (
    <Modal title="Add secret" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="wp-secret-key" style={{ fontFamily: "var(--wp-font-mono)", fontSize: 10, color: "var(--wp-text-disabled)", letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Key</label>
          <input
            id="wp-secret-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g. GITHUB_TOKEN"
            style={{ width: "100%", height: 36, padding: "0 12px", background: "#0f0f0f", border: "1px solid var(--wp-border)", borderRadius: 7, color: "var(--wp-text-primary)", fontFamily: "var(--wp-font-mono)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label htmlFor="wp-secret-value" style={{ fontFamily: "var(--wp-font-mono)", fontSize: 10, color: "var(--wp-text-disabled)", letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Value</label>
          <input
            id="wp-secret-value"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste your secret value"
            style={{ width: "100%", height: 36, padding: "0 12px", background: "#0f0f0f", border: "1px solid var(--wp-border)", borderRadius: 7, color: "var(--wp-text-primary)", fontFamily: "var(--wp-font-mono)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />
        </div>
        <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 11, color: "var(--wp-text-disabled)", margin: 0, lineHeight: 1.6 }}>
          Secrets are encrypted at rest and injected as environment variables at agent runtime. They are never logged.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ height: 34, padding: "0 16px", borderRadius: 6, border: "1px solid var(--wp-border)", background: "transparent", color: "var(--wp-text-secondary)", fontFamily: "var(--wp-font-sans)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button
            onClick={() => { if (key && value) { onAdd(key, value); onClose(); } }}
            style={{ height: 34, padding: "0 16px", borderRadius: 6, border: "none", background: "var(--wp-accent)", color: "#fff", fontFamily: "var(--wp-font-sans)", fontSize: 13, fontWeight: 600, cursor: key && value ? "pointer" : "not-allowed", opacity: key && value ? 1 : 0.4 }}
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
    <div role="tablist" aria-label="Agent configuration sections" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--wp-border-subtle)", marginBottom: 28 }}>
      {(["settings", "automations"] as Tab[]).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={active === t}
          onClick={() => onChange(t)}
          style={{
            height: 36, padding: "0 16px",
            background: "transparent", border: "none",
            borderBottom: active === t ? "2px solid var(--wp-accent)" : "2px solid transparent",
            color: active === t ? "var(--wp-text-primary)" : "var(--wp-text-tertiary)",
            fontFamily: "var(--wp-font-sans)", fontSize: 13, fontWeight: active === t ? 600 : 400,
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

function SettingsTab({ config, onChange, promptLoading, promptLoadError, promptSaveError, liveFrontmatter }: {
  config: AgentConfigData;
  onChange: (patch: Partial<AgentConfigData>) => void;
  promptLoading: boolean;
  promptLoadError: string | null;
  promptSaveError: string | null;
  liveFrontmatter: boolean;
}) {
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);

  function addMcp(id: string) {
    const meta = AVAILABLE_MCPS.find((m) => m.id === id);
    if (!meta) return;
    onChange({ mcps: [...config.mcps, { id: meta.id, name: meta.name, icon: meta.icon, color: meta.color }] });
  }

  function removeMcp(id: string) {
    onChange({ mcps: config.mcps.filter((m) => m.id !== id) });
  }

  function addSecret(key: string, _value: string) {
    void _value;
    const masked = key.toLowerCase().includes("token") ? "ghp_••••••••••••••••••••" : `••••••••••••••••••••`;
    onChange({ secrets: [...config.secrets, { id: `secret-${Date.now()}`, key, masked }] });
  }

  function removeSecret(id: string) {
    onChange({ secrets: config.secrets.filter((s) => s.id !== id) });
  }

  return (
    <>
      {/* Description */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontFamily: "var(--wp-font-sans)", fontSize: 14, fontWeight: 700, color: "var(--wp-text-primary)", margin: "0 0 4px" }}>Description</h3>
        <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", margin: "0 0 12px" }}>Summarize what this agent is responsible for.</p>
        <textarea
          aria-label="Agent description"
          value={config.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={2}
          style={{
            width: "100%", padding: "10px 13px", background: "#0f0f0f",
            border: "1px solid var(--wp-border)", borderRadius: 8,
            color: "var(--wp-text-secondary)", fontFamily: "var(--wp-font-sans)", fontSize: 13,
            lineHeight: 1.6, resize: "vertical", outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {/* Pipeline (frontmatter real del daemon) */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontFamily: "var(--wp-font-sans)", fontSize: 14, fontWeight: 700, color: "var(--wp-text-primary)", margin: "0 0 4px" }}>Pipeline</h3>
        <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", margin: "0 0 18px" }}>
          {liveFrontmatter
            ? "Live frontmatter of factory/agents/<name>/agent.md — saved to disk and both mirrors. Applies automatically to the next job (the server recycles when idle; running jobs keep the previous prompt)."
            : "Daemon unreachable — these fields save locally only."}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Agent type (read-only: cambiar el tipo altera el ruteo del pipeline) */}
          <ResourceRow>
            <SectionLabel>Type</SectionLabel>
            <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 12, color: "var(--wp-text-tertiary)" }}>
              {config.agentType ?? "—"}
            </span>
          </ResourceRow>

          {/* Tools */}
          <ResourceRow>
            <SectionLabel>Tools</SectionLabel>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {AGENT_TOOL_OPTIONS.map((tool) => {
                const active = Array.isArray(config.tools) && config.tools.includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    aria-pressed={active}
                    aria-label={`Toggle ${tool} tool`}
                    onClick={() => {
                      const current = Array.isArray(config.tools) ? config.tools : [];
                      onChange({ tools: active ? current.filter((t) => t !== tool) : [...current, tool] });
                    }}
                    style={{
                      height: 28, padding: "0 10px", borderRadius: 6, cursor: "pointer",
                      border: `1px solid ${active ? "var(--wp-accent)" : "#282828"}`,
                      background: active ? "rgba(255,255,255,0.04)" : "transparent",
                      color: active ? "var(--wp-text-primary)" : "var(--wp-text-disabled)",
                      fontFamily: "var(--wp-font-mono)", fontSize: 11,
                    }}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </ResourceRow>

          {/* Stage (picker visual sobre el pipeline) */}
          <div style={{ paddingBottom: 14, borderBottom: "1px solid var(--wp-border-subtle)" }}>
            <SectionLabel>Stage</SectionLabel>
            <StagePicker
              value={config.stage ?? "none"}
              onChange={(v) => onChange({ stage: v, blocking: v === "none" ? false : (config.blocking ?? false) })}
            />
          </div>

          {/* Blocking */}
          <ResourceRow>
            <SectionLabel>Blocking</SectionLabel>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => { if ((config.stage ?? "none") !== "none") onChange({ blocking: !(config.blocking ?? false) }); }}
                aria-pressed={config.blocking ?? false}
                aria-label="Blocking hook"
                disabled={(config.stage ?? "none") === "none"}
                style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: (config.stage ?? "none") === "none" ? "not-allowed" : "pointer", flexShrink: 0, position: "relative", background: (config.blocking ?? false) ? "var(--wp-accent)" : "#2a2a2a", transition: "background 150ms", opacity: (config.stage ?? "none") === "none" ? 0.5 : 1 }}
              >
                <span style={{
                  position: "absolute", top: 3, left: (config.blocking ?? false) ? 19 : 3,
                  width: 14, height: 14, borderRadius: "50%",
                  background: "#fff", transition: "left 150ms",
                }} />
              </button>
              <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)" }}>
                {(config.stage ?? "none") === "none"
                  ? "n/a — no pipeline stage"
                  : (config.blocking ?? false) ? "Blocking — stops the pipeline on fail" : "Advisory — reports only"}
              </span>
            </div>
          </ResourceRow>

        </div>
      </div>

      {/* Agent resources */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontFamily: "var(--wp-font-sans)", fontSize: 14, fontWeight: 700, color: "var(--wp-text-primary)", margin: "0 0 4px" }}>Agent resources</h3>
        <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", margin: "0 0 18px" }}>Attach any relevant skills or app connections for this agent.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* MCPs */}
          <ResourceRow>
            <SectionLabel>MCPs</SectionLabel>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {config.mcps.map((mcp) => (
                <div key={mcp.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 8px 0 7px", borderRadius: 6, background: "#0f0f0f", border: "1px solid #282828" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, background: `${mcp.color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 8, fontWeight: 700, color: mcp.color }}>{mcp.icon}</span>
                  </div>
                  <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-secondary)" }}>{mcp.name}</span>
                  <button aria-label={`Remove ${mcp.name} MCP`} onClick={() => removeMcp(mcp.id)} style={{ width: 16, height: 16, border: "none", background: "transparent", color: "#3a3a3a", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--wp-text-tertiary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#3a3a3a")}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
              <button onClick={() => setShowMcpModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 6, border: "1px dashed #282828", background: "transparent", color: "var(--wp-text-disabled)", fontFamily: "var(--wp-font-sans)", fontSize: 12, cursor: "pointer", transition: "color 120ms, border-color 120ms" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--wp-text-tertiary)"; e.currentTarget.style.borderColor = "#383838"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--wp-text-disabled)"; e.currentTarget.style.borderColor = "#282828"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                Add MCP
              </button>
            </div>
          </ResourceRow>

          {/* Secrets */}
          <ResourceRow>
            <SectionLabel>Secrets</SectionLabel>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {config.secrets.map((s) => (
                <div key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 28, padding: "0 8px", borderRadius: 6, background: "#0f0f0f", border: "1px solid #282828" }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M4 5V4a2 2 0 014 0v1M3 5h6a1 1 0 011 1v4a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z" stroke="#555" strokeWidth="1.2" /></svg>
                  <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 11, color: "var(--wp-text-tertiary)" }}>{s.key}</span>
                  <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 11, color: "#363636" }}>{s.masked}</span>
                  <button aria-label={`Remove secret ${s.key}`} onClick={() => removeSecret(s.id)} style={{ width: 16, height: 16, border: "none", background: "transparent", color: "#3a3a3a", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--wp-text-tertiary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#3a3a3a")}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
              <button onClick={() => setShowSecretModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 6, border: "1px dashed #282828", background: "transparent", color: "var(--wp-text-disabled)", fontFamily: "var(--wp-font-sans)", fontSize: 12, cursor: "pointer", transition: "color 120ms, border-color 120ms" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--wp-text-tertiary)"; e.currentTarget.style.borderColor = "#383838"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--wp-text-disabled)"; e.currentTarget.style.borderColor = "#282828"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                Add secret
              </button>
            </div>
          </ResourceRow>

          {/* Harness */}
          <ResourceRow>
            <SectionLabel>Harness</SectionLabel>
            <SelectField label="Harness" value={config.harness} options={HARNESS_OPTIONS} onChange={(v) => onChange({ harness: v })} />
          </ResourceRow>

          {/* Model */}
          <ResourceRow>
            <SectionLabel>Model</SectionLabel>
            <SelectField label="Model" value={config.model} options={MODEL_OPTIONS} onChange={(v) => onChange({ model: v })} />
          </ResourceRow>

          {/* Runner */}
          <ResourceRow>
            <SectionLabel>Runner</SectionLabel>
            <div style={{ flex: 1, position: "relative" }}>
              <select
                aria-label="Runner"
                value={config.runner}
                onChange={(e) => onChange({ runner: e.target.value })}
                style={{ width: "100%", height: 36, padding: "0 32px 0 38px", background: "var(--wp-bg-elevated)", border: "1px solid var(--wp-border)", borderRadius: 7, color: "var(--wp-text-secondary)", fontFamily: "var(--wp-font-sans)", fontSize: 13, appearance: "none", cursor: "pointer", outline: "none" }}
              >
                {RUNNER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <path d="M11 2C6.03 2 2 6.03 2 11s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z" fill="#f59e0b" opacity=".2" />
                <path d="M11 6v5l3 3" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--wp-text-disabled)" }}>
                <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </ResourceRow>

          {/* Host */}
          <ResourceRow>
            <SectionLabel>Host</SectionLabel>
            <div style={{ flex: 1, position: "relative" }}>
              <select
                aria-label="Host"
                value={config.host}
                onChange={(e) => onChange({ host: e.target.value })}
                style={{ width: "100%", height: 36, padding: "0 32px 0 38px", background: "var(--wp-bg-elevated)", border: "1px solid var(--wp-border)", borderRadius: 7, color: "var(--wp-text-secondary)", fontFamily: "var(--wp-font-sans)", fontSize: 13, appearance: "none", cursor: "pointer", outline: "none" }}
              >
                {HOST_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <path d="M11 2a9 9 0 100 18A9 9 0 0011 2z" fill="#60a5fa" opacity=".2" />
                <path d="M6 11c0-2.76 2.24-5 5-5s5 2.24 5 5M8 15.5A7.97 7.97 0 0011 16a7.97 7.97 0 003-.5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M11 6v5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--wp-text-disabled)" }}>
                <path d="M3 4.5L6 7.5l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </ResourceRow>
        </div>
      </div>

      {/* Agent prompt — body real de factory/agents/<id>/agent.md (frontmatter oculto) */}
      <div>
        <h3 style={{ fontFamily: "var(--wp-font-sans)", fontSize: 14, fontWeight: 700, color: "var(--wp-text-primary)", margin: "0 0 4px" }}>Agent prompt</h3>
        <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", margin: "0 0 12px" }}>
          {promptLoading
            ? "Loading live prompt from factory/agents/…"
            : "Live body of factory/agents/<name>/agent.md (frontmatter excluded)."}
        </p>
        {promptLoadError !== null && (
          <p role="note" style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "#f59e0b", margin: "0 0 8px" }}>
            {promptLoadError}
          </p>
        )}
        {promptSaveError !== null && (
          <p role="alert" style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "#f87171", margin: "0 0 8px" }}>
            {promptSaveError}
          </p>
        )}
        <textarea
          aria-label="Agent prompt"
          value={config.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          rows={14}
          spellCheck={false}
          placeholder={promptLoading ? "Loading live agent prompt…" : undefined}
          style={{
            width: "100%", padding: "12px 14px",
            background: "#080808", border: "1px solid var(--wp-border)", borderRadius: 8,
            color: "#c8c8c8", fontFamily: "var(--wp-font-mono)", fontSize: 12,
            lineHeight: 1.75, resize: "vertical", outline: "none", boxSizing: "border-box",
            opacity: promptLoading ? 0.6 : 1,
          }}
        />
      </div>

      {showMcpModal && <AddMcpModal existing={config.mcps.map((m) => m.id)} onAdd={addMcp} onClose={() => setShowMcpModal(false)} />}
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
    onChange(automations.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a));
  }

  return (
    <div>
      <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", margin: "0 0 20px", lineHeight: 1.6 }}>
        Automations trigger this agent automatically in response to external events.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {automations.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px", borderRadius: 9, background: "#0f0f0f", border: `1px solid ${a.enabled ? "#222" : "#1a1a1a"}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4h4l-3 2.5 1 4L7 9l-3.5 2.5 1-4L1.5 5h4z" stroke={a.enabled ? "#f59e0b" : "#3a3a3a"} strokeWidth="1.3" fill={a.enabled ? "rgba(245,158,11,0.15)" : "transparent"} /></svg>
                <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, fontWeight: 600, color: a.enabled ? "var(--wp-text-secondary)" : "var(--wp-text-disabled)" }}>
                  {a.trigger}
                </span>
              </div>
              <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", margin: 0, lineHeight: 1.55 }}>
                {a.description}
              </p>
            </div>
            {/* Toggle */}
            <button
              onClick={() => toggle(a.id)}
              aria-pressed={a.enabled}
              aria-label={`${a.trigger} automation ${a.enabled ? "enabled" : "disabled"}`}
              style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", flexShrink: 0, position: "relative", background: a.enabled ? "var(--wp-accent)" : "#2a2a2a", transition: "background 150ms", marginTop: 2 }}
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
        <button style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 42, borderRadius: 9, border: "1px dashed #242424", background: "transparent", color: "var(--wp-text-disabled)", fontFamily: "var(--wp-font-sans)", fontSize: 13, cursor: "pointer", transition: "color 120ms, border-color 120ms" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--wp-text-tertiary)"; e.currentTarget.style.borderColor = "#333"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--wp-text-disabled)"; e.currentTarget.style.borderColor = "#242424"; }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          New automation
        </button>
      </div>
    </div>
  );
}

// ─── Danger zone ───────────────────────────────────────────────────────────────

function DangerZone({ agentName, onDelete }: {
  agentName: string;
  onDelete: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onDelete();
      if (!res.ok) {
        setError(res.error ?? "Could not delete the agent.");
        setConfirming(false);
      }
      // ok → el padre navega fuera (vuelve a la lista).
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 32, border: "1px dashed rgba(248,113,113,0.4)", borderRadius: 9, padding: "14px 16px" }}>
      <h3 style={{ fontFamily: "var(--wp-font-sans)", fontSize: 13, fontWeight: 700, color: "#f87171", margin: "0 0 4px" }}>Danger zone</h3>
      <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", margin: "0 0 12px", lineHeight: 1.6 }}>
        Deletes factory/agents/{agentName.toLowerCase().replace(/ /g, "-")}/agent.md and its mirror. Core agents can never be deleted.
      </p>
      {error && (
        <p role="alert" style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "#f87171", margin: "0 0 8px" }}>{error}</p>
      )}
      {!confirming ? (
        <button
          onClick={() => { setError(null); setConfirming(true); }}
          style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid rgba(248,113,113,0.5)", background: "transparent", color: "#f87171", fontFamily: "var(--wp-font-sans)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          Delete agent
        </button>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleConfirm}
            disabled={busy}
            style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "none", background: "#b91c1c", color: "#fff", fontFamily: "var(--wp-font-sans)", fontSize: 12, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Deleting…" : "Confirm delete"}
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={busy}
            style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid var(--wp-border)", background: "transparent", color: "var(--wp-text-secondary)", fontFamily: "var(--wp-font-sans)", fontSize: 12, cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      )}
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
      <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", flex: 1 }}>
        Unsaved changes
      </span>
      <button onClick={onDiscard} style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid var(--wp-border)", background: "transparent", color: "var(--wp-text-secondary)", fontFamily: "var(--wp-font-sans)", fontSize: 13, cursor: "pointer" }}>
        Discard
      </button>
      <button onClick={onSave} style={{ height: 32, padding: "0 16px", borderRadius: 6, border: "none", background: "var(--wp-accent)", color: "#fff", fontFamily: "var(--wp-font-sans)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
        Save changes
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AgentConfig({ agent, config: initialConfig, onBack, onSaveConfig, onDeleteAgent }: AgentConfigProps) {
  // Draft editing stays local; only explicit Save flows up through
  // onSaveConfig (wired to useAgents().saveConfig by AgentsPanel).
  // AgentsPanel remounts per agent (key={agent.id}), so seeding state
  // from the config prop once matches the Figma behavior exactly.
  const [config, setConfig] = useState<AgentConfigData>(initialConfig);
  const [saved, setSaved] = useState<AgentConfigData>(initialConfig);
  const [tab, setTab] = useState<Tab>("settings");
  const [toasted, setToasted] = useState(false);
  const toastTimer = useRef<number | null>(null);
  // Body + frontmatter reales del daemon (fuente de verdad en disco).
  // `null` = aún sin cargar o daemon no disponible (seed como fallback).
  const [liveBody, setLiveBody] = useState<string | null>(null);
  const [liveFull, setLiveFull] = useState(false);
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptLoadError, setPromptLoadError] = useState<string | null>(null);
  const [promptSaveError, setPromptSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const promptTouched = useRef(false);
  const fieldsTouched = useRef(false);

  const dirty = isAgentConfigDirty(config, saved);

  // Fusiona body + frontmatter del daemon en draft y saved (solo lo no
  // tocado por el usuario: no se pierde nada).
  function applyLiveData(
    body: string,
    fm: Record<string, unknown>,
    setState: React.Dispatch<React.SetStateAction<AgentConfigData>>,
  ) {
    setState((prev) => {
      if (promptTouched.current && fieldsTouched.current) return prev;
      const next = { ...prev };
      if (!promptTouched.current && prev.prompt === initialConfig.prompt) next.prompt = body;
      if (!fieldsTouched.current) {
        const desc = frontmatterString(fm, "description");
        if (desc !== undefined && prev.description === initialConfig.description) next.description = desc;
        const tools = frontmatterStringList(fm, "tools");
        if (tools !== undefined) next.tools = tools;
        const stage = frontmatterString(fm, "stage");
        if (stage !== undefined) next.stage = stage;
        if (typeof fm.blocking === "boolean") next.blocking = fm.blocking;
        const mode = frontmatterString(fm, "mode");
        if (mode !== undefined) next.mode = mode;
        const agentType = frontmatterString(fm, "agentType");
        if (agentType !== undefined) next.agentType = agentType;
      }
      return next;
    });
  }

  // Carga body + frontmatter una vez por agente (remonta por key={agent.id}).
  // Perf Ola 3: la cache en memoria evita el refetch al volver a un agente.
  useEffect(() => {
    let alive = true;
    try {
      const cached = agentFullCache.get(agent.id);
      if (cached && cached.body.trim().length > 0) {
        setLiveBody(cached.body);
        setLiveFull(true);
        applyLiveData(cached.body, cached.frontmatter, setConfig);
        applyLiveData(cached.body, cached.frontmatter, setSaved);
        setPromptLoading(false);
        return () => {
          alive = false;
        };
      }
    } catch {
      // Cache rota: sigue al fetch normal.
    }
    setPromptLoading(true);
    setPromptLoadError(null);
    getFactoryAgentFull(agent.id).then((res) => {
      if (!alive) return;
      if (res.ok && res.data.body.trim().length > 0) {
        try {
          agentFullCache.set(agent.id, { body: res.data.body, frontmatter: res.data.frontmatter });
        } catch {
          // Cache best-effort.
        }
        setLiveBody(res.data.body);
        setLiveFull(true);
        applyLiveData(res.data.body, res.data.frontmatter, setConfig);
        applyLiveData(res.data.body, res.data.frontmatter, setSaved);
      } else {
        setPromptLoadError(
          "Daemon not reachable — showing bundled prompt (edits save locally only).",
        );
      }
      setPromptLoading(false);
    }).catch(() => {
      if (!alive) return;
      setPromptLoadError(
        "Daemon not reachable — showing bundled prompt (edits save locally only).",
      );
      setPromptLoading(false);
    });
    return () => { alive = false; };
    // Intencional: una carga por montaje (el panel remonta por agente).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setPromptSaveError(null);
    // Con frontmatter vivo: UN PUT full (body + frontmatter validados por el
    // daemon). Sin daemon: camino clásico (body-only, o solo local).
    // Si el daemon falla, igual se persiste local para no perder ediciones.
    const promptChanged = liveBody === null || config.prompt !== liveBody;
    if (liveFull) {
      // mode siempre ALL a nivel UI: no se envía (el existente se preserva).
      const frontmatter: Record<string, unknown> = {
        description: config.description,
        ...(Array.isArray(config.tools) ? { tools: config.tools } : {}),
        ...(typeof config.stage === "string" ? { stage: config.stage } : {}),
        ...(typeof config.blocking === "boolean" ? { blocking: config.blocking } : {}),
      };
      const res = await saveFactoryAgentFull(
        agent.id,
        promptChanged && config.prompt.trim().length > 0 ? config.prompt : undefined,
        frontmatter,
      );
      if (res.ok) {
        setLiveBody(res.data.body);
        if (res.data.mirrorSynced === false) {
          setPromptSaveError(
            `Saved to factory/agents/${agent.id}/agent.md, but the opencode mirror could not be verified — the next session may use the previous prompt. Save again or check write permissions on .opencode/agents and ~/.config/opencode/agents.`,
          );
        }
        try {
          agentFullCache.set(agent.id, { body: res.data.body, frontmatter: res.data.frontmatter });
        } catch {
          // Cache best-effort.
        }
      } else {
        setPromptSaveError(`Could not save to factory/agents/${agent.id}/agent.md: ${res.error} — kept locally.`);
      }
      if (promptChanged && config.prompt.trim().length === 0) {
        setPromptSaveError("Empty prompt was not written to disk — kept locally.");
      }
    } else if (promptChanged && config.prompt.trim().length > 0) {
      const res = await saveFactoryAgentBody(agent.id, config.prompt);
      if (res.ok) {
        setLiveBody(res.data.body);
        if (res.data.mirrorSynced === false) {
          setPromptSaveError(
            `Saved to factory/agents/${agent.id}/agent.md, but the opencode mirror could not be verified — the next session may use the previous prompt. Save again or check write permissions on .opencode/agents and ~/.config/opencode/agents.`,
          );
        }
        try {
          agentFullCache.set(agent.id, { body: res.data.body, frontmatter: {} });
        } catch {
          // Cache best-effort.
        }
      } else {
        setPromptSaveError(`Could not save to factory/agents/${agent.id}/agent.md: ${res.error} — kept locally.`);
      }
    } else if (promptChanged) {
      setPromptSaveError("Empty prompt was not written to disk — kept locally.");
    }
    onSaveConfig(agent.id, { ...config });
    setSaved(config);
    setSaving(false);
    setToasted(true);
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => {
      setToasted(false);
      toastTimer.current = null;
    }, TOAST_MS);
  }

  function handleDiscard() { setConfig(saved); }

  function patchConfig(patch: Partial<AgentConfigData>) {
    if (patch.prompt !== undefined) promptTouched.current = true;
    if (
      patch.description !== undefined || patch.tools !== undefined ||
      patch.stage !== undefined || patch.blocking !== undefined ||
      patch.mode !== undefined
    ) {
      fieldsTouched.current = true;
    }
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  // Never leave a dangling toast timer if the user navigates back early.
  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--wp-bg)" }}>

      {/* Top bar */}
      <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: "1px solid var(--wp-border-subtle)", flexShrink: 0 }}>
        <button onClick={onBack} aria-label="Back to agents list" style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid var(--wp-border)", background: "var(--wp-bg-elevated)", color: "var(--wp-text-tertiary)", fontFamily: "var(--wp-font-sans)", fontSize: 12, cursor: "pointer", transition: "color 120ms, background 120ms" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--wp-text-secondary)"; e.currentTarget.style.background = "var(--wp-bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--wp-text-tertiary)"; e.currentTarget.style.background = "var(--wp-bg-elevated)"; }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Agents
        </button>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2.5L7.5 6l-3 3.5" stroke="#3a3a3a" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 13, fontWeight: 700, color: "var(--wp-text-primary)", letterSpacing: "-0.01em" }}>{agent.name}</span>
        <div style={{ flex: 1 }} />
        {agent.status === "running" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 4, background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.18)", fontFamily: "var(--wp-font-mono)", fontSize: 10, color: "#67e8f9" }}>
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
            <h1 style={{ fontFamily: "var(--wp-font-sans)", fontSize: 20, fontWeight: 800, color: "var(--wp-text-primary)", margin: 0, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {agent.name}
            </h1>
          </div>

          {/* Tabs */}
          <TabBar active={tab} onChange={setTab} />

          {/* Tab content */}
          {tab === "settings" && (
            <SettingsTab
              config={config}
              onChange={patchConfig}
              promptLoading={promptLoading}
              promptLoadError={promptLoadError}
              promptSaveError={promptSaveError}
              liveFrontmatter={liveFull}
            />
          )}
          {tab === "automations" && (
            <AutomationsTab
              automations={config.automations}
              onChange={(list) => patchConfig({ automations: list })}
            />
          )}

          {/* Danger zone (solo no-core con handler de baja) */}
          {onDeleteAgent && !isCoreAgentId(agent.id) && (
            <DangerZone
              agentName={agent.name}
              onDelete={() => onDeleteAgent(agent.id)}
            />
          )}

          <div style={{ height: 60 }} />
        </div>
      </div>

      {/* Save bar */}
      <SaveBar dirty={dirty} onSave={handleSave} onDiscard={handleDiscard} />

      {/* Toast */}
      {toasted && (
        <div role="status" style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1a1a1a", border: "1px solid #2e2e2e", borderRadius: 8,
          padding: "10px 18px", display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 200,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="#4ade80" strokeWidth="1.3" /><path d="M5.5 8l2 2L10.5 6" stroke="#4ade80" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 13, color: "var(--wp-text-secondary)" }}>Changes saved</span>
        </div>
      )}
    </div>
  );
}
