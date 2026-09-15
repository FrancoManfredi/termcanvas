import type { FactoryMcpBundleListItem, FactorySkillEntry } from "../../../lib/factoryClient";
import type { AgentDraft } from "../types";
import { AGENT_TOOL_OPTIONS } from "./agentDraft";
import { AgentIcon, IconPicker, isAgentIconKey } from "./agentIcons";
import { ModelPicker } from "./ModelPicker";
import { isCoreAgentId } from "./newAgentForm";

/**
 * AgentDetail — editor del agente seleccionado. Secciones separadas por
 * hairlines (sin stacks de cards): Identity, Model, Tools, Skills, MCPs,
 * Prompt, Danger. Controlado: el draft lo posee el console para poder
 * bloquear el cambio de agente con cambios sin guardar.
 */

export interface AgentDetailProps {
  draft: AgentDraft;
  onChange: (patch: Partial<AgentDraft>) => void;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
  onDelete: () => void;
  onBack: () => void;
  skills: FactorySkillEntry[];
  skillsError: string | null;
  mcps: FactoryMcpBundleListItem[];
  mcpsError: string | null;
  onManageMcp: (bundle: FactoryMcpBundleListItem | null) => void;
}

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((v) => v !== item) : [...list, item];
}

export function AgentDetail({
  draft,
  onChange,
  dirty,
  saving,
  saveError,
  onSave,
  onDiscard,
  onReload,
  onDelete,
  onBack,
  skills,
  skillsError,
  mcps,
  mcpsError,
  onManageMcp,
}: AgentDetailProps) {
  const canDelete = !isCoreAgentId(draft.name);
  const skillCatalogNames = new Set(skills.map((s) => s.name));
  const mcpCatalogNames = new Set(mcps.map((m) => m.name));
  const missingSkills = draft.skills.filter((name) => !skillCatalogNames.has(name));
  const missingMcps = draft.mcps.filter((name) => !mcpCatalogNames.has(name));

  return (
    <div className="ag-detail">
      <div className="ag-detail-head">
        <button
          type="button"
          className="ag-btn ag-btn--ghost ag-btn--sm ag-mobile-back"
          onClick={onBack}
        >
          Back
        </button>
        <span className="ag-glyph ag-glyph--lg" aria-hidden="true">
          {isAgentIconKey(draft.icon) ? (
            <AgentIcon icon={draft.icon} size={20} />
          ) : (
            (draft.name || "?").slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="ag-detail-title">
          <h2 className="ag-detail-name">{draft.name}</h2>
          <span className="ag-detail-path">factory/agents/{draft.name}/agent.md</span>
        </span>
        <button type="button" className="ag-btn ag-btn--sm" onClick={onReload} disabled={saving}>
          Reload
        </button>
      </div>

      <div className="ag-detail-scroll">
        <section className="ag-section">
          <h3 className="ag-section-title">Identity</h3>
          <p className="ag-section-hint">
            The description is what the workflow catalog shows for this agent.
          </p>
          <div className="ag-field">
            <label className="ag-label" htmlFor="ag-description">
              Description
            </label>
            <textarea
              id="ag-description"
              className="ag-textarea"
              rows={2}
              value={draft.description}
              onChange={(event) => onChange({ description: event.target.value })}
              placeholder="What this agent does and when it is used."
            />
          </div>
          <div className="ag-field">
            <span className="ag-label" id="ag-icon-label">
              Icon
            </span>
            <IconPicker
              value={draft.icon}
              onChange={(icon) => onChange({ icon })}
              disabled={saving}
            />
          </div>
        </section>

        <section className="ag-section">
          <h3 className="ag-section-title">Model</h3>
          <p className="ag-section-hint">
            Pinned model for this agent. Workflow nodes can still override it
            per node; empty means opencode picks the default.
          </p>
          <ModelPicker
            value={draft.model}
            onChange={(value) => onChange({ model: value })}
            disabled={saving}
            showLabel={false}
          />
        </section>

        <section className="ag-section">
          <h3 className="ag-section-title">Tools</h3>
          <p className="ag-section-hint">
            Allowlist compiled into the agent permission map. Deny is the
            default; protected paths stay blocked by the daemon guardrails.
          </p>
          <div className="ag-chips">
            {AGENT_TOOL_OPTIONS.map((tool) => (
              <button
                key={tool}
                type="button"
                className="ag-chip"
                aria-pressed={draft.tools.includes(tool)}
                onClick={() => onChange({ tools: toggle(draft.tools, tool) })}
                disabled={saving}
              >
                {tool}
              </button>
            ))}
          </div>
        </section>

        <section className="ag-section">
          <h3 className="ag-section-title">Skills</h3>
          <p className="ag-section-hint">
            On-demand skills from factory/skills. The agent can load only the
            ones allowed here; everything else is denied.
          </p>
          {skillsError ? (
            <p className="ag-hint ag-hint--warn">Skill catalog unavailable: {skillsError}</p>
          ) : null}
          {skills.length === 0 && !skillsError ? (
            <p className="ag-hint">
              No skills found in factory/skills. Add a skill folder with a
              SKILL.md to make it available here.
            </p>
          ) : (
            <div className="ag-chips">
              {skills.map((skill) => (
                <button
                  key={skill.name}
                  type="button"
                  className="ag-chip"
                  aria-pressed={draft.skills.includes(skill.name)}
                  title={skill.description || skill.name}
                  onClick={() => onChange({ skills: toggle(draft.skills, skill.name) })}
                  disabled={saving}
                >
                  {skill.name}
                </button>
              ))}
            </div>
          )}
          {missingSkills.length > 0 ? (
            <div className="ag-chips" style={{ marginTop: 8 }}>
              {missingSkills.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="ag-chip ag-chip--missing"
                  title="No SKILL.md found for this name. The agent will fail to load it at runtime."
                  onClick={() => onChange({ skills: toggle(draft.skills, name) })}
                  disabled={saving}
                >
                  {name} (missing)
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="ag-section">
          <h3 className="ag-section-title">MCPs</h3>
          <p className="ag-section-hint">
            MCP bundles from factory/mcps. Agents receive the servers of every
            selected bundle when a workflow node runs them.
          </p>
          {mcpsError ? (
            <p className="ag-hint ag-hint--warn">MCP catalog unavailable: {mcpsError}</p>
          ) : null}
          <div className="ag-mcp-list">
            {mcps.map((bundle) => {
              const assigned = draft.mcps.includes(bundle.name);
              const target = bundle.servers.map((s) => s.target).join(" ");
              return (
                <div
                  key={bundle.name}
                  className={`ag-mcp-row ${assigned ? "ag-mcp-row--on" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Use ${bundle.name}`}
                    checked={assigned}
                    style={{ accentColor: "var(--wp-accent)" }}
                    onChange={() => onChange({ mcps: toggle(draft.mcps, bundle.name) })}
                    disabled={saving}
                  />
                  <span className="ag-mcp-main">
                    <span className="ag-mcp-name">{bundle.name}</span>
                    <span className="ag-mcp-target" title={target}>
                      {bundle.serverCount} server{bundle.serverCount === 1 ? "" : "s"}
                      {target ? ` · ${target}` : ""}
                    </span>
                  </span>
                  <span className="ag-mcp-actions">
                    <button
                      type="button"
                      className="ag-btn ag-btn--ghost ag-btn--sm"
                      onClick={() => onManageMcp(bundle)}
                      disabled={saving}
                    >
                      Edit
                    </button>
                  </span>
                </div>
              );
            })}
            {mcps.length === 0 && !mcpsError ? (
              <p className="ag-hint">
                No MCP bundles yet. Create one to give agents access to external
                tools over MCP.
              </p>
            ) : null}
          </div>
          {missingMcps.length > 0 ? (
            <div className="ag-chips" style={{ marginTop: 8 }}>
              {missingMcps.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="ag-chip ag-chip--missing"
                  title="No factory/mcps file found. The node fails at runtime until you recreate it or remove it here."
                  onClick={() => onChange({ mcps: toggle(draft.mcps, name) })}
                  disabled={saving}
                >
                  {name} (missing)
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="ag-btn ag-btn--sm"
              onClick={() => onManageMcp(null)}
              disabled={saving}
            >
              New MCP
            </button>
          </div>
        </section>

        <section className="ag-section">
          <h3 className="ag-section-title">Prompt</h3>
          <p className="ag-section-hint">
            The agent.md body is the real system prompt delivered inline to the
            ephemeral opencode server.
          </p>
          <textarea
            id="ag-prompt"
            className="ag-textarea ag-textarea--mono"
            aria-label="Agent prompt"
            value={draft.prompt}
            onChange={(event) => onChange({ prompt: event.target.value })}
            spellCheck={false}
          />
        </section>

        {canDelete ? (
          <section className="ag-section">
            <h3 className="ag-section-title">Danger zone</h3>
            <p className="ag-section-hint">
              Core pipeline agents (foreman, triage, spec, implement, review)
              cannot be deleted. This one can.
            </p>
            <button
              type="button"
              className="ag-btn ag-btn--danger"
              onClick={onDelete}
              disabled={saving}
            >
              Delete agent
            </button>
          </section>
        ) : null}
      </div>

      {dirty || saving || saveError ? (
        <div className="ag-savebar">
          <span className="ag-savebar-text">
            {saveError ? (
              <span className="ag-hint--error" role="alert">
                {saveError}
              </span>
            ) : (
              "Unsaved changes. Saving applies to the next job."
            )}
          </span>
          <span className="ag-savebar-actions">
            <button
              type="button"
              className="ag-btn ag-btn--ghost"
              onClick={onDiscard}
              disabled={saving}
            >
              Discard
            </button>
            <button
              type="button"
              className="ag-btn ag-btn--primary"
              onClick={onSave}
              disabled={saving || !dirty}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
