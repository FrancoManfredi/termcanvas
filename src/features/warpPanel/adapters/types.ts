import type {
  KanbanIssue,
  KanbanStatus,
  Issue,
  Agent,
  AgentConfigData,
} from "../types";

/**
 * Adapter contracts — the only seam the wiring phase will touch.
 * Components are forbidden from importing `adapters/*`; only `hooks/use*.ts` may.
 */

/** Kanban board (Track A). Backs KanbanBoard + IssueDrawer. */
export interface IssuesAdapter {
  /** Full board snapshot (mock: verbatim KANBAN_ISSUES). */
  listIssues(): KanbanIssue[];
  getIssue(id: number): KanbanIssue | undefined;
  /** Local status mutation (mock: in-memory; real: gh/issue-store + refetch). */
  setIssueStatus(id: number, status: KanbanStatus): KanbanIssue[];
}

/** Activity timeline (Track B). Backs ActivityPanel. */
export interface ActivityAdapter {
  /**
   * LIVE: synchronous read over canvas stores
   * (useIssueStore + useIssueReviewStore + useIssueResolveStore +
   *  useIssueGateStore + useIssueActivityStore + useProjectStore).
   * The canvas hydrates useIssueStore via fetchIssues; this adapter NEVER
   * fetches, NEVER writes, NEVER throws (malformed nodes are dropped,
   * unknown fields stay honest-empty).
   */
  listActivityIssues(): Issue[];
  getActivityIssue(id: number): Issue | undefined;
}

/** Agents + per-agent configuration (Track B). Backs AgentsPanel + AgentConfig. */
export interface AgentsAdapter {
  listSubAgents(): Agent[];
  getForeman(): Agent;
  getConfig(agentId: string): AgentConfigData | undefined;
  /** Local draft save (mock: in-memory; real: persist + daemon call). */
  saveConfig(agentId: string, patch: Partial<AgentConfigData>): AgentConfigData;
}
