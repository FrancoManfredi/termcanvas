// Fixtures — SRP: only test data, no logic
// Based on warp-factory-examples 01-single-repo-quickstart + 02-sdlc-issue-to-pr


export const SAMPLE_FACTORY_MINIMAL = `schemaVersion: v1alpha1
name: termcanvas-factory
description: Factory for TermCanvas Web
alias: termcanvas
repositories:
  - owner: blueberrycongee
    name: termcanvas
agentDefaults:
  model: auto
  runner: linux-build
`;

export const SAMPLE_FACTORY_FULL = `schemaVersion: v1alpha1
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

export const SAMPLE_AGENT_FOREMAN = `---
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
Confirm the request is ready before dispatching implementation. Require
repository validation and independent review before marking work complete.
`;

export const SAMPLE_AGENT_REVIEWER = `---
description: Reviews factory-produced pull requests
agentType: REVIEW
model: auto
runner: linux-build
---

Review each pull request against the repository's standards. Request
changes when tests are missing; never approve your own edits.
`;

export const SAMPLE_RUNNER_LINUX = `description: Linux runner for payments builds and tests
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

export const SAMPLE_RUNNER_MAC = `description: macOS runner for platform work
platform:
  os: macos
  arch: aarch64
  mac:
    version: "26"
`;

export const SAMPLE_AUTOMATION_LABELED = `---
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

export const SAMPLE_SCORER_TESTS = `---
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
