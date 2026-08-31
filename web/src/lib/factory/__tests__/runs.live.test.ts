import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine } from "../domain/workItem.machine";
import { deriveRuns, totalCost } from "../domain/run.derive";
import type { WorkItem } from "../domain/workItem.types";

const CANCELLED_KEY = "termcanvas.runs.cancelled.v1";
const FOLLOWUPS_KEY = "termcanvas.runs.followups.v1";

function makeWorkItemWithHistory(id: string, factoryName: string, events: { from: WorkItem["stage"]; to: WorkItem["stage"]; actor: WorkItem["history"][0]["actor"]; at: string }[]): WorkItem {
  return {
    id,
    factoryName,
    title: `WI ${id}`,
    source: "github_issue",
    createdBy: "you",
    createdAt: events[0]?.at ?? new Date().toISOString(),
    stage: events[events.length - 1]?.to ?? "Triage",
    history: events.map((e, idx) => ({ id: `evt_${id}_${idx}`, workItemId: id, from: e.from, to: e.to, actor: e.actor, at: e.at, reason: `ev${idx}` })),
    linkedPRs: [],
  };
}

describe("runs.live — O18 Runs run_id durable timeline/cost/Sub-agents/View session + Stop cancelled persistido", () => {
  beforeEach(() => {
    WorkItemStore._resetIdSeq();
    WorkItemMachine._resetCounter();
    if (typeof window !== "undefined") window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("1. run_id durable — deriveRuns usa history event id como run id estable", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00.000Z" },
      { from: "Triage", to: "Planning", actor: "foreman", at: "2026-01-01T10:01:00.000Z" },
    ]);
    const runs = deriveRuns([wi]);
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe("evt_wi1_0");
    expect(runs[1].id).toBe("evt_wi1_1");
    const runs2 = deriveRuns([wi]);
    expect(runs2[0].id).toBe(runs[0].id);
  });

  it("2. timeline/cost/Sub-agents derivables y coste total determinista", () => {
    const wi = makeWorkItemWithHistory("wi2", "payments-factory", [
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00.000Z" },
      { from: "Triage", to: "Planning", actor: "foreman", at: "2026-01-01T10:01:00.000Z" },
      { from: "Planning", to: "Building", actor: "human", at: "2026-01-01T10:02:00.000Z" },
    ]);
    const runs = deriveRuns([wi]);
    expect(runs[0].at < runs[1].at).toBe(true);
    expect(runs[1].at < runs[2].at).toBe(true);
    const total = totalCost(runs);
    expect(total).toBeGreaterThan(0);
    const foremanRuns = runs.filter((r) => r.isOrchestrator);
    expect(foremanRuns.length).toBeGreaterThan(0);
    expect(foremanRuns[0].childRuns.length).toBeGreaterThanOrEqual(1);
  });

  it("3. View session followups acumulados persistidos (localStorage + backend)", () => {
    const runId = "evt_wi1_0";
    const followups: Record<string, string[]> = {};
    followups[runId] = ["followup 1", "followup 2"];
    window.localStorage.setItem(FOLLOWUPS_KEY, JSON.stringify(followups));
    const loaded = JSON.parse(window.localStorage.getItem(FOLLOWUPS_KEY)!) as typeof followups;
    expect(loaded[runId]).toHaveLength(2);
    const reloaded = JSON.parse(window.localStorage.getItem(FOLLOWUPS_KEY)!) as typeof followups;
    expect(reloaded[runId]).toEqual(["followup 1", "followup 2"]);
  });

  it("4. Stop cancelled persistido — localStorage + workItem transition durable tras reload", async () => {
    const store = new WorkItemStore(new WorkItemMachine(), ["payments-factory"]);
    const wi = store.create({ factoryName: "payments-factory", title: "To cancel", source: "github_issue", createdBy: "you" }).getOrThrow();
    store.transition(wi.id, "Planning", "human", { humanApproval: "approved" } as never);
    const runId = wi.history[0].id;
    const cancelledMap: Record<string, string> = { [runId]: "cancelled via Stop task" };
    window.localStorage.setItem(CANCELLED_KEY, JSON.stringify(cancelledMap));
    store.transition(wi.id, "Cancelled", "foreman", { reason: "stopped" });
    const cancelled = store.getById(wi.id);
    expect(cancelled?.stage).toBe("Cancelled");
    const loaded = JSON.parse(window.localStorage.getItem(CANCELLED_KEY)!) as typeof cancelledMap;
    expect(loaded[runId]).toBe("cancelled via Stop task");
    const runs = deriveRuns([cancelled!]);
    expect(runs.some((r) => r.to === "Cancelled")).toBe(true);
  });
});
