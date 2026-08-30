// Quickstart wizard — SRP: pure seven-step state machine and validation.
// OCP: add a step in QUICKSTART_STEPS and STEP_COPY without changing React.
// Source: WarpFactories.md §14 "Quickstart conceptual" · US-142, US-143, US-144

import { ParseResult } from "./result";
import {
  AGENT_TOGGLE_KEYS,
  DEFAULT_AGENT_TOGGLES,
  validateFactoryAlias,
  validateFactoryName,
} from "./factory.record";
import type { AgentToggleKey, CreateFactoryInput, FactoryRecord } from "./factory.record";
import type { CreateWorkItemInput } from "./workItem.types";
import type { RepositoryRef } from "./types";
import { createForemanDecision } from "./workItem.rules";
import { VERBATIM_FIRST_WORK_ITEM } from "./quickstart.data";

export const QUICKSTART_STEPS = ["source", "repos", "identity", "slack", "agents", "tracker", "review"] as const;
export type QuickstartStep = (typeof QUICKSTART_STEPS)[number];

export interface QuickstartState {
  readonly stepIndex: number;
  readonly provider: "github" | "gitlab";
  readonly repos: readonly RepositoryRef[];
  readonly name: string;
  readonly alias: string;
  readonly aliasTouched: boolean;
  readonly slack: boolean;
  readonly agents: Readonly<Record<AgentToggleKey, boolean>>;
  readonly tracker: "none" | "linear" | "jira";
  readonly useMcpOnboarding: boolean;
}

export type QuickstartAction =
  | { type: "back" }
  | { type: "next" }
  | { type: "goto"; step: number }
  | { type: "reset" }
  | { type: "setProvider"; provider: QuickstartState["provider"] }
  | { type: "toggleRepo"; repo: RepositoryRef }
  | { type: "setName"; name: string }
  | { type: "setAlias"; alias: string }
  | { type: "toggleSlack" }
  | { type: "toggleAgent"; agent: AgentToggleKey }
  | { type: "setTracker"; tracker: QuickstartState["tracker"] }
  | { type: "setUseMcpOnboarding"; value: boolean };

export function initialQuickstartState(): QuickstartState {
  return {
    stepIndex: 0,
    provider: "github",
    repos: [],
    name: "",
    alias: "",
    aliasTouched: false,
    slack: false,
    agents: { ...DEFAULT_AGENT_TOGGLES },
    tracker: "none",
    useMcpOnboarding: false,
  };
}

export function quickstartReducer(s: QuickstartState, a: QuickstartAction): QuickstartState {
  switch (a.type) {
    case "back":
      return { ...s, stepIndex: Math.max(0, s.stepIndex - 1) };
    case "next":
      return isStepComplete(s) ? { ...s, stepIndex: Math.min(QUICKSTART_STEPS.length - 1, s.stepIndex + 1) } : s;
    case "goto":
      return a.step >= 0 && a.step < QUICKSTART_STEPS.length && a.step <= s.stepIndex ? { ...s, stepIndex: a.step } : s;
    case "reset":
      return initialQuickstartState();
    case "setProvider":
      return { ...s, provider: a.provider };
    case "toggleRepo": {
      const index = s.repos.findIndex((repo) => repo.owner === a.repo.owner && repo.name === a.repo.name);
      if (index >= 0) return { ...s, repos: s.repos.filter((_, repoIndex) => repoIndex !== index) };
      const repos = s.repos.length < 2 ? [...s.repos, a.repo] : [s.repos[1], a.repo];
      return { ...s, repos };
    }
    case "setName":
      return { ...s, name: a.name, alias: s.aliasTouched ? s.alias : a.name };
    case "setAlias":
      return { ...s, alias: a.alias, aliasTouched: true };
    case "toggleSlack":
      return { ...s, slack: !s.slack };
    case "toggleAgent": {
      if (a.agent === "implement") return { ...s, agents: { ...s.agents, implement: true } };
      const enabledCount = AGENT_TOGGLE_KEYS.filter((agent) => s.agents[agent]).length;
      if (s.agents[a.agent] && enabledCount <= 1) return s;
      return { ...s, agents: { ...s.agents, [a.agent]: !s.agents[a.agent] } };
    }
    case "setTracker":
      return { ...s, tracker: a.tracker };
    case "setUseMcpOnboarding":
      return { ...s, useMcpOnboarding: a.value };
    default:
      return s;
  }
}

export function validateStep(s: QuickstartState, existing: readonly FactoryRecord[] = []): ParseResult<QuickstartState> {
  const step = QUICKSTART_STEPS[s.stepIndex];
  if (!step) return ParseResult.singleFail("stepIndex", "Paso de quickstart inválido", "invalid_step");
  if (s.useMcpOnboarding) return ParseResult.ok(s);
  const issues = [];
  if (step === "repos" && (s.repos.length < 1 || s.repos.length > 2)) {
    issues.push({ path: "repos", message: "Elegí uno o dos repositorios", code: "repos_count" });
  }
  if (step === "identity") {
    const nameResult = validateFactoryName(s.name.trim(), existing);
    const aliasResult = validateFactoryAlias(s.alias.trim(), existing);
    for (const issue of nameResult.issues) issues.push({ path: "name", message: issue.message, code: issue.code });
    for (const issue of aliasResult.issues) issues.push({ path: "alias", message: issue.message, code: issue.code });
  }
  if (step === "agents") {
    const enabled = AGENT_TOGGLE_KEYS.filter((agent) => s.agents[agent]);
    if (enabled.length === 0) issues.push({ path: "agents", message: "Mantené al menos un agente activo", code: "agents_required" });
    if (!s.agents.implement) issues.push({ path: "agents.implement", message: "Implement debe permanecer activo", code: "implement_required" });
  }
  return issues.length === 0 ? ParseResult.ok(s) : ParseResult.fail(issues);
}

export function isStepComplete(s: QuickstartState): boolean {
  return validateStep(s).ok;
}

export function isLastStep(s: QuickstartState): boolean {
  return s.stepIndex === QUICKSTART_STEPS.length - 1;
}

export function toCreateFactoryInput(s: QuickstartState): CreateFactoryInput {
  const integrations = [
    ...(s.slack ? (["slack"] as const) : []),
    ...(s.tracker === "none" ? [] : [s.tracker]),
  ];
  return {
    name: s.name.trim(),
    alias: s.alias.trim(),
    repositories: s.repos,
    integrations,
    agentToggles: s.agents,
  };
}

export function toFirstWorkItemInput(s: QuickstartState): CreateWorkItemInput {
  return {
    factoryName: s.name.trim(),
    title: VERBATIM_FIRST_WORK_ITEM,
    source: "direct",
    createdBy: "Benjamin Holmes",
    foremanDecision: createForemanDecision({ title: VERBATIM_FIRST_WORK_ITEM }),
  };
}

export function progressLabel(s: QuickstartState): string {
  const index = Math.min(Math.max(s.stepIndex, 0), QUICKSTART_STEPS.length - 1);
  const titles: Readonly<Record<QuickstartStep, string>> = {
    source: "Proveedor",
    repos: "Repositorios",
    identity: "Identidad",
    slack: "Slack",
    agents: "Agentes",
    tracker: "Tracker",
    review: "Revisión",
  };
  return `Paso ${index + 1} de ${QUICKSTART_STEPS.length} · ${titles[QUICKSTART_STEPS[index]]}`;
}
