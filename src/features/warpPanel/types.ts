import type { ReactNode } from "react";
import type { CostSummary } from "../../../shared/types/workItem";

/**
 * WarpPanel shared domain types — single source of truth.
 *
 * Consolidates (verbatim shapes):
 * - figma .../src/data/kanban.ts (kanban board model)
 * - figma .../src/data/issues.ts (activity/issues model; IssuesPanel.tsx is
 *   NOT ported as a component, but ActivityPanel imports these types)
 * - figma .../src/components/AgentsPanel.tsx (Agent)
 * - figma .../src/components/AgentConfig.tsx (AgentConfigData, Automation)
 * - figma .../src/components/SidePanel.tsx (NavSection)
 * - figma .../src/components/KanbanBoard.tsx (ViewMode, moved here to break
 *   the Figma-only coupling ActivityPanel -> KanbanBoard)
 */

/* ─── Shell / navigation ─────────────────────────────────────────────── */

export type NavSection =
  | "issues"
  | "activity"
  | "agents"
  | "context"
  | "diagnostic";

/** View toggle shared by KanbanBoard and ActivityPanel. */
export type ViewMode = "columns" | "collapsible";

/** Repository entry shown in the side-panel repo picker. */
export interface WarpRepo {
  name: string;
  branch: string;
}

/* ─── Kanban board model (data/kanban.ts) ────────────────────────────── */

export type KanbanStatus =
  | "backlog"
  | "ready"
  | "in-progress"
  | "in-review"
  | "done";

export interface IssueLabel {
  name: string;
  bg: string;
  fg: string;
}

export interface ActivityEvent {
  id: number;
  actor: string;
  actorColor: string;
  type: "linked-pr" | "added-label" | "comment";
  text: string;
  detail?: string;
  detailHref?: string;
  labelName?: string;
  labelBg?: string;
  labelFg?: string;
  ago: string;
}

/* ─── Canvas relation parity (IssueNode → drawer) ─────────────────────── */

/**
 * Relation groups mirror the canvas IssueNode `relationCards` labels
 * (Parent / Blocked by / Blocking / Sub-issue), sourced from the same
 * first-class fields (parent, blockedBy, blocking, subIssues).
 */
export type KanbanRelationKind = "parent" | "blockedBy" | "blocking" | "subIssue";

export interface KanbanRelation {
  number: number;
  title: string;
  url: string;
  state: string;
  kind: KanbanRelationKind;
  /** Canvas sidebar group label. */
  label: "Parent" | "Blocked by" | "Blocking" | "Sub-issue";
}

/** Normalized timeline event — same kind derivation as the canvas card. */
export interface KanbanTimelineEvent {
  kind:
    | "labeled"
    | "milestoned"
    | "renamed-title"
    | "cross-referenced"
    | "connected"
    | "disconnected"
    | "updated";
  actor: string;
  labelName?: string;
  labelColor?: string;
  milestoneTitle?: string;
  previousTitle?: string;
  currentTitle?: string;
  createdAt: string;
}

export type KanbanGateStatus = "idle" | "running" | "pass" | "fail";

export interface KanbanPr {
  prNumber: number;
  url: string;
  title: string;
  state: string;
  /** Raw review verdict (ReviewVerdict) or null when never reviewed. */
  verdict: string | null;
  /** Snapshot-time effective label (see `effectiveReviewLabel`). */
  effectiveLabel: string | null;
  labels: string[];
  conflicted: boolean;
  gateStatus: KanbanGateStatus;
  gateReportPath: string | null;
}

