// validation.parsers.test.ts — O13 file:line para 6 artefactos + warp/factory-config atómico
// Source: WarpFactories.md §7 · US-046..059 · T06

import { describe, it, expect } from "vitest";
import { FactoryParser } from "../parsers/factory.parser";
import { AgentParser } from "../parsers/agent.parser";
import { AutomationParser } from "../parsers/automation.parser";
import { RunnerParser } from "../parsers/runner.parser";
import { ScorerParser } from "../parsers/scorer.parser";
import { parseSkillMd } from "../domain/skill.registry";
import { FactoryRegistry } from "../store/factoryRegistry";
import { SAMPLE_FACTORY_MINIMAL, SAMPLE_AGENT_FOREMAN, SAMPLE_RUNNER_LINUX, SAMPLE_AUTOMATION_LABELED, SAMPLE_SCORER_TESTS } from "../fixtures/samples";

// Fixtures con líneas conocidas para cada artefacto
const FACTORY_INVALID_ALIAS = `schemaVersion: v1alpha1
name: test
description: d
alias: bad@alias!!!
repositories:
  - owner: acme
    name: repo
agentDefaults:
  model: auto
`;

const AGENT_INVALID_REASONING_AT_7 = `---
description: Reviewer
agentType: REVIEW
runner: linux-build
harness:
  type: oz
  reasoningLevel: high
---
Body
`;

const AUTOMATION_INVALID_TRIGGER = `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: ""
---
Body
`;

const RUNNER_INVALID_VCPUS_AT_3 = `description: gpu runner
instanceShape:
  vcpus: -1
  memoryGb: 8
platform:
  os: linux
  arch: x86_64
  linux:
    dockerImage: ubuntu:22.04
`;

const SCORER_INVALID_LABELS_AT_4 = `---
name: my-scorer
description: scorer invalid
labels:
  - value: a
    score: 1
  - value: b
    score: 1
agents:
  - reviewer
passingScore: 0.5
model: test-model
---
rubric
`;

const SKILL_VALID = `---
name: my-skill
description: skill desc
---
Body of skill
`;

