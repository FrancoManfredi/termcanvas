import { describe, it, expect } from "vitest";
import {
  parseSkillMd,
  isSkillVisibleToAgent,
  listSkillsForAgent,
  listFactoryWideSkills,
  listPerAgentSkills,
  getSkillByName,
  getBuiltinSkills,
  resolveSkillsForAgent,
  categorizeSkills,
} from "../domain/skill.registry";
import {
  SAMPLE_SKILL_REPOSITORY_CONVENTIONS,
  SAMPLE_SKILL_INCIDENT_TRIAGE,
} from "../fixtures/skill.samples";

const FACTORY_WITH_SLACK = {
  schemaVersion: "v1alpha1" as const,
  name: "payments-factory",
  repositories: [{ owner: "acme", name: "payments-service" }],
  integrations: [{ type: "slack" as const }],
  agentDefaults: { model: "auto" as const },
};

const FACTORY_WITH_LINEAR = {
  schemaVersion: "v1alpha1" as const,
  name: "wilson",
  repositories: [{ owner: "acme", name: "svc" }],
  integrations: [{ type: "slack" as const }, { type: "linear" as const }],
  agentDefaults: { model: "auto" as const },
};

function parseOrThrow(raw: string, file: string) {
  const r = parseSkillMd(raw, file);
  if (!r.ok) throw new Error(`parse failed ${file}: ${r.issues.map((i) => i.message).join("; ")}`);
  return r.value!;
}

