// validation.derive — pure, no I/O, SRP each derive
// DIP: pages read from here + FactoryRegistry, not hardcode — OCP: add example without touching others
// Source: WarpFactories.md §7 Machine-readable schema + §16 Referencias + WarpFactories-UserStories.md E06 US-059, E07
//         warp-factory-examples 00/01/02/03/04/06/07

import { FactoryParser } from "../parsers/factory.parser";
import { parseFactoryYaml } from "../parsers/factory.parser";
import type { ParseResult } from "./result";
import type { FactoryDefinition } from "./types";

// §7 — Schemas unauthenticated — nombres exactos del doc
export const SCHEMA_URLS = {
  base: "https://app.warp.dev/api/v1/factory-files/schemas",
  v1alpha1: "https://app.warp.dev/api/v1/factory-files/schemas/v1alpha1",
} as const;

export const SCHEMA_AUTH = "unauthenticated" as const;
export const SCHEMA_VERSION = "v1alpha1" as const;

// §7/§12 — tool validate_factory_files (MCP) — nombre exacto
export const VALIDATE_TOOL = "validate_factory_files" as const;
export const GET_SCHEMA_TOOL = "get_factory_file_schema" as const;
export const FACTORY_MCP_ENDPOINT = "https://app.warp.dev/api/v1/mcp/factory" as const;

// §16 — warp-factory-examples fixtures 00/01/02/03/04/06/07
// 05 no existe en doc; mantener set exacto pedido
export const WARP_FACTORY_EXAMPLES = [
  {
    id: "00-warp-default-agents",
    repo: "warpdotdev/warp-factory-examples",
    path: "00-warp-default-agents",
    githubUrl: "https://github.com/warpdotdev/warp-factory-examples/tree/main/00-warp-default-agents",
    description: "Prompts/descripciones/modelos de los default agents como archivos",
    hasLocalFixture: true,
  },
  {
    id: "01-single-repo-quickstart",
    repo: "warpdotdev/warp-factory-examples",
    path: "01-single-repo-quickstart",
    githubUrl: "https://github.com/warpdotdev/warp-factory-examples/tree/main/01-single-repo-quickstart",
    description: "Tree mínimo working (factory.yaml + 1 agent + automation + runner)",
    hasLocalFixture: true,
  },
  {
    id: "02-sdlc-issue-to-pr",
    repo: "warpdotdev/warp-factory-examples",
    path: "02-sdlc-issue-to-pr",
    githubUrl: "https://github.com/warpdotdev/warp-factory-examples/tree/main/02-sdlc-issue-to-pr",
    description: "Full lifecycle con 3 runners (incl. macOS), 2 scorers, skills factory-wide + per-agent",
    hasLocalFixture: true,
  },
  {
    id: "03-multi-harness",
    repo: "warpdotdev/warp-factory-examples",
    path: "03-multi-harness",
    githubUrl: "https://github.com/warpdotdev/warp-factory-examples/tree/main/03-multi-harness",
    description: "Different harness per agent, managed-secret auth para Claude/Codex, runners x86_64 + aarch64",
    hasLocalFixture: true,
  },
  {
    id: "04-code-review-only",
    repo: "warpdotdev/warp-factory-examples",
    path: "04-code-review-only",
    githubUrl: "https://github.com/warpdotdev/warp-factory-examples/tree/main/04-code-review-only",
    description: "Single-agent factory solo para review (base_branches + labels not_in)",
    hasLocalFixture: true,
  },
  {
    id: "06-common-automations",
    repo: "warpdotdev/warp-factory-examples",
    path: "06-common-automations",
    githubUrl: "https://github.com/warpdotdev/warp-factory-examples/tree/main/06-common-automations",
    description: "Catálogo de filtros (branches, paths, workflow conclusions, emoji reactions, CI triage, slack reaction ticket, weekly audit 0 9 * * 1)",
    hasLocalFixture: true,
  },
  {
    id: "07-self-hosted-worker",
    repo: "warpdotdev/warp-factory-examples",
    path: "07-self-hosted-worker",
    githubUrl: "https://github.com/warpdotdev/warp-factory-examples/tree/main/07-self-hosted-worker",
    description: "workerHost + runner platform-matched (linux/amd64|arm64, Docker/K8s/Direct)",
    hasLocalFixture: true,
  },
] as const;

export type WarpFactoryExample = (typeof WARP_FACTORY_EXAMPLES)[number];