export interface KanbanIssue {
  id: number;
  repoName: string;
  number: number;
  title: string;
  status: KanbanStatus;
  body: string;
  author: string;
  authorColor: string;
  openedAgo: string;
  labels: IssueLabel[];
  prNumber?: number;
  prTitle?: string;
  /** GitHub issue URL (live adapter only; the Figma mock omits it). */
  url?: string;
  /**
   * GitHub-native issue state (OPEN / CLOSED) from live canvas data.
   * Absent when the canvas node predates state hydration — callers must
   * treat absent as unknown (legacy nodes came from the open-only fetch),
   * never as closed.
   */
  githubState?: "OPEN" | "CLOSED";
  assignees?: { initials: string; color: string }[];
  estimate?: number;
  priority?: "P0" | "P1" | "P2";
  size?: "S" | "M" | "L" | "XL";
  startDate?: string;
  targetDate?: string;
  milestone?: string;
  activity: ActivityEvent[];
  /**
   * Canvas worktree path (`__worktreePath`) — cwd for the issue handlers
   * (PR lookup, gate override), resolved exactly like the canvas card.
   * Absent on legacy nodes.
   */
  worktreePath?: string;
  /** Canvas project id. Absent on legacy nodes. */
  projectId?: string;
  /**
   * Human project name from the project store (`ProjectData.name` for
   * `projectId`). Absent on legacy nodes and when the project left the
   * canvas — callers fall back to the URL slug / repoName, never invented.
   */
  projectName?: string;
  /**
   * First-class relations (parent / blocked-by / blocking / sub-issues),
   * same sources as the canvas `relationCards`.
   */
  relations?: KanbanRelation[];
  /** Normalized GitHub timeline events, same derivation as the canvas. */
  timeline?: KanbanTimelineEvent[];
  /**
   * All linked PRs: store open PRs when known, else the node Development
   * fallback (`closedByPullRequestsReferences` / timeline cross-refs).
   */
  prs?: KanbanPr[];
}

export interface KanbanColumn {
  id: KanbanStatus;
  label: string;
  description: string;
  dotColor: string;
  dotStyle: "solid" | "outline" | "half" | "check";
}

/* ─── Activity / issues model (data/issues.ts) ───────────────────────── */

export type IssueStatus = "pending" | "in-progress" | "awaiting" | "ready" | "done";

export type InProgressPhase = "implementing" | "reviewing" | "fixing";

export type AwaitingAction =
  | "review-ready"
  | "changes-requested"
  | "merge-ready"
  | "spec-approval"
  | "triage-respond"
  | "ask-human"
  | "resume";

/**
 * Factory human-gate kind waiting on the linked daemon job (additive to the
 * Figma `AwaitingAction` union — existing members untouched).
 * - `spec-approval`: Triage + pending spec approval (POST …/spec/approve).
 * - `triage-respond`: Triage + unanswered triage questions
 *   (POST …/triage/respond).
 * - `ask-human`: Review + `lastReview.verdict === "ask_human"`
 *   (POST …/review/accept), or the notification fallback below.
 * - `resume`: worker-status job (Foreman/Building/Review) parked by a daemon
 *   restart (POST …/resume re-drives the phase worker).
 */
export type FactoryAwaitingKind =
  | "spec-approval"
  | "triage-respond"
  | "ask-human"
  | "resume";

/**
 * Human-gate detail attached to an Activity row whose linked factory job
 * waits for the human (additive, optional). Carries exactly what the CTAs
 * need: the daemon `jobId` plus the human-readable context (spec summary /
 * triage questions / review summary) read verbatim from the existing poll
 * list — never invented.
 */
export interface IssueFactoryAwaiting {
  kind: FactoryAwaitingKind;
  /** Daemon job id the Approve/Respond/Accept POST targets. */
  jobId: string;
  /** Verbatim spec summary (spec-approval only, when the daemon sent one). */
  specSummary?: string;
  /** Unanswered triage questions verbatim (triage-respond only). */
  questions?: string[];
  /** Verbatim review summary (ask-human only, when the daemon sent one). */
  reviewSummary?: string;
  /**
   * True cuando el review NUNCA corrió por fallo de infra (daemon
   * `lastReview.isInfraError`). Solo presente en true. La UI bloquea
   * Accept y ofrece reintentar el review.
   */
  reviewInfraError?: boolean;
}

