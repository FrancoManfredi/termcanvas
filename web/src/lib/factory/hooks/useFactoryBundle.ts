import { useMemo } from "react";
import type { RepositoryRef } from "../domain/types";
import { FactoryRegistry } from "../store/factoryRegistry";

// Prod-safe inline fixtures with placeholders — tree-shake: no static import of samples.ts in prod
// Fixtures with real-looking secrets moved to dynamic import only in dev/test (see samples.ts)
const SAMPLE_FACTORY_FULL = `schemaVersion: v1alpha1
name: payments-factory
description: Processes approved work for the payments service
alias: payments
repositories:
  - owner: acme
    name: payments-service
  - owner: acme
    name: payments-api
secrets:
  - <REPLACE_ME>
mcpServers:
  sentry:
    warpId: <REPLACE_ME>
integrations:
  - type: slack
agentDefaults:
  model: auto
  runner: linux-build
  secrets:
    - <REPLACE_ME>
`;

const SAMPLE_AGENT_FOREMAN = `---
description: Routes approved payments work through the factory
agentType: FOREMAN
secrets:
  - <REPLACE_ME>
mcpServers:
  sentry:
    warpId: <REPLACE_ME>
model: auto
runner: linux-build
---

Own each work item from intake through human handoff.
`;

const SAMPLE_AGENT_REVIEWER = `---
description: Reviews factory-produced pull requests
agentType: REVIEW
model: auto
runner: linux-build
---

Review each pull request against the repository's standards. Request
changes when tests are missing; never approve your own edits.
`;

const SAMPLE_AUTOMATION_LABELED = `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      repos: ["acme/payments-service"]
      labels: ["factory-ready"]
---

Review the labeled issue and decide the next required stage. Preserve the
issue's acceptance criteria and return unresolved product questions to a human.
`;

const SAMPLE_RUNNER_LINUX = `description: Linux runner for payments builds and tests
setupCommands:
  - corepack enable
instanceShape:
  vcpus: 4
  memoryGb: 8
platform:
  os: linux
  arch: x86_64
  linux:
    dockerImage: ubuntu:22.04
`;

const SAMPLE_RUNNER_MAC = `description: macOS runner for platform work
platform:
  os: macos
  arch: aarch64
  mac:
    version: "26"
`;

const SAMPLE_SCORER_TESTS = `---
name: tests-run
description: Checks whether implementation runs include test evidence.
agents:
  - reviewer
labels:
  - value: tests_run
    description: The transcript contains a test command and its result.
    score: 1
  - value: tests_skipped
    score: 0
passingScore: 1
samplingRate: 25
model: claude-4-5-haiku
---

Evaluate whether the agent ran the relevant tests before finishing. Return
exactly one declared label.
`;

// Extra fixtures covering all §4 defaults + custom for Agents page — DIP: still parsed via FactoryRegistry, not hand objects
export const SAMPLE_AGENT_TRIAGE = `---
description: Investigates codebase and reproduces issues when needed
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
model: auto
runner: linux-build
workerHost: warp
secrets:
  - <REPLACE_ME>
mcpServers:
  sentry:
    warpId: <REPLACE_ME>
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
    warpId: <REPLACE_ME>
secrets:
  - <REPLACE_ME>
  - <REPLACE_ME>
---

Custom security agent audits PRs for vulnerabilities and enforces compliance checklists.
`;

/**
 * OCP/R5: parámetro opcional al final. **Sin args el bundle es byte-idéntico al de hoy**
 * (usa el literal `SAMPLE_FACTORY_FULL`), así que ningún test existente cambia.
 */
export interface FactoryBundleOptions {
  readonly name?: string;
  readonly alias?: string;
  readonly repositories?: readonly RepositoryRef[];
}

const DEFAULT_BUNDLE_NAME = "payments-factory";
const DEFAULT_BUNDLE_ALIAS = "payments";
const DEFAULT_BUNDLE_REPOS: readonly RepositoryRef[] = [
  { owner: "acme", name: "payments-service" },
  { owner: "acme", name: "payments-api" },
];

function buildFactoryYaml(opts?: FactoryBundleOptions): string {
  if (!opts) return SAMPLE_FACTORY_FULL;
  const name = opts.name ?? DEFAULT_BUNDLE_NAME;
  const alias = opts.alias ?? DEFAULT_BUNDLE_ALIAS;
  const repos = opts.repositories ?? DEFAULT_BUNDLE_REPOS;
  const repoBlock =
    repos.length === 0
      ? "  []"
      : repos.map((r) => `  - owner: ${r.owner}\n    name: ${r.name}`).join("\n");
  return `schemaVersion: v1alpha1
name: ${name}
description: Processes approved work for the payments service
alias: ${alias}
repositories:
${repoBlock}
secrets:
  - <REPLACE_ME>
mcpServers:
  sentry:
    warpId: <REPLACE_ME>
integrations:
  - type: slack
agentDefaults:
  model: auto
  runner: linux-build
  secrets:
    - <REPLACE_ME>
`;
}

export function getFactoryBundle(opts?: FactoryBundleOptions) {
  const registry = new FactoryRegistry();
  const result = registry.parseBundle({
    factoryYaml: { raw: buildFactoryYaml(opts), file: "factory.yaml" },
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
