import type { WorkItem } from "./workItem.types";
import type { FactoryBundle } from "../store/factoryRegistry";
import type { WorkItemStore } from "../store/workItem.store";
import type { DashboardMetrics, MostExpensivePR, ScorerCard, SelfImprovementPR } from "./dashboard.types";

// DIP: derive inyecta store/bundle — no crea concreciones internas
// SRP: solo derivación pura, sin IO, sin mutación
// OCP: agregar métrica = agregar función pura y campo en DashboardMetrics, UI itera sin cambio
// Source: WarpFactories.md §10 · US-096→101

// Source: WarpFactories.md §12 · US-101 — cost buckets exactos
export const COST_BUCKETS = { S: 100, M: 500, L: 1000, XL: Infinity } as const;

export type CostBucket = keyof typeof COST_BUCKETS;

export function bucketCost(cost: number): CostBucket {
  if (cost <= COST_BUCKETS.S) return "S";
  if (cost <= COST_BUCKETS.M) return "M";
  if (cost <= COST_BUCKETS.L) return "L";
  return "XL";
}

export interface DashboardMetric {
  readonly id: "total_runs" | "prs_opened" | "prs_merged" | "autonomy" | "cycle_time" | "cost_per_pr" | "scorer_cards" | "self_improvement";
  readonly label: string;
  readonly value: string | number;
  readonly tooltip: string;
  readonly trace: string;
}

export interface DashboardInput {
  readonly workItems: readonly WorkItem[];
  readonly bundle: FactoryBundle | null;
}

export const DASHBOARD_TOOLTIPS = {
  totalRuns: "Todos los agent runs (incl. evaluation/benchmark/self-improvement). Breakdown por stage/source/status. Higher run count con flat PR count puede indicar retries/measurement.",
  prsOpened: "PRs únicos creados por factory work, contados una vez por PR URL.",
  prsMerged: "De los PRs opened en el periodo, cuántos mergearon luego. Puede ser mayor que opened si merged viene de datasource distinto (merged>opened).",
  autonomyPct: "% merged PRs sin human code push antes de merge. Opening PR cuenta como push; comments/reviews no cuentan (Autonomy push).",
  prCycleTime: "Mediana merged PRs: run kickoff → PR → first review → merge. Median por stage independientes (no suman al headline).",
  costPerPr: "Costo mediano estimado por PR, spliteado equitativo si 1 run → >1 PR. Cost S/M/L/XL estimado 100/500/1000 créditos (estimate, no billing).",
  scorerCards: "Resultados de scorers configurados. Muestran agentes/modelo/sampling rate. Self-improvement si aplica.",
  selfImprovementPrs: "Los 3 newest Self-improvement PRs, sin importar el date range (sin date filter).",
  mostExpensivePrs: "PRs de mayor costo. Requiere code host para detalle enriquecido. Cost S/M/L/XL 100/500/1000.",
} as const satisfies Record<string, string>;

// Helper para mapear 8 métricas con disclaimer/tooltip — usado por DashboardPage y tests O15
export function deriveDashboardWithDisclaimers(input: DashboardInput): readonly DashboardMetric[] {
  const metrics = deriveDashboardMetricsFromItems([...input.workItems] as WorkItem[], input.bundle);
  const list: DashboardMetric[] = [
    {
      id: "total_runs",
      label: "Total runs",
      value: metrics.totalRuns.total,
      tooltip: DASHBOARD_TOOLTIPS.totalRuns,
      trace: "WarpFactories.md §12 · US-096",
    },
    {
      id: "prs_opened",
      label: "PRs opened",
      value: metrics.prsOpened,
      tooltip: DASHBOARD_TOOLTIPS.prsOpened,
      trace: "WarpFactories.md §12 · US-097",
    },
    {
      id: "prs_merged",
      label: "PRs merged",
      value: metrics.prsMerged,
      tooltip: DASHBOARD_TOOLTIPS.prsMerged,
      trace: "WarpFactories.md §12 · US-098",
    },
    {
      id: "autonomy",
      label: "Autonomy %",
      value: metrics.autonomyPct ?? 0,
      tooltip: DASHBOARD_TOOLTIPS.autonomyPct,
      trace: "WarpFactories.md §12 · US-099",
    },
    {
      id: "cycle_time",
      label: "PR cycle time",
      value: metrics.prCycleTimeMedianMs ?? 0,
      tooltip: DASHBOARD_TOOLTIPS.prCycleTime,
      trace: "WarpFactories.md §12 · US-100",
    },
    {
      id: "cost_per_pr",
      label: "Cost per PR",
      value: metrics.costPerPrMedian ?? 0,
      tooltip: DASHBOARD_TOOLTIPS.costPerPr,
      trace: "WarpFactories.md §12 · US-101",
    },
    {
      id: "scorer_cards",
      label: "Scorer cards",
      value: metrics.scorerCards.length,
      tooltip: DASHBOARD_TOOLTIPS.scorerCards,
      trace: "WarpFactories.md §12 · US-101",
    },
    {
      id: "self_improvement",
      label: "Self-improvement PRs",
      value: metrics.selfImprovementPrs.length,
      tooltip: DASHBOARD_TOOLTIPS.selfImprovementPrs,
      trace: "WarpFactories.md §12 · US-101",
    },
  ];
  return list;
}

