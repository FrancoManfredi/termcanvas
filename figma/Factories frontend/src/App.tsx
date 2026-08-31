import { useState, useRef } from "react";
import React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppMode = "wizard" | "app";
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;
type NavPage = "dashboard" | "activity" | "agents" | "automations" | "runs" | "scorers" | "self-improvement" | "factory-definition" | "settings";

interface Repo { id: string; name: string; owner: string; private: boolean; language: string; updatedAt: string }
interface FactoryConfig {
  selectedRepo: Repo | null;
  factoryName: string;
  foremanName: string;
  description: string;
  agents: { triage: boolean; spec: boolean; code: boolean; review: boolean };
  trackers: { linear: boolean; jira: boolean };
}

interface Agent {
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

interface WorkItem {
  id: string;
  title: string;
  stage: "triage" | "planning" | "building" | "reviewing";
  hash: string;
  time: string;
  origin: "slack" | "github" | "linear";
  startedAgo: string;
}

interface Run {
  id: string;
  title: string;
  hash: string;
  status: "running" | "done" | "benchmark" | "failed";
  tags: string[];
  source: string;
  agentInitial: string;
  time: string;
}

interface Automation {
  id: string;
  name: string;
  triggers: string;
  agent: string;
  created: string;
}

interface ScorerClassification {
  id: string;
  name: string;
  outcome: "pass" | "fail";
  description: string;
}

interface Scorer {
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

// ─── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_REPOS: Repo[] = [
  { id: "1", name: "payments-service", owner: "acme-corp", private: true, language: "TypeScript", updatedAt: "2h ago" },
  { id: "2", name: "api-gateway", owner: "acme-corp", private: true, language: "Go", updatedAt: "1d ago" },
  { id: "3", name: "frontend-app", owner: "acme-corp", private: false, language: "TypeScript", updatedAt: "3d ago" },
  { id: "4", name: "data-pipelines", owner: "acme-corp", private: true, language: "Python", updatedAt: "5d ago" },
  { id: "5", name: "marketing-site", owner: "acme-corp", private: false, language: "TypeScript", updatedAt: "1w ago" },
];

const DEFAULT_AGENTS: Agent[] = [
  { id: "foreman", name: "foreman", description: "Orchestrates the factory workflow and dispatches each gated step.", type: "foreman", mcps: [{ name: "figma", color: "#F24E1E" }, { name: "grafana", color: "#F46800" }, { name: "staging", color: "#1a1a1a" }], secrets: ["GITHUB_TOKEN", "SLACK_WEBHOOK_URL"], harness: "Warp", model: "auto (genius)", runner: "default", host: "Warp hosted", prompt: "# Foreman\n\nYou are the foreman agent of the software factory.\n\nYour responsibilities:\n- Receive incoming work items\n- Route work to the appropriate specialist agents\n- Monitor progress and report back\n- Ensure quality gates are met" },
  { id: "triage", name: "triage", description: "Triages requests and establishes task state.", type: "triage", mcps: [{ name: "figma", color: "#F24E1E" }, { name: "grafana", color: "#F46800" }, { name: "debug", color: "#1a1a1a" }], secrets: ["TUI_AUTH_KEY", "WILSON_SENTRY_AUTH_TOKEN"], harness: "Warp", model: "grok 4.5 (high)", runner: "standard", host: "--", prompt: "# Triage\n\nYou are the triage agent of the software factory." },
  { id: "spec", name: "spec", description: "Writes and drives approval of specifications.", type: "spec", mcps: [], secrets: ["GITHUB_TOKEN"], harness: "Warp", model: "auto (genius)", runner: "default", host: "Warp hosted", prompt: "# Spec\n\nYou are the spec agent of the software factory." },
  { id: "implementation", name: "implementation", description: "Implements, validates, and updates code changes.", type: "implement", mcps: [], secrets: ["GITHUB_TOKEN"], harness: "Warp", model: "auto (genius)", runner: "linux-build", host: "Warp hosted", prompt: "# Implementation\n\nYou are the implementation agent." },
  { id: "code-review", name: "code-review", description: "Reviews factory pull requests and routes findings to rework or human resolution.", type: "review", mcps: [], secrets: ["GITHUB_TOKEN"], harness: "Warp", model: "claude-sonnet-5", runner: "default", host: "Warp hosted", prompt: "# Code Review\n\nYou are the code-review agent." },
];

const MOCK_WORK_ITEMS: WorkItem[] = [
  { id: "1", title: "Update pin UI to left hover", stage: "triage", hash: "93C5DB", time: "Just now", origin: "slack", startedAgo: "1 min ago" },
  { id: "2", title: "Replace ASCII caret with chevron icon", stage: "triage", hash: "0414D6", time: "1 week ago", origin: "github", startedAgo: "1 week ago" },
  { id: "3", title: "Debug GitHub Permissions Issue", stage: "triage", hash: "925DA6", time: "1 week ago", origin: "github", startedAgo: "1 week ago" },
  { id: "4", title: "Add Paste Option for Grok Auth Code", stage: "triage", hash: "1DD04F", time: "1 week ago", origin: "slack", startedAgo: "1 week ago" },
  { id: "5", title: "Adjust Pin Icon Alignment", stage: "reviewing", hash: "2878CF", time: "2 days ago", origin: "github", startedAgo: "2 days ago" },
  { id: "6", title: "Fix Hubble Factory Trigger Issue", stage: "reviewing", hash: "C416C2", time: "1 week ago", origin: "github", startedAgo: "1 week ago" },
  { id: "7", title: "Add /resume Command Suggestion", stage: "reviewing", hash: "AC37FD", time: "1 week ago", origin: "slack", startedAgo: "1 week ago" },
];

const MOCK_RUNS: Run[] = [
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
];

const MOCK_AUTOMATIONS: Automation[] = [
  { id: "1", name: "github-factory-mention-assign", triggers: "GitHub: Issue assigned, GitHub: Issue mentioned, GitHub: PR assigned, GitHub: PR mentioned", agent: "Foreman Agent", created: "Aug 20, 2026" },
  { id: "2", name: "github-pr-closed-or-merged", triggers: "GitHub: PR closed, GitHub: PR merged", agent: "Foreman Agent", created: "Aug 20, 2026" },
];

const MOCK_SCORERS: Scorer[] = [
  { id: "1", name: "Verbosity", description: "Checks that agent responses stay concise", agentIds: ["foreman", "implementation", "code-review", "spec", "triage"], judgeInstructions: "", judgeModel: "kimi k2.7 code", classifications: [{ id: "1", name: "Concise", outcome: "pass", description: "Response is concise" }, { id: "2", name: "Verbose", outcome: "fail", description: "Response is too verbose" }, { id: "3", name: "Too short", outcome: "fail", description: "Response is too short" }], passThreshold: 0.8, sampleRate: 75, selfImprovement: false },
  { id: "2", name: "Task Compliance", description: "Checks that agents complete assigned tasks", agentIds: ["foreman", "implementation", "code-review", "spec", "triage"], judgeInstructions: "", judgeModel: "claude-sonnet-5", classifications: [{ id: "1", name: "Compliant", outcome: "pass", description: "" }, { id: "2", name: "Non-compliant", outcome: "fail", description: "" }, { id: "3", name: "Partial", outcome: "fail", description: "" }, { id: "4", name: "Exceeds", outcome: "pass", description: "" }], passThreshold: 0.7, sampleRate: 100, selfImprovement: true },
  { id: "3", name: "Procedure Compliance", description: "Ensures agents follow established procedures", agentIds: ["foreman", "implementation", "code-review", "spec", "triage"], judgeInstructions: "", judgeModel: "kimi k2.7 code", classifications: [{ id: "1", name: "Followed", outcome: "pass", description: "" }, { id: "2", name: "Skipped steps", outcome: "fail", description: "" }, { id: "3", name: "Wrong order", outcome: "fail", description: "" }], passThreshold: 0.9, sampleRate: 50, selfImprovement: false },
  { id: "4", name: "Efficiency", description: "Measures how efficiently agents complete tasks", agentIds: ["foreman", "implementation", "code-review", "spec", "triage"], judgeInstructions: "", judgeModel: "grok 4.5 (high)", classifications: [{ id: "1", name: "Efficient", outcome: "pass", description: "" }, { id: "2", name: "Inefficient", outcome: "fail", description: "" }, { id: "3", name: "Acceptable", outcome: "pass", description: "" }, { id: "4", name: "Wasteful", outcome: "fail", description: "" }], passThreshold: 0.75, sampleRate: 25, selfImprovement: true },
  { id: "5", name: "Code Quality", description: "Reviews code quality produced by agents", agentIds: ["implementation"], judgeInstructions: "", judgeModel: "claude-opus-5", classifications: [{ id: "1", name: "High quality", outcome: "pass", description: "" }, { id: "2", name: "Needs work", outcome: "fail", description: "" }, { id: "3", name: "Acceptable", outcome: "pass", description: "" }], passThreshold: 0.8, sampleRate: 100, selfImprovement: false },
];

const JUDGE_MODELS = ["kimi k2.7 code", "claude-sonnet-5", "claude-opus-5", "grok 4.5 (high)", "auto (genius)", "gpt-5"];

// ─── Shared btn class helpers ──────────────────────────────────────────────────

// Scale-on-press: active:scale-[0.96] with exact transition properties
const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;
const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 ${BTN_PRESS}`;

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function WarpLogo() {
  return (
    <div className="w-7 h-7 bg-gray-900 rounded-md flex items-center justify-center flex-shrink-0">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 12l3.5-8 2.5 6 2-3 2.5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function GithubIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function LinearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#5E6AD2" />
      <path d="M4.5 15.5L15.5 4.5M4.5 15.5L8 19l11-11-3.5-3.5M4.5 15.5l3.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function JiraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M11.571 11.429L6 5.857A5.714 5.714 0 0111.714 11.571l5.572 5.572A5.714 5.714 0 0111.571 11.43z" fill="#2684FF" />
      <path d="M11.571 11.429L6 17A5.714 5.714 0 0011.714 11.286L17.286 5.714A5.714 5.714 0 0011.571 11.43z" fill="url(#j2)" />
      <defs><linearGradient id="j2" x1="11.571" y1="11.429" x2="17.286" y2="5.714" gradientUnits="userSpaceOnUse"><stop stopColor="#0052CC" /><stop offset="1" stopColor="#2684FF" /></linearGradient></defs>
    </svg>
  );
}

function SlackIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#4A154B" />
      <path d="M8.5 13.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm0 0V8M15.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 0v5.5M10.5 8.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 0H16M13.5 15.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm0 0H8" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// ─── Agent type icons ─────────────────────────────────────────────────────────

function AgentTypeIcon({ type, size = "md" }: { type: string; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? 48 : size === "sm" ? 28 : 36;
  const s = size === "lg" ? 22 : size === "sm" ? 14 : 18;

  const configs: Record<string, { bg: string; children: React.ReactElement }> = {
    foreman: {
      bg: "#ede9fe",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <rect x="2" y="6" width="16" height="11" rx="3" stroke="#7c3aed" strokeWidth="1.5" />
          <path d="M6 6V5a4 4 0 018 0v1" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="12" r="1" fill="#7c3aed" />
          <circle cx="13" cy="12" r="1" fill="#7c3aed" />
          <path d="M8.5 15h3" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M10 6v2M7 6l-1.5-1.5M13 6l1.5-1.5" stroke="#7c3aed" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    },
    triage: {
      bg: "#f3f4f6",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="#9ca3af" strokeWidth="1.4" strokeDasharray="3.5 2" />
          <path d="M10 6.5v3.5l2.5 1.5" stroke="#6b7280" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    spec: {
      bg: "#fff7ed",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M4 4c0-1.1.9-2 2-2h5l5 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" stroke="#f97316" strokeWidth="1.4" />
          <path d="M11 2v5h5" stroke="#f97316" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M7 10h6M7 13h4" stroke="#f97316" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
    },
    implement: {
      bg: "#eff6ff",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M7 7L4 10l3 3M13 7l3 3-3 3M11.5 5l-3 10" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    review: {
      bg: "#fdf2f8",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H7l-4 2V5z" stroke="#ec4899" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M7 8h6M7 11h4" stroke="#ec4899" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
    },
    custom: {
      bg: "#f0fdf4",
      children: (
        <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7" stroke="#22c55e" strokeWidth="1.4" />
          <path d="M10 7v6M7 10h6" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
    },
  };

  const cfg = configs[type] ?? configs.custom;
  return (
    <div className="rounded-lg flex items-center justify-center flex-shrink-0" style={{ width: dim, height: dim, backgroundColor: cfg.bg }}>
      {cfg.children}
    </div>
  );
}

// ─── Stage icon ───────────────────────────────────────────────────────────────

function StageIcon({ stage, size = 16 }: { stage: string; size?: number }) {
  if (stage === "triage") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="5.5" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="3 1.8" />
      <path d="M8 5.5V8l1.5 1" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  if (stage === "planning") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 3c0-.6.4-1 1-1h4l4 4v6a1 1 0 01-1 1H4a1 1 0 01-1-1V3z" stroke="#f97316" strokeWidth="1.5" />
      <path d="M8 2v4h4" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  if (stage === "building") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M5 6L3 8l2 2M11 6l2 2-2 2M9 4l-2 8" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (stage === "reviewing") return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M2 4a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0114 4v6a1.5 1.5 0 01-1.5 1.5H6l-3 1.5V4z" stroke="#ec4899" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
  return null;
}

// ─── Run status icon ──────────────────────────────────────────────────────────

function RunStatusIcon({ status }: { status: string }) {
  if (status === "done") return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="6" stroke="#22c55e" strokeWidth="1.5" />
      <path d="M5 8l2 2 4-4" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (status === "benchmark") return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M8 2l1 4.5H14L10 9l1.5 4.5L8 11l-3.5 2.5L6 9 2 6.5h5L8 2z" fill="#f59e0b" />
    </svg>
  );
  if (status === "failed") return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M8 2L14.9 14H1.1L8 2z" stroke="#ef4444" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 7v3M8 11.5v.5" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="5.5" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="3 2" />
      <path d="M8 5v3l2 1" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-[background-color] duration-200 active:scale-[0.96] ${checked ? "bg-violet-600 hover:bg-violet-700" : "bg-gray-200 hover:bg-gray-300"}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-[transform] duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`}
        style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.18)" }}
      />
    </button>
  );
}

