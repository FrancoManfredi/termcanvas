// agent.harness.test.ts — O13 harness matrix 4×2 sin live
// Source: WarpFactories.md §4 · US-020, US-022, US-023, US-021 · T04

import { describe, it, expect } from "vitest";
import { AgentHarnessSchema } from "../schemas/agent.schema";
import { harnessSchema } from "../schemas/common.schema";
import { AgentParser } from "../parsers/agent.parser";
import { FactoryRegistry } from "../store/factoryRegistry";
import { SAMPLE_FACTORY_MINIMAL, SAMPLE_AGENT_FOREMAN, SAMPLE_RUNNER_LINUX } from "../fixtures/samples";

describe("O13 — Agent harness matrix 4×2 sin live (T04)", () => {
  it("1. reasoningLevel solo codex — oz con reasoningLevel falla con code reasoningLevel_only_codex y file:line", () => {
    const raw = `---
description: Reviewer
agentType: REVIEW
runner: linux-build
harness:
  type: oz
  reasoningLevel: high
---
Body
`;
    const parser = new AgentParser();
    const res = parser.parseAgentMd(raw, "agents/reviewer/agent.md");
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.code === "reasoningLevel_only_codex" || i.message.includes("reasoningLevel"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/agents\/reviewer\/agent\.md:7/);
    expect(issue?.message).toMatch(/reasoningLevel solo aplica a codex/);
  });

  it("2. reasoningLevel con codex pasa — codex con reasoningLevel no da error reasoningLevel_only_codex", () => {
    const parsed = AgentHarnessSchema.safeParse({ harness: "codex", reasoningLevel: "high" });
    // AgentHarnessSchema free gate will still error for codex (free_only_oz), but reasoning should not error
    if (!parsed.success) {
      const hasReasoning = parsed.error.issues.some((iss) => (iss as unknown as { params?: { code?: string } }).params?.code === "reasoningLevel_only_codex");
      expect(hasReasoning).toBe(false);
    }
    // Via nested harnessSchema (allows codex + reasoningLevel)
    const nested = harnessSchema.safeParse({ type: "codex", reasoningLevel: "high" });
    expect(nested.success).toBe(true);
  });

  it("3. auth managedSecret válido para codex/claude/gemini (oz sin auth)", () => {
    const okCodex = harnessSchema.safeParse({ type: "codex", auth: { source: "managedSecret", secretName: "KEY" } });
    expect(okCodex.success).toBe(true);
    const okClaude = harnessSchema.safeParse({ type: "claude", auth: { source: "workerEnvironment" } });
    expect(okClaude.success).toBe(true);
    const okGemini = harnessSchema.safeParse({ type: "gemini", auth: { source: "managedSecret" } });
    expect(okGemini.success).toBe(true);
  });

  it("4. auth para oz falla con code invalid_auth y file:line", () => {
    const raw = `---
agentType: FOREMAN
harness:
  type: oz
  auth:
    source: managedSecret
    secretName: KEY
---
Body
`;
    const res = new AgentParser().parseAgentMd(raw, "agents/foreman/agent.md");
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.message.includes("auth") || i.code === "invalid_auth");
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/agents\/foreman\/agent\.md:\d+/);
  });

  it("5. gate Free solo oz — AgentHarnessSchema claude/codex/gemini fallan con code free_only_oz", () => {
    const claude = AgentHarnessSchema.safeParse({ harness: "claude" });
    expect(claude.success).toBe(false);
    if (!claude.success) {
      const code = (claude.error.issues[0] as unknown as { params?: { code?: string } }).params?.code;
      expect(code).toBe("free_only_oz");
      expect(claude.error.issues[0].message).toMatch(/Free solo permite harness oz/);
    }
    const gemini = AgentHarnessSchema.safeParse({ harness: "gemini" });
    expect(gemini.success).toBe(false);
    const oz = AgentHarnessSchema.safeParse({ harness: "oz" });
    expect(oz.success).toBe(true);
  });

  it("6. exactly one FOREMAN — 0 foremans falla con file:line agents/reviewer/agent.md:1", () => {
    const reviewerRaw = `---
description: reviewer
agentType: REVIEW
model: auto
---
Body
`;
    const reg = new FactoryRegistry();
    const res = reg.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
      agents: [{ raw: reviewerRaw, file: "agents/reviewer/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(res.ok).toBe(false);
    expect(res.issues[0].message).toMatch(/FOREMAN/);
    expect(res.issues[0].path).toMatch(/agents\/reviewer\/agent\.md:1/);
    expect(res.issues[0].code).toBe("exactly_one_foreman");
  });

  it("7. exactly one FOREMAN — 2 foremans falla con file:line", () => {
    const reg = new FactoryRegistry();
    const res = reg.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_MINIMAL, file: "factory.yaml" },
      agents: [
        { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
        { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman2/agent.md" },
      ],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(res.ok).toBe(false);
    expect(res.issues[0].path).toMatch(/agents\/foreman\/agent\.md:1/);
  });

  it("8. harness enum inválido falla con file:line — agents/reviewer/agent.md", () => {
    const raw = `---
agentType: REVIEW
harness:
  type: invalidHarness
---
Body
`;
    const res = new AgentParser().parseAgentMd(raw, "agents/reviewer/agent.md");
    expect(res.ok).toBe(false);
    const issue = res.issues.find((i) => i.path.includes("harness"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/agents\/reviewer\/agent\.md:\d+/);
  });

  it("9. workerEnvironment auth válido sin secretName", () => {
    const parsed = harnessSchema.safeParse({ type: "codex", auth: { source: "workerEnvironment" } });
    expect(parsed.success).toBe(true);
    const flat = AgentHarnessSchema.safeParse({ harness: "codex", auth: "workerEnvironment", reasoningLevel: "medium" });
    // flat will have free_only_oz but reasoning should not be error
    if (!flat.success) {
      const codes = flat.error.issues.map((i) => (i as unknown as { params?: { code?: string } }).params?.code);
      expect(codes).not.toContain("reasoningLevel_only_codex");
    }
  });
});
