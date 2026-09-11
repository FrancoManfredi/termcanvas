import { createElement, type ReactElement } from "react";
import type { Agent, AgentConfigData } from "../types";
import type { AgentsAdapter } from "./types";

/**
 * Mock agents dataset — shapes copied from
 * figma/Crear panel lateral interactivo/src/components/AgentsPanel.tsx
 * (FOREMAN, SUB_AGENTS) and src/components/AgentConfig.tsx (AGENT_CONFIGS).
 * Copied, never imported from figma/.
 *
 * Live behavior: agent display names are short ("Foreman", "Triage", "Spec",
 * "Implement", "Review") and the `prompt` seeds below are OFFLINE FALLBACK
 * only — `AgentConfig` loads the real body from
 * `GET /factory/agents/:name` (daemon, `factory/agents/<name>/agent.md`)
 * and saves edits with `PUT /factory/agents/:name`.
 *
 * Note: this file is `.ts` by design, so the five small tree icons from
 * AgentsPanel.tsx are expressed with `createElement` (identical SVG
 * attributes, no JSX) instead of JSX syntax.
 */

function ForEmanIcon(): ReactElement {
  return createElement(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none" },
    createElement("circle", { cx: 10, cy: 4, r: 2.2, stroke: "#a78bfa", strokeWidth: 1.5 }),
    createElement("circle", { cx: 4, cy: 16, r: 2.2, stroke: "#a78bfa", strokeWidth: 1.5 }),
    createElement("circle", { cx: 16, cy: 16, r: 2.2, stroke: "#a78bfa", strokeWidth: 1.5 }),
    createElement("path", {
      d: "M10 6.2v4M10 10.2l-4.5 3.6M10 10.2l4.5 3.6",
      stroke: "#a78bfa",
      strokeWidth: 1.5,
      strokeLinecap: "round",
    }),
  );
}

function TriageIcon(): ReactElement {
  return createElement(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none" },
    createElement("circle", {
      cx: 10, cy: 10, r: 7,
      stroke: "#94a3b8", strokeWidth: 1.5,
      strokeDasharray: "2.5 2.5", strokeLinecap: "round",
    }),
    createElement("circle", { cx: 10, cy: 10, r: 2, fill: "#94a3b8" }),
  );
}

function SpecIcon(): ReactElement {
  return createElement(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none" },
    createElement("rect", {
      x: 5, y: 3, width: 10, height: 14, rx: 2,
      stroke: "#fb923c", strokeWidth: 1.5,
    }),
    createElement("path", {
      d: "M8 7h4M8 10h4M8 13h2",
      stroke: "#fb923c", strokeWidth: 1.4, strokeLinecap: "round",
    }),
    createElement("circle", {
      cx: 14.5, cy: 14.5, r: 3,
      fill: "rgba(249,115,22,0.14)", stroke: "#fb923c", strokeWidth: 1.3,
    }),
    createElement("path", {
      d: "M13.5 14.5h2M14.5 13.5v2",
      stroke: "#fb923c", strokeWidth: 1.2, strokeLinecap: "round",
    }),
  );
}

function ImplementIcon(): ReactElement {
  return createElement(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none" },
    createElement("path", {
      d: "M6 7.5L3 10l3 2.5",
      stroke: "#60a5fa", strokeWidth: 1.6,
      strokeLinecap: "round", strokeLinejoin: "round",
    }),
    createElement("path", {
      d: "M14 7.5L17 10l-3 2.5",
      stroke: "#60a5fa", strokeWidth: 1.6,
      strokeLinecap: "round", strokeLinejoin: "round",
    }),
    createElement("path", {
      d: "M11.5 6l-3 8",
      stroke: "#60a5fa", strokeWidth: 1.6, strokeLinecap: "round",
    }),
  );
}

function ReviewIcon(): ReactElement {
  return createElement(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none" },
    createElement("path", {
      d: "M4 5a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H8l-3 3V5z",
      stroke: "#f472b6", strokeWidth: 1.5,
      strokeLinecap: "round", strokeLinejoin: "round",
    }),
  );
}

