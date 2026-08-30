// SRP: static deep-dive spec for GitLab / Slack / Linear / Jira — §9 exact names, no I/O
// DIP: pure data + pure helpers, no store / no side effects
// OCP: add provider = add constant + helpers, no edit of other providers

// ── IntegrationTrigger — catalogo puro O14 §3 ──────────────────────────────────
// Source: WarpFactories.md §6, §8, §10 · US-067..093 · T10/T11
export interface IntegrationTrigger {
  readonly provider: "slack" | "linear" | "jira" | "gitlab" | "schedule" | "factory" | "github";
  readonly event: string;
  readonly label: string;
  readonly description: string;
  readonly filters: readonly string[];
  readonly trace: string;
}

// ── GitLab ───────────────────────────────────────────────────────────────────
export const GITLAB_HOST = "gitlab.com" as const;
export const GITLAB_SELF_MANAGED_SUPPORTED = false as const;
export const GITLAB_GROUP_REQUIREMENT = "top-level group Owner" as const;
export const GITLAB_PLAN_REQUIRED = ["Premium", "Ultimate"] as const;
export const GITLAB_GROUP_WEBHOOKS_REQUIRED = true as const;
export const GITLAB_SERVICE_ACCOUNTS_REQUIRED = true as const;

export const GITLAB_MANAGER = {
  scope: "per workspace" as const,
  role: "Owner" as const,
  tokenValidity: "1y" as const,
  purpose: "provisions factory accounts, mints run credentials, maintains group webhook" as const,
} as const;

export const GITLAB_BOT = {
  scope: "per factory" as const,
  namingPattern: "<alias>-warp-<shortID>" as const,
  example: "acme-support-warp-01k2x3y4z5" as const,
  role: "Developer" as const,
  roleExact: "holds Developer role exactly on selected projects" as const,
} as const;

export const GITLAB_TRIGGERS = ["merge_request", "bot_mentioned"] as const;
export type GitLabTrigger = (typeof GITLAB_TRIGGERS)[number];

export const GITLAB_MR_ACTIONS = ["opened", "updated", "closed", "reopened", "merged", "approved"] as const;

export const GITLAB_FILTERS: Record<GitLabTrigger, string[]> = {
  merge_request: ["Project", "Actions", "Base branch"],
  bot_mentioned: ["Project"],
};

export const GITLAB_BOT_MENTION_FILTERS = ["Project"] as const; // alias repos
export const GITLAB_BOT_RESPONSE = {
  branchPrefix: "factory/<slug>" as const,
  branchExample: "factory/add-local-dev" as const,
  mrType: "draft" as const,
  marksReadyWhenDone: true as const,
  neverMerges: true as const,
  neverApproves: true as const,
} as const;

export const GITLAB_DEFINITION_HOSTING_SUPPORTED = false as const;
export const GITLAB_DEFINITION_HOSTING_NOTE =
  "GitLab isn't yet supported as definition-hosting repository — declare in Warp-managed or GitHub-hosted definition" as const;

export function isGitLabHostSupported(host: string): boolean {
  return host.trim().toLowerCase() === GITLAB_HOST;
}
export function isGitLabPlanSufficient(plan: string): boolean {
  return (GITLAB_PLAN_REQUIRED as readonly string[]).includes(plan);
}
export function formatGitLabBotName(alias: string, shortId: string): string {
  return `${alias}-warp-${shortId}`;
}
export function isValidGitLabBotName(name: string): boolean {
  // <alias>-warp-<shortID>  alias: [A-Za-z0-9 ._-] (from §2/§7), shortID: [a-z0-9]+
  return /^[A-Za-z0-9 ._-]+-warp-[A-Za-z0-9]+$/.test(name);
}
export function getGitLabBotFilters(trigger: GitLabTrigger): string[] {
  return GITLAB_FILTERS[trigger] ?? [];
}
export function isGitLabBotMentionFilterValid(filterKeys: string[]): boolean {
  // bot_mentioned solo repos filter (Warp lo setea y rechaza mentioned si lo pones manual)
  // valid = only Project/repos, no mentioned/authors etc.
  const allowed = new Set(["Project", "repos", "project"]);
  return filterKeys.every((k) => allowed.has(k));
}
export function isGitLabDefinitionHostingSupported(): boolean {
  return GITLAB_DEFINITION_HOSTING_SUPPORTED;
}

