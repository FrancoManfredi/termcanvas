import { useState, type CSSProperties } from "react";
import type { FactoryAgentCreateInput } from "../../../lib/factoryClient";
import StagePicker from "./StagePicker";
import {
  AGENT_TOOL_OPTIONS,
  AGENT_TYPE_OPTIONS,
  EMPTY_NEW_AGENT_FORM,
  newAgentFormToInput,
  validateNewAgentInput,
  type NewAgentForm,
} from "./newAgentForm";

/**
 * NewAgentSection — alta de agentes hook en una pasada, como sección del
 * panel (igual que AgentConfig: top bar + contenido centrado), no modal.
 * Hook agents: VERIFY/CUSTOM con stage declarativo — el corredor los
 * descubre sin tocar código.
 */

const labelStyle: CSSProperties = {
  fontFamily: "var(--wp-font-mono)",
  fontSize: 10,
  color: "var(--wp-text-disabled)",
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  display: "block",
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 12px",
  background: "#0f0f0f",
  border: "1px solid var(--wp-border)",
  borderRadius: 7,
  color: "var(--wp-text-primary)",
  fontFamily: "var(--wp-font-sans)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

const hintStyle: CSSProperties = {
  fontFamily: "var(--wp-font-sans)",
  fontSize: 11,
  color: "var(--wp-text-disabled)",
  margin: "6px 0 0",
  lineHeight: 1.6,
};

const sectionTitle: CSSProperties = {
  fontFamily: "var(--wp-font-sans)",
  fontSize: 14,
  fontWeight: 700,
  color: "var(--wp-text-primary)",
  margin: "0 0 4px",
};

const sectionDesc: CSSProperties = {
  fontFamily: "var(--wp-font-sans)",
  fontSize: 12,
  color: "var(--wp-text-disabled)",
  margin: "0 0 12px",
};

export interface NewAgentSectionProps {
  onBack: () => void;
  onSubmit: (input: FactoryAgentCreateInput) => Promise<{ ok: boolean; error?: string }>;
  submitting: boolean;
}

export default function NewAgentSection({ onBack, onSubmit, submitting }: NewAgentSectionProps) {
  const [form, setForm] = useState<NewAgentForm>({ ...EMPTY_NEW_AGENT_FORM, tools: [...EMPTY_NEW_AGENT_FORM.tools] });
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function patch(p: Partial<NewAgentForm>) {
    setTouched(true);
    setServerError(null);
    setForm((prev) => ({ ...prev, ...p }));
  }

  function toggleTool(tool: string) {
    const has = form.tools.includes(tool);
    patch({ tools: has ? form.tools.filter((t) => t !== tool) : [...form.tools, tool] });
  }

  const errors = touched ? validateNewAgentInput(form) : [];
  const canSubmit = !submitting && validateNewAgentInput(form).length === 0;

  async function handleSubmit() {
    if (!canSubmit) {
      setTouched(true);
      return;
    }
    const res = await onSubmit(newAgentFormToInput(form));
    if (!res.ok) setServerError(res.error ?? "Could not create the agent.");
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--wp-bg)" }}>
      {/* Top bar (igual que AgentConfig) */}
      <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: "1px solid var(--wp-border-subtle)", flexShrink: 0 }}>
        <button onClick={onBack} aria-label="Back to agents list" style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", borderRadius: 6, border: "1px solid var(--wp-border)", background: "var(--wp-bg-elevated)", color: "var(--wp-text-tertiary)", fontFamily: "var(--wp-font-sans)", fontSize: 12, cursor: "pointer" }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Agents
        </button>
        <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 13, fontWeight: 700, color: "var(--wp-text-primary)" }}>
          New agent
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 24px 40px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
          <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)", margin: 0, lineHeight: 1.6 }}>
            Hook agents run at the pipeline stage you pick — no code changes needed. Advisory unless you mark them blocking. New agents reach running jobs after a daemon restart (the server loads agents at boot).
          </p>

          <div>
            <h3 style={sectionTitle}>Identity</h3>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="wp-newagent-name" style={labelStyle}>Name</label>
                <input
                  id="wp-newagent-name"
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="e.g. playwright-tester"
                  style={{ ...inputStyle, fontFamily: "var(--wp-font-mono)" }}
                />
              </div>
              <div style={{ width: 170 }}>
                <label htmlFor="wp-newagent-type" style={labelStyle}>Type</label>
                <select
                  id="wp-newagent-type"
                  value={form.agentType}
                  onChange={(e) => patch({ agentType: e.target.value })}
                  style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
                >
                  {AGENT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label htmlFor="wp-newagent-desc" style={labelStyle}>Description</label>
              <textarea
                id="wp-newagent-desc"
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                rows={2}
                placeholder="What this agent is responsible for."
                style={{ ...inputStyle, height: "auto", padding: "10px 12px", resize: "vertical", lineHeight: 1.6 }}
              />
            </div>
          </div>

          <div>
            <h3 style={sectionTitle}>Tools</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {AGENT_TOOL_OPTIONS.map((tool) => {
                const active = form.tools.includes(tool);
                const dangerous = tool === "write" || tool === "edit";
                return (
                  <button
                    key={tool}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleTool(tool)}
                    style={{
                      height: 30, padding: "0 12px", borderRadius: 6, cursor: "pointer",
                      border: `1px solid ${active ? "var(--wp-accent)" : "#282828"}`,
                      background: active ? "rgba(255,255,255,0.04)" : "transparent",
                      color: active ? "var(--wp-text-primary)" : "var(--wp-text-disabled)",
                      fontFamily: "var(--wp-font-mono)", fontSize: 12,
                    }}
                  >
                    {tool}{dangerous ? " *" : ""}
                  </button>
                );
              })}
            </div>
            <p style={hintStyle}>* write/edit grant file modification — prefer read-only tools for verify agents. skill/task stay denied by design.</p>
          </div>

          <div>
            <h3 style={sectionTitle}>Pipeline stage</h3>
            <p style={sectionDesc}>Pick where the pipeline runs it. Click the chosen slot again to detach.</p>
            <StagePicker value={form.stage} onChange={(stage) => patch({ stage, blocking: stage === "none" ? false : form.blocking })} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <button
                type="button"
                role="switch"
                aria-checked={form.blocking}
                disabled={form.stage === "none"}
                onClick={() => patch({ blocking: !form.blocking })}
                style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: form.stage === "none" ? "not-allowed" : "pointer", flexShrink: 0, position: "relative", background: form.blocking ? "var(--wp-accent)" : "#2a2a2a", transition: "background 150ms", opacity: form.stage === "none" ? 0.5 : 1 }}
              >
                <span style={{ position: "absolute", top: 3, left: form.blocking ? 19 : 3, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 150ms" }} />
              </button>
              <span style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "var(--wp-text-disabled)" }}>
                {form.blocking ? "Blocking — stops the pipeline on fail" : "Advisory — reports only"}
              </span>
            </div>
          </div>

          <div>
            <h3 style={sectionTitle}>Model <span style={{ fontWeight: 400, color: "var(--wp-text-disabled)" }}>(optional)</span></h3>
            <input
              id="wp-newagent-model"
              aria-label="Model (optional)"
              value={form.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder="provider/model — empty uses the job default"
              style={{ ...inputStyle, fontFamily: "var(--wp-font-mono)" }}
            />
          </div>

          <div>
            <h3 style={sectionTitle}>Prompt</h3>
            <textarea
              id="wp-newagent-body"
              aria-label="Agent prompt"
              value={form.body}
              onChange={(e) => patch({ body: e.target.value })}
              rows={10}
              placeholder={"# My tester\n\nYou verify...\n\nClose with a ```json block {\"verdict\",\"confidence\",\"summary\",\"findings\"}."}
              style={{ ...inputStyle, height: "auto", padding: "10px 12px", resize: "vertical", lineHeight: 1.6, fontFamily: "var(--wp-font-mono)", fontSize: 12 }}
            />
            <p style={hintStyle}>The agent must close with a ```json block: {"{"}"verdict": "pass" | "fail", "confidence", "summary", "findings"{"}"}.</p>
          </div>

          {(errors.length > 0 || serverError) && (
            <div role="alert" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 7, padding: "10px 12px" }}>
              {errors.map((e) => (
                <p key={e} style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "#f87171", margin: "0 0 4px" }}>{e}</p>
              ))}
              {serverError && (
                <p style={{ fontFamily: "var(--wp-font-sans)", fontSize: 12, color: "#f87171", margin: errors.length > 0 ? "4px 0 0" : 0 }}>{serverError}</p>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={onBack} style={{ height: 34, padding: "0 16px", borderRadius: 6, border: "1px solid var(--wp-border)", background: "transparent", color: "var(--wp-text-secondary)", fontFamily: "var(--wp-font-sans)", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{ height: 34, padding: "0 16px", borderRadius: 6, border: "none", background: "var(--wp-accent)", color: "#fff", fontFamily: "var(--wp-font-sans)", fontSize: 13, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.4 }}
            >
              {submitting ? "Creating…" : "Create agent"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
