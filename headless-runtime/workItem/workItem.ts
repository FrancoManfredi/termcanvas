/**
 * WorkItem entity helpers — pure domain logic.
 * Re-exports shared types and adds factory helpers used by WorkItemStore.
 */

import path from "node:path";
import {
  type WorkItem,
  type WorkItemStatus,
  type WorkItemTimelineEntry,
  type ModelRef,
  canTransition,
  assertTransition,
  mapStatusToLegacyState,
  createWorkItemInput,
} from "../../shared/types/workItem";

export {
  type WorkItem,
  type WorkItemStatus,
  type WorkItemTimelineEntry,
  type ModelRef,
  canTransition,
  assertTransition,
  mapStatusToLegacyState,
  createWorkItemInput,
};

/**
 * Creates a WorkItem in Intake status.
 * Handles path.resolve for worktree and sets dir/dotDonePath.
 */
export function createWorkItem(params: {
  id: string;
  prompt: string;
  worktree: string;
  modelRef?: ModelRef;
  reviewerRef?: ModelRef;
  phase?: string;
  runnerId?: string;
}): WorkItem {
  const worktreeResolved = path.resolve(params.worktree);
  const dir = path.join(worktreeResolved, ".agents", "factory", params.id);
  const dotDonePath = path.join(dir, ".done");
  const base = createWorkItemInput({
    id: params.id,
    prompt: params.prompt,
    worktree: worktreeResolved,
    modelRef: params.modelRef,
    reviewerRef: params.reviewerRef,
    phase: params.phase,
    runnerId: params.runnerId,
    dir,
  });
  // Override dir/dotDonePath already set, ensure consistent
  return {
    ...base,
    dir,
    dotDonePath,
  };
}

/**
 * Appends a timeline entry and updates updatedAt.
 * Returns new WorkItem (immutable style) but caller should persist.
 */
export function transitionWorkItem(
  item: WorkItem,
  to: WorkItemStatus,
  actor: WorkItemTimelineEntry["actor"],
  message: string,
  meta?: Record<string, unknown>,
): WorkItem {
  assertTransition(item.status, to);
  const nowIso = new Date().toISOString();
  const entry: WorkItemTimelineEntry = {
    id: `${item.id}-t${item.timeline.length}`,
    from: item.status,
    to,
    at: nowIso,
    actor,
    message,
    ...(meta ? { meta } : {}),
  };
  const next: WorkItem = {
    ...item,
    status: to,
    updatedAt: nowIso,
    timeline: [...item.timeline, entry],
    state: mapStatusToLegacyState(to),
    dotDonePath: item.dir ? path.join(item.dir, ".done") : item.dotDonePath,
  };
  return next;
}

/**
 * Helper to map WorkItem -> ImplementInput for ImplementAgent.
 */
export function toImplementInput(item: WorkItem): import("../../shared/types/implement").ImplementInput {
  return {
    id: item.id,
    prompt: item.prompt,
    worktreePath: path.resolve(item.worktree),
    ...(item.modelRef ? { modelRef: item.modelRef } : {}),
  };
}

/**
 * Appends a non-transition timeline event (e.g., runner:prepared) without changing status.
 */
export function appendWorkItemEvent(
  item: WorkItem,
  actor: WorkItemTimelineEntry["actor"],
  message: string,
  meta?: Record<string, unknown>,
): WorkItem {
  const nowIso = new Date().toISOString();
  const entry: WorkItemTimelineEntry = {
    id: `${item.id}-t${item.timeline.length}`,
    from: item.status,
    to: item.status,
    at: nowIso,
    actor,
    message,
    ...(meta ? { meta } : {}),
  };
  return {
    ...item,
    updatedAt: nowIso,
    timeline: [...item.timeline, entry],
  };
}
