/**
 * useAgents — data layer del console de Agents.
 *
 * Fuente única: el daemon real (factoryClient). Sin mocks ni fallback que
 * finja persistencia: si el daemon no está, la UI muestra un estado offline
 * honesto con retry. Las mutaciones (save/create/delete) impactan en el
 * próximo job: el daemon marca `agentDirty` y recicla el server efímero
 * cuando no hay workers.
 *
 * Catálogos: skills (`GET /factory/skills`) y bundles MCP (`GET /factory/mcps`)
 * se cargan al montar y se refrescan tras cada mutación.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentDraft, AgentSummary } from "../types";
import type {
  FactoryAgentCreateInput,
  FactoryAgentFull,
  FactoryMcpBundleListItem,
  FactorySkillEntry,
} from "../../../lib/factoryClient";
import {
  createFactoryAgent,
  createFactoryMcp,
  deleteFactoryAgent,
  deleteFactoryMcp,
  getFactoryAgentFull,
  getFactoryMcp,
  getFactorySkills,
  listFactoryAgents,
  listFactoryMcps,
  saveFactoryAgentFull,
  saveFactoryMcp,
} from "../../../lib/factoryClient";
import { draftToFrontmatter } from "../agents/agentDraft";

export type AgentsLoadState = "loading" | "ready" | "offline";

export interface AgentsActionResult {
  ok: boolean;
  error?: string;
}

export interface UseAgentsResult {
  agents: AgentSummary[];
  agentsState: AgentsLoadState;
  agentsError: string | null;
  refreshAgents: () => Promise<void>;
  selectedName: string | null;
  selectAgent: (name: string | null) => void;
  full: FactoryAgentFull | null;
  fullState: AgentsLoadState;
  fullError: string | null;
  reloadAgentFull: () => Promise<void>;
  saveAgent: (name: string, draft: AgentDraft) => Promise<AgentsActionResult>;
  createAgent: (input: FactoryAgentCreateInput) => Promise<AgentsActionResult & { name?: string }>;
  deleteAgent: (name: string) => Promise<AgentsActionResult>;
  skills: FactorySkillEntry[];
  skillsError: string | null;
  refreshSkills: () => Promise<void>;
  mcps: FactoryMcpBundleListItem[];
  mcpsError: string | null;
  refreshMcps: () => Promise<void>;
  loadMcp: (name: string) => Promise<AgentsActionResult & { servers?: Record<string, unknown> }>;
  addMcp: (name: string, servers: Record<string, unknown>) => Promise<AgentsActionResult>;
  updateMcp: (name: string, servers: Record<string, unknown>) => Promise<AgentsActionResult>;
  removeMcp: (name: string) => Promise<AgentsActionResult>;
}

function truncateError(error: string | undefined): string {
  return (error ?? "daemon inalcanzable").slice(0, 200);
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsState, setAgentsState] = useState<AgentsLoadState>("loading");
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [full, setFull] = useState<FactoryAgentFull | null>(null);
  const [fullState, setFullState] = useState<AgentsLoadState>("loading");
  const [fullError, setFullError] = useState<string | null>(null);
  const [skills, setSkills] = useState<FactorySkillEntry[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [mcps, setMcps] = useState<FactoryMcpBundleListItem[]>([]);
  const [mcpsError, setMcpsError] = useState<string | null>(null);

  const fullCacheRef = useRef(new Map<string, FactoryAgentFull>());
  const fullRequestRef = useRef(0);

  const refreshAgents = useCallback(async (): Promise<void> => {
    setAgentsState((prev) => (prev === "ready" ? prev : "loading"));
    const res = await listFactoryAgents();
    if (!res.ok) {
      setAgentsState("offline");
      setAgentsError(truncateError(res.error));
      return;
    }
    setAgents(res.data);
    setAgentsState("ready");
    setAgentsError(null);
    setSelectedName((prev) => {
      if (prev && res.data.some((a) => a.name === prev)) return prev;
      return res.data.length > 0 ? res.data[0].name : null;
    });
  }, []);

  const refreshSkills = useCallback(async (): Promise<void> => {
    const res = await getFactorySkills();
    if (!res.ok) {
      setSkillsError(truncateError(res.error));
      return;
    }
    setSkills(res.data);
    setSkillsError(null);
  }, []);

  const refreshMcps = useCallback(async (): Promise<void> => {
    const res = await listFactoryMcps();
    if (!res.ok) {
      setMcpsError(truncateError(res.error));
      return;
    }
    setMcps(res.data);
    setMcpsError(null);
  }, []);

  useEffect(() => {
    void refreshAgents();
    void refreshSkills();
    void refreshMcps();
  }, [refreshAgents, refreshSkills, refreshMcps]);

  const loadFull = useCallback(async (name: string, force: boolean): Promise<void> => {
    const cached = fullCacheRef.current.get(name);
    if (cached && !force) {
      setFull(cached);
      setFullState("ready");
      setFullError(null);
      return;
    }
    const requestId = fullRequestRef.current + 1;
    fullRequestRef.current = requestId;
    setFullState("loading");
    setFullError(null);
    const res = await getFactoryAgentFull(name);
    if (fullRequestRef.current !== requestId) return;
    if (!res.ok) {
      setFullState("offline");
      setFullError(truncateError(res.error));
      setFull(null);
      return;
    }
    fullCacheRef.current.set(name, res.data);
    setFull(res.data);
    setFullState("ready");
  }, []);

  const selectAgent = useCallback(
    (name: string | null): void => {
      setSelectedName(name);
      if (name === null) {
        setFull(null);
        setFullState("ready");
        setFullError(null);
        return;
      }
      void loadFull(name, false);
    },
    [loadFull],
  );

  // Selección inicial (o recuperación tras refresh) fuera de refreshAgents:
  // si hay un agente elegido y no está cargado, se carga una vez.
  useEffect(() => {
    if (selectedName === null) return;
    if (full !== null && full.name === selectedName) return;
    const cached = fullCacheRef.current.get(selectedName);
    if (cached) {
      setFull(cached);
      setFullState("ready");
      setFullError(null);
      return;
    }
    void loadFull(selectedName, false);
  }, [selectedName, full, loadFull]);

  const reloadAgentFull = useCallback(async (): Promise<void> => {
    if (selectedName === null) return;
    fullCacheRef.current.delete(selectedName);
    await loadFull(selectedName, true);
  }, [selectedName, loadFull]);

  const saveAgent = useCallback(
    async (name: string, draft: AgentDraft): Promise<AgentsActionResult> => {
      const body = draft.prompt.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
      if (!body) return { ok: false, error: "Prompt vacío: no se guardó nada." };
      const res = await saveFactoryAgentFull(name, body, draftToFrontmatter(draft));
      if (!res.ok) return { ok: false, error: truncateError(res.error) };
      fullCacheRef.current.set(name, res.data);
      setFull(res.data);
      setFullState("ready");
      setFullError(null);
      setAgents((prev) =>
        prev.map((a) =>
          a.name === name
            ? { ...a, description: draft.description.trim(), agentType: draft.agentType }
            : a,
        ),
      );
      return { ok: true };
    },
    [],
  );

  const createAgent = useCallback(
    async (input: FactoryAgentCreateInput): Promise<AgentsActionResult & { name?: string }> => {
      const res = await createFactoryAgent(input);
      if (!res.ok) return { ok: false, error: truncateError(res.error) };
      const created = res.data;
      fullCacheRef.current.set(created.name, created);
      setFull(created);
      setFullState("ready");
      setFullError(null);
      setSelectedName(created.name);
      await refreshAgents();
      return { ok: true, name: created.name };
    },
    [refreshAgents],
  );

  const deleteAgent = useCallback(
    async (name: string): Promise<AgentsActionResult> => {
      const res = await deleteFactoryAgent(name);
      if (!res.ok) return { ok: false, error: truncateError(res.error) };
      fullCacheRef.current.delete(name);
      setAgents((prev) => prev.filter((a) => a.name !== name));
      setSelectedName((prev) => (prev === name ? null : prev));
      await refreshAgents();
      return { ok: true };
    },
    [refreshAgents],
  );

  const loadMcp = useCallback(
    async (name: string): Promise<AgentsActionResult & { servers?: Record<string, unknown> }> => {
      const res = await getFactoryMcp(name);
      if (!res.ok) return { ok: false, error: truncateError(res.error) };
      return { ok: true, servers: res.data.servers };
    },
    [],
  );

  const addMcp = useCallback(
    async (name: string, servers: Record<string, unknown>): Promise<AgentsActionResult> => {
      const res = await createFactoryMcp(name, servers);
      if (!res.ok) return { ok: false, error: truncateError(res.error) };
      await refreshMcps();
      return { ok: true };
    },
    [refreshMcps],
  );

  const updateMcp = useCallback(
    async (name: string, servers: Record<string, unknown>): Promise<AgentsActionResult> => {
      const res = await saveFactoryMcp(name, servers);
      if (!res.ok) return { ok: false, error: truncateError(res.error) };
      await refreshMcps();
      return { ok: true };
    },
    [refreshMcps],
  );

  const removeMcp = useCallback(
    async (name: string): Promise<AgentsActionResult> => {
      const res = await deleteFactoryMcp(name);
      if (!res.ok) return { ok: false, error: truncateError(res.error) };
      await refreshMcps();
      return { ok: true };
    },
    [refreshMcps],
  );

  return {
    agents,
    agentsState,
    agentsError,
    refreshAgents,
    selectedName,
    selectAgent,
    full,
    fullState,
    fullError,
    reloadAgentFull,
    saveAgent,
    createAgent,
    deleteAgent,
    skills,
    skillsError,
    refreshSkills,
    mcps,
    mcpsError,
    refreshMcps,
    loadMcp,
    addMcp,
    updateMcp,
    removeMcp,
  };
}
