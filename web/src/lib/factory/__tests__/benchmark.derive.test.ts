import { describe, it, expect } from "vitest";
import {
  validateBenchmarkDefinition,
  isBenchmarkSingleAgent,
  deriveBenchmark,
  deriveConfigResult,
  createTaskFromRun,
  mockBenchmarkDefinition,
  mockBenchmarkTrials,
  mockSelfImprovementPRs,
} from "../domain/benchmark.derive";
import type { BenchmarkDefinition, BenchmarkTrial } from "../domain/benchmark.types";

function makeDef(over: Partial<BenchmarkDefinition> = {}): BenchmarkDefinition {
  return {
    id: "bench_test",
    name: "test bench",
    agent: "implement",
    tasks: [
      { id: "t1", prompt: "Fix bug A", successCriteria: "bug fixed, tests pass" },
      { id: "t2", prompt: "Add feature B", successCriteria: "feature works, coverage" },
    ],
    configs: [
      { id: "cfg1", label: "oz + auto + linux", harness: "oz", model: "auto", runner: "linux-build" },
      { id: "cfg2", label: "claude + haiku + linux", harness: "claude-code", model: "claude-4-5-haiku", runner: "linux-build" },
    ],
    scorerNames: ["tests-run"],
    repetitions: 2,
    ...over,
  };
}

