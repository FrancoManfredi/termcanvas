import type { Repo } from "../../lib/factory/fixtures/figma.fixtures";

export type AppMode = "wizard" | "app";
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface FactoryConfig {
  selectedRepo: Repo | null;
  factoryName: string;
  foremanName: string;
  description: string;
  agents: { triage: boolean; spec: boolean; code: boolean; review: boolean };
  trackers: { linear: boolean; jira: boolean };
}
