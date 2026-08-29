// Run domain - derived from WorkItemEvent per WarpFactories.md §2 (Run) + §10 (Factory Dashboard > Runs)
// SRP: only shapes, no behavior. Each WorkItemEvent IS a Run in static mode.

import type { Actor, WorkItemEvent, WorkItemSource, WorkItemStage } from "./workItem.types";

export interface Run {
  readonly id: string; // == WorkItemEvent.id
  readonly workItemId: string;
  readonly workItemTitle: string;
  readonly factoryName: string;
  readonly source: WorkItemSource;
  /** stage transition */
  readonly from: WorkItemStage;
  readonly to: WorkItemStage;
  readonly actor: Actor;
  readonly at: string; // ISO
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
  /** derived cost (estimate, USD) - static deterministic */
  readonly cost: number;
  /** duration mock (ms) between this run and previous, for timeline */
  readonly durationMs: number;
  /** orchestrator == foreman per §2: foreman despacha */
  readonly isOrchestrator: boolean;
  /** mock sub-agent runs if orchestrator */
  readonly childRuns: readonly Run[];
  /** original event ref */
  readonly event: WorkItemEvent;
}

export interface RunFilter {
  factoryName?: string;
  actor?: Actor;
  search?: string; // matches workItemTitle or actor or from->to
  workItemId?: string;
}

export interface RunCostBreakdown {
  total: number;
  perRun: { runId: string; cost: number }[];
}

export type RunTimelineEntry = Run;