/**
 * Live factory job attached to an Activity row (additive, optional).
 * Carries the VERBATIM daemon cycle stage (`WorkItemStatus` — Intake /
 * Foreman / Triage / Building / Review / Complete / Cancelled, read from
 * the existing 2.5s poll list, never remapped onto the generic
 * implementing/reviewing/fixing phases) plus the live opencode session
 * URL when the daemon attached one (`dashboardUrl`). Absent when no
 * factory job is linked (canvas flows) or the job shape is unknown.
 */
export interface IssueFactoryJob {
  jobId: string;
  /** Verbatim daemon `status` (display label lives in `stageLabel`). */
  stage: string;
  stageLabel: string;
  /** Queued (waiting behind the worker) vs running vs terminal. */
  family: "queued" | "running" | "terminal";
  /** Lane index in the 6 forward lanes (-1 for terminal Cancelled). */
  stepIndex: number;
  stepCount: number;
  terminal: boolean;
  /** Live opencode web-UI session URL. Absent = no live link (honest). */
  sessionUrl?: string;
  /**
   * Foreman routing decision for this job (summary `foreman` projection of
   * the newest `foremanDecision` meta, else the timeline durable path in
   * the full view). Answers "why Triage and not Building" with the daemon's
   * own reason/confidence. Absent = decision unknown (honest-empty).
   */
  foremanDecision?: {
    decision: string;
    reason?: string;
    confidence?: number;
    retryable?: boolean;
  };
  /**
   * Triage decision for this job (summary `triage` extras: building / spec
   * / triage) plus its honest `fallback` flag when the LLM was unavailable.
   * Absent = not triaged yet (honest-empty).
   */
  triageDecision?: {
    decision: string;
    reason?: string;
    confidence?: number;
    fallback?: boolean;
  };
  /**
   * Phase sessions for the issue footer dropdown (one entry per role with
   * a registered session, phase order, daemon-built URLs). Absent/empty =
   * no dropdown (honest).
   */
  sessions?: Array<{ role: string; sessionUrl: string }>;
  /**
   * Corridas hook del job (daemon `hookRuns`, en orden de ejecución).
   * Maneja los chips del stepper bajo su lane. Las sesiones de hooks
   * viajan anexadas en `sessions` como `{role: "hook:<name>", ...}`.
   * Ausente/vacío = sin hooks (honesto).
   */
  hooks?: Array<{ name: string; stage: string; status: string }>;
  /**
   * Roster declarado de agentes hook (daemon `hookAgents`: todos los
   * `factory/agents/*` con `stage` de hook, aunque todavía no hayan
   * corrido). El panel lo usa para el chip pending bajo el lane de su
   * stage y la fila deshabilitada de Agent Sessions. Ausente/vacío = sin
   * hooks declarados (honesto). Se refresca al crear/editar un agente.
   */
  hookAgents?: Array<{ name: string; stage: string; blocking?: boolean }>;
  /**
   * Job `createdAt` as epoch ms (daemon ISO or legacy epoch, parsed by the
   * adapter — never invented). Powers the B5 "attaching…" wait state.
   * Absent = unknown age (wait text omits the elapsed parenthetical).
   */
  createdAtMs?: number;
  /**
   * Job `updatedAt` as epoch ms (parsed by the adapter, never invented).
   * Powers the B4 stalled check. Absent = freshness unknown (never stalled).
   */
  updatedAtMs?: number;
  /**
   * B4 honest-stale flag: non-terminal job with no daemon update past
   * `STALLED_JOB_THRESHOLD_MS` (daemon restarts never resume in-flight
   * workers, so the row would otherwise fake progress forever). Absent or
   * false = progressing normally (or terminal).
   */
  stalled?: boolean;
  /**
   * Isolated branch (`issue-N[-slug]`) recorded by the daemon post-201
   * isolation hook (T01). Absent = no isolation recorded (honest-empty,
   * never invented).
   */
  branch?: string;
  /**
   * PR number opened once by the daemon on first `Complete` (T01
   * post-Complete hook). Absent = no PR opened yet.
   */
  prNumber?: number;
  /**
   * PR URL (daemon-built, never synthesized by the renderer). Absent = no
   * link to show.
   */
  prUrl?: string;
  /**
   * Isolated worktree folder recorded by the daemon post-201 isolation
   * hook (from the `isolation` record on the existing poll-list item).
   * Powers the explicit Delete button in the issue detail (folder only —
   * the branch is never deleted). Absent = no isolated worktree recorded
   * (honest-empty, never invented from folder names).
   */
  worktreePath?: string;
  /**
   * Measured cost for the job (`costSummary` from the existing poll list,
   * same honesty rules as the FactoryLab CostBadge: `null` = tracking off
   * ("—"), `undefined`/absent = no data yet, never an invented 0.00).
   * Absent when the poll item carries no cost info.
   */
  costSummary?: CostSummary | null;
}