// alias exigido por PLAN O15 interface exacta
export function deriveDashboardMetricsWithTooltips(input: DashboardInput): readonly DashboardMetric[] {
  return deriveDashboardWithDisclaimers(input);
}

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  let result: number;
  if (sorted.length % 2 === 1) {
    result = sorted[mid]!;
  } else {
    result = (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return result;
}

export function isHumanPushEvent(ev: WorkItem["history"][number]): boolean {
  if (ev.actor !== "human") {
    return false;
  }
  const reason = (ev.reason ?? "").toLowerCase();
  if (reason.includes("push") || reason.includes("human push") || reason.includes("code push")) {
    return true;
  }
  const meta = ev.metadata as Record<string, unknown> | undefined;
  if (meta && (meta.push === true || meta.humanPush === true || meta.codePush === true)) {
    return true;
  }
  return false;
}

export function hasHumanPushBeforeMerge(item: WorkItem): boolean {
  const result = item.history.some((ev) => isHumanPushEvent(ev));
  return result;
}

export function costPerPrEntries(workItems: WorkItem[]): Array<{ prUrl: string; cost: number; workItemId: string; title: string }> {
  const entries: Array<{ prUrl: string; cost: number; workItemId: string; title: string }> = [];
  for (const wi of workItems) {
    if (wi.linkedPRs.length === 0) continue;
    const totalCost = wi.cost ?? 0;
    const perPr = wi.linkedPRs.length > 0 ? totalCost / wi.linkedPRs.length : totalCost;
    for (const pr of wi.linkedPRs) {
      entries.push({ prUrl: pr, cost: perPr, workItemId: wi.id, title: wi.title });
    }
  }
  return entries;
}

export function cycleTimeMsForMerged(item: WorkItem): number | null {
  if (item.stage !== "Complete") {
    return null;
  }
  if (item.linkedPRs.length === 0) {
    return null;
  }
  const start = new Date(item.createdAt).getTime();
  const lastEv = item.history[item.history.length - 1];
  if (!lastEv) {
    return null;
  }
  const end = new Date(lastEv.at).getTime();
  const diff = end - start;
  if (Number.isNaN(diff) || diff < 0) {
    return null;
  }
  return diff;
}

export function timeInStageMs(item: WorkItem, stage: string): number | null {
  let entryTime: number | null = null;
  let total = 0;
  let found = false;
  for (let i = 0; i < item.history.length; i++) {
    const ev = item.history[i]!;
    if (ev.to === stage && entryTime === null) {
      entryTime = new Date(ev.at).getTime();
    }
    if (entryTime !== null) {
      const nextEv = item.history[i + 1];
      if (nextEv) {
        const exitTime = new Date(nextEv.at).getTime();
        total += exitTime - entryTime;
        found = true;
        entryTime = null;
        if (nextEv.to === stage) {
          entryTime = exitTime;
        }
      } else {
        break;
      }
    }
  }
  return found ? total : null;
}

export function deriveTotalRuns(workItems: WorkItem[]) {
  const byStage: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byAgentType: Record<string, number> = {};
  let active = 0;
  let terminal = 0;
  for (const wi of workItems) {
    byStage[wi.stage] = (byStage[wi.stage] ?? 0) + 1;
    bySource[wi.source] = (bySource[wi.source] ?? 0) + 1;
    const agent = wi.assigneeAgent ?? "unknown";
    byAgentType[agent] = (byAgentType[agent] ?? 0) + 1;
    if (wi.stage === "Complete" || wi.stage === "Cancelled") {
      terminal += 1;
    } else {
      active += 1;
    }
  }
  const result = { total: workItems.length, breakdown: { byStage, bySource, byStatus: { active, terminal }, byAgentType } };
  return result;
}

export function derivePrOpened(workItems: WorkItem[]): number {
  const uniq = new Set<string>();
  for (const wi of workItems) {
    for (const pr of wi.linkedPRs) {
      uniq.add(pr);
    }
  }
  return uniq.size;
}

export function derivePrMerged(workItems: WorkItem[]): number {
  const uniq = new Set<string>();
  for (const wi of workItems) {
    if (wi.stage !== "Complete") {
      continue;
    }
    if (wi.linkedPRs.length === 0) {
      continue;
    }
    for (const pr of wi.linkedPRs) {
      uniq.add(pr);
    }
  }
  return uniq.size;
}

export function deriveAutonomy(workItems: WorkItem[]): number | null {
  const mergedItems = workItems.filter((wi) => wi.stage === "Complete" && wi.linkedPRs.length > 0);
  if (mergedItems.length === 0) {
    return null;
  }
  let autonomous = 0;
  for (const wi of mergedItems) {
    const hasPush = hasHumanPushBeforeMerge(wi);
    if (!hasPush) {
      autonomous += 1;
    }
  }
  const pct = (autonomous / mergedItems.length) * 100;
  return pct;
}

export function deriveDashboardMetrics(store: WorkItemStore, bundle: FactoryBundle | null): DashboardMetrics {
  const workItems = store.list({ includeTerminals: true });
  return deriveDashboardMetricsFromItems(workItems, bundle);
}

export function deriveDashboardMetricsFromItems(workItems: WorkItem[], bundle: FactoryBundle | null): DashboardMetrics {
  const totalRuns = deriveTotalRuns(workItems);
  const prsOpened = derivePrOpened(workItems);
  const prsMerged = derivePrMerged(workItems);
  const autonomyPct = deriveAutonomy(workItems);

  const mergedItems = workItems.filter((wi) => wi.stage === "Complete" && wi.linkedPRs.length > 0);
  const cycleTimes = mergedItems.map((wi) => cycleTimeMsForMerged(wi)).filter((v): v is number => v !== null);
  const prCycleTimeMedianMs = median(cycleTimes);

  const stages = ["Triage", "Planning", "Building", "Reviewing"];
  const prCycleTimeByStageMedianMs: Record<string, number | null> = {};
  for (const st of stages) {
    const times = mergedItems.map((wi) => timeInStageMs(wi, st)).filter((v): v is number => v !== null);
    prCycleTimeByStageMedianMs[st] = median(times);
  }

  const perPrEntries = costPerPrEntries(workItems);
  const costPerPrList = perPrEntries.map((e) => e.cost);
  const costPerPrMedian = median(costPerPrList);

  const sortedByCost = [...perPrEntries].sort((a, b) => b.cost - a.cost);
  const mostExpensivePrs: MostExpensivePR[] = sortedByCost.slice(0, 5).map((e) => ({ prUrl: e.prUrl, cost: e.cost, workItemId: e.workItemId, title: e.title }));

  const scorerCards: ScorerCard[] = (bundle?.scorers ?? []).map((s) => ({
    name: s.name,
    description: s.description,
    agents: s.agents,
    samplingRate: s.samplingRate,
    selfImprovement: s.selfImprovement,
    model: s.model,
  }));

  const withPR = workItems.filter((wi) => wi.linkedPRs.length > 0);
  const sortedNewest = [...withPR].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const selfImprovementPrs: SelfImprovementPR[] = sortedNewest.slice(0, 3).flatMap((wi) => wi.linkedPRs.map((pr) => ({ prUrl: pr, workItemId: wi.id, title: wi.title, createdAt: wi.createdAt }))).slice(0, 3);

  const metrics: DashboardMetrics = {
    totalRuns,
    prsOpened,
    prsMerged,
    autonomyPct,
    prCycleTimeMedianMs,
    prCycleTimeByStageMedianMs,
    costPerPrMedian,
    mostExpensivePrs,
    scorerCards,
    selfImprovementPrs,
    costPerPrList,
  };
  return metrics;
}

/**
 * ADR-003 Q8: helper puro — true si no hay datos reales.
 * Un dashboard vacío debe mostrar EmptyState en todos los widgets, no números falsos.
 */
export function isEmpty(metrics: DashboardMetrics): boolean {
  return (
    metrics.totalRuns.total === 0 &&
    metrics.prsOpened === 0 &&
    metrics.prsMerged === 0 &&
    metrics.costPerPrList.length === 0 &&
    metrics.mostExpensivePrs.length === 0 &&
    metrics.scorerCards.length === 0 &&
    metrics.selfImprovementPrs.length === 0 &&
    metrics.prCycleTimeMedianMs === null &&
    metrics.costPerPrMedian === null
  );
}