// ─── Chevron icon ─────────────────────────────────────────────────────────────

function Chevron({ open, size = 14 }: { open: boolean; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 14 14" fill="none"
      style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 200ms cubic-bezier(0.2,0,0,1)", flexShrink: 0 }}
    >
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Three-dot menu button ────────────────────────────────────────────────────

function DotMenu({ onClick }: { onClick?: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-[opacity,background-color,color] duration-150"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="3" r="1.1" fill="currentColor" />
        <circle cx="7" cy="7" r="1.1" fill="currentColor" />
        <circle cx="7" cy="11" r="1.1" fill="currentColor" />
      </svg>
    </button>
  );
}

// ─── MCP modal ────────────────────────────────────────────────────────────────

function McpModal({ onClose }: { onClose: () => void }) {
  const [jsonConfig, setJsonConfig] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center anim-fade-in" style={{ background: "oklch(0 0 0 / 0.35)" }}>
      <div className="bg-white rounded-2xl w-[780px] max-h-[560px] flex overflow-hidden anim-scale-in" style={{ boxShadow: "0 8px 32px oklch(0 0 0 / 0.16), 0 1px 4px oklch(0 0 0 / 0.08), inset 0 0 0 1px oklch(0 0 0 / 0.06)" }}>
        <div className="w-[280px] flex-shrink-0 border-r border-gray-100 flex flex-col">
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50/60 focus-within:border-gray-300 transition-[border-color] duration-150">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-gray-400"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              <input autoFocus placeholder="Search apps and MCP servers" className="flex-1 text-sm outline-none placeholder-gray-400 bg-transparent" />
            </div>
          </div>
          <div className="px-3 py-2">
            <button className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg ${BTN_PRESS}`}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Custom MCP
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-4 text-center">
            <p className="text-sm text-gray-400">No connected MCP servers are available to add.</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col p-5">
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Add custom MCP</h2>
            <div className="flex items-center gap-2">
              <button className={`px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 font-medium ${BTN_PRESS}`}>Add</button>
              <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150 active:scale-[0.96]">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            Add one or more MCP configs as JSON, keyed by MCP name. Use <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{"{{secret_name}}"}</code> to reference a managed secret.
          </p>
          <p className="text-xs font-semibold text-gray-600 mb-2">Configuration</p>
          <div className="flex-1 flex border border-gray-200 rounded-xl overflow-hidden bg-gray-50/50" style={{ outline: "1px solid oklch(0 0 0 / 0.04)", outlineOffset: "-1px" }}>
            <div className="w-8 pt-3 flex flex-col items-center text-xs text-gray-300 font-mono select-none"><span>1</span></div>
            <textarea value={jsonConfig} onChange={(e) => setJsonConfig(e.target.value)}
              className="flex-1 pt-3 pr-3 pb-3 text-sm font-mono bg-transparent outline-none resize-none text-gray-800"
              placeholder={'{\n  "my-mcp": {\n    "command": "npx",\n    "args": ["-y", "my-mcp-server"]\n  }\n}'} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Agents page ──────────────────────────────────────────────────────────────

function AgentDetail({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const [tab, setTab] = useState<"settings" | "automations">("settings");
  return (
    <div className="flex-1 overflow-y-auto anim-fade-in">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <button onClick={onBack} className="hover:text-gray-900 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-[color,background-color] duration-150">{"←"} Agents</button>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">{agent.name}</span>
        </div>
        <button className={BTN_SECONDARY}>Save</button>
      </div>
      <div className="px-8 py-8 max-w-3xl">
        <div className="flex items-center gap-4 border border-gray-200 rounded-xl px-5 py-4 mb-8" style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)" }}>
          <GithubIcon size={18} className="text-gray-700" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">Managed in GitHub</p>
            <p className="text-xs text-gray-500 mt-0.5">Configuration is read-only here. Make changes in <span className="font-medium">acme-corp/factory-dev</span> at main:v1.</p>
          </div>
          <button className={`flex items-center gap-1.5 whitespace-nowrap ${BTN_SECONDARY}`}>
            Open in GitHub
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 9L9 2M6 2h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <AgentTypeIcon type={agent.type} size="lg" />
        <h1 className="text-2xl font-semibold text-gray-900 mt-4 mb-6">{agent.name}</h1>
        <div className="flex gap-0 border-b border-gray-200 mb-8">
          {(["settings", "automations"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px rounded-t transition-[color,border-color,background-color] duration-150 ${tab === t ? "border-gray-900 text-gray-900 hover:bg-gray-50" : "border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50"}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === "settings" && (
          <div className="space-y-10 anim-fade-in">
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Description</h2>
              <p className="text-sm text-gray-400 mb-3">Summarize what this agent is responsible for.</p>
              <p className="text-sm text-gray-800">{agent.description}</p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Agent resources</h2>
              <p className="text-sm text-gray-400 mb-5">Resources attached to this {agent.name} agent.</p>
              <div className="space-y-4">
                <div className="flex items-start gap-8">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0 pt-0.5">MCPs</span>
                  <div className="flex flex-wrap gap-2">
                    {agent.mcps.length === 0 ? <span className="text-sm text-gray-400">—</span> : agent.mcps.map((mcp) => (
                      <span key={mcp.name} className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-700">
                        <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: mcp.color }}>{mcp.name[0].toUpperCase()}</span>
                        {mcp.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-start gap-8">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0 pt-0.5">Secrets</span>
                  <div className="flex flex-wrap gap-3">
                    {agent.secrets.length === 0 ? <span className="text-sm text-gray-400">—</span> : agent.secrets.map((s) => (
                      <span key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4.5" r="2.5" stroke="#9ca3af" strokeWidth="1.1" /><path d="M4 7l-1 4h6l-1-4" stroke="#9ca3af" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                {[{ label: "Harness", value: agent.harness }, { label: "Model", value: agent.model }, { label: "Runner", value: agent.runner }, { label: "Host", value: agent.host }].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-8">
                    <span className="text-sm text-gray-400 w-16 flex-shrink-0">{label}</span>
                    <span className="text-sm font-medium text-gray-900">{value}</span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Agent prompt</h2>
              <p className="text-sm text-gray-400 mb-4">This is the base prompt the agent will use.</p>
              <div className="border border-gray-200 rounded-xl p-5 bg-gray-50/60 font-mono text-xs text-gray-700 whitespace-pre-wrap leading-relaxed" style={{ outline: "1px solid oklch(0 0 0 / 0.04)", outlineOffset: "-1px" }}>
                {agent.prompt}
              </div>
            </section>
          </div>
        )}
        {tab === "automations" && (
          <div className="flex flex-col items-center justify-center py-16 text-center anim-fade-in">
            <p className="text-sm text-gray-400">No automations configured for this agent.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NewAgentForm({ onBack, onSave, agents }: { onBack: () => void; onSave: (a: Agent) => void; agents: Agent[] }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [harness, setHarness] = useState("Warp");
  const [model, setModel] = useState("auto (genius)");
  const [runner, setRunner] = useState("default");
  const [prompt, setPrompt] = useState("");
  const [showMcp, setShowMcp] = useState(false);

  return (
    <>
      {showMcp && <McpModal onClose={() => setShowMcp(false)} />}
      <div className="flex-1 overflow-y-auto anim-fade-in">
        <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <button onClick={onBack} className="hover:text-gray-900 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-[color,background-color] duration-150">{"←"} Agents</button>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900 font-medium">New Agent</span>
          </div>
          <button
            onClick={() => { if (name.trim()) onSave({ id: name.toLowerCase().replace(/\s+/g, "-"), name: name.trim(), description, type: "custom", mcps: [], secrets: [], harness, model, runner, host: "Warp hosted", prompt }); }}
            disabled={!name.trim()}
            className={BTN_SECONDARY}
          >
            Save
          </button>
        </div>
        <div className="px-8 py-8 max-w-3xl">
          <AgentTypeIcon type="custom" size="lg" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter Agent Name"
            className="text-2xl font-semibold outline-none border-none bg-transparent mt-4 mb-6 w-full placeholder-gray-200 transition-[color] duration-150"
            style={{ color: name ? "#111827" : undefined }} />
          <div className="flex gap-0 border-b border-gray-200 mb-8">
            <button className="px-4 py-2.5 text-sm font-medium border-b-2 border-gray-900 text-gray-900 -mb-px hover:bg-gray-50 rounded-t transition-[background-color] duration-100">Settings</button>
            <button className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-400 -mb-px transition-[color,background-color] duration-150 hover:text-gray-600 hover:bg-gray-50 rounded-t">Automations</button>
          </div>
          <div className="space-y-10">
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Description</h2>
              <p className="text-sm text-gray-400 mb-3">Summarize what this agent is responsible for.</p>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe what this agent does"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 transition-[border-color,box-shadow] duration-150" />
            </section>
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Agent resources</h2>
              <p className="text-sm text-gray-400 mb-5">Attach any relevant skills or app connections.</p>
              <div className="space-y-4">
                <div className="flex items-center">
                  <span className="text-sm text-gray-400 w-20 flex-shrink-0">MCPs</span>
                  <button onClick={() => setShowMcp(true)} className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 ${BTN_PRESS}`}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>Add MCP
                  </button>
                </div>
                <div className="flex items-center">
                  <span className="text-sm text-gray-400 w-20 flex-shrink-0">Secrets</span>
                  <button className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 ${BTN_PRESS}`}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>Add secret
                  </button>
                </div>
                {[
                  { label: "Harness", value: harness, opts: ["Warp", "OpenCode"], set: setHarness },
                  { label: "Model", value: model, opts: ["auto (genius)", "claude-sonnet-5", "claude-opus-5", "grok 4.5 (high)", "gpt-5"], set: setModel },
                  { label: "Runner", value: runner, opts: ["default", "linux-build", "macos-runner"], set: setRunner },
                ].map(({ label, value, opts, set }) => (
                  <div key={label} className="flex items-center">
                    <span className="text-sm text-gray-400 w-20 flex-shrink-0">{label}</span>
                    <div className="relative w-72">
                      <select value={value} onChange={(e) => set(e.target.value)}
                        className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white cursor-pointer transition-[border-color] duration-150">
                        {opts.map((o) => <option key={o}>{o}</option>)}
                      </select>
                      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </div>
                  </div>
                ))}
                <div className="flex items-center">
                  <span className="text-sm text-gray-400 w-20 flex-shrink-0">Host</span>
                  <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 w-72 bg-gray-50/60">Warp hosted</div>
                </div>
              </div>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Agent prompt</h2>
              <p className="text-sm text-gray-400 mb-4">This is the base prompt the agent will use.</p>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Write the agent's base prompt here..." rows={8}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder-gray-300 focus:ring-2 focus:ring-violet-500 transition-[border-color,box-shadow] duration-150" />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

function AgentsPage({ factoryName, agents, onAgentsChange }: { factoryName: string; agents: Agent[]; onAgentsChange: (a: Agent[]) => void }) {
  const [view, setView] = useState<"list" | "new" | string>("list");
  const activeAgent = view !== "list" && view !== "new" ? agents.find((a) => a.id === view) ?? null : null;

  if (view === "new") return <NewAgentForm onBack={() => setView("list")} onSave={(a) => { onAgentsChange([...agents, a]); setView(a.id); }} agents={agents} />;
  if (activeAgent) return <AgentDetail agent={activeAgent} onBack={() => setView("list")} />;

  const foreman = agents.find((a) => a.type === "foreman");
  const subAgents = agents.filter((a) => a.type !== "foreman");

  const staggerDelays = ["delay-0", "delay-60", "delay-120", "delay-180", "delay-240"];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-gray-700 font-medium truncate max-w-32">{factoryName}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">Agents</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-[background-color,color] duration-150">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          <button onClick={() => setView("new")} className={BTN_PRIMARY}>
            New
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="inline ml-1"><path d="M2.5 4l3.5 4 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-2">
        {foreman && (
          <div
            onClick={() => setView(foreman.id)}
            className="w-full flex items-center gap-4 px-5 py-4 border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer group anim-fade-in-up delay-0 transition-[background-color,border-color] duration-150 active:scale-[0.98]"
            style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.05)" }}
          >
            <AgentTypeIcon type="foreman" size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{foreman.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{foreman.description}</p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-[opacity] duration-150">
              {foreman.mcps.slice(0, 3).map((mcp) => (
                <span key={mcp.name} title={mcp.name} className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: mcp.color }}>{mcp.name[0].toUpperCase()}</span>
              ))}
              {foreman.mcps.length > 3 && <span className="text-xs text-gray-400 font-medium">+{foreman.mcps.length - 3}</span>}
            </div>
            <DotMenu />
          </div>
        )}

        {subAgents.map((agent, i) => (
          <div
            key={agent.id}
            onClick={() => setView(agent.id)}
            className={`w-full flex items-center gap-4 px-5 py-4 border border-gray-100 rounded-xl hover:bg-gray-50 hover:border-gray-200 cursor-pointer group anim-fade-in-up ${staggerDelays[Math.min(i + 1, 4)]} transition-[background-color,border-color] duration-150 active:scale-[0.98]`}
          >
            <AgentTypeIcon type={agent.type} size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{agent.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{agent.description}</p>
            </div>
            <DotMenu />
          </div>
        ))}

        <button
          onClick={() => setView("new")}
          className={`w-full flex items-center justify-center gap-2 py-4 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-[color,background-color] duration-150 ${BTN_PRESS}`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          New agent
        </button>
      </div>
    </div>
  );
}

// ─── Activity page ────────────────────────────────────────────────────────────

const STAGE_META: Record<string, { label: string; bg: string; headerBg: string; text: string }> = {
  triage:    { label: "Triage",    bg: "bg-white",       headerBg: "bg-white",       text: "text-gray-700"   },
  planning:  { label: "Planning",  bg: "bg-orange-50/60", headerBg: "bg-orange-50/80", text: "text-orange-600" },
  building:  { label: "Building",  bg: "bg-blue-50/60",   headerBg: "bg-blue-50/80",   text: "text-blue-600"   },
  reviewing: { label: "Reviewing", bg: "bg-pink-50/60",   headerBg: "bg-pink-50/80",   text: "text-pink-600"   },
};

function ActivityPage({ factoryName }: { factoryName: string }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ planning: false, building: false });
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  const grouped: Record<string, WorkItem[]> = { triage: [], planning: [], building: [], reviewing: [] };
  MOCK_WORK_ITEMS.forEach((item) => grouped[item.stage]?.push(item));

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="text-gray-700 font-medium">{factoryName}</span>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900 font-medium">Activity</span>
          </div>
          <div className="flex items-center gap-1.5">
            {[
              <svg key="s" width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
              <svg key="f" width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M4 5.5v7M12 2v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
              <svg key="o" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
            ].map((icon, i) => (
              <button key={i} className={`w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 ${BTN_PRESS}`}>{icon}</button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="px-8 py-3 border-b border-gray-100 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {[
              {
                icon: <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="3 1.5" /></svg>,
                bold: "Stage", sep: "is", val: "Triage, Planning, Building, ...",
              },
              {
                icon: <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="5" r="2.5" stroke="#9ca3af" strokeWidth="1.5" /><path d="M3.5 11.5a3.5 3.5 0 017 0" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" /></svg>,
                bold: "Created", sep: "by", val: "youruser",
              },
            ].map((chip) => (
              <div key={chip.bold} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm" style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.04)" }}>
                {chip.icon}
                <span className="text-gray-600 font-medium">{chip.bold}</span>
                <span className="text-gray-400">{chip.sep}</span>
                <span className="text-gray-700">{chip.val}</span>
                <button className="text-gray-400 hover:text-gray-600 ml-1 transition-[color] duration-100">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              </div>
            ))}
            <button className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 border border-dashed border-gray-200 rounded-lg transition-[color,border-color] duration-150 active:scale-[0.96]">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-400">Showing {MOCK_WORK_ITEMS.length} results</span>
              <button className={`text-gray-600 font-medium border border-gray-200 rounded-md px-3 py-1 hover:bg-gray-50 ${BTN_PRESS}`}>Clear</button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {(["triage", "planning", "building", "reviewing"] as const).map((stage) => {
            const items = grouped[stage];
            const meta = STAGE_META[stage];
            const isCollapsed = collapsed[stage];
            return (
              <div key={stage}>
                <button
                  onClick={() => setCollapsed((p) => ({ ...p, [stage]: !p[stage] }))}
                  className={`w-full flex items-center gap-2 px-8 py-3 text-sm font-semibold transition-[background-color] duration-150 hover:brightness-[0.97] ${meta.headerBg} ${meta.text}`}
                >
                  <Chevron open={!isCollapsed} size={13} />
                  <StageIcon stage={stage} size={14} />
                  <span>{meta.label}</span>
                  <span className="font-normal text-gray-400 ml-1">{items.length}</span>
                </button>

                {!isCollapsed && items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
                    className={`w-full flex items-center gap-3 px-8 py-3 text-left border-t border-gray-50 transition-[background-color] duration-100 active:scale-[0.99] ${selectedItem?.id === item.id ? "bg-gray-100/80 ring-1 ring-inset ring-gray-900/8" : "hover:bg-gray-50"}`}
                  >
                    <StageIcon stage={stage} size={14} />
                    <span className="flex-1 text-sm text-gray-800 truncate">{item.title}</span>
                    <span className="text-xs font-mono text-gray-400 uppercase tabular-nums">{item.hash}</span>
                    <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ outline: "1px solid oklch(0 0 0 / 0.1)", outlineOffset: "0px" }}>U</div>
                    <span className="text-xs text-gray-400 whitespace-nowrap w-20 text-right tabular-nums">{item.time}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right drawer */}
      {selectedItem && (
        <div className="w-[340px] flex-shrink-0 border-l border-gray-200 flex flex-col bg-white anim-slide-right" style={{ boxShadow: "-4px 0 16px oklch(0 0 0 / 0.05)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-1">
              <span className="text-xs font-mono text-gray-700 font-semibold uppercase tabular-nums">{selectedItem.hash}</span>
              <button className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-[color,background-color] duration-100">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M4 3l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
              <button className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-[color,background-color] duration-100">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M8 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button className="w-6 h-6 rounded-md bg-red-100 hover:bg-red-200 flex items-center justify-center active:scale-[0.9] transition-[background-color,transform] duration-100">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.2" fill="#ef4444" /></svg>
              </button>
              <button className={`flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 rounded-md text-xs text-gray-700 hover:bg-gray-50 ${BTN_PRESS}`}>
                <svg width="10" height="10" viewBox="0 0 11 11" fill="none"><path d="M2 9L9 2M6 2h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                View agent
              </button>
              <button className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-[color,background-color] duration-100">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M6.5 4V6.5l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
              <button onClick={() => setSelectedItem(null)} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-[background-color,color] duration-100 active:scale-[0.9]">
                <svg width="12" height="12" viewBox="0 0 13 13" fill="none"><path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">{selectedItem.title}</h2>
            <div className="flex items-center gap-1.5 mb-5">
              <StageIcon stage={selectedItem.stage} size={13} />
              <span className="text-xs text-gray-500 capitalize">{selectedItem.stage}</span>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
              <div className="mt-0.5 flex-shrink-0">
                {selectedItem.origin === "slack" ? <SlackIcon size={16} /> : selectedItem.origin === "github" ? <GithubIcon size={16} className="text-gray-700" /> : <LinearIcon size={16} />}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">
                  Origin {selectedItem.origin === "slack" ? "Slack thread" : selectedItem.origin === "github" ? "GitHub issue" : "Linear issue"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">Started this task {selectedItem.startedAgo}</p>
              </div>
            </div>
          </div>

          <button className={`flex items-center justify-between px-5 py-4 border-t border-gray-100 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-[background-color] duration-100 active:scale-[0.99]`}>
            Task details
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Runs page ────────────────────────────────────────────────────────────────

function RunsPage({ factoryName }: { factoryName: string }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-gray-700 font-medium">{factoryName}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">Runs</span>
        </div>
        <div className="flex items-center gap-1.5">
          {[
            <svg key="s" width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
            <svg key="c" width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M4 5.5v7M12 2v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
            <svg key="f" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
          ].map((icon, i) => (
            <button key={i} className={`w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 ${BTN_PRESS}`}>{icon}</button>
          ))}
          <button className={BTN_PRIMARY}>New</button>
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {MOCK_RUNS.map((run) => (
          <button key={run.id} className="w-full flex items-center gap-3 px-8 py-2.5 hover:bg-gray-50 text-left group transition-[background-color] duration-100 active:scale-[0.99]">
            <RunStatusIcon status={run.status} />
            <span className="flex-1 text-sm text-gray-800 truncate min-w-0">{run.title}</span>
            <span className="text-xs font-mono text-gray-400 uppercase tabular-nums flex-shrink-0">{run.hash}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {run.tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded text-[11px] text-gray-500">
                  {(tag === "PR Creat" || tag === "2 PRs Creat") && <GithubIcon size={10} className="text-gray-500" />}
                  {tag.includes("Slack") && <SlackIcon size={10} />}
                  {tag}
                </span>
              ))}
            </div>
            <span className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">{run.agentInitial}</span>
            <span className="text-xs text-gray-400 flex-shrink-0 w-16 text-right tabular-nums">{run.time}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Automations page ─────────────────────────────────────────────────────────

type TriggerConfig = { type: "scheduled"; frequency: "hourly" | "daily" | "weekly" | "custom"; day: string; time: string } | null;

function TriggerDropdown({ onSelect }: { onSelect: (t: TriggerConfig) => void }) {
  const [hoveredScheduled, setHoveredScheduled] = useState(false);

  return (
    <div className="flex rounded-xl border border-gray-200 bg-white overflow-hidden text-sm anim-fade-in-up" style={{ boxShadow: "0 8px 24px oklch(0 0 0 / 0.12), 0 1px 4px oklch(0 0 0 / 0.06)" }}>
      <div className="w-44 py-2 border-r border-gray-100">
        <button
          onMouseEnter={() => setHoveredScheduled(true)}
          onMouseLeave={() => setHoveredScheduled(false)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition-[background-color] duration-100 ${hoveredScheduled ? "bg-gray-50" : ""}`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="#6b7280" strokeWidth="1.5" /><path d="M7 4.5V7l2 1" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Scheduled
        </button>
        {[
          { icon: <GithubIcon size={14} className="text-gray-700" />, label: "GitHub" },
          { icon: <LinearIcon size={14} />, label: "Linear", disabled: true },
          { icon: <SlackIcon size={14} />, label: "Slack", disabled: true },
          { icon: <JiraIcon size={14} />, label: "Jira", disabled: true },
        ].map(({ icon, label, disabled }) => (
          <button key={label} disabled={disabled}
            className={`w-full flex items-center gap-2.5 px-3 py-2 transition-[background-color] duration-100 ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-50"}`}>
            {icon}
            <span>{label}</span>
            {disabled && <span className="ml-auto text-[10px] text-gray-400">Not connected</span>}
          </button>
        ))}
      </div>
      {hoveredScheduled && (
        <div
          className="w-36 py-2 anim-fade-in"
          onMouseEnter={() => setHoveredScheduled(true)}
          onMouseLeave={() => setHoveredScheduled(false)}
        >
          {(["Hourly", "Daily", "Weekly", "Custom (cron)"] as const).map((freq) => (
            <button key={freq}
              onClick={() => onSelect({ type: "scheduled", frequency: freq.toLowerCase().replace(" (cron)", "") as any, day: "Monday", time: "09:00 AM" })}
              className="w-full text-left px-4 py-2 hover:bg-gray-50 transition-[background-color] duration-100 text-sm active:scale-[0.97]">
              {freq}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewAutomationForm({ factoryName, agents, onBack, onSave }: {
  factoryName: string; agents: Agent[]; onBack: () => void; onSave: (a: Automation) => void;
}) {
  const [trigger, setTrigger] = useState<TriggerConfig>(null);
  const [showTriggerPicker, setShowTriggerPicker] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(agents.find((a) => a.type === "foreman")?.id ?? agents[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [triggerDay, setTriggerDay] = useState("Monday");
  const [triggerTime, setTriggerTime] = useState("09:00 AM");
  const [triggerFreq, setTriggerFreq] = useState<"weekly" | "hourly" | "daily" | "custom">("weekly");

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const TIMES = ["06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "12:00 PM", "02:00 PM", "04:00 PM", "06:00 PM"];

  return (
    <div className="flex-1 overflow-y-auto anim-fade-in">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <button onClick={onBack} className="hover:text-gray-900 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-[color,background-color] duration-150">{"←"} Automations</button>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">New automation</span>
        </div>
        <button
          onClick={() => { onSave({ id: Date.now().toString(), name: `automation-${Date.now()}`, triggers: trigger ? `Scheduled: ${triggerFreq}` : "None", agent: agents.find((a) => a.id === selectedAgent)?.name ?? "", created: "Just now" }); onBack(); }}
          className={BTN_SECONDARY}
        >
          Save
        </button>
      </div>

      <div className="px-10 py-8 max-w-3xl">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">New automation</h1>
        <div className="flex gap-0 border-b border-gray-200 mb-8">
          <button className="px-4 py-2.5 text-sm font-medium border-b-2 border-gray-900 text-gray-900 -mb-px hover:bg-gray-50 rounded-t transition-[background-color] duration-100">Settings</button>
          <button className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-400 -mb-px hover:text-gray-600 hover:bg-gray-50 rounded-t transition-[color,background-color] duration-150">Runs</button>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Triggers</label>
          <div className="border border-gray-200 rounded-xl overflow-visible" style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.05)" }}>
            {trigger && (
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 text-sm text-gray-700">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-gray-400 flex-shrink-0"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M7 4.5V7l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                <div className="relative">
                  <select value={triggerFreq} onChange={(e) => setTriggerFreq(e.target.value as any)} className="appearance-none pr-5 text-sm text-gray-800 bg-transparent outline-none cursor-pointer font-semibold">
                    {["hourly", "daily", "weekly", "custom"].map((f) => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                  </select>
                  <svg className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </div>
                {triggerFreq === "weekly" && (
                  <>
                    <span className="text-gray-400">on</span>
                    <div className="relative">
                      <select value={triggerDay} onChange={(e) => setTriggerDay(e.target.value)} className="appearance-none pr-5 text-sm text-gray-800 bg-transparent outline-none cursor-pointer font-semibold">
                        {DAYS.map((d) => <option key={d}>{d}</option>)}
                      </select>
                      <svg className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                    </div>
                  </>
                )}
                <span className="text-gray-400">at</span>
                <div className="relative">
                  <select value={triggerTime} onChange={(e) => setTriggerTime(e.target.value)} className="appearance-none pr-5 text-sm text-gray-800 bg-transparent outline-none cursor-pointer font-semibold">
                    {TIMES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <svg className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                </div>
                <span className="text-gray-400 text-xs">EDT</span>
                <span className="text-xs text-gray-400 ml-1">Next run {triggerDay} at {triggerTime} EDT</span>
                <button onClick={() => setTrigger(null)} className="ml-auto text-gray-400 hover:text-gray-600 transition-[color] duration-100 active:scale-[0.9]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              </div>
            )}
            <div className="relative">
              <button
                onClick={() => setShowTriggerPicker(!showTriggerPicker)}
                className={`w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-b-xl transition-[background-color,color] duration-100 ${!trigger ? "rounded-t-xl" : ""}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                Add trigger
              </button>
              {showTriggerPicker && (
                <div className="absolute left-0 top-full z-50 mt-1">
                  <TriggerDropdown onSelect={(t) => { setTrigger(t); if (t) setTriggerFreq(t.frequency); setShowTriggerPicker(false); }} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Agents</label>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <AgentTypeIcon type={agents.find((a) => a.id === selectedAgent)?.type ?? "foreman"} size="sm" />
            </div>
            <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full appearance-none pl-12 pr-8 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white cursor-pointer transition-[border-color] duration-150">
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{factoryName} {a.name.charAt(0).toUpperCase() + a.name.slice(1)} Agent</option>
              ))}
            </select>
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">Agent prompt</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="Add a prompt for the agent(s)."
            rows={10}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder-gray-300 focus:ring-2 focus:ring-violet-500 transition-[border-color,box-shadow] duration-150" />
        </div>
      </div>
    </div>
  );
}

function AutomationsPage({ factoryName, agents }: { factoryName: string; agents: Agent[] }) {
  const [automations, setAutomations] = useState<Automation[]>(MOCK_AUTOMATIONS);
  const [view, setView] = useState<"list" | "new">("list");

  if (view === "new") return <NewAutomationForm factoryName={factoryName} agents={agents} onBack={() => setView("list")} onSave={(a) => { setAutomations((p) => [...p, a]); setView("list"); }} />;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-gray-700 font-medium">{factoryName}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">Automations</span>
        </div>
        <button onClick={() => setView("new")} className={BTN_PRIMARY}>New</button>
      </div>

      <div className="px-8 py-4">
        <div className="grid grid-cols-[180px_1fr_180px_120px] gap-4 px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
          <span>Automation</span><span>Trigger</span><span>Agent</span><span>Created</span>
        </div>
        {automations.map((auto, i) => (
          <div key={auto.id} className={`grid grid-cols-[180px_1fr_180px_120px] gap-4 px-4 py-4 items-start border-b border-gray-50 hover:bg-gray-50 group transition-[background-color] duration-100 rounded-lg anim-fade-in-up ${i === 0 ? "delay-0" : "delay-60"}`}>
            <span className="text-sm font-medium text-gray-800 break-words">{auto.name}</span>
            <span className="text-sm text-gray-500">{auto.triggers}</span>
            <span className="text-sm text-gray-700">{factoryName} {auto.agent}</span>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400 tabular-nums">{auto.created}</span>
              <DotMenu />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scorers page ─────────────────────────────────────────────────────────────

function ClassificationModal({ onClose, onAdd }: { onClose: () => void; onAdd: (c: ScorerClassification) => void }) {
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState<"pass" | "fail">("pass");
  const [description, setDescription] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center anim-fade-in" style={{ background: "oklch(0 0 0 / 0.35)" }}>
      <div className="bg-white rounded-2xl w-[480px] p-6 anim-scale-in" style={{ boxShadow: "0 8px 32px oklch(0 0 0 / 0.16), 0 1px 4px oklch(0 0 0 / 0.08)" }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Add classification</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150 active:scale-[0.9]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Name <span className="text-red-400 font-normal">*</span></label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder={`E.g. "Concise"`}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 transition-[border-color,box-shadow] duration-150" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Outcome</label>
            <div className="flex gap-2">
              {(["pass", "fail"] as const).map((o) => (
                <button key={o} onClick={() => setOutcome(o)}
                  className={`flex-1 py-2.5 text-sm font-medium rounded-lg border capitalize transition-[background-color,border-color,color] duration-150 active:scale-[0.97] ${outcome === o
                    ? o === "pass" ? "bg-green-50 border-green-300 text-green-700" : "bg-red-50 border-red-300 text-red-600"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}>
                  {o === "pass" ? "✓  Pass" : "✗  Fail"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description <span className="font-normal text-gray-400">(optional)</span></label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this classification means..."
              rows={3} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 resize-none transition-[border-color,box-shadow] duration-150" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button
            disabled={!name.trim()}
            onClick={() => { onAdd({ id: Date.now().toString(), name: name.trim(), outcome, description }); onClose(); }}
            className={BTN_PRIMARY}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentPickerModal({ agents, selected, onClose, onDone }: {
  agents: Agent[]; selected: string[]; onClose: () => void; onDone: (ids: string[]) => void;
}) {
  const [checked, setChecked] = useState<string[]>(selected);
  const toggle = (id: string) => setChecked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center anim-fade-in" style={{ background: "oklch(0 0 0 / 0.35)" }}>
      <div className="bg-white rounded-2xl w-[420px] p-6 anim-scale-in" style={{ boxShadow: "0 8px 32px oklch(0 0 0 / 0.16), 0 1px 4px oklch(0 0 0 / 0.08)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Select agents</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150 active:scale-[0.9]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="space-y-1 mb-5">
          {agents.map((a) => (
            <button key={a.id} onClick={() => toggle(a.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-[background-color] duration-100 text-left active:scale-[0.98]`}>
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-[background-color,border-color] duration-150 ${checked.includes(a.id) ? "bg-violet-600 border-violet-600" : "border-gray-300"}`}>
                {checked.includes(a.id) && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 3.5-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>}
              </div>
              <AgentTypeIcon type={a.type} size="sm" />
              <span className="text-sm text-gray-800">{a.name}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={() => { onDone(checked); onClose(); }} className={BTN_PRIMARY}>Done</button>
        </div>
      </div>
    </div>
  );
}

function SliderRow({ label, required, subtitle, value, min, max, step, suffix, onChange }: {
  label: string; required?: boolean; subtitle: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 mb-0.5">
        {label} {required && <span className="text-red-400 font-normal">*</span>}
      </h3>
      <p className="text-xs text-gray-400 mb-4">{subtitle}</p>
      <div className="flex items-center gap-4">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1"
          style={{ background: `linear-gradient(to right, #111827 ${pct}%, #e5e7eb ${pct}%)` }}
        />
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden" style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.04)" }}>
          <input
            type="number" min={min} max={max} step={step}
            value={step < 1 ? value.toFixed(2) : value}
            onChange={(e) => onChange(Math.min(max, Math.max(min, parseFloat(e.target.value) || min)))}
            className="w-14 px-2 py-2 text-sm text-right outline-none tabular-nums"
          />
          {suffix && <span className="pr-3 text-sm text-gray-400">{suffix}</span>}
        </div>
      </div>
    </section>
  );
}

function NewScorerForm({ factoryName, agents, onBack, onSave }: {
  factoryName: string; agents: Agent[]; onBack: () => void; onSave: (s: Scorer) => void;
}) {
  const [scorerName, setScorerName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [judgeInstructions, setJudgeInstructions] = useState("");
  const [judgeModel, setJudgeModel] = useState("kimi k2.7 code");
  const [classifications, setClassifications] = useState<ScorerClassification[]>([]);
  const [passThreshold, setPassThreshold] = useState(1.0);
  const [sampleRate, setSampleRate] = useState(75);
  const [selfImprovement, setSelfImprovement] = useState(false);
  const [showClassModal, setShowClassModal] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);

  const selectedAgents = agents.filter((a) => selectedAgentIds.includes(a.id));
  const canSave = scorerName.trim() && selectedAgentIds.length > 0 && judgeInstructions.trim() && classifications.length > 0;

  return (
    <>
      {showClassModal && <ClassificationModal onClose={() => setShowClassModal(false)} onAdd={(c) => setClassifications((p) => [...p, c])} />}
      {showAgentPicker && <AgentPickerModal agents={agents} selected={selectedAgentIds} onClose={() => setShowAgentPicker(false)} onDone={setSelectedAgentIds} />}

      <div className="flex-1 overflow-y-auto anim-fade-in">
        <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <button onClick={onBack} className="hover:text-gray-900 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-[color,background-color] duration-150">{"←"} Scorers</button>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900 font-medium">{scorerName.trim() || "Untitled"}</span>
          </div>
          <button disabled={!canSave} onClick={() => { onSave({ id: Date.now().toString(), name: scorerName.trim(), description, agentIds: selectedAgentIds, judgeInstructions, judgeModel, classifications, passThreshold, sampleRate, selfImprovement }); onBack(); }} className={BTN_SECONDARY}>
            Save
          </button>
        </div>

        <div className="px-10 py-10 max-w-3xl">
          <input value={scorerName} onChange={(e) => setScorerName(e.target.value)} placeholder="Enter scorer name"
            className="text-[28px] font-semibold outline-none border-none bg-transparent w-full mb-10 placeholder-gray-200"
            style={{ color: scorerName ? "#111827" : undefined }} />

          <div className="space-y-10">
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Description</h3>
              <p className="text-xs text-gray-400 mb-3">Summarize what this scorer measures, for anyone browsing your scorers.</p>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder={`E.g. "Checks that agent responses stay concise"`}
                rows={3} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder-gray-300 focus:ring-2 focus:ring-violet-500 transition-[border-color,box-shadow] duration-150" />
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Agent(s) to evaluate <span className="text-red-400 font-normal">*</span></h3>
              <p className="text-xs text-gray-400 mb-3">Select the agents you would like this scorer to apply to.</p>
              {selectedAgents.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedAgents.map((a) => (
                    <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 rounded-lg text-sm text-gray-700">
                      <AgentTypeIcon type={a.type} size="sm" />
                      <span className="text-xs font-medium">{a.name}</span>
                      <button onClick={() => setSelectedAgentIds((p) => p.filter((id) => id !== a.id))} className="text-gray-400 hover:text-gray-600 ml-0.5 transition-[color] duration-100 active:scale-[0.9]">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setShowAgentPicker(true)}
                className={`w-full flex items-center gap-2 border border-dashed border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-[color,border-color] duration-150 ${BTN_PRESS}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                Add agent
              </button>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Judge instructions <span className="text-red-400 font-normal">*</span></h3>
              <p className="text-xs text-gray-400 mb-3">Give the scorer specific instructions on how it should evaluate the agents.</p>
              <textarea value={judgeInstructions} onChange={(e) => setJudgeInstructions(e.target.value)}
                placeholder={`E.g. "You should look specifically for how many tests are being created for new functions"`}
                rows={5} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder-gray-300 focus:ring-2 focus:ring-violet-500 transition-[border-color,box-shadow] duration-150" />
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Judge model <span className="text-red-400 font-normal">*</span></h3>
              <p className="text-xs text-gray-400 mb-3">The model this scorer's judge runs on.</p>
              <div className="relative">
                <select value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)}
                  className="w-full appearance-none px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white cursor-pointer transition-[border-color] duration-150">
                  {JUDGE_MODELS.map((m) => <option key={m}>{m}</option>)}
                </select>
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Classifications <span className="text-red-400 font-normal">*</span></h3>
              <p className="text-xs text-gray-400 mb-3">Define specific criteria that should result in the agent receiving either a passing or failing score.</p>
              {classifications.length > 0 && (
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 mb-2" style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.04)" }}>
                  {classifications.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3 group">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${c.outcome === "pass" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {c.outcome}
                      </span>
                      <span className="text-sm text-gray-800 flex-1 font-medium">{c.name}</span>
                      {c.description && <span className="text-xs text-gray-400 truncate max-w-40">{c.description}</span>}
                      <button onClick={() => setClassifications((p) => p.filter((x) => x.id !== c.id))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-[opacity,color] duration-150 active:scale-[0.9]">
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setShowClassModal(true)}
                className={`w-full flex items-center gap-2 border border-dashed border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-[color,border-color] duration-150 ${BTN_PRESS}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                Add classification
              </button>
            </section>

            <SliderRow label="Pass threshold" required subtitle="Set a score threshold for what counts as a pass (0 to 1)." value={passThreshold} min={0} max={1} step={0.01} onChange={setPassThreshold} />
            <SliderRow label="Sample rate" required subtitle="Select how frequently this scorer should run across all runs involving the selected agents." value={sampleRate} min={0} max={100} step={1} suffix="%" onChange={setSampleRate} />

            <section>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Self-improvement <span className="text-red-400 font-normal">*</span></h3>
                  <p className="text-xs text-gray-400 leading-relaxed">When turned on, Self-improvement will analyze failing runs in order to suggest improvements to your factory.</p>
                </div>
                <Toggle checked={selfImprovement} onChange={() => setSelfImprovement((p) => !p)} />
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

function ScorersPage({ factoryName, agents }: { factoryName: string; agents: Agent[] }) {
  const [scorers, setScorers] = useState<Scorer[]>(MOCK_SCORERS);
  const [view, setView] = useState<"list" | "new">("list");

  const agentLabel = (agentId: string) => {
    const a = agents.find((x) => x.id === agentId);
    if (!a) return agentId;
    return `${factoryName} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)} Agent`;
  };

  if (view === "new") return <NewScorerForm factoryName={factoryName} agents={agents} onBack={() => setView("list")} onSave={(s) => { setScorers((p) => [s, ...p]); setView("list"); }} />;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-gray-700 font-medium">{factoryName}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">Scorers</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-[background-color,color] duration-150">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          <button onClick={() => setView("new")} className={BTN_PRIMARY}>New</button>
        </div>
      </div>

      <div className="px-8 py-2">
        {scorers.map((scorer, i) => {
          const stagger = ["delay-0", "delay-60", "delay-120", "delay-180", "delay-240"][Math.min(i, 4)];
          return (
            <div key={scorer.id}
              className={`group flex items-start gap-4 py-5 border-b border-gray-100 -mx-8 px-8 hover:bg-gray-50 transition-[background-color] duration-100 cursor-pointer anim-fade-in-up ${stagger}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 mb-1">{scorer.name}</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {scorer.classifications.length} outcome classification{scorer.classifications.length !== 1 ? "s" : ""}
                  {scorer.agentIds.length > 0 && <> • {scorer.agentIds.map(agentLabel).join(" • ")}</>}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setScorers((p) => p.filter((s) => s.id !== scorer.id)); }}
                className="mt-0.5 p-1.5 rounded-md text-gray-300 hover:text-red-400 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-[opacity,color,background-color] duration-150 active:scale-[0.9]"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M3 5h10M5.5 5V3.5a.5.5 0 01.5-.5h4a.5.5 0 01.5.5V5M6.5 8v4M9.5 8v4M4 5l.7 7.3a1 1 0 001 .7h4.6a1 1 0 001-.7L12 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: NavPage; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "activity", label: "Activity" },
  { id: "agents", label: "Agents" },
  { id: "automations", label: "Automations" },
  { id: "runs", label: "Runs" },
  { id: "scorers", label: "Scorers" },
  { id: "self-improvement", label: "Self-improvement" },
  { id: "factory-definition", label: "Factory definition" },
  { id: "settings", label: "Settings" },
];

function Sidebar({ factoryName, activePage, onNav }: { factoryName: string; activePage: NavPage; onNav: (p: NavPage) => void }) {
  const initial = factoryName[0]?.toUpperCase() ?? "F";
  const shortName = factoryName.length > 14 ? factoryName.slice(0, 14) + "…" : factoryName;
  return (
    <div className="w-52 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <WarpLogo />
        <div className="flex items-center gap-1.5">
          <button className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          <button className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><rect x="9" y="3" width="5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" /></svg>
          </button>
        </div>
      </div>
      <div className="px-3 py-2 space-y-0.5">
        {[
          { label: "Runs", icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 3h10M1.5 6.5h10M1.5 10h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg> },
          { label: "MCPs and apps", icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" /><rect x="7.5" y="1" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" /><rect x="1" y="7.5" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" /><rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" /></svg> },
          { label: "Secrets", icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.1" /><path d="M4.5 7.5L3.5 12h6l-1-4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></svg> },
          { label: "Integrations", icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 6.5a5 5 0 0110 0M4 9a3 3 0 005 0" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg> },
        ].map((item) => (
          <button key={item.label} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-md transition-[background-color,color] duration-100">
            <span className="text-gray-400">{item.icon}</span>{item.label}
          </button>
        ))}
      </div>
      <div className="px-3 mt-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2">Factories</span>
          <button className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-[color] duration-100">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1.5v8M1.5 5.5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100 transition-[background-color] duration-100">
            <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">{initial}</div>
            <span className="text-xs font-medium text-gray-800 flex-1 truncate">{shortName}</span>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-gray-400 flex-shrink-0"><path d="M2 4l3.5 3.5L9 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </div>
          <div className="mt-0.5 ml-2 pl-3 border-l border-gray-200 space-y-0.5 py-1">
            {NAV_ITEMS.map((item) => (
              <button key={item.id} onClick={() => onNav(item.id)}
                className={`w-full text-left px-2 py-1.5 text-xs rounded-md transition-[background-color,color,font-weight] duration-100 ${activePage === item.id
                  ? "text-gray-900 font-semibold bg-white shadow-sm border border-gray-100"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-auto border-t border-gray-100 px-3 py-3">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-[background-color] duration-100">
          <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-[10px] font-bold text-white" style={{ outline: "1px solid oklch(0 0 0 / 0.1)" }}>U</div>
          <span className="text-xs text-gray-600 truncate flex-1">youruser@example.com</span>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-gray-400"><path d="M2 4l3.5 3.5L9 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </div>
      </div>
    </div>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────────

function MainApp({ factoryName, initialAgents }: { factoryName: string; initialAgents: Agent[] }) {
  const [activePage, setActivePage] = useState<NavPage>("agents");
  const [agents, setAgents] = useState<Agent[]>(initialAgents);

  const renderContent = () => {
    switch (activePage) {
      case "agents":      return <AgentsPage factoryName={factoryName} agents={agents} onAgentsChange={setAgents} />;
      case "activity":    return <ActivityPage factoryName={factoryName} />;
      case "runs":        return <RunsPage factoryName={factoryName} />;
      case "automations": return <AutomationsPage factoryName={factoryName} agents={agents} />;
      case "scorers":     return <ScorersPage factoryName={factoryName} agents={agents} />;
      default:
        return (
          <div className="flex-1 flex flex-col items-center justify-center text-center anim-fade-in">
            <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="3" stroke="#d1d5db" strokeWidth="1.5" /></svg>
            </div>
            <p className="text-sm font-medium text-gray-600">{NAV_ITEMS.find((n) => n.id === activePage)?.label}</p>
            <p className="text-xs text-gray-400 mt-1">Coming soon</p>
          </div>
        );
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      <Sidebar factoryName={factoryName} activePage={activePage} onNav={setActivePage} />
      <div className="flex-1 flex overflow-hidden bg-white">{renderContent()}</div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-1.5 rounded-full flex-1 transition-[background-color] duration-300 ${i < step ? "bg-violet-600" : "bg-gray-200"}`} />
      ))}
    </div>
  );
}

function Shell({ children, onExit, step, total }: { children: React.ReactNode; onExit: () => void; step: number; total: number }) {
  return (
    <div className="min-h-full bg-white flex flex-col">
      <div className="px-6 pt-5 pb-2">
        <button onClick={onExit} className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 ${BTN_PRESS}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>Exit
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center px-6 py-4">
        <div className="w-full max-w-xl"><ProgressBar step={step} total={total} />{children}</div>
      </div>
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 ${BTN_PRESS}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>Back
    </button>
  );
}

function NextBtn({ onClick, disabled = false, label = "Next" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className={BTN_PRIMARY + " disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"}>
      {label}
    </button>
  );
}

const AGENTS_SETUP = [
  { id: "foreman", label: "Foreman", desc: "This is the orchestration agent you interact with directly.", required: true },
  { id: "triage",  label: "Triage",  desc: "Accepts work from issue tracking tools like Jira and Linear.", required: false },
  { id: "spec",    label: "Spec",    desc: "Iterates with your team to produce specs.", required: false },
  { id: "code",    label: "Code",    desc: "Implements issues from you or your triage agent.", required: false },
  { id: "review",  label: "Review",  desc: "Inspects PRs and identifies potential issues.", required: false },
];
const TYPE_MAP: Record<string, Agent["type"]> = { foreman: "foreman", triage: "triage", spec: "spec", code: "implement", review: "review" };

export default function App() {
  const [mode, setMode] = useState<AppMode>("wizard");
  const [step, setStep] = useState<WizardStep>(1);
  const [config, setConfigState] = useState<FactoryConfig>({
    selectedRepo: null, factoryName: "", foremanName: "", description: "",
    agents: { triage: true, spec: true, code: true, review: true },
    trackers: { linear: false, jira: false },
  });

  const setConfig = (p: Partial<FactoryConfig>) => setConfigState((prev) => ({ ...prev, ...p }));
  const goNext = () => setStep((s) => Math.min(s + 1, 6) as WizardStep);
  const goBack = () => setStep((s) => Math.max(s - 1, 1) as WizardStep);

  const factoryName = config.factoryName || "My factory";

  const buildAgents = (): Agent[] =>
    DEFAULT_AGENTS.filter((a) => {
      if (a.type === "foreman")   return true;
      if (a.type === "triage")    return config.agents.triage;
      if (a.type === "spec")      return config.agents.spec;
      if (a.type === "implement") return config.agents.code;
      if (a.type === "review")    return config.agents.review;
      return true;
    });

  if (mode === "app") return <MainApp factoryName={factoryName} initialAgents={buildAgents()} />;

  if (step === 6) {
    const PIPELINE = [
      { num: 1, label: "Triage",  sub: "Understand and route.",   color: "bg-gray-100",    accent: "#9ca3af", items: [] as { icon: string; label: string; desc: string }[] },
      { num: 2, label: "Spec",    sub: "Write and approve.",       color: "bg-orange-50",   accent: "#f97316", items: [{ icon: "agent", label: "Agent", desc: "Drafts a spec for your approval." }] },
      { num: 3, label: "Code",    sub: "Implement and deliver.",   color: "bg-blue-50",     accent: "#3b82f6", items: [{ icon: "github", label: "GitHub", desc: "Receives agent generated PR." }] },
      { num: 4, label: "Review",  sub: "Validate and approve.",    color: "bg-pink-50",     accent: "#ec4899", items: [{ icon: "agent", label: "Agent", desc: "Will review the PR." }] },
    ];
    return (
      <div className="min-h-full bg-white flex flex-col items-center justify-center px-6 py-12">
        <WarpLogo />
        <h1 className="text-2xl font-semibold text-gray-900 mt-6 mb-2 anim-fade-in-up delay-0">Starting up your factory…</h1>
        <p className="text-sm text-gray-400 mb-12 anim-fade-in-up delay-60">This should only take a few moments. Review your factory flow below.</p>
        <div className="w-full max-w-4xl grid grid-cols-4 gap-3 mb-12">
          {PIPELINE.map((stage, idx) => (
            <div key={stage.label} className={`relative rounded-xl p-4 ${stage.color} min-h-48 anim-fade-in-up`} style={{ animationDelay: `${(idx + 2) * 60}ms` }}>
              {idx < 3 && <div className="absolute right-0 top-1/2 translate-x-full -translate-y-1/2 z-10 px-1"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 10h10M12 7l3 3-3 3" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>}
              <div className="flex items-center gap-2 mb-1">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-semibold" style={{ backgroundColor: stage.accent }}>{stage.num}</span>
                <span className="text-sm font-semibold text-gray-800">{stage.label}</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">{stage.sub}</p>
              {stage.items.map((item) => (
                <div key={item.label} className="flex items-start gap-2 bg-white/70 rounded-lg p-2.5" style={{ outline: "1px solid oklch(0 0 0 / 0.06)", outlineOffset: "-1px" }}>
                  <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                    {item.icon === "github" ? <GithubIcon size={13} className="text-gray-700" /> : <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="3.5" width="10" height="7" rx="2" stroke="#6b7280" strokeWidth="1.2" /><path d="M4.5 3.5V3a2 2 0 014 0v.5" stroke="#6b7280" strokeWidth="1.2" strokeLinecap="round" /></svg>}
                  </div>
                  <div><p className="text-xs font-medium text-gray-700">{item.label}</p><p className="text-xs text-gray-400 leading-snug">{item.desc}</p></div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <button onClick={() => setMode("app")} className={BTN_PRIMARY + " px-6 py-2.5"}>Open factory</button>
      </div>
    );
  }

  return (
    <Shell onExit={() => setStep(1)} step={step} total={5}>
      {step === 1 && (
        <div className="anim-fade-in-up">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Connect your code host</h1>
          <p className="text-sm text-gray-500 mb-7 leading-relaxed">Warp will connect to your code host so that you can select which repos you want to use in your factory.</p>
          <button onClick={goNext} className={`w-full flex items-center gap-4 px-5 py-4 border border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 text-left ${BTN_PRESS}`} style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)" }}>
            <GithubIcon size={32} className="text-gray-900" />
            <div>
              <p className="text-sm font-semibold text-gray-900">I want to use repos from GitHub</p>
              <p className="text-xs text-gray-400 mt-0.5">Connected as youruser</p>
            </div>
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="anim-fade-in-up">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Select a repository</h1>
          <p className="text-sm text-gray-500 mb-7 leading-relaxed">Pick the GitHub repository you want to use for this factory.</p>
          <div className="border border-gray-200 rounded-xl overflow-hidden mb-6 divide-y divide-gray-100" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
            {MOCK_REPOS.map((repo) => {
              const isSel = config.selectedRepo?.id === repo.id;
              return (
                <button key={repo.id} onClick={() => setConfig({ selectedRepo: repo })}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-[background-color] duration-100 active:scale-[0.99] ${isSel ? "bg-gray-900" : "hover:bg-gray-50"}`}>
                  <GithubIcon size={15} className={isSel ? "text-white" : "text-gray-700"} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isSel ? "text-white" : "text-gray-800"}`}>{repo.owner}/{repo.name}</p>
                    <p className={`text-xs mt-0.5 ${isSel ? "text-gray-300" : "text-gray-400"}`}>{repo.language} · {repo.updatedAt}</p>
                  </div>
                  {isSel && <span className="text-xs text-violet-400">Selected</span>}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between"><BackBtn onClick={goBack} /><NextBtn onClick={goNext} disabled={!config.selectedRepo} /></div>
        </div>
      )}
      {step === 3 && (
        <div className="anim-fade-in-up">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Give your factory some personality</h1>
          <p className="text-sm text-gray-500 mb-7">Create a custom name for your factory as well as an optional avatar.</p>
          <div className="border border-gray-200 rounded-xl p-5 mb-6 space-y-5" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
            {[
              { key: "factoryName" as const, label: "Factory name", placeholder: 'E.g. "Main factory"', hint: "This is the name that you will see in Warp Factories." },
              { key: "foremanName" as const, label: "Foreman name", placeholder: 'E.g. "main-factory"', hint: "This is the name you will use to @-mention your factory foreman." },
            ].map(({ key, label, placeholder, hint }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
                <input type="text" placeholder={placeholder} value={config[key]} onChange={(e) => setConfig({ [key]: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 transition-[border-color,box-shadow] duration-150" />
                <p className="text-xs text-gray-400 mt-1.5">{hint}</p>
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
              <p className="text-xs text-gray-400 mb-2">A short description of what this factory does.</p>
              <textarea placeholder="E.g. Owns the checkout service and its bug backlog" value={config.description} onChange={(e) => setConfig({ description: e.target.value })}
                rows={3} className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 resize-none transition-[border-color,box-shadow] duration-150" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Add an avatar <span className="text-gray-400 font-normal">(optional)</span></label>
              <p className="text-xs text-gray-400 mb-2">We will use this avatar for your factory list in Warp Factories.</p>
              <button className={`w-12 h-12 border border-dashed border-gray-300 rounded-xl flex items-center justify-center text-gray-300 hover:border-gray-400 transition-[border-color,color] duration-150 active:scale-[0.96]`}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="1.5" y="3.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" /><circle cx="6" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.4" /><path d="M1.5 12.5l4-3 3 3 2.5-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
          <div className="flex justify-between"><BackBtn onClick={goBack} /><NextBtn onClick={goNext} disabled={!config.factoryName.trim()} /></div>
        </div>
      )}
      {step === 4 && (
        <div className="anim-fade-in-up">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Configure your agents</h1>
          <p className="text-sm text-gray-500 mb-7 leading-relaxed">Determine which agents should be in your factory. Your Foreman requires at least one subagent for the factory to work.</p>
          <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 mb-6" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
            {AGENTS_SETUP.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-4 py-4">
                <AgentTypeIcon type={TYPE_MAP[a.id] ?? "custom"} size="sm" />
                <div className="flex-1"><p className="text-sm font-medium text-gray-900">{a.label}</p><p className="text-xs text-gray-400 mt-0.5">{a.desc}</p></div>
                {a.required ? <span className="text-xs text-gray-400 mt-1">Required</span>
                  : <Toggle checked={config.agents[a.id as keyof FactoryConfig["agents"]]} onChange={() => setConfig({ agents: { ...config.agents, [a.id]: !config.agents[a.id as keyof FactoryConfig["agents"]] } })} />}
              </div>
            ))}
          </div>
          <div className="flex justify-between"><BackBtn onClick={goBack} /><NextBtn onClick={goNext} /></div>
        </div>
      )}
      {step === 5 && (
        <div className="anim-fade-in-up">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Connect your issue trackers</h1>
          <p className="text-sm text-gray-500 mb-7">Give your factory access to your issue trackers.</p>
          <div className="space-y-3 mb-6">
            {[
              { id: "linear" as const, name: "Linear", desc: "Connect Linear to bring issues into your factory.", icon: <LinearIcon size={28} /> },
              { id: "jira" as const, name: "Jira", desc: "Connect Jira to bring issues into your factory.", icon: <JiraIcon size={28} /> },
            ].map((t) => (
              <div key={t.id} className="flex items-center gap-4 border border-gray-200 rounded-xl px-4 py-4" style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.05)" }}>
                <div className="w-10 h-10 flex items-center justify-center">{t.icon}</div>
                <div className="flex-1"><p className="text-sm font-medium text-gray-900">{t.name}</p><p className="text-xs text-gray-400 mt-0.5">{t.desc}</p></div>
                <button onClick={() => setConfig({ trackers: { ...config.trackers, [t.id]: !config.trackers[t.id] } })}
                  className={`px-4 py-1.5 text-sm rounded-lg border font-medium transition-[background-color,border-color,color] duration-150 active:scale-[0.96] ${config.trackers[t.id] ? "bg-violet-600 border-violet-600 text-white hover:bg-violet-700" : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"}`}>
                  {config.trackers[t.id] ? "Connected" : "Connect"}
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-between"><BackBtn onClick={goBack} /><NextBtn onClick={goNext} label="Finish" /></div>
        </div>
      )}
    </Shell>
  );
}
