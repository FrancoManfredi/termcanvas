import { describe, it, expect, beforeEach } from "vitest";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine } from "../domain/workItem.machine";

describe("activity — Created by=you + includeTerminals + filters (O15)", () => {
  let store: WorkItemStore;

  beforeEach(() => {
    WorkItemStore._resetIdSeq();
    WorkItemMachine._resetCounter();
    store = new WorkItemStore(new WorkItemMachine(), ["payments-factory"]);
  });

  it("includeTerminals false oculta Complete/Cancelled", () => {
    const a = store.create({ factoryName: "payments-factory", title: "Active", source: "github_issue", createdBy: "you" }).getOrThrow();
    const b = store.create({ factoryName: "payments-factory", title: "Will complete", source: "github_issue", createdBy: "you", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true, reason: "test" } }).getOrThrow();
    store.transition(b.id, "Reviewing", "implement");
    store.transition(b.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true });
    const activeOnly = store.list({ includeTerminals: false });
    expect(activeOnly.some((w) => w.id === a.id)).toBe(true);
    expect(activeOnly.some((w) => w.id === b.id)).toBe(false);
    const withTerminals = store.list({ includeTerminals: true });
    expect(withTerminals.some((w) => w.id === b.id)).toBe(true);
  });

  it("Created by=you filtra solo items de you", () => {
    store.create({ factoryName: "payments-factory", title: "Mine", source: "github_issue", createdBy: "you" });
    store.create({ factoryName: "payments-factory", title: "Other", source: "github_issue", createdBy: "alice" });
    const mine = store.list({ createdBy: "you", includeTerminals: true });
    expect(mine.length).toBe(1);
    expect(mine[0].title).toBe("Mine");
  });
});
