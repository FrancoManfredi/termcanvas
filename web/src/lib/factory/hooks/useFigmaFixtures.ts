// useFigmaFixtures — DIP facade.
// Los componentes consumen SOLO estos hooks; NUNCA importan MOCK_* directamente.
// El dato ahora fluye por CollectionPort (adaptador respaldado por fixtures), de modo que
// la fuente puede intercambiarse por un backend real sin tocar ningún componente.
// Los repos usan además el port REAL GitHubReposPort (LocalGitHubReposAdapter) con fallback de fixtures.

import { DEFAULT_AGENTS, JUDGE_MODELS, STAGE_META, AGENTS_SETUP, PIPELINE, TYPE_MAP } from "../fixtures/figma.fixtures";
import type { Repo, Agent, WorkItem, Run, Automation, Scorer } from "../fixtures/figma.fixtures";
import { useCollection } from "./useCollection";
import { agentsPort, runsPort, automationsPort, scorersPort, workItemsPort } from "../fixtures/figma.ports";
import { useRepoList } from "./useGitHubRepos";

// ─── Datos vía port (intercambiable por backend real) ───────────────────────
export function useFigmaRepos(): readonly Repo[] {
  return useRepoList();
}
export function useFigmaAgents(): readonly Agent[] {
  return useCollection(agentsPort);
}
export function useFigmaWorkItems(): readonly WorkItem[] {
  return useCollection(workItemsPort);
}
export function useFigmaRuns(): readonly Run[] {
  return useCollection(runsPort);
}
export function useFigmaAutomations(): readonly Automation[] {
  return useCollection(automationsPort);
}
export function useFigmaScorers(): readonly Scorer[] {
  return useCollection(scorersPort);
}

// ─── Config / constantes de producto (no son datos mock) ────────────────────
export { DEFAULT_AGENTS, JUDGE_MODELS, STAGE_META, AGENTS_SETUP, PIPELINE, TYPE_MAP };
export type { Repo, Agent, WorkItem, Run, Automation, Scorer };
