// Benchmark domain — pure types, no I/O
// WarpFactories.md §11: Benchmarks compare 1 agent on fixed tasks across N configs + repetitions
// Scorers + Correctness built-in, no winner chosen, credit totals exclude model usage

import type { HarnessType } from "./types";

export interface BenchmarkTask {
  id: string;
  prompt: string;
  successCriteria: string;
}

export interface BenchmarkConfig {
  id: string;
  label: string;
  harness: HarnessType;
  model: string;
  runner: string;
}

export interface BenchmarkDefinition {
  id: string;
  name: string;
  /** single agent whose configs are compared — Warp §11 */
  agent: string;
  tasks: BenchmarkTask[];
  configs: BenchmarkConfig[];
  /** scorer names applied to each trial */
  scorerNames: string[];
  /** trials per task+config */
  repetitions: number;
}

export interface BenchmarkTrial {
  taskId: string;
  configId: string;
  repetition: number;
  /** Correctness built-in: pass/fail vs successCriteria */
  correctnessPass: boolean;
  /** per-scorer pass map */
  scorerPass: Record<string, boolean>;
  /** cost in credits — model usage excluded (§11: credit totals no incluyen model usage) */
  costCredits: number;
  /** optional per-trial note for per-task detail */
  note?: string;
}

export interface BenchmarkConfigResult {
  configId: string;
  label: string;
  harness: HarnessType;
  model: string;
  runner: string;
  totalTrials: number;
  correctnessPassRate: number; // 0..1
  avgCostCredits: number;
  /** avg scorer pass rate across scorerNames, 0..1, null if no scorers */
  avgQuality: number | null;
  perTaskPass: Record<string, number>; // taskId -> passRate for that config
}

export interface BenchmarkDerived {
  definition: BenchmarkDefinition;
  trials: BenchmarkTrial[];
  configResults: BenchmarkConfigResult[];
  /** Warn: Warp no elige ganador — consumer must weigh signals */
  winnerChosen: false;
}

export interface BenchmarkSelfImprovementPR {
  id: string;
  title: string;
  prUrl: string;
  factoryName: string;
  createdAt: string;
  scorerName: string;
  author: string;
  /** Regressions addressed — links failing runs + scorer results (§11, §10:806) */
  regressions: Array<{
    runId: string;
    runUrl: string;
    scorerName: string;
    label: string;
    score: number;
    reasoning: string;
  }>;
  status: "open" | "merged" | "closed";
}

export const BENCHMARK_ENDPOINT = "https://app.warp.dev/api/v1/factory";
export const CREDIT_DISCLAIMER = "credit totals no incluyen model usage → costo real mayor";
