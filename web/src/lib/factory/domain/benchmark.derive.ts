// Benchmark derive — pure, no I/O, SRP each function
// DIP: inyecta BenchmarkDefinition + trials, no crea concreciones internas

import type {
  BenchmarkConfig,
  BenchmarkConfigResult,
  BenchmarkDefinition,
  BenchmarkDerived,
  BenchmarkTask,
  BenchmarkTrial,
  BenchmarkSelfImprovementPR as SelfImprovementPR,
} from "./benchmark.types";

export function validateBenchmarkDefinition(def: BenchmarkDefinition): string[] {
  const errors: string[] = [];
  if (!def.agent?.trim()) errors.push("agent required: single agent");
  if (!def.tasks || def.tasks.length === 0) errors.push("tasks required: N tasks");
  if (!def.configs || def.configs.length === 0) errors.push("configs required: N configs");
  if (!def.repetitions || def.repetitions < 1) errors.push("repetitions must be >=1");
  // unique ids
  const taskIds = def.tasks.map((t) => t.id);
  if (new Set(taskIds).size !== taskIds.length) errors.push("duplicate task id");
  const configIds = def.configs.map((c) => c.id);
  if (new Set(configIds).size !== configIds.length) errors.push("duplicate config id");
  for (const t of def.tasks) {
    if (!t.prompt?.trim()) errors.push(`task ${t.id} prompt required`);
    if (!t.successCriteria?.trim()) errors.push(`task ${t.id} successCriteria required`);
  }
  for (const c of def.configs) {
    if (!c.harness) errors.push(`config ${c.id} harness required`);
    if (!c.model?.trim()) errors.push(`config ${c.id} model required`);
    if (!c.runner?.trim()) errors.push(`config ${c.id} runner required`);
  }
  return errors;
}

export function isBenchmarkSingleAgent(def: BenchmarkDefinition): boolean {
  return typeof def.agent === "string" && def.agent.trim().length > 0 && !def.agent.includes(",");
}

export function deriveConfigResult(
  config: BenchmarkConfig,
  trials: BenchmarkTrial[],
  taskIds: string[],
  scorerNames: string[]
): BenchmarkConfigResult {
  const cfgTrials = trials.filter((t) => t.configId === config.id);
  const total = cfgTrials.length;
  const passCount = cfgTrials.filter((t) => t.correctnessPass).length;
  const correctnessPassRate = total === 0 ? 0 : passCount / total;
  const avgCostCredits = total === 0 ? 0 : cfgTrials.reduce((s, t) => s + t.costCredits, 0) / total;

  let avgQuality: number | null = null;
  if (scorerNames.length > 0) {
    let sum = 0;
    let count = 0;
    for (const tr of cfgTrials) {
      for (const s of scorerNames) {
        const v = tr.scorerPass[s];
        if (typeof v === "boolean") {
          sum += v ? 1 : 0;
          count += 1;
        }
      }
    }
    avgQuality = count === 0 ? null : sum / count;
  }

  const perTaskPass: Record<string, number> = {};
  for (const tid of taskIds) {
    const tTrials = cfgTrials.filter((t) => t.taskId === tid);
    const tot = tTrials.length;
    const passed = tTrials.filter((t) => t.correctnessPass).length;
    perTaskPass[tid] = tot === 0 ? 0 : passed / tot;
  }

  return {
    configId: config.id,
    label: config.label,
    harness: config.harness,
    model: config.model,
    runner: config.runner,
    totalTrials: total,
    correctnessPassRate,
    avgCostCredits,
    avgQuality,
    perTaskPass,
  };
}

export function deriveBenchmark(definition: BenchmarkDefinition, trials: BenchmarkTrial[]): BenchmarkDerived {
  const taskIds = definition.tasks.map((t) => t.id);
  const configResults = definition.configs.map((c) => deriveConfigResult(c, trials, taskIds, definition.scorerNames));
  // sorted by correctness desc then cost asc for display, but winner not chosen (Warp §11)
  configResults.sort((a, b) => {
    if (b.correctnessPassRate !== a.correctnessPassRate) return b.correctnessPassRate - a.correctnessPassRate;
    return a.avgCostCredits - b.avgCostCredits;
  });
  return {
    definition,
    trials,
    configResults,
    winnerChosen: false,
  };
}

export function createTaskFromRun(detail: { prompt: string; successCriteria?: string }): BenchmarkTask {
  const base = detail.prompt.slice(0, 40).replace(/\W+/g, "-").toLowerCase();
  const sc = detail.successCriteria?.trim() ? detail.successCriteria : "Manually add success criteria before launch (§11)";
  return {
    id: `task_${base}_${Date.now()}`,
    prompt: detail.prompt,
    successCriteria: sc,
  };
}