// ── Slack ────────────────────────────────────────────────────────────────────
export const SLACK_CONNECT_METHOD = "Add to Slack" as const;
export const SLACK_INVITE_REQUIRED = true as const;
export const SLACK_INVITE_NOTE = "invitar la app a cada channel (privado siempre)" as const;
export const SLACK_MENTION_REACTION = "👀" as const;

export const SLACK_EVENTS = [
  "app_mention",
  "message_posted",
  "message_dm",
  "reaction_added",
  "member_joined_channel",
] as const;
// Full provider events including IM variants: message_im / message_mpim map to message_dm family
export const SLACK_EVENTS_FULL = [
  "app_mention",
  "message_posted",
  "message_dm",
  "message_im",
  "message_mpim",
  "reaction_added",
  "member_joined_channel",
] as const;
export type SlackEvent = (typeof SLACK_EVENTS)[number];

export const SLACK_FILTERS = [
  "Conversations",
  "authors/members",
  "keywords",
  "emoji",
  "reacted-message authors",
] as const;

export const SLACK_REACTION_INTAKE_EXAMPLE = {
  channels: ["your-intake-channel"],
  emojis: ["ticket"],
} as const;

// US-068 — 5 triggers Slack como IntegrationTrigger + string events SLACK_EVENTS
export const SLACK_TRIGGERS: readonly IntegrationTrigger[] = [
  {
    provider: "slack",
    event: "app_mention",
    label: "App mention",
    description: "Mención a la app en channel/thread — requiere app invitada",
    filters: ["Conversations", "authors/members", "keywords"],
    trace: "WarpFactories.md §6 · US-068",
  },
  {
    provider: "slack",
    event: "message_posted",
    label: "Message posted",
    description: "Mensaje en channel donde la app está invitada",
    filters: ["Conversations", "authors/members"],
    trace: "WarpFactories.md §6 · US-068",
  },
  {
    provider: "slack",
    event: "message_dm",
    label: "DM / IM",
    description: "Mensaje directo a la app — requiere linked account",
    filters: ["authors/members"],
    trace: "WarpFactories.md §6 · US-068",
  },
  {
    provider: "slack",
    event: "reaction_added",
    label: "Reaction added",
    description: "Reacción con emoji en mensaje — ej intake ticket",
    filters: ["Conversations", "emoji", "reacted-message authors", "keywords"],
    trace: "WarpFactories.md §6 · US-068",
  },
  {
    provider: "slack",
    event: "member_joined_channel",
    label: "Member joined channel",
    description: "Usuario se une al channel",
    filters: ["Conversations"],
    trace: "WarpFactories.md §6 · US-068",
  },
] as const;

export const SLACK_HOME_TAB_STAGES = [
  "Triage",
  "Planning",
  "Building",
  "Reviewing",
  "Complete",
  "Cancelled",
] as const;

// alias O14 §3 — keep both names
export const SLACK_HOME_TABS: readonly { stage: string; label: string }[] = [
  { stage: "Triage", label: "Triage" },
  { stage: "Planning", label: "Planning" },
  { stage: "Building", label: "Building" },
  { stage: "Reviewing", label: "Reviewing" },
  { stage: "Complete", label: "Complete" },
  { stage: "Cancelled", label: "Cancelled" },
] as const;

export const SLACK_PRIVACY_DETAIL = {
  readsOnlyWhere: "mencionada/DM o suscripta por automation",
  usesMessageContent: true,
  usesAttachments: true,
  mapsEmailToWarpAccount: true,
  note: "Data per Warp Privacy Policy — case-insensitive email mapping",
} as const;

export const SLACK_OVERLAPPING_WARNING = {
  code: "overlapping_slack_triggers",
  note: "Un Slack message puede matchear >1 automation (app_mention + message_posted mismo channel → 2 runs)",
  anchor: "two-runs",
  trace: "WarpFactories.md §6 · US-069",
} as const;