function VerifyIcon(): ReactElement {
  return createElement(
    "svg",
    { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none" },
    createElement("path", {
      d: "M10 2l6 3.5v5c0 4-2.8 6.3-6 7.5-3.2-1.2-6-3.5-6-7.5v-5L10 2z",
      stroke: "#2dd4bf", strokeWidth: 1.5,
      strokeLinecap: "round", strokeLinejoin: "round",
    }),
    createElement("path", {
      d: "M7.5 10l1.8 1.8L12.8 8.3",
      stroke: "#2dd4bf", strokeWidth: 1.5,
      strokeLinecap: "round", strokeLinejoin: "round",
    }),
  );
}

/**
 * Card para agentes fuera de los seeds (creados por daemon o fusionados
 * por refresh): nombre capitalizado, estilo teal de verificación,
 * sin estado inventado.
 */
export function makeHookAgentCard(id: string, description: string): Agent {
  const cleanId = String(id ?? "").trim() || "agent";
  const name = cleanId.charAt(0).toUpperCase() + cleanId.slice(1).replace(/-/g, " ");
  return {
    id: cleanId,
    name,
    description: String(description ?? "").trim() || cleanId,
    iconBg: "rgba(45,212,191,0.12)",
    iconColor: "#2dd4bf",
    icon: createElement(VerifyIcon),
  };
}

export const FOREMAN: Agent = {
  id: "foreman",
  name: "Foreman",
  description:
    "Orchestrates the worktree workflow and dispatches each gated step.",
  iconBg: "rgba(139,92,246,0.14)",
  iconColor: "#a78bfa",
  icon: createElement(ForEmanIcon),
};

export const SUB_AGENTS: Agent[] = [
  {
    id: "triage",
    name: "Triage",
    description: "Triages repository issues and establishes task state.",
    iconBg: "rgba(148,163,184,0.10)",
    iconColor: "#94a3b8",
    icon: createElement(TriageIcon),
    status: "running",
  },
  {
    id: "spec",
    name: "Spec",
    description: "Writes and drives approval of issue specifications.",
    iconBg: "rgba(249,115,22,0.12)",
    iconColor: "#fb923c",
    icon: createElement(SpecIcon),
    status: "idle",
  },
  {
    id: "implement",
    name: "Implement",
    description:
      "Implements, validates, and commits code changes to the worktree.",
    iconBg: "rgba(59,130,246,0.12)",
    iconColor: "#60a5fa",
    icon: createElement(ImplementIcon),
    status: "running",
  },
  {
    id: "review",
    name: "Review",
    description:
      "Reviews pull requests and routes findings to rework or human resolution.",
    iconBg: "rgba(236,72,153,0.12)",
    iconColor: "#f472b6",
    icon: createElement(ReviewIcon),
    status: "idle",
  },
];

export const AGENT_CONFIGS: Record<string, AgentConfigData> = {
  foreman: {
    description: "Orchestrates the worktree workflow and dispatches each gated step.",
    mcps: [
      { id: "github", name: "GitHub",  icon: "GH", color: "#6e6e6e" },
      { id: "linear", name: "Linear",  icon: "LN", color: "#5e6ad2" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN", masked: "ghp_••••••••••••••••••••" },
      { id: "s2", key: "LINEAR_API_KEY", masked: "lin_api_••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-opus-5 (max)",
    runner: "default",
    host: "Self hosted",
    prompt: `# Foreman

You are the orchestrator agent of the TermCanvas software factory. Your role is to manage the full lifecycle of a repository issue — from triage through implementation, review, and merge.

## Responsibilities
- Dispatch sub-agents (Triage, Spec, Implement, Review) in sequence
- Gate transitions between phases based on agent outputs
- Surface blockers to the human operator via the Activity panel
- Track worktree state and clean up stale branches

## Input
You receive an issue ID and repository context. You decide which agent to invoke next based on the current issue state.

## Output
Update issue status in the kanban board and emit structured handoff payloads to the next agent in the pipeline.`,
    automations: [
      { id: "a1", trigger: "New issue labeled 'agent-ready'", description: "Auto-dispatch Triage agent when a new issue receives the agent-ready label.", enabled: true },
      { id: "a2", trigger: "PR merged to main", description: "Mark linked issue as Done and archive the worktree branch.", enabled: true },
      { id: "a3", trigger: "Issue idle for 48h", description: "Send a summary digest to the Activity panel.", enabled: false },
    ],
  },
  triage: {
    description: "Triages repository issues and establishes task state.",
    mcps: [
      { id: "github", name: "GitHub", icon: "GH", color: "#6e6e6e" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN", masked: "ghp_••••••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-sonnet-5 (high)",
    runner: "default",
    host: "Warp hosted",
    prompt: `# Triage

You are the triage agent of the TermCanvas software factory. You research the issue, reproduce bugs, and create or update the work item that tracks the work.

## Responsibilities
- Read the issue body and linked context
- Classify: bug / feature / chore / question
- Assign a priority (P0–P2) and size estimate (S/M/L/XL)
- Write a structured triage comment on the GitHub issue

## Input
Issue ID, repository URL, and recent commit log.

## Output
Structured JSON with classification, priority, size, and a one-paragraph triage summary. The orchestrator decides what happens next.`,
    automations: [
      { id: "a1", trigger: "Issue opened", description: "Automatically triage any issue opened without an assignee.", enabled: true },
      { id: "a2", trigger: "Issue reopened", description: "Re-triage an issue when it's reopened after being closed.", enabled: false },
    ],
  },
  spec: {
    description: "Writes and drives approval of issue specifications.",
    mcps: [
      { id: "github", name: "GitHub",  icon: "GH", color: "#6e6e6e" },
      { id: "notion", name: "Notion",  icon: "N",  color: "#ffffff" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN",  masked: "ghp_••••••••••••••••••••" },
      { id: "s2", key: "NOTION_SECRET", masked: "secret_••••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-opus-5 (max)",
    runner: "default",
    host: "Warp hosted",
    prompt: `# Spec

You are the spec agent of the TermCanvas software factory. You write detailed technical specifications for triaged issues and get them approved before implementation begins.

## Responsibilities
- Expand the triage summary into a full implementation spec
- Define acceptance criteria, edge cases, and affected files
- Post the spec as a comment on the GitHub issue for human review
- Iterate on the spec based on review feedback

## Input
Triage output JSON and repository file tree.

## Output
A markdown specification document. The orchestrator gates the Implement agent on human approval of this spec.`,
    automations: [
      { id: "a1", trigger: "Triage complete", description: "Auto-start spec writing after triage output is received.", enabled: true },
      { id: "a2", trigger: "Spec approved", description: "Notify the Foreman agent to dispatch Implement.", enabled: true },
    ],
  },
  implement: {
    description: "Implements, validates, and commits code changes to the worktree.",
    mcps: [
      { id: "github", name: "GitHub", icon: "GH", color: "#6e6e6e" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN", masked: "ghp_••••••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-sonnet-5 (high)",
    runner: "default",
    host: "Self hosted",
    prompt: `# Implement

You are the implement agent of the TermCanvas software factory. You turn approved specs into committed code changes on a dedicated worktree branch.

## Responsibilities
- Checkout or create the worktree branch \`issue-{n}\`
- Implement all acceptance criteria from the spec
- Run the test suite and fix failures before committing
- Open a pull request against main with a structured description

## Input
Approved spec document and current repo state.

## Output
A pull request URL. The orchestrator dispatches the Review agent once the PR is open.`,
    automations: [
      { id: "a1", trigger: "Spec approved", description: "Begin implementation as soon as the spec receives approval.", enabled: true },
      { id: "a2", trigger: "Test suite fails", description: "Pause and notify the human if tests fail after 3 retries.", enabled: true },
      { id: "a3", trigger: "Branch stale for 24h", description: "Post a status update to the Activity panel.", enabled: false },
    ],
  },
  review: {
    description: "Reviews pull requests and routes findings to rework or human resolution.",
    mcps: [
      { id: "github", name: "GitHub", icon: "GH", color: "#6e6e6e" },
    ],
    secrets: [
      { id: "s1", key: "GITHUB_TOKEN", masked: "ghp_••••••••••••••••••••" },
    ],
    harness: "Warp",
    model: "claude-opus-5 (max)",
    runner: "default",
    host: "Warp hosted",
    prompt: `# Review

You are the review agent of the TermCanvas software factory. You review pull requests for correctness, security, and spec compliance.

## Responsibilities
- Diff the PR against the spec acceptance criteria
- Flag security issues, logic bugs, and missing tests
- Post inline review comments on GitHub
- Route the outcome: approve (merge-ready), request changes (back to Implement), or escalate (human resolution)

## Input
Pull request diff, spec document, and test results.

## Output
A GitHub review decision with structured findings. The orchestrator routes the issue based on the outcome.`,
    automations: [
      { id: "a1", trigger: "PR opened",           description: "Begin review automatically when a PR is opened by the Implement agent.", enabled: true },
      { id: "a2", trigger: "PR updated",           description: "Re-run review when new commits are pushed to the PR branch.", enabled: true },
      { id: "a3", trigger: "Review approved",      description: "Mark the issue as merge-ready and notify the human.", enabled: true },
    ],
  },
};

/* ─── Mock adapter (in-memory config map, no fetch/timers) ────────────── */

function cloneConfig(config: AgentConfigData): AgentConfigData {
  return {
    ...config,
    mcps: config.mcps.map((mcp) => ({ ...mcp })),
    secrets: config.secrets.map((secret) => ({ ...secret })),
    automations: config.automations.map((automation) => ({ ...automation })),
    ...(Array.isArray(config.tools) ? { tools: [...config.tools] } : {}),
  };
}

const configStore: Record<string, AgentConfigData> = Object.fromEntries(
  Object.entries(AGENT_CONFIGS).map(([agentId, config]) => [agentId, cloneConfig(config)]),
);

/** Test helper: restore the module config map to the verbatim Figma seed. */
export function resetMockAgentsStore(): void {
  for (const [agentId, config] of Object.entries(AGENT_CONFIGS)) {
    configStore[agentId] = cloneConfig(config);
  }
}

export class MockAgentsAdapter implements AgentsAdapter {
  listSubAgents(): Agent[] {
    return [...SUB_AGENTS];
  }

  getForeman(): Agent {
    return FOREMAN;
  }

  getConfig(agentId: string): AgentConfigData | undefined {
    const found = configStore[agentId];
    return found ? cloneConfig(found) : undefined;
  }

  saveConfig(agentId: string, patch: Partial<AgentConfigData>): AgentConfigData {
    const current = configStore[agentId];
    if (!current) {
      throw new Error(`Unknown agent id: ${agentId}`);
    }
    configStore[agentId] = { ...cloneConfig(current), ...patch };
    return cloneConfig(configStore[agentId]);
  }
}

export const mockAgentsAdapter: AgentsAdapter = new MockAgentsAdapter();
