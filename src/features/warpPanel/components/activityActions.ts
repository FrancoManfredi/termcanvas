import { useIssueResolveStore } from "../../../stores/issueResolveStore";
import { useIssueReviewStore } from "../../../stores/issueReviewStore";
import { useIssueGateStore } from "../../../stores/issueGateStore";
import { useWorkItemStore } from "../../../stores/workItemStore";
import {
  createFactoryJob,
  deleteFactoryJobWorktree,
  FACTORY_DISCARD_TIMEOUT_MS,
  FACTORY_HEALTH_TIMEOUT_MS,
  FACTORY_JOB_CREATE_TIMEOUT_MS,
  FACTORY_REVIEW_ACTION_TIMEOUT_MS,
  FACTORY_SPEC_TIMEOUT_MS,
  FACTORY_TRIAGE_TIMEOUT_MS,
  FACTORY_WORKTREE_DELETE_TIMEOUT_MS,
  getFactoryHealth,
  postFactoryJobDiscard,
  postFactoryReviewAccept,
  postFactoryReviewRerun,
  postFactoryReviewRetry,
  postFactoryReviewRetryReview,
  postFactoryResume,
  postFactorySpecApprove,
  postFactorySpecReject,
  postFactoryTriageRespond,
} from "../../../lib/factoryClient";
import {
  buildFactoryJobIssueRef,
  buildFactoryResolvePrompt,
  findActiveFactoryJobForIssue,
  findActiveFactoryJobsForIssue,
  parseGitHubIssueRepo,
  type FactoryIssueRef,
} from "../adapters/factoryIssueJobs";
import {
  formatElapsedShort,
  sessionAttachState,
} from "../adapters/factoryJobIndex";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_GATE_FAIL,
  effectiveReviewLabel,
} from "../../../canvas/reviewVerdict";
import {
  blockedByTitle,
  resolveBlockedGate,
} from "../adapters/liveIssues";
import { overrideGateForIssue } from "../../../canvas/issueGate";
import { openIssueInGitHub } from "./KanbanBoard";

/**
 * Activity CTA state machine (T01 data layer, consumed by Track B panel).
 *
 * - `describeActivityActions(...)` is pure: Figma English labels (busy
 *   variants append `…`, canvas precedent), enabled flags, and disabled
 *   titles reusing the canvas card Spanish strings verbatim. The two
 *   factory-only resolve states use neutral English (no canvas precedent):
 *   daemon down → disabled + title; factory job active for the issue →
 *   `Resolving…` + disabled + title. `session` ("View Agent") opens the
 *   LIVE opencode session URL (`dashboardUrl` from the matched poll-list
 *   job) in a new tab; without a live link it disables honestly (never a
 *   dead tab).
 * - Human-gate CTAs (`approve-spec` / `triage-respond` / `review-accept` /
 *   `review-reject`)
 *   act on the row's waiting factory job (`issue.factoryAwaiting`, from
 *   `readFactoryJobHumanNeed`) via the EXISTING daemon routes
 *   (`POST …/spec/approve`, `POST …/triage/respond`,
 *   `POST …/review/accept`, `POST …/review/retry`) through `factoryClient` with explicit
 *   timeouts — zero new daemon endpoints. Each enables only for its
 *   matching gate kind + a usable job id, refuses while any canvas
 *   operation runs, debounces double-clicks per job (module mutex), and
 *   surfaces success/failure through the injected `notify()` message
 *   (never a dead click, never a retry; the daemon 404/409 guards are
 *   the backstop).
 * - `delete-worktree` removes the row's isolated factory worktree via the
 *   EXISTING daemon route (`DELETE …/jobs/:id/worktree`) through
 *   `factoryClient` with an explicit timeout — explicit human cleanup
 *   only, never automatic (canvas `ProjectTree` parity: two-step confirm
 *   owned by the panel, dirty/open-PR 409 escalates to a force confirm,
 *   result via `notify()`). Enabled only for a terminal job with a
 *   recorded worktree path; the daemon removes the folder only and NEVER
 *   the branch, and the confirm copy must say exactly that.
  * - `invokeActivityAction(...)` is the SINGLE code path from the panel into
 *   handler refs (calls by reference only — no handler is ever defined
 *   here), `overrideGateForIssue`, `fs.readFile` (gate report, on demand),
 *   `openIssueInGitHub`, and — for `resolve` — the factory daemon via
 *   `src/lib/factoryClient` (POST /factory/jobs with an `issueRef` link).
 *   The panel Resolve button creates a FACTORY job (pipeline
 *   foreman→triage→spec→implement→verify→review→merge); the canvas card
 *   keeps its own opencode terminal flow (out of scope, untouched).
 *   Best-effort + honest disabled state: failed factory calls surface
 *   through the injected `notify()` message; the panel never invents error
 *   banners and never retries.
 *
 * Resolve busy exclusion (factory-aware):
 * - canvas `resolvingIssueNumber !== null` refuses (as before);
 * - an in-flight factory create for the same issue refuses (module-level
 *   mutex: single invoke per click, cleared on settle — no dead clicks);
 * - an ACTIVE factory job linked to the issue in the existing
  *   `useWorkItemStore` poll list refuses (matched by `issueRef`, zero new
  *   polls — the 2.5s poll is the shared `useWorkItemsPolling` loop);
 * - resolve additionally refuses while the issue is blocked by another
 *   OPEN issue (`blockedByBlockers`, shared `resolveBlockedGate` rule
 *   with the canvas card — honest disabled + title on both CTAs).
 * - daemon down refuses with an honest title + notify on click (never a
 *   dead click); unknown availability (`available: null`) stays enabled —
 *   the invoke-time health probe is the backstop.
 * - review/fix refuse while resolving/reviewing/fixing is active;
 * - merge refuses while another merge runs;
 * - conflict refuses while resolving/reviewing/fixing/conflict-resolving
 *   is active (`XyFlowCanvas` handler guards).
 *
 * The `busy` flags are GLOBAL (any issue busy disables the guarded CTA on
 * every row — same as the canvas card). The busy `…` label variant shows
 * whenever the corresponding global flag is set.
 */

export type ActivityActionKind =
  | "resolve"
  | "review"
  | "fix"
  | "merge"
  | "conflict"
  | "override-gate"
  | "view-report"
  | "github"
  | "session"
  | "approve-spec"
  | "reject-spec"
  | "resume"
  | "discard"
  | "re-review"
  | "triage-respond"
  | "review-accept"
  | "review-reject"
  | "review-retry"
  | "delete-worktree";

export interface ActivityActionDef {
  kind: ActivityActionKind;
  label: string;
  enabled: boolean;
  title?: string;
}

/** Global busy flags (any issue). Callers read them from the canvas stores. */
export interface ActivityBusyState {
  resolving: boolean;
  reviewing: boolean;
  fixing: boolean;
  merging: boolean;
  resolvingConflict: boolean;
  anyActive: boolean;
}

export interface DescribeActivityActionsArgs {
  issueNumber: number;
  prNumber: number | null;
  prState: string;
  /** Effective review-cycle label for the primary PR (labels win over verdict). */
  effective: string | null;
  conflicted: boolean;
  gateStatus: "idle" | "running" | "pass" | "fail";
  busy: ActivityBusyState;
  /**
   * Open blocker issue numbers for the blocked-by gate (same
   * `resolveBlockedGate` source the canvas card uses). Empty/absent =
   * free to resolve. Never invented — callers pass real relations only.
   */
  blockedByBlockers?: number[];
  /**
   * Factory resolve state for the row (Warp Resolve → factory job):
   * - `available === false` disables resolve with an honest title
   *   (daemon down). `null`/absent = unknown → no effect (the
   *   invoke-time health probe is the backstop).
   * - `active === true` marks the row busy (`Resolving…`, disabled):
   *   an active factory job linked to this issue was found in the
   *   existing poll list (matched by `issueRef`, zero new polls).
   */
  factory?: {
    available?: boolean | null;
    active?: boolean;
    /**
     * Live opencode session URL for the row's linked factory job
     * (`dashboardUrl` from the existing poll list, via
     * `readFactoryJobSessionLink`). Present = "View Agent" opens it in a
     * new tab. Null/absent with factory info present = no live link yet
     * (honest disabled). The whole `factory` object absent = unknown
     * (legacy enabled placeholder — the invoke backstop still refuses
     * without a URL, never a dead tab).
     */
    sessionUrl?: string | null;
    /**
     * Linked job `createdAt` as epoch ms (adapter-parsed, never invented).
     * Drives the B5 attaching/overdue wait titles. Absent = unknown age
     * (wait text omits the elapsed parenthetical, never a guessed age).
     */
    jobCreatedAtMs?: number | null;
  };
  /**
   * Clock override for the B5 wait titles (tests pin "now"; live callers
   * omit it and read `Date.now()` once per describe). Never a fetch.
   */
  nowMs?: number;
  /**
   * Human gate for the row's linked factory job (from
   * `readFactoryJobHumanNeed`, attached by `liveActivity` as
   * `issue.factoryAwaiting`). Present + matching kind enables the acting
   * CTA below (Approve Spec / Respond / Accept); absent or mismatched
   * keeps them disabled. `jobId` is the daemon job id the POST targets.
   */
  factoryAwaiting?: {
    kind: string;
    jobId: string;
    /**
     * True cuando el review NUNCA corrió por fallo de infra (daemon
     * `lastReview.isInfraError`). Solo presente en true: Accept se
     * deshabilita y se ofrece reintentar.
     */
    reviewInfraError?: boolean;
  } | null;
  /**
   * Whether the triage answer drafts hold at least one non-empty answer
   * (the panel computes it from its inputs). Gates `triage-respond`:
   * without an answer the daemon would 400, so the CTA disables honestly
   * instead of sending a dead request.
   */
  triageAnswersReady?: boolean;
  /**
   * Isolated factory worktree for the row's linked job (from
   * `issue.factory` — `describeFactoryJobForPanel`, zero new fetches).
   * Drives `delete-worktree`: enabled only when the job is terminal AND
   * carries a recorded worktree path. Absent/mismatched keeps the CTA
   * disabled with an honest title (never a dead click).
   */
  factoryWorktree?: {
    jobId?: unknown;
    worktreePath?: unknown;
    terminal?: unknown;
  } | null;
  /**
   * Linked factory job for merge-ready rows ("No mergear" + "Re-revisar"):
   * the panel passes the linked job id ONLY when the row awaits
   * merge-ready; absent = resume-gate only for discard. Cleaned at
   * describe (junk = no explicit target). Never throws.
   */
  mergeReadyJobId?: string | null;
}

