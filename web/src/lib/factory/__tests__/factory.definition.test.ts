import { describe, it, expect } from "vitest";
import { FactoryRegistry } from "../store/factoryRegistry";
import {
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_AGENT_REVIEWER,
  SAMPLE_AUTOMATION_LABELED,
  SAMPLE_FACTORY_FULL,
  SAMPLE_RUNNER_LINUX,
  SAMPLE_RUNNER_MAC,
  SAMPLE_SCORER_TESTS,
} from "../fixtures/samples";
import {
  deriveDefinitionFiles,
  findLineNumber,
  getDefinitionVisibility,
  githubFileUrl,
  mockWarpFactoryConfig,
  shouldShowFactoryDefinitionTab,
} from "../domain/factory.definition.derive";
import type { FactoryBundle } from "../store/factoryRegistry";

function makeFullBundle(): FactoryBundle {
  return new FactoryRegistry().parseBundle({
    factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
    agents: [
      { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
      { raw: SAMPLE_AGENT_REVIEWER, file: "agents/reviewer/agent.md" },
    ],
    runners: [
      { raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" },
      { raw: SAMPLE_RUNNER_MAC, file: "runners/mac.yaml" },
    ],
    automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
    scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
  }).value!;
}

describe("factory.definition.derive — file listing §7", () => {
  it("lists factory.yaml + agents/<name>/agent.md + automations + runners/*.yaml + scorers/*.md", () => {
    const bundle = makeFullBundle();
    const files = deriveDefinitionFiles(bundle);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("factory.yaml");
    expect(paths).toContain("agents/foreman/agent.md");
    expect(paths).toContain("agents/reviewer/agent.md");
    expect(paths).toContain("automations/labeled-issue/automation.md");
    expect(paths).toContain("runners/linux-build.yaml");
    expect(paths).toContain("runners/mac.yaml");
    expect(paths).toContain("scorers/tests-run/scorer.md");
  });

  it("kinds are correct and language matches", () => {
    const bundle = makeFullBundle();
    const files = deriveDefinitionFiles(bundle);
    const factory = files.find((f) => f.path === "factory.yaml")!;
    expect(factory.kind).toBe("factory");
    expect(factory.language).toBe("yaml");
    const agent = files.find((f) => f.path === "agents/foreman/agent.md")!;
    expect(agent.kind).toBe("agent");
    expect(agent.language).toBe("markdown");
    expect(agent.raw).toContain("agentType: FOREMAN");
  });

  it("includes skills when rawMap has SKILL.md", () => {
    const bundle = makeFullBundle();
    const files = deriveDefinitionFiles(bundle, {
      "factory.yaml": "x",
      "skills/repository-conventions/SKILL.md": "# Skill\nconventions",
      "agents/foreman/skills/incident-triage/SKILL.md": "# triage",
    });
    const skills = files.filter((f) => f.kind === "skill");
    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.path)).toContain("skills/repository-conventions/SKILL.md");
    expect(skills.map((s) => s.path)).toContain("agents/foreman/skills/incident-triage/SKILL.md");
  });

  it("uses rawMap when provided, otherwise reconstructs", () => {
    const bundle = makeFullBundle();
    const customRaw = "custom factory yaml content";
    const files = deriveDefinitionFiles(bundle, { "factory.yaml": customRaw });
    expect(files.find((f) => f.path === "factory.yaml")!.raw).toBe(customRaw);
  });

  it("sorted by kind order factory→agent→automation→runner→scorer→skill", () => {
    const bundle = makeFullBundle();
    const files = deriveDefinitionFiles(bundle);
    const kinds = files.map((f) => f.kind);
    // first should be factory, last scorer (no skills by default)
    expect(kinds[0]).toBe("factory");
    expect(kinds[kinds.length - 1]).toBe("scorer");
  });

  it("agent file body contains frontmatter+instructions (§7 agents/<name>/agent.md)", () => {
    const bundle = makeFullBundle();
    const files = deriveDefinitionFiles(bundle);
    const foreman = files.find((f) => f.path === "agents/foreman/agent.md")!;
    expect(foreman.raw).toContain("---");
    expect(foreman.raw).toContain("Own each work item");
  });

  it("runner files reflect platform and shape", () => {
    const bundle = makeFullBundle();
    const files = deriveDefinitionFiles(bundle);
    const linux = files.find((f) => f.path === "runners/linux-build.yaml")!;
    expect(linux.raw).toContain("dockerImage: ubuntu:22.04");
    expect(linux.raw).toContain("vcpus: 4");
  });
});

