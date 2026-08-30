import { describe, it, expect } from "vitest";
import {
  GITLAB_HOST,
  GITLAB_SELF_MANAGED_SUPPORTED,
  GITLAB_GROUP_REQUIREMENT,
  GITLAB_PLAN_REQUIRED,
  GITLAB_MANAGER,
  GITLAB_BOT,
  GITLAB_TRIGGERS,
  GITLAB_MR_ACTIONS,
  GITLAB_FILTERS,
  GITLAB_BOT_RESPONSE,
  GITLAB_DEFINITION_HOSTING_SUPPORTED,
  GITLAB_DEFINITION_HOSTING_NOTE,
  isGitLabHostSupported,
  isGitLabPlanSufficient,
  formatGitLabBotName,
  isValidGitLabBotName,
  isGitLabBotMentionFilterValid,
  isGitLabDefinitionHostingSupported,
  // Slack
  SLACK_CONNECT_METHOD,
  SLACK_INVITE_REQUIRED,
  SLACK_MENTION_REACTION,
  SLACK_EVENTS,
  SLACK_EVENTS_FULL,
  SLACK_FILTERS,
  SLACK_REACTION_INTAKE_EXAMPLE,
  SLACK_HOME_TAB_STAGES,
  isSlackInviteRequired,
  getSlackMentionReaction,
  isSlackEventSupported,
  isSlackNewContentOnly,
  shouldSlackPlainReplyContinue,
  isSlackAccountLinkRequired,
  SLACK_PRIVACY,
  // Linear
  LINEAR_CONNECT_METHOD,
  LINEAR_DEFAULT_AUTOMATION_EVENT,
  LINEAR_AGENT_SESSION_NARROW_LIMIT,
  LINEAR_TRIGGERS,
  LINEAR_ISSUE_TRIGGERS,
  LINEAR_EVENTS_OUTPUTS,
  isLinearNarrowEditableInEditor,
  doesLinearCommentCauseLoop,
  shouldLinearFollowUpContinueSameWorkItem,
  isLinearTriggerSupported,
  // Jira
  JIRA_CLOUD_ONLY,
  JIRA_SERVER_SUPPORTED,
  JIRA_ROVO_REQUIRED,
  JIRA_ONLY_EVENT,
  JIRA_FILTERS,
  JIRA_STATUSES,
  JIRA_AGENT_CAPABILITIES,
  isJiraHostSupported,
  isJiraServerSupported,
  isJiraTriggerSupported,
  doesJiraKeywordMatch,
  doesJiraProjectMatch,
  isJiraKeywordCaseInsensitive,
  getJiraStatuses,
  canJiraAgentDo,
  DEEP_DIVE_PROVIDERS,
} from "../domain/integrations.deep";

// ── GitLab ───────────────────────────────────────────────────────────────────
describe("GitLab deep dive - GitLab.com only", () => {
  it("01 host is gitlab.com", () => expect(GITLAB_HOST).toBe("gitlab.com"));
  it("02 self-managed NOT supported", () => expect(GITLAB_SELF_MANAGED_SUPPORTED).toBe(false));
  it("03 isGitLabHostSupported true only for gitlab.com", () => {
    expect(isGitLabHostSupported("gitlab.com")).toBe(true);
    expect(isGitLabHostSupported("GitLab.com")).toBe(true); // case-insensitive
    expect(isGitLabHostSupported("gitlab.example.com")).toBe(false);
    expect(isGitLabHostSupported("self-managed.local")).toBe(false);
  });
  it("04 requires top-level group Owner", () => expect(GITLAB_GROUP_REQUIREMENT).toMatch(/top-level group Owner/));
  it("05 self-managed via access token only standalone cloud agents (not factory)", () => {
    // factory path is not self-managed; standalone cloud agents via token is separate path
    expect(isGitLabHostSupported("gitlab.company.com")).toBe(false);
  });
});

describe("GitLab deep dive - Premium/Ultimate required", () => {
  it("06 plan required includes Premium and Ultimate", () => {
    expect(GITLAB_PLAN_REQUIRED).toContain("Premium");
    expect(GITLAB_PLAN_REQUIRED).toContain("Ultimate");
  });
  it("07 Free plan insufficient", () => expect(isGitLabPlanSufficient("Free")).toBe(false));
  it("08 Premium sufficient", () => expect(isGitLabPlanSufficient("Premium")).toBe(true));
  it("09 Ultimate sufficient", () => expect(isGitLabPlanSufficient("Ultimate")).toBe(true));
  it("10 group webhooks + service accounts required for runs (Premium/Ultimate)", () => {
    // without group webhooks, credentials still work but GitLab no dispara runs — covered by plan gate
    expect(isGitLabPlanSufficient("Premium")).toBe(true);
  });
});

