import { create } from "zustand";
import type { MergeProgressEvent, MergePhase } from "../types";

// Shape of the PR linked to an issue, as returned by the
// `github:find-pr-for-issue` IPC (GitHub GraphQL `development.pulls`).
export interface LinkedPr {
  number: number;
  title: string;
  url: string;
  state: string;
  headRefName: string;
  headRefOid: string;
}

// Per-issue lookup state: "loading" while the async lookup runs, null when
// the issue has no linked PR, otherwise the PR record itself.
type PrStatus = LinkedPr | "loading" | null;

// Extract the reviewable PR from an issue card's raw GitHub data. Prefers an
// OPEN PR over a merged/closed one, falling back to the first node. Returns
// null when the native `closedByPullRequestsReferences` field (the data
// backing GitHub's "Development" panel) is absent or empty.
export function pickLinkedPrFromIssueData(
  raw: Record<string, unknown> | undefined,
): LinkedPr | null {
  const field = raw?.closedByPullRequestsReferences as
    | { nodes?: Array<Record<string, unknown>> }
    | undefined;
  const nodes = field?.nodes;
  if (!nodes || nodes.length === 0) return null;
  const chosen = nodes.find((n) => n.state === "OPEN") ?? nodes[0];
  return {
    number: Number(chosen.number),
    title: String(chosen.title ?? ""),
    url: String(chosen.url ?? ""),
    state: String(chosen.state ?? "OPEN"),
    headRefName: String(chosen.headRefName ?? ""),
    headRefOid: String(chosen.headRefOid ?? ""),
  };
}

// Result of the aggregated review on a PR, as reported by GitHub's
// reviewDecision. Persisted right before the review terminal removes its
// worktree so the issue card can show whether the reviewer approved or
// requested changes. "COMMENTED" is derived: a human review that only left
// comments leaves reviewDecision empty, but the PR was still reviewed.
// "FIX_APPLIED" is client-side only: set when the implementer launches the
// fix flow for a review that asked for changes, until the next review
// re-reads GitHub's authoritative decision.
export type ReviewVerdict =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED"
  | "COMMENTED"
  | "FIX_APPLIED";

// A review opens the fix flow only when it actually asked for changes:
// inline comments without a verdict (COMMENTED) or an explicit
// request-changes review. Approved or never-reviewed PRs get no fix button.
export function isFixableVerdict(
  verdict: ReviewVerdict | null | undefined,
): boolean {
  return verdict === "COMMENTED" || verdict === "CHANGES_REQUESTED";
}

// Per-PR state backing the merge progress panel. The bulk merge runs in the
// main process; each PR moves pending → working → merged|conflicted|error.
export type MergePrStatus =
  | "pending"
  | "working"
  | "merged"
  | "conflicted"
  | "error";

export interface MergeProgressState {
  prNumbers: number[];
  statusByPr: Record<number, MergePrStatus>;
  log: Array<{ prNumber: number | null; message: string }>;
  finished: boolean;
  error: string | null;
}

// Human-readable Spanish labels for the phases streamed by the main process.
// Phases are emitted as stable keys, not free text, so the UI language never
// leaks into the main process.
const MERGE_PHASE_LABELS: Record<MergePhase, string> = {
  label: "Aplicando etiquetas del PR",
  fetch: "Descargando main y la rama del PR",
  worktree: "Creando worktree de prueba",
  "test-merge": "Probando integración con main",
  merge: "Mergeando con --squash",
};

// Map one streamed event onto the store (pure, so it is unit-testable without
// React). "start" resets the previous run; "done"/"error" mark the run as
// finished so the panel can stay open for review.
export function applyMergeProgressEvent(
  state: IssueReviewStore,
  event: MergeProgressEvent,
): void {
  switch (event.type) {
    case "start":
      state.beginMergeProgress(event.prNumbers);
      break;
    case "pr-start":
      state.setMergePrStatus(event.prNumber, "working");
      state.appendMergeProgressLog(
        event.prNumber,
        `Procesando PR #${event.prNumber}...`,
      );
      break;
    case "step":
      state.appendMergeProgressLog(
        event.prNumber,
        MERGE_PHASE_LABELS[event.phase],
      );
      break;
    case "pr-merged":
      state.setMergePrStatus(event.prNumber, "merged");
      state.appendMergeProgressLog(event.prNumber, "Mergeado.");
      break;
    case "pr-conflicted":
      state.setMergePrStatus(event.prNumber, "conflicted");
      state.appendMergeProgressLog(
        event.prNumber,
        `Conflicto al integrar con main: ${event.files.join(", ")}`,
      );
      break;
    case "pr-error":
      state.setMergePrStatus(event.prNumber, "error");
      state.appendMergeProgressLog(event.prNumber, event.message);
      break;
    case "done":
      state.finishMergeProgress();
      break;
    case "error":
      state.setMergeProgressError(event.message);
      break;
  }
}

