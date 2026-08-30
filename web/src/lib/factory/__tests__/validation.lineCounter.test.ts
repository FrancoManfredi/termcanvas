// validation.lineCounter.test.ts — SRP: P1-01 file+line real con yaml LineCounter + frontmatter 6 artefactos
// Source: WarpFactories.md §7 · US-058 · PRD P1-01 · O13

import { describe, it, expect } from "vitest";
import { parseYamlWithLineCounter, parseFrontmatterWithLineCounter, lineForPath, lineForFrontmatterKey } from "../domain/validation.lineCounter";
import { parseYamlWithLineCounter as parseYamlWithLineCounterUtil, parseFrontmatterWithLineCounter as parseFrontmatterWithLineCounterUtil } from "../parsers/yaml.utils";
import { zodToParseIssues } from "../schemas/common.schema";
import { z } from "zod";
import { FactoryParser } from "../parsers/factory.parser";

/** Fixture donde repositories.0.owner está exactamente en línea 12 (spec example). */
const YAML_LINE_12_FIXTURE = `schemaVersion: v1alpha1
name: test
description: d
alias: a
credentialStrategy: EXECUTOR
secrets:
  - s
mcpServers:
  sentry:
    warpId: id
repositories:
  - owner: bad@owner!
    name: repo1
agentDefaults:
  model: auto
`;

const YAML_NESTED_FIXTURE = `schemaVersion: v1alpha1
name: payments-factory
repositories:
  - owner: acme
    name: payments-service
  - owner: acme2
    name: payments-api
  - owner: bad@owner!
    name: other-service
agentDefaults:
  model: auto
`;

// O13 fixtures — 6 artefactos con file:line real
const AGENT_FIXTURE_REASONING_AT_7 = `---
description: Reviewer
agentType: REVIEW
runner: linux-build
harness:
  type: oz
  reasoningLevel: high
---
Body
`;

const AUTOMATION_FIXTURE_TRIGGERS_AT_4 = `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
---
Review body
`;

const RUNNER_FIXTURE_VCPUS_AT_3 = `description: gpu runner
instanceShape:
  vcpus: -1
  memoryGb: 8
platform:
  os: linux
  arch: x86_64
  linux:
    dockerImage: ubuntu:22.04
`;

const SCORER_FIXTURE_LABELS_AT_4 = `---
name: my-scorer
description: scorer for testing
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
rubric body
`;

const SKILL_FIXTURE_NAME_AT_2 = `---
name: my-skill
description: skill desc
---
Body of skill
`;

const FACTORY_FIXTURE_ALIAS_AT_4 = `schemaVersion: v1alpha1
name: test-factory
description: test
alias: bad@alias!!!
repositories:
  - owner: acme
    name: repo
agentDefaults:
  model: auto
`;