export function isSlackInviteRequired(): boolean {
  return SLACK_INVITE_REQUIRED;
}
export function getSlackMentionReaction(): string {
  return SLACK_MENTION_REACTION;
}
export function isSlackEventSupported(event: string): boolean {
  return (SLACK_EVENTS_FULL as readonly string[]).includes(event);
}
export function isSlackNewContentOnly(): boolean {
  return true; // solo new content cuenta; edits ignorados
}
export function shouldSlackPlainReplyContinue(threadHasWorkItem: boolean): boolean {
  // Plain reply en thread solo continúa si el thread ya tiene factory work item; para new work → mention
  return threadHasWorkItem;
}
export function isSlackAccountLinkRequired(kind: "mention" | "dm"): boolean {
  return kind === "mention" || kind === "dm";
}
export const SLACK_PRIVACY = {
  readsOnlyWhere: "mencionada/DM o suscripta por automation" as const,
  usesMessageContent: true as const,
  usesAttachments: true as const,
  mapsEmailToWarpAccount: true as const,
} as const;

// ── Linear ───────────────────────────────────────────────────────────────────
export const LINEAR_CONNECT_METHOD = "OAuth workspace + teams" as const;
export const LINEAR_DEFAULT_AUTOMATION_EVENT = "agent_session_created" as const;
export const LINEAR_AGENT_SESSION_NARROW_LIMIT = "solo en files" as const; // narrow por creator/keyword solo en files, no en editor

export const LINEAR_TRIGGERS = [
  "issue_created",
  "issue_labeled",
  "issue_state_changed",
  "issue_assigned",
  "comment_created",
  "agent_session_created",
] as const;
export type LinearTrigger = (typeof LINEAR_TRIGGERS)[number];

export const LINEAR_ISSUE_TRIGGERS = [
  "issue_created",
  "issue_labeled",
  "issue_state_changed",
  "issue_assigned",
] as const;

export const LINEAR_FILTERS = {
  issue: ["Teams", "labels", "project", "workflow state", "assignee", "mentioned user"],
  comment: ["Teams", "labels", "project", "workflow state", "assignee", "mentioned user", "specific issue"],
  agent_session: ["Teams"],
} as const;

export interface LinearEventOutputRow {
  event: string;
  receives: string;
  sendsBack: string;
}
export const LINEAR_EVENTS_OUTPUTS: LinearEventOutputRow[] = [
  {
    event: "Issue created/labeled/state changed/assigned",
    receives: "title, description, team, project, labels, workflow state, assignee",
    sendsBack: "Work item progress, issue state/delegate changes, links to results",
  },
  {
    event: "Comment created",
    receives: "new comment + su issue context",
    sendsBack: "Ack, progress, responses",
  },
  {
    event: "Agent session created",
    receives: "request que mentioned/assigned/delegated Warp app",
    sendsBack: "Live progress en session + links a run + PR",
  },
  {
    event: "Reply in agent session",
    receives: "new message + session history",
    sendsBack: "Continued work misma session, no work item separado",
  },
];

export function isLinearNarrowEditableInEditor(): boolean {
  return false; // solo en files
}
export function doesLinearCommentCauseLoop(commentCreatesSession: boolean, commentCreatedPointsToFactory: boolean): boolean {
  // Caution: one comment puede matchear 2 routes: comment que crea agent session también matchea Comment created → 2 runs
  return commentCreatesSession && commentCreatedPointsToFactory;
}
export function shouldLinearFollowUpContinueSameWorkItem(issueAlreadyLinked: boolean): boolean {
  // once issue linkeada a factory work item, later matching events en misma issue continúan mismo work item
  return issueAlreadyLinked;
}
export function isLinearTriggerSupported(event: string): boolean {
  return (LINEAR_TRIGGERS as readonly string[]).includes(event);
}