describe("benchmark.derive — WarpFactories §11 Measure and Improve", () => {
  it("1. single agent required", () => {
    expect(isBenchmarkSingleAgent(makeDef())).toBe(true);
    expect(isBenchmarkSingleAgent(makeDef({ agent: "" }))).toBe(false);
    expect(isBenchmarkSingleAgent(makeDef({ agent: "a,b" }))).toBe(false);
  });

  it("2. validate requires tasks", () => {
    expect(validateBenchmarkDefinition(makeDef({ tasks: [] }))).toContain("tasks required: N tasks");
  });

  it("3. validate requires configs", () => {
    expect(validateBenchmarkDefinition(makeDef({ configs: [] }))).toContain("configs required: N configs");
  });

  it("4. validate requires repetitions >=1", () => {
    expect(validateBenchmarkDefinition(makeDef({ repetitions: 0 }))).toContain("repetitions must be >=1");
  });

  it("5. validate requires agent", () => {
    expect(validateBenchmarkDefinition(makeDef({ agent: "" }))).toContain("agent required: single agent");
  });

  it("6. validate duplicate task id", () => {
    expect(validateBenchmarkDefinition(makeDef({ tasks: [{ id: "dup", prompt: "a", successCriteria: "s" }, { id: "dup", prompt: "b", successCriteria: "s" }] })).some((e) => e.includes("duplicate task"))).toBe(true);
  });

  it("7. validate duplicate config id", () => {
    const d = makeDef({ configs: [{ id: "dup", label: "a", harness: "oz", model: "m", runner: "r" }, { id: "dup", label: "b", harness: "oz", model: "m2", runner: "r" }] });
    expect(validateBenchmarkDefinition(d).some((e) => e.includes("duplicate config"))).toBe(true);
  });

  it("8. validate prompt required", () => {
    expect(validateBenchmarkDefinition(makeDef({ tasks: [{ id: "t1", prompt: " ", successCriteria: "s" }] })).some((e) => e.includes("prompt required"))).toBe(true);
  });

  it("9. validate successCriteria required", () => {
    expect(validateBenchmarkDefinition(makeDef({ tasks: [{ id: "t1", prompt: "p", successCriteria: " " }] })).some((e) => e.includes("successCriteria"))).toBe(true);
  });

  it("10. validate config harness required", () => {
    const d = makeDef({ configs: [{ id: "c1", label: "l", harness: "" as any, model: "m", runner: "r" }] });
    expect(validateBenchmarkDefinition(d).some((e) => e.includes("harness"))).toBe(true);
  });

  it("11. valid definition passes", () => {
    expect(validateBenchmarkDefinition(makeDef())).toHaveLength(0);
  });

  it("12. createTaskFromRun copies prompt and needs successCriteria before launch", () => {
    const t = createTaskFromRun({ prompt: "Fix checkout race", successCriteria: "" });
    expect(t.prompt).toBe("Fix checkout race");
    expect(t.successCriteria).toContain("Manually add");
    const t2 = createTaskFromRun({ prompt: "Add pagination", successCriteria: "pagination works" });
    expect(t2.successCriteria).toBe("pagination works");
  });

  it("13. deriveConfigResult correctness pass rate", () => {
    const def = makeDef();
    const trials: BenchmarkTrial[] = [
      { taskId: "t1", configId: "cfg1", repetition: 1, correctnessPass: true, scorerPass: { "tests-run": true }, costCredits: 10 },
      { taskId: "t1", configId: "cfg1", repetition: 2, correctnessPass: false, scorerPass: { "tests-run": false }, costCredits: 20 },
    ];
    const r = deriveConfigResult(def.configs[0], trials, ["t1", "t2"], ["tests-run"]);
    expect(r.correctnessPassRate).toBe(0.5);
    expect(r.avgCostCredits).toBe(15);
  });

  it("14. deriveConfigResult avgQuality across scorers", () => {
    const def = makeDef({ scorerNames: ["s1", "s2"] });
    const trials: BenchmarkTrial[] = [
      { taskId: "t1", configId: "cfg1", repetition: 1, correctnessPass: true, scorerPass: { s1: true, s2: false }, costCredits: 10 },
      { taskId: "t1", configId: "cfg1", repetition: 2, correctnessPass: true, scorerPass: { s1: true, s2: true }, costCredits: 10 },
    ];
    const r = deriveConfigResult(def.configs[0], trials, ["t1"], ["s1", "s2"]);
    // s1 true,true =2/2, s2 false,true=1/2 => total 3/4=0.75
    expect(r.avgQuality).toBe(0.75);
  });

  it("15. deriveConfigResult perTaskPass", () => {
    const def = makeDef();
    const trials: BenchmarkTrial[] = [
      { taskId: "t1", configId: "cfg1", repetition: 1, correctnessPass: true, scorerPass: {}, costCredits: 10 },
      { taskId: "t1", configId: "cfg1", repetition: 2, correctnessPass: true, scorerPass: {}, costCredits: 10 },
      { taskId: "t2", configId: "cfg1", repetition: 1, correctnessPass: false, scorerPass: {}, costCredits: 10 },
      { taskId: "t2", configId: "cfg1", repetition: 2, correctnessPass: false, scorerPass: {}, costCredits: 10 },
    ];
    const r = deriveConfigResult(def.configs[0], trials, ["t1", "t2"], []);
    expect(r.perTaskPass["t1"]).toBe(1);
    expect(r.perTaskPass["t2"]).toBe(0);
  });

  it("16. deriveConfigResult empty trials zero", () => {
    const def = makeDef();
    const r = deriveConfigResult(def.configs[0], [], ["t1"], []);
    expect(r.correctnessPassRate).toBe(0);
    expect(r.avgCostCredits).toBe(0);
    expect(r.avgQuality).toBeNull();
  });

  it("17. deriveBenchmark single agent invariant", () => {
    const def = makeDef();
    const trials = mockBenchmarkTrials(def);
    const derived = deriveBenchmark(def, trials);
    expect(derived.definition.agent).toBe("implement");
    expect(isBenchmarkSingleAgent(derived.definition)).toBe(true);
  });

  it("18. deriveBenchmark has N tasks*configs*repetitions trials", () => {
    const def = makeDef({ repetitions: 3 });
    const trials = mockBenchmarkTrials(def);
    expect(trials.length).toBe(def.tasks.length * def.configs.length * def.repetitions);
  });

  it("19. Correctness built-in pass/fail vs success criteria exists", () => {
    const def = makeDef();
    const trials = mockBenchmarkTrials(def);
    expect(trials.every((t) => typeof t.correctnessPass === "boolean")).toBe(true);
  });

  it("20. deriveBenchmark winnerChosen false (Warp no elige ganador)", () => {
    const def = makeDef();
    const derived = deriveBenchmark(def, mockBenchmarkTrials(def));
    expect(derived.winnerChosen).toBe(false);
  });

  it("21. credit totals no incluyen model usage (only credits)", () => {
    const def = makeDef();
    const trials = mockBenchmarkTrials(def);
    const derived = deriveBenchmark(def, trials);
    for (const cr of derived.configResults) {
      expect(cr.avgCostCredits).toBeGreaterThan(0);
      // no model usage field exists
      expect((cr as any).modelUsage).toBeUndefined();
    }
  });

  it("22. mockBenchmarkDefinition has 2 configs example (harness/model/runner combos)", () => {
    const def = mockBenchmarkDefinition();
    expect(def.configs.length).toBe(2);
    expect(def.configs[0].harness).toBeDefined();
    expect(def.configs[1].model).toBeDefined();
  });

  it("23. mockBenchmarkDefinition has 3 tasks with successCriteria", () => {
    const def = mockBenchmarkDefinition();
    expect(def.tasks.length).toBe(3);
    for (const t of def.tasks) expect(t.successCriteria.trim().length).toBeGreaterThan(0);
  });

  it("24. configResults comparison shows pass rates, cost, quality per config", () => {
    const def = mockBenchmarkDefinition();
    const derived = deriveBenchmark(def, mockBenchmarkTrials(def));
    expect(derived.configResults.length).toBe(2);
    for (const cr of derived.configResults) {
      expect(typeof cr.correctnessPassRate).toBe("number");
      expect(typeof cr.avgCostCredits).toBe("number");
      expect(cr.avgQuality === null || typeof cr.avgQuality === "number").toBe(true);
    }
  });

  it("25. per-task detail exists for each task", () => {
    const def = mockBenchmarkDefinition();
    const derived = deriveBenchmark(def, mockBenchmarkTrials(def));
    for (const cr of derived.configResults) {
      for (const tid of def.tasks.map((t) => t.id)) {
        expect(typeof cr.perTaskPass[tid]).toBe("number");
      }
    }
  });

  it("26. create task from run detail pane workflow", () => {
    const task = createTaskFromRun({ prompt: "Add Local development section to README.md that summarizes setup steps from CONTRIBUTING.md. Keep change to that one file", successCriteria: "README has section" });
    expect(task.prompt).toContain("Local development");
    expect(task.successCriteria).toBe("README has section");
  });

  it("27. self-improvement 3 newest PRs mock sin date filter", () => {
    const prs = mockSelfImprovementPRs();
    expect(prs).toHaveLength(3);
    // newest first
    expect(new Date(prs[0].createdAt).getTime()).toBeGreaterThan(new Date(prs[1].createdAt).getTime());
  });

  it("28. self-improvement each PR has Regressions addressed with failing runs + Scorer results", () => {
    const prs = mockSelfImprovementPRs();
    for (const pr of prs) {
      expect(pr.regressions.length).toBeGreaterThan(0);
      for (const r of pr.regressions) {
        expect(r.runUrl).toContain("/runs/");
        expect(r.scorerName).toBeDefined();
        expect(r.score).toBe(0);
        expect(r.reasoning.length).toBeGreaterThan(0);
      }
    }
  });

  it("29. self-improvement PRs link to failing runs traceability", () => {
    const prs = mockSelfImprovementPRs();
    expect(prs.every((p) => p.prUrl.includes("/pull/"))).toBe(true);
  });

  it("30. benchmark repetitions count per task+config", () => {
    const def = makeDef({ repetitions: 5 });
    const trials = mockBenchmarkTrials(def);
    // each task+config should have 5 repetitions
    for (const t of def.tasks) {
      for (const c of def.configs) {
        const count = trials.filter((tr) => tr.taskId === t.id && tr.configId === c.id).length;
        expect(count).toBe(5);
      }
    }
  });

  it("31. no winner chosen even with clear better config", () => {
    const def = makeDef();
    // make cfg1 always pass, cfg2 always fail
    const trials: BenchmarkTrial[] = [];
    for (const task of def.tasks) {
      for (let rep = 1; rep <= 2; rep++) {
        trials.push({ taskId: task.id, configId: "cfg1", repetition: rep, correctnessPass: true, scorerPass: {}, costCredits: 10 });
        trials.push({ taskId: task.id, configId: "cfg2", repetition: rep, correctnessPass: false, scorerPass: {}, costCredits: 5 });
      }
    }
    const derived = deriveBenchmark(def, trials);
    expect(derived.winnerChosen).toBe(false);
    expect(derived.configResults[0].configId).toBe("cfg1"); // sorted best first but not declared winner
  });

  it("32. 100 formas smoke: repetitions produce 100 trials", () => {
    const def: BenchmarkDefinition = {
      id: "big",
      name: "big",
      agent: "implement",
      tasks: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, prompt: `prompt ${i}`, successCriteria: `criteria ${i}` })),
      configs: [
        { id: "c1", label: "c1", harness: "oz", model: "auto", runner: "linux-build" },
        { id: "c2", label: "c2", harness: "claude-code", model: "haiku", runner: "linux-build" },
      ],
      scorerNames: ["tests-run"],
      repetitions: 10,
    };
    const trials = mockBenchmarkTrials(def);
    expect(trials.length).toBe(100);
  });
});
