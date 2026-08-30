// SRP: static deep-dive spec for GitLab / Slack / Linear / Jira — §9 exact names, no I/O
// DIP: pure data + pure helpers, no store / no side effects
// OCP: add provider = add constant + helpers, no edit of other providers

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

export const SLACK_HOME_TAB_STAGES = [
  "Triage",
  "Planning",
  "Building",
  "Reviewing",
  "Complete",
  "Cancelled",
] as const;

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

// ── Jira ─────────────────────────────────────────────────────────────────────
export const JIRA_CLOUD_ONLY = true as const;
export const JIRA_SERVER_SUPPORTED = false as const;
export const JIRA_DC_SUPPORTED = false as const;
export const JIRA_ROVO_REQUIRED = true as const;
export const JIRA_ONLY_EVENT = "agent_session_created" as const;
export const JIRA_FILTERS = ["Jira projects", "assignment keywords (case-insensitive)"] as const;
export const JIRA_FILTER_KEYS = ["project_keys", "keywords"] as const;

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

// ── Registry (OCP) ───────────────────────────────────────────────────────────
export const DEEP_DIVE_PROVIDERS = ["gitlab", "slack", "linear", "jira"] as const;
export type DeepDiveProvider = (typeof DEEP_DIVE_PROVIDERS)[number];