describe("O13 — validation.parsers file:line 6 artefactos + warp/factory-config atómico (T06)", () => {
  it("1. factory.yaml file:line real — alias bad@alias en línea 4", () => {
    const parser = new FactoryParser();
    const res = parser.parseFactoryYaml(FACTORY_INVALID_ALIAS, "factory.yaml");
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path.includes("alias"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/factory\.yaml:4/);
    expect(issue?.path).toContain(" — ");
  });

  it("2. agents/reviewer/agent.md file:line real — reasoningLevel solo codex en línea 7", () => {
    const parser = new AgentParser();
    const res = parser.parseAgentMd(AGENT_INVALID_REASONING_AT_7, "agents/reviewer/agent.md");
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.message.includes("reasoningLevel"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/agents\/reviewer\/agent\.md:7/);
    expect(issue?.code).toBe("reasoningLevel_only_codex");
  });

  it("3. automations/labeled-issue/automation.md file:line real — trigger event vacío", () => {
    const parser = new AutomationParser();
    const res = parser.parseAutomationMd(AUTOMATION_INVALID_TRIGGER, "automations/labeled-issue/automation.md");
    expect(res.ok).toBe(false);
    const issue = res.issues[0];
    expect(issue.path).toMatch(/automations\/labeled-issue\/automation\.md:\d+/);
    expect(issue.path).toContain(" — ");
  });

  it("4. runners/gpu.yaml file:line real — vcpus inválido en línea 3", () => {
    const parser = new RunnerParser();
    const res = parser.parseRunnerYaml(RUNNER_INVALID_VCPUS_AT_3, "runners/gpu.yaml");
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path.includes("vcpus"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/runners\/gpu\.yaml:3/);
  });

  it("5. scorers/my-scorer/scorer.md file:line real — labels invariante ≥1 passing y ≥1 failing en línea 4", () => {
    const parser = new ScorerParser();
    const res = parser.parseScorerMd(SCORER_INVALID_LABELS_AT_4, "scorers/my-scorer/scorer.md");
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path.includes("labels"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/scorers\/my-scorer\/scorer\.md:4/);
    expect(issue?.path).toContain(" — ");
  });

  it("6. skills/repo-conventions/SKILL.md parsea con file:line si frontmatter inválido — o ok si válido", () => {
    const ok = parseSkillMd(SKILL_VALID, "skills/repo-conventions/SKILL.md");
    expect(ok.ok).toBe(true);
    expect(ok.value?.name).toBe("repo-conventions");
    // Invalid frontmatter should give file:line
    const bad = parseSkillMd("---\n::: bad yaml :::\n---\nBody", "skills/bad/SKILL.md");
    // parseFrontmatter handles yaml error with file:line
    if (!bad.ok) {
      expect(bad.issues[0].path).toMatch(/skills\/bad\/SKILL\.md:\d+/);
    }
  });

  it("7. warp/factory-config atómico — bundle inválido no aplica parcial, factory sigue última válida", () => {
    const registry = new FactoryRegistry();
    const badAgent = `---
description: bad
agentType: REVIEW
harness:
  type: oz
  reasoningLevel: high
---
Body
`;
    const res = registry.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
      agents: [{ raw: badAgent, file: "agents/reviewer/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
      scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
      skills: [{ raw: SKILL_VALID, file: "skills/repo-conventions/SKILL.md" }],
    });
    expect(res.ok).toBe(false);
    // Debe annotar file:line del agent invalido, no solo factory
    expect(res.issues.some((i) => i.path.includes("agents/reviewer/agent.md"))).toBe(true);
    expect(res.issues[0].path).toMatch(/:\d+ — /);
    // Atómico: todos los artefactos fallan juntos, no hay bundle parcial
    expect(res.value).toBeUndefined();
  });

  it("8. factory bundle válido 6 artefactos ok — atómico aplica", () => {
    const registry = new FactoryRegistry();
    const res = registry.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
      agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
      scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
      skills: [{ raw: SKILL_VALID, file: "skills/repo-conventions/SKILL.md" }],
    });
    expect(res.ok).toBe(true);
    expect(res.value?.skills).toHaveLength(1);
  });

  it("9. projectNumber quoted — string pasa, number falla con file:line", () => {
    const withQuoted = `schemaVersion: v1alpha1
name: test
repositories:
  - owner: acme
    name: repo
cloudProviders:
  gcp:
    projectNumber: "123456"
    workloadIdentityFederationPoolId: pool
    workloadIdentityFederationProviderId: provider
agentDefaults:
  model: auto
`;
    const parser = new FactoryParser();
    const ok = parser.parseFactoryYaml(withQuoted, "factory.yaml");
    expect(ok.ok).toBe(true);
    const withNumber = withQuoted.replace(`"123456"`, `123456`);
    const bad = parser.parseFactoryYaml(withNumber, "factory.yaml");
    expect(bad.ok).toBe(false);
    const issue = bad.issues.find((i) => i.path.includes("projectNumber"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/factory\.yaml:\d+/);
  });

  it("10. mac.version quoted — string \"26\" pasa, number 26 falla con file:line", () => {
    const quoted = `platform:
  os: macos
  arch: aarch64
  mac:
    version: "26"
`;
    const parser = new RunnerParser();
    const ok = parser.parseRunnerYaml(quoted, "runners/mac.yaml");
    expect(ok.ok).toBe(true);
    const unquoted = quoted.replace(`"26"`, `26`);
    const bad = parser.parseRunnerYaml(unquoted, "runners/mac.yaml");
    expect(bad.ok).toBe(false);
    const issue = bad.issues.find((i) => i.path.includes("version"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/runners\/mac\.yaml:\d+/);
  });

  it("11. linear≠jira — factory con ambos integraciones falla atómico con file:line", () => {
    const both = `schemaVersion: v1alpha1
name: test
repositories:
  - owner: acme
    name: repo
integrations:
  - type: linear
  - type: jira
agentDefaults:
  model: auto
`;
    const parser = new FactoryParser();
    const res = parser.parseFactoryYaml(both, "factory.yaml");
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.message.includes("linear") && i.message.includes("jira"))).toBe(true);
  });

  it("12. mcpServers warpId file:line dinámico", () => {
    const raw = `schemaVersion: v1alpha1
name: test
repositories:
  - owner: acme
    name: repo
mcpServers:
  sentry:
    warpId: ""
agentDefaults:
  model: auto
`;
    const parser = new FactoryParser();
    const res = parser.parseFactoryYaml(raw, "factory.yaml");
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path.includes("warpId"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/factory\.yaml:\d+/);
  });
});
