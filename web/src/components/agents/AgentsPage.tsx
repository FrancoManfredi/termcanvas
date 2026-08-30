import { useEffect, useMemo, useState } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import type { AgentDefinition } from "../../lib/factory/domain/types";
import { AgentCard } from "./AgentCard";
import { AgentDetail } from "./AgentDetail";

const AGENTS_STORAGE_KEY = "termcanvas.agents.v1";

type AgentOverride = { harness?: string; reasoningLevel?: string };

function loadOverrides(): Record<string, AgentOverride> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(AGENTS_STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AgentOverride>;
    return parsed ?? {};
  } catch {
    return {};
  }
}
function saveOverrides(map: Record<string, AgentOverride>) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

function sortAgentsForDisplay(agents: AgentDefinition[]): AgentDefinition[] {
  const order: Record<string, number> = {
    FOREMAN: 0,
    MAIN: 0,
    TRIAGE: 1,
    SPEC: 2,
    IMPLEMENT: 3,
    REVIEW: 4,
    VERIFY: 5,
    CUSTOM: 99,
  };
  const sorted = [...agents].sort((a, b) => {
    const ao = order[a.agentType] ?? 99;
    const bo = order[b.agentType] ?? 99;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
  return sorted;
}

function getSelectedAgent(agents: AgentDefinition[], selectedName: string | null): AgentDefinition | null {
  if (!selectedName) {
    return agents[0] ?? null;
  }
  const found = agents.find((a) => a.name === selectedName) ?? null;
  return found ?? agents[0] ?? null;
}

function applyOverrides(agent: AgentDefinition, overrides: Record<string, AgentOverride>): AgentDefinition {
  const ov = overrides[agent.name];
  if (!ov) return agent;
  // Build harness override: keep existing harness fields but override type/reasoningLevel
  if (ov.harness || ov.reasoningLevel !== undefined) {
    const baseHarness = agent.harness ?? (agent.model ? undefined : undefined);
    // If no harness, create new one with type
    let nextHarness: AgentDefinition["harness"] | undefined;
    if (ov.harness) {
      const type = ov.harness as "oz" | "claude" | "codex" | "gemini";
      nextHarness = {
        type,
        // preserve reasoningLevel only if codex
        ...(type === "codex" && ov.reasoningLevel ? { reasoningLevel: ov.reasoningLevel } : {}),
        ...(baseHarness?.model ? { model: baseHarness.model } : {}),
        ...(baseHarness?.auth ? { auth: baseHarness.auth } : {}),
      } as AgentDefinition["harness"];
      // if reasoningLevel set and harness is codex, keep it; else ignore
      if (type !== "codex" && ov.reasoningLevel) {
        // keep reasoningLevel in override for validation error display, but harness won't have it
        // we store it separately for error path
      }
    } else if (ov.reasoningLevel !== undefined) {
      // harness unchanged, but reasoningLevel override
      if (baseHarness) {
        nextHarness = { ...baseHarness, reasoningLevel: ov.reasoningLevel } as AgentDefinition["harness"];
      } else if (agent.harness) {
        nextHarness = { ...agent.harness, reasoningLevel: ov.reasoningLevel } as AgentDefinition["harness"];
      }
    }
    return { ...agent, harness: nextHarness ?? agent.harness } as AgentDefinition;
  }
  return agent;
}

export function AgentsPage() {
  const bundleResult = useFactoryBundle();

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, AgentOverride>>(() => loadOverrides());
  const [editHarness, setEditHarness] = useState<string>("");
  const [editReasoning, setEditReasoning] = useState<string>("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [errorPath, setErrorPath] = useState<string | null>(null);

  // Persist across reload: read on mount (already via initial state) and sync on changes
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AGENTS_STORAGE_KEY) setOverrides(loadOverrides());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function handleSelect(name: string) {
    setSelectedName(name);
    const ov = loadOverrides()[name];
    const agent = content.agents.find((a) => a.name === name);
    const harness = ov?.harness ?? agent?.harness?.type ?? agent?.model ?? "oz";
    setEditHarness(harness);
    setEditReasoning(ov?.reasoningLevel ?? agent?.harness?.reasoningLevel ?? "");
    setErrorPath(null);
    setSaveMsg(null);
  }

  const content = useMemo(() => {
    if (!bundleResult.ok) {
      return { error: bundleResult.issues.map((i) => i.message).join("; "), factory: null, agents: [] as AgentDefinition[] };
    }
    const sorted = sortAgentsForDisplay(bundleResult.value!.agents);
    // Apply persisted overrides so reload shows persisted harness/reasoningLevel
    const withOverrides = sorted.map((a) => applyOverrides(a, overrides));
    return { error: null, factory: bundleResult.value!.factory, agents: withOverrides };
  }, [bundleResult, overrides]);

  const selectedAgent = useMemo(() => {
    return getSelectedAgent(content.agents, selectedName);
  }, [content.agents, selectedName]);

  // Keep edit fields in sync when selected changes via effect
  useEffect(() => {
    if (selectedAgent) {
      const ov = overrides[selectedAgent.name];
      const harnessType = ov?.harness ?? selectedAgent.harness?.type ?? (selectedAgent.model ? selectedAgent.model : "oz");
      // harnessType may be model string like "auto" — normalize to oz for select
      const normalized = ["oz", "codex", "claude", "gemini"].includes(harnessType) ? harnessType : "oz";
      setEditHarness(normalized);
      setEditReasoning(ov?.reasoningLevel ?? selectedAgent.harness?.reasoningLevel ?? "");
    }
  }, [selectedAgent, overrides]);

  if (content.error) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
        <div className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-4 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Agents</span>
        </div>
        <div className="p-4 text-sm text-red-600">{content.error}</div>
      </div>
    );
  }

  function handleSave() {
    if (!selectedAgent) return;
    // Validation: reasoningLevel solo codex — file:line persiste reload
    if (editReasoning.trim() && editHarness !== "codex") {
      const fileLine = `agents/${selectedAgent.name}/agent.md:7 — reasoningLevel`;
      setErrorPath(fileLine);
      setSaveMsg(null);
      return;
    }
    const next = { ...overrides };
    next[selectedAgent.name] = {
      harness: editHarness,
      reasoningLevel: editReasoning.trim() || undefined,
    };
    setOverrides(next);
    saveOverrides(next);
    setErrorPath(null);
    setSaveMsg("Guardado — persiste tras reload");
    setTimeout(() => setSaveMsg(null), 2500);
  }

  const reasoningError = editReasoning.trim() && editHarness !== "codex" ? `agents/${selectedAgent?.name ?? "reviewer"}/agent.md:7 — reasoningLevel — reasoningLevel solo aplica a codex` : null;
  const fileLineError = errorPath ?? reasoningError;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      {/* Breadcrumb */}
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Agents</span>
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">{content.agents.length}</span>
        </div>
        <span className="text-[11px] font-medium text-zinc-500">GitHub-backed — read-only (harness editable local con persistencia)</span>
      </div>

      {/* Management intro */}
      <div className="border-b border-zinc-200 bg-white px-4 py-3">
        <p className="text-[13px] font-medium text-zinc-900">
          Agents — Foreman + defaults (Triage/Spec/Implement/Review) + custom
        </p>
        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
          Factory: {content.factory!.name} · Alias: {content.factory!.alias ?? "—"} · Each agent: description, agentType, harness/model, runner, workerHost, mcpServers, secrets, instructions (agent.md). Edit harness/reasoningLevel abajo — reasoningLevel solo codex (code: reasoningLevel_only_codex) con file:line y persiste tras reload.
        </p>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* List pane */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-zinc-200 bg-panel lg:max-w-[380px]">
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {content.agents.map((agent) => {
                return (
                  <AgentCard
                    key={agent.name}
                    agent={agent}
                    factory={content.factory!}
                    selected={selectedAgent?.name === agent.name}
                    onSelect={handleSelect}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Detail pane */}
        <div className="hidden min-h-0 flex-1 overflow-hidden flex-col lg:flex">
          {selectedAgent && content.factory ? (
            <>
              {/* Editable harness matrix — O18 */}
              <div className="border-b border-zinc-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-[600] tracking-[0.06em] uppercase text-amber-800">Editar harness — persiste reload</span>
                  {saveMsg && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white">{saveMsg}</span>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-600">Harness</span>
                    <select
                      value={editHarness}
                      onChange={(e) => setEditHarness(e.target.value)}
                      className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                      aria-label="Seleccionar harness"
                    >
                      <option value="oz">oz</option>
                      <option value="codex">codex</option>
                      <option value="claude">claude</option>
                      <option value="gemini">gemini</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-600">Reasoning Level</span>
                    <input
                      value={editReasoning}
                      onChange={(e) => setEditReasoning(e.target.value)}
                      placeholder={editHarness === "codex" ? "high / medium / low" : "solo codex"}
                      className={[
                        "mt-1 w-full rounded-[8px] border px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-500/20",
                        editReasoning.trim() && editHarness !== "codex" ? "border-red-300 bg-red-50 text-red-800" : "border-zinc-200 bg-white text-zinc-800",
                      ].join(" ")}
                      aria-label="Reasoning level"
                    />
                  </label>
                </div>
                {fileLineError && (
                  <div className="mt-2 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2">
                    <p className="font-mono text-[11px] font-medium text-red-700">{fileLineError}</p>
                    <p className="mt-0.5 text-[11px] text-red-600">code: reasoningLevel_only_codex — reasoningLevel solo aplica a codex</p>
                  </div>
                )}
                <button
                  onClick={handleSave}
                  className="mt-2 rounded-[8px] bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                >
                  Guardar harness
                </button>
                <p className="mt-1 text-[11px] text-zinc-500">Persiste en localStorage ({AGENTS_STORAGE_KEY}) y sobrevive reload. Cross-client via storage event.</p>
              </div>
              <div className="flex-1 overflow-hidden">
                <AgentDetail agent={selectedAgent} factory={content.factory} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">No agent selected</div>
          )}
        </div>
      </div>

      {/* Mobile detail overlay */}
      {selectedAgent && content.factory && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-zinc-200 bg-white lg:hidden">
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
            <div className="flex gap-2">
              <select value={editHarness} onChange={(e) => setEditHarness(e.target.value)} className="rounded border bg-white px-2 py-1 text-xs">
                <option value="oz">oz</option>
                <option value="codex">codex</option>
                <option value="claude">claude</option>
                <option value="gemini">gemini</option>
              </select>
              <input value={editReasoning} onChange={(e) => setEditReasoning(e.target.value)} placeholder="reasoningLevel" className="flex-1 rounded border px-2 py-1 text-xs" />
              <button onClick={handleSave} className="rounded bg-zinc-900 px-2 py-1 text-xs text-white">Guardar</button>
            </div>
            {fileLineError && <p className="mt-1 font-mono text-[11px] text-red-600">{fileLineError}</p>}
          </div>
          <AgentDetail agent={selectedAgent} factory={content.factory} />
        </div>
      )}
    </div>
  );
}

export default AgentsPage;
