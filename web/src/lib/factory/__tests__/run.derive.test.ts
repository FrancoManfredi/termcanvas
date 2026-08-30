import { describe, it, expect, beforeEach } from "vitest";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine, resetWorkItemMachineCounter } from "../domain/workItem.machine";
import { deriveRuns, deriveRunsForWorkItem, filterRuns, getFactoryRuns, getTeamRuns, groupRunsByWorkItem, totalCost, costForActor, timelineForWorkItem, getRunById } from "../domain/run.derive";
import type { WorkItem } from "../domain/workItem.types";

function makeWorkItemWithHistory(id: string, factoryName: string, events: { from: WorkItem["stage"]; to: WorkItem["stage"]; actor: WorkItem["history"][0]["actor"]; at: string }[]): WorkItem {
  return {
    id,
    factoryName,
    title: `WI ${id}`,
    source: "github_issue",
    createdBy: "ben",
    createdAt: events[0]?.at ?? new Date().toISOString(),
    stage: events[events.length - 1]?.to ?? "Triage",
    history: events.map((e, idx) => ({ id: `evt_${id}_${idx}`, workItemId: id, from: e.from, to: e.to, actor: e.actor, at: e.at, reason: `ev${idx}` })),
    linkedPRs: [],
  };
}

describe("run.derive", () => {
  beforeEach(() => {
    WorkItemMachine._resetCounter();
    resetWorkItemMachineCounter();
    WorkItemStore._resetIdSeq();
  });

  it("1. 1 work item con 3 events -> 3 runs", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00.000Z" },
      { from: "Triage", to: "Planning", actor: "foreman", at: "2026-01-01T10:01:00.000Z" },
      { from: "Planning", to: "Building", actor: "foreman", at: "2026-01-01T10:02:00.000Z" },
    ]);
    const runs = deriveRuns([wi]);
    expect(runs).toHaveLength(3);
    expect(runs[0].workItemId).toBe("wi1");
    expect(runs[1].id).toBe("evt_wi1_1");
  });

  it("2. factory filter solo returns matching", () => {
    const wiA = makeWorkItemWithHistory("a", "payments-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" }]);
    const wiB = makeWorkItemWithHistory("b", "termcanvas-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:01Z" }]);
    const runs = deriveRuns([wiA, wiB]);
    const filtered = filterRuns(runs, { factoryName: "payments-factory" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].factoryName).toBe("payments-factory");
  });

  it("3. team vs factory: team all, factory subset", () => {
    const wiA = makeWorkItemWithHistory("a", "payments-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" }]);
    const wiB = makeWorkItemWithHistory("b", "termcanvas-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:01Z" }]);
    const runs = deriveRuns([wiA, wiB]);
    expect(getTeamRuns(runs)).toHaveLength(2);
    expect(getFactoryRuns(runs, "payments-factory")).toHaveLength(1);
    expect(getFactoryRuns(runs, "unknown")).toHaveLength(0);
  });

  it("4. cost es deterministico y >0 para cada run", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" },
      { from: "Triage", to: "Planning", actor: "triage", at: "2026-01-01T10:01:00Z" },
    ]);
    const runs = deriveRuns([wi]);
    expect(runs[0].cost).toBeGreaterThan(0);
    expect(runs[1].cost).toBeGreaterThan(0);
    // costForActor consistent
    const c1 = costForActor("implement", "evt_x");
    const c2 = costForActor("implement", "evt_x");
    expect(c1).toBe(c2);
  });

  it("5. cost si WorkItem.cost existe se reparte", () => {
    const wi: WorkItem = {
      id: "wi_cost",
      factoryName: "payments-factory",
      title: "costly",
      source: "github_issue",
      createdBy: "ben",
      createdAt: "2026-01-01T10:00:00Z",
      stage: "Building",
      history: [
        { id: "evt_0", workItemId: "wi_cost", from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" },
        { id: "evt_1", workItemId: "wi_cost", from: "Triage", to: "Building", actor: "foreman", at: "2026-01-01T10:01:00Z" },
      ],
      linkedPRs: [],
      cost: 1.0,
    };
    const runs = deriveRuns([wi]);
    expect(runs[0].cost).toBe(0.5);
    expect(runs[1].cost).toBe(0.5);
    expect(totalCost(runs)).toBe(1.0);
  });

  it("6. sub-agents solo si orchestrator (foreman)", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" },
      { from: "Triage", to: "Building", actor: "implement", at: "2026-01-01T10:01:00Z" },
    ]);
    const runs = deriveRuns([wi]);
    const orch = runs.find((r) => r.actor === "foreman")!;
    const impl = runs.find((r) => r.actor === "implement")!;
    expect(orch.isOrchestrator).toBe(true);
    expect(orch.childRuns.length).toBeGreaterThan(0);
    expect(impl.isOrchestrator).toBe(false);
    expect(impl.childRuns).toHaveLength(0);
  });

  it("7. timeline ordenado por at asc", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [
      { from: "Planning", to: "Building", actor: "foreman", at: "2026-01-01T10:02:00Z" },
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" },
      { from: "Triage", to: "Planning", actor: "foreman", at: "2026-01-01T10:01:00Z" },
    ]);
    const runs = deriveRuns([wi]);
    expect(runs[0].at).toBe("2026-01-01T10:00:00Z");
    expect(runs[1].at).toBe("2026-01-01T10:01:00Z");
    expect(runs[2].at).toBe("2026-01-01T10:02:00Z");
  });

  it("8. empty workItems -> empty runs", () => {
    expect(deriveRuns([])).toHaveLength(0);
    expect(getTeamRuns([])).toHaveLength(0);
    expect(filterRuns([], { factoryName: "x" })).toHaveLength(0);
  });

  it("9. work item con history vacia -> 0 runs", () => {
    const wi: WorkItem = {
      id: "empty",
      factoryName: "payments-factory",
      title: "empty hist",
      source: "github_issue",
      createdBy: "ben",
      createdAt: "2026-01-01T10:00:00Z",
      stage: "Triage",
      history: [],
      linkedPRs: [],
    };
    expect(deriveRuns([wi])).toHaveLength(0);
    expect(deriveRunsForWorkItem(wi)).toHaveLength(0);
  });

  it("10. groupRunsByWorkItem agrupa correctamente", () => {
    const wi1 = makeWorkItemWithHistory("wi1", "payments-factory", [
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" },
      { from: "Triage", to: "Planning", actor: "foreman", at: "2026-01-01T10:01:00Z" },
    ]);
    const wi2 = makeWorkItemWithHistory("wi2", "payments-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:02:00Z" }]);
    const runs = deriveRuns([wi1, wi2]);
    const grouped = groupRunsByWorkItem(runs);
    expect(grouped.size).toBe(2);
    expect(grouped.get("wi1")!).toHaveLength(2);
    expect(grouped.get("wi2")!).toHaveLength(1);
  });

  it("11. filterRuns por actor", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" },
      { from: "Triage", to: "Building", actor: "implement", at: "2026-01-01T10:01:00Z" },
    ]);
    const runs = deriveRuns([wi]);
    expect(filterRuns(runs, { actor: "implement" })).toHaveLength(1);
    expect(filterRuns(runs, { actor: "review" })).toHaveLength(0);
  });

  it("12. filterRuns por search en title", () => {
    const wiA: WorkItem = { id: "a", factoryName: "payments-factory", title: "Fix checkout", source: "github_issue", createdBy: "ben", createdAt: "2026-01-01T10:00:00Z", stage: "Triage", history: [{ id: "evt_a", workItemId: "a", from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" }], linkedPRs: [] };
    const wiB: WorkItem = { id: "b", factoryName: "payments-factory", title: "Update docs", source: "github_issue", createdBy: "ben", createdAt: "2026-01-01T10:00:00Z", stage: "Triage", history: [{ id: "evt_b", workItemId: "b", from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:01:00Z" }], linkedPRs: [] };
    const runs = deriveRuns([wiA, wiB]);
    expect(filterRuns(runs, { search: "checkout" })).toHaveLength(1);
    expect(filterRuns(runs, { search: "checkout" })[0].workItemTitle).toBe("Fix checkout");
  });

  it("13. totalCost suma correctamente", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" },
      { from: "Triage", to: "Planning", actor: "foreman", at: "2026-01-01T10:01:00Z" },
    ]);
    const runs = deriveRuns([wi]);
    const sum = runs[0].cost + runs[1].cost;
    expect(totalCost(runs)).toBeCloseTo(sum, 2);
  });

  it("14. timelineForWorkItem mantiene orden y usa WorkItemEvent", () => {
    const wi = makeWorkItemWithHistory("wiX", "payments-factory", [
      { from: "Building", to: "Reviewing", actor: "implement", at: "2026-01-01T10:03:00Z" },
      { from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" },
    ]);
    const tl = timelineForWorkItem(wi);
    expect(tl[0].event.id).toBe("evt_wiX_1");
    expect(tl[1].event.id).toBe("evt_wiX_0");
    // derive sorts asc so 10:00 first
    expect(tl[0].at).toBe("2026-01-01T10:00:00Z");
  });

  it("15. getRunById encuentra o undefined", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" }]);
    const runs = deriveRuns([wi]);
    expect(getRunById(runs, "evt_wi1_0")?.id).toBe("evt_wi1_0");
    expect(getRunById(runs, "nope")).toBeUndefined();
  });

  it("16. derive preserva metadata y reason de evento (no inventa campos)", () => {
    const wi: WorkItem = {
      id: "wiM",
      factoryName: "payments-factory",
      title: "meta",
      source: "slack_mention",
      createdBy: "ben",
      createdAt: "2026-01-01T10:00:00Z",
      stage: "Triage",
      history: [{ id: "evt_m", workItemId: "wiM", from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z", reason: "intake", metadata: { foremanDecision: { shouldSkipTriage: true } } }],
      linkedPRs: [],
    };
    const runs = deriveRuns([wi]);
    expect(runs[0].reason).toBe("intake");
    expect(runs[0].metadata).toEqual({ foremanDecision: { shouldSkipTriage: true } });
    expect(runs[0].source).toBe("slack_mention");
  });

  it("17. store integration: runs derivan de WorkItemStore.seed (Actividad)", () => {
    const store = new WorkItemStore(new WorkItemMachine(), ["payments-factory"]);
    const r = store.create({ factoryName: "payments-factory", title: "A", source: "github_issue", createdBy: "ben" }).value!;
    const tr = store.transition(r.id, "Planning", "foreman");
    expect(tr.ok).toBe(true);
    //  have initial + transition = 2 history events
    const wi = store.getById(r.id)!;
    expect(wi.history).toHaveLength(2);
    expect(wi.history[0].from).toBe("Triage");
    expect(wi.history[1].to).toBe("Planning");
    const runs = deriveRuns([wi]);
    expect(runs).toHaveLength(2);
    // deriveRuns sorts by `at`; when both events share the same ms the id lexical order may swap them,
    // so we assert by content, not by position.
    expect(runs.some((run) => run.from === "Triage")).toBe(true);
    expect(runs.some((run) => run.to === "Planning")).toBe(true);
  });

  it("18. filtro combinado factory + actor", () => {
    const wiA = makeWorkItemWithHistory("a", "payments-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" }]);
    const wiB = makeWorkItemWithHistory("b", "payments-factory", [{ from: "Triage", to: "Triage", actor: "implement", at: "2026-01-01T10:00:01Z" }]);
    const runs = deriveRuns([wiA, wiB]);
    expect(filterRuns(runs, { factoryName: "payments-factory", actor: "foreman" })).toHaveLength(1);
  });

  it("19. cada run tiene durationMs positivo y event ref", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" }]);
    const runs = deriveRuns([wi]);
    expect(runs[0].durationMs).toBeGreaterThan(0);
    expect(runs[0].event).toBeDefined();
    expect(runs[0].event.id).toBe(runs[0].id);
  });

  it("20. deriveRuns no muta workItems", () => {
    const wi = makeWorkItemWithHistory("wi1", "payments-factory", [{ from: "Triage", to: "Triage", actor: "foreman", at: "2026-01-01T10:00:00Z" }]);
    const origHist = [...wi.history];
    deriveRuns([wi]);
    expect(wi.history).toEqual(origHist);
  });
});