/** Row snapshot used to build the factory prompt + `issueRef` on resolve. */
export interface FactoryResolveIssueSnapshot {
  title?: unknown;
  body?: unknown;
  labels?: unknown;
  url?: unknown;
}

/** Structural result of the factory create seam (live = factoryClient). */
export interface FactoryResolveCreateResult {
  ok: boolean;
  id: string | null;
  error: string;
}

/** Structural result of the factory health seam (live = factoryClient). */
export interface FactoryResolveHealth {
  ok: boolean;
  error: string;
}

/** Input of the factory create seam (prompt + worktree + stamped link). */
export interface FactoryResolveCreateInput {
  prompt: string;
  worktree: string;
  phase: string;
  issueRef: FactoryIssueRef;
}

/** Injected fakes for offline tests; every field optional (live default). */
export interface ActivityInvokeDeps {
  reviewHandler?: ((issueNumber: number, prNumber?: number) => void) | null;
  fixHandler?: ((issueNumber: number, prNumber?: number) => void) | null;
  mergeHandler?: ((issueNumber: number, prNumber?: number) => void) | null;
  resolveConflictHandler?:
    | ((issueNumber: number, prNumber?: number) => void)
    | null;
  overrideGate?: (options: {
    repoPath: string;
    issueNumber: number;
    prNumber: number;
  }) => Promise<boolean>;
  readFile?: (path: string) => Promise<unknown>;
  openUrl?: (url: string) => void;
  busy?: Partial<ActivityBusyState>;
  /** Canvas `__worktreePath` — cwd for the gate override. */
  worktreePath?: string;
  /**
   * Open blocker issue numbers for the blocked-by gate (resolve refuses
   * while non-empty — same rule as the canvas card). The panel passes the
   * row's real relations; absent = free to resolve.
   */
  blockedByBlockers?: number[];
  /** GitHub issue URL for the `github` action. */
  issueUrl?: string;
  /**
   * Live opencode session URL for the `session` action (the row's
   * `factory.sessionUrl` — daemon-built `dashboardUrl`). Empty/absent =
   * honest notify, never a dead tab.
   */
  sessionUrl?: string | null;
  /** Gate report path for `view-report` (else read live). */
  reportPath?: string | null;
  /** Receives the on-demand gate report content for display. */
  onReport?: (report: { path: string; content: string | null }) => void;
  /**
   * Row snapshot for the factory resolve prompt + `issueRef`
   * (title/body/labels/url). Absent = prompt built from the issue number
   * only (honest, never invented from other rows).
   */
  issue?: FactoryResolveIssueSnapshot;
  /**
   * Existing factory poll list for the resolve busy-match (matched by
   * `issueRef`). Live default reads `useWorkItemStore` — the list the
   * factoryLab 2.5s poll already populates. ZERO new polls/intervals here.
   */
  factoryJobs?: unknown[];
  /** Health seam for resolve (live = `getFactoryHealth`, short timeout). */
  checkFactoryHealth?: () => Promise<FactoryResolveHealth>;
  /** Create seam for resolve (live = `createFactoryJob`, POST /factory/jobs). */
  createFactoryJob?: (
    input: FactoryResolveCreateInput,
  ) => Promise<FactoryResolveCreateResult>;
  /**
   * Honest user feedback for resolve (daemon down, missing worktree,
   * create failure, created job id). The panel wires a visible message —
   * without it a refused click would be dead. Never throws.
   */
  notify?: (message: string) => void;
  /**
   * Daemon job id the human-gate CTAs target (the row's
   * `factoryAwaiting.jobId`). Junk/absent = the acting CTAs refuse
   * silently at invoke (their describe guard already disables them).
   */
  factoryJobId?: string | null;
  /**
   * Expected human-gate kind for the invoke backstop (the row's
   * `factoryAwaiting.kind`). When provided as a non-empty string and it
   * mismatches the invoked action, invoke refuses silently (stale button
   * after the poll moved the job on). Absent = no kind check (merge-ready
   * rows carry no gate kind).
   */
  factoryAwaitingKind?: string | null;
  /**
   * Human triage answers for `triage-respond` (the panel's per-question
   * drafts). Cleaned at invoke (trim, ≤500 chars, ≤10, empties dropped);
   * empty after cleaning = honest notify, never a 400 against the daemon.
   */
  triageAnswers?: unknown;
  /**
   * Seams for the human-gate POSTs (live = `factoryClient` ops against
   * the EXISTING daemon routes, explicit timeouts; offline tests inject
   * fakes — zero network in tests). Every seam returns `{ok, error}` and
   * never throws (the invoke wrapper backstops throwing fakes too).
   */
  approveSpecJob?: (jobId: string) => Promise<FactoryHumanActionResult>;
  /**
   * Seam for the resume CTA (live = `factoryClient` op against the
   * `POST …/resume` route — re-drives the parked phase worker).
   * Offline tests inject fakes — zero network in tests.
   */
  resumeJob?: (jobId: string) => Promise<FactoryHumanActionResult>;
  /**
   * Seam for the re-review CTA (live = `factoryClient` op against the
   * `POST …/review/rerun` route — re-runs the review on a Complete job
   * without moving its status). Offline tests inject fakes — zero
   * network in tests.
   */
  rerunReviewJob?: (jobId: string) => Promise<FactoryHumanActionResult>;
  /**
   * Seam for the discard CTA (live = `factoryClient` op against the
   * `POST …/discard` route — cancels the parked job and cleans everything
   * it did: worktree revert + artifacts removed). Offline tests inject
   * fakes — zero network in tests.
   */
  discardJob?: (jobId: string) => Promise<FactoryHumanActionResult>;
  /**
   * Seam for the spec-reject CTA (live = `factoryClient` op against the
   * `POST …/spec/reject` route — the brief is regenerated with the motive).
   * Offline tests inject fakes — zero network in tests.
   */
  rejectSpecJob?: (jobId: string, feedback?: string) => Promise<FactoryHumanActionResult>;
  respondTriageJob?: (
    jobId: string,
    answers: string[],
  ) => Promise<FactoryHumanActionResult>;
  acceptReviewJob?: (jobId: string) => Promise<FactoryHumanActionResult>;
  /**
   * Seam for the review-retry CTA (live = `factoryClient` op against the
   * EXISTING `POST …/review/retry-review` route — re-runs ONLY the review,
   * without re-running implement. Primary action when the review never ran
   * due to an infra error). Offline tests inject fakes — zero network.
   */
  retryReviewJob?: (jobId: string) => Promise<FactoryHumanActionResult>;
  /**
   * Seam for the review-reject CTA (live = `factoryClient` op against the
   * EXISTING `POST …/review/retry` route — Review → Building for rework).
   * Offline tests inject fakes — zero network in tests.
   */
  rejectReviewJob?: (jobId: string) => Promise<FactoryHumanActionResult>;
  /**
   * Whether the linked factory job is terminal (the row's
   * `factory.terminal` from the existing poll list). The delete-worktree
   * invoke backstop refuses unless this is explicitly true — the daemon
   * itself refuses non-terminal deletes (409) and `force` never overrides
   * non-terminality, so the renderer mirrors the guard instead of sending
   * a doomed request.
   */
  factoryTerminal?: boolean | null;
  /**
   * Recorded isolated worktree path for the confirm copy + honest
   * disabled state (the row's `factory.worktreePath`). Junk/absent = the
   * delete CTA refuses (its describe guard already disables it).
   */
  factoryWorktreePath?: string | null;
  /**
   * Second-confirm flag for the delete (the panel escalates here after a
   * dirty/open-PR 409 — canvas `ProjectTree` force-stage parity). Only
   * ever true after an explicit second user confirm.
   */
  forceWorktreeDelete?: boolean;
  /**
   * Seam for the explicit worktree delete (live =
   * `deleteFactoryJobWorktree` against the EXISTING daemon route with an
   * explicit timeout; offline tests inject fakes — zero network in
   * tests). Returns `{ok, error}` and never throws (the invoke wrapper
   * backstops throwing fakes too).
   */
  deleteWorktreeJob?: (
    jobId: string,
    opts: { force: boolean },
  ) => Promise<FactoryWorktreeDeleteResult>;
  /**
   * Receives the delete outcome so the panel can escalate to the force
   * confirm on a dirty/open-PR 409 (canvas dirty→force parity) and render
   * the result. Never throws (invocation is guarded).
   */
  onWorktreeDelete?: (result: { ok: boolean; error: string }) => void;
}

/** Structural result of a human-gate seam (approve / respond / accept). */
export interface FactoryHumanActionResult {
  ok: boolean;
  error: string;
  /** Optional human-readable outcome detail (re-review verdict). */
  summary?: string;
}

/** Structural result of the worktree-delete seam (soft or force). */
export interface FactoryWorktreeDeleteResult {
  ok: boolean;
  error: string;
  /** HTTP-ish status when known (409 = guard refusal: dirty / PR open). */
  status?: number | null;
}

function normalizeGateStatus(value: unknown): "idle" | "running" | "pass" | "fail" {
  return value === "running" || value === "pass" || value === "fail"
    ? value
    : "idle";
}

function normalizeBusy(busy: ActivityBusyState | undefined | null): ActivityBusyState {
  return {
    resolving: busy?.resolving === true,
    reviewing: busy?.reviewing === true,
    fixing: busy?.fixing === true,
    merging: busy?.merging === true,
    resolvingConflict: busy?.resolvingConflict === true,
    anyActive: busy?.anyActive === true,
  };
}

