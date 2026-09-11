import { useCallback, useMemo, useState } from "react";
import type { KanbanIssue, KanbanStatus } from "../types";
import type { IssuesAdapter } from "../adapters/types";
import { liveIssuesAdapter } from "../adapters/liveIssues";
import { useIssueStore } from "../../../stores/issueStore";
import { useProjectStore } from "../../../stores/projectStore";
import { useIssueReviewStore } from "../../../stores/issueReviewStore";
import { useIssueResolveStore } from "../../../stores/issueResolveStore";
import { useIssueGateStore } from "../../../stores/issueGateStore";
import { useWorkItemStore } from "../../../stores/workItemStore";

export interface UseIssuesResult {
  issues: KanbanIssue[];
  openIssueId: number | null;
  openIssue: (id: number) => void;
  closeIssue: () => void;
  changeStatus: (id: number, status: KanbanStatus) => void;
}

/**
 * Kanban board state over an IssuesAdapter (Track A).
 * Defaults to the live canvas adapter; tests may inject a fake via the
 * `adapter` parameter (the mock adapter stays available for that purpose).
 *
 * Reactivity: the live adapter reads canvas stores via `getState()`, so this
 * hook subscribes to the minimal slices that feed derivation and recomputes
 * the snapshot when they change. Selectors return primitives or stable store
 * refs only (never freshly built objects), and rendering never writes to a
 * store, so there are no subscription loops.
 *
 * The `workItems` slice below is populated by the shared
 * `useWorkItemsPolling` 2.5s loop (owned by whichever shell is mounted) —
 * subscribing here only recomputes the snapshot when the shared list
 * changes, so cards with a live factory job move to In Progress with zero
 * new polls.
 */
export function useIssues(
  adapter: IssuesAdapter = liveIssuesAdapter,
): UseIssuesResult {
  const issueVersion = useIssueStore((s) => s.issueVersion);
  const prsByIssue = useIssueReviewStore((s) => s.prsByIssue);
  const verdictByIssue = useIssueReviewStore((s) => s.verdictByIssue);
  const reviewingIssueNumber = useIssueReviewStore(
    (s) => s.reviewingIssueNumber,
  );
  const fixingIssueNumber = useIssueReviewStore((s) => s.fixingIssueNumber);
  const mergingIssueNumber = useIssueReviewStore((s) => s.mergingIssueNumber);
  const resolvingConflictIssueNumber = useIssueReviewStore(
    (s) => s.resolvingConflictIssueNumber,
  );
  const mergeProgress = useIssueReviewStore((s) => s.mergeProgress);
  const resolvingIssueNumber = useIssueResolveStore(
    (s) => s.resolvingIssueNumber,
  );
  // Relation slices: the mapped `relations` / `timeline` / `prs` fields
  // derive from the node plus these per-PR maps, so the snapshot recomputes
  // when any of them lands (same stable-ref pattern as above).
  const openPrsByIssue = useIssueReviewStore((s) => s.openPrsByIssue);
  const verdictByPr = useIssueReviewStore((s) => s.verdictByPr);
  const labelsByPr = useIssueReviewStore((s) => s.labelsByPr);
  const labelsByIssue = useIssueReviewStore((s) => s.labelsByIssue);
  const conflictByPr = useIssueReviewStore((s) => s.conflictByPr);
  const gateByPr = useIssueGateStore((s) => s.gateByPr);
  // Project names feed the card/drawer header label via the adapter's
  // readProjectName. A joined id:name string (primitive, referentially
  // stable) recomputes the snapshot on rename/add/remove without
  // re-rendering on unrelated project-store churn (terminal ticks).
  const projectNamesKey = useProjectStore((s) =>
    s.projects.map((p) => `${p.id}:${p.name}`).join("|"),
  );
  // Factory poll list (read-only reuse — the 2.5s interval is owned by the
  // shared `useWorkItemsPolling` loop; subscribing here only recomputes
  // the snapshot when the shared list changes).
  const factoryJobs = useWorkItemStore((s) => s.workItems);
  // Bumps when a session-only override is recorded so the derived snapshot
  // recomputes even though no canvas store changed.
  const [overrideTick, setOverrideTick] = useState(0);

  const issues = useMemo<KanbanIssue[]>(
    () => adapter.listIssues(),
    [
      adapter,
      issueVersion,
      prsByIssue,
      verdictByIssue,
      reviewingIssueNumber,
      fixingIssueNumber,
      mergingIssueNumber,
      resolvingConflictIssueNumber,
      mergeProgress,
      resolvingIssueNumber,
      openPrsByIssue,
      verdictByPr,
      labelsByPr,
      labelsByIssue,
      conflictByPr,
      gateByPr,
      projectNamesKey,
      factoryJobs,
      overrideTick,
    ],
  );
  const [openIssueId, setOpenIssueId] = useState<number | null>(null);

  const openIssue = useCallback((id: number): void => {
    setOpenIssueId(id);
  }, []);

  const closeIssue = useCallback((): void => {
    setOpenIssueId(null);
  }, []);

  const changeStatus = useCallback(
    (id: number, status: KanbanStatus): void => {
      adapter.setIssueStatus(id, status);
      setOverrideTick((t) => t + 1);
    },
    [adapter],
  );

  return { issues, openIssueId, openIssue, closeIssue, changeStatus };
}
