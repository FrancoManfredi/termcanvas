import type { CreateWorkItemInput, WorkItem } from "../domain/workItem.types";

// Deterministic fixtures — SRP: only data

let workItemSeq = 0;

export function sampleWorkItem(overrides: Partial<CreateWorkItemInput & { id: string; stage: WorkItem["stage"] }> = {}): CreateWorkItemInput & { id?: string; stage?: WorkItem["stage"] } {
  workItemSeq += 1;
  return {
    factoryName: "payments-factory",
    title: `Sample work item ${workItemSeq}`,
    description: "Fix checkout flow",
    source: "github_issue",
    sourceRef: `https://github.com/acme/payments/issues/${100 + workItemSeq}`,
    createdBy: "ben",
    ...overrides,
  };
}

export function resetWorkItemSampleSeq() {
  workItemSeq = 0;
}