/**
 * Pure CTA matrix for one Activity row/detail. Always returns the full
 * nineteen-action set in stable order; the panel renders the subset each
 * surface needs. Never throws.
 */
export function describeActivityActions(
  args: DescribeActivityActionsArgs,
): ActivityActionDef[] {
  // Top-level guard: a mistyped `args` (undefined/null/array on the
  // review→awaiting transition) degrades to the honest-disabled matrix
  // instead of throwing on property reads mid-render.
  try {
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      return fallbackDisabledActions();
    }
  } catch {
    return fallbackDisabledActions();
  }
  try {
    return describeActivityActionsInner(args);
  } catch {
    try {
      return fallbackDisabledActions();
    } catch {
      return [];
    }
  }
}

/**
 * Honest-disabled nineteen-action fallback (stable order, same kinds as the
 * live matrix). Never throws.
 */
function fallbackDisabledActions(): ActivityActionDef[] {
  return [
    { kind: "resolve", label: "Resolve Issue", enabled: false },
    { kind: "session", label: "View Agent", enabled: false },
    { kind: "review", label: "Review Issue", enabled: false },
    { kind: "fix", label: "Implement Fix", enabled: false },
    { kind: "merge", label: "Merge PR", enabled: false },
    { kind: "conflict", label: "Resolver conflicto", enabled: false },
    { kind: "view-report", label: "Ver reporte", enabled: false },
    { kind: "override-gate", label: "Revisar igual", enabled: false },
    { kind: "approve-spec", label: "Approve Spec", enabled: false },
    { kind: "reject-spec", label: "Reject Spec", enabled: false },
    { kind: "resume", label: "Retomar trabajo", enabled: false },
    { kind: "discard", label: "No retomar trabajo", enabled: false },
    { kind: "re-review", label: "Re-revisar", enabled: false },
    { kind: "triage-respond", label: "Respond", enabled: false },
    { kind: "review-accept", label: "Accept", enabled: false },
    { kind: "review-reject", label: "Reject", enabled: false },
    { kind: "review-retry", label: "Retry review", enabled: false },
    { kind: "github", label: "View Issue", enabled: true },
    { kind: "delete-worktree", label: "Delete Worktree", enabled: false },
  ];
}

