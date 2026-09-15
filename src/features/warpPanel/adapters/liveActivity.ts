import type { Issue } from "../types";
import type { ActivityAdapter } from "./types";
import type { IssueNodeData } from "../../../stores/issueStore";
import type { IssueActivityEntry } from "../../../stores/issueActivityStore";
import { useIssueStore } from "../../../stores/issueStore";
import { useProjectStore } from "../../../stores/projectStore";
import { useIssueReviewStore } from "../../../stores/issueReviewStore";
import { useIssueResolveStore } from "../../../stores/issueResolveStore";
import { useIssueGateStore } from "../../../stores/issueGateStore";
import { useIssueActivityStore } from "../../../stores/issueActivityStore";
import { useWorkItemStore } from "../../../stores/workItemStore";
import {
  describeFactoryJobForPanel,
  parseGitHubIssueRepo,
  readFactoryJobHumanNeed,
} from "./factoryIssueJobs";
import {
  findActiveFactoryJobForIssueIndexed,
  findCompletedFactoryJobForIssueIndexed,
  findRerunnableFactoryJobForIssueIndexed,
  getFactoryJobIndex,
  isFactoryJobStalled,
  readJobTimestampMs,
} from "./factoryJobIndex";
import type {
  LiveLinkedPr,
  LiveReviewSnapshot,
} from "./liveIssues";
import {
  deriveActivityStatus,
  mapIssueNodeToActivity,
  type ActivityLiveContext,
} from "./activityDerivation";
import { activityLog } from "../activityDebug";

/**
 * Live activity adapter — canvas stores are the ONLY data source.
 *
 * - No GitHub fetch here: the canvas already hydrates `useIssueStore` via
 *   fetchIssues, so this adapter is a thin read over in-memory state.
 * - No writes anywhere: rendering never writes a store (handler-ref
 *   invocation on click lives in `components/activityActions.ts`).
 * - `done` is NEVER invented: it requires real merge evidence (a linked PR
 *   whose GitHub state is MERGED, a bulk-merge run that reported the PR as
 *   merged, or a CLOSED node state). Anything else stays out of Done.
 * - `listActivityIssues` returns rows sorted by issue number, descending
 *   (newest first — same precedent as `liveIssues.ts`).
 *
 * The review-snapshot builder below re-implements the read shape of
 * `liveIssues.ts:128-185` (no builder is exported, and refactoring
 * `liveIssues.ts` is out of scope): primary linked PRs (`"loading"`
 * normalized away), bulk-merge `mergedPrNumbers`, open PRs, per-PR
 * verdicts/labels/conflicts, and the cheap gate slice (status + report
 * path only). Types are imported, never re-declared. On top of that shape
 * it captures `headRefByIssue` from the same `getState()` call so branch
 * derivation stays honest (`headRefName` when known, else the
 * `issue-{n}` resolving fallback, else absent).
 */

