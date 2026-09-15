import { useState } from "react";
import type { AgentsActionResult } from "../hooks/useAgents";
import type { FactoryAgentCreateInput } from "../../../lib/factoryClient";
import { ModelPicker } from "./ModelPicker";
import {
  AGENT_TOOL_OPTIONS,
  EMPTY_NEW_AGENT_FORM,
  newAgentFormToInput,
  validateNewAgentInput,
  type NewAgentForm,
} from "./newAgentForm";

/**
 * NewAgentDialog — alta mínima: nombre, descripción, tools, modelo y prompt.
 * El resto (skills, MCPs, ícone) se ajusta en el detalle ya creado, donde el
 * draft tiene el agente completo.
 */

export interface NewAgentDialogProps {
  createAgent: (
    input: FactoryAgentCreateInput,
  ) => Promise<AgentsActionResult & { name?: string }>;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function NewAgentDialog({ createAgent, onClose, onDone }: NewAgentDialogProps) {
  const [form, setForm] = useState<NewAgentForm>({
    ...EMPTY_NEW_AGENT_FORM,
    tools: [...EMPTY_NEW_AGENT_FORM.tools],
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (partial: Partial<NewAgentForm>) => setForm((prev) => ({ ...prev, ...partial }));

  const submit = async () => {
    const validation = validateNewAgentInput(form);
    setErrors(validation);
    if (validation.length > 0) return;
    setBusy(true);
    const res = await createAgent(newAgentFormToInput(form));
    setBusy(false);
    if (!res.ok) {
      setErrors([res.error ?? "Could not create the agent."]);
      return;
    }
    onDone(`Agent "${res.name ?? form.name.trim()}" created.`);
    onClose();
  };

  return (
    <div
      className="ag-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="ag-dialog" role="dialog" aria-modal="true" aria-label="New agent">
        <h2 className="ag-dialog-title">New agent</h2>
        <p className="ag-section-hint">
          Creates factory/agents/&lt;name&gt;/agent.md. Extra agents run through
          workflow nodes that reference them.
        </p>

        <div className="ag-field">
          <label className="ag-label" htmlFor="ag-new-name">
            Name
          </label>
          <input
            id="ag-new-name"
            className="ag-input"
            value={form.name}
            placeholder="playwright-tester"
            spellCheck={false}
            autoFocus
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>

        <div className="ag-field">
          <label className="ag-label" htmlFor="ag-new-description">
            Description
          </label>
          <textarea
            id="ag-new-description"
            className="ag-textarea"
            rows={2}
            value={form.description}
            placeholder="What this agent does and when it is used."
            onChange={(event) => patch({ description: event.target.value })}
          />
        </div>

        <div className="ag-field">
          <span className="ag-label">Tools</span>
          <div className="ag-chips">
            {AGENT_TOOL_OPTIONS.map((tool) => (
              <button
                key={tool}
                type="button"
                className="ag-chip"
                aria-pressed={form.tools.includes(tool)}
                onClick={() =>
                  patch({
                    tools: form.tools.includes(tool)
                      ? form.tools.filter((t) => t !== tool)
                      : [...form.tools, tool],
                  })
                }
                disabled={busy}
              >
                {tool}
              </button>
            ))}
          </div>
        </div>

        <ModelPicker
          value={form.model}
          onChange={(value) => patch({ model: value })}
          disabled={busy}
        />

        <div className="ag-field">
          <label className="ag-label" htmlFor="ag-new-prompt">
            Prompt
          </label>
          <textarea
            id="ag-new-prompt"
            className="ag-textarea ag-textarea--mono"
            rows={8}
            value={form.body}
            placeholder="Role rules and output contract for this agent."
            spellCheck={false}
            onChange={(event) => patch({ body: event.target.value })}
          />
        </div>

        {errors.length > 0 ? (
          <ul className="ag-hint ag-hint--error" role="alert" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}

        <div className="ag-dialog-actions" style={{ marginTop: 16 }}>
          <button type="button" className="ag-btn ag-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="ag-btn ag-btn--primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "Creating..." : "Create agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