describe("SkillRegistry — WarpFactories.md §5", () => {
  // Parsing & scoping
  it("1. parses factory-wide skill (skills/repository-conventions/SKILL.md)", () => {
    const s = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    expect(s.name).toBe("repository-conventions");
    expect(s.scope).toBe("factoryWide");
    expect(s.agentName).toBeUndefined();
    expect(s.path).toBe("skills/repository-conventions/SKILL.md");
  });

  it("2. parses per-agent skill (agents/foreman/skills/incident-triage/SKILL.md)", () => {
    const s = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    expect(s.name).toBe("incident-triage");
    expect(s.scope).toBe("perAgent");
    expect(s.agentName).toBe("foreman");
  });

  it("3. preview keeps frontmatter and body markdown", () => {
    const s = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    expect(s.frontmatter.name).toBe("repository-conventions");
    expect(s.frontmatter.description).toBeDefined();
    expect(s.body).toContain("Repository Conventions");
    expect(s.raw).toContain("---");
  });

  it("4. per-agent incident-triage frontmatter preserved", () => {
    const s = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    expect(s.frontmatter.name).toBe("incident-triage");
    expect(s.body).toContain("Incident Triage");
  });

  it("5. factory-wide visible for all agents", () => {
    const globalSkill = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    for (const agent of ["foreman", "triage", "spec", "implement", "review", "verify"]) {
      expect(isSkillVisibleToAgent(globalSkill, agent)).toBe(true);
    }
  });

  it("6. per-agent incident-triage only visible to foreman", () => {
    const per = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    expect(isSkillVisibleToAgent(per, "foreman")).toBe(true);
    expect(isSkillVisibleToAgent(per, "review")).toBe(false);
    expect(isSkillVisibleToAgent(per, "implement")).toBe(false);
  });

  it("7. listSkillsForAgent returns factoryWide + matching perAgent", () => {
    const globalSkill = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    const per = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    const all = [globalSkill, per];

    const foremanSkills = listSkillsForAgent(all, "foreman");
    expect(foremanSkills).toHaveLength(2);
    expect(foremanSkills.map((s) => s.name)).toContain("repository-conventions");
    expect(foremanSkills.map((s) => s.name)).toContain("incident-triage");

    const reviewSkills = listSkillsForAgent(all, "review");
    expect(reviewSkills).toHaveLength(1);
    expect(reviewSkills[0].name).toBe("repository-conventions");
  });

  it("8. listFactoryWideSkills / listPerAgentSkills separate correctly", () => {
    const globalSkill = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    const per = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    const all = [globalSkill, per];
    expect(listFactoryWideSkills(all)).toHaveLength(1);
    expect(listPerAgentSkills(all)).toHaveLength(1);
  });

  it("9. getSkillByName resolves factoryWide vs perAgent", () => {
    const globalSkill = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    const per = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    const all = [globalSkill, per];
    expect(getSkillByName(all, "repository-conventions")?.path).toBe("skills/repository-conventions/SKILL.md");
    expect(getSkillByName(all, "incident-triage", "foreman")?.agentName).toBe("foreman");
    expect(getSkillByName(all, "incident-triage", "review")).toBeNull();
  });

  // Built-ins
  it("10. builtin github visible for all agents", () => {
    const builtins = getBuiltinSkills(FACTORY_WITH_SLACK as never);
    const github = builtins.find((b) => b.name === "github")!;
    expect(github).toBeDefined();
    expect(github.kind).toBe("builtin");
    expect(github.scope).toBe("factoryWide");
    for (const agent of ["foreman", "review", "implement"]) {
      expect(isSkillVisibleToAgent(github, agent)).toBe(true);
    }
  });

  it("11. builtin slack only for foreman", () => {
    const builtins = getBuiltinSkills(FACTORY_WITH_SLACK as never);
    const slack = builtins.find((b) => b.name === "slack")!;
    expect(slack.scope).toBe("perAgent");
    expect(slack.agentName).toBe("foreman");
    expect(isSkillVisibleToAgent(slack, "foreman")).toBe(true);
    expect(isSkillVisibleToAgent(slack, "review")).toBe(false);
  });

  it("12. tracker builtin linear only when factory has linear integration", () => {
    const without = getBuiltinSkills(FACTORY_WITH_SLACK as never);
    expect(without.find((b) => b.name === "linear")).toBeUndefined();
    const withLinear = getBuiltinSkills(FACTORY_WITH_LINEAR as never);
    expect(withLinear.find((b) => b.name === "linear")).toBeDefined();
  });

  it("13. builtin jira symmetric", () => {
    const jiraFactory = { ...FACTORY_WITH_SLACK, integrations: [{ type: "jira" as const }] };
    const builtins = getBuiltinSkills(jiraFactory as never);
    expect(builtins.find((b) => b.name === "jira")).toBeDefined();
    expect(builtins.find((b) => b.name === "linear")).toBeUndefined();
  });

  // Baseline extension semantics
  it("14. custom skills extend baseline — not replace (github + slack still present)", () => {
    const globalSkill = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    const resolved = resolveSkillsForAgent([globalSkill], FACTORY_WITH_SLACK as never, "foreman");
    const names = resolved.map((s) => s.name);
    expect(names).toContain("github");
    expect(names).toContain("slack");
    expect(names).toContain("repository-conventions");
  });

  it("15. custom factory-wide still visible alongside builtins for review", () => {
    const globalSkill = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    const resolved = resolveSkillsForAgent([globalSkill], FACTORY_WITH_SLACK as never, "review");
    const names = resolved.map((s) => s.name);
    expect(names).toContain("github");
    expect(names).toContain("repository-conventions");
    expect(names).not.toContain("slack");
  });

  it("16. resolve keeps incident-triage isolated to foreman even with baseline", () => {
    const per = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    const foremanResolved = resolveSkillsForAgent([per], FACTORY_WITH_SLACK as never, "foreman");
    expect(foremanResolved.map((s) => s.name)).toContain("incident-triage");
    const reviewResolved = resolveSkillsForAgent([per], FACTORY_WITH_SLACK as never, "review");
    expect(reviewResolved.map((s) => s.name)).not.toContain("incident-triage");
  });

  it("17. skill does not amplify access — resolving does not grant secrets/MCPs", () => {
    const per = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    // Skill definition must not carry secrets or mcpServers; those live on agent config only (§5)
    expect((per as unknown as { secrets?: unknown }).secrets).toBeUndefined();
    expect((per as unknown as { mcpServers?: unknown }).mcpServers).toBeUndefined();
    // Even after resolve, agent config unchanged — check baseline types don't leak
    const builtins = getBuiltinSkills(FACTORY_WITH_SLACK as never);
    for (const b of builtins) {
      expect((b as unknown as { secrets?: unknown }).secrets).toBeUndefined();
    }
  });

  it("18. categorize separates factoryWide and per-agent map", () => {
    const globalSkill = parseOrThrow(SAMPLE_SKILL_REPOSITORY_CONVENTIONS, "skills/repository-conventions/SKILL.md");
    const per = parseOrThrow(SAMPLE_SKILL_INCIDENT_TRIAGE, "agents/foreman/skills/incident-triage/SKILL.md");
    const builtins = getBuiltinSkills(FACTORY_WITH_SLACK as never);
    const all = [...builtins, globalSkill, per];
    const { factoryWide, perAgent } = categorizeSkills(all);
    expect(factoryWide.map((s) => s.name)).toContain("repository-conventions");
    expect(factoryWide.map((s) => s.name)).toContain("github");
    expect(perAgent.get("foreman")?.map((s) => s.name)).toContain("incident-triage");
    expect(perAgent.get("foreman")?.map((s) => s.name)).toContain("slack");
  });

  it("19. parse fails on empty SKILL.md", () => {
    const r = parseSkillMd("", "skills/foo/SKILL.md");
    expect(r.ok).toBe(false);
  });

  it("20. parse fails on missing body", () => {
    const raw = `---
name: foo
description: bar
---
`;
    const r = parseSkillMd(raw, "skills/foo/SKILL.md");
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/body/);
  });

  it("21. parse fails on missing frontmatter delimiters", () => {
    const raw = `# No frontmatter\nBody here`;
    const r = parseSkillMd(raw, "skills/foo/SKILL.md");
    expect(r.ok).toBe(false);
  });

  it("22. infer custom skill under agents/verify correctly", () => {
    const raw = `---
name: verify-checklist
description: Checklist for verify
---
Body verify`;
    const s = parseOrThrow(raw, "agents/verify/skills/verify-checklist/SKILL.md");
    expect(s.scope).toBe("perAgent");
    expect(s.agentName).toBe("verify");
    expect(isSkillVisibleToAgent(s, "verify")).toBe(true);
    expect(isSkillVisibleToAgent(s, "foreman")).toBe(false);
  });

  it("23. no amplía acceso — perAgent skill not visible to other agent even if same skill name", () => {
    const raw = `---
name: same
description: same name per-agent but isolated
---
Body`;
    const a = parseOrThrow(raw, "agents/foreman/skills/same/SKILL.md");
    const b = parseOrThrow(raw, "agents/review/skills/same/SKILL.md");
    expect(isSkillVisibleToAgent(a, "review")).toBe(false);
    expect(isSkillVisibleToAgent(b, "foreman")).toBe(false);
    expect(isSkillVisibleToAgent(a, "foreman")).toBe(true);
    expect(isSkillVisibleToAgent(b, "review")).toBe(true);
  });
})