/** Store readers. Default = live zustand `getState()`; tests inject fakes. */
export interface LiveActivityDeps {
  readIssues: () => IssueNodeData[];
  readReview: () => LiveReviewSnapshot & ActivityLiveContext;
  readResolvingIssueNumber: () => number | null;
  /**
   * Human project name for a canvas project id. Default reads the project
   * store (`ProjectData.name`); absent/unknown ids yield undefined (never
   * invented). Accepted per contract; the Figma `Issue` shape carries no
   * project slot.
   */
  readProjectName: (projectId: string) => string | undefined;
  /** Local activity map by repo path (source for `phaseStarted`). */
  readActivityByRepo: () => Record<string, Record<number, IssueActivityEntry[]>>;
  /**
   * Existing factory poll list for the resolve derivation (matched by
   * `issueRef`, repo-scoped per node URL). Default reads the
   * `useWorkItemStore` items populated by factoryLab's `useWorkItemsPolling`
   * (2.5s, single owner) — this adapter owns zero intervals. Empty when
   * the poll never ran: rows simply show no factory work (honest, never
   * invented).
   */
  readFactoryJobs: () => unknown[];
  /**
   * Pending daemon notifications for the H4 human-gate fallback (a pending
   * `ask_human` notification linked by `workItemId` marks the row
   * awaiting when no structured signal is legible). Default is empty —
   * NO poll owns this list inside the panel (zero new intervals by
   * convention), so the fallback stays dormant until a caller threads a
   * real list through; H1–H3 carry the panel from the poll list alone.
   */
  readNotifications: () => unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeRead<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * Live factory job linked to the issue (repo-scoped `issueRef` match
 * against the existing poll list — the SAME shared helper the Kanban
 * adapter uses, never duplicated). Null when none. Never throws.
 */
function activeFactoryJobForIssue(
  factoryJobs: unknown[] | Map<number, unknown[]>,
  issueNumber: number,
  nodeUrl: string | null,
): unknown | null {
  try {
    // Indexed path (B3): the snapshot builds ONE map per tick; single-issue
    // lookups keep the linear helper via a one-bucket equivalent below.
    if (factoryJobs instanceof Map) {
      return findActiveFactoryJobForIssueIndexed(
        factoryJobs,
        issueNumber,
        nodeUrl !== null ? parseGitHubIssueRepo(nodeUrl) : null,
      );
    }
    // Ola B3: shared memoized index (one build per payload across adapters).
    const index = getFactoryJobIndex(factoryJobs);
    return findActiveFactoryJobForIssueIndexed(
      index,
      issueNumber,
      nodeUrl !== null ? parseGitHubIssueRepo(nodeUrl) : null,
    );
  } catch {
    return null;
  }
}

const EMPTY_REVIEW: LiveReviewSnapshot & ActivityLiveContext = {
  primaryPrByIssue: {},
  verdictByIssue: {},
  reviewingIssueNumber: null,
  fixingIssueNumber: null,
  mergingIssueNumber: null,
  resolvingConflictIssueNumber: null,
  mergedPrNumbers: [],
  headRefByIssue: {},
};

function defaultDeps(): LiveActivityDeps {
  return {
    readIssues: () => useIssueStore.getState().getAllIssues(),
    readReview: () => {
      // Row-isolation hardening (review→awaiting audit): every store slice
      // below arrives from async lookups / persisted hydration and may be
      // undefined or wrong-type at the exact transition tick. Each slice
      // degrades to honest-empty here (parity with the hardened
      // `liveIssues.ts` reader). In particular a wrong-type
      // `openPrsByIssue[n]` entry must never reach `.map` (a throw there
      // used to reset the panel). Never throws.
      const s = (() => {
        try {
          return useIssueReviewStore.getState();
        } catch {
          return null;
        }
      })() as unknown as Record<string, unknown> | null;
      const asPlainRecord = (value: unknown): Record<string, unknown> => {
        try {
          if (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
          ) {
            return value as Record<string, unknown>;
          }
        } catch {
          // Fall through to honest-empty.
        }
        return {};
      };
      const sRec = s !== null && typeof s === "object" ? s : {};
      const primaryPrByIssue: Record<number, LiveLinkedPr | null> = {};
      try {
        for (const [key, value] of Object.entries(
          asPlainRecord(sRec.prsByIssue),
        )) {
          try {
            if (value === null || value === "loading") continue;
            if (
              value === null ||
              typeof value !== "object" ||
              Array.isArray(value)
            ) {
              continue;
            }
            const rec = value as Record<string, unknown>;
            if (
              typeof rec.number !== "number" ||
              !Number.isFinite(rec.number)
            ) {
              continue;
            }
            primaryPrByIssue[Number(key)] = {
              number: rec.number as number,
              title: typeof rec.title === "string" ? rec.title : "",
              url: typeof rec.url === "string" ? rec.url : "",
              state: typeof rec.state === "string" ? rec.state : "",
            };
          } catch {
            // One poisoned PR entry never breaks the snapshot.
          }
        }
      } catch {
        // Degrades to no primary PRs (honest-empty).
      }
      const mergedPrNumbers: number[] = [];
      try {
        const progress = (sRec as Record<string, unknown>).mergeProgress;
        if (
          progress !== null &&
          typeof progress === "object" &&
          !Array.isArray(progress)
        ) {
          const statusByPr = (progress as Record<string, unknown>).statusByPr;
          if (
            statusByPr !== null &&
            typeof statusByPr === "object" &&
            !Array.isArray(statusByPr)
          ) {
            for (const [pr, prStatus] of Object.entries(
              statusByPr as Record<string, unknown>,
            )) {
              if (prStatus === "merged") mergedPrNumbers.push(Number(pr));
            }
          }
        }
      } catch {
        // Degrades to no merged numbers (honest-empty).
      }
      const openPrsByIssue: Record<number, LiveLinkedPr[]> = {};
      try {
        for (const [key, prs] of Object.entries(
          asPlainRecord(sRec.openPrsByIssue),
        )) {
          try {
            if (!Array.isArray(prs)) {
              openPrsByIssue[Number(key)] = [];
              continue;
            }
            openPrsByIssue[Number(key)] = (
              prs as unknown[]
            ).flatMap((pr) => {
              try {
                if (
                  pr === null ||
                  typeof pr !== "object" ||
                  Array.isArray(pr)
                ) {
                  return [];
                }
                const rec = pr as Record<string, unknown>;
                if (
                  typeof rec.number !== "number" ||
                  !Number.isFinite(rec.number)
                ) {
                  return [];
                }
                return [
                  {
                    number: rec.number as number,
                    title: typeof rec.title === "string" ? rec.title : "",
                    url: typeof rec.url === "string" ? rec.url : "",
                    state: typeof rec.state === "string" ? rec.state : "",
                  },
                ];
              } catch {
                return [];
              }
            });
          } catch {
            openPrsByIssue[Number(key)] = [];
          }
        }
      } catch {
        // Degrades to no open PRs (honest-empty).
      }
      const gateByPr: Record<
        number,
        Record<number, { status: string; reportPath: string | null }>
      > = {};
      try {
        let gateRoot: unknown = {};
        try {
          gateRoot = useIssueGateStore.getState().gateByPr ?? {};
        } catch {
          gateRoot = {};
        }
        for (const [issueKey, byPr] of Object.entries(
          asPlainRecord(gateRoot),
        )) {
          const inner: Record<number, { status: string; reportPath: string | null }> =
            {};
          try {
            if (
              byPr === null ||
              typeof byPr !== "object" ||
              Array.isArray(byPr)
            ) {
              gateByPr[Number(issueKey)] = inner;
              continue;
            }
            for (const [prKey, gate] of Object.entries(
              byPr as Record<string, unknown>,
            )) {
              try {
                if (
                  gate === null ||
                  typeof gate !== "object" ||
                  Array.isArray(gate)
                ) {
                  continue;
                }
                const grec = gate as Record<string, unknown>;
                inner[Number(prKey)] = {
                  status:
                    typeof grec.status === "string" ? grec.status : "idle",
                  reportPath:
                    typeof grec.reportPath === "string"
                      ? grec.reportPath
                      : null,
                };
              } catch {
                // One poisoned gate entry never breaks the row.
              }
            }
          } catch {
            // Degrades to no gates for this issue.
          }
          gateByPr[Number(issueKey)] = inner;
        }
      } catch {
        // Degrades to no gates (honest-empty).
      }
      // Branch source: first open PR head ref wins, else the primary PR
      // head ref. Same `getState()` call, no extra subscription.
      const headRefByIssue: Record<number, string> = {};
      try {
        for (const [key, prs] of Object.entries(
          asPlainRecord(sRec.openPrsByIssue),
        )) {
          try {
            if (!Array.isArray(prs)) continue;
            const first = (prs as unknown[]).find(
              (pr) =>
                pr !== null &&
                typeof pr === "object" &&
                !Array.isArray(pr) &&
                typeof (pr as Record<string, unknown>).headRefName ===
                  "string" &&
                ((pr as Record<string, unknown>).headRefName as string) !== "",
            ) as Record<string, unknown> | undefined;
            if (first) {
              headRefByIssue[Number(key)] = first.headRefName as string;
            }
          } catch {
            // One poisoned entry never breaks the map.
          }
        }
      } catch {
        // Degrades to no head refs (honest-empty).
      }
      try {
        for (const [key, value] of Object.entries(
          asPlainRecord(sRec.prsByIssue),
        )) {
          try {
            const n = Number(key);
            if (
              headRefByIssue[n] === undefined &&
              value !== null &&
              value !== "loading" &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              typeof (value as Record<string, unknown>).headRefName ===
                "string" &&
              ((value as Record<string, unknown>).headRefName as string) !== ""
            ) {
              headRefByIssue[n] = (value as Record<string, unknown>)
                .headRefName as string;
            }
          } catch {
            // One poisoned entry never breaks the map.
          }
        }
      } catch {
        // Degrades to no head refs (honest-empty).
      }
      const safeRecord = (value: unknown): Record<string, unknown> => {
        try {
          if (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
          ) {
            return { ...(value as Record<string, unknown>) };
          }
        } catch {
          // Fall through to honest-empty.
        }
        return {};
      };
      const safeNumOrNull = (value: unknown): number | null => {
        try {
          return typeof value === "number" &&
            Number.isInteger(value) &&
            (value as number) > 0
            ? (value as number)
            : null;
        } catch {
          return null;
        }
      };
      return {
        primaryPrByIssue,
        verdictByIssue: safeRecord(sRec.verdictByIssue) as unknown as LiveReviewSnapshot["verdictByIssue"],
        reviewingIssueNumber: safeNumOrNull(sRec.reviewingIssueNumber),
        fixingIssueNumber: safeNumOrNull(sRec.fixingIssueNumber),
        mergingIssueNumber: safeNumOrNull(sRec.mergingIssueNumber),
        resolvingConflictIssueNumber: safeNumOrNull(
          sRec.resolvingConflictIssueNumber,
        ),
        mergedPrNumbers,
        openPrsByIssue,
        verdictByPr: safeRecord(sRec.verdictByPr) as unknown as LiveReviewSnapshot["verdictByPr"],
        labelsByPr: safeRecord(sRec.labelsByPr) as unknown as LiveReviewSnapshot["labelsByPr"],
        labelsByIssue: safeRecord(sRec.labelsByIssue) as unknown as LiveReviewSnapshot["labelsByIssue"],
        conflictByPr: safeRecord(sRec.conflictByPr) as unknown as LiveReviewSnapshot["conflictByPr"],
        gateByPr,
        headRefByIssue,
      };
    },
    readResolvingIssueNumber: () =>
      useIssueResolveStore.getState().resolvingIssueNumber,
    readProjectName: (projectId: string) =>
      useProjectStore.getState().projects.find((p) => p.id === projectId)
        ?.name,
    readActivityByRepo: () =>
      useIssueActivityStore.getState().activityByRepo ?? {},
    readFactoryJobs: () => {
      try {
        const items = useWorkItemStore.getState().workItems;
        return Array.isArray(items) ? items : [];
      } catch {
        return [];
      }
    },
    readNotifications: () => [],
  };
}

export class LiveActivityAdapter implements ActivityAdapter {
  private readonly deps: LiveActivityDeps;

