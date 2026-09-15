/**
 * Workflows canvas — data source seam.
 *
 * Single boundary between the canvas and its data. Today it serves the mock
 * catalog (mirroring the bundled workflows/agents); when the engine wiring
 * lands these functions swap to the daemon client —
 * `getFactoryWorkflows` / `getFactoryWorkflowDefinition` / `listFactoryAgents`
 * (`src/lib/factoryClient.ts`) — and no component changes.
 * `normalizeWorkflowDef` already accepts the daemon's `def` shape.
 */

import { MOCK_AGENTS, MOCK_WORKFLOW_DEFS } from "./mockWorkflows";
import type { AgentCatalogEntry, WorkflowDefinition } from "./types";

export function listWorkflowDefs(): WorkflowDefinition[] {
  return MOCK_WORKFLOW_DEFS;
}

export function getWorkflowDef(name: string): WorkflowDefinition | null {
  return MOCK_WORKFLOW_DEFS.find((definition) => definition.name === name) ?? null;
}

export function listAgents(): AgentCatalogEntry[] {
  return MOCK_AGENTS;
}
