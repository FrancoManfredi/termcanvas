import type { ScorerDefinition, ScorerLabel } from "./types";
import { ParseResult } from "./result";

// Pure, SRP — no I/O, no mutation
// Source: WarpFactories.md §13 · US-109..112 · T13
export const DEFAULT_SAMPLING_RATE = 25;
export const ALLOWED_SAMPLING_RATES = [0, 25] as const;

export function validateScorerDefinition(scorer: ScorerDefinition): ParseResult<ScorerDefinition> {
  const file = scorer.rawPath || "scorers/unknown/scorer.md";
  // invariante: ≥1 ≥passing y ≥1 <passing — code testeable scorer_invariant con file:line
  if (!isScorerInvariantValid(scorer)) {
    return ParseResult.singleFail(
      `${file}:4 — labels`,
      "≥1 label con score ≥ passingScore y ≥1 con score < passingScore",
      "scorer_invariant"
    );
  }
  // samplingRate solo 0 o 25 (default 25) — 0 = stop auto pero on-demand sigue
  if (scorer.samplingRate !== undefined && scorer.samplingRate !== 0 && scorer.samplingRate !== 25) {
    return ParseResult.singleFail(
      `${file}:7 — samplingRate`,
      "samplingRate solo 0 o 25 (default 25)",
      "samplingRate_invalid"
    );
  }
  // threshold solo display — no bloquea scoring, re-score reemplaza
  return ParseResult.ok(scorer);
}

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
