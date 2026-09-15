/**
 * React Flow view-model types for the workflow canvas (v12 generics).
 * Kept separate so domain types (`types.ts`) stay free of React Flow imports.
 */

import type { Edge, Node } from "@xyflow/react";
import type { WorkflowNode } from "./types";

export interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  subtitle: string;
  /** Phase accent (read-only view): color by workflow position. */
  color: string;
}

export interface LoopGroupData extends Record<string, unknown> {
  groupId: string;
  maxIterations: number;
  count: number;
}

export interface WorkflowEdgeData extends Record<string, unknown> {
  kind: "depends" | "loop";
}

export type WorkflowFlowNode = Node<WorkflowNodeData, "workflowNode">;
export type LoopGroupFlowNode = Node<LoopGroupData, "loopGroup">;
export type WorkflowFlowEdge = Edge<WorkflowEdgeData, "workflowEdge">;
export type CanvasFlowNode = WorkflowFlowNode | LoopGroupFlowNode;