function describeActivityActionsInner(
  args: DescribeActivityActionsArgs,
): ActivityActionDef[] {
  const pr =
    typeof (args as { prNumber?: unknown }).prNumber === "number" &&
    Number.isFinite((args as { prNumber: number }).prNumber)
      ? ((args as { prNumber: number }).prNumber)
      : null;
  const prState = typeof args.prState === "string" ? args.prState : "";
  const effective = typeof args.effective === "string" ? args.effective : null;
  const conflicted = args.conflicted === true;
  const gateStatus = normalizeGateStatus(args.gateStatus);
  const busy = normalizeBusy(args.busy);

  const hasOpenPr = pr !== null && prState === "OPEN";
  const gateFail =
    effective === REVIEW_LABEL_GATE_FAIL || gateStatus === "fail";
  const gateRunning = gateStatus === "running";
  // Review/fix exclusion mirrors the canvas handler guards (resolving /
  // reviewing / fixing). The panel additionally disables review while a
  // merge or conflict-resolve runs (canvas per-PR rows share that wider
  // exclusion), but invoke stays handler-exact.
  const reviewFixBusy = busy.resolving || busy.reviewing || busy.fixing;
  const reviewBusy = reviewFixBusy || busy.merging || busy.resolvingConflict;

  const reviewTitle =
    pr === null
      ? undefined
      : prState !== "OPEN"
        ? `PR #${pr} no está abierto`
        : gateFail
          ? "El gate de calidad falló: revisá el reporte o forzá con 'Revisar igual'"
          : gateRunning
            ? "El gate de calidad está corriendo sobre el PR…"
            : `Review PR #${pr}`;

  // Blocked-by gate (shared with the canvas card via `resolveBlockedGate`):
  // an issue blocked by another OPEN issue cannot resolve until the
  // blocker is done/closed. Same honest disabled + title on both CTAs.
  const resolveGate = resolveBlockedGate(
    (Array.isArray(args.blockedByBlockers)
      ? args.blockedByBlockers
      : []
    ).map((n) => ({ kind: "blockedBy", number: n, state: "OPEN" })),
  );

  // Factory resolve state (Warp Resolve → factory job): an active linked
  // job marks the row busy (`Resolving…` — distinct from the canvas
  // `Resolve Issue…` terminal busy so both engines stay distinguishable);
  // a down daemon disables honestly. Unknown availability stays enabled
  // (the invoke-time health probe is the backstop).
  const factoryActive = args.factory?.active === true;
  const factoryDown = args.factory?.available === false;
  // "View Agent" honesty: a live link opens in a new tab; without one the
  // CTA disables with the reason (never a dead tab). Factory info absent
  // entirely = legacy enabled placeholder (pre-existing call sites and
  // tests); the invoke backstop still refuses without a URL.
  // B5: an ACTIVE job without a URL is not "broken", it is mid-attach —
  // `dashboardUrl` lands only when a daemon `session.create` succeeds, and
  // per-role pipeline sessions never backfill the top-level link, so this
  // state can persist into Review. The title says exactly which case holds
  // and for how long (visible timeout), instead of disabling forever.
  const hasFactoryInfo = args.factory !== undefined && args.factory !== null;
  const sessionUrl =
    typeof args.factory?.sessionUrl === "string"
      ? args.factory.sessionUrl.trim()
      : "";
  const sessionEnabled = !hasFactoryInfo || sessionUrl !== "";
  const sessionTitle = (() => {
    if (!hasFactoryInfo) return undefined;
    if (sessionEnabled) return "Open the live agent session in a new tab";
    try {
      const attach = sessionAttachState({
        sessionUrl: null,
        active: factoryActive,
        createdAtMs:
          typeof args.factory?.jobCreatedAtMs === "number"
            ? args.factory.jobCreatedAtMs
            : null,
        ...(typeof args.nowMs === "number" ? { nowMs: args.nowMs } : {}),
      });
      if (attach.kind === "overdue") {
        const age = formatElapsedShort(attach.elapsedMs);
        const ageText = age !== "" ? ` after ${age}` : "";
        return (
          `The live agent session never attached for this job's path${ageText} — ` +
          `the daemon sets the link only when its session handshake succeeds. ` +
          `The job itself keeps its stage above; View Agent stays off rather than opening a dead tab.`
        );
      }
      if (attach.kind === "attaching") {
        const age = formatElapsedShort(attach.elapsedMs);
        const ageText = age !== "" ? ` (${age} elapsed)` : "";
        return `Attaching the live agent session${ageText} — it appears when the daemon attaches the session to the job`;
      }
    } catch {
      // fall through to the legacy honest text
    }
    return "The live agent session is not available yet — it appears when the daemon attaches the session to the job";
  })();
  const resolveTitle = resolveGate.blocked
    ? blockedByTitle(resolveGate.blockers)
    : factoryActive
      ? "A factory job is already resolving this issue"
      : factoryDown
        ? "Factory daemon is not available — start the daemon, then resolve again"
        : undefined;

  // Human-gate CTAs (the linked factory job waits for the human — rows
  // F-A1–F-A4). Each enables ONLY for its matching gate kind + a usable
  // daemon job id, and all refuse while any canvas operation runs
  // (`busy.anyActive` — a human gate must not race live agent work; the
  // invoke backstop enforces the same rule). Titles stay honest about
  // WHY a visible button cannot act yet.
  const awaitingKind =
    typeof args.factoryAwaiting?.kind === "string"
      ? args.factoryAwaiting.kind
      : null;
  const awaitingJobId = cleanFactoryJobId(args.factoryAwaiting?.jobId);
  const humanBusy = busy.anyActive;
  const answersReady = args.triageAnswersReady === true;

  const approveEnabled =
    awaitingKind === "spec-approval" &&
    awaitingJobId !== null &&
    !humanBusy;

  // Infra review failure: the review NEVER ran (rate limit, 5xx, timeout).
  // Accept would complete blindly (the daemon 409s it too) — the honest
  // CTA is retrying only the review. Absent/false = genuine ask-human
  // judgment, Accept stays available.
  const reviewInfraError = args.factoryAwaiting?.reviewInfraError === true;  const approveTitle =
    awaitingKind !== "spec-approval" || awaitingJobId === null
      ? undefined
      : humanBusy
        ? "Another operation is running — wait for it to finish before approving"
        : "Approve the spec — the job resumes in Foreman";

  // Reject mirrors Approve on the same gate: refusing the drafted spec
  // regenerates the brief (the daemon re-runs the spec agent) instead of
  // advancing to Foreman.
  const rejectSpecEnabled =
    awaitingKind === "spec-approval" &&
    awaitingJobId !== null &&
    !humanBusy;
  const rejectSpecTitle =
    awaitingKind !== "spec-approval" || awaitingJobId === null
      ? undefined
      : humanBusy
        ? "Another operation is running — wait for it to finish before rejecting"
        : "Reject the spec — the agent drafts a new brief for approval";

  // Resume mirrors the human gates on its own parked-job gate: only a row
  // whose linked job needs resume (daemon marker bootInterrupted) enables.
  // Discard shares that gate AND the merge-ready row: NO RETOMAR TRABAJO /
  // No mergear tears the job down completely (explicit human cleanup,
  // never automatic — destructive, so the panel asks to confirm first).
  const resumeEnabled =
    awaitingKind === "resume" &&
    awaitingJobId !== null &&
    !humanBusy;
  const mergeReadyJobId = cleanFactoryJobId(args.mergeReadyJobId);
  const discardEnabled =
    resumeEnabled ||
    (mergeReadyJobId !== null && !humanBusy);
  const reReviewEnabled = mergeReadyJobId !== null && !humanBusy;
  const resumeTitle =
    awaitingKind !== "resume" || awaitingJobId === null
      ? undefined
      : humanBusy
        ? "Another operation is running — wait for it to finish before resuming"
        : "Resume the interrupted turn — re-drives the phase worker";
  const discardTitle = !discardEnabled
    ? undefined
    : awaitingKind === "resume"
      ? "Cancel the parked job and clean everything it did (PR close, branch/worktree/job removed)"
      : "Don't merge: close the PR and tear the job down completely (branch/worktree/job removed)";
  const reReviewTitle = !reReviewEnabled
    ? undefined
    : "Re-run the review on the current PR state without moving the job (the verdict is reported, nothing reopens alone)";

  const respondEnabled =
    awaitingKind === "triage-respond" &&
    awaitingJobId !== null &&
    !humanBusy &&
    answersReady;
  const respondTitle =
    awaitingKind !== "triage-respond" || awaitingJobId === null
      ? undefined
      : humanBusy
        ? "Another operation is running — wait for it to finish before responding"
        : !answersReady
          ? "Write at least one answer first"
          : "Send the answers — the job resumes in Foreman";

  const acceptEnabled =
    awaitingKind === "ask-human" &&
    awaitingJobId !== null &&
    !humanBusy &&
    !reviewInfraError;
  const acceptTitle =
    awaitingKind !== "ask-human" || awaitingJobId === null
      ? undefined
      : reviewInfraError
        ? "The review never ran (provider/infra error) — retry the review instead of accepting"
        : humanBusy
          ? "Another operation is running — wait for it to finish before accepting"
          : "Accept the job as-is — Review → Complete";

  // Reject mirrors Accept on the same gate (FactoryLab ReviewPanel parity:
  // "Mandar a Building"): refusing the ask_human state sends the job back
  // for rework — Review → Building — instead of completing it.
  const rejectEnabled =
    awaitingKind === "ask-human" &&
    awaitingJobId !== null &&
    !humanBusy;
  const rejectTitle =
    awaitingKind !== "ask-human" || awaitingJobId === null
      ? undefined
      : humanBusy
        ? "Another operation is running — wait for it to finish before rejecting"
        : "Reject — send back to Building for rework (does not complete the job)";

  // Retry-only-review mirrors Accept/Reject on the same gate: re-runs ONLY
  // the review agent (implement output is kept). Primary action when the
  // review never ran due to an infra error (Accept is disabled then).
  const retryReviewEnabled =
    awaitingKind === "ask-human" &&
    awaitingJobId !== null &&
    !humanBusy;
  const retryReviewTitle =
    awaitingKind !== "ask-human" || awaitingJobId === null
      ? undefined
      : humanBusy
        ? "Another operation is running — wait for it to finish before retrying"
        : reviewInfraError
          ? "Re-run only the review (implement output is kept) — the previous attempt never ran"
          : "Re-run only the review without re-running implement";

  // Delete-worktree CTA (explicit human cleanup of the row's isolated
  // factory worktree — canvas `ProjectTree` parity, daemon semantics:
  // folder only, branch kept). Enabled only for a terminal job with a
  // recorded path; every other shape disables honestly (never a dead
  // click, never a doomed non-terminal request — the daemon 409s those).
  const deleteJobId = cleanFactoryJobId(args.factoryWorktree?.jobId);
  const deletePath = cleanWorktreePath(args.factoryWorktree?.worktreePath);
  const deleteTerminal = args.factoryWorktree?.terminal === true;
  const hasWorktreeInfo =
    args.factoryWorktree !== undefined && args.factoryWorktree !== null;
  const deleteEnabled =
    deleteTerminal && deleteJobId !== null && deletePath !== null;
  const deleteTitle = !hasWorktreeInfo
    ? undefined
    : deletePath === null
      ? "No isolated worktree recorded for this job yet"
      : !deleteTerminal
        ? "The job is still running — worktrees can only be removed once the job is terminal"
        : deleteJobId === null
          ? "No isolated worktree recorded for this job yet"
          : `Remove the isolated worktree folder (${deletePath}) — the branch is kept`;

  return [
    {
      kind: "resolve",
      label: busy.resolving
        ? "Resolve Issue…"
        : factoryActive
          ? "Resolving…"
          : "Resolve Issue",
      enabled:
        !busy.resolving &&
        !resolveGate.blocked &&
        !factoryActive &&
        !factoryDown,
      ...(resolveTitle !== undefined ? { title: resolveTitle } : {}),
    },
    {
      kind: "session",
      label: "View Agent",
      enabled: sessionEnabled,
      ...(sessionTitle !== undefined ? { title: sessionTitle } : {}),
    },
    {
      kind: "review",
      label: busy.reviewing ? "Review Issue…" : "Review Issue",
      enabled:
        !reviewBusy && hasOpenPr && !gateFail && !gateRunning,
      ...(reviewTitle !== undefined ? { title: reviewTitle } : {}),
    },
    {
      kind: "fix",
      label: busy.fixing ? "Implement Fix…" : "Implement Fix",
      enabled:
        !reviewFixBusy &&
        effective === REVIEW_LABEL_CHANGES &&
        hasOpenPr,
      ...(pr !== null ? { title: `Aplicar fix al PR #${pr}` } : {}),
    },
    {
      kind: "merge",
      label: busy.merging ? "Merge PR…" : "Merge PR",
      enabled:
        !busy.merging &&
        effective === REVIEW_LABEL_APPROVED &&
        hasOpenPr,
      ...(pr !== null ? { title: `Merge PR #${pr}` } : {}),
    },
    {
      kind: "conflict",
      label: "Resolver conflicto",
      enabled:
        conflicted &&
        hasOpenPr &&
        !busy.resolvingConflict &&
        !reviewFixBusy,
      ...(pr !== null ? { title: `Resolver conflicto del PR #${pr}` } : {}),
    },
    {
      kind: "view-report",
      label: "Ver reporte",
      enabled: gateFail,
      title:
        pr !== null
          ? `Ver el reporte del gate del PR #${pr}`
          : "Ver el reporte del gate de calidad",
    },
    {
      kind: "override-gate",
      label: "Revisar igual",
      enabled: gateFail && pr !== null && !busy.anyActive,
      title:
        pr !== null
          ? `Forzar la review del PR #${pr} (quita gate:fallo)`
          : "Forzar la review igual (quita gate:fallo)",
    },
    {
      kind: "approve-spec",
      label: "Approve Spec",
      enabled: approveEnabled,
      ...(approveTitle !== undefined ? { title: approveTitle } : {}),
    },
    {
      kind: "reject-spec",
      label: "Reject Spec",
      enabled: rejectSpecEnabled,
      ...(rejectSpecTitle !== undefined ? { title: rejectSpecTitle } : {}),
    },
    {
      kind: "resume",
      label: "Retomar trabajo",
      enabled: resumeEnabled,
      ...(resumeTitle !== undefined ? { title: resumeTitle } : {}),
    },
    {
      kind: "discard",
      label: "No retomar trabajo",
      enabled: discardEnabled,
      ...(discardTitle !== undefined ? { title: discardTitle } : {}),
    },
    {
      kind: "re-review",
      label: "Re-revisar",
      enabled: reReviewEnabled,
      ...(reReviewTitle !== undefined ? { title: reReviewTitle } : {}),
    },
    {
      kind: "triage-respond",
      label: "Respond",
      enabled: respondEnabled,
      ...(respondTitle !== undefined ? { title: respondTitle } : {}),
    },
    {
      kind: "review-accept",
      label: "Accept",
      enabled: acceptEnabled,
      ...(acceptTitle !== undefined ? { title: acceptTitle } : {}),
    },
    {
      kind: "review-reject",
      label: "Reject",
      enabled: rejectEnabled,
      ...(rejectTitle !== undefined ? { title: rejectTitle } : {}),
    },
    {
      kind: "review-retry",
      label: "Retry review",
      enabled: retryReviewEnabled,
      ...(retryReviewTitle !== undefined ? { title: retryReviewTitle } : {}),
    },
    {
      kind: "github",
      label: "View Issue",
      enabled: true,
    },
    {
      kind: "delete-worktree",
      label: "Delete Worktree",
      enabled: deleteEnabled,
      ...(deleteTitle !== undefined ? { title: deleteTitle } : {}),
    },
  ];
}

/**
 * B5 honest session line for the job caption: spells out the exact attach
 * condition (ready / attaching with elapsed / overdue past the visible
 * timeout / absent) instead of the generic "appears when attached".
 * Pure string helper over `IssueFactoryJob` (no hooks) so offline tests
 * cover it via `sessionAttachState`. Never throws.
 */
export function describeFactorySessionLine(factory: {
  sessionUrl?: string | null;
  stage?: string;
  terminal?: boolean;
  createdAtMs?: number | null;
}): string {
  try {
    const active = factory.terminal !== true && factory.stage !== "Cancelled";
    const state = sessionAttachState({
      sessionUrl: factory.sessionUrl ?? null,
      active,
      createdAtMs:
        typeof factory.createdAtMs === "number" ? factory.createdAtMs : null,
    });
    if (state.kind === "ready") {
      return "";
    }
    if (state.kind === "attaching") {
      const age = formatElapsedShort(state.elapsedMs);
      return age !== ""
        ? ` · attaching the live session… (${age} elapsed).`
        : " · attaching the live session…";
    }
    if (state.kind === "overdue") {
      const age = formatElapsedShort(state.elapsedMs);
      return age !== ""
        ? ` · live session never attached after ${age} — the daemon sets the link only when its session handshake succeeds.`
        : " · live session never attached — the daemon sets the link only when its session handshake succeeds.";
    }
    return " · live session link appears when the daemon attaches it.";
  } catch {
    return " · live session link appears when the daemon attaches it.";
  }
}

