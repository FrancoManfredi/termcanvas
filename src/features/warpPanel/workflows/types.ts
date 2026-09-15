/**
 * Workflows canvas — domain types (WarpPanel section).
 *
 * The canvas is a READ-ONLY view of the workflows that already exist: the
 * same declarative model the engine executes
 * (`factory/workflows/<name>/workflow.yaml`): nodes, `depends_on` edges,
 * approval gates, loop groups and fan-out. No editing, no run state.
 *
 * The mock layer mirrors the bundled YAMLs; the future live adapter reads the
 * daemon through `WorkflowDefinitionInfo.def` and reuses
 * `normalizeWorkflowDef` — components never touch the wire shape.
 */

export type WorkflowNodeKind =
  | "agent"
  | "approval"
  | "workflow"
  | "command"
  | "wait"
  | "bash"
  | "script"
  | "cancel"
  | "unknown";

export interface WorkflowInputDef {
  name: string;
  required: boolean;
  description?: string;
  /** Human-readable preview of the declared default (never invented). */
  defaultLabel?: string;
}

export interface WorkflowApprovalDef {
  message: string;
  captureResponse: boolean;
  maxAttempts: number;
  rejectPrompt?: string;
}

export interface WorkflowLoopDef {
  id: string;
  label: string;
  maxIterations: number;
  until: string;
  nodeIds: string[];
  /** Deps declared on the container: they feed the first child. */
  externalDeps: string[];
}

export interface WorkflowFanOutDef {
  items: string;
  as: string;
  maxParallel: number;
  join: string;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  dependsOn: string[];
  /** Loop group container id when the node lives inside one. */
  groupId?: string;
  agent?: string;
  command?: string;
  subWorkflow?: string;
  prompt?: string;
  outputType?: string;
  outputFormat?: Record<string, unknown>;
  approval?: WorkflowApprovalDef;
  fanOut?: WorkflowFanOutDef;
  wait?: { event: string };
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  tags: string[];
  scope: string;
  filePath: string;
  inputs: WorkflowInputDef[];
  returns?: string;
  outcomeField?: string;
  nodes: WorkflowNode[];
  groups: WorkflowLoopDef[];
}

export interface AgentCatalogEntry {
  name: string;
  description: string;
  agentType: string;
  model: string;
  tools: string[];
}

export interface WorkflowCanvasEdge {
  id: string;
  source: string;
  target: string;
  kind: "depends" | "loop";
  /** Loop condition (`until`) for loop-back edges. */
  label?: string;
}

export type CanvasSelection =
  | { type: "none" }
  | { type: "workflow" }
  | { type: "node"; id: string }
  | { type: "edge"; id: string };
