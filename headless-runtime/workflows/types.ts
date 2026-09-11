/**
 * Workflow engine — tipos de estado, eventos y resultados.
 * Fase 0: DAG determinístico (bash/script/wait/cancel) con artefactos en disco.
 */

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type NodeStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export interface NodeState {
  id: string;
  status: NodeStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  /** Salida textual del nodo (stdout trimmed para determinísticos). */
  output?: string;
  /** Salida estructurada parseada cuando el nodo declaró output_format. */
  outputJson?: unknown;
  error?: string;
  /** Motivo por el que el nodo fue salteado por `when` o trigger_rule. */
  skipReason?: string;
  /** Sesión OpenCode del nodo, reutilizable por context: shared/resume. */
  sessionId?: string;
  costUsd?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface RunResult {
  /** Nodo declarado en `returns`. */
  node?: string;
  output?: string;
  outputJson?: unknown;
  /** Derivado de `outcome_field` sobre la salida estructurada del returns. */
  outcome?: "succeeded" | "failed" | null;
}

export interface WorkflowRun {
  id: string;
  workflow: string;
  description: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  inputs: Record<string, unknown>;
  args: string;
  nodes: Record<string, NodeState>;
  error?: string;
  result?: RunResult;
  /** Digest del YAML congelado al iniciar el run. */
  sourceDigest: string;
  /** Copia inmutable del workflow usada por este run. */
  sourcePath: string;
  artifactsDir: string;
}

export type WorkflowEventType =
  | "run_started"
  | "node_started"
  | "node_completed"
  | "node_failed"
  | "node_skipped"
  | "node_retry"
  | "run_completed"
  | "run_failed"
  | "run_cancelled";

export interface WorkflowEvent {
  ts: string;
  type: WorkflowEventType;
  runId: string;
  workflow: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}

export interface NodeExecutionResult {
  /** Salida textual que queda disponible como $<id>.output. */
  output: string;
  /** Salida estructurada opcional. */
  outputJson?: unknown;
  /** Sesión OpenCode asociada (nodos IA). */
  sessionId?: string;
  /** Uso real reportado por el servidor (nodos IA). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  costUsd?: number;
}

export const TERMINAL_NODE_STATUSES: NodeStatus[] = [
  "completed",
  "failed",
  "skipped",
  "cancelled",
];
