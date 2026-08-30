// Foreman routing rules — SRP: only predicates, no state mutations
// WarpFactories.md §3: skip logic + human gates
import type { ForemanDecision } from "./workItem.types";


// Heurística simple para v1 — extensible sin modificar machine (OCP)
export function decideSkipTriage(input: { title: string; description?: string; labels?: string[] }): boolean {
  const text = `${input.title} ${input.description ?? ""}`.toLowerCase();
  const hasEvidence = text.includes("repro") || text.includes("evidence") || text.includes("scope");
  const hasScope = input.labels?.includes("factory-ready") || text.includes("what to change");
  const result = hasEvidence && hasScope;
  return result;
}

export function decideSkipPlanning(input: { labels?: string[]; changedLines?: number; title?: string }): boolean {
  const trivialLabels = ["trivial", "docs", "chore", "typo"];
  const hasTrivialLabel = input.labels?.some((l) => trivialLabels.includes(l));
  if (hasTrivialLabel) {
    return true;
  }
  if (input.changedLines !== undefined && input.changedLines < 100) {
    return true;
  }
  return false;
}

export function createForemanDecision(input: { title: string; description?: string; labels?: string[]; changedLines?: number }): ForemanDecision {
  const shouldSkipTriage = decideSkipTriage(input);
  const shouldSkipPlanning = decideSkipPlanning(input);
  const decision = {
    shouldSkipTriage,
    shouldSkipPlanning,
    reason: `triage:${shouldSkipTriage ? "skip" : "keep"} planning:${shouldSkipPlanning ? "skip" : "keep"}`,
  };
  return decision;
}

export function isHumanGateBlocking(stage: string, humanApproval?: string): boolean {
  if (stage !== "Planning") return false;
  const blocking = humanApproval !== "approved";
  return blocking;
}
