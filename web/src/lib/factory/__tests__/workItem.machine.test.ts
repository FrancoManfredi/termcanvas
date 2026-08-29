import { describe, it, expect, beforeEach } from "vitest";
import { WorkItemMachine, canTransition, nextStageForIntake, resetWorkItemMachineCounter } from "../domain/workItem.machine";
import type { WorkItem } from "../domain/workItem.types";

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_1",
    factoryName: "payments-factory",
    title: "Fix checkout",
    source: "github_issue",
    createdBy: "ben",
    createdAt: new Date().toISOString(),
    stage: "Triage",
    history: [{ id: "evt_0", workItemId: "wi_1", from: "Triage", to: "Triage", actor: "foreman", at: new Date().toISOString(), reason: "intake" }],
    linkedPRs: [],
    ...overrides,
  };
}

describe("WorkItemMachine", () => {
  let machine: WorkItemMachine;
  beforeEach(() => {
    machine = new WorkItemMachine();
    resetWorkItemMachineCounter();
  });

  // Creation / Intake via nextStageForIntake
  it("1. intake defaults to Triage", () => expect(nextStageForIntake()).toBe("Triage"));
  it("2. intake Building when skip both", () => expect(nextStageForIntake({ shouldSkipTriage: true, shouldSkipPlanning: true })).toBe("Building"));
  it("3. intake Planning when skip triage only", () => expect(nextStageForIntake({ shouldSkipTriage: true, shouldSkipPlanning: false })).toBe("Planning"));
  it("4. intake Triage when no skip", () => expect(nextStageForIntake({ shouldSkipTriage: false, shouldSkipPlanning: false })).toBe("Triage"));

  // Triage transitions
  it("5. Triage → Planning valid", () => expect(canTransition("Triage", "Planning")).toBe(true));
  it("6. Triage → Building valid (skip Planning)", () => {
    const item = makeItem({ stage: "Triage" });
    const r = machine.transition(item, "Building", "foreman");
    expect(r.ok).toBe(true);
    expect(r.value!.stage).toBe("Building");
  });
  it("7. Triage → Reviewing invalid", () => {
    const r = machine.transition(makeItem({ stage: "Triage" }), "Reviewing", "foreman");
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe("invalid_transition");
  });
  it("8. Triage → Complete invalid", () => expect(machine.transition(makeItem({ stage: "Triage" }), "Complete", "foreman").ok).toBe(false));
  it("9. Triage → Cancelled valid", () => expect(machine.transition(makeItem({ stage: "Triage" }), "Cancelled", "foreman").ok).toBe(true));

  // Planning → Building human gate
  it("10. Planning → Building with approved valid", () => {
    const item = makeItem({ stage: "Planning", humanApproval: "approved" });
    expect(machine.transition(item, "Building", "foreman", { humanApproval: "approved" }).ok).toBe(true);
  });
  it("11. Planning → Building with pending fails", () => {
    const item = makeItem({ stage: "Planning", humanApproval: "pending" });
    const r = machine.transition(item, "Building", "foreman");
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe("human_gate_pending");
  });
  it("12. Planning → Building with rejected fails", () => {
    const item = makeItem({ stage: "Planning", humanApproval: "pending" });
    const r = machine.transition(item, "Building", "foreman", { humanApproval: "rejected" });
    expect(r.ok).toBe(false);
  });
  it("13. Planning → Planning rework valid", () => expect(machine.transition(makeItem({ stage: "Planning" }), "Planning", "human").ok).toBe(true));
  it("14. Planning → Reviewing invalid", () => expect(machine.transition(makeItem({ stage: "Planning" }), "Reviewing", "foreman").ok).toBe(false));
  it("15. Planning → Triage invalid", () => expect(machine.transition(makeItem({ stage: "Planning" }), "Triage", "foreman").ok).toBe(false));
  it("16. Planning → Cancelled valid", () => expect(machine.transition(makeItem({ stage: "Planning" }), "Cancelled", "foreman").ok).toBe(true));

  // Building → Reviewing
  it("17. Building → Reviewing valid", () => expect(machine.transition(makeItem({ stage: "Building" }), "Reviewing", "implement").ok).toBe(true));
  it("18. Building → Complete invalid", () => expect(machine.transition(makeItem({ stage: "Building" }), "Complete", "foreman").ok).toBe(false));
  it("19. Building → Planning invalid", () => expect(machine.transition(makeItem({ stage: "Building" }), "Planning", "foreman").ok).toBe(false));
  it("20. Building → Cancelled valid", () => expect(machine.transition(makeItem({ stage: "Building" }), "Cancelled", "foreman").ok).toBe(true));
  it("21. Building → Building invalid", () => expect(machine.transition(makeItem({ stage: "Building" }), "Building", "foreman").ok).toBe(false));

  // Reviewing → Complete / Building
  it("22. Reviewing → Complete with accept+handoff valid", () => {
    const item = makeItem({ stage: "Reviewing", reviewVerdict: "accept", handoffConfirmed: true });
    const r = machine.transition(item, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true });
    expect(r.ok).toBe(true);
  });
  it("23. Reviewing → Complete without handoff fails", () => {
    const item = makeItem({ stage: "Reviewing", reviewVerdict: "accept", handoffConfirmed: false });
    const r = machine.transition(item, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: false });
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe("handoff_not_confirmed");
  });
  it("24. Reviewing → Complete with revise fails", () => {
    const item = makeItem({ stage: "Reviewing", reviewVerdict: "revise" });
    expect(machine.transition(item, "Complete", "foreman", { reviewVerdict: "revise", handoffConfirmed: true }).ok).toBe(false);
  });
  it("25. Reviewing → Building with revise valid", () => {
    const item = makeItem({ stage: "Reviewing", reviewVerdict: "revise" });
    expect(machine.transition(item, "Building", "review", { reviewVerdict: "revise" }).ok).toBe(true);
  });
  it("26. Reviewing → Building with accept fails", () => {
    const item = makeItem({ stage: "Reviewing", reviewVerdict: "accept" });
    expect(machine.transition(item, "Building", "review", { reviewVerdict: "accept" }).ok).toBe(false);
  });
  it("27. Reviewing → Building with ask_human should stay (fail)", () => {
    const item = makeItem({ stage: "Reviewing", reviewVerdict: "ask_human" });
    const r = machine.transition(item, "Building", "review", { reviewVerdict: "ask_human" });
    expect(r.ok).toBe(false);
    expect(r.issues[0].code).toBe("ask_human_stays");
  });
  it("28. Reviewing → Reviewing with ask_human valid", () => {
    const item = makeItem({ stage: "Reviewing" });
    expect(machine.transition(item, "Reviewing", "review", { reviewVerdict: "ask_human" }).ok).toBe(true);
  });
  it("29. Reviewing → Complete only foreman/human", () => {
    const item = makeItem({ stage: "Reviewing", reviewVerdict: "accept", handoffConfirmed: true });
    expect(machine.transition(item, "Complete", "review", { reviewVerdict: "accept", handoffConfirmed: true }).ok).toBe(false);
    expect(machine.transition(item, "Complete", "human", { reviewVerdict: "accept", handoffConfirmed: true }).ok).toBe(true);
  });
  it("30. Reviewing → Cancelled valid", () => expect(machine.transition(makeItem({ stage: "Reviewing" }), "Cancelled", "foreman").ok).toBe(true));

  // Terminals
  it("31. Complete → any invalid", () => {
    expect(machine.transition(makeItem({ stage: "Complete" }), "Building", "foreman").ok).toBe(false);
    expect(machine.transition(makeItem({ stage: "Complete" }), "Cancelled", "foreman").ok).toBe(false);
    expect(machine.transition(makeItem({ stage: "Complete" }), "Complete", "foreman").ok).toBe(false);
  });
  it("32. Cancelled → any invalid", () => expect(machine.transition(makeItem({ stage: "Cancelled" }), "Triage", "foreman").ok).toBe(false));
  it("33. canTransition helper respects terminal", () => {
    expect(canTransition("Complete", "Building")).toBe(false);
    expect(canTransition("Cancelled", "Triage")).toBe(false);
  });

  // Idempotency / history
  it("34. transition appends exactly one event", () => {
    const item = makeItem({ stage: "Triage" });
    const r = machine.transition(item, "Planning", "foreman");
    expect(r.ok).toBe(true);
    expect(r.value!.history).toHaveLength(2);
    expect(r.value!.history[1].from).toBe("Triage");
    expect(r.value!.history[1].to).toBe("Planning");
  });
  it("35. failed transition does not mutate", () => {
    const item = makeItem({ stage: "Triage" });
    const r = machine.transition(item, "Complete", "foreman");
    expect(r.ok).toBe(false);
    expect(item.stage).toBe("Triage");
    expect(item.history).toHaveLength(1);
  });
  it("36. history preserves order and metadata", () => {
    const item = makeItem({ stage: "Planning", humanApproval: "approved" });
    const r = machine.transition(item, "Building", "foreman", { humanApproval: "approved", reason: "gate ok" });
    expect(r.ok).toBe(true);
    expect(r.value!.history[1].reason).toBe("gate ok");
    expect(r.value!.history[1].metadata?.humanApproval).toBe("approved");
  });
  it("37. assignee rotates by stage", () => {
    const item = makeItem({ stage: "Triage" });
    const r = machine.transition(item, "Building", "foreman");
    expect(r.value!.assigneeAgent).toBe("implement");
    const r2 = machine.transition(r.value!, "Reviewing", "implement");
    expect(r2.value!.assigneeAgent).toBe("review");
  });
  it("38. transition is inmutable (new object)", () => {
    const item = makeItem({ stage: "Triage" });
    const r = machine.transition(item, "Planning", "foreman");
    expect(r.value).not.toBe(item);
    expect(item.stage).toBe("Triage");
  });
});