export function getExampleById(id: string): WarpFactoryExample | undefined {
  return WARP_FACTORY_EXAMPLES.find((e) => e.id === id);
}

// Copyable examples — 01 y 02 nombres exactos del doc §16
// 01 = minimal quickstart — deriva de SAMPLE_FACTORY_MINIMAL §7 structure
export const EXAMPLE_01_SINGLE_REPO_QUICKSTART = {
  id: "01-single-repo-quickstart",
  files: [
    {
      path: "factory.yaml",
      language: "yaml" as const,
      raw: `schemaVersion: v1alpha1
name: payments-factory
repositories:
  - owner: acme
    name: payments-service
agentDefaults:
  model: auto
  runner: linux-build
`,
    },
    {
      path: "agents/foreman/agent.md",
      language: "markdown" as const,
      raw: `---
description: Routes approved payments work through the factory
agentType: FOREMAN
---

Own each work item from intake through human handoff.
Confirm the request is ready before dispatching implementation.
`,
    },
    {
      path: "automations/labeled-issue/automation.md",
      language: "markdown" as const,
      raw: `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      repos: [acme/payments-service]
      labels: [factory-ready]
---

Review the labeled issue and decide the next required stage.
`,
    },
    {
      path: "runners/linux-build.yaml",
      language: "yaml" as const,
      raw: `description: Linux runner for payments builds and tests
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
`,
    },
  ],
} as const;

// 02 = full lifecycle — deriva de §7 ejemplo + 02-sdlc-issue-to-pr
export const EXAMPLE_02_SDLC_ISSUE_TO_PR = {
  id: "02-sdlc-issue-to-pr",
  files: [
    {
      path: "factory.yaml",
      language: "yaml" as const,
      raw: `schemaVersion: v1alpha1
name: payments-factory
description: Processes approved work for the payments service
alias: payments
repositories:
  - owner: acme
    name: payments-service
agentDefaults:
  model: auto
  runner: linux-build
`,
    },
    {
      path: "agents/foreman/agent.md",
      language: "markdown" as const,
      raw: `---
description: Routes approved payments work through the factory
agentType: FOREMAN
model: auto
runner: linux-build
---

Own each work item from intake through human handoff.
`,
    },
    {
      path: "agents/implement/agent.md",
      language: "markdown" as const,
      raw: `---
description: Implements code, tests and validation, continues spec branch
agentType: IMPLEMENT
harness:
  type: codex
  model: gpt-5
  reasoningLevel: high
  auth:
    source: managedSecret
    secretName: CODEX_API_KEY
runner: linux-build
---

Continues branch and draft PR from spec.
`,
    },
    {
      path: "scorers/tests-run/scorer.md",
      language: "markdown" as const,
      raw: `---
name: tests-run
description: Checks whether implementation runs include test evidence.
agents:
  - reviewer
labels:
  - value: tests_run
    score: 1
  - value: tests_skipped
    score: 0
passingScore: 1
samplingRate: 25
model: claude-4-5-haiku
---

Evaluate whether the agent ran the relevant tests before finishing.
`,
    },
    {
      path: "skills/repository-conventions/SKILL.md",
      language: "markdown" as const,
      raw: `---
name: repository-conventions
---

Follow repository conventions for tests and lint.
`,
    },
  ],
} as const;

export const COPYABLE_EXAMPLES = [EXAMPLE_01_SINGLE_REPO_QUICKSTART, EXAMPLE_02_SDLC_ISSUE_TO_PR] as const;

// Live validation via FactoryRegistry / FactoryParser — DIP
export function validateFactoryYamlLive(raw: string, file = "factory.yaml"): ParseResult<FactoryDefinition> {
  return parseFactoryYaml(raw, file);
}

// Helper for UI: try validate and return issues mapped to file+line
export function validateWithParser(raw: string): { ok: boolean; issues: { file: string; message: string; code?: string }[] } {
  const parser = new FactoryParser();
  const res = parser.parseFactoryYaml(raw, "factory.yaml");
  if (res.ok) return { ok: true, issues: [] };
  return {
    ok: false,
    issues: res.issues.map((i) => ({ file: i.path ?? "factory.yaml", message: i.message, code: i.code })),
  };
}

// Fixture presence helper — mirrors SAMPLE_* constants
export function hasFixtureForExample(id: string): boolean {
  const found = getExampleById(id);
  return Boolean(found?.hasLocalFixture);
}

export function allFixturesPresent(): boolean {
  return WARP_FACTORY_EXAMPLES.every((e) => e.hasLocalFixture);
}
