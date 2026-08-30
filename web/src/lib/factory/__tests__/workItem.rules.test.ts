import { describe, it, expect } from "vitest";
import { decideSkipTriage, decideSkipPlanning, createForemanDecision, isHumanGateBlocking } from "../domain/workItem.rules";

describe("workItem.rules", () => {
  it("1. skip triage when evidence+scope present", () => {
    expect(decideSkipTriage({ title: "Fix bug", description: "repro evidence scope what to change", labels: ["factory-ready"] })).toBe(true);
  });
  it("2. no skip triage when missing evidence", () => {
    expect(decideSkipTriage({ title: "Fix bug", description: "something broken" })).toBe(false);
  });
  it("3. skip planning for trivial label", () => expect(decideSkipPlanning({ labels: ["trivial"] })).toBe(true));
  it("4. skip planning for docs", () => expect(decideSkipPlanning({ labels: ["docs"] })).toBe(true));
  it("5. skip planning for chore", () => expect(decideSkipPlanning({ labels: ["chore"] })).toBe(true));
  it("6. skip planning for typo", () => expect(decideSkipPlanning({ labels: ["typo"] })).toBe(true));
  it("7. skip planning for small changedLines", () => expect(decideSkipPlanning({ changedLines: 50 })).toBe(true));
  it("8. no skip for changedLines 200", () => expect(decideSkipPlanning({ changedLines: 200 })).toBe(false));
  it("9. no skip for feature label", () => expect(decideSkipPlanning({ labels: ["feature"] })).toBe(false));
  it("10. no skip when no labels and large", () => expect(decideSkipPlanning({})).toBe(false));
  it("11. createForemanDecision combines both", () => {
    const d = createForemanDecision({ title: "Fix", description: "repro evidence what to change", labels: ["trivial"], changedLines: 10 });
    expect(d.shouldSkipTriage).toBe(true);
    expect(d.shouldSkipPlanning).toBe(true);
    expect(d.reason).toContain("triage:skip");
  });
  it("12. isHumanGateBlocking only for Planning", () => {
    expect(isHumanGateBlocking("Planning", "pending")).toBe(true);
    expect(isHumanGateBlocking("Planning", "approved")).toBe(false);
    expect(isHumanGateBlocking("Building", "pending")).toBe(false);
    expect(isHumanGateBlocking("Triage", undefined)).toBe(false);
  });
  it("13. case insensitive repro detection", () => {
    expect(decideSkipTriage({ title: "REPRO", description: "SCOPE" })).toBe(false); // needs both conditions, scope alone via text not label? hasEvidence true, hasScope false because no factory-ready/repro+scope+what to change combo
    expect(decideSkipTriage({ title: "repro", description: "what to change" })).toBe(true);
  });
});
