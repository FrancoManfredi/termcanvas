import { describe, it, expect } from "vitest";
import { parseAutomationMd } from "../parsers/automation.parser";
import { findMatchingAutomations, matchesAutomation, matchesTrigger, evaluateEvent } from "../domain/automation.engine";
import type { AutomationDefinition } from "../domain/types";


function mkAutomation(raw: string, file: string): AutomationDefinition {
  const res = parseAutomationMd(raw, file);
  if (!res.ok) throw new Error(`parse failed: ${JSON.stringify(res.issues)}`);
  return res.value!;
}

// Real fixture-based automation: SAMPLE_AUTOMATION_LABELED equivalent
const LABELED = mkAutomation(
  `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      repos: ["acme/payments-service"]
      labels: ["factory-ready"]
---

Review the labeled issue and decide next stage.
`,
  "automations/labeled-issue/automation.md"
);

const PR_REVIEW_ONLY = mkAutomation(
  `---
enabled: true
agent: reviewer
triggers:
  - provider: github
    event: pull_request_opened
    filter:
      repos: ["acme/api-service"]
      base_branches: ["main"]
      labels:
        not_in: ["wip"]
---

Check PR against main without wip.
`,
  "automations/code-review-only/automation.md"
);

const SLACK_MENTION = mkAutomation(
  `---
enabled: true
agent: foreman
triggers:
  - provider: slack
    event: app_mention
    filter:
      repos: ["acme/payments-service"]
---

Slack mention.
`,
  "automations/slack-mention/automation.md"
);

const SCHEDULE_DAILY = mkAutomation(
  `---
enabled: true
agent: foreman
triggers:
  - provider: schedule
    event: cron_fired
    schedule: "@daily"
---

Run daily.
`,
  "automations/daily-cron/automation.md"
);

const DISABLED = mkAutomation(
  `---
enabled: false
agent: foreman
triggers:
  - provider: github
    event: issue_created
    filter:
      repos: ["acme/payments-service"]
---

Disabled automation.
`,
  "automations/disabled/automation.md"
);

const EMPTY_FILTER = mkAutomation(
  `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: issue_created
---

No filter -> match all issue_created.
`,
  "automations/empty-filter/automation.md"
);

const MULTI_TRIGGER = mkAutomation(
  `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      labels: ["factory-ready"]
  - provider: github
    event: issue_created
    filter:
      repos: ["acme/other"]
---

Multi trigger.
`,
  "automations/multi-trigger/automation.md"
);

const IN_NOTIN_COMBINED = mkAutomation(
  `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      labels:
        in: ["factory-ready", "urgent"]
        not_in: ["wontfix"]
      repos: ["acme/payments-service"]
---

Combined in/not_in.
`,
  "automations/combined/automation.md"
);