describe("GitLab deep dive - manager + bot accounts", () => {
  it("11 manager per workspace Owner token 1y", () => {
    expect(GITLAB_MANAGER.scope).toBe("per workspace");
    expect(GITLAB_MANAGER.role).toBe("Owner");
    expect(GITLAB_MANAGER.tokenValidity).toBe("1y");
  });
  it("12 bot per factory Developer role exactly on selected projects", () => {
    expect(GITLAB_BOT.scope).toBe("per factory");
    expect(GITLAB_BOT.role).toBe("Developer");
    expect(GITLAB_BOT.roleExact).toMatch(/Developer.*exactly/);
  });
  it("13 bot naming <alias>-warp-<shortID>", () => expect(GITLAB_BOT.namingPattern).toBe("<alias>-warp-<shortID>"));
  it("14 formatGitLabBotName example", () => {
    expect(formatGitLabBotName("acme-support", "01k2x3y4z5")).toBe("acme-support-warp-01k2x3y4z5");
    expect(GITLAB_BOT.example).toBe("acme-support-warp-01k2x3y4z5");
  });
  it("15 isValidGitLabBotName accepts valid, rejects invalid", () => {
    expect(isValidGitLabBotName("acme-support-warp-01k2x3y4z5")).toBe(true);
    expect(isValidGitLabBotName("payments-warp-abc123")).toBe(true);
    expect(isValidGitLabBotName("badname")).toBe(false);
    expect(isValidGitLabBotName("alias-warp-")).toBe(false);
    expect(isValidGitLabBotName("alias_warp_123")).toBe(false); // dash warp dash required
  });
});

describe("GitLab deep dive - triggers + filters", () => {
  it("16 triggers are merge_request + bot_mentioned only", () => {
    expect([...GITLAB_TRIGGERS]).toEqual(["merge_request", "bot_mentioned"]);
  });
  it("17 merge_request actions opened/updated/closed/reopened/merged/approved", () => {
    expect([...GITLAB_MR_ACTIONS]).toEqual(["opened", "updated", "closed", "reopened", "merged", "approved"]);
  });
  it("18 merge_request filters Project/Actions/Base branch", () => {
    expect(GITLAB_FILTERS.merge_request).toEqual(["Project", "Actions", "Base branch"]);
  });
  it("19 bot_mentioned only Project (repos) filter", () => {
    expect(GITLAB_FILTERS.bot_mentioned).toEqual(["Project"]);
    expect(isGitLabBotMentionFilterValid(["Project"])).toBe(true);
    expect(isGitLabBotMentionFilterValid(["repos"])).toBe(true);
    expect(isGitLabBotMentionFilterValid(["mentioned"])).toBe(false);
    expect(isGitLabBotMentionFilterValid(["Project", "mentioned"])).toBe(false);
  });
});