/** Live effective label + gate status for invoke-time honesty guards. */
function readLiveEffective(
  issueNumber: number,
  prNumber: number | undefined,
): { effective: string | null; gateStatus: "idle" | "running" | "pass" | "fail" } {
  try {
    const s = useIssueReviewStore.getState();
    const labels =
      (prNumber !== undefined
        ? s.labelsByPr[issueNumber]?.[prNumber]
        : undefined) ??
      s.labelsByIssue[issueNumber] ??
      [];
    const safeLabels = Array.isArray(labels)
      ? labels.filter((entry): entry is string => typeof entry === "string")
      : [];
    const rawVerdict =
      (prNumber !== undefined
        ? s.verdictByPr[issueNumber]?.[prNumber]
        : undefined) ??
      s.verdictByIssue[issueNumber] ??
      null;
    const gateStatus =
      prNumber !== undefined
        ? useIssueGateStore.getState().gateByPr[issueNumber]?.[prNumber]?.status
        : undefined;
    return {
      effective: effectiveReviewLabel(safeLabels, rawVerdict ?? null),
      gateStatus: normalizeGateStatus(gateStatus),
    };
  } catch {
    return { effective: null, gateStatus: "idle" };
  }
}

function liveReportPath(
  issueNumber: number,
  prNumber: number | undefined,
): string | null {
  if (prNumber === undefined) return null;
  try {
    const report =
      useIssueGateStore.getState().gateByPr[issueNumber]?.[prNumber]
        ?.reportPath;
    return typeof report === "string" && report !== "" ? report : null;
  } catch {
    return null;
  }
}

/**
 * Intake phase for Warp Resolve jobs. Mirrors the FactoryLab create default
 * (`diagnosisLlm`): the daemon pipeline (foreman→triage→spec→implement→
 * verify→review→merge) starts from Intake regardless — the phase only seeds
 * the job record, it never skips pipeline stages.
 */
const FACTORY_RESOLVE_PHASE = "diagnosisLlm";

/**
 * Issue numbers with a factory create currently in flight (module-level
 * mutex: single invoke per click for the async resolve path — the canvas
 * global busy flags cannot debounce the factory flow). Entries are added
 * before the first await and deleted in `finally`: never leaks, never
 * throws.
 */
const factoryResolveInFlight = new Set<number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
}

/** Honest user feedback that never breaks the invoke path. */
function safeNotify(
  notify: ((message: string) => void) | undefined,
  message: string,
): void {
  try {
    if (typeof notify === "function") notify(message);
  } catch {
    // display callbacks must never break the invoke path
  }
}

/**
 * Daemon job id for the human-gate POSTs. Mirrors the `isValidId` rules
 * in `factoryClient` (trimmed, 1–128 chars, no traversal) without
 * importing it (this module only uses the client's ops). Null when
 * unusable — callers refuse instead of building a broken URL.
 * Never throws.
 */
function cleanFactoryJobId(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 128) return null;
    if (
      trimmed === "." ||
      trimmed === ".." ||
      trimmed.includes("..") ||
      trimmed.includes("/") ||
      trimmed.includes("\\") ||
      trimmed.includes("\0")
    ) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Recorded isolated worktree path for the delete confirm copy. Trimmed,
 * bounded, no NUL — anything else reads as absent (callers disable
 * instead of deleting an unknown folder). Never throws.
 */
function cleanWorktreePath(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 1024) return null;
    if (trimmed.includes("\0")) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Human triage answers for `POST …/triage/respond` (mirror of the
 * daemon `parseTriageRespondBody` / renderer `normalizeTriageAnswers`:
 * trim, drop empties, cap 500 chars × 10 answers). Empty array = nothing
 * worth sending (the daemon would 400). Never throws.
 */
