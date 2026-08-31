// Source: figma/Factories frontend/src/App.tsx — copied verbatim, do not edit manually.
// This is the ONLY place where MOCK_* lives. Components must read via hooks/store, never import MOCK_* directly.

export interface Repo {
  id: string;
  name: string;
  owner: string;
  private: boolean;
  language: string;
  updatedAt: string;
}

export interface FactoryConfig {
  selectedRepo: Repo | null;
  factoryName: string;
  foremanName: string;
  description: string;
  agents: { triage: boolean; spec: boolean; code: boolean; review: boolean };
  trackers: { linear: boolean; jira: boolean };
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  type: "foreman" | "triage" | "spec" | "implement" | "review" | "custom";
  mcps: { name: string; color: string }[];
  secrets: string[];
  harness: string;
  model: string;
  runner: string;
  host: string;
  prompt: string;
}

export interface WorkItem {
  id: string;
  title: string;
  stage: "triage" | "planning" | "building" | "reviewing";
  hash: string;
  time: string;
  origin: "slack" | "github" | "linear";
  startedAgo: string;
}

export interface Run {
  id: string;
  title: string;
  hash: string;
  status: "running" | "done" | "benchmark" | "failed";
  tags: string[];
  source: string;
  agentInitial: string;
  time: string;
}

export interface Automation {
  id: string;
  name: string;
  triggers: string;
  agent: string;
  created: string;
}

export interface ScorerClassification {
  id: string;
  name: string;
  outcome: "pass" | "fail";
  description: string;
}

export interface Scorer {
  id: string;
  name: string;
  description: string;
  agentIds: string[];
  judgeInstructions: string;
  judgeModel: string;
  classifications: ScorerClassification[];
  passThreshold: number;
  sampleRate: number;
  selfImprovement: boolean;
}

export type TriggerConfig =
  | { type: "scheduled"; frequency: "hourly" | "daily" | "weekly" | "custom"; day: string; time: string }
  | null;

// ─── Mock data ───────────────────────────────────────────────────────────────

export const MOCK_REPOS: readonly Repo[] = [
  { id: "1", name: "payments-service", owner: "acme-corp", private: true, language: "TypeScript", updatedAt: "2h ago" },
  { id: "2", name: "api-gateway", owner: "acme-corp", private: true, language: "Go", updatedAt: "1d ago" },
  { id: "3", name: "frontend-app", owner: "acme-corp", private: false, language: "TypeScript", updatedAt: "3d ago" },
  { id: "4", name: "data-pipelines", owner: "acme-corp", private: true, language: "Python", updatedAt: "5d ago" },
  { id: "5", name: "marketing-site", owner: "acme-corp", private: false, language: "TypeScript", updatedAt: "1w ago" },
] as const;

export const DEFAULT_AGENTS: readonly Agent[] = [
  { id: "foreman", name: "foreman", description: "Orchestrates the factory workflow and dispatches each gated step.", type: "foreman", mcps: [{ name: "figma", color: "#F24E1E" }, { name: "grafana", color: "#F46800" }, { name: "staging", color: "#1a1a1a" }], secrets: ["GITHUB_TOKEN", "SLACK_WEBHOOK_URL"], harness: "Warp", model: "auto (genius)", runner: "default", host: "Warp hosted", prompt: "# Foreman\n\nYou are the foreman agent of the software factory.\n\nYour responsibilities:\n- Receive incoming work items\n- Route work to the appropriate specialist agents\n- Monitor progress and report back\n- Ensure quality gates are met" },
  { id: "triage", name: "triage", description: "Triages requests and establishes task state.", type: "triage", mcps: [{ name: "figma", color: "#F24E1E" }, { name: "grafana", color: "#F46800" }, { name: "debug", color: "#1a1a1a" }], secrets: ["TUI_AUTH_KEY", "WILSON_SENTRY_AUTH_TOKEN"], harness: "Warp", model: "grok 4.5 (high)", runner: "standard", host: "--", prompt: "# Triage\n\nYou are the triage agent of the software factory." },
  { id: "spec", name: "spec", description: "Writes and drives approval of specifications.", type: "spec", mcps: [], secrets: ["GITHUB_TOKEN"], harness: "Warp", model: "auto (genius)", runner: "default", host: "Warp hosted", prompt: "# Spec\n\nYou are the spec agent of the software factory." },
  { id: "implementation", name: "implementation", description: "Implements, validates, and updates code changes.", type: "implement", mcps: [], secrets: ["GITHUB_TOKEN"], harness: "Warp", model: "auto (genius)", runner: "linux-build", host: "Warp hosted", prompt: "# Implementation\n\nYou are the implementation agent." },
  { id: "code-review", name: "code-review", description: "Reviews factory pull requests and routes findings to rework or human resolution.", type: "review", mcps: [], secrets: ["GITHUB_TOKEN"], harness: "Warp", model: "claude-sonnet-5", runner: "default", host: "Warp hosted", prompt: "# Code Review\n\nYou are the code-review agent." },
] as const;