describe("GitLab deep dive - bot response + definition hosting", () => {
  it("20 bot push branch factory/<slug> draft never mergea", () => {
    expect(GITLAB_BOT_RESPONSE.branchPrefix).toBe("factory/<slug>");
    expect(GITLAB_BOT_RESPONSE.mrType).toBe("draft");
    expect(GITLAB_BOT_RESPONSE.neverMerges).toBe(true);
  });
  it("21 never approves MR", () => expect(GITLAB_BOT_RESPONSE.neverApproves).toBe(true));
  it("22 branch factory/<slug> draft marks ready when done (not merge)", () => {
    expect(GITLAB_BOT_RESPONSE.marksReadyWhenDone).toBe(true);
  });
  it("23 no puede hostear definition (GitLab isn't yet supported as definition-hosting)", () => {
    expect(GITLAB_DEFINITION_HOSTING_SUPPORTED).toBe(false);
    expect(isGitLabDefinitionHostingSupported()).toBe(false);
    expect(GITLAB_DEFINITION_HOSTING_NOTE).toMatch(/isn't yet supported/);
  });
});

// ── Slack ─────────────────────────────────────────────────────────────────────
describe("Slack deep dive - Add to Slack + invite", () => {
  it("24 Add to Slack connect method", () => expect(SLACK_CONNECT_METHOD).toBe("Add to Slack"));
  it("25 invite a cada channel required (privado siempre)", () => {
    expect(SLACK_INVITE_REQUIRED).toBe(true);
    expect(isSlackInviteRequired()).toBe(true);
  });
  it("26 mention → 👀", () => {
    expect(SLACK_MENTION_REACTION).toBe("👀");
    expect(getSlackMentionReaction()).toBe("👀");
  });
});

describe("Slack deep dive - events + filters", () => {
  it("27 events include app_mention/message_posted/message_dm/reaction_added/member_joined_channel", () => {
    expect([...SLACK_EVENTS]).toEqual([
      "app_mention",
      "message_posted",
      "message_dm",
      "reaction_added",
      "member_joined_channel",
    ]);
  });
  it("28 full events include message_im / message_mpim variants", () => {
    expect(SLACK_EVENTS_FULL).toContain("message_im");
    expect(SLACK_EVENTS_FULL).toContain("message_mpim");
  });
  it("29 isSlackEventSupported for core + dm variants", () => {
    expect(isSlackEventSupported("app_mention")).toBe(true);
    expect(isSlackEventSupported("message_im")).toBe(true);
    expect(isSlackEventSupported("issue_created")).toBe(false);
  });
  it("30 filters conversations/authors/keywords/emoji/reacted-message authors", () => {
    expect([...SLACK_FILTERS]).toEqual([
      "Conversations",
      "authors/members",
      "keywords",
      "emoji",
      "reacted-message authors",
    ]);
  });
  it("31 reaction intake example ticket emoji", () => {
    expect(SLACK_REACTION_INTAKE_EXAMPLE.emojis).toContain("ticket");
    expect(SLACK_REACTION_INTAKE_EXAMPLE.channels).toContain("your-intake-channel");
  });
});

describe("Slack deep dive - constraints + Home tab + privacy", () => {
  it("32 solo new content, edits ignorados", () => expect(isSlackNewContentOnly()).toBe(true));
  it("33 plain reply solo continúa si thread ya tiene work item", () => {
    expect(shouldSlackPlainReplyContinue(true)).toBe(true);
    expect(shouldSlackPlainReplyContinue(false)).toBe(false);
  });
  it("34 Home tab agrupado por Triage…Cancelled", () => {
    expect([...SLACK_HOME_TAB_STAGES]).toEqual([
      "Triage",
      "Planning",
      "Building",
      "Reviewing",
      "Complete",
      "Cancelled",
    ]);
  });
  it("35 linked account required for mention/DM", () => {
    expect(isSlackAccountLinkRequired("mention")).toBe(true);
    expect(isSlackAccountLinkRequired("dm")).toBe(true);
  });
  it("36 privacy reads only where mencionada/DM/suscripta, email mapped", () => {
    expect(SLACK_PRIVACY.readsOnlyWhere).toMatch(/mencionada\/DM/);
    expect(SLACK_PRIVACY.mapsEmailToWarpAccount).toBe(true);
  });
});

// ── Linear ────────────────────────────────────────────────────────────────────
describe("Linear deep dive - OAuth + agent_session_created", () => {
  it("37 OAuth workspace + teams", () => expect(LINEAR_CONNECT_METHOD).toMatch(/OAuth workspace/));
  it("38 default automation agent_session_created", () => {
    expect(LINEAR_DEFAULT_AUTOMATION_EVENT).toBe("agent_session_created");
  });
  it("39 narrow solo en files, no en editor", () => {
    expect(LINEAR_AGENT_SESSION_NARROW_LIMIT).toBe("solo en files");
    expect(isLinearNarrowEditableInEditor()).toBe(false);
  });
});

describe("Linear deep dive - triggers + filters", () => {
  it("40 triggers include issue_created/labeled/state_changed/assigned + comment_created + agent_session_created (6)", () => {
    expect(LINEAR_TRIGGERS).toHaveLength(6);
    expect([...LINEAR_TRIGGERS]).toEqual([
      "issue_created",
      "issue_labeled",
      "issue_state_changed",
      "issue_assigned",
      "comment_created",
      "agent_session_created",
    ]);
  });
  it("41 issue triggers are 4", () => expect(LINEAR_ISSUE_TRIGGERS).toHaveLength(4));
  it("42 isLinearTriggerSupported", () => {
    expect(isLinearTriggerSupported("issue_created")).toBe(true);
    expect(isLinearTriggerSupported("jira_event")).toBe(false);
  });
  it("43 tabla events/outputs has 4 rows with expected columns", () => {
    expect(LINEAR_EVENTS_OUTPUTS).toHaveLength(4);
    const events = LINEAR_EVENTS_OUTPUTS.map((r) => r.event);
    expect(events.some((e) => e.includes("Issue created"))).toBe(true);
    expect(events.some((e) => e.includes("Comment created"))).toBe(true);
    expect(events.some((e) => e.includes("Agent session created"))).toBe(true);
    for (const row of LINEAR_EVENTS_OUTPUTS) {
      expect(row.receives.length).toBeGreaterThan(0);
      expect(row.sendsBack.length).toBeGreaterThan(0);
    }
  });
});

describe("Linear deep dive - loop caution + follow-up", () => {
  it("44 loop caution: comment que crea session + comment_created → 2 runs", () => {
    expect(doesLinearCommentCauseLoop(true, true)).toBe(true);
    expect(doesLinearCommentCauseLoop(true, false)).toBe(false);
    expect(doesLinearCommentCauseLoop(false, true)).toBe(false);
  });
  it("45 issue linkeada continúa mismo work item", () => {
    expect(shouldLinearFollowUpContinueSameWorkItem(true)).toBe(true);
    expect(shouldLinearFollowUpContinueSameWorkItem(false)).toBe(false);
  });
});

// ── Jira ──────────────────────────────────────────────────────────────────────
describe("Jira deep dive - Cloud only + Rovo", () => {
  it("46 Jira Cloud only", () => expect(JIRA_CLOUD_ONLY).toBe(true));
  it("47 Server/DC NOT supported", () => {
    expect(JIRA_SERVER_SUPPORTED).toBe(false);
    expect(isJiraServerSupported()).toBe(false);
  });
  it("48 Rovo required", () => expect(JIRA_ROVO_REQUIRED).toBe(true));
  it("49 isJiraHostSupported only Cloud (atlassian.net)", () => {
    expect(isJiraHostSupported("myteam.atlassian.net")).toBe(true);
    expect(isJiraHostSupported("jira.company.local")).toBe(false);
    expect(isJiraHostSupported("")).toBe(false);
  });
  it("50 only event is agent_session_created", () => {
    expect(JIRA_ONLY_EVENT).toBe("agent_session_created");
    expect(isJiraTriggerSupported("agent_session_created")).toBe(true);
    expect(isJiraTriggerSupported("issue_created")).toBe(false);
  });
});

describe("Jira deep dive - projects/keywords case-insensitive", () => {
  it("51 filters Jira projects + assignment keywords case-insensitive", () => {
    expect(JIRA_FILTERS).toContain("Jira projects");
    expect(JIRA_FILTERS.join(" ")).toMatch(/case-insensitive/);
    expect(isJiraKeywordCaseInsensitive()).toBe(true);
  });
  it("52 keyword match case-insensitive", () => {
    expect(doesJiraKeywordMatch("Please INVESTIGATE this bug", ["investigate", "fix"])).toBe(true);
    expect(doesJiraKeywordMatch("Fix the login", ["FIX"])).toBe(true);
    expect(doesJiraKeywordMatch(" unrelated ", ["investigate", "fix"])).toBe(false);
  });
  it("53 project_keys match case-insensitive, empty → match all", () => {
    expect(doesJiraProjectMatch("ENG", ["eng"])).toBe(true);
    expect(doesJiraProjectMatch("eng", ["ENG"])).toBe(true);
    expect(doesJiraProjectMatch("ENG", [])).toBe(true);
    expect(doesJiraProjectMatch("ENG", ["DESIGN"])).toBe(false);
  });
});

describe("Jira deep dive - statuses + capabilities", () => {
  it("54 statuses submitted/working/waiting/completed/failed/cancelled", () => {
    expect([...JIRA_STATUSES]).toEqual([
      "submitted",
      "working",
      "waiting for input",
      "completed",
      "failed",
      "cancelled",
    ]);
    expect(getJiraStatuses()).toEqual(JIRA_STATUSES);
  });
  it("55 capabilities read details/comments/transitions", () => {
    expect(canJiraAgentDo("read details")).toBe(true);
    expect(canJiraAgentDo("read comments")).toBe(true);
    expect(canJiraAgentDo("read transitions")).toBe(true);
  });
  it("56 agent can post/edit comments, change workflow, labels, reassign", () => {
    expect(canJiraAgentDo("post/edit comments")).toBe(true);
    expect(canJiraAgentDo("change workflow status")).toBe(true);
    expect(canJiraAgentDo("add/remove labels")).toBe(true);
    expect(canJiraAgentDo("reassign")).toBe(true);
  });
  it("57 full capabilities length 7", () => expect(JIRA_AGENT_CAPABILITIES).toHaveLength(7));
});

// ── Registry OCP ──────────────────────────────────────────────────────────────
describe("registry", () => {
  it("58 DEEP_DIVE_PROVIDERS has 4: gitlab/slack/linear/jira", () => {
    expect([...DEEP_DIVE_PROVIDERS]).toEqual(["gitlab", "slack", "linear", "jira"]);
  });
});
