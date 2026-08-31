import {
  MOCK_REPOS,
  DEFAULT_AGENTS,
  MOCK_WORK_ITEMS,
  MOCK_RUNS,
  MOCK_AUTOMATIONS,
  MOCK_SCORERS,
  JUDGE_MODELS,
  STAGE_META,
  AGENTS_SETUP,
  PIPELINE,
  TYPE_MAP,
} from "../fixtures/figma.fixtures";
import type { Repo, Agent, WorkItem, Run, Automation, Scorer } from "../fixtures/figma.fixtures";

export function useFigmaRepos(): readonly Repo[] {
  return MOCK_REPOS;
}

export function useFigmaAgents(): readonly Agent[] {
  return DEFAULT_AGENTS;
}

export function useFigmaWorkItems(): readonly WorkItem[] {
  return MOCK_WORK_ITEMS;
}

export function useFigmaRuns(): readonly Run[] {
  return MOCK_RUNS;
}

export function useFigmaAutomations(): readonly Automation[] {
  return MOCK_AUTOMATIONS;
}

export function useFigmaScorers(): readonly Scorer[] {
  return MOCK_SCORERS;
}

export { JUDGE_MODELS, STAGE_META, AGENTS_SETUP, PIPELINE, TYPE_MAP };
export type { Repo, Agent, WorkItem, Run, Automation, Scorer };