  constructor(deps?: Partial<LiveActivityDeps>) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  private snapshot(): Issue[] {
    const nodes = safeRead<IssueNodeData[]>(
      () => this.deps.readIssues(),
      [],
    );
    if (!Array.isArray(nodes)) return [];
    const rawReview = safeRead<
      (LiveReviewSnapshot & ActivityLiveContext) | undefined
    >(() => this.deps.readReview(), undefined);
    const baseReview: LiveReviewSnapshot = isRecord(rawReview)
      ? (rawReview as LiveReviewSnapshot)
      : EMPTY_REVIEW;
    const resolving = safeRead<number | null>(
      () => this.deps.readResolvingIssueNumber(),
      null,
    );
    const activityByRepo = safeRead<
      Record<string, Record<number, IssueActivityEntry[]>>
    >(() => this.deps.readActivityByRepo(), {});
    const factoryJobs = safeRead<unknown[]>(
      () => this.deps.readFactoryJobs(),
      [],
    );
    const pendingNotifications = safeRead<unknown[]>(
      () => this.deps.readNotifications(),
      [],
    );
    activityLog("liveActivity.snapshot() input", {
      nodes: nodes.length,
      factoryJobs: Array.isArray(factoryJobs) ? factoryJobs.length : 0,
      pendingNotifications: Array.isArray(pendingNotifications)
        ? pendingNotifications.length
        : 0,
      activityRepos:
        activityByRepo && typeof activityByRepo === "object"
          ? Object.keys(activityByRepo).length
          : 0,
      resolving,
      reviewLabels: Object.keys(
        (baseReview as { labelsByIssue?: Record<string, unknown> })
          .labelsByIssue ?? {},
      ).length,
      prsByIssue: Object.keys(
        (baseReview as { prsByIssue?: Record<string, unknown> })
          .prsByIssue ?? {},
      ).length,
    });
    // B3: ONE index per snapshot — every row below resolves against this
    // map (O(jobs) once) instead of rescanning the whole poll list per
    // issue (O(issues x jobs) per tick).
    // Ola B3: shared memoized index (one build per payload across adapters).
    const factoryIndex = getFactoryJobIndex(factoryJobs);
    // Single clock for the snapshot's freshness reads (B4/B5) so all rows
    // agree about "now" within one tick.
    const snapshotNowMs = Date.now();
    const headRefRaw = (baseReview as Partial<ActivityLiveContext>)
      .headRefByIssue;
    const review: LiveReviewSnapshot & ActivityLiveContext = {
      ...baseReview,
      resolvingIssueNumber:
        typeof resolving === "number" ? resolving : null,
      headRefByIssue: isRecord(headRefRaw)
        ? (headRefRaw as Record<number, string | null>)
        : {},
    };

    const issues: Issue[] = [];
    for (const node of nodes) {
      try {
        // Drop malformed rows: non-object nodes and nodes without a valid
        // positive-integer issueNumber (legacy persisted / bad-hydrate
        // data). The adapter never throws.
        if (!isRecord(node)) continue;
        const record = node as unknown as Record<string, unknown>;
        const issueNumber = record.issueNumber;
        if (
          typeof issueNumber !== "number" ||
          !Number.isInteger(issueNumber) ||
          issueNumber <= 0
        ) {
          continue;
        }
        // Single shared match per node: drives the in-progress derivation,
        // the human-gate derivation, AND the live stage/session attached
        // below, so status and progress can never disagree about which job
        // they describe.
        const nodeRepo =
          typeof record.url === "string"
            ? parseGitHubIssueRepo(record.url)
            : null;
        const factoryJob = activeFactoryJobForIssue(
          factoryIndex,
          issueNumber,
          typeof record.url === "string" ? record.url : null,
        );
        // H0c link (incidente #125): a dead run (`engineRun` failed/cancelled)
        // is NOT active, so the active finder skips it — yet it still needs
        // the human (Re-run). Resolve it against the SAME index so the row
        // stops reading "pending" as if nothing had happened.
        let rerunnableJob: unknown | null = null;
        if (factoryJob === null) {
          try {
            rerunnableJob = findRerunnableFactoryJobForIssueIndexed(
              factoryIndex,
              issueNumber,
              nodeRepo,
            );
          } catch {
            rerunnableJob = null;
          }
        }
        const linkedJob: unknown | null = factoryJob ?? rerunnableJob;
        // Human gate for the SAME linked job (spec approval / triage answers
        // / ask_human / dead-run Re-run — read from the poll-list item, H4
        // fallback from the threaded notifications). A waiting or dead job
        // maps to awaiting/YOUR TURN (rows F-A) instead of generic
        // implementing or a dead-end pending.
        let factoryAwaitingKind: string | null = null;
        let factoryAwaiting: Issue["factoryAwaiting"] = undefined;
        try {
          if (linkedJob !== null) {
            const need = readFactoryJobHumanNeed(
              linkedJob,
              pendingNotifications,
            );
            if (need !== null) {
              factoryAwaitingKind = need.kind;
              factoryAwaiting = {
                kind: need.kind,
                jobId: need.jobId,
                ...(typeof need.specSummary === "string"
                  ? { specSummary: need.specSummary }
                  : {}),
                ...(Array.isArray(need.questions)
                  ? { questions: need.questions.slice() }
                  : {}),
                ...(typeof need.reviewSummary === "string"
                  ? { reviewSummary: need.reviewSummary }
                  : {}),
                ...(need.reviewInfraError === true
                  ? { reviewInfraError: true as const }
                  : {}),
              };
            }
          }
        } catch {
          // enrichment never breaks the row
        }
        // Terminal Complete job linked to the same issue (row D2 → done
        // when nothing stronger claimed the row — explicit user order).
        // Resolved against the SAME per-snapshot index; `Cancelled` never
        // matches. Never throws; absent = no completion evidence. The job
        // object is kept so Ready to Merge rows can still show their
        // worktree (delete), sessions and PR link — the detail gates those
        // surfaces on `status === "ready"`.
        let factoryCompleted = false;
        let factoryCompletedJob: unknown | null = null;
        try {
          factoryCompletedJob = findCompletedFactoryJobForIssueIndexed(
            factoryIndex,
            issueNumber,
            nodeRepo,
          );
          factoryCompleted = factoryCompletedJob !== null;
        } catch {
          factoryCompleted = false;
          factoryCompletedJob = null;
        }
        // Optimistic Ready (issue #69): fresh flag set when the factory
        // marked Complete / opened the PR, before GitHub lookup lands.
        // TTL-guarded; expired or absent reads as no signal (pending).
        let optimisticReady = false;
        try {
          const optMap = useIssueReviewStore.getState().optimisticReadyByIssue as
            | Record<number, number>
            | undefined;
          const at = optMap?.[issueNumber];
          if (typeof at === "number" && Number.isFinite(at) && at > 0) {
            optimisticReady = Date.now() - at < 5 * 60 * 1000;
          }
        } catch {
          optimisticReady = false;
        }
        // Merge confirmado por el daemon (close-out externo vía `gh pr view`
        // + `isolation.state="pr-merged"`): evidencia real de done aunque la
        // lookup de GitHub del renderer todavía no haya corrido.
        let factoryPrMerged = false;
        try {
          const iso = (
            factoryCompletedJob as
              | { isolation?: { state?: unknown } }
              | null
          )?.isolation;
          factoryPrMerged =
            iso !== null &&
            typeof iso === "object" &&
            (iso as { state?: unknown }).state === "pr-merged";
        } catch {
          factoryPrMerged = false;
        }
        const derived = deriveActivityStatus(
          issueNumber,
          review,
          review.resolvingIssueNumber ?? null,
          typeof record.state === "string" ? record.state : null,
          factoryJob !== null,
          factoryAwaitingKind,
          factoryCompleted,
          optimisticReady,
          linkedJob !== null,
          factoryPrMerged,
        );
        const rawProjectId =
          typeof record.projectId === "string" ? record.projectId : "";
        let projectName: string | undefined;
        try {
          const resolved =
            rawProjectId !== ""
              ? this.deps.readProjectName(rawProjectId)
              : undefined;
          projectName =
            typeof resolved === "string" && resolved.trim() !== ""
              ? resolved.trim()
              : undefined;
        } catch {
          projectName = undefined;
        }
        const worktreePath =
          typeof record.__worktreePath === "string" &&
          record.__worktreePath !== ""
            ? record.__worktreePath
            : undefined;
        const rawEntries =
          worktreePath !== undefined
            ? activityByRepo[worktreePath]?.[issueNumber]
            : undefined;
        const entries = Array.isArray(rawEntries)
          ? (rawEntries as IssueActivityEntry[])
          : undefined;
        const mapped = mapIssueNodeToActivity(
          node as unknown as IssueNodeData,
          derived,
          review,
          projectName,
          entries,
        );
        // Live Warp cycle stage + session link for the SAME linked job
        // (verbatim daemon status + daemon-built dashboardUrl; absent when
        // the job shape is unknown — the row keeps the generic phase).
        // H0c: a dead-run job (not active) also attaches its panel info so
        // the detail keeps the engineRun/stepper/sessions evidence that
        // explains the failure instead of a bare Re-run row.
        // When no active/rerunnable job is linked but a terminal Complete
        // job is, its panel info is attached instead so Ready to Merge rows
        // keep their worktree (explicit delete), phase sessions and PR link.
        // The in-progress timeline stays gated on active jobs in the detail.
        try {
          const infoJob = factoryJob ?? rerunnableJob;
          if (infoJob !== null) {
            const panelInfo = describeFactoryJobForPanel(infoJob);
            if (panelInfo !== null) {
              // B4/B5 freshness (additive, honest-empty when unknown —
              // never invented, never a fabricated lane).
              const createdAtMs = readJobTimestampMs(infoJob, "createdAt");
              if (createdAtMs !== null) panelInfo.createdAtMs = createdAtMs;
              const updatedAtMs = readJobTimestampMs(infoJob, "updatedAt");
              if (updatedAtMs !== null) panelInfo.updatedAtMs = updatedAtMs;
              if (isFactoryJobStalled(infoJob, snapshotNowMs)) {
                panelInfo.stalled = true;
              }
              mapped.factory = panelInfo;
            }
          } else if (factoryCompletedJob !== null) {
            const completedInfo =
              describeFactoryJobForPanel(factoryCompletedJob);
            if (completedInfo !== null) {
              const createdAtMs = readJobTimestampMs(
                factoryCompletedJob,
                "createdAt",
              );
              if (createdAtMs !== null)
                completedInfo.createdAtMs = createdAtMs;
              const updatedAtMs = readJobTimestampMs(
                factoryCompletedJob,
                "updatedAt",
              );
              if (updatedAtMs !== null)
                completedInfo.updatedAtMs = updatedAtMs;
              mapped.factory = completedInfo;
            }
          }
          if (factoryAwaiting !== undefined) {
            mapped.factoryAwaiting = factoryAwaiting;
          }
        } catch {
          // enrichment never breaks the row
        }
        issues.push(mapped);
      } catch {
        // Malformed node dropped — the adapter never throws.
        continue;
      }
    }
    // Newest issues first (descending by issue number).
    issues.sort((a, b) => b.id - a.id);
    try {
      const counts: Record<string, number> = {};
      for (const issue of issues) {
        counts[issue.status] = (counts[issue.status] ?? 0) + 1;
      }
      activityLog("liveActivity.snapshot() output", {
        total: issues.length,
        counts,
        first: issues.slice(0, 6).map((issue) => ({
          id: issue.id,
          status: issue.status,
          phase: issue.phase,
          awaiting: issue.awaitingAction ?? null,
          factoryStage: issue.factory?.stage ?? null,
          title: issue.title.slice(0, 48),
        })),
      });
    } catch {
      // el log nunca rompe el snapshot
    }
    return issues;
  }

  listActivityIssues(): Issue[] {
    const issues = this.snapshot();
    activityLog("adapter.listActivityIssues()", {
      total: issues.length,
      counts: (() => {
        const counts: Record<string, number> = {};
        for (const issue of issues) {
          counts[issue.status] = (counts[issue.status] ?? 0) + 1;
        }
        return counts;
      })(),
    });
    return issues;
  }

  getActivityIssue(id: number): Issue | undefined {
    const found = this.snapshot().find((issue) => issue.id === id);
    activityLog("adapter.getActivityIssue()", {
      id,
      found: found !== undefined,
      status: found?.status ?? null,
    });
    return found;
  }
}

/** Shared live singleton — the default `ActivityAdapter` for `useActivity`. */
export const liveActivityAdapter: ActivityAdapter = new LiveActivityAdapter();