export const MOCK_WORK_ITEMS: readonly WorkItem[] = [
  { id: "1", title: "Update pin UI to left hover", stage: "triage", hash: "93C5DB", time: "Just now", origin: "slack", startedAgo: "1 min ago" },
  { id: "2", title: "Replace ASCII caret with chevron icon", stage: "triage", hash: "0414D6", time: "1 week ago", origin: "github", startedAgo: "1 week ago" },
  { id: "3", title: "Debug GitHub Permissions Issue", stage: "triage", hash: "925DA6", time: "1 week ago", origin: "github", startedAgo: "1 week ago" },
  { id: "4", title: "Add Paste Option for Grok Auth Code", stage: "triage", hash: "1DD04F", time: "1 week ago", origin: "slack", startedAgo: "1 week ago" },
  { id: "5", title: "Adjust Pin Icon Alignment", stage: "reviewing", hash: "2878CF", time: "2 days ago", origin: "github", startedAgo: "2 days ago" },
  { id: "6", title: "Fix Hubble Factory Trigger Issue", stage: "reviewing", hash: "C416C2", time: "1 week ago", origin: "github", startedAgo: "1 week ago" },
  { id: "7", title: "Add /resume Command Suggestion", stage: "reviewing", hash: "AC37FD", time: "1 week ago", origin: "slack", startedAgo: "1 week ago" },
] as const;

export const MOCK_RUNS: readonly Run[] = [
  { id: "1", title: "Implementation: multi-code-forge environments and factories (first working v", hash: "FF091E", status: "running", tags: ["Orchestration"], source: "", agentInitial: "F", time: "just now" },
  { id: "2", title: "Final computer-use verification of PR #15372", hash: "A86B59", status: "running", tags: ["Orchestration"], source: "", agentInitial: "F", time: "just now" },
  { id: "3", title: "Add Paste to the block list context menu", hash: "9AE35E", status: "running", tags: ["2 PRs Creat", "17 Images", "Orchestration"], source: "github", agentInitial: "F", time: "just now" },
  { id: "4", title: "Computer-use verification of settings UI on PR #15345", hash: "B965A3", status: "running", tags: ["35 Images", "Orchestration"], source: "images", agentInitial: "F", time: "just now" },
  { id: "5", title: "Slack Run Failure Notification", hash: "BC8A70", status: "running", tags: ["PR Creat", "Slack"], source: "slack", agentInitial: "F", time: "just now" },
  { id: "6", title: "Benchmark: Factory UI Implement Agent Benchmarks / Add Activity Search", hash: "F7E627", status: "benchmark", tags: ["BENCHMARK_TRIAL"], source: "", agentInitial: "I", time: "just now" },
  { id: "7", title: "Triage: dry-run play button on cron trigger page", hash: "114C", status: "done", tags: ["Orchestration"], source: "", agentInitial: "F", time: "just now" },
  { id: "8", title: "Investigate Agent Task Cancellation", hash: "F13431", status: "running", tags: ["Slack"], source: "slack", agentInitial: "F", time: "just now" },
  { id: "9", title: "Slack Mention: Request Review", hash: "CC053A", status: "running", tags: ["1 Vid", "Slack"], source: "slack", agentInitial: "F", time: "just now" },
  { id: "10", title: "multi-team PR 1A: Warp Agent settings and AI policy", hash: "259744", status: "running", tags: ["PR Creat", "Orchestration"], source: "github", agentInitial: "F", time: "just now" },
  { id: "11", title: "Focus session: improve factory startup flow", hash: "AB12CD", status: "running", tags: ["Orchestration"], source: "", agentInitial: "F", time: "just now" },
  { id: "12", title: "Nightly benchmark sweep: scorer pass rate 0.8", hash: "EF34AB", status: "done", tags: ["BENCHMARK_TRIAL"], source: "", agentInitial: "F", time: "1h ago" },
] as const;

export const MOCK_AUTOMATIONS: readonly Automation[] = [
  { id: "1", name: "github-factory-mention-assign", triggers: "GitHub: Issue assigned, GitHub: Issue mentioned, GitHub: PR assigned, GitHub: PR mentioned", agent: "Foreman Agent", created: "Aug 20, 2026" },
  { id: "2", name: "github-pr-closed-or-merged", triggers: "GitHub: PR closed, GitHub: PR merged", agent: "Foreman Agent", created: "Aug 20, 2026" },
] as const;