export interface Issue {
  id: number;
  title: string;
  body: string;
  labels: string[];
  status: IssueStatus;
  assignee?: string;
  branch?: string;
  prNumber?: number;
  createdAt: string;
  updatedAt: string;
  /** In-progress detail */
  phase?: InProgressPhase;
  phaseStarted?: string;
  /** Live factory job (Warp Resolve → daemon), when linked. */
  factory?: IssueFactoryJob;
  /** Awaiting detail */
  awaitingAction?: AwaitingAction;
  /**
   * Merge conflict on the primary PR (`conflictByPr`, canvas
   * `prConflicted` parity: `conflictsByPr?.[issue]?.[pr] ?? false`).
   * Drives the Conflicts badge (row + detail); the resolve action lives
   * in the existing conflict badge-row. Absent = unknown (never invented).
   */
  conflicted?: boolean;
  /**
   * Factory human-gate detail (additive, optional). Present exactly when
   * `awaitingAction` is one of `spec-approval` / `triage-respond` /
   * `ask-human`: the linked daemon job waits for the human and the panel
   * offers the matching acting CTA (Approve / Respond / Accept via the
   * existing daemon routes — zero new daemon endpoints).
   */
  factoryAwaiting?: IssueFactoryAwaiting;
  /**
   * First-class relations (parent / blocked-by / blocking / sub-issues),
   * same sources as the canvas `relationCards` (`mapRelationsFromNode`).
   * Absent on mock/legacy rows (treated as no relations — never invented).
   * Live rows always carry it (possibly empty). Drives the blocked-by
   * resolve gate shared with the canvas card.
   */
  relations?: KanbanRelation[];
  /**
   * GitHub issue URL (live adapter only; the Figma mock omits it).
   * Precedent: `KanbanIssue.url`. Powers the GitHub button.
   */
  url?: string;
  /**
   * Canvas worktree path (`__worktreePath`) — cwd for forced PR re-lookup.
   * Precedent: `KanbanIssue.worktreePath`. Absent on legacy nodes.
   */
  worktreePath?: string;
}

export interface ActivityColumn {
  id: IssueStatus;
  label: string;
  color: string;
  dimColor: string;
}

/* ─── Agents model (AgentsPanel.tsx + AgentConfig.tsx) ───────────────── */

export type AgentStatus = "idle" | "running" | "error";

export interface Agent {
  id: string;
  name: string;
  description: string;
  iconBg: string;
  iconColor: string;
  icon: ReactNode;
  status?: AgentStatus;
}

export interface AgentMcp {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface AgentSecret {
  id: string;
  key: string;
  masked: string;
}

export interface Automation {
  id: string;
  trigger: string;
  description: string;
  enabled: boolean;
}

export interface AgentConfigData {
  description: string;
  mcps: AgentMcp[];
  secrets: AgentSecret[];
  harness: string;
  model: string;
  runner: string;
  host: string;
  prompt: string;
  automations: Automation[];
  /**
   * Frontmatter real del daemon (`factory/agents/<id>/agent.md`).
   * Opcionales: ausentes = daemon inalcanzable o agente mock (offline).
   * Cuando presentes, mandan sobre los seeds locales al guardar.
   */
  tools?: string[];
  stage?: string;
  blocking?: boolean;
  mode?: string;
  agentType?: string;
}
