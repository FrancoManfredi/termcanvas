import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Issue } from "../types";
import type { ActivityAdapter } from "../adapters/types";
import { liveActivityAdapter } from "../adapters/liveActivity";
import { useIssueStore } from "../../../stores/issueStore";
import { useIssueReviewStore } from "../../../stores/issueReviewStore";
import { useIssueResolveStore } from "../../../stores/issueResolveStore";
import { useIssueGateStore } from "../../../stores/issueGateStore";
import { useIssueActivityStore } from "../../../stores/issueActivityStore";
import { useProjectStore } from "../../../stores/projectStore";
import { useIssueSyncStore } from "../../../stores/issueSyncStore";
import { useWorkItemStore } from "../../../stores/workItemStore";

export interface UseActivityResult {
  issues: Issue[];
  getIssue: (id: number) => Issue | undefined;
  refresh: () => void;
  /** Spinner source: canvas fetch flag (toolbar refresh binds to it). */
  isFetching: boolean;
}

/**
 * Perf Ola 2: mount-burst gate for the one-lookup-per-row effect.
 * Done rows never need fresh verdicts; rows with a settled cached PR keep
 * it (the explicit `refresh()` still forces everything). Only uncached
 * non-done rows force a lookup on mount — this cuts the N-lookup storm
 * down to the rows that actually lack data. Pure, offline-testable.
 * Never throws.
 */
export function shouldForcePrLookupOnMount(
  cached: unknown,
  status: unknown,
): boolean {
  try {
    if (status === "done") return false;
    return cached === undefined || cached === null;
  } catch {
    return false;
  }
}

/** Perf Ola B4: mount lookups go out in small batches (first paint fast,
 * no N-at-once IPC storm). Pure splitter for offline tests. Never throws. */
export const PR_LOOKUP_MOUNT_BATCH = 12;
export const PR_LOOKUP_MOUNT_GAP_MS = 150;

export function splitBatches<T>(items: readonly T[], size: number): T[][] {
  try {
    const n =
      typeof size === "number" && Number.isInteger(size) && size > 0
        ? size
        : PR_LOOKUP_MOUNT_BATCH;
    const list = Array.isArray(items) ? [...items] : [];
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
  } catch {
    return [];
  }
}

/**
 * Activity timeline state over an ActivityAdapter (Track B, T02).
 *
 * Defaults to the live canvas adapter; tests may inject a fake via the
 * `adapter` parameter (the mock adapter stays available solely as that test
 * double). The live adapter reads canvas stores via `getState()`, so this
 * hook subscribes to the minimal slices that feed derivation and recomputes
 * the snapshot when they change. Every selector returns a primitive or a
 * STABLE store ref — fresh arrays/objects are derived INSIDE `useMemo`,
 * never in selectors (the `IssueNode.tsx:82-99` pattern — a selector
 * returning `map[n] ?? []` would re-render forever). Rendering NEVER writes
 * a store (except handler-ref invocation on click and the local
 * `refreshTick`). Zero intervals of its own, zero fetch: the `workItems`
 * slice below is populated by factoryLab's `useWorkItemsPolling` (2.5s,
 * single owner) — this hook only re-reads it so rows with a live factory
 * job move to In Progress without any new polling.
 */
