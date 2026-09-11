/**
 * API pública del workflow engine (Fase 0).
 */

export * from "./types";
export * from "./schema";
export * from "./errors";
export {
  defaultRunsDir,
  redactSecrets,
  RunArtifacts,
  writeJsonAtomic,
} from "./artifacts";
export { WorkflowRunStore } from "./runStore";
export type { CreateRunInput } from "./runStore";
export {
  defaultBundledWorkflowsDir,
  defaultGlobalWorkflowsDir,
  discoverWorkflows,
  listWorkflowSummaries,
  loadWorkflow,
  parseWorkflowDefinition,
  repoWorkflowsDir,
} from "./loader";
export type {
  DiscoveredWorkflow,
  DiscoverWorkflowOptions,
  LoadedWorkflowSource,
  WorkflowScope,
} from "./loader";
export { runWorkflow } from "./executor";
export type { LoadedWorkflow, RunWorkflowOptions } from "./executor";
export { buildLayers, evaluateTriggerRule, evaluateWhen, validateWorkflow } from "./graph";
export type { GraphEvalContext, TriggerDecision, WorkflowGraph } from "./graph";
export { resolveTemplate, resolveValue } from "./variables";
export type { VarContext } from "./variables";

import { loadWorkflow, type DiscoverWorkflowOptions } from "./loader";
import { runWorkflow, type RunWorkflowOptions } from "./executor";
import type { WorkflowRun } from "./types";

/** Carga un workflow por nombre y lo ejecuta. */
export async function runWorkflowByName(
  name: string,
  opts: DiscoverWorkflowOptions & RunWorkflowOptions,
): Promise<WorkflowRun> {
  const loaded = loadWorkflow(name, opts);
  return runWorkflow(loaded, opts);
}
