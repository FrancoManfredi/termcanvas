import { useCallback, useState } from "react";
import type { Agent, AgentConfigData } from "../types";
import type { AgentsAdapter } from "../adapters/types";
import { mockAgentsAdapter, makeHookAgentCard } from "../adapters/mockAgents";
import {
  createFactoryAgent,
  deleteFactoryAgent,
  listFactoryAgents,
  type FactoryAgentCreateInput,
} from "../../../lib/factoryClient";

export interface UseAgentsResult {
  foreman: Agent;
  agents: Agent[];
  selectedAgentId: string | null;
  selectedAgent: Agent | null;
  selectedConfig: AgentConfigData | undefined;
  selectAgent: (id: string | null) => void;
  getConfig: (agentId: string) => AgentConfigData | undefined;
  saveConfig: (
    agentId: string,
    patch: Partial<AgentConfigData>,
  ) => AgentConfigData;
  /** Alta en una pasada (daemon; offline → error honesto, nada inventado). */
  createAgent: (input: FactoryAgentCreateInput) => Promise<{ ok: boolean; error?: string }>;
  /** Baja (daemon; los core se rechazan). */
  deleteAgent: (agentId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Fusiona la lista real del daemon (agentes creados fuera de los seeds). */
  refreshAgents: () => Promise<void>;
  creating: boolean;
  agentsError: string | null;
}

/**
 * Agent list + per-agent config state over an AgentsAdapter (Track B).
 * Server-shaped state (list, configs, saves) lives here; config tab/dirty
 * flags and tree expand state stay local to the T03 components.
 */
export function useAgents(
  adapter: AgentsAdapter = mockAgentsAdapter,
): UseAgentsResult {
  const [foreman] = useState<Agent>(() => adapter.getForeman());
  const [seedAgents] = useState<Agent[]>(() => adapter.listSubAgents());
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [configRevision, setConfigRevision] = useState<number>(0);
  // Agentes fuera de los seeds (creados por daemon o fusionados por refresh).
  const [extraAgents, setExtraAgents] = useState<Agent[]>([]);
  const [extraConfigs, setExtraConfigs] = useState<Record<string, AgentConfigData>>({});
  const [creating, setCreating] = useState<boolean>(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  // Read through the adapter on every render so saves are always visible.
  // `configRevision` forces a re-render after saveConfig mutates the store.
  void configRevision;

  const agents: Agent[] = [...seedAgents];
  for (const extra of extraAgents) {
    if (!agents.some((a) => a.id === extra.id)) agents.push(extra);
  }
  const allAgents: Agent[] = [foreman, ...agents];
  const selectedAgent: Agent | null =
    selectedAgentId === null
      ? null
      : (allAgents.find((agent) => agent.id === selectedAgentId) ?? null);
  const selectedConfig: AgentConfigData | undefined =
    selectedAgentId === null
      ? undefined
      : adapter.getConfig(selectedAgentId);

  const selectAgent = useCallback((id: string | null): void => {
    setSelectedAgentId(id);
  }, []);

  const getConfig = useCallback(
    (agentId: string): AgentConfigData | undefined =>
      adapter.getConfig(agentId) ?? extraConfigs[agentId],
    [adapter, extraConfigs],
  );

  const saveConfig = useCallback(
    (
      agentId: string,
      patch: Partial<AgentConfigData>,
    ): AgentConfigData => {
      try {
        const updated = adapter.saveConfig(agentId, patch);
        setConfigRevision((revision) => revision + 1);
        return updated;
      } catch {
        // Id fuera de los seeds (creado por daemon): store local del hook.
        const current = extraConfigs[agentId];
        if (!current) throw new Error(`Unknown agent id: ${agentId}`);
        const updated = { ...current, ...patch };
        setExtraConfigs((prev) => ({ ...prev, [agentId]: updated }));
        setConfigRevision((revision) => revision + 1);
        return updated;
      }
    },
    [adapter, extraConfigs],
  );

  const refreshAgents = useCallback(async (): Promise<void> => {
    try {
      const res = await listFactoryAgents();
      if (!res.ok) {
        setAgentsError(res.error ?? "daemon inalcanzable");
        return;
      }
      setAgentsError(null);
      const known = new Set<string>(["foreman"]);
      for (const a of [...seedAgents, ...extraAgents]) known.add(a.id);
      const fresh: Agent[] = [];
      const freshConfigs: Record<string, AgentConfigData> = {};
      for (const item of res.data) {
        if (known.has(item.name)) continue;
        fresh.push(makeHookAgentCard(item.name, item.description || item.name));
        freshConfigs[item.name] = {
          description: item.description || item.name,
          mcps: [],
          secrets: [],
          harness: "Warp",
          model: "",
          runner: "default",
          host: "Warp hosted",
          prompt: "",
          automations: [],
        };
      }
      if (fresh.length > 0) {
        setExtraAgents((prev) => {
          const ids = new Set(prev.map((a) => a.id));
          return [...prev, ...fresh.filter((a) => !ids.has(a.id))];
        });
        setExtraConfigs((prev) => ({ ...freshConfigs, ...prev }));
        setConfigRevision((revision) => revision + 1);
      }
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    }
    // Nota: seedAgents/extraAgents por closure quedan fijados por llamada;
    // refresh se llama desde efectos puntuales, no en loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createAgent = useCallback(
    async (input: FactoryAgentCreateInput): Promise<{ ok: boolean; error?: string }> => {
      setCreating(true);
      setAgentsError(null);
      try {
        const res = await createFactoryAgent(input);
        if (!res.ok) {
          setAgentsError(res.error ?? "no se pudo crear el agente");
          return { ok: false, error: res.error ?? "no se pudo crear el agente" };
        }
        const created = res.data;
        const card = makeHookAgentCard(created.name, String(created.frontmatter.description ?? created.name));
        setExtraAgents((prev) => (prev.some((a) => a.id === card.id) ? prev : [...prev, card]));
        const fm = created.frontmatter as Record<string, unknown>;
        const asList = (v: unknown): string[] | undefined =>
          Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : undefined;
        setExtraConfigs((prev) => ({
          ...prev,
          [created.name]: {
            description: typeof fm.description === "string" ? fm.description : created.name,
            mcps: [],
            secrets: [],
            harness: "Warp",
            model: typeof fm.model === "string" ? fm.model : "",
            runner: typeof fm.runner === "string" ? fm.runner : "default",
            host: "Warp hosted",
            prompt: created.body,
            automations: [],
            tools: asList(fm.tools),
            stage: typeof fm.stage === "string" ? fm.stage : undefined,
            blocking: typeof fm.blocking === "boolean" ? fm.blocking : undefined,
            mode: typeof fm.mode === "string" ? fm.mode : undefined,
            agentType: typeof fm.agentType === "string" ? fm.agentType : undefined,
          },
        }));
        setConfigRevision((revision) => revision + 1);
        return { ok: true };
      } catch (e) {
        const error = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
        setAgentsError(error);
        return { ok: false, error };
      } finally {
        setCreating(false);
      }
    },
    [],
  );

  const deleteAgent = useCallback(
    async (agentId: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await deleteFactoryAgent(agentId);
        if (!res.ok) {
          setAgentsError(res.error ?? "no se pudo eliminar el agente");
          return { ok: false, error: res.error ?? "no se pudo eliminar el agente" };
        }
        setExtraAgents((prev) => prev.filter((a) => a.id !== agentId));
        setExtraConfigs((prev) => {
          if (!(agentId in prev)) return prev;
          const next = { ...prev };
          delete next[agentId];
          return next;
        });
        setConfigRevision((revision) => revision + 1);
        return { ok: true };
      } catch (e) {
        const error = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
        setAgentsError(error);
        return { ok: false, error };
      }
    },
    [],
  );

  return {
    foreman,
    agents,
    selectedAgentId,
    selectedAgent,
    selectedConfig,
    selectAgent,
    getConfig,
    saveConfig,
    createAgent,
    deleteAgent,
    refreshAgents,
    creating,
    agentsError,
  };
}