describe("P1-01 — Validation file+line real con LineCounter", () => {
  it("parseYamlWithLineCounter expone doc y lineCounter y lineForPath mapea repositories.0.owner a línea 12", () => {
    const { lineCounter } = parseYamlWithLineCounter(YAML_LINE_12_FIXTURE);
    const pos = lineForPath(lineCounter, ["repositories", 0, "owner"]);
    expect(pos).toBeDefined();
    expect(pos?.line).toBe(12);
    expect(pos?.col).toBeGreaterThan(0);
  });

  it("yaml.utils re-exporta parseYamlWithLineCounter sin romper parseYamlSafe", () => {
    const viaDomain = parseYamlWithLineCounter(YAML_LINE_12_FIXTURE);
    const viaUtil = parseYamlWithLineCounterUtil(YAML_LINE_12_FIXTURE);
    const posDomain = lineForPath(viaDomain.lineCounter, ["repositories", 0, "owner"]);
    const posUtil = lineForPath(viaUtil.lineCounter, ["repositories", 0, "owner"]);
    expect(posDomain?.line).toBe(12);
    expect(posUtil?.line).toBe(12);
  });

  it("lineForPath fallback: prefijo más corto si path exacto no existe (zod path anidado)", () => {
    const { lineCounter } = parseYamlWithLineCounter(YAML_NESTED_FIXTURE);
    const pos = lineForPath(lineCounter, ["repositories", 2, "owner"]);
    expect(pos?.line).toBe(8);
    const missing = lineForPath(lineCounter, ["nonexistent", 0, "foo"]);
    expect(missing === undefined || typeof missing.line === "number").toBe(true);
  });

  it("FactoryParser produce file:line real para repositories.0.owner con LineCounter (no file.field marketing)", () => {
    const parser = new FactoryParser();
    const result = parser.parseFactoryYaml(YAML_LINE_12_FIXTURE, "factory.yaml");
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.path.includes("repositories.0.owner") || i.path.includes("owner"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/factory\.yaml:12/);
    expect(issue?.path).toContain(" — ");
    expect(issue?.path).toContain("repositories");
  });

  it("FactoryParser para YAML_NESTED_FIXTURE reporta file:line para repositories.2.owner (bad charset)", () => {
    const parser = new FactoryParser();
    const result = parser.parseFactoryYaml(YAML_NESTED_FIXTURE, "factory.yaml");
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.path.includes("repositories.2.owner"));
    expect(issue).toBeDefined();
    expect(issue?.path).toMatch(/factory\.yaml:\d+/);
    const lineMatch = issue?.path.match(/:(\d+)/);
    expect(lineMatch).not.toBeNull();
    expect(Number(lineMatch?.[1])).toBe(8);
  });

  it("zodToParseIssues con LineCounter produce path file:line — field, y sin raw mantiene file.field", () => {
    const schema = z.object({ owner: z.string().regex(/^[A-Za-z0-9_.-]+$/, "owner: allowed") });
    const parsed = schema.safeParse({ owner: "bad@owner!" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const withoutRaw = zodToParseIssues(parsed.error, "factory.yaml");
      expect(withoutRaw[0]?.path).toBe("factory.yaml.owner");

      const raw = "owner: bad@owner!\n";
      const { lineCounter } = parseYamlWithLineCounter(raw);
      const withCounter = zodToParseIssues(parsed.error, "factory.yaml", raw, lineCounter);
      expect(withCounter[0]?.path).toMatch(/factory\.yaml:1 — owner/);
    }
  });

  it("fallback a findLineForPath si LineCounter no resuelve (sin throw)", async () => {
    const schema = z.object({ alias: z.string().regex(/^[A-Za-z0-9 ._-]+$/, "alias_charset") });
    const parsed = schema.safeParse({ alias: "bad@alias!" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const raw = "alias: bad@alias!\n";
      const { LineCounter } = await import("yaml");
      const emptyCounter = new LineCounter();
      const issues = zodToParseIssues(parsed.error, "factory.yaml", raw, emptyCounter);
      expect(issues[0]?.path).toMatch(/factory\.yaml:1/);
    }
  });

  // O13 — 6 artefactos file:line real

  it("parseFrontmatterWithLineCounter mapea agents/reviewer/agent.md:7 — reasoningLevel con offset real", () => {
    const { lineCounter } = parseFrontmatterWithLineCounter(AGENT_FIXTURE_REASONING_AT_7);
    const pos = lineForPath(lineCounter, ["harness", "reasoningLevel"]);
    expect(pos).toBeDefined();
    expect(pos?.line).toBe(7);
    const keyPos = lineForFrontmatterKey(lineCounter, "harness");
    expect(keyPos?.line).toBe(5);
  });

  it("parseFrontmatterWithLineCounter mapea automations/labeled-issue/automation.md triggers con file:line", () => {
    const { lineCounter } = parseFrontmatterWithLineCounter(AUTOMATION_FIXTURE_TRIGGERS_AT_4);
    const pos = lineForPath(lineCounter, ["triggers"]);
    expect(pos?.line).toBe(4);
  });

  it("parseYamlWithLineCounter mapea runners/gpu.yaml:3 vcpus con file:line real", () => {
    const { lineCounter } = parseYamlWithLineCounter(RUNNER_FIXTURE_VCPUS_AT_3);
    const pos = lineForPath(lineCounter, ["instanceShape", "vcpus"]);
    expect(pos).toBeDefined();
    expect(pos?.line).toBe(3);
  });

  it("parseFrontmatterWithLineCounter mapea scorers/my-scorer/scorer.md:4 — labels con file:line", () => {
    const { lineCounter } = parseFrontmatterWithLineCounter(SCORER_FIXTURE_LABELS_AT_4);
    const pos = lineForPath(lineCounter, ["labels"]);
    expect(pos?.line).toBe(4);
    const namePos = lineForFrontmatterKey(lineCounter, "labels");
    expect(namePos?.line).toBe(4);
  });

  it("parseFrontmatterWithLineCounter mapea skills/repo-conventions/SKILL.md name en línea 2", () => {
    const { lineCounter } = parseFrontmatterWithLineCounter(SKILL_FIXTURE_NAME_AT_2);
    const pos = lineForFrontmatterKey(lineCounter, "name");
    expect(pos?.line).toBe(2);
    const descPos = lineForPath(lineCounter, ["description"]);
    expect(descPos?.line).toBe(3);
  });

  it("yaml.utils re-exporta parseFrontmatterWithLineCounter con offset correcto", () => {
    const viaDomain = parseFrontmatterWithLineCounter(AGENT_FIXTURE_REASONING_AT_7);
    const viaUtil = parseFrontmatterWithLineCounterUtil(AGENT_FIXTURE_REASONING_AT_7);
    const posD = lineForPath(viaDomain.lineCounter, ["harness", "reasoningLevel"]);
    const posU = lineForPath(viaUtil.lineCounter, ["harness", "reasoningLevel"]);
    expect(posD?.line).toBe(7);
    expect(posU?.line).toBe(7);
  });

  it("zodToParseIssues con frontmatter LineCounter produce agents/reviewer/agent.md:7 — reasoningLevel", () => {
    const schema = z.object({
      harness: z.object({ type: z.string(), reasoningLevel: z.string().optional() }),
    });
    const data = { harness: { type: "oz", reasoningLevel: "high" } };
    // Simulate agent schema superRefine error via manual issue
    const fakeError = new z.ZodError([
      {
        code: "custom",
        path: ["harness", "reasoningLevel"],
        message: "reasoningLevel solo aplica a codex",
        params: { code: "reasoningLevel_only_codex" },
      } as unknown as z.ZodIssue,
    ]);
    const fmRaw = AGENT_FIXTURE_REASONING_AT_7.split("---")[1] ?? "";
    const { lineCounter } = parseFrontmatterWithLineCounter(AGENT_FIXTURE_REASONING_AT_7);
    const issues = zodToParseIssues(fakeError, "agents/reviewer/agent.md", fmRaw, lineCounter);
    expect(issues[0]?.path).toMatch(/agents\/reviewer\/agent\.md:7/);
    expect(issues[0]?.path).toContain(" — ");
    expect(issues[0]?.code).toBe("reasoningLevel_only_codex");
    void data;
    void schema;
  });

  it("factory alias error mapea a factory.yaml correspondiente con LineCounter", () => {
    const { lineCounter } = parseYamlWithLineCounter(FACTORY_FIXTURE_ALIAS_AT_4);
    const pos = lineForPath(lineCounter, ["alias"]);
    expect(pos?.line).toBe(4);
  });
});
