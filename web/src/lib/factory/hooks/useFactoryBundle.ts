import { useMemo } from "react";
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


// Extra fixtures covering all §4 defaults + custom for Agents page — DIP: still parsed via FactoryRegistry, not hand objects
export const SAMPLE_AGENT_TRIAGE = `---
description: Investigates codebase and reproduces issues when needed
agentType: TRIAGE
harness:
  type: claude
  model: claude-4-5-haiku
  auth:
    source: managedSecret
    secretName: ANTHROPIC_API_KEY
runner: linux-build
workerHost: warp
secrets:
  - TRIAGE_TOKEN
mcpServers:
  sentry:
    warpId: SENTRY_MCP_SERVER_ID
---

Triage investigates the request, gathers evidence, reproduces only when investigation is insufficient, and reports scope and complexity.
`;

export const SAMPLE_AGENT_SPEC = `---
description: Defines product and technical specs in draft PR
agentType: SPEC
model: auto
runner: linux-build
---

Spec defines product behavior, technical constraints and validation criteria in a draft PR. Foreman skips this stage for small well-understood changes.
`;

export const SAMPLE_AGENT_IMPLEMENT = `---
description: Implements code, tests and validation, continues spec branch
agentType: IMPLEMENT
harness:
  type: codex
  model: gpt-4o
  auth:
    source: managedSecret
    secretName: OPENAI_API_KEY
runner: linux-build
workerHost: warp
secrets:
  - NPM_TOKEN
mcpServers:
  sentry:
    warpId: SENTRY_MCP_SERVER_ID
---

Implement continues the branch and draft PR from spec. Writes code, tests, runs validation and captures visual evidence for user-facing changes.
`;

export const SAMPLE_AGENT_VERIFY = `---
description: Independent verification after review
agentType: VERIFY
model: auto
workerHost: SELF_HOSTED_WORKER_ID
---

Verify checks correctness against acceptance criteria and re-runs validation when evidence is thin.
`;

export const SAMPLE_AGENT_CUSTOM_SECURITY = `---
description: Security analysis for every PR
runner: mac
mcpServers:
  sentry:
    warpId: SENTRY_MCP_SERVER_ID
secrets:
  - SECURITY_TOKEN
  - EXTRA_SECRET
---

Custom security agent audits PRs for vulnerabilities and enforces compliance checklists.
`;

export function getFactoryBundle() {
  const registry = new FactoryRegistry();
  const result = registry.parseBundle({
    factoryYaml: { raw: SAMPLE_FACTORY_FULL, file: "factory.yaml" },
    agents: [
      { raw: SAMPLE_AGENT_FOREMAN, file: "agents/foreman/agent.md" },
      { raw: SAMPLE_AGENT_REVIEWER, file: "agents/reviewer/agent.md" },
      { raw: SAMPLE_AGENT_TRIAGE, file: "agents/triage/agent.md" },
      { raw: SAMPLE_AGENT_SPEC, file: "agents/spec/agent.md" },
      { raw: SAMPLE_AGENT_IMPLEMENT, file: "agents/implement/agent.md" },
      { raw: SAMPLE_AGENT_VERIFY, file: "agents/verify/agent.md" },
      { raw: SAMPLE_AGENT_CUSTOM_SECURITY, file: "agents/security/agent.md" },
    ],
    runners: [
      { raw: SAMPLE_RUNNER_LINUX, file: "runners/linux-build.yaml" },
      { raw: SAMPLE_RUNNER_MAC, file: "runners/mac.yaml" },
    ],
    automations: [{ raw: SAMPLE_AUTOMATION_LABELED, file: "automations/labeled-issue/automation.md" }],
    scorers: [{ raw: SAMPLE_SCORER_TESTS, file: "scorers/tests-run/scorer.md" }],
  });
  return result;
}

export function useFactoryBundle() {
  const result = useMemo(() => {
    return getFactoryBundle();
  }, []);

  return result;
}
