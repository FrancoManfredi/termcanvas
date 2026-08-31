import { describe, it, expect } from "vitest";
import { FactoryRegistry } from "../store/factoryRegistry";
import {
  SAMPLE_AGENT_FOREMAN,
  SAMPLE_AGENT_REVIEWER,
  SAMPLE_AUTOMATION_LABELED,
  SAMPLE_FACTORY_FULL,
  SAMPLE_RUNNER_LINUX,
  SAMPLE_RUNNER_MAC,
} from "../fixtures/samples";
import { parseAgentMd } from "../parsers/agent.parser";

function makeBundleWithVariants() {
  const registry = new FactoryRegistry();
  const triageRaw = `---
description: Investigates codebase and reproduces issues
agentType: TRIAGE
model: auto
runner: linux-build
workerHost: warp
secrets:
  - <REPLACE_ME>
mcpServers:
  sentry:
    warpId: <REPLACE_ME>
---

Triage investigates the request, gathers evidence, scope and complexity.
`;
  const specRaw = `---
description: Defines product and technical specs in draft PR
agentType: SPEC
model: auto
runner: linux-build
---

Spec defines product behavior, technical constraints and validation criteria.
`;
  const implementRaw = `---
description: Implements code, tests and validation
agentType: IMPLEMENT
model: auto
runner: linux-build
workerHost: warp
secrets:
  - <REPLACE_ME>
---

Implement continues the branch from spec, writes code, tests and visual evidence.
`;
  const verifyRaw = `---
description: Independent verification after review
agentType: VERIFY
model: auto
workerHost: SELF_HOSTED_WORKER_ID
---

Verify checks correctness against acceptance criteria.
`;
  const customRaw = `---
description: Security analysis for every PR
runner: mac
mcpServers:
  sentry:
    warpId: <REPLACE_ME>
secrets:
  - <REPLACE_ME>
  - <REPLACE_ME>
---

Custom security agent audits PRs for vulnerabilities.
`;

  return registry.parseBundle({
    factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
    agents: [
      { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
      { raw: SAMPLE_AGENT_REVIEWER, file: "agents/reviewer/agent.md" },
      { raw: triageRaw, file: "agents/triage/agent.md" },
      { raw: specRaw, file: "agents/spec/agent.md" },
      { raw: implementRaw, file: "agents/implement/agent.md" },
      { raw: verifyRaw, file: "agents/verify/agent.md" },
      { raw: customRaw, file: "agents/security/agent.md" },
    ],
    runners: [
      { raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" },
      { raw: SAMPLE_RUNNER_MAC, file: "runners/mac.yaml" },
    ],
    automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
    scorers: [],
  });
}

describe("Agents — FactoryRegistry invariants (WarpFactories §4 §7)", () => {
  it("1. exactly one FOREMAN required — enriched bundle passes", () => {
    const r = makeBundleWithVariants();
    expect(r.ok).toBe(true);
    const foremen = r.value!.agents.filter((a) => a.agentType === "FOREMAN" || a.agentType === "MAIN");
    expect(foremen).toHaveLength(1);
  });

  it("2. fails with zero foreman", () => {
    const triage = `---
agentType: TRIAGE
model: auto
---

triage`;
    const reg = new FactoryRegistry();
    const r = reg.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [{ raw: triage, file: "agents/triage/agent.md" }],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
  });

  it("3. fails with two foremans", () => {
    const reg = new FactoryRegistry();
    const r = reg.parseBundle({
      factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
      agents: [
        { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
        { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman2/agent.md" },
      ],
      runners: [{ raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" }],
      automations: [],
      scorers: [],
    });
    expect(r.ok).toBe(false);
  });

  it("4. all agentType variants parse (FOREMAN/TRIAGE/SPEC/IMPLEMENT/REVIEW/VERIFY/CUSTOM)", () => {
    const types: Array<{ type: string; file: string }> = [
      { type: "FOREMAN", file: "agents/foreman/agent.md" },
      { type: "TRIAGE", file: "agents/triage/agent.md" },
      { type: "SPEC", file: "agents/spec/agent.md" },
      { type: "IMPLEMENT", file: "agents/implement/agent.md" },
      { type: "REVIEW", file: "agents/reviewer/agent.md" },
      { type: "VERIFY", file: "agents/verify/agent.md" },
      { type: "CUSTOM", file: "agents/security/agent.md" },
    ];
    for (const { type, file } of types) {
      const raw = type === "CUSTOM" ? `---\nmodel: auto\n---\ncustom\n` : `---\nagentType: ${type}\nmodel: auto\n---\nbody\n`;
      const pr = parseAgentMd(raw, file);
      expect(pr.ok, `${type} should parse`).toBe(true);
      const expected = type === "CUSTOM" ? "CUSTOM" : type;
      expect(pr.value!.agentType).toBe(expected);
    }
  });
});
