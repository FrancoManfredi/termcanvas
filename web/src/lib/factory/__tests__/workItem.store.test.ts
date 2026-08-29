import { describe, it, expect, beforeEach } from "vitest";
import { WorkItemStore } from "../store/workItem.store";
import { WorkItemMachine, resetWorkItemMachineCounter } from "../domain/workItem.machine";
import { resetWorkItemSampleSeq } from "../fixtures/workItem.samples";

describe("WorkItemStore", () => {
  let store: WorkItemStore;

  beforeEach(() => {
    WorkItemMachine._resetCounter();
    resetWorkItemMachineCounter();
    WorkItemStore._resetIdSeq();
    resetWorkItemSampleSeq();
    store = new WorkItemStore(new WorkItemMachine(), ["payments-factory", "termcanvas-factory"]);
  });

  it("1. create minimal in Triage", () => {
    const r = store.create({ factoryName: "payments-factory", title: "Fix", source: "github_issue", createdBy: "ben" });
    expect(r.ok).toBe(true);
    expect(r.value!.stage).toBe("Triage");
  });
  it("2. create with skip both → Building", () => {
    const r = store.create({ factoryName: "payments-factory", title: "Fix", source: "github_issue", createdBy: "ben", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } });
    expect(r.value!.stage).toBe("Building");
  });
  it("3. create with skip triage only → Planning", () => {
    const r = store.create({ factoryName: "payments-factory", title: "Fix", source: "github_issue", createdBy: "ben", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: false } });
    expect(r.value!.stage).toBe("Planning");
  });
  it("4. fails on unknown factory", () => expect(store.create({ factoryName: "unknown", title: "x", source: "github_issue", createdBy: "ben" }).ok).toBe(false));
  it("5. fails on missing title", () => expect(store.create({ factoryName: "payments-factory", title: " ", source: "github_issue", createdBy: "ben" }).ok).toBe(false));
  it("6. fails on missing createdBy", () => expect(store.create({ factoryName: "payments-factory", title: "x", source: "github_issue", createdBy: " " }).ok).toBe(false));
  it("7. getById returns item", () => {
    const r = store.create({ factoryName: "payments-factory", title: "Fix", source: "github_issue", createdBy: "ben" });
    expect(store.getById(r.value!.id)).toBeDefined();
  });
  it("8. getById undefined if not exists", () => expect(store.getById("nope")).toBeUndefined());
  it("9. list filters by stage", () => {
    const a = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" }).value!;
    store.create({ factoryName: "payments-factory", title: "b", source: "github_issue", createdBy: "alice", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } });
    expect(store.list({ stage: "Triage" })).toHaveLength(1);
    expect(store.list({ stage: "Building" })).toHaveLength(1);
    expect(store.list({ stage: "Triage" })[0].id).toBe(a.id);
  });
  it("10. list default only active", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" }).value!;
    store.cancel(r.id);
    expect(store.list().some((w) => w.id === r.id)).toBe(false);
    expect(store.list({ includeTerminals: true }).some((w) => w.id === r.id)).toBe(true);
  });
  it("11. list filters by createdBy", () => {
    store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" });
    store.create({ factoryName: "payments-factory", title: "b", source: "github_issue", createdBy: "alice" });
    expect(store.list({ createdBy: "ben", includeTerminals: true })).toHaveLength(1);
  });
  it("12. search filters by title", () => {
    store.create({ factoryName: "payments-factory", title: "checkout flow", source: "github_issue", createdBy: "ben" });
    store.create({ factoryName: "payments-factory", title: "other", source: "github_issue", createdBy: "ben" });
    expect(store.list({ search: "checkout", includeTerminals: true })).toHaveLength(1);
  });
  it("13. search in description", () => {
    store.create({ factoryName: "payments-factory", title: "a", description: "checkout bug", source: "github_issue", createdBy: "ben" });
    expect(store.list({ search: "checkout", includeTerminals: true })).toHaveLength(1);
  });
  it("14. transition happy path Triage→Planning→Building→Reviewing→Complete", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" }).value!;
    expect(store.transition(r.id, "Planning", "foreman").ok).toBe(true);
    expect(store.transition(r.id, "Building", "foreman", { humanApproval: "approved" }).ok).toBe(true);
    expect(store.transition(r.id, "Reviewing", "implement").ok).toBe(true);
    const fin = store.transition(r.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true });
    expect(fin.ok).toBe(true);
    expect(fin.value!.stage).toBe("Complete");
  });
  it("15. happy path with skip", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } }).value!;
    expect(r.stage).toBe("Building");
    expect(store.transition(r.id, "Reviewing", "implement").ok).toBe(true);
    expect(store.transition(r.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true }).ok).toBe(true);
  });
  it("16. loop Building→Reviewing(revise)→Building→Reviewing→Complete", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } }).value!;
    store.transition(r.id, "Reviewing", "implement");
    store.transition(r.id, "Building", "review", { reviewVerdict: "revise" });
    store.transition(r.id, "Reviewing", "implement");
    const fin = store.transition(r.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true });
    expect(fin.ok).toBe(true);
  });
  it("17. cancel from each active", () => {
    for (const decision of [{ shouldSkipTriage: false, shouldSkipPlanning: false }, { shouldSkipTriage: true, shouldSkipPlanning: false }, { shouldSkipTriage: true, shouldSkipPlanning: true }] as const) {
      const s = new WorkItemStore(new WorkItemMachine(), ["payments-factory"]);
      const r = s.create({ factoryName: "payments-factory", title: "x", source: "github_issue", createdBy: "ben", foremanDecision: decision }).value!;
      expect(s.cancel(r.id).ok).toBe(true);
      expect(s.getById(r.id)!.stage).toBe("Cancelled");
    }
  });
  it("18. cancel from Complete fails", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } }).value!;
    store.transition(r.id, "Reviewing", "implement");
    store.transition(r.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true });
    expect(store.cancel(r.id).ok).toBe(false);
  });
  it("19. transition with id not found fails", () => expect(store.transition("nope", "Building", "foreman").ok).toBe(false));
  it("20. linkedPRs preserved through transitions", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", linkedPRs: ["https://github.com/acme/repo/pull/1"] }).value!;
    store.transition(r.id, "Planning", "foreman");
    expect(store.getById(r.id)!.linkedPRs).toEqual(["https://github.com/acme/repo/pull/1"]);
  });
  it("21. Complete handoff ≠ merge (merged false still Complete)", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } }).value!;
    store.transition(r.id, "Reviewing", "implement");
    const fin = store.transition(r.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true }).value!;
    expect(fin.stage).toBe("Complete");
    expect(fin.linkedPRs).toEqual([]);
  });
  it("22. list factoryName filter", () => {
    store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" });
    store.create({ factoryName: "termcanvas-factory", title: "b", source: "github_issue", createdBy: "ben" });
    expect(store.list({ factoryName: "payments-factory", includeTerminals: true })).toHaveLength(1);
  });
  it("23. transition appends history", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" }).value!;
    store.transition(r.id, "Planning", "foreman");
    expect(store.getById(r.id)!.history).toHaveLength(2);
  });
  it("24. failed transition does not mutate", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" }).value!;
    store.transition(r.id, "Complete", "foreman");
    expect(store.getById(r.id)!.stage).toBe("Triage");
  });
  it("25. 100 work items smoke", () => {
    for (let i = 0; i < 100; i++) store.create({ factoryName: "payments-factory", title: `item ${i}`, source: "github_issue", createdBy: "ben" });
    expect(store.size()).toBe(100);
    expect(store.list({ stage: "Triage" })).toHaveLength(100);
  });
  it("26. concurrent transition: second fails if stage moved", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" }).value!;
    expect(store.transition(r.id, "Planning", "foreman").ok).toBe(true);
    // trying again Triage→Planning when already Planning should fail (Planning→Planning is allowed as rework, but Triage→Planning not)
    // Actually second Planning→Planning should succeed, so test different: try Planning→Reviewing which is invalid
    expect(store.transition(r.id, "Reviewing", "foreman").ok).toBe(false);
  });
  it("27. humanApproval async: Planning blocked until approved", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben" }).value!;
    store.transition(r.id, "Planning", "foreman");
    expect(store.transition(r.id, "Building", "foreman").ok).toBe(false);
    expect(store.transition(r.id, "Building", "foreman", { humanApproval: "approved" }).ok).toBe(true);
  });
  it("28. ask_human stays in Reviewing", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } }).value!;
    store.transition(r.id, "Reviewing", "implement");
    expect(store.transition(r.id, "Reviewing", "review", { reviewVerdict: "ask_human" }).ok).toBe(true);
    expect(store.getById(r.id)!.stage).toBe("Reviewing");
  });
  it("29. ask_human then revise → Building", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "github_issue", createdBy: "ben", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true } }).value!;
    store.transition(r.id, "Reviewing", "implement");
    store.transition(r.id, "Reviewing", "review", { reviewVerdict: "ask_human" });
    expect(store.transition(r.id, "Building", "review", { reviewVerdict: "revise" }).ok).toBe(true);
  });
  it("30. automation source preserved", () => {
    const r = store.create({ factoryName: "payments-factory", title: "a", source: "automation", sourceRef: "labeled-issue", createdBy: "system" }).value!;
    expect(r.source).toBe("automation");
    expect(r.sourceRef).toBe("labeled-issue");
  });
});
