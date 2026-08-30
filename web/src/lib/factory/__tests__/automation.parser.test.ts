import { describe, it, expect } from "vitest";
import { parseAutomationMd } from "../parsers/automation.parser";

const valid = `---
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
`;

describe("AutomationParser — parseAutomationMd", () => {
  it("1. parses valid github trigger", () => {
    const r = parseAutomationMd(valid, "automations/labeled-issue/automation.md");
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("labeled-issue");
    expect(r.value?.triggers).toHaveLength(1);
  });
  it("2. parses multiple triggers", () => {
    const raw = valid.replace("labels: [\"factory-ready\"]", "labels: [\"factory-ready\"]\n  - provider: slack\n    event: app_mention");
    const r = parseAutomationMd(raw, "automations/multi/automation.md");
    expect(r.ok).toBe(true);
    expect(r.value?.triggers).toHaveLength(2);
  });
  it("3. parses disabled false", () => {
    const raw = valid.replace("enabled: true", "enabled: false");
    expect(parseAutomationMd(raw, "automations/x/automation.md").value?.enabled).toBe(false);
  });
  it("4. defaults enabled true and agent foreman", () => {
    const raw = `---
triggers:
  - provider: github
    event: issue_created
---
Do it.
`;
    const r = parseAutomationMd(raw, "automations/x/automation.md");
    expect(r.ok).toBe(true);
    expect(r.value?.enabled).toBe(true);
    expect(r.value?.agent).toBe("foreman");
  });
  it("5. parses with filter not_in", () => {
    const raw = `---
triggers:
  - provider: github
    event: pull_request_opened
    filter:
      repos: ["acme/api"]
      base_branches: ["main"]
      labels:
        not_in: ["wip"]
---
Check PR.
`;
    expect(parseAutomationMd(raw, "automations/x/automation.md").ok).toBe(true);
  });
  it("6. parses schedule trigger", () => {
    const raw = `---
triggers:
  - provider: schedule
    event: cron_fired
    schedule: "@daily"
---
Run daily.
`;
    expect(parseAutomationMd(raw, "automations/daily/automation.md").ok).toBe(true);
  });
  it("7. fails on empty", () => {
    expect(parseAutomationMd("", "automations/x/automation.md").ok).toBe(false);
  });
  it("8. fails on missing triggers", () => {
    const raw = `---
agent: foreman
---
Body.
`;
    expect(parseAutomationMd(raw, "automations/x/automation.md").ok).toBe(false);
  });
  it("9. fails on empty triggers array", () => {
    const raw = `---
triggers: []
---
Body.
`;
    expect(parseAutomationMd(raw, "automations/x/automation.md").ok).toBe(false);
  });
  it("10. fails on missing body", () => {
    const raw = `---
triggers:
  - provider: github
    event: issue_created
---
`;
    const r = parseAutomationMd(raw, "automations/x/automation.md");
    expect(r.ok).toBe(false);
  });
  it("11. fails when both model and harness set", () => {
    const raw = `---
triggers:
  - provider: github
    event: issue_created
model: auto
harness:
  type: oz
  model: auto
---
Body.
`;
    expect(parseAutomationMd(raw, "automations/x/automation.md").ok).toBe(false);
  });
  it("12. parses with runner override", () => {
    const raw = `---
triggers:
  - provider: github
    event: issue_created
runner: mac-runner
---
Body.
`;
    expect(parseAutomationMd(raw, "automations/x/automation.md").ok).toBe(true);
  });
  it("13. fails on invalid provider", () => {
    const raw = `---
triggers:
  - provider: invalid
    event: issue_created
---
Body.
`;
    expect(parseAutomationMd(raw, "automations/x/automation.md").ok).toBe(false);
  });
  it("14. extracts name fallback", () => {
    const raw = `---
triggers:
  - provider: github
    event: issue_created
---
Body.
`;
    const r = parseAutomationMd(raw, "some.md");
    expect(r.ok).toBe(true);
    expect(r.value?.name).toBe("some");
  });
  it("15. fails on invalid YAML frontmatter", () => {
    const raw = `---\n::: bad yaml :::\n---\nBody`;
    // gray-matter may parse leniently but zod will fail
    const r = parseAutomationMd(raw, "automations/x/automation.md");
    // should be fail either way — check not ok or ok but we expect fail
    // if it parses as object, it will fail zod because triggers missing
    expect(r.ok).toBe(false);
  });
});