export function mockBenchmarkTrials(definition: BenchmarkDefinition): BenchmarkTrial[] {
  // Deterministic mock: config 0 slightly better pass rate, config 1 cheaper
  const out: BenchmarkTrial[] = [];
  for (const task of definition.tasks) {
    for (const cfg of definition.configs) {
      for (let rep = 1; rep <= definition.repetitions; rep++) {
        const isCfg0 = definition.configs[0]?.id === cfg.id;
        const correctnessPass = isCfg0 ? rep % 3 !== 0 : rep % 2 === 0; // cfg0 66% pass, cfg1 50%
        const scorerPass: Record<string, boolean> = {};
        for (const sName of definition.scorerNames) {
          scorerPass[sName] = correctnessPass && rep !== 2;
        }
        out.push({
          taskId: task.id,
          configId: cfg.id,
          repetition: rep,
          correctnessPass,
          scorerPass,
          costCredits: isCfg0 ? 12 + rep : 8 + rep, // cfg0 more expensive
          note: `trial t=${task.id} c=${cfg.id} r=${rep}`,
        });
      }
    }
  }
  return out;
}

export function mockBenchmarkDefinition(): BenchmarkDefinition {
  return {
    id: "bench_1",
    name: "Implement agent — harness/model/runner comparison",
    agent: "implement",
    tasks: [
      { id: "task_1", prompt: "Add Local development section to README.md from CONTRIBUTING.md, single file, run lint", successCriteria: "README has Local development, lint passes, single file changed, PR opened" },
      { id: "task_2", prompt: "Fix checkout race at app/checkout.ts line 42, add regression test", successCriteria: "race fixed, test covers race, no regression, PR with evidence" },
      { id: "task_3", prompt: "Add pagination to GET /factory?search, case-insensitive", successCriteria: "pagination works, search case-insensitive, tests pass" },
    ],
    configs: [
      { id: "cfg_a", label: "oz + auto + linux-build", harness: "oz", model: "auto", runner: "linux-build" },
      { id: "cfg_b", label: "oz + auto + mac (aarch64)", harness: "oz", model: "auto", runner: "mac" },
    ],
    scorerNames: ["tests-run"],
    repetitions: 3,
  };
}

export function mockSelfImprovementPRs(): SelfImprovementPR[] {
  // 3 newest PRs mock, sin date filter (§10: 3 newest regardless of date range, WarpFactories.md:806)
  const now = Date.now();
  return [
    {
      id: "si_pr_3",
      title: "fix: enforce test evidence before PR (tests-run scorer)",
      prUrl: "https://github.com/acme/payments-service/pull/321",
      factoryName: "payments-factory",
      createdAt: new Date(now - 1 * 86400000).toISOString(),
      scorerName: "tests-run",
      author: "factory-bot",
      status: "open",
      regressions: [
        { runId: "run_101", runUrl: "https://app.warp.dev/runs/run_101", scorerName: "tests-run", label: "tests_skipped", score: 0, reasoning: "No test command found in transcript" },
        { runId: "run_102", runUrl: "https://app.warp.dev/runs/run_102", scorerName: "tests-run", label: "tests_skipped", score: 0, reasoning: "PR without test evidence" },
      ],
    },
    {
      id: "si_pr_2",
      title: "docs: clarify review checklist for security findings",
      prUrl: "https://github.com/acme/payments-service/pull/319",
      factoryName: "payments-factory",
      createdAt: new Date(now - 3 * 86400000).toISOString(),
      scorerName: "security-check",
      author: "factory-bot",
      status: "open",
      regressions: [
        { runId: "run_201", runUrl: "https://app.warp.dev/runs/run_201", scorerName: "security-check", label: "missing_security_review", score: 0, reasoning: "No security checklist applied" },
      ],
    },
    {
      id: "si_pr_1",
      title: "chore: runners — increase linux-build memory for flaky builds",
      prUrl: "https://github.com/acme/payments-service/pull/315",
      factoryName: "payments-factory",
      createdAt: new Date(now - 7 * 86400000).toISOString(),
      scorerName: "build-pass",
      author: "factory-bot",
      status: "merged",
      regressions: [
        { runId: "run_301", runUrl: "https://app.warp.dev/runs/run_301", scorerName: "build-pass", label: "build_failed", score: 0, reasoning: "Build OOM, 8GiB insufficient" },
        { runId: "run_302", runUrl: "https://app.warp.dev/runs/run_302", scorerName: "build-pass", label: "build_failed", score: 0, reasoning: "Flaky due to memory" },
      ],
    },
  ];
}