interface IssueReviewStore {
  prsByIssue: Record<number, PrStatus>;
  // Every open PR linked to the issue (finding-all IPC). The legacy
  // prsByIssue holds the FIRST open PR — the card's primary — while this
  // list powers per-PR actions (fix/merge/conflict on the RIGHT PR) and the
  // per-PR verdict/label maps below.
  openPrsByIssue: Record<number, LinkedPr[]>;
  verdictByIssue: Record<number, ReviewVerdict | null>;
  // Per-PR verdict for multi-PR issues: verdictByIssue only ever holds the
  // primary PR's verdict (last review to exit wins), which conflates two PRs
  // that were reviewed differently. These maps keep the verdict (and the raw
  // cycle labels) per PR so the context menu can act on each one correctly.
  verdictByPr: Record<number, Record<number, ReviewVerdict | null>>;
  labelsByPr: Record<number, Record<number, string[]>>;
  conflictByPr: Record<number, Record<number, boolean>>;
  conflictByIssue: Record<number, boolean>;
  // Raw cycle labels of the linked PR, re-read on every lookup. The labels
  // are the persisted source of truth for the review-cycle state (the card
  // badge and the fix/merge gates derive from them); the in-memory verdict
  // only covers live transitions until the next lookup.
  labelsByIssue: Record<number, string[]>;
  reviewingIssueNumber: number | null;
  fixingIssueNumber: number | null;
  mergingIssueNumber: number | null;
  mergingApprovedPrs: boolean;
  resolvingConflictIssueNumber: number | null;
  reviewHandler: ((issueNumber: number, prNumber?: number) => void) | null;
  fixHandler: ((issueNumber: number, prNumber?: number) => void) | null;
  mergeHandler: ((issueNumber: number, prNumber?: number) => void) | null;
  resolveConflictHandler:
    | ((issueNumber: number, prNumber?: number) => void)
    | null;
  prLookupHandler:
    | ((issueNumber: number, projectPath?: string, force?: boolean) => void)
    | null;
  registerReviewHandler: (
    handler: ((issueNumber: number, prNumber?: number) => void) | null,
  ) => void;
  registerFixHandler: (
    handler: ((issueNumber: number, prNumber?: number) => void) | null,
  ) => void;
  registerMergeHandler: (
    handler: ((issueNumber: number, prNumber?: number) => void) | null,
  ) => void;
  registerResolveConflictHandler: (
    handler: ((issueNumber: number, prNumber?: number) => void) | null,
  ) => void;
  registerPrLookupHandler: (
    handler: ((issueNumber: number, projectPath?: string, force?: boolean) => void) | null,
  ) => void;
  setPrStatus: (issueNumber: number, status: PrStatus) => void;
  setOpenPrs: (issueNumber: number, prs: LinkedPr[]) => void;
  setReviewVerdict: (
    issueNumber: number,
    verdict: ReviewVerdict | null,
  ) => void;
  setPrVerdict: (
    issueNumber: number,
    prNumber: number,
    verdict: ReviewVerdict | null,
  ) => void;
  setPrLabels: (issueNumber: number, prNumber: number, labels: string[]) => void;
  setPrConflict: (
    issueNumber: number,
    prNumber: number,
    conflicted: boolean,
  ) => void;
  setConflictStatus: (issueNumber: number, conflicted: boolean) => void;
  setIssueLabels: (issueNumber: number, labels: string[]) => void;
  setReviewingIssueNumber: (issueNumber: number | null) => void;
  setFixingIssueNumber: (issueNumber: number | null) => void;
  setMergingIssueNumber: (issueNumber: number | null) => void;
  setMergingApprovedPrs: (merging: boolean) => void;
  setResolvingConflictIssueNumber: (issueNumber: number | null) => void;
  requestPrLookup: (issueNumber: number, projectPath?: string, force?: boolean) => void;
  mergeProgress: MergeProgressState | null;
  beginMergeProgress: (prNumbers: number[]) => void;
  appendMergeProgressLog: (prNumber: number | null, message: string) => void;
  setMergePrStatus: (prNumber: number, status: MergePrStatus) => void;
  finishMergeProgress: () => void;
  setMergeProgressError: (message: string) => void;
  dismissMergeProgress: () => void;
}

