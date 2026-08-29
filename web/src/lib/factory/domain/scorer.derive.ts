import type { ScorerDefinition, ScorerLabel } from "./types";

// Pure, SRP — no I/O, no mutation
export const DEFAULT_SAMPLING_RATE = 25;

export function getEffectiveSamplingRate(scorer: ScorerDefinition): number {
  return scorer.samplingRate ?? DEFAULT_SAMPLING_RATE;
}

export function isAutoScoringEnabled(scorer: ScorerDefinition): boolean {
  return getEffectiveSamplingRate(scorer) !== 0;
}

export function getSamplingStatus(scorer: ScorerDefinition): string {
  const rate = getEffectiveSamplingRate(scorer);
  if (rate === 0) return "Stopped — auto scoring off (0%)";
  if (rate === 100) return "Full — 100% of eligible runs";
  if (rate === DEFAULT_SAMPLING_RATE && scorer.samplingRate === undefined) return "Default — 25% of eligible runs";
  return `Sampling — ${rate}% of eligible runs`;
}

export function isLabelPassing(label: ScorerLabel, passingScore: number): boolean {
  return label.score >= passingScore;
}

export function getPassingLabels(scorer: ScorerDefinition): ScorerLabel[] {
  return scorer.labels.filter((l) => isLabelPassing(l, scorer.passingScore));
}

export function getFailingLabels(scorer: ScorerDefinition): ScorerLabel[] {
  return scorer.labels.filter((l) => !isLabelPassing(l, scorer.passingScore));
}

export function isScorerInvariantValid(scorer: ScorerDefinition): boolean {
  return getPassingLabels(scorer).length >= 1 && getFailingLabels(scorer).length >= 1;
}

export function hasAgents(scorer: ScorerDefinition): boolean {
  return Array.isArray(scorer.agents) && scorer.agents.length >= 1;
}

export function hasModel(scorer: ScorerDefinition): boolean {
  return typeof scorer.model === "string" && scorer.model.trim().length > 0;
}

export function hasRubric(scorer: ScorerDefinition): boolean {
  return typeof scorer.rubric === "string" && scorer.rubric.trim().length > 0;
}

export function getOutputValue(scorer: ScorerDefinition): string {
  return scorer.output ?? "classification";
}

export function isSelfImprovementEnabled(scorer: ScorerDefinition): boolean {
  return scorer.selfImprovement === true;
}

export interface ScorerDerived {
  effectiveSamplingRate: number;
  autoScoringEnabled: boolean;
  samplingStatus: string;
  passingLabels: ScorerLabel[];
  failingLabels: ScorerLabel[];
  invariantValid: boolean;
  hasAgents: boolean;
  hasModel: boolean;
  hasRubric: boolean;
  outputValue: string;
  selfImprovement: boolean;
}

export function deriveScorer(scorer: ScorerDefinition): ScorerDerived {
  return {
    effectiveSamplingRate: getEffectiveSamplingRate(scorer),
    autoScoringEnabled: isAutoScoringEnabled(scorer),
    samplingStatus: getSamplingStatus(scorer),
    passingLabels: getPassingLabels(scorer),
    failingLabels: getFailingLabels(scorer),
    invariantValid: isScorerInvariantValid(scorer),
    hasAgents: hasAgents(scorer),
    hasModel: hasModel(scorer),
    hasRubric: hasRubric(scorer),
    outputValue: getOutputValue(scorer),
    selfImprovement: isSelfImprovementEnabled(scorer),
  };
}

export function classifyLabel(label: ScorerLabel, passingScore: number): "pass" | "fail" {
  return isLabelPassing(label, passingScore) ? "pass" : "fail";
}