describe("factory.definition.derive — file+line", () => {
  it("findLineNumber returns 1-indexed line of needle case-insensitive", () => {
    const raw = "schemaVersion: v1alpha1\nname: payments\n alias: payments\n";
    expect(findLineNumber(raw, "alias")).toBe(3);
    expect(findLineNumber(raw, "SCHEMAVERSION")).toBe(1);
    expect(findLineNumber(raw, "missing")).toBe(1);
  });

  it("mockWarpFactoryConfig returns file+line on alias charset violation", () => {
    const bundle = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    }).value!;
    (bundle.factory as unknown as Record<string, unknown>).alias = "bad/alias!";
    const badRaw = SAMPLE_FACTORY_FULL.replace("alias: payments", "alias: bad/alias!");
    const issues = mockWarpFactoryConfig(bundle, { "factory.yaml": badRaw });
    expect(issues.length).toBeGreaterThan(0);
    const aliasIssue = issues.find((i) => i.code === "alias_charset");
    expect(aliasIssue).toBeDefined();
    expect(aliasIssue!.file).toBe("factory.yaml");
    expect(aliasIssue!.line).toBeGreaterThan(0);
  });

  it("mockWarpFactoryConfig annotates runner exceeding hosted limits with file+line", () => {
    const badRunner = `description: big\ninstanceShape:\n  vcpus: 64\n  memoryGb: 128\nplatform:\n  os: linux\n  arch: x86_64\n  linux:\n    dockerImage: ubuntu:22.04\n`;
    const bundle = new FactoryRegistry().parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
      runners: [{ raw: badRunner, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    }).value!;
    const issues = mockWarpFactoryConfig(bundle, { "runners/linux-build.yaml": badRunner, "factory.yaml": SAMPLE_FACTORY_FULL });
    expect(issues.some((i) => i.code === "exceeds_max_vcpu")).toBe(true);
    expect(issues.some((i) => i.code === "exceeds_max_memory")).toBe(true);
    for (const issue of issues) {
      expect(issue.line).toBeGreaterThan(0);
      expect(issue.file).toBeTruthy();
    }
  });

  it("githubFileUrl builds file+line link", () => {
    expect(githubFileUrl("acme", "payments-service", "factory.yaml", 12)).toBe(
      "https://github.com/acme/payments-service/blob/main/factory.yaml#L12"
    );
    expect(githubFileUrl("acme", "payments-service", "agents/foreman/agent.md")).toBe(
      "https://github.com/acme/payments-service/blob/main/agents/foreman/agent.md"
    );
  });

  it("covers file+line for every issue type (100-forms paranoia)", () => {
    const bundle = makeFullBundle();
    const issues = mockWarpFactoryConfig(bundle);
    for (const issue of issues) {
      expect(typeof issue.file).toBe("string");
      expect(issue.line).toBeGreaterThanOrEqual(1);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });
});

describe("factory.definition.derive — mode visibility §10", () => {
  it("warp-managed: visible editable, no banner", () => {
    const v = getDefinitionVisibility("warp-managed");
    expect(v.visible).toBe(true);
    expect(v.editable).toBe(true);
    expect(v.readOnly).toBe(false);
    expect(v.banner).toBeUndefined();
    expect(shouldShowFactoryDefinitionTab("warp-managed")).toBe(true);
  });

  it("github-backed: not visible, read-only with banner managed in GitHub, edit via PR + link file+line", () => {
    const v = getDefinitionVisibility("github-backed");
    expect(v.visible).toBe(false);
    expect(v.readOnly).toBe(true);
    expect(v.editable).toBe(false);
    expect(v.banner).toMatch(/managed in GitHub/);
    expect(v.linkLabel).toMatch(/Open in GitHub/);
    expect(shouldShowFactoryDefinitionTab("github-backed")).toBe(false);
  });

  it("live-managed: no definition files, tab does not exist", () => {
    const v = getDefinitionVisibility("live-managed");
    expect(v.visible).toBe(false);
    expect(v.banner).toMatch(/Live-managed/);
    expect(shouldShowFactoryDefinitionTab("live-managed")).toBe(false);
  });

  it("credentialStrategy default EXECUTOR vs CREATOR from bundle", () => {
    const bundle = makeFullBundle();
    expect(bundle.factory.credentialStrategy ?? "EXECUTOR").toBe("EXECUTOR");
    const raw = SAMPLE_FACTORY_FULL.replace("alias: payments", "alias: payments\ncredentialStrategy: CREATOR");
    const b2 = new FactoryRegistry().parseBundle({
      factoryYaml: { raw, file: "factory.yaml" },
      agents: [{ raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    }).value!;
    expect(b2.factory.credentialStrategy).toBe("CREATOR");
  });
});