export const useIssueReviewStore = create<IssueReviewStore>((set, get) => ({
  prsByIssue: {},
  openPrsByIssue: {},
  verdictByIssue: {},
  verdictByPr: {},
  labelsByPr: {},
  conflictByPr: {},
  conflictByIssue: {},
  labelsByIssue: {},
  reviewingIssueNumber: null,
  fixingIssueNumber: null,
  mergingIssueNumber: null,
  mergingApprovedPrs: false,
  resolvingConflictIssueNumber: null,
  reviewHandler: null,
  fixHandler: null,
  mergeHandler: null,
  resolveConflictHandler: null,
  prLookupHandler: null,
  registerReviewHandler: (reviewHandler) => set({ reviewHandler }),
  registerFixHandler: (fixHandler) => set({ fixHandler }),
  registerMergeHandler: (mergeHandler) => set({ mergeHandler }),
  registerResolveConflictHandler: (resolveConflictHandler) =>
    set({ resolveConflictHandler }),
  registerPrLookupHandler: (prLookupHandler) => set({ prLookupHandler }),
  setPrStatus: (issueNumber, status) =>
    set((s) => ({
      prsByIssue: { ...s.prsByIssue, [issueNumber]: status },
    })),
  setOpenPrs: (issueNumber, prs) =>
    set((s) => ({
      openPrsByIssue: { ...s.openPrsByIssue, [issueNumber]: prs },
    })),
  setReviewVerdict: (issueNumber, verdict) =>
    set((s) => ({
      verdictByIssue: { ...s.verdictByIssue, [issueNumber]: verdict },
    })),
  setPrVerdict: (issueNumber, prNumber, verdict) =>
    set((s) => ({
      verdictByPr: {
        ...s.verdictByPr,
        [issueNumber]: {
          ...s.verdictByPr[issueNumber],
          [prNumber]: verdict,
        },
      },
    })),
  setPrLabels: (issueNumber, prNumber, labels) =>
    set((s) => ({
      labelsByPr: {
        ...s.labelsByPr,
        [issueNumber]: {
          ...s.labelsByPr[issueNumber],
          [prNumber]: labels,
        },
      },
    })),
  setPrConflict: (issueNumber, prNumber, conflicted) =>
    set((s) => ({
      conflictByPr: {
        ...s.conflictByPr,
        [issueNumber]: {
          ...s.conflictByPr[issueNumber],
          [prNumber]: conflicted,
        },
      },
    })),
  setConflictStatus: (issueNumber, conflicted) =>
    set((s) => ({
      conflictByIssue: { ...s.conflictByIssue, [issueNumber]: conflicted },
    })),
  setIssueLabels: (issueNumber, labels) =>
    set((s) => ({
      labelsByIssue: { ...s.labelsByIssue, [issueNumber]: labels },
    })),
  setReviewingIssueNumber: (reviewingIssueNumber) =>
    set({ reviewingIssueNumber }),
  setFixingIssueNumber: (fixingIssueNumber) =>
    set({ fixingIssueNumber }),
  setMergingIssueNumber: (mergingIssueNumber) =>
    set({ mergingIssueNumber }),
  setMergingApprovedPrs: (mergingApprovedPrs) =>
    set({ mergingApprovedPrs }),
  setResolvingConflictIssueNumber: (resolvingConflictIssueNumber) =>
    set({ resolvingConflictIssueNumber }),
  requestPrLookup: (issueNumber, projectPath, force) => {
    const state = get();
    const cached = state.prsByIssue[issueNumber];
    // A real PR or an in-flight lookup is a settled fact — never duplicate.
    // A null result *can* go stale the moment the implementer creates the PR,
    // so a "no PR" answer is re-checked whenever the card re-renders/refreshes.
    // force=true re-reads even a cached PR (fresh reviews/labels): callers
    // that just produced state-changing work (review/fix/merge exits) must
    // refresh, otherwise the card freezes on the first lookup of the session.
    if (cached === "loading") return;
    if (!force && cached !== undefined && cached !== null) return;
    state.prLookupHandler?.(issueNumber, projectPath, force);
  },
  mergeProgress: null,
  beginMergeProgress: (prNumbers) =>
    set({
      mergeProgress: {
        prNumbers,
        statusByPr: Object.fromEntries(
          prNumbers.map((n) => [n, "pending" as const]),
        ),
        log: [],
        finished: false,
        error: null,
      },
    }),
  appendMergeProgressLog: (prNumber, message) =>
    set((s) =>
      s.mergeProgress
        ? {
            mergeProgress: {
              ...s.mergeProgress,
              log: [...s.mergeProgress.log, { prNumber, message }],
            },
          }
        : {},
    ),
  setMergePrStatus: (prNumber, status) =>
    set((s) =>
      s.mergeProgress
        ? {
            mergeProgress: {
              ...s.mergeProgress,
              statusByPr: { ...s.mergeProgress.statusByPr, [prNumber]: status },
            },
          }
        : {},
    ),
  finishMergeProgress: () =>
    set((s) =>
      s.mergeProgress ? { mergeProgress: { ...s.mergeProgress, finished: true } } : {},
    ),
  setMergeProgressError: (message) =>
    set((s) =>
      s.mergeProgress
        ? {
            mergeProgress: {
              ...s.mergeProgress,
              finished: true,
              error: message,
            },
          }
        : {},
    ),
  dismissMergeProgress: () => set({ mergeProgress: null }),
}));