export const MOCK_SCORERS: readonly Scorer[] = [
  { id: "1", name: "Verbosity", description: "Checks that agent responses stay concise", agentIds: ["foreman", "implementation", "code-review", "spec", "triage"], judgeInstructions: "", judgeModel: "kimi k2.7 code", classifications: [{ id: "1", name: "Concise", outcome: "pass", description: "Response is concise" }, { id: "2", name: "Verbose", outcome: "fail", description: "Response is too verbose" }, { id: "3", name: "Too short", outcome: "fail", description: "Response is too short" }], passThreshold: 0.8, sampleRate: 75, selfImprovement: false },
  { id: "2", name: "Task Compliance", description: "Checks that agents complete assigned tasks", agentIds: ["foreman", "implementation", "code-review", "spec", "triage"], judgeInstructions: "", judgeModel: "claude-sonnet-5", classifications: [{ id: "1", name: "Compliant", outcome: "pass", description: "" }, { id: "2", name: "Non-compliant", outcome: "fail", description: "" }, { id: "3", name: "Partial", outcome: "fail", description: "" }, { id: "4", name: "Exceeds", outcome: "pass", description: "" }], passThreshold: 0.7, sampleRate: 100, selfImprovement: true },
  { id: "3", name: "Procedure Compliance", description: "Ensures agents follow established procedures", agentIds: ["foreman", "implementation", "code-review", "spec", "triage"], judgeInstructions: "", judgeModel: "kimi k2.7 code", classifications: [{ id: "1", name: "Followed", outcome: "pass", description: "" }, { id: "2", name: "Skipped steps", outcome: "fail", description: "" }, { id: "3", name: "Wrong order", outcome: "fail", description: "" }], passThreshold: 0.9, sampleRate: 50, selfImprovement: false },
  { id: "4", name: "Efficiency", description: "Measures how efficiently agents complete tasks", agentIds: ["foreman", "implementation", "code-review", "spec", "triage"], judgeInstructions: "", judgeModel: "grok 4.5 (high)", classifications: [{ id: "1", name: "Efficient", outcome: "pass", description: "" }, { id: "2", name: "Inefficient", outcome: "fail", description: "" }, { id: "3", name: "Acceptable", outcome: "pass", description: "" }, { id: "4", name: "Wasteful", outcome: "fail", description: "" }], passThreshold: 0.75, sampleRate: 25, selfImprovement: true },
  { id: "5", name: "Code Quality", description: "Reviews code quality produced by agents", agentIds: ["implementation"], judgeInstructions: "", judgeModel: "claude-opus-5", classifications: [{ id: "1", name: "High quality", outcome: "pass", description: "" }, { id: "2", name: "Needs work", outcome: "fail", description: "" }, { id: "3", name: "Acceptable", outcome: "pass", description: "" }], passThreshold: 0.8, sampleRate: 100, selfImprovement: false },
] as const;

export const JUDGE_MODELS = ["kimi k2.7 code", "claude-sonnet-5", "claude-opus-5", "grok 4.5 (high)", "auto (genius)", "gpt-5"] as const;

export const STAGE_META: Record<string, { label: string; bg: string; headerBg: string; text: string }> = {
  triage: { label: "Triage", bg: "bg-white", headerBg: "bg-white", text: "text-gray-700" },
  planning: { label: "Planning", bg: "bg-orange-50/60", headerBg: "bg-orange-50/80", text: "text-orange-600" },
  building: { label: "Building", bg: "bg-blue-50/60", headerBg: "bg-blue-50/80", text: "text-blue-600" },
  reviewing: { label: "Reviewing", bg: "bg-pink-50/60", headerBg: "bg-pink-50/80", text: "text-pink-600" },
};

export const AGENTS_SETUP = [
  { id: "foreman", label: "Foreman", desc: "This is the orchestration agent you interact with directly.", required: true },
  { id: "triage", label: "Triage", desc: "Accepts work from issue tracking tools like Jira and Linear.", required: false },
  { id: "spec", label: "Spec", desc: "Iterates with your team to produce specs.", required: false },
  { id: "code", label: "Code", desc: "Implements issues from you or your triage agent.", required: false },
  { id: "review", label: "Review", desc: "Inspects PRs and identifies potential issues.", required: false },
] as const;

export const TYPE_MAP: Record<string, Agent["type"]> = { foreman: "foreman", triage: "triage", spec: "spec", code: "implement", review: "review" };

export const PIPELINE = [
  { num: 1, label: "Triage", sub: "Understand and route.", color: "bg-gray-100", accent: "#9ca3af", items: [] as { icon: string; label: string; desc: string }[] },
  { num: 2, label: "Spec", sub: "Write and approve.", color: "bg-orange-50", accent: "#f97316", items: [{ icon: "agent", label: "Agent", desc: "Drafts a spec for your approval." }] },
  { num: 3, label: "Code", sub: "Implement and deliver.", color: "bg-blue-50", accent: "#3b82f6", items: [{ icon: "github", label: "GitHub", desc: "Receives agent generated PR." }] },
  { num: 4, label: "Review", sub: "Validate and approve.", color: "bg-pink-50", accent: "#ec4899", items: [{ icon: "agent", label: "Agent", desc: "Will review the PR." }] },
] as const;

export const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
export const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;
export const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 ${BTN_PRESS}`;
