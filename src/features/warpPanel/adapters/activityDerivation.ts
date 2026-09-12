import type { IssueNodeData } from "../../../stores/issueStore";
import type { IssueActivityEntry } from "../../../stores/issueActivityStore";
import type { ReviewVerdict } from "../../../stores/issueReviewStore";
import type {
  AwaitingAction,
  FactoryAwaitingKind,
  InProgressPhase,
  Issue,
  IssueStatus,
  KanbanRelation,
} from "../types";
import type { LiveReviewSnapshot } from "./liveIssues";
import {
  REVIEW_LABEL_APPROVED,
  REVIEW_LABEL_CHANGES,
  REVIEW_LABEL_FIX_APPLIED,
  REVIEW_LABEL_PENDING,
  effectiveReviewLabel,
} from "../../../canvas/reviewVerdict";
import {
  isValidIssueNumber,
  mapRelationsFromNode,
  normalizeLabels,
} from "./liveIssues";

/**
 * Pure Activity derivation (T01 data layer).
 *
 * Projects canvas nodes through the Warp workflow lens — the same derivation
 * family as `liveIssues.ts`, projected onto the Figma `Issue` shape
 * (`pending | in-progress | awaiting | done` + `phase` + `awaitingAction`).
 * Zero zustand, zero IPC, never throws.
 *
 * ─── Section membership rule (first match wins) ───
 *
 * A row belongs to exactly one section. Live work beats settled labels;
 * settled labels beat silence; silence is pending; completion needs proof.
 *
 * | #  | Condition                                              | Section |
 * |----|----------------------------------------------------------|---------|
 * | D  | PR state MERGED, or PR in `mergedPrNumbers`, or a MERGED open-PR entry, or node CLOSED | `done` |
 * | I1 | `fixingIssueNumber === n`, or settled `review:fix-aplicado` | `in-progress / fixing` ("Implementing Fix") |
 * | I2 | `reviewingIssueNumber === n`, or gate `running` on the primary PR | `in-progress / reviewing` |
 * | F-A1 | live factory job for the issue waits on spec approval (Triage + `needsSpecApproval`) | `awaiting / spec-approval` ("Approve Spec") |
 * | F-A2 | live factory job for the issue waits on triage answers (Triage + unanswered `openQuestions`) | `awaiting / triage-respond` ("Answer Questions") |
 * | F-A3 | live factory job for the issue waits on a review decision (Review + `lastReview.verdict === "ask_human"`) | `awaiting / ask-human` ("Accept Review") |
 * | F-A4 | fallback: none of the above is legible, but a PENDING `ask_human` notification links to the job by `workItemId` | `awaiting / ask-human` ("Accept Review") |
 * | I3 | `resolvingIssueNumber === n`, or a live factory job linked to the issue (`issueRef` match in the existing poll list) | `in-progress / implementing` (generic phase — see below) |
 * | I4 | `mergingIssueNumber === n` or `resolvingConflictIssueNumber === n` | `in-progress` (no phase — the busy CTA labels win) |
 * | A1 | Settled `review:aprobado` on an OPEN PR                 | `ready / merge-ready` ("Merge PR" — Ready to Merge section) |
 * | A2 | Settled `review:comentado`                               | `awaiting / changes-requested` ("Implement Fix") |
 * | N1 | OPEN PR with a neutral signal (`review:pendiente` or no cycle label/verdict at all) and nothing above claimed the row | `ready / merge-ready` (reviewable evidence, nothing blocking; Merge stays DISABLED until `aprobado` — the shared action matrix requires it) |
 * | C1 | Terminal `Complete` factory job linked to the issue AND an OPEN PR, and nothing above claimed the row | `ready / merge-ready` ("Merge PR" — Ready to Merge section; the human accept that produced `Complete` is the approval; the OPEN PR is the reviewable evidence) |
 * | O  | Optimistic `Complete` seen but PR lookup still in flight (fresh flag, TTL 5min), and nothing above claimed the row | `ready / merge-ready` with Merge DISABLED until reconciled |
 * | P  | Else (fresh OPEN issue: no PR, no verdict, no active op — including a terminal `Complete` with NO linked OPEN PR and no merge evidence, AND any OPEN PR with `review:pendiente` or no cycle label: the canvas-only Review Issue flow does not belong to the warp panel) | `pending` |
 *
 * Real cases grounding the rule (repo FrancoManfredi/test-orquestador):
 * - #46 "Label test: fix" + PR #47 OPEN, both carrying
 *   `review:fix-aplicado` → I1 in-progress/fixing. The fix landed; the
 *   row stays with the agent until re-review settles a new label.
 * - #44 "Label test: pending" + PR #45 OPEN, both carrying
 *   `review:pendiente` → N1 ready/merge-ready (neutral OPEN PR: reviewable
 *   evidence, nothing blocking; Merge stays disabled until aprobado).
 * - #69 + PR #83 OPEN carrying `review:pendiente` → N1 ready/merge-ready
 *   (same reason: the linked PR is the evidence, pending is not blocking).
 * - #1 "Issue 1" + PR #6 OPEN carrying `review:comentado` (the extra
 *   `status:approved` label is NOT a cycle label and is ignored) → A2
 *   awaiting/changes-requested. The review asked for changes; the human
 *   turn is triggering the fix.
 *
 * Notes:
 * - `effective` = `effectiveReviewLabel(labelsByPr[n][pr] ?? labelsByIssue[n] ?? [],
 *   verdictByPr[n][pr] ?? verdictByIssue[n])` against the primary PR
 *   (labels win over the in-memory verdict — `reviewVerdict.ts`).
 * - `conflicto:main` and `gate:fallo` do NOT change the row; they add badges
 *   + CTAs (drawer parity).
 * - F-A sits between I2 and I3 on purpose: live canvas terminals (fixing /
 *   reviewing agents actually running) keep priority, but a factory job
 *   waiting for the human is NOT progressing, so YOUR TURN wins over the
 *   generic factory `implementing` row AND over merge-busy (both engines
 *   cannot advance the same issue at once — the human gate unblocks
 *   first). The F-A signal comes from `readFactoryJobHumanNeed` on the
 *   SAME matched poll-list job (never a second match), and it never fires
 *   without a live linked job (`factoryActive` must hold).
 * - Legacy nodes without state fall through (never inferred closed): only an
 *   exact `"CLOSED"` maps to done.
 */

