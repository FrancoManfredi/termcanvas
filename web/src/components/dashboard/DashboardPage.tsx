import { useMemo } from "react";
import { useWorkItems } from "../../lib/factory/hooks/useWorkItems";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import { COST_BUCKETS, bucketCost, DASHBOARD_TOOLTIPS, deriveDashboardMetricsFromItems, isEmpty } from "../../lib/factory/domain/dashboard.derive";
import { MetricCard, MetricCardSkeleton } from "./MetricCard";
import { DashboardEmptyState } from "./DashboardEmptyState";

function formatCost(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toFixed(2)}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) {
    const mins = Math.round(ms / 60000);
    return `${mins} min`;
  }
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function BreakdownList({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="text-[11px] text-zinc-400">Sin datos</p>;
  return (
    <ul className="space-y-1">
      {entries.map(([k, v]) => (
        <li key={k} className="flex justify-between text-[11px]">
          <span className="text-zinc-500">{k}</span>
          <span className="font-medium tabular-nums text-zinc-700">{v}</span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const { items: rawItems, loading } = useWorkItems({ includeTerminals: true }) as { items: unknown[]; loading?: boolean };
  const items = Array.isArray(rawItems) ? rawItems : [];
  const bundleResult = useFactoryBundle();

  const metrics = useMemo(() => {
    const bundle = bundleResult.ok ? bundleResult.value! : null;
    const safeItems = Array.isArray(items) ? (items as never) : ([] as never);
    return deriveDashboardMetricsFromItems(safeItems as never, bundle);
  }, [bundleResult, items]);

  const empty = isEmpty(metrics);

  if (loading) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
        <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="font-medium text-zinc-900">Dashboard</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto grid max-w-[1080px] gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <MetricCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">Dashboard</span>
        </div>
        <span className="ml-auto text-[11px] text-zinc-500">Métricas derivadas — sin hardcodeados</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px] space-y-4">
          {empty ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DashboardEmptyState title="Total runs" message="Sin datos todavía — Tus métricas van a aparecer acá cuando tu factory tenga actividad" />
                <DashboardEmptyState title="PRs opened" message="Sin PRs todavía" />
                <DashboardEmptyState title="PRs merged" message="Sin PRs mergeados" />
                <DashboardEmptyState title="Autonomy %" message="Sin datos de autonomía" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DashboardEmptyState title="PR cycle time" message="Sin cycle time — todavía no hay PRs mergeados" />
                <DashboardEmptyState title="Cost per PR" message="Sin costos registrados" />
                <DashboardEmptyState title="Scorer cards" message="Sin scorers configurados" />
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <DashboardEmptyState title="Most expensive PRs" message="Sin PRs con costo" />
                <DashboardEmptyState title="Self-improvement PRs" message="Sin PRs" />
              </div>
              <DashboardEmptyState title="Charts — PRs opened vs merged" message="Sin datos para graficar — conectá un repo o corré tu primer agente" />
              <p className="text-center text-[11px] text-zinc-400">Cost per PR es estimate. Dashboard para elegir qué runs investigar, no para concluir causalidad.</p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard title="Total runs" value={metrics.totalRuns.total} subtitle="Todos los agent runs" tooltip={DASHBOARD_TOOLTIPS.totalRuns}>
                  <BreakdownList data={metrics.totalRuns.breakdown.byStage} />
                  <div className="mt-2 text-[11px] text-zinc-400">Activos {metrics.totalRuns.breakdown.byStatus.active} · Terminales {metrics.totalRuns.breakdown.byStatus.terminal}</div>
                  <div className="mt-2">
                    <div className="text-[11px] font-medium text-zinc-500">Por source</div>
                    <BreakdownList data={metrics.totalRuns.breakdown.bySource} />
                  </div>
                </MetricCard>

                <MetricCard title="PRs opened" value={metrics.prsOpened} subtitle="PRs creados por factory work" tooltip={DASHBOARD_TOOLTIPS.prsOpened} />

                <MetricCard title="PRs merged" value={metrics.prsMerged} subtitle="De los PRs opened, cuántos mergearon" tooltip={DASHBOARD_TOOLTIPS.prsMerged} />

                <MetricCard title="Autonomy %" value={formatPct(metrics.autonomyPct)} subtitle="% merged sin human push" tooltip={DASHBOARD_TOOLTIPS.autonomyPct} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard title="PR cycle time" value={formatDuration(metrics.prCycleTimeMedianMs)} subtitle="Mediana merged PRs" tooltip={DASHBOARD_TOOLTIPS.prCycleTime}>
                  <ul className="space-y-1">
                    {Object.entries(metrics.prCycleTimeByStageMedianMs).map(([stage, ms]) => (
                      <li key={stage} className="flex justify-between text-[11px]">
                        <span className="text-zinc-500">{stage}</span>
                        <span className="font-medium tabular-nums text-zinc-700">{formatDuration(ms)}</span>
                      </li>
                    ))}
                  </ul>
                </MetricCard>

                <MetricCard title="Cost per PR" value={formatCost(metrics.costPerPrMedian)} subtitle="Mediana costo PRs opened" tooltip={DASHBOARD_TOOLTIPS.costPerPr}>
                  <div className="text-[11px] text-zinc-500">{metrics.costPerPrList.length} PR costs registrados</div>
                  {metrics.costPerPrList.length > 0 && (
                    <div className="mt-1 text-[11px] text-zinc-400">Min {formatCost(Math.min(...metrics.costPerPrList))} · Max {formatCost(Math.max(...metrics.costPerPrList))}</div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white">S ≤{COST_BUCKETS.S}</span>
                    <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-600">M ≤{COST_BUCKETS.M}</span>
                    <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-600">L ≤{COST_BUCKETS.L}</span>
                    <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-600">XL &gt;{COST_BUCKETS.L}</span>
                  </div>
                  {metrics.mostExpensivePrs.length > 0 && <div className="mt-2 text-[11px] text-zinc-500">Bucket ejemplo: {bucketCost(metrics.mostExpensivePrs[0].cost)}</div>}
                </MetricCard>

                <MetricCard title="Scorer cards" value={metrics.scorerCards.length} subtitle="Resultados de Scorers" tooltip={DASHBOARD_TOOLTIPS.scorerCards}>
                  {metrics.scorerCards.length === 0 ? (
                    <p className="text-[11px] text-zinc-400">Sin scorers</p>
                  ) : (
                    <ul className="space-y-2">
                      {metrics.scorerCards.map((sc) => (
                        <li key={sc.name} className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                          <div className="text-[12px] font-medium text-zinc-800">{sc.name}</div>
                          {sc.description && <div className="mt-0.5 text-[11px] text-zinc-500">{sc.description}</div>}
                          <div className="mt-1 text-[11px] text-zinc-500">agents: {sc.agents.join(", ")} · modelo {sc.model} · sampling {sc.samplingRate ?? 25}% {sc.selfImprovement ? "· self-improvement ON" : ""}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </MetricCard>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-[12px] border border-zinc-200 bg-white p-4">
                  <div className="flex items-center gap-1.5">
                    <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Most expensive PRs</div>
                    <span className="group relative inline-flex" tabIndex={0} aria-label={DASHBOARD_TOOLTIPS.mostExpensivePrs} title={DASHBOARD_TOOLTIPS.mostExpensivePrs}>
                      <span className="grid h-4 w-4 place-items-center rounded-full border border-zinc-200 bg-white text-[10px] font-bold leading-none text-zinc-500">ⓘ</span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 hidden max-w-[260px] -translate-x-1/2 rounded-[6px] border border-zinc-200 bg-zinc-900 px-2 py-1 text-[11px] text-white group-hover:block group-focus:block" role="tooltip">
                        {DASHBOARD_TOOLTIPS.mostExpensivePrs}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">PRs de mayor costo</div>
                  {metrics.mostExpensivePrs.length === 0 ? (
                    <p className="mt-3 text-[12px] text-zinc-400">Sin PRs con costo</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {metrics.mostExpensivePrs.map((pr) => (
                        <li key={pr.prUrl} className="flex items-center justify-between rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium text-zinc-800">{pr.title}</div>
                            <a href={pr.prUrl} target="_blank" rel="noreferrer noopener" className="truncate text-[11px] text-violet-600 hover:underline">{pr.prUrl}</a>
                          </div>
                          <span className="ml-3 shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-medium tabular-nums text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">{formatCost(pr.cost)} · {bucketCost(pr.cost)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <MetricCard title="Self-improvement PRs" value={metrics.selfImprovementPrs.length} subtitle="Los 3 newest Self-improvement PRs" tooltip={DASHBOARD_TOOLTIPS.selfImprovementPrs}>
                  {metrics.selfImprovementPrs.length === 0 ? (
                    <p className="text-[11px] text-zinc-400">Sin PRs</p>
                  ) : (
                    <ul className="space-y-2">
                      {metrics.selfImprovementPrs.map((pr) => (
                        <li key={pr.prUrl} className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                          <div className="text-[12px] font-medium text-zinc-800">{pr.title}</div>
                          <a href={pr.prUrl} target="_blank" rel="noreferrer noopener" className="truncate text-[11px] text-violet-600 hover:underline">{pr.prUrl}</a>
                          <div className="mt-1 text-[11px] text-zinc-400">{new Date(pr.createdAt).toLocaleDateString()} · {pr.workItemId}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </MetricCard>
              </div>

              <div className="rounded-[12px] border border-zinc-200 bg-white p-4">
                <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Charts — PRs opened vs merged · Breakdown de runs</div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-[8px] border border-dashed border-zinc-200 bg-zinc-50 p-3 text-center">
                    <div className="text-[11px] text-zinc-500">Opened</div>
                    <div className="text-[18px] font-semibold tabular-nums text-zinc-900">{metrics.prsOpened}</div>
                    <div className="mx-auto mt-2 h-2 w-full max-w-[120px] rounded-full bg-zinc-200"><div className="h-2 rounded-full bg-violet-500" style={{ width: `${metrics.prsOpened ? 100 : 0}%` }} /></div>
                  </div>
                  <div className="rounded-[8px] border border-dashed border-zinc-200 bg-zinc-50 p-3 text-center">
                    <div className="text-[11px] text-zinc-500">Merged</div>
                    <div className="text-[18px] font-semibold tabular-nums text-zinc-900">{metrics.prsMerged}</div>
                    <div className="mx-auto mt-2 h-2 w-full max-w-[120px] rounded-full bg-zinc-200"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${metrics.prsOpened ? (metrics.prsMerged / metrics.prsOpened) * 100 : 0}%` }} /></div>
                  </div>
                  <div className="rounded-[8px] border border-dashed border-zinc-200 bg-zinc-50 p-3 text-center">
                    <div className="text-[11px] text-zinc-500">Total runs</div>
                    <div className="text-[18px] font-semibold tabular-nums text-zinc-900">{metrics.totalRuns.total}</div>
                    <div className="mt-1 text-[11px] text-zinc-400">higher run count con flat PR count puede indicar retries</div>
                  </div>
                </div>
              </div>

              <p className="text-center text-[11px] text-zinc-400">Cost per PR es estimate. Dashboard para elegir qué runs investigar.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function DashboardPageWithStore() {
  return <DashboardPage />;
}
