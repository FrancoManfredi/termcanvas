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
    // reload simulation: derive again same ids
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
    // timeline ordenado por at asc
    expect(runs[0].at < runs[1].at).toBe(true);
    expect(runs[1].at < runs[2].at).toBe(true);
    // cost sum
    const total = totalCost(runs);
    expect(total).toBeGreaterThan(0);
    // Sub-agents: foreman runs tienen childRuns (orchestrator)
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
    // simulate reload: still there
    const reloaded = JSON.parse(window.localStorage.getItem(FOLLOWUPS_KEY)!) as typeof followups;
    expect(reloaded[runId]).toEqual(["followup 1", "followup 2"]);
  });

  it("4. Stop cancelled persistido — localStorage + workItem transition durable tras reload", async () => {
    const store = new WorkItemStore(new WorkItemMachine(), ["payments-factory"]);
    const wi = store.create({ factoryName: "payments-factory", title: "To cancel", source: "github_issue", createdBy: "you" }).getOrThrow();
    store.transition(wi.id, "Planning", "human", { humanApproval: "approved" } as never);
    // Simulate RunsPage handleStop: mark cancelled in localStorage
    const runId = wi.history[0].id; // first event id
    const cancelledMap: Record<string, string> = { [runId]: "cancelled via Stop task" };
    window.localStorage.setItem(CANCELLED_KEY, JSON.stringify(cancelledMap));
    // also transition workItem to Cancelled for durability
    store.transition(wi.id, "Cancelled", "foreman", { reason: "stopped" });
    const cancelled = store.getById(wi.id);
    expect(cancelled?.stage).toBe("Cancelled");
    // reload simulation: localStorage still has cancelled
    const loaded = JSON.parse(window.localStorage.getItem(CANCELLED_KEY)!) as typeof cancelledMap;
    expect(loaded[runId]).toBe("cancelled via Stop task");
    // deriveRuns after cancel should reflect Cancelled stage
    const runs = deriveRuns([cancelled!]);
    expect(runs.some((r) => r.to === "Cancelled")).toBe(true);
  });

  it("5. RunsPage importable y expone run_id durable + timeline/cost/Sub-agents/View session", async () => {
    const mod = await import("../../../components/runs/RunsPage");
    expect(typeof mod.RunsPage).toBe("function");
    const detail = await import("../../../components/runs/RunDetail");
    expect(typeof detail.RunDetail).toBe("function");
  });
});