function cleanTriageAnswers(value: unknown): string[] {
  try {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const entry of value) {
      if (out.length >= 10) break;
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      out.push(trimmed.slice(0, 500));
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Daemon job ids with a human-gate POST currently in flight
 * (module-level mutex, same pattern as `factoryResolveInFlight`: single
 * invoke per click for the async human paths — one gate action at a time
 * per job). Entries are added before the first await and deleted in
 * `finally`: never leaks, never throws.
 */
const factoryHumanActionInFlight = new Set<string>();

/** Seam wrapper: structural `{ok, error}`, throwing fakes included. */
async function safeHumanAction(
  call: () => Promise<FactoryHumanActionResult>,
): Promise<FactoryHumanActionResult> {
  try {
    const res = await call();
    if (isRecord(res) && res.ok === true) {
      const summary =
        typeof res.summary === "string" && res.summary.length > 0
          ? res.summary.slice(0, 300)
          : undefined;
      return summary !== undefined ? { ok: true, error: "", summary } : { ok: true, error: "" };
    }
    const error =
      isRecord(res) && typeof res.error === "string" ? res.error : "";
    return { ok: false, error };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** Live Approve seam: `POST …/spec/approve` with explicit timeout. */
async function liveApproveSpec(
  jobId: string,
): Promise<FactoryHumanActionResult> {
  const res = await postFactorySpecApprove(jobId, {
    timeoutMs: FACTORY_SPEC_TIMEOUT_MS,
  });
  return { ok: res.ok, error: res.ok ? "" : res.error };
}

/** Live Reject-spec seam: `POST …/spec/reject` with explicit timeout. */
async function liveRejectSpec(
  jobId: string,
  feedback?: string,
): Promise<FactoryHumanActionResult> {
  const res = await postFactorySpecReject(jobId, feedback, {
    timeoutMs: FACTORY_SPEC_TIMEOUT_MS,
  });
  return { ok: res.ok, error: res.ok ? "" : res.error };
}

/** Live Resume seam: `POST …/resume` with explicit timeout. */
async function liveResume(
  jobId: string,
): Promise<FactoryHumanActionResult> {
  const res = await postFactoryResume(jobId, {
    timeoutMs: FACTORY_SPEC_TIMEOUT_MS,
  });
  return { ok: res.ok, error: res.ok ? "" : res.error };
}

/**
 * Discard teardown summary for the notify (pure, never throws). The daemon
 * answers every step honestly (`cleaned`: prClosed / branchDeleted /
 * worktreeRemoved / deleted / restored / jobDeleted / skipped) — showing it
 * prevents the old blanket "everything removed" claim when a step was
 * skipped (e.g. `git push --delete` offline). Empty string when the payload
 * carries no legible `cleaned` (callers then keep the plain success line).
 */
export function summarizeDiscardCleaned(data: unknown): string {
  try {
    if (!isRecord(data)) return "";
    const cleaned = (data as { cleaned?: unknown }).cleaned;
    if (!isRecord(cleaned)) return "";
    const list = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
    const prClosed = list(cleaned.prClosed).length;
    const branchDeleted = list(cleaned.branchDeleted).length;
    const worktreeRemoved = list(cleaned.worktreeRemoved).length;
    const deleted = list(cleaned.deleted).length;
    const restored = list(cleaned.restored).length;
    const jobDeleted = cleaned.jobDeleted === true;
    const skipped = list(cleaned.skipped);
    const parts = [
      `PR closed: ${prClosed}`,
      `branch deleted: ${branchDeleted}`,
      `worktree removed: ${worktreeRemoved}`,
      `files deleted/restored: ${deleted}/${restored}`,
      `job deleted: ${jobDeleted ? "yes" : "NO"}`,
    ];
    let out = parts.join(", ");
    if (skipped.length > 0) {
      out += ` — skipped: ${skipped.slice(0, 3).join("; ")}${skipped.length > 3 ? "…" : ""}`;
    }
    return out.slice(0, 300);
  } catch {
    return "";
  }
}

/** Live Discard seam: `POST …/discard` with the full-teardown timeout. */
async function liveDiscard(
  jobId: string,
): Promise<FactoryHumanActionResult> {
  const res = await postFactoryJobDiscard(jobId, {
    timeoutMs: FACTORY_DISCARD_TIMEOUT_MS,
  });
  if (!res.ok) return { ok: false, error: res.error };
  const summary = summarizeDiscardCleaned(res.data);
  return summary !== "" ? { ok: true, error: "", summary } : { ok: true, error: "" };
}

/** Live Re-review seam: `POST …/review/rerun` with explicit timeout. */
async function liveRerunReview(
  jobId: string,
): Promise<FactoryHumanActionResult> {
  const res = await postFactoryReviewRerun(jobId, {
    timeoutMs: FACTORY_REVIEW_ACTION_TIMEOUT_MS,
  });
  if (!res.ok) return { ok: false, error: res.error };
  try {
    const data = res.data as Record<string, unknown>;
    const verdict = typeof data.verdict === "string" ? data.verdict : "review";
    const findings = typeof data.findings === "number" ? data.findings : 0;
    const summary = typeof data.summary === "string" ? data.summary : "";
    return {
      ok: true,
      error: "",
      summary: `re-review ${verdict} (${findings} findings): ${summary.slice(0, 200)}`,
    };
  } catch {
    return { ok: true, error: "" };
  }
}

/** Live Respond seam: `POST …/triage/respond` with explicit timeout. */
async function liveRespondTriage(
  jobId: string,
  answers: string[],
): Promise<FactoryHumanActionResult> {
  const res = await postFactoryTriageRespond(jobId, answers, {
    timeoutMs: FACTORY_TRIAGE_TIMEOUT_MS,
  });
  return { ok: res.ok, error: res.ok ? "" : res.error };
}

/** Live Accept seam: `POST …/review/accept` with explicit timeout. */
async function liveAcceptReview(
  jobId: string,
): Promise<FactoryHumanActionResult> {
  const res = await postFactoryReviewAccept(jobId, {
    timeoutMs: FACTORY_REVIEW_ACTION_TIMEOUT_MS,
  });
  return { ok: res.ok, error: res.ok ? "" : res.error };
}

/** Live Reject seam: `POST …/review/retry` with explicit timeout. */
async function liveRejectReview(
  jobId: string,
): Promise<FactoryHumanActionResult> {
  const res = await postFactoryReviewRetry(jobId, {
    timeoutMs: FACTORY_REVIEW_ACTION_TIMEOUT_MS,
  });
  return { ok: res.ok, error: res.ok ? "" : res.error };
}

/** Live Retry-review seam: `POST …/review/retry-review` (review only). */
async function liveRetryReviewOnly(
  jobId: string,
): Promise<FactoryHumanActionResult> {
  const res = await postFactoryReviewRetryReview(jobId, {
    timeoutMs: FACTORY_REVIEW_ACTION_TIMEOUT_MS,
  });
  return { ok: res.ok, error: res.ok ? "" : res.error };
}

/** Live Delete seam: `DELETE …/jobs/:id/worktree` with explicit timeout. */
async function liveDeleteWorktree(
  jobId: string,
  force: boolean,
): Promise<FactoryWorktreeDeleteResult> {
  const res = await deleteFactoryJobWorktree(jobId, {
    timeoutMs: FACTORY_WORKTREE_DELETE_TIMEOUT_MS,
    ...(force ? { force: true } : {}),
  });
  if (res.ok) return { ok: true, error: "", status: res.status };
  return { ok: false, error: res.error, status: res.status };
}

/** Seam wrapper for the delete path (throwing fakes included). */
async function safeWorktreeDelete(
  call: () => Promise<FactoryWorktreeDeleteResult>,
): Promise<FactoryWorktreeDeleteResult> {
  try {
    const res = await call();
    if (isRecord(res) && res.ok === true) {
      const status =
        typeof res.status === "number" && Number.isFinite(res.status)
          ? res.status
          : null;
      return { ok: true, error: "", status };
    }
    const error =
      isRecord(res) && typeof res.error === "string" ? res.error : "";
    const status =
      isRecord(res) &&
      typeof res.status === "number" &&
      Number.isFinite(res.status)
        ? (res.status as number)
        : null;
    return { ok: false, error, status };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      status: null,
    };
  }
}

/**
 * True when a delete refusal smells like a force-gated 409 (dirty
 * worktree, open/unknown PR) rather than a hard failure — the panel
 * escalates those to the second confirm (canvas dirty→force parity)
 * instead of reporting them as final. Never throws.
 */
function isForceableDeleteRefusal(error: unknown): boolean {
  try {
    if (typeof error !== "string" || error.trim() === "") return false;
    return /uncommitted|modified or untracked|pass force|still open|unknown/i.test(
      error,
    );
  } catch {
    return false;
  }
}

/** Worktree-delete in-flight mutex (one delete per job at a time). */
const factoryWorktreeDeleteInFlight = new Set<string>();

/** Stale-button backstop: refuses when an expected kind mismatches. */
function humanKindMismatch(
  expected: string,
  actual: unknown,
): boolean {
  try {
    if (actual === undefined || actual === null) return false;
    if (typeof actual !== "string" || actual.trim() === "") return false;
    return actual !== expected;
  } catch {
    return false;
  }
}

/**
 * Existing factory poll list (zero new polls). Live default reads the
 * `useWorkItemStore` items populated by the shared `useWorkItemsPolling`
 * 2.5s loop (single owner, whichever shell is mounted). Empty when the
 * poll never ran — honest, callers treat it as "no evidence of work",
 * never as "daemon down".
 */
function liveFactoryJobs(): unknown[] {
  try {
    const items = useWorkItemStore.getState().workItems;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/** Health seam with explicit short timeout. Never throws. */
async function safeFactoryHealth(
  check: (() => Promise<FactoryResolveHealth>) | undefined,
): Promise<FactoryResolveHealth> {
  try {
    if (typeof check === "function") {
      const res = await check();
      if (isRecord(res) && res.ok === true) return { ok: true, error: "" };
      const error =
        isRecord(res) && typeof res.error === "string" ? res.error : "";
      return { ok: false, error };
    }
    const res = await getFactoryHealth({
      timeoutMs: FACTORY_HEALTH_TIMEOUT_MS,
    });
    return res.ok
      ? { ok: true, error: "" }
      : { ok: false, error: res.error };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/** Create seam with explicit timeout. Never throws. */
async function safeFactoryCreate(
  create: unknown,
  input: FactoryResolveCreateInput,
): Promise<FactoryResolveCreateResult> {
  try {
    if (typeof create === "function") {
      const res = await (
        create as (
          input: FactoryResolveCreateInput,
        ) => Promise<FactoryResolveCreateResult>
      )(input);
      if (isRecord(res) && res.ok === true && typeof res.id === "string" && res.id !== "") {
        return { ok: true, id: res.id, error: "" };
      }
      const error =
        isRecord(res) && typeof res.error === "string" ? res.error : "";
      return { ok: false, id: null, error };
    }
    const res = await createFactoryJob(
      {
        prompt: input.prompt,
        worktree: input.worktree,
        phase: input.phase,
        issueRef: { ...(input.issueRef as unknown as Record<string, unknown>) },
      },
      { timeoutMs: FACTORY_JOB_CREATE_TIMEOUT_MS },
    );
    if (!res.ok || typeof res.data?.id !== "string" || res.data.id === "") {
      return {
        ok: false,
        id: null,
        error: res.ok ? "factory returned no job id" : res.error,
      };
    }
    return { ok: true, id: res.data.id, error: "" };
  } catch (e) {
    return {
      ok: false,
      id: null,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    };
  }
}

/**
 * The SINGLE code path from the panel into handler refs /
 * `overrideGateForIssue` / `fs.readFile` / `openIssueInGitHub` / the
 * factory daemon (resolve only).
 * Best-effort, never throws: unknown kinds, invalid issue numbers, busy
 * guards, and missing handlers resolve silently (single invoke per click;
 * global busy flags already debounce double-clicks). Factory resolve
 * failures are NEVER silent: they surface through the injected `notify()`
 * message (never a dead click, never a retry).
 */
export async function invokeActivityAction(
  kind: ActivityActionKind,
  issueNumber: number,
  prNumber?: number,
  deps?: ActivityInvokeDeps,
): Promise<void> {
  if (
    typeof issueNumber !== "number" ||
    !Number.isInteger(issueNumber) ||
    issueNumber <= 0
  ) {
    return;
  }
  const pr =
    typeof prNumber === "number" && Number.isFinite(prNumber)
      ? prNumber
      : undefined;
  let liveResolving = false;
  let liveReviewing = false;
  let liveFixing = false;
  let liveMerging = false;
  let liveResolvingConflict = false;
  try {
    liveResolving =
      useIssueResolveStore.getState().resolvingIssueNumber !== null;
    const reviewState = useIssueReviewStore.getState();
    liveReviewing = reviewState.reviewingIssueNumber !== null;
    liveFixing = reviewState.fixingIssueNumber !== null;
    liveMerging = reviewState.mergingIssueNumber !== null;
    liveResolvingConflict =
      reviewState.resolvingConflictIssueNumber !== null;
  } catch {
    // Stores unavailable — fall back to injected busy flags only.
  }
  const busy = {
    resolving: deps?.busy?.resolving ?? liveResolving,
    reviewing: deps?.busy?.reviewing ?? liveReviewing,
    fixing: deps?.busy?.fixing ?? liveFixing,
    merging: deps?.busy?.merging ?? liveMerging,
    resolvingConflict: deps?.busy?.resolvingConflict ?? liveResolvingConflict,
  };
  // Human-gate backstop mirror of the describe guard (`busy.anyActive`):
  // a human gate must not race live agent work, however the flags arrive.
  const anyBusy =
    busy.resolving ||
    busy.reviewing ||
    busy.fixing ||
    busy.merging ||
    busy.resolvingConflict ||
    deps?.busy?.anyActive === true;

  switch (kind) {
    case "resolve": {
      if (busy.resolving) return;
      // In-flight factory mutex: a second click while the create is in
      // flight refuses silently (the CTA shows `Resolving…` once the poll
      // list carries the job). Cleared on settle — never leaks.
      if (factoryResolveInFlight.has(issueNumber)) return;
      // Blocked-by gate (invoke-time backstop for the disabled CTA above —
      // same shared rule as the canvas card). Never throws.
      if (
        resolveBlockedGate(
          (Array.isArray(deps?.blockedByBlockers)
            ? deps.blockedByBlockers
            : []
          ).map((n) => ({ kind: "blockedBy", number: n, state: "OPEN" })),
        ).blocked
      ) {
        return;
      }
      // Factory busy-match against the EXISTING poll list (matched by
      // `issueRef`, zero new polls). The CTA was disabled — silent return.
      try {
        const jobs = Array.isArray(deps?.factoryJobs)
          ? deps.factoryJobs
          : liveFactoryJobs();
        const issueUrl =
          typeof deps?.issue?.url === "string"
            ? (deps.issue.url as string)
            : typeof deps?.issueUrl === "string"
              ? deps.issueUrl
              : undefined;
        if (
          findActiveFactoryJobForIssue(
            jobs,
            issueNumber,
            parseGitHubIssueRepo(issueUrl),
          ) !== null
        ) {
          return;
        }
      } catch {
        // matching is best-effort; a broken list never blocks the resolve
      }
      // The daemon needs a worktree: absent on legacy rows → honest notify,
      // never a dead click and never a 400 against the daemon.
      const worktree =
        typeof deps?.worktreePath === "string"
          ? deps.worktreePath.trim()
          : "";
      if (worktree === "") {
        safeNotify(
          deps?.notify,
          `Cannot resolve #${issueNumber} with Factory: this issue has no worktree path yet. Open it from the canvas first.`,
        );
        return;
      }
      factoryResolveInFlight.add(issueNumber);
      try {
        // Daemon-down guard with explicit short timeout (honest disabled
        // CTA has this same evidence; the probe here is the backstop).
        const health = await safeFactoryHealth(deps?.checkFactoryHealth);
        if (health.ok !== true) {
          const why =
            typeof health.error === "string" && health.error !== ""
              ? ` (${health.error})`
              : "";
          safeNotify(
            deps?.notify,
            `Factory daemon is not available${why}. Start the daemon, then resolve again.`,
          );
          return;
        }
        const snapshot = isRecord(deps?.issue) ? deps.issue : {};
        const url =
          typeof (snapshot as FactoryResolveIssueSnapshot).url === "string"
            ? ((snapshot as FactoryResolveIssueSnapshot).url as string)
            : typeof deps?.issueUrl === "string"
              ? deps.issueUrl
              : undefined;
        const prompt = buildFactoryResolvePrompt({
          issueNumber,
          title: (snapshot as FactoryResolveIssueSnapshot).title,
          body: (snapshot as FactoryResolveIssueSnapshot).body,
          labels: (snapshot as FactoryResolveIssueSnapshot).labels,
          url,
        });
        const created = await safeFactoryCreate(
          deps?.createFactoryJob,
          {
            prompt,
            worktree,
            phase: FACTORY_RESOLVE_PHASE,
            issueRef: buildFactoryJobIssueRef({ issueNumber, url }),
          },
        );
        if (
          created.ok !== true ||
          typeof created.id !== "string" ||
          created.id === ""
        ) {
          const why =
            typeof created.error === "string" && created.error !== ""
              ? `: ${created.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not create the factory job for #${issueNumber}${why}.`,
          );
          return;
        }
        safeNotify(
          deps?.notify,
          `Factory job ${created.id} created for #${issueNumber} — follow it in In Progress.`,
        );
      } finally {
        factoryResolveInFlight.delete(issueNumber);
      }
      return;
    }
    case "review": {
      if (busy.resolving || busy.reviewing || busy.fixing) return;
      const handler =
        deps?.reviewHandler ??
        safeHandler(() => useIssueReviewStore.getState().reviewHandler);
      handler?.(issueNumber, pr);
      return;
    }
    case "fix": {
      if (busy.resolving || busy.reviewing || busy.fixing) return;
      const handler =
        deps?.fixHandler ??
        safeHandler(() => useIssueReviewStore.getState().fixHandler);
      handler?.(issueNumber, pr);
      return;
    }
    case "merge": {
      if (busy.merging) return;
      const handler =
        deps?.mergeHandler ??
        safeHandler(() => useIssueReviewStore.getState().mergeHandler);
      handler?.(issueNumber, pr);
      return;
    }
    case "conflict": {
      if (
        busy.resolvingConflict ||
        busy.resolving ||
        busy.reviewing ||
        busy.fixing
      ) {
        return;
      }
      const handler =
        deps?.resolveConflictHandler ??
        safeHandler(
          () => useIssueReviewStore.getState().resolveConflictHandler,
        );
      handler?.(issueNumber, pr);
      return;
    }
    case "override-gate": {
      if (pr === undefined) return;
      // Manual escape, same as the canvas card: only when the gate failed,
      // then back into the review flow on success.
      const live = readLiveEffective(issueNumber, pr);
      if (
        live.effective !== REVIEW_LABEL_GATE_FAIL &&
        live.gateStatus !== "fail"
      ) {
        return;
      }
      const repoPath =
        typeof deps?.worktreePath === "string" ? deps.worktreePath : "";
      const override = deps?.overrideGate ?? overrideGateForIssue;
      let ok = false;
      try {
        ok = await override({ repoPath, issueNumber, prNumber: pr });
      } catch {
        ok = false;
      }
      if (!ok) return;
      if (busy.resolving || busy.reviewing || busy.fixing) return;
      const handler =
        deps?.reviewHandler ??
        safeHandler(() => useIssueReviewStore.getState().reviewHandler);
      handler?.(issueNumber, pr);
      return;
    }
    case "view-report": {
      // Read-only view, never blocks. The content is delivered through
      // `onReport` for the panel to display.
      const path =
        typeof deps?.reportPath === "string" && deps.reportPath !== ""
          ? deps.reportPath
          : liveReportPath(issueNumber, pr);
      if (path === null) {
        deps?.onReport?.({ path: "", content: null });
        return;
      }
      let content: string | null = null;
      try {
        const result =
          deps?.readFile !== undefined
            ? await deps.readFile(path)
            : await window.termcanvas.fs.readFile(path);
        if (
          result !== null &&
          typeof result === "object" &&
          "content" in result &&
          typeof (result as { content?: unknown }).content === "string"
        ) {
          content = (result as { content: string }).content;
        }
      } catch {
        content = null;
      }
      try {
        deps?.onReport?.({ path, content });
      } catch {
        // Display callback must never break the invoke path.
      }
      return;
    }
    case "github": {
      const url =
        typeof deps?.issueUrl === "string" ? deps.issueUrl : undefined;
      if (deps?.openUrl !== undefined) {
        if (url) {
          try {
            deps.openUrl(url);
          } catch {
            // External open is best-effort.
          }
        }
        return;
      }
      try {
        openIssueInGitHub(url);
      } catch {
        // External open is best-effort (no-op without URL).
      }
      return;
    }
    case "session": {
      // Live agent session in a new tab (same external bridge as
      // `github`). Without a live URL this is an honest notify — never a
      // dead tab, never a guessed URL. No handler, no fetch.
      const liveUrl =
        typeof deps?.sessionUrl === "string" ? deps.sessionUrl.trim() : "";
      if (liveUrl === "" || !/^https?:\/\//i.test(liveUrl)) {
        safeNotify(
          deps?.notify,
          "The live agent session is not available yet — it appears when the daemon attaches the session to the job.",
        );
        return;
      }
      if (deps?.openUrl !== undefined) {
        try {
          deps.openUrl(liveUrl);
        } catch {
          // External open is best-effort.
        }
        return;
      }
      try {
        openIssueInGitHub(liveUrl);
      } catch {
        // External open is best-effort (no-op without URL).
      }
      return;
    }
    case "approve-spec": {
      // Human approves the pending spec: POST …/spec/approve (existing
      // daemon route, Triage→Foreman). Best-effort + honest notify, like
      // resolve: success and daemon 404/409s surface through `notify()`,
      // never a dead click, never a retry.
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      if (humanKindMismatch("spec-approval", deps?.factoryAwaitingKind)) {
        return;
      }
      if (anyBusy) {
        return;
      }
      if (factoryHumanActionInFlight.has(jobId)) return;
      factoryHumanActionInFlight.add(jobId);
      try {
        const res = await safeHumanAction(() =>
          deps?.approveSpecJob !== undefined
            ? deps.approveSpecJob(jobId)
            : liveApproveSpec(jobId),
        );
        if (res.ok === true) {
          safeNotify(
            deps?.notify,
            `Spec approved for job ${jobId} — the job resumes in Foreman.`,
          );
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not approve the spec for job ${jobId}${why}.`,
          );
        }
      } finally {
        factoryHumanActionInFlight.delete(jobId);
      }
      return;
    }
    case "reject-spec": {
      // Human rejects the drafted spec: POST …/spec/reject (existing
      // daemon route, stays in Triage). The daemon regenerates the brief;
      // the row shows the new approval gate when it lands. Best-effort +
      // honest notify, like approve: success and daemon 404/409s surface
      // through `notify()`, never a dead click, never a retry.
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      if (humanKindMismatch("spec-approval", deps?.factoryAwaitingKind)) {
        return;
      }
      if (anyBusy) {
        return;
      }
      if (factoryHumanActionInFlight.has(jobId)) return;
      factoryHumanActionInFlight.add(jobId);
      try {
        const res = await safeHumanAction(() =>
          deps?.rejectSpecJob !== undefined
            ? deps.rejectSpecJob(jobId)
            : liveRejectSpec(jobId),
        );
        if (res.ok === true) {
          safeNotify(
            deps?.notify,
            `Spec rejected for job ${jobId} — the agent drafts a new brief.`,
          );
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not reject the spec for job ${jobId}${why}.`,
          );
        }
      } finally {
        factoryHumanActionInFlight.delete(jobId);
      }
      return;
    }
    case "resume": {
      // Human resumes a parked turn: POST …/resume (daemon re-drives the
      // phase worker where the turn stood). Best-effort + honest notify,
      // like the other gates: success and daemon 404/409s surface through
      // `notify()`, never a dead click, never a retry.
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      if (humanKindMismatch("resume", deps?.factoryAwaitingKind)) {
        return;
      }
      if (anyBusy) {
        return;
      }
      if (factoryHumanActionInFlight.has(jobId)) return;
      factoryHumanActionInFlight.add(jobId);
      try {
        const res = await safeHumanAction(() =>
          deps?.resumeJob !== undefined
            ? deps.resumeJob(jobId)
            : liveResume(jobId),
        );
        if (res.ok === true) {
          safeNotify(
            deps?.notify,
            `Resumed job ${jobId} — the phase worker picks it up.`,
          );
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not resume job ${jobId}${why}.`,
          );
        }
      } finally {
        factoryHumanActionInFlight.delete(jobId);
      }
      return;
    }
    case "discard": {
      // Human abandons a parked turn: descarta TODOS los jobs activos
      // linkeados al issue en un click (un issue puede acumular varios
      // jobs parados; uno por click dejaba la fila viva). Cada job va por
      // POST …/discard (teardown completo: PR close, rama/worktree/job
      // fuera). Best-effort + honest notify, como los otros gates: nunca
      // un click muerto, nunca un retry. El panel confirma ANTES de
      // invocar (destructivo) — a esta altura ya confirmó.
      if (humanKindMismatch("resume", deps?.factoryAwaitingKind)) {
        return;
      }
      if (anyBusy) {
        return;
      }
      // Targets: todos los linkeados activos (tope 10 del helper) + el
      // job del gate como respaldo si la lista no trae nada (fila vieja).
      const gateJobId = cleanFactoryJobId(deps?.factoryJobId);
      let targets: string[] = [];
      try {
        const list = Array.isArray(deps?.factoryJobs) ? deps.factoryJobs : [];
        const repo =
          typeof deps?.issueUrl === "string" ? parseGitHubIssueRepo(deps.issueUrl) : null;
        targets = findActiveFactoryJobsForIssue(list, issueNumber, repo);
      } catch {
        targets = [];
      }
      if (targets.length === 0 && gateJobId !== null) targets = [gateJobId];
      if (targets.length === 0) return;
      const doDiscard =
        deps?.discardJob !== undefined ? deps.discardJob : liveDiscard;
      let okCount = 0;
      let firstError = "";
      let firstSummary = "";
      // Secuencial sobre la lista finita (sin loops sin cota: forEach no
      // aplica acá por el await; el for corre sobre ≤10 targets).
      for (const targetId of targets) {
        if (factoryHumanActionInFlight.has(targetId)) continue;
        factoryHumanActionInFlight.add(targetId);
        try {
          const res = await safeHumanAction(() => doDiscard(targetId));
          if (res.ok === true) {
            okCount += 1;
            if (firstSummary === "" && typeof res.summary === "string") {
              firstSummary = res.summary;
            }
          } else if (firstError === "") {
            firstError = res.error;
          }
        } finally {
          factoryHumanActionInFlight.delete(targetId);
        }
      }
      if (okCount > 0) {
        // The work no longer exists: drop the cached PR/verdict/labels for
        // this issue and reconcile against GitHub. Without this the row
        // stays merge-ready forever (cached OPEN PR) or in-review (stale
        // verdict) even though job/branch/PR were just torn down.
        try {
          useIssueReviewStore.getState().invalidateIssueReviewState(issueNumber);
          useIssueReviewStore
            .getState()
            .requestPrLookup(issueNumber, deps?.worktreePath, true);
        } catch {
          // best-effort: the notify below is still honest
        }
        if (okCount === 1) {
          // With a daemon summary, report the real steps instead of the
          // blanket "everything removed" claim (skips stay visible).
          safeNotify(
            deps?.notify,
            firstSummary !== ""
              ? `Discarded job ${targets[0]} — ${firstSummary}.`
              : `Discarded job ${targets[0]} — PR closed, branch/worktree/job removed.`,
          );
        } else {
          safeNotify(
            deps?.notify,
            `Discarded ${okCount} jobs — PRs closed, branches/worktrees/jobs removed.`,
          );
        }
      } else {
        safeNotify(
          deps?.notify,
          `Could not discard job ${targets[0]}${firstError !== "" ? `: ${firstError}` : "."}`,
        );
      }
      return;
    }
    case "re-review": {
      // Human re-runs the review on a merge-ready row: POST …/review/rerun
      // (the job stays Complete; the verdict is reported, nothing reopens
      // alone). Rows on a human gate use their own buttons — a stale gate
      // kind refuses silently here.
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      if (
        typeof deps?.factoryAwaitingKind === "string" &&
        deps.factoryAwaitingKind.trim() !== ""
      ) {
        return;
      }
      if (anyBusy) {
        return;
      }
      if (factoryHumanActionInFlight.has(jobId)) return;
      factoryHumanActionInFlight.add(jobId);
      try {
        const res = await safeHumanAction(() =>
          deps?.rerunReviewJob !== undefined
            ? deps.rerunReviewJob(jobId)
            : liveRerunReview(jobId),
        );
        if (res.ok === true) {
          safeNotify(
            deps?.notify,
            typeof res.summary === "string" && res.summary.length > 0
              ? `Job ${jobId}: ${res.summary}`
              : `Re-review done for job ${jobId}.`,
          );
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not re-review job ${jobId}${why}.`,
          );
        }
      } finally {
        factoryHumanActionInFlight.delete(jobId);
      }
      return;
    }
    case "triage-respond": {
      // Human answers the triage questions: POST …/triage/respond
      // (existing daemon route, Triage→Foreman). Empty answers never hit
      // the network (the daemon would 400): honest notify instead.
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      if (humanKindMismatch("triage-respond", deps?.factoryAwaitingKind)) {
        return;
      }
      if (anyBusy) {
        return;
      }
      const answers = cleanTriageAnswers(deps?.triageAnswers);
      if (answers.length === 0) {
        safeNotify(
          deps?.notify,
          "Write at least one answer before responding — empty answers are rejected.",
        );
        return;
      }
      if (factoryHumanActionInFlight.has(jobId)) return;
      factoryHumanActionInFlight.add(jobId);
      try {
        const res = await safeHumanAction(() =>
          deps?.respondTriageJob !== undefined
            ? deps.respondTriageJob(jobId, answers)
            : liveRespondTriage(jobId, answers),
        );
        if (res.ok === true) {
          safeNotify(
            deps?.notify,
            `Answers sent for job ${jobId} — the job resumes in Foreman.`,
          );
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not send the answers for job ${jobId}${why}.`,
          );
        }
      } finally {
        factoryHumanActionInFlight.delete(jobId);
      }
      return;
    }
    case "review-accept": {
      // Human accepts an ask_human job as-is: POST …/review/accept
      // (existing daemon route, "humano acepta igual", Review→Complete).
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      if (humanKindMismatch("ask-human", deps?.factoryAwaitingKind)) {
        return;
      }
      if (anyBusy) {
        return;
      }
      if (factoryHumanActionInFlight.has(jobId)) return;
      factoryHumanActionInFlight.add(jobId);
      try {
        const res = await safeHumanAction(() =>
          deps?.acceptReviewJob !== undefined
            ? deps.acceptReviewJob(jobId)
            : liveAcceptReview(jobId),
        );
        if (res.ok === true) {
          safeNotify(
            deps?.notify,
            `Job ${jobId} accepted — Review → Complete.`,
          );
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not accept job ${jobId}${why}.`,
          );
        }
      } finally {
        factoryHumanActionInFlight.delete(jobId);
      }
      return;
    }
    case "review-reject": {
      // Human rejects an ask_human job: POST …/review/retry (existing
      // daemon route, "humano manda a Building", Review→Building for
      // rework — FactoryLab ReviewPanel "Mandar a Building" parity).
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      if (humanKindMismatch("ask-human", deps?.factoryAwaitingKind)) {
        return;
      }
      if (anyBusy) {
        return;
      }
      if (factoryHumanActionInFlight.has(jobId)) return;
      factoryHumanActionInFlight.add(jobId);
      try {
        const res = await safeHumanAction(() =>
          deps?.rejectReviewJob !== undefined
            ? deps.rejectReviewJob(jobId)
            : liveRejectReview(jobId),
        );
        if (res.ok === true) {
          safeNotify(
            deps?.notify,
            `Job ${jobId} rejected — sent back to Building for rework.`,
          );
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not reject job ${jobId}${why}.`,
          );
        }
      } finally {
        factoryHumanActionInFlight.delete(jobId);
      }
      return;
    }
    case "review-retry": {
      // Human retries ONLY the review: POST …/review/retry-review
      // (existing daemon route — re-runs the review agent on the kept
      // implement output, stays in Review). Primary action when the
      // previous attempt never ran due to an infra error.
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      if (humanKindMismatch("ask-human", deps?.factoryAwaitingKind)) {
        return;
      }
      if (anyBusy) {
        return;
      }
      if (factoryHumanActionInFlight.has(jobId)) return;
      factoryHumanActionInFlight.add(jobId);
      try {
        const res = await safeHumanAction(() =>
          deps?.retryReviewJob !== undefined
            ? deps.retryReviewJob(jobId)
            : liveRetryReviewOnly(jobId),
        );
        if (res.ok === true) {
          safeNotify(
            deps?.notify,
            `Review re-run queued for job ${jobId} — stays in Review.`,
          );
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          safeNotify(
            deps?.notify,
            `Could not retry the review for job ${jobId}${why}.`,
          );
        }
      } finally {
        factoryHumanActionInFlight.delete(jobId);
      }
      return;
    }
    case "delete-worktree": {
      // Explicit human cleanup of the row's isolated factory worktree:
      // DELETE …/jobs/:id/worktree (existing daemon route — folder only,
      // the branch is NEVER deleted by the daemon). Best-effort + honest
      // notify, like resolve: the daemon 404/409/500s surface through
      // `notify()` and `onWorktreeDelete` (the panel escalates
      // force-gated 409s to the second confirm — canvas dirty→force
      // parity). Never automatic, never retried here.
      const jobId = cleanFactoryJobId(deps?.factoryJobId);
      if (jobId === null) return;
      // The daemon refuses non-terminal deletes (409) and `force` never
      // overrides non-terminality — mirror the guard instead of sending a
      // doomed request.
      if (deps?.factoryTerminal !== true) {
        const message =
          "The job is still running — worktrees can only be removed once the job is terminal.";
        safeNotify(deps?.notify, message);
        try {
          deps?.onWorktreeDelete?.({ ok: false, error: message });
        } catch {
          // Display callback must never break the invoke path.
        }
        return;
      }
      const worktreePath = cleanWorktreePath(deps?.factoryWorktreePath);
      if (worktreePath === null) {
        const message =
          "No isolated worktree recorded for this job — nothing to remove.";
        safeNotify(deps?.notify, message);
        try {
          deps?.onWorktreeDelete?.({ ok: false, error: message });
        } catch {
          // Display callback must never break the invoke path.
        }
        return;
      }
      if (factoryWorktreeDeleteInFlight.has(jobId)) return;
      factoryWorktreeDeleteInFlight.add(jobId);
      try {
        const force = deps?.forceWorktreeDelete === true;
        const res = await safeWorktreeDelete(() =>
          deps?.deleteWorktreeJob !== undefined
            ? deps.deleteWorktreeJob(jobId, { force })
            : liveDeleteWorktree(jobId, force),
        );
        if (res.ok === true) {
          const message =
            `Worktree removed (${worktreePath}) — the branch was kept.`;
          safeNotify(deps?.notify, message);
          try {
            deps?.onWorktreeDelete?.({ ok: true, error: "" });
          } catch {
            // Display callback must never break the invoke path.
          }
        } else {
          const why =
            typeof res.error === "string" && res.error !== ""
              ? `: ${res.error}`
              : "";
          const verdict = isForceableDeleteRefusal(res.error)
            ? `Could not remove the worktree${why} — confirm again to force it.`
            : `Could not remove the worktree${why}.`;
          safeNotify(deps?.notify, verdict);
          try {
            deps?.onWorktreeDelete?.({
              ok: false,
              error: res.error,
            });
          } catch {
            // Display callback must never break the invoke path.
          }
        }
      } finally {
        factoryWorktreeDeleteInFlight.delete(jobId);
      }
      return;
    }
    default: {
      return;
    }
  }
}

/** Read a live handler ref without ever defining one here. */
function safeHandler<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