export const LINEAR_INTEGRATION_TRIGGERS: readonly IntegrationTrigger[] = [
  {
    provider: "linear",
    event: "issue_created",
    label: "Issue created",
    description: "Linear issue creado — filtra por Teams/labels/project/state",
    filters: ["Teams", "labels", "project", "workflow state", "assignee", "mentioned user"],
    trace: "WarpFactories.md §6 · US-086",
  },
  {
    provider: "linear",
    event: "issue_labeled",
    label: "Issue labeled",
    description: "Issue etiquetado",
    filters: ["Teams", "labels", "project", "workflow state", "assignee", "mentioned user"],
    trace: "WarpFactories.md §6 · US-086",
  },
  {
    provider: "linear",
    event: "issue_state_changed",
    label: "Issue state changed",
    description: "Cambio de workflow state",
    filters: ["Teams", "labels", "project", "workflow state", "assignee", "mentioned user"],
    trace: "WarpFactories.md §6 · US-086",
  },
  {
    provider: "linear",
    event: "issue_assigned",
    label: "Issue assigned",
    description: "Issue asignado",
    filters: ["Teams", "labels", "project", "workflow state", "assignee", "mentioned user"],
    trace: "WarpFactories.md §6 · US-086",
  },
  {
    provider: "linear",
    event: "comment_created",
    label: "Comment created",
    description: "Comentario en issue — incluye specific issue filter",
    filters: ["Teams", "labels", "project", "workflow state", "assignee", "mentioned user", "specific issue"],
    trace: "WarpFactories.md §6 · US-087",
  },
  {
    provider: "linear",
    event: "agent_session_created",
    label: "Agent session created",
    description: "Linear inicia agent session — narrow solo en files, no en editor",
    filters: ["Teams"],
    trace: "WarpFactories.md §6 · US-088",
  },
] as const;

export const LINEAR_NARROW_NOTE = "solo en files — session routing no es editable desde automation editor" as const;

// ── Jira ─────────────────────────────────────────────────────────────────────
export const JIRA_CLOUD_ONLY = true as const;
export const JIRA_SERVER_SUPPORTED = false as const;
export const JIRA_DC_SUPPORTED = false as const;
export const JIRA_ROVO_REQUIRED = true as const;
export const JIRA_ONLY_EVENT = "agent_session_created" as const;
export const JIRA_FILTERS = ["Jira projects", "assignment keywords (case-insensitive)"] as const;
export const JIRA_FILTER_KEYS = ["project_keys", "keywords"] as const;

export const JIRA_TRIGGERS: readonly IntegrationTrigger[] = [
  {
    provider: "jira",
    event: "agent_session_created",
    label: "Agent session created",
    description: "Dispara cuando assign/mention Warp en Jira Cloud — project_keys + keywords case-insensitive",
    filters: ["Jira projects", "assignment keywords (case-insensitive)"],
    trace: "WarpFactories.md §6 · US-090",
  },
] as const;

export const JIRA_CASE_INSENSITIVE_NOTE = "project_keys + keywords case-insensitive" as const;

export const JIRA_STATUSES = [
  "submitted",
  "working",
  "waiting for input",
  "completed",
  "failed",
  "cancelled",
] as const;
// normalized without "for input"
export const JIRA_STATUSES_SHORT = ["submitted", "working", "waiting", "completed", "failed", "cancelled"] as const;

export const JIRA_AGENT_CAPABILITIES = [
  "read details",
  "read comments",
  "read transitions",
  "post/edit comments",
  "change workflow status",
  "add/remove labels",
  "reassign",
] as const;

export function isJiraHostSupported(host: string): boolean {
  // Cloud only — any *.atlassian.net counts as Cloud; Server/DC false
  if (!host) return false;
  const h = host.toLowerCase();
  if (h.includes("atlassian.net")) return true;
  // generic cloud host check: if explicitly "jira cloud" string
  if (h === "cloud") return true;
  return false;
}
export function isJiraServerSupported(): boolean {
  return JIRA_SERVER_SUPPORTED;
}
export function isJiraTriggerSupported(event: string): boolean {
  return event === JIRA_ONLY_EVENT;
}
export function doesJiraKeywordMatch(assignmentText: string, keywords: string[]): boolean {
  // case-insensitive: assignment text contiene cualquiera
  const lower = assignmentText.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}