export function useActivity(
  adapter: ActivityAdapter = liveActivityAdapter,
): UseActivityResult {
  const issueVersion = useIssueStore((s) => s.issueVersion);
  const prsByIssue = useIssueReviewStore((s) => s.prsByIssue);
  const openPrsByIssue = useIssueReviewStore((s) => s.openPrsByIssue);
  const verdictByIssue = useIssueReviewStore((s) => s.verdictByIssue);
  const verdictByPr = useIssueReviewStore((s) => s.verdictByPr);
  const labelsByPr = useIssueReviewStore((s) => s.labelsByPr);
  const labelsByIssue = useIssueReviewStore((s) => s.labelsByIssue);
  const conflictByPr = useIssueReviewStore((s) => s.conflictByPr);
  const conflictByIssue = useIssueReviewStore((s) => s.conflictByIssue);
  const reviewingIssueNumber = useIssueReviewStore(
    (s) => s.reviewingIssueNumber,
  );
  const fixingIssueNumber = useIssueReviewStore((s) => s.fixingIssueNumber);
  const mergingIssueNumber = useIssueReviewStore((s) => s.mergingIssueNumber);
  const resolvingConflictIssueNumber = useIssueReviewStore(
    (s) => s.resolvingConflictIssueNumber,
  );
  const optimisticReadyByIssue = useIssueReviewStore((s) => s.optimisticReadyByIssue);
  const mergeProgress = useIssueReviewStore((s) => s.mergeProgress);
  const resolvingIssueNumber = useIssueResolveStore(
    (s) => s.resolvingIssueNumber,
  );
  const gateByPr = useIssueGateStore((s) => s.gateByPr);
  const activityByRepo = useIssueActivityStore((s) => s.activityByRepo);
  // Joined id:name string (primitive, referentially stable): recomputes the
  // snapshot on rename/add/remove without re-rendering on unrelated
  // project-store churn (terminal ticks).
  const projectNamesKey = useProjectStore((s) =>
    s.projects.map((p) => `${p.id}:${p.name}`).join("|"),
  );
  const isFetchingIssues = useIssueSyncStore((s) => s.isFetchingIssues);
  // Factory poll list (read-only reuse — the 2.5s interval is owned by
  // factoryLab's `useWorkItemsPolling`; subscribing here only recomputes
  // the snapshot when the shared list changes).
  const factoryJobs = useWorkItemStore((s) => s.workItems);
  const [refreshTick, setRefreshTick] = useState(0);

  const issues = useMemo<Issue[]>(
    () => adapter.listActivityIssues(),
    [
      adapter,
      issueVersion,
      prsByIssue,
      openPrsByIssue,
      verdictByIssue,
      verdictByPr,
      labelsByPr,
      labelsByIssue,
      conflictByPr,
      conflictByIssue,
      reviewingIssueNumber,
      fixingIssueNumber,
      mergingIssueNumber,
      resolvingConflictIssueNumber,
      mergeProgress,
      resolvingIssueNumber,
      gateByPr,
      optimisticReadyByIssue,
      activityByRepo,
      projectNamesKey,
      isFetchingIssues,
      factoryJobs,
      refreshTick,
    ],
  );

  const getIssue = useCallback(
    (id: number): Issue | undefined => adapter.getActivityIssue(id),
    [adapter],
  );

  // Manual path: force PR re-lookup for every visible issue (fresh
  // reviews/labels — a cached PR would otherwise freeze the row) + local
  // tick so the snapshot recomputes even before lookups land. No fetch, no
  // IPC here — `requestPrLookup` dedupes and delegates to the canvas-owned
  // lookup handler.
  const refresh = useCallback((): void => {
    const state = useIssueReviewStore.getState();
    for (const issue of issues) {
      state.requestPrLookup(
        issue.id,
        issue.worktreePath || undefined,
        true,
      );
    }
    setRefreshTick((tick) => tick + 1);
  }, [issues]);

  // Mount path: staggered PR lookups (perf Ola B4) — the first batch goes
  // out sync for a fast first paint, the rest follow in small time-sliced
  // batches instead of N-at-once (no IPC/GitHub storm on section switch).
  // Only uncached non-done rows look up (burst gate above); explicit
  // `refresh()` still forces everything. Timers die on unmount.
  const initialPrLookupRef = useRef(false);
  useEffect(() => {
    if (initialPrLookupRef.current) return;
    initialPrLookupRef.current = true;
    const timers: number[] = [];
    try {
      const state = useIssueReviewStore.getState();
      const pending = issues.filter((issue) => {
        try {
          return shouldForcePrLookupOnMount(
            state.prsByIssue[issue.id],
            issue.status,
          );
        } catch {
          return false;
        }
      });
      const batches = splitBatches(pending, PR_LOOKUP_MOUNT_BATCH);
      batches.forEach((batch, i) => {
        const run = (): void => {
          try {
            const live = useIssueReviewStore.getState();
            for (const issue of batch) {
              // Re-gate at run time: a tick may have settled it meanwhile.
              const cached = live.prsByIssue[issue.id];
              live.requestPrLookup(
                issue.id,
                issue.worktreePath || undefined,
                shouldForcePrLookupOnMount(cached, issue.status),
              );
            }
          } catch {
            // best-effort
          }
        };
        if (i === 0) run();
        else timers.push(window.setTimeout(run, i * PR_LOOKUP_MOUNT_GAP_MS));
      });
    } catch {
      // best-effort
    }
    return () => {
      for (const t of timers) {
        try {
          window.clearTimeout(t);
        } catch {
          // noop
        }
      }
    };
  }, [issues]);

  return { issues, getIssue, refresh, isFetching: isFetchingIssues };
}
