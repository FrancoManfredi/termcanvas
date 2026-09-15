import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FactoryMcpBundleListItem } from "../../../lib/factoryClient";
import type { AgentDraft } from "../types";
import { useAgents } from "../hooks/useAgents";
import { AgentIndex } from "./AgentIndex";
import { AgentDetail } from "./AgentDetail";
import { NewAgentDialog } from "./NewAgentDialog";
import { McpEditorDialog } from "./McpEditorDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { draftFromAgentFull, isAgentDraftDirty } from "./agentDraft";
import "./agents.css";

/**
 * AgentsConsole — sección Agents (master-detail, full width del panel).
 *
 * El console posee el draft (para bloquear el cambio de agente con cambios
 * sin guardar) y toda la interacción pasa por `useAgents` (data layer real).
 * Guardar aplica al próximo job: el daemon marca agentDirty y recicla el
 * server efímero cuando no hay workers activos.
 */

type PendingAction =
  | { kind: "switch"; name: string | null }
  | { kind: "reload" }
  | { kind: "delete-agent" }
  | null;

interface ToastState {
  message: string;
  tone: "ok" | "error";
}

export function AgentsConsole() {
  const data = useAgents();
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [baseline, setBaseline] = useState<AgentDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [mcpEditor, setMcpEditor] = useState<{ bundle: FactoryMcpBundleListItem | null } | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const toastTimer = useRef<number | null>(null);

  const dirty = useMemo(
    () => (draft && baseline ? isAgentDraftDirty(draft, baseline) : false),
    [draft, baseline],
  );

  useEffect(() => {
    if (data.full && data.full.name === data.selectedName) {
      const next = draftFromAgentFull(data.full);
      setDraft(next);
      setBaseline(next);
      setSaveError(null);
    } else if (data.selectedName === null) {
      setDraft(null);
      setBaseline(null);
    }
  }, [data.full, data.selectedName]);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((message: string, tone: "ok" | "error" = "ok") => {
    setToast({ message, tone });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const requestSelect = useCallback(
    (name: string | null) => {
      if (dirty && name !== data.selectedName) {
        setPending({ kind: "switch", name });
        return;
      }
      data.selectAgent(name);
    },
    [data, dirty],
  );

  const requestReload = useCallback(() => {
    if (dirty) {
      setPending({ kind: "reload" });
      return;
    }
    void data.reloadAgentFull();
  }, [data, dirty]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    const res = await data.saveAgent(draft.name, draft);
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error ?? "Could not save the agent.");
      return;
    }
    setBaseline(draft);
    showToast("Saved. Applies to the next job.");
  }, [data, draft, showToast]);

  const handleDeleteAgent = useCallback(async () => {
    if (!draft) return;
    setPending(null);
    setSaving(true);
    const res = await data.deleteAgent(draft.name);
    setSaving(false);
    if (!res.ok) {
      showToast(res.error ?? "Could not delete the agent.", "error");
      return;
    }
    showToast("Agent deleted.");
  }, [data, draft, showToast]);

  const selectedLoading =
    data.selectedName !== null && (data.fullState === "loading" || draft === null);
  const selectedOffline = data.selectedName !== null && data.fullState === "offline";

  return (
    <div className="ag-root">
      <header className="ag-header">
        <div className="ag-header-left">
          <h1 className="ag-title">Agents</h1>
          <span className="ag-count">
            {data.agents.length} agent{data.agents.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="ag-header-right">
          <button
            type="button"
            className="ag-btn ag-btn--primary"
            onClick={() => setShowNew(true)}
            disabled={data.agentsState === "offline"}
            title={data.agentsState === "offline" ? "Daemon unreachable" : undefined}
          >
            New agent
          </button>
        </div>
      </header>

      <div className="ag-body" data-selection={data.selectedName !== null}>
        <AgentIndex
          agents={data.agents}
          state={data.agentsState}
          error={data.agentsError}
          selectedName={data.selectedName}
          dirty={dirty}
          onSelect={(name) => requestSelect(name)}
          onRetry={() => void data.refreshAgents()}
        />

        {selectedLoading ? (
          <div className="ag-detail">
            <div className="ag-skeleton">
              <div className="ag-skeleton-row" style={{ height: 64 }} />
              <div className="ag-skeleton-row" style={{ height: 120 }} />
              <div className="ag-skeleton-row" style={{ height: 120 }} />
            </div>
          </div>
        ) : selectedOffline ? (
          <div className="ag-detail">
            <div className="ag-empty">
              <span className="ag-empty-title">Could not load this agent</span>
              <span className="ag-empty-body">
                {data.fullError ?? "The daemon is unreachable."} Nothing was
                changed on disk.
              </span>
              <button type="button" className="ag-btn" onClick={() => void data.reloadAgentFull()}>
                Retry
              </button>
            </div>
          </div>
        ) : draft !== null ? (
          <AgentDetail
            draft={draft}
            onChange={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
            dirty={dirty}
            saving={saving}
            saveError={saveError}
            onSave={() => void handleSave()}
            onDiscard={() => {
              setDraft(baseline);
              setSaveError(null);
            }}
            onReload={requestReload}
            onDelete={() => setPending({ kind: "delete-agent" })}
            onBack={() => requestSelect(null)}
            skills={data.skills}
            skillsError={data.skillsError}
            mcps={data.mcps}
            mcpsError={data.mcpsError}
            onManageMcp={(bundle) => setMcpEditor({ bundle })}
          />
        ) : (
          <div className="ag-detail">
            <div className="ag-empty">
              <span className="ag-empty-title">Select an agent</span>
              <span className="ag-empty-body">
                Pick an agent from the list to see and edit its full
                configuration.
              </span>
            </div>
          </div>
        )}
      </div>

      {toast ? (
        <div className={`ag-toast ${toast.tone === "error" ? "ag-toast--error" : ""}`} role="status">
          {toast.message}
        </div>
      ) : null}

      {showNew ? (
        <NewAgentDialog
          createAgent={data.createAgent}
          onClose={() => setShowNew(false)}
          onDone={(message) => showToast(message)}
        />
      ) : null}

      {mcpEditor ? (
        <McpEditorDialog
          bundle={mcpEditor.bundle}
          loadMcp={data.loadMcp}
          addMcp={data.addMcp}
          updateMcp={data.updateMcp}
          removeMcp={data.removeMcp}
          onClose={() => setMcpEditor(null)}
          onDone={(message) => {
            setMcpEditor(null);
            showToast(message);
          }}
        />
      ) : null}

      {pending?.kind === "switch" ? (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body={`You have unsaved edits in "${draft?.name ?? ""}". Switching agents discards them.`}
          confirmLabel="Discard and switch"
          danger
          onConfirm={() => {
            const target = pending.name;
            setPending(null);
            data.selectAgent(target);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}

      {pending?.kind === "reload" ? (
        <ConfirmDialog
          title="Reload from disk?"
          body="Your unsaved edits will be replaced by the current agent.md content."
          confirmLabel="Reload"
          danger
          onConfirm={() => {
            setPending(null);
            void data.reloadAgentFull();
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}

      {pending?.kind === "delete-agent" ? (
        <ConfirmDialog
          title={`Delete agent "${draft?.name ?? ""}"?`}
          body="This removes factory/agents/<name>/agent.md from disk. Workflow nodes that reference it will fail until updated."
          confirmLabel="Delete agent"
          danger
          busy={saving}
          onConfirm={() => void handleDeleteAgent()}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
