import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine } from "../domain/workItem.machine";

describe("activity.live — O18 Activity contra backend", () => {
  let store: WorkItemStore;

  beforeEach(() => {
    WorkItemStore._resetIdSeq();
    WorkItemMachine._resetCounter();
    store = new WorkItemStore(new WorkItemMachine(), ["payments-factory"]);
    vi.clearAllMocks();
    if (typeof window !== "undefined") window.localStorage.clear();
  });

  it("por defecto solo active sin terminales", () => {
    for (let i = 0; i < 4; i++) store.create({ factoryName: "payments-factory", title: `Active ${i}`, source: "github_issue", createdBy: "you" });
    const activeOnly = store.list({ createdBy: "you", includeTerminals: false });
    expect(activeOnly.length).toBe(4);
  });
});