describe("automation.engine — matching", () => {
  it("1. label OR: match any label in list", () => {
    expect(
      matchesAutomation(LABELED, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["factory-ready"] })
    ).toBe(true);
    expect(
      matchesAutomation(
        mkAutomation(
          `---
triggers:
  - provider: github
    event: issue_labeled
    filter:
      labels: ["bug", "regression"]
---
Body
`,
          "automations/x/automation.md"
        ),
        { provider: "github", event: "issue_labeled", labels: ["regression"] }
      )
    ).toBe(true);
  });

  it("2. todos los filtros AND: repos + labels deben matchear", () => {
    expect(matchesAutomation(LABELED, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["other"] })).toBe(false);
    expect(matchesAutomation(LABELED, { provider: "github", event: "issue_labeled", repos: ["acme/other"], labels: ["factory-ready"] })).toBe(false);
    expect(matchesAutomation(LABELED, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["factory-ready"] })).toBe(true);
  });

  it("3. filtro vacío = match todo (mismo provider+event)", () => {
    expect(matchesAutomation(EMPTY_FILTER, { provider: "github", event: "issue_created", repos: ["any/repo"], labels: ["x"] })).toBe(true);
    expect(matchesAutomation(EMPTY_FILTER, { provider: "github", event: "issue_labeled", repos: ["any"] })).toBe(false); // event mismatch
  });

  it("4. enabled false nunca matchea", () => {
    expect(matchesAutomation(DISABLED, { provider: "github", event: "issue_created", repos: ["acme/payments-service"] })).toBe(false);
  });

  it("5. not_in: excluye label wip", () => {
    expect(matchesAutomation(PR_REVIEW_ONLY, { provider: "github", event: "pull_request_opened", repos: ["acme/api-service"], base_branches: ["main"], labels: ["wip"] })).toBe(false);
    expect(matchesAutomation(PR_REVIEW_ONLY, { provider: "github", event: "pull_request_opened", repos: ["acme/api-service"], base_branches: ["main"], labels: ["feature"] })).toBe(true);
    expect(matchesAutomation(PR_REVIEW_ONLY, { provider: "github", event: "pull_request_opened", repos: ["acme/api-service"], base_branches: ["main"], labels: [] })).toBe(true);
  });

  it("6. in array: solo labels en lista", () => {
    const a = mkAutomation(
      `---
triggers:
  - provider: github
    event: pull_request_labeled
    filter:
      labels:
        in: ["factory-ready", "ready"]
---
Body
`,
      "automations/x/automation.md"
    );
    expect(matchesAutomation(a, { provider: "github", event: "pull_request_labeled", labels: ["factory-ready"] })).toBe(true);
    expect(matchesAutomation(a, { provider: "github", event: "pull_request_labeled", labels: ["other"] })).toBe(false);
  });

  it("7. in + not_in combinado: in exige, not_in excluye", () => {
    expect(matchesAutomation(IN_NOTIN_COMBINED, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["factory-ready"] })).toBe(true);
    expect(matchesAutomation(IN_NOTIN_COMBINED, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["wontfix"] })).toBe(false);
    expect(matchesAutomation(IN_NOTIN_COMBINED, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["urgent", "wontfix"] })).toBe(false); // not_in blocks even if in matches
    expect(matchesAutomation(IN_NOTIN_COMBINED, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["other"] })).toBe(false);
  });

  it("8. múltiples automations: evento puede matchear varias", () => {
    const all = [LABELED, PR_REVIEW_ONLY, EMPTY_FILTER];
    const ev = { provider: "github", event: "issue_created", repos: ["acme/payments-service"] };
    const matched = findMatchingAutomations(all, ev);
    expect(matched.map((m) => m.name)).toContain("empty-filter");
    expect(matched.map((m) => m.name)).not.toContain("labeled-issue");
  });

  it("9. múltiples automations con mismo evento: preview simula", () => {
    const all = [LABELED, IN_NOTIN_COMBINED, MULTI_TRIGGER];
    const ev = { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["factory-ready"] };
    const matched = findMatchingAutomations(all, ev);
    expect(matched.length).toBe(3);
  });

  it("10. schedule trigger: match cron_fired", () => {
    expect(matchesAutomation(SCHEDULE_DAILY, { provider: "schedule", event: "cron_fired" })).toBe(true);
    expect(matchesAutomation(SCHEDULE_DAILY, { provider: "schedule", event: "cron_fired", schedule: "@daily" })).toBe(true);
    // si schedule no coincide, no matchea cuando event trae schedule distinto
    expect(matchesAutomation(SCHEDULE_DAILY, { provider: "schedule", event: "cron_fired", schedule: "@hourly" })).toBe(false);
  });

  it("11. provider mismatch no matchea", () => {
    expect(matchesAutomation(SLACK_MENTION, { provider: "github", event: "app_mention" })).toBe(false);
  });

  it("12. event mismatch no matchea", () => {
    expect(matchesAutomation(LABELED, { provider: "github", event: "issue_created", repos: ["acme/payments-service"], labels: ["factory-ready"] })).toBe(false);
  });

  it("13. branches filter OR dentro de key", () => {
    const a = mkAutomation(
      `---
triggers:
  - provider: github
    event: push
    filter:
      branches: ["main", "develop"]
---
Body
`,
      "automations/x/automation.md"
    );
    expect(matchesAutomation(a, { provider: "github", event: "push", branches: ["main"] })).toBe(true);
    expect(matchesAutomation(a, { provider: "github", event: "push", branches: ["feature/x"] })).toBe(false);
    expect(matchesAutomation(a, { provider: "github", event: "push", branches: ["develop", "other"] })).toBe(true);
  });

  it("14. base_branches AND con repos", () => {
    expect(matchesAutomation(PR_REVIEW_ONLY, { provider: "github", event: "pull_request_opened", repos: ["acme/api-service"], base_branches: ["develop"] })).toBe(false);
    expect(matchesAutomation(PR_REVIEW_ONLY, { provider: "github", event: "pull_request_opened", repos: ["acme/api-service"], base_branches: ["main"] })).toBe(true);
  });

  it("15. repo singular/plural alias: filter repos matches event repo", () => {
    // event provides repo singular string
    expect(matchesAutomation(LABELED, { provider: "github", event: "issue_labeled", repo: "acme/payments-service", labels: ["factory-ready"] } as never)).toBe(true);
  });

  it("16. empty labels array con filter OR no matchea si evento sin labels", () => {
    expect(matchesAutomation(LABELED, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: [] })).toBe(false);
  });

  it("17. multi-trigger OR: automation matchea si alguno de sus triggers matchea", () => {
    expect(matchesAutomation(MULTI_TRIGGER, { provider: "github", event: "issue_labeled", labels: ["factory-ready"] })).toBe(true);
    expect(matchesAutomation(MULTI_TRIGGER, { provider: "github", event: "issue_created", repos: ["acme/other"] })).toBe(true);
    expect(matchesAutomation(MULTI_TRIGGER, { provider: "github", event: "issue_created", repos: ["acme/nope"] })).toBe(false);
  });

  it("18. matchesTrigger puro: filtro vacío true, AND false", () => {
    const t = { provider: "github", event: "issue_created", filter: {} } as never;
    expect(matchesTrigger(t, { provider: "github", event: "issue_created" })).toBe(true);
    const t2 = { provider: "github", event: "issue_created", filter: { repos: ["a/b"], labels: ["x"] } } as never;
    expect(matchesTrigger(t2, { provider: "github", event: "issue_created", repos: ["a/b"] } as never)).toBe(false);
  });

  it("19. evaluateEvent separa matched/unmatched", () => {
    const all = [LABELED, EMPTY_FILTER, DISABLED];
    const { matched, unmatched } = evaluateEvent(all, { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["factory-ready"] });
    expect(matched.some((m) => m.name === "labeled-issue")).toBe(true);
    expect(unmatched.some((m) => m.name === "disabled")).toBe(true);
  });

  it("20. not_in solo: permite todo excepto bloqueados", () => {
    const a = mkAutomation(
      `---
triggers:
  - provider: github
    event: pull_request_opened
    filter:
      labels:
        not_in: ["wip", "draft"]
---
Body
`,
      "automations/x/automation.md"
    );
    expect(matchesAutomation(a, { provider: "github", event: "pull_request_opened", labels: ["wip"] })).toBe(false);
    expect(matchesAutomation(a, { provider: "github", event: "pull_request_opened", labels: ["ready"] })).toBe(true);
    expect(matchesAutomation(a, { provider: "github", event: "pull_request_opened", labels: [] })).toBe(true);
  });

  it("21. repos filter con not_in", () => {
    const a = mkAutomation(
      `---
triggers:
  - provider: github
    event: push
    filter:
      repos:
        not_in: ["acme/private"]
---
Body
`,
      "automations/x/automation.md"
    );
    expect(matchesAutomation(a, { provider: "github", event: "push", repos: ["acme/private"] })).toBe(false);
    expect(matchesAutomation(a, { provider: "github", event: "push", repos: ["acme/public"] })).toBe(true);
  });

  it("22. ejemplo real SAMPLE_AUTOMATION_LABELED: issue_labeled factory-ready matchea, otro label no", () => {
    const evMatch = { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["factory-ready"] };
    const evNo = { provider: "github", event: "issue_labeled", repos: ["acme/payments-service"], labels: ["bug"] };
    expect(matchesAutomation(LABELED, evMatch)).toBe(true);
    expect(matchesAutomation(LABELED, evNo)).toBe(false);
  });

  it("23. schedule filtro vacío matchea todo cron_fired", () => {
    const a = mkAutomation(
      `---
triggers:
  - provider: schedule
    event: cron_fired
    schedule: "@hourly"
---

Hourly.
`,
      "automations/hourly/automation.md"
    );
    expect(matchesAutomation(a, { provider: "schedule", event: "cron_fired" })).toBe(true);
  });

  it("24. github push con filter vacio matchea cualquier push", () => {
    const a = mkAutomation(
      `---
triggers:
  - provider: github
    event: push
---

Any push.
`,
      "automations/push/automation.md"
    );
    expect(matchesAutomation(a, { provider: "github", event: "push", repos: ["x/y"], branches: ["any"] })).toBe(true);
  });

  it("25. labels OR con varios valores en evento: cualquiera matchea", () => {
    const a = mkAutomation(
      `---
triggers:
  - provider: github
    event: issue_labeled
    filter:
      labels: ["factory-ready", "urgent"]
---
Body
`,
      "automations/x/automation.md"
    );
    expect(matchesAutomation(a, { provider: "github", event: "issue_labeled", labels: ["other", "urgent"] })).toBe(true);
    expect(matchesAutomation(a, { provider: "github", event: "issue_labeled", labels: ["other"] })).toBe(false);
  });
});
