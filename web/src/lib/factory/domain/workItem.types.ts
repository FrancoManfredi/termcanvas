// WorkItem domain — SRP: only shapes, no behavior
// Based on WarpFactories.md §3 lifecycle + §10 Activity


export type WorkItemStage = "Triage" | "Planning" | "Building" | "Reviewing" | "Complete" | "Cancelled";
export type TerminalStage = "Complete" | "Cancelled";
export type ActiveStage = Exclude<WorkItemStage, TerminalStage>;

export const ACTIVE_STAGES: ActiveStage[] = ["Triage", "Planning", "Building", "Reviewing"];
export const TERMINAL_STAGES: TerminalStage[] = ["Complete", "Cancelled"];
export const ALL_STAGES: WorkItemStage[] = [...ACTIVE_STAGES, ...TERMINAL_STAGES];

export function isTerminal(stage: WorkItemStage): stage is TerminalStage {
  return (TERMINAL_STAGES as string[]).includes(stage);
}

export function isActive(stage: WorkItemStage): stage is ActiveStage {
  return (ACTIVE_STAGES as string[]).includes(stage);
}

export type WorkItemSource = "github_issue" | "github_pr" | "slack_mention" | "linear_issue" | "jira_issue" | "mcp" | "automation" | "direct" | "schedule" | "factory";

export type ReviewVerdict = "accept" | "revise" | "ask_human";
export type HumanApproval = "pending" | "approved" | "rejected" | "changes_requested";
export type Actor = "foreman" | "triage" | "spec" | "implement" | "review" | "human" | "system";

export interface ForemanDecision {
  shouldSkipTriage: boolean;
  shouldSkipPlanning: boolean;
  reason?: string;
}

export interface WorkItemEvent {
  id: string;
  workItemId: string;
  from: WorkItemStage;
  to: WorkItemStage;
  actor: Actor;
  at: string; // ISO
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkItem {
  readonly id: string;
  readonly factoryName: string;
  readonly title: string;
  readonly description?: string;
  readonly source: WorkItemSource;
  readonly sourceRef?: string;
  readonly createdBy: string;
  readonly createdAt: string; // ISO
  readonly stage: WorkItemStage;
  readonly history: readonly WorkItemEvent[];
  readonly linkedPRs: readonly string[];
  readonly cost?: number;
  readonly assigneeAgent?: string;
  readonly humanApproval?: HumanApproval;
  readonly reviewVerdict?: ReviewVerdict;
  readonly handoffConfirmed?: boolean;
  readonly foremanDecision?: ForemanDecision;
}

export interface CreateWorkItemInput {
  factoryName: string;
  title: string;
  description?: string;
  source: WorkItemSource;
  sourceRef?: string;
  createdBy: string;
  linkedPRs?: string[];
  foremanDecision?: ForemanDecision;
}

export interface TransitionContext {
  humanApproval?: HumanApproval;
  reviewVerdict?: ReviewVerdict;
  handoffConfirmed?: boolean;
  reason?: string;
}

export const REVIEW_VERDICTS: ReviewVerdict[] = ["accept", "revise", "ask_human"];
export const HUMAN_APPROVALS: HumanApproval[] = ["pending", "approved", "rejected", "changes_requested"];
