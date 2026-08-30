
// Dashboard metrics — nombres exactos WarpFactories.md §10 tabla línea 796
// OCP: agregar métrica = agregar campo aquí + derive, sin tocar UI si itera sobre entries
// DIP: tipos puros, sin dependencias concretas

export interface TotalRunsBreakdown {
  byStage: Record<string, number>;
  bySource: Record<string, number>;
  byStatus: { active: number; terminal: number };
  byAgentType: Record<string, number>;
}

export interface TotalRunsMetric {
  /** "Total runs" — todos los agent runs */
  total: number;
  breakdown: TotalRunsBreakdown;
}

export interface ScorerCard {
  /** "Scorer cards" — resultado de Scorers configurados */
  name: string;
  description?: string;
  agents: string[];
  samplingRate?: number;
  selfImprovement?: boolean;
  model: string;
}

export interface MostExpensivePR {
  /** "Most expensive PRs" */
  prUrl: string;
  cost: number;
  workItemId: string;
  title: string;
}

export interface SelfImprovementPR {
  /** "Self-improvement PRs" — 3 newest sin importar date range */
  prUrl: string;
  workItemId: string;
  title: string;
  createdAt: string;
}

export interface DashboardMetrics {
  /** "Total runs" */
  totalRuns: TotalRunsMetric;
  /** "PRs opened" */
  prsOpened: number;
  /** "PRs merged" */
  prsMerged: number;
  /** "Autonomy %" */
  autonomyPct: number | null;
  /** "PR cycle time" mediana ms, null si no hay merged */
  prCycleTimeMedianMs: number | null;
  /** Breakdown mediana por stage para cycle time (no suman al headline) */
  prCycleTimeByStageMedianMs: Record<string, number | null>;
  /** "Cost per PR" mediana */
  costPerPrMedian: number | null;
  /** "Most expensive PRs" */
  mostExpensivePrs: MostExpensivePR[];
  /** "Scorer cards" */
  scorerCards: ScorerCard[];
  /** "Self-improvement PRs" */
  selfImprovementPrs: SelfImprovementPR[];
  /** lista plana de costos por PR (para breakdown) */
  costPerPrList: number[];
}

export interface DashboardDeriveInput {
  workItems: import("./workItem.types").WorkItem[];
  bundle: import("../store/factoryRegistry").FactoryBundle | null;
}