export function doesJiraProjectMatch(workItemProject: string, projectKeys: string[]): boolean {
  // case-insensitive project_keys match, omit field → match everything handled by caller
  if (projectKeys.length === 0) return true;
  const lower = workItemProject.toLowerCase();
  return projectKeys.some((k) => lower === k.toLowerCase());
}
export function isJiraKeywordCaseInsensitive(): boolean {
  return true;
}
export function getJiraStatuses(): readonly string[] {
  return JIRA_STATUSES;
}
export function canJiraAgentDo(capability: string): boolean {
  return (JIRA_AGENT_CAPABILITIES as readonly string[]).includes(capability);
}

export const GITLAB_INTEGRATION_TRIGGERS: readonly IntegrationTrigger[] = [
  {
    provider: "gitlab",
    event: "merge_request",
    label: "Merge request",
    description: "MR opened/updated/closed/reopened/merged/approved — filtra por Project/Actions/Base branch",
    filters: ["Project", "Actions", "Base branch"],
    trace: "WarpFactories.md §6 · US-081",
  },
  {
    provider: "gitlab",
    event: "bot_mentioned",
    label: "Bot mentioned",
    description: "New comment menciona bot *-warp-* — solo filtro Project",
    filters: ["Project"],
    trace: "WarpFactories.md §6 · US-081",
  },
] as const;

export const GITLAB_PREMIUM_GATE = "GitLab.com only — Premium/Ultimate requerido para service accounts + group webhooks" as const;

// ── Schedule / Factory — O14 US-092 / US-093 ──────────────────────────────────
export const SCHEDULE_PRESETS: readonly { readonly cron: string; readonly name?: string; readonly trace: string }[] = [
  { cron: "0 9 * * 1", name: "weekly-dependency-audit", trace: "WarpFactories.md §6 · US-092" },
  { cron: "@daily", trace: "WarpFactories.md §6 · US-092" },
  { cron: "@every 1h", trace: "WarpFactories.md §6 · US-092" },
] as const;

export const SCHEDULE_TRIGGERS: readonly IntegrationTrigger[] = [
  {
    provider: "schedule",
    event: "cron_fired",
    label: "Cron fired",
    description: "Schedule trigger — cron 5 campos o @daily/@every 1h UTC, siempre UTC, optional name",
    filters: ["Cron"],
    trace: "WarpFactories.md §6 · US-092",
  },
] as const;

export const FACTORY_STAGE_TRIGGERS: readonly IntegrationTrigger[] = [
  {
    provider: "factory",
    event: "work_item_stage_changed",
    label: "Work item stage changed",
    description: "Automatizar sobre el propio pipeline — stage change del work item",
    filters: [],
    trace: "WarpFactories.md §6 · US-093",
  },
] as const;

export const INTEGRATION_CONSTRAINTS: Record<string, { note: string; code: string }> = {
  slack_overlapping: { note: "app_mention + message_posted mismo channel → 2 runs", code: "overlapping_slack_triggers" },
  linear_narrow: { note: "agent_session_created narrow solo en files", code: "linear_narrow_only_files" },
  linear_loop: { note: "agent_session + comment_created → 2 runs si solapan", code: "linear_loop_caution" },
  jira_cloud_only: { note: "Jira Cloud only — no Server/DC", code: "jira_cloud_only" },
  jira_case_insensitive: { note: "project_keys + keywords case-insensitive", code: "jira_case_insensitive" },
  gitlab_premium: { note: "GitLab.com only — Premium/Ultimate", code: "gitlab_premium" },
  gitlab_bot_pattern: { note: "bot *-warp-* Developer role exactly", code: "gitlab_bot_pattern" },
  schedule_utc: { note: "schedule siempre UTC — 5 campos o @daily/@every 1h", code: "schedule_utc" },
} as const;

// ── Registry (OCP) ───────────────────────────────────────────────────────────
export const DEEP_DIVE_PROVIDERS = ["gitlab", "slack", "linear", "jira", "schedule", "factory"] as const;
export type DeepDiveProvider = (typeof DEEP_DIVE_PROVIDERS)[number];
