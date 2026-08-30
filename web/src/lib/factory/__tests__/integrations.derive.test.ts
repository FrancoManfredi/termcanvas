import { describe, it, expect } from "vitest";
import { parseFactoryYaml } from "../parsers/factory.parser";
import { getFactoryBundle } from "../hooks/useFactoryBundle";
import {
  PROVIDER_TABLE,
  getIntegratedTypes,
  hasTrackerConflict,
  isValidIntegrationType,
  hasGitHubInIntegrations,
  deriveProviderStatuses,
  integrationSummaryMessage,
  validateAlias,
} from "../domain/integrations.derive";

function bundle() {
  const r = getFactoryBundle();
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value!;
}

describe("integrations - mutual exclusion linear+jira", () => {
  it("1. SAMPLE_FACTORY_FULL has only slack", () => {
    expect(getIntegratedTypes(bundle())).toEqual(["slack"]);
  });
  it("2. slack + linear allowed", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
integrations:
  - type: slack
  - type: linear
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("3. slack + jira allowed", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
integrations:
  - type: slack
  - type: jira
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
  it("4. linear + jira mutually exclusive fails", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
integrations:
  - type: linear
  - type: jira
agentDefaults:
  model: auto
`;
    const r = parseFactoryYaml(yaml);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /mutually exclusive/.test(i.message))).toBe(true);
  });
  it("5. hasTrackerConflict detects linear+jira", () => {
    expect(hasTrackerConflict(["linear", "jira"])).toBe(true);
  });
  it("6. hasTrackerConflict false for slack+linear", () => {
    expect(hasTrackerConflict(["slack", "linear"])).toBe(false);
  });
  it("7. omitting tracker is valid (no integrations)", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(true);
    expect(integrationSummaryMessage([])).toMatch(/omitir tracker/);
  });
  it("8. duplicate type fails", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
integrations:
  - type: slack
  - type: slack
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
});

describe("GitHub no en integrations", () => {
  it("9. integrations [{type: github}] fails", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
integrations:
  - type: github
agentDefaults:
  model: auto
`;
    const r = parseFactoryYaml(yaml);
    expect(r.ok).toBe(false);
  });
  it("10. GitHub via repositories + GitHub App not in integrations", () => {
    const b = bundle();
    expect(getIntegratedTypes(b)).not.toContain("github" as never);
    expect(b.factory.repositories.length).toBeGreaterThan(0);
  });
  it("11. hasGitHubInIntegrations detects github entry", () => {
    expect(hasGitHubInIntegrations([{ type: "github" }])).toBe(true);
    expect(hasGitHubInIntegrations([{ type: "slack" }])).toBe(false);
  });
  it("12. isValidIntegrationType only slack linear jira", () => {
    expect(isValidIntegrationType("slack")).toBe(true);
    expect(isValidIntegrationType("linear")).toBe(true);
    expect(isValidIntegrationType("jira")).toBe(true);
    expect(isValidIntegrationType("github")).toBe(false);
    expect(isValidIntegrationType("gitlab")).toBe(false);
  });
});

describe("alias charset", () => {
  it("13. alias payments valid", () => {
    expect(validateAlias("payments").ok).toBe(true);
  });
  it("14. alias max 60 ok, 61 fail", () => {
    expect(validateAlias("a".repeat(60)).ok).toBe(true);
    expect(validateAlias("a".repeat(61)).ok).toBe(false);
  });
  it("15. alias charset [A-Za-z0-9 ._-] allowed", () => {
    expect(validateAlias("my Alias 1.0_test-OK").ok).toBe(true);
  });
  it("16. alias with @ invalid", () => {
    expect(validateAlias("bad@alias").ok).toBe(false);
  });
  it("17. parser fails alias bad charset (integration with alias)", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
alias: bad@alias
repositories:
  - owner: acme
    name: repo
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
});

describe("mcp warpId requerido", () => {
  it("18. mcpServers requires warpId (factory)", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
mcpServers:
  sentry: {}
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(false);
  });
  it("19. valid warpId passes", () => {
    const yaml = `schemaVersion: v1alpha1
name: x
repositories:
  - owner: acme
    name: repo
mcpServers:
  sentry:
    warpId: SENTRY_MCP_SERVER_ID
agentDefaults:
  model: auto
`;
    expect(parseFactoryYaml(yaml).ok).toBe(true);
  });
});

describe("provider table §9 mapa general", () => {
  it("20. provider table has 9 entries", () => {
    expect(PROVIDER_TABLE).toHaveLength(9);
  });
  it("21. providers include Slack, GitHub, GitLab, Linear, Jira, Schedule, Factory, Factory API, Factory MCP", () => {
    const names = PROVIDER_TABLE.map((p) => p.provider);
    expect(names).toEqual(expect.arrayContaining(["Slack", "GitHub", "GitLab", "Linear", "Jira", "Schedule", "Factory", "Factory API", "Factory MCP"]));
  });
  it("22. Slack filters include Conversations/authors/keywords/emoji", () => {
    const slack = PROVIDER_TABLE.find((p) => p.provider === "Slack")!;
    expect(slack.filters).toMatch(/Conversations/);
    expect(slack.filters).toMatch(/emoji/i);
  });
  it("23. GitHub notes mention repositories + GitHub App and not in integrations", () => {
    const gh = PROVIDER_TABLE.find((p) => p.provider === "GitHub")!;
    expect(gh.declareLocation).toMatch(/repositories/);
    expect(gh.notes).toMatch(/No se declara en integrations/);
  });
  it("24. Linear and Jira mutually exclusive notes", () => {
    const linear = PROVIDER_TABLE.find((p) => p.provider === "Linear")!;
    const jira = PROVIDER_TABLE.find((p) => p.provider === "Jira")!;
    expect(linear.notes).toMatch(/Mutuamente|linear/i);
    expect(jira.notes).toMatch(/Mutuamente|jira/i);
  });
  it("25. GitLab requires Premium/Ultimate", () => {
    const gl = PROVIDER_TABLE.find((p) => p.provider === "GitLab")!;
    expect(gl.notes).toMatch(/Premium/);
  });
});

describe("mock connected/disconnected status", () => {
  it("26. SAMPLE_FACTORY_FULL slack connected, GitHub connected via repos", () => {
    const statuses = deriveProviderStatuses(bundle());
    expect(statuses["Slack"]).toBe("connected");
    expect(statuses["GitHub"]).toBe("connected");
  });
  it("27. Linear disconnected in sample (only slack)", () => {
    const statuses = deriveProviderStatuses(bundle());
    expect(statuses["Linear"]).toBe("disconnected");
  });
  it("28. Schedule/Factory/API/MCP always connected (no config)", () => {
    const statuses = deriveProviderStatuses(bundle());
    expect(statuses["Schedule"]).toBe("connected");
    expect(statuses["Factory"]).toBe("connected");
  });
});

// ── O14 catalog helpers — getIntegrationTriggers / isTriggerSupported ───────────
describe("O14 — integrations.derive helpers", () => {
  it("29 getIntegrationTriggers slack has 5", async () => {
    const { getIntegrationTriggers } = await import("../domain/integrations.derive");
    expect(getIntegrationTriggers("slack")).toHaveLength(5);
    expect(getIntegrationTriggers("SLACK")).toHaveLength(5);
  });
  it("30 getIntegrationTriggers linear 6, jira 1, gitlab 2, schedule 1, factory 1", async () => {
    const { getIntegrationTriggers } = await import("../domain/integrations.derive");
    expect(getIntegrationTriggers("linear")).toHaveLength(6);
    expect(getIntegrationTriggers("jira")).toHaveLength(1);
    expect(getIntegrationTriggers("gitlab")).toHaveLength(2);
    expect(getIntegrationTriggers("schedule")).toHaveLength(1);
    expect(getIntegrationTriggers("factory")).toHaveLength(1);
  });
  it("31 isTriggerSupported true/false", async () => {
    const { isTriggerSupported } = await import("../domain/integrations.derive");
    expect(isTriggerSupported("slack", "reaction_added")).toBe(true);
    expect(isTriggerSupported("slack", "issue_created")).toBe(false);
    expect(isTriggerSupported("jira", "agent_session_created")).toBe(true);
    expect(isTriggerSupported("jira", "issue_created")).toBe(false);
    expect(isTriggerSupported("gitlab", "bot_mentioned")).toBe(true);
    expect(isTriggerSupported("schedule", "cron_fired")).toBe(true);
    expect(isTriggerSupported("factory", "work_item_stage_changed")).toBe(true);
  });
  it("32 getTriggerFilters returns filters for event", async () => {
    const { getTriggerFilters } = await import("../domain/integrations.derive");
    expect(getTriggerFilters("slack", "reaction_added")).toEqual(expect.arrayContaining(["Conversations", "emoji"]));
    expect(getTriggerFilters("slack", "app_mention")).toContain("Conversations");
    expect(getTriggerFilters("linear", "agent_session_created")).toEqual(["Teams"]);
    expect(getTriggerFilters("jira", "agent_session_created")).toEqual(expect.arrayContaining(["Jira projects"]));
    expect(getTriggerFilters("gitlab", "merge_request")).toEqual(expect.arrayContaining(["Project"]));
    expect(getTriggerFilters("schedule", "cron_fired")).toContain("Cron");
  });
  it("33 unknown provider returns empty + false", async () => {
    const { getIntegrationTriggers, isTriggerSupported, getTriggerFilters } = await import("../domain/integrations.derive");
    expect(getIntegrationTriggers("unknown")).toHaveLength(0);
    expect(isTriggerSupported("unknown", "anything")).toBe(false);
    expect(getTriggerFilters("unknown", "anything")).toEqual([]);
  });
  it("34 github has at least 1 trigger", async () => {
    const { getIntegrationTriggers, isTriggerSupported } = await import("../domain/integrations.derive");
    expect(getIntegrationTriggers("github").length).toBeGreaterThan(0);
    expect(isTriggerSupported("github", "issue_created")).toBe(true);
  });
  it("35 schedule presets and helpers", async () => {
    const { SCHEDULE_PRESETS, describeSchedule, isValidCron } = await import("../domain/schedule.derive");
    expect(SCHEDULE_PRESETS.some((p) => p.cron === "@daily")).toBe(true);
    expect(SCHEDULE_PRESETS.some((p) => p.cron === "@every 1h")).toBe(true);
    expect(isValidCron("0 9 * * 1")).toBe(true);
    expect(isValidCron("@daily")).toBe(true);
    expect(isValidCron("@every 1h")).toBe(true);
    expect(isValidCron("not a cron")).toBe(false);
    expect(describeSchedule("0 9 * * 1")).toMatch(/lunes/);
    expect(describeSchedule("@daily")).toMatch(/diario/);
    expect(describeSchedule("@every 1h")).toMatch(/hora/);
  });
});