export interface DerivedActivity {
  status: IssueStatus;
  phase?: InProgressPhase;
  awaitingAction?: AwaitingAction;
}

/**
 * Extra live context the adapter threads through the `review` parameter
 * (structural, all optional). Plain `LiveReviewSnapshot` fakes omit it, in
 * which case mapping stays honest-absent for the resolving-context fields
 * instead of inventing them.
 */
export interface ActivityLiveContext {
  resolvingIssueNumber?: number | null;
  headRefByIssue?: Record<number, string | null>;
}

const VALID_STATUS: readonly IssueStatus[] = [
  "pending",
  "in-progress",
  "awaiting",
  "ready",
  "done",
];

const VALID_PHASES: readonly InProgressPhase[] = [
  "implementing",
  "reviewing",
  "fixing",
];

const VALID_AWAITING: readonly AwaitingAction[] = [
  "review-ready",
  "changes-requested",
  "merge-ready",
  "spec-approval",
  "triage-respond",
  "ask-human",
  "resume",
];

const VALID_FACTORY_AWAITING: readonly FactoryAwaitingKind[] = [
  "spec-approval",
  "triage-respond",
  "ask-human",
  "resume",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asVerdict(value: unknown): ReviewVerdict | null {
  return value === "APPROVED" ||
    value === "CHANGES_REQUESTED" ||
    value === "REVIEW_REQUIRED" ||
    value === "COMMENTED" ||
    value === "FIX_APPLIED"
    ? value
    : null;
}

function validPositiveInt(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    (value as number) > 0
    ? (value as number)
    : null;
}

function safeSnapshot(
  review: LiveReviewSnapshot | undefined | null,
): LiveReviewSnapshot | undefined {
  return isRecord(review) ? (review as LiveReviewSnapshot) : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

interface EffectiveInputs {
  effective: string | null;
  verdict: ReviewVerdict | null;
  prNumber: number | null;
  prState: string | null;
  prOpen: boolean;
  gateRunning: boolean;
}

/** Resolve the primary-PR workflow inputs for one issue. Never throws. */
function effectiveInputsForIssue(
  issueNumber: number,
  review: LiveReviewSnapshot | undefined,
): EffectiveInputs {
  const primary =
    review?.primaryPrByIssue?.[issueNumber] ?? null;
  const prNumber =
    primary !== null && isRecord(primary)
      ? validPositiveInt(
          (primary as unknown as Record<string, unknown>).number,
        )
      : null;
  const prState =
    primary !== null &&
    isRecord(primary) &&
    typeof (primary as unknown as Record<string, unknown>).state === "string"
      ? ((primary as unknown as Record<string, unknown>).state as string)
      : null;
  const labels =
    (prNumber !== null
      ? review?.labelsByPr?.[issueNumber]?.[prNumber]
      : undefined) ??
    review?.labelsByIssue?.[issueNumber] ??
    [];
  const verdict = asVerdict(
    (prNumber !== null
      ? review?.verdictByPr?.[issueNumber]?.[prNumber]
      : undefined) ??
      review?.verdictByIssue?.[issueNumber] ??
      null,
  );
  const openPrs = review?.openPrsByIssue?.[issueNumber];
  const anyOpenPr =
    prState === "OPEN" ||
    (Array.isArray(openPrs) &&
      openPrs.some(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          (entry as { state?: unknown }).state === "OPEN",
      ));
  const gateStatus =
    prNumber !== null
      ? review?.gateByPr?.[issueNumber]?.[prNumber]?.status
      : undefined;
  return {
    effective: effectiveReviewLabel(stringList(labels), verdict),
    verdict,
    prNumber,
    prState,
    prOpen: anyOpenPr,
    gateRunning: gateStatus === "running",
  };
}

/**
 * Pure status derivation — implements the membership table above.
 * Exported for unit tests; no store access. Never throws.
 *
 * `issueState` is the raw GitHub `state` carried on the canvas node
 * (OPEN / CLOSED). Only an exact `"CLOSED"` maps to done; anything else
 * (OPEN, absent legacy nodes, junk) falls through. The parameter is
 * optional so callers without node state keep working.
 *
 * `factoryActive` marks a live factory job linked to the issue (matched by
 * `issueRef` in the existing `useWorkItemStore` poll list — zero new
 * polls; `liveActivity.ts` computes it). The phase stays generic
 * `implementing` on purpose: the daemon status (Intake/Foreman/Triage/
 * Building/Review) is cheap to read but mapping it onto
 * implementing/reviewing/fixing would invent workflow semantics the panel
 * cannot verify — an honest generic row beats a precise-looking lie.
 *
 * `factoryAwaiting` carries the human-gate kind for that SAME job (from
 * `readFactoryJobHumanNeed` — spec-approval / triage-respond / ask-human).
 * A waiting job is not progressing, so it maps 1:1 onto the same-named
 * `awaitingAction` ahead of the generic I3 row (rows F-A1–F-A4). Junk
 * values fall back to no gate (never invented); the gate additionally
 * requires `factoryActive`, so it can never fire without a live linked
 * job.
 *
 * `factoryCompleted` marks a TERMINAL `Complete` factory job linked to the
 * issue (matched by `issueRef` in the existing `useWorkItemStore` poll
 * list — `liveActivity.ts` computes it via
 * `findCompletedFactoryJobForIssueIndexed`). DONE SOLO ON MERGE (explicit
 * user order, D2/6b reverted): it NEVER settles done on its own. Row C1
 * maps `Complete` + OPEN PR to `awaiting / merge-ready` (the human accept
 * that produced `Complete` is the approval; the OPEN PR is the reviewable
 * evidence — never invented). `Complete` without an OPEN PR falls to
 * `pending` (honest, nothing invented). C1 sits after A1/A2 on purpose so
 * settled `aprobado`/`comentado` keep priority, but before A3 so a
 * completed job with an unlabeled OPEN PR invites a merge instead of a
 * second review. `Cancelled` jobs never match (`isFactoryJobCompleted`
 * is Complete-only), so a cancelled run never invents done or merge-ready.
 */
import { activityLog } from "../activityDebug";

export function deriveActivityStatus(
  issueNumber: number,
  review: LiveReviewSnapshot,
  resolvingIssueNumber: number | null,
  issueState?: string | null,
  factoryActive?: boolean | null,
  factoryAwaiting?: FactoryAwaitingKind | string | null,
  factoryCompleted?: boolean | null,
  optimisticReady?: boolean | null,
): DerivedActivity {
  const result = deriveActivityStatusInner(
    issueNumber,
    review,
    resolvingIssueNumber,
    issueState,
    factoryActive,
    factoryAwaiting,
    factoryCompleted,
    optimisticReady,
  );
  try {
    activityLog("deriveActivityStatus", {
      issueNumber,
      issueState: issueState ?? null,
      factoryActive: factoryActive ?? null,
      factoryAwaiting: factoryAwaiting ?? null,
      factoryCompleted: factoryCompleted ?? null,
      optimisticReady: optimisticReady ?? null,
      result: {
        status: result.status,
        phase: result.phase ?? null,
        awaitingAction: result.awaitingAction ?? null,
      },
    });
  } catch {
    // el log nunca rompe la derivación
  }
  return result;
}

function deriveActivityStatusInner(
  issueNumber: number,
  review: LiveReviewSnapshot,
  resolvingIssueNumber: number | null,
  issueState?: string | null,
  factoryActive?: boolean | null,
  factoryAwaiting?: FactoryAwaitingKind | string | null,
  factoryCompleted?: boolean | null,
  optimisticReady?: boolean | null,
): DerivedActivity {
  const snap = safeSnapshot(review);
  const inputs = effectiveInputsForIssue(issueNumber, snap);
  const mergedNumbers: unknown[] = Array.isArray(snap?.mergedPrNumbers)
    ? (snap as LiveReviewSnapshot).mergedPrNumbers.slice()
    : [];

  // D — done is NEVER invented: real merge evidence or a CLOSED node only.
  if (
    inputs.prState === "MERGED" ||
    (inputs.prNumber !== null && mergedNumbers.includes(inputs.prNumber)) ||
    issueState === "CLOSED"
  ) {
    return { status: "done" };
  }
  const openPrs = snap?.openPrsByIssue?.[issueNumber];
  if (
    Array.isArray(openPrs) &&
    openPrs.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        (entry as { state?: unknown }).state === "MERGED",
    )
  ) {
    return { status: "done" };
  }

  // I1 — fix terminal running, or FIX_APPLIED settled (fix landed, re-review next).
  if (
    snap?.fixingIssueNumber === issueNumber ||
    inputs.effective === REVIEW_LABEL_FIX_APPLIED
  ) {
    return { status: "in-progress", phase: "fixing" };
  }

  // I2 — review terminal running (verdict cycle started), or quality gate
  // running on the primary PR.
  if (
    snap?.reviewingIssueNumber === issueNumber ||
    inputs.gateRunning
  ) {
    return { status: "in-progress", phase: "reviewing" };
  }

  // F-A — the linked factory job waits for the human (spec approval,
  // triage answers, or an ask_human review decision / pending ask_human
  // notification — see `readFactoryJobHumanNeed`). A waiting job is not
  // progressing: YOUR TURN wins over the generic I3 row below. The gate
  // needs a live linked job; junk kinds fall through to I3.
  const awaitingGate: FactoryAwaitingKind | null =
    factoryActive === true &&
    typeof factoryAwaiting === "string" &&
    (VALID_FACTORY_AWAITING as readonly string[]).includes(factoryAwaiting)
      ? (factoryAwaiting as FactoryAwaitingKind)
      : null;
  if (awaitingGate !== null) {
    return { status: "awaiting", awaitingAction: awaitingGate };
  }

  // I3 — resolve terminal running (canvas): the worktree/agent is being
  // built. Or a live factory job linked to this issue (Warp Resolve →
  // factory daemon): same generic `implementing` phase (see the docblock —
  // the daemon status is deliberately NOT mapped onto phases).
  if (resolvingIssueNumber === issueNumber || factoryActive === true) {
    return { status: "in-progress", phase: "implementing" };
  }

  // I4 — merge / conflict-resolve busy with no earlier row matched. Live
  // work beats settled labels, so this sits above the awaiting rows: while
  // a merge runs, the row must not invite a second merge click from
  // "Awaiting You". Plain in-progress (no phase) — the busy CTA labels win
  // in the panel.
  if (
    snap?.mergingIssueNumber === issueNumber ||
    snap?.resolvingConflictIssueNumber === issueNumber
  ) {
    return { status: "in-progress" };
  }

  // A1 — implementation done, OPEN PR carrying review:aprobado.
  if (inputs.effective === REVIEW_LABEL_APPROVED && inputs.prOpen) {
    return { status: "ready", awaitingAction: "merge-ready" };
  }

  // A2 — effective review:comentado.
  if (inputs.effective === REVIEW_LABEL_CHANGES) {
    return { status: "awaiting", awaitingAction: "changes-requested" };
  }

  // N1 — OPEN PR with a neutral signal (`review:pendiente` or no cycle
  // label/verdict at all) and nothing above claimed the row: reviewable
  // evidence with nothing blocking → ready / merge-ready. Settled
  // aprobado/comentado/fix-aplicado kept priority above (disjoint values);
  // `conflicto:main` / `gate:fallo` are different effective values, so
  // blocked PRs fall through to pending below (honest, never mergeable).
  // Merge stays DISABLED on these rows: the shared action matrix only
  // enables it for aprobado + OPEN PR.
  if (
    inputs.prOpen &&
    (inputs.effective === REVIEW_LABEL_PENDING || inputs.effective === null)
  ) {
    return { status: "ready", awaitingAction: "merge-ready" };
  }

  // C1 — DONE SOLO ON MERGE: terminal `Complete` + OPEN PR invites a
  // merge (the human accept behind `Complete` is the approval). Sits after
  // A1/A2 (settled aprobado/comentado keep priority). An unlabeled OPEN PR
  // from a completed job reads merge-ready here. Row-isolated: never throws
  // (boolean checks only).
  try {
    if (factoryCompleted === true && inputs.prOpen) {
      return { status: "ready", awaitingAction: "merge-ready" };
    }
  } catch {
    // A poisoned flag degrades to no C1 signal (honest, never a throw).
  }

  // No separate canvas-only bucket: a neutral OPEN PR reads merge-ready
  // via N1 above. Review happens wherever the human runs it (canvas or
  // GitHub); the panel only reflects evidence.

  // O — optimistic Ready to Merge (factory Complete seen, PR lookup still
  // in flight). Sits after every settled row so it never overrides live
  // work, awaiting gates, aprobado/comentado or a confirmed C1: it only
  // rescues rows that would otherwise fall to pending while GitHub indexes
  // the fresh PR. Merge stays DISABLED (no known OPEN PR → no hasOpenPr)
  // until the forced lookup reconciles. TTL enforced by the caller; a stale
  // flag degrades to pending here.
  try {
    if (optimisticReady === true) {
      return { status: "ready", awaitingAction: "merge-ready" };
    }
  } catch {
    // A poisoned flag degrades to pending (honest, never a throw).
  }

  // P — fresh canvas issue. No PR, no verdict, no active operation.
  // A terminal `Complete` WITHOUT a linked OPEN PR and without merge
  // evidence lands here too (honest: nothing to merge or review, so no
  // awaiting/done signal is invented — the factory detail still shows the
  // `Complete` stage plus the PR outcome/hint). Blocked PRs
  // (`conflicto:main` / `gate:fallo`) also land here: reviewable but not
  // mergeable, so no merge-ready signal is invented either.
  return { status: "pending" };
}

/**
 * Branch enrichment — all honest, never fabricated.
 * Primary open PR `headRefName` when known, else `issue-{n}` while a
 * resolve is active for the issue, else absent (never guessed from
 * worktree folder names). Never throws.
 */
export function branchForIssue(
  issueNumber: number,
  headRefName?: string | null,
  resolvingIssueNumber?: number | null,
): string | undefined {
  if (typeof headRefName === "string" && headRefName.trim() !== "") {
    return headRefName;
  }
  if (resolvingIssueNumber === issueNumber) {
    return `issue-${issueNumber}`;
  }
  return undefined;
}

/**
 * Assignee enrichment — deterministic role strings (a role label, not a
 * person lookup): `opencode-agent` while resolving/fixing is active;
 * `reviewer-agent` while reviewing is active or the issue awaits
 * review/merge; else absent. Never throws.
 */
export function assigneeForIssue(
  issueNumber: number,
  derived: DerivedActivity,
  review?: LiveReviewSnapshot,
  resolvingIssueNumber?: number | null,
): string | undefined {
  const snap = safeSnapshot(review);
  if (
    resolvingIssueNumber === issueNumber ||
    snap?.fixingIssueNumber === issueNumber
  ) {
    return "opencode-agent";
  }
  if (snap?.reviewingIssueNumber === issueNumber) {
    return "reviewer-agent";
  }
  if (
    isRecord(derived) &&
    ((derived.status === "awaiting" &&
      derived.awaitingAction === "merge-ready") ||
      (derived.status === "ready" &&
        derived.awaitingAction === "merge-ready"))
  ) {
    return "reviewer-agent";
  }
  return undefined;
}

/** Format epoch ms as local `YYYY-MM-DD HH:mm`. Null when invalid. */
function formatActivityTimestamp(at: number): string | null {
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * `phaseStarted` enrichment — timestamp of the latest local activity entry
 * for (repo, issue) formatted `YYYY-MM-DD HH:mm`; fallback = node
 * `updatedAt` (never `Date.now()` at render — that would lie and break
 * memo stability). Never throws.
 */
export function phaseStartedForIssue(
  activityEntries?: IssueActivityEntry[] | null,
  fallbackUpdatedAt?: string | null,
): string | undefined {
  if (Array.isArray(activityEntries)) {
    let latest: number | null = null;
    for (const entry of activityEntries) {
      if (
        isRecord(entry) &&
        typeof entry.at === "number" &&
        Number.isFinite(entry.at)
      ) {
        if (latest === null || entry.at > latest) latest = entry.at;
      }
    }
    if (latest !== null) {
      const formatted = formatActivityTimestamp(latest);
      if (formatted !== null) return formatted;
    }
  }
  if (typeof fallbackUpdatedAt === "string" && fallbackUpdatedAt !== "") {
    return fallbackUpdatedAt;
  }
  return undefined;
}

/**
 * Pure node mapping. Exported for unit tests; no store access. Never throws.
 *
 * Fields without a canvas source stay honest: `branch` is the primary-PR
 * head ref when the adapter threads it through `ActivityLiveContext`
 * (plain snapshots omit it → `issue-{n}` while resolving, else absent);
 * `prNumber` is the primary open PR number when known, else absent;
 * `assignee` is a deterministic role string, else absent; `phaseStarted`
 * is the latest local activity entry, else node `updatedAt`;
 * `createdAt`/`updatedAt` are node values; `labels` are node label names;
 * `url`/`worktreePath` are node values when present; `relations` is the
 * canvas-parity mapping (`mapRelationsFromNode`, same sources as the card:
 * parent + blockedBy + blocking + subIssues, possibly empty — never
 * invented, drives the blocked-by resolve gate).
 * An invalid `issueNumber` falls back to 0 here; the adapter drops such
 * nodes entirely (a row without a real issue number breaks lookup).
 * `projectName` is accepted per contract for header enrichment downstream;
 * the Figma `Issue` shape carries no project slot, so it is validated and
 * otherwise unused here (never invented onto the row).
 */
export function mapIssueNodeToActivity(
  node: IssueNodeData,
  derived: DerivedActivity,
  review?: LiveReviewSnapshot,
  projectName?: string,
  activityEntries?: IssueActivityEntry[],
): Issue {
  const mapped = mapIssueNodeToActivityInner(
    node,
    derived,
    review,
    projectName,
    activityEntries,
  );
  try {
    activityLog("mapIssueNodeToActivity", {
      id: mapped.id,
      status: mapped.status,
      phase: mapped.phase ?? null,
      awaitingAction: mapped.awaitingAction ?? null,
      factory: mapped.factory?.stage ?? null,
      prNumber: mapped.prNumber ?? null,
    });
  } catch {
    // el log nunca rompe el mapeo
  }
  return mapped;
}

function mapIssueNodeToActivityInner(
  node: IssueNodeData,
  derived: DerivedActivity,
  review?: LiveReviewSnapshot,
  projectName?: string,
  activityEntries?: IssueActivityEntry[],
): Issue {
  const raw: Record<string, unknown> = isRecord(node)
    ? (node as unknown as Record<string, unknown>)
    : {};
  const number = isValidIssueNumber(raw.issueNumber) ? raw.issueNumber : 0;
  void projectName;

  const status: IssueStatus =
    isRecord(derived) &&
    typeof derived.status === "string" &&
    VALID_STATUS.includes(derived.status as IssueStatus)
      ? (derived.status as IssueStatus)
      : "pending";
  const phase: InProgressPhase | undefined =
    status === "in-progress" &&
    isRecord(derived) &&
    typeof derived.phase === "string" &&
    (VALID_PHASES as readonly string[]).includes(derived.phase)
      ? (derived.phase as InProgressPhase)
      : undefined;
  // merge-ready vive en filas `ready` (no `awaiting`): el footer necesita
  // el kind para mostrar No mergear + Re-revisar (sin esto los botones
  // nunca se renderizaban: la fila ready llegaba sin awaitingAction).
  const awaitingAction: AwaitingAction | undefined =
    (status === "awaiting" ||
      (status === "ready" &&
        isRecord(derived) &&
        derived.awaitingAction === "merge-ready")) &&
    isRecord(derived) &&
    typeof derived.awaitingAction === "string" &&
    (VALID_AWAITING as readonly string[]).includes(derived.awaitingAction)
      ? (derived.awaitingAction as AwaitingAction)
      : undefined;

  const snap = safeSnapshot(review);
  const inputs = effectiveInputsForIssue(number, snap);
  let prNumber = inputs.prNumber;
  if (prNumber === null && snap !== undefined) {
    const open = snap.openPrsByIssue?.[number];
    if (Array.isArray(open)) {
      for (const entry of open) {
        const candidate =
          entry !== null && typeof entry === "object"
            ? validPositiveInt((entry as { number?: unknown }).number)
            : null;
        if (candidate !== null) {
          prNumber = candidate;
          break;
        }
      }
    }
  }

  const ctx = (snap ?? {}) as Partial<ActivityLiveContext>;
  const resolving =
    typeof ctx.resolvingIssueNumber === "number"
      ? ctx.resolvingIssueNumber
      : null;
  // Merge conflict on the primary PR (canvas `prConflicted` parity:
  // `conflictByPr?.[issue]?.[pr] ?? false`). Drives the Conflicts badge;
  // junk/missing reads as unknown (absent, never invented).
  let conflicted: boolean | undefined;
  try {
    if (prNumber !== null && snap !== undefined) {
      const byIssue = (snap as LiveReviewSnapshot).conflictByPr?.[number];
      const flag =
        byIssue !== null &&
        typeof byIssue === "object" &&
        !Array.isArray(byIssue)
          ? (byIssue as Record<number, unknown>)[prNumber]
          : undefined;
      conflicted = flag === true ? true : undefined;
    } else {
      conflicted = undefined;
    }
  } catch {
    conflicted = undefined;
  }
  const headRefRaw =
    isRecord(ctx.headRefByIssue) &&
    typeof ctx.headRefByIssue[number] === "string"
      ? (ctx.headRefByIssue[number] as string)
      : undefined;
  const branch = branchForIssue(number, headRefRaw, resolving);
  const assignee = assigneeForIssue(
    number,
    { status, phase, awaitingAction },
    snap,
    resolving,
  );

  const title = typeof raw.title === "string" ? raw.title : "";
  const body = typeof raw.body === "string" ? raw.body : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
  const url =
    typeof raw.url === "string" && raw.url !== "" ? raw.url : undefined;
  const worktreePath =
    typeof raw.__worktreePath === "string" && raw.__worktreePath !== ""
      ? raw.__worktreePath
      : undefined;
  const phaseStarted = phaseStartedForIssue(
    activityEntries,
    updatedAt !== "" ? updatedAt : undefined,
  );

  const issue: Issue = {
    id: number,
    title,
    body,
    labels: normalizeLabels(raw.labels).map((label) => label.name),
    status,
    createdAt,
    updatedAt,
    relations: mapRelationsFromNode(raw),
  };
  if (phase !== undefined) issue.phase = phase;
  if (awaitingAction !== undefined) issue.awaitingAction = awaitingAction;
  if (conflicted === true) issue.conflicted = true;
  if (branch !== undefined) issue.branch = branch;
  if (prNumber !== null) issue.prNumber = prNumber;
  if (assignee !== undefined) issue.assignee = assignee;
  if (phaseStarted !== undefined) issue.phaseStarted = phaseStarted;
  if (url !== undefined) issue.url = url;
  if (worktreePath !== undefined) issue.worktreePath = worktreePath;
  return issue;
}
