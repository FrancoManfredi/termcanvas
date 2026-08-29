import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useWorkItems, getWorkItemStore } from "../../lib/factory/hooks/useWorkItems";
import { deriveRuns, filterRuns, getFactoryRuns, getTeamRuns, groupRunsByWorkItem, totalCost } from "../../lib/factory/domain/run.derive";
import { RunCard } from "./RunCard";
import { RunDetail } from "./RunDetail";

interface Props {
  /** "team" -> todos los runs accesibles, "factory" -> solo runs de esa factory */
  scope: "team" | "factory";
  factoryName?: string; // required when scope === factory
}

function seedIfNeeded() {
  // reuse Activity seeding — useWorkItems already seeds via ActivityBoard, but ensure for direct Runs access
  const store = getWorkItemStore();
  if (store.size() > 0) {
    return;
  }
  // minimal fallback to ensure runs exist even without ActivityBoard mount
  store.create({ factoryName: "payments-factory", title: "Update pin UI to left hover", description: "Origin Slack thread", source: "slack_mention", createdBy: "Benjamin Holmes", sourceRef: "slack:thread" });
  store.create({ factoryName: "payments-factory", title: "Replace ASCII caret with chevron icon", source: "github_issue", createdBy: "Benjamin Holmes" });
  const r1 = store.create({ factoryName: "payments-factory", title: "Adjust Pin Icon Alignment", source: "github_issue", createdBy: "Benjamin Holmes", foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true, reason: "image" } });
  if (r1.ok) store.transition(r1.value!.id, "Reviewing", "implement");
}

export function RunsPage({ scope, factoryName }: Props) {
  seedIfNeeded();

  const [search, setSearch] = useState("");
  const [actorFilter, setActorFilter] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // DIP: inyecta store via useWorkItems hook (depende de abstracción, no concreto)
  const { items } = useWorkItems({ includeTerminals: true });

  const allRuns = useMemo(() => {
    return deriveRuns(items);
  }, [items]);

  const scopedRuns = useMemo(() => {
    if (scope === "factory" && factoryName) {
      const f = getFactoryRuns(allRuns, factoryName);
      return f;
    }
    const t = getTeamRuns(allRuns);
    return t;
  }, [allRuns, scope, factoryName]);

  const filtered = useMemo(() => {
    return filterRuns(scopedRuns, { search: search || undefined, actor: (actorFilter as never) || undefined });
  }, [scopedRuns, search, actorFilter]);

  const grouped = useMemo(() => {
    return groupRunsByWorkItem(filtered);
  }, [filtered]);

  const selectedRun = useMemo(() => {
    if (!selectedId) return null;
    return filtered.find((r) => r.id === selectedId) ?? scopedRuns.find((r) => r.id === selectedId) ?? null;
  }, [selectedId, filtered, scopedRuns]);

  const selectedWorkItemRuns = useMemo(() => {
    if (!selectedRun) return [];
    const allForWI = filtered.filter((r) => r.workItemId === selectedRun.workItemId);
    // fallback to scoped if filtered hides siblings
    if (allForWI.length <= 1) {
      const fallback = scopedRuns.filter((r) => r.workItemId === selectedRun.workItemId);
      return fallback;
    }
    return allForWI;
  }, [selectedRun, filtered, scopedRuns]);

  const total = totalCost(filtered);

  function handleSelect(id: string) {
    setSelectedId(id);
  }
  function handleClose() {
    setSelectedId(null);
  }
  function handleClearFilters() {
    setSearch("");
    setActorFilter("");
  }
  function handleStop(id: string) {
    setToast(`Stop solicitado para ${id} — efectivo inmediato (sin confirmación) per §10 Activity Stop task`);
    setTimeout(() => setToast(null), 2500);
  }
  function handleScore(id: string) {
    setToast(`Score registrado para ${id} — judge evaluará contra rubric`);
    setTimeout(() => setToast(null), 2500);
  }
  function handleBenchmark(id: string) {
    setToast(`Convertido en benchmark task: ${id} (copia input — agregar success criteria antes de launch)`);
    setTimeout(() => setToast(null), 2500);
  }
  function handleViewSession(id: string) {
    setToast(`View session: abriendo shared agent session para ${id} — steer via follow-ups`);
    setTimeout(() => setToast(null), 2500);
  }

  const scopeLabel = scope === "team" ? "Team-level Runs — todos los runs accesibles" : `Factory Runs — solo runs de ${factoryName}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
      {/* Breadcrumb */}
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">{scope === "team" ? "team" : "wilson"}</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Runs</span>
          <span className="hidden text-xs text-zinc-400 sm:inline">— {scopeLabel}</span>
        </div>
        <div className="text-xs text-zinc-500">
          {filtered.length} runs · ${total.toFixed(2)} total · {grouped.size} work items
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por título, actor, transición..."
              className="h-7 w-[280px] rounded-[8px] border border-zinc-200 bg-white py-1 pl-8 pr-3 text-xs focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="h-7 rounded-[8px] border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:border-violet-300 focus:outline-none"
          >
            <option value="">Todos los actors</option>
            <option value="foreman">foreman</option>
            <option value="triage">triage</option>
            <option value="spec">spec</option>
            <option value="implement">implement</option>
            <option value="review">review</option>
            <option value="human">human</option>
          </select>
          {(search || actorFilter) && (
            <button onClick={handleClearFilters} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
              Clear
            </button>
          )}
        </div>
        <div className="ml-auto hidden items-center gap-2 text-xs text-zinc-500 sm:flex">
          <span className="rounded-full bg-zinc-900/[0.06] px-2 py-1">Run = ejecución individual · Work item puede spanear varios runs</span>
        </div>
      </div>

      {/* Two-pane */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* List */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-[#f8f8f8] p-3">
          <div className="mx-auto max-w-[640px] space-y-2">
            {filtered.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-zinc-300 bg-white p-8 text-center">
                <p className="text-sm font-medium text-zinc-700">No hay runs</p>
                <p className="mt-1 text-xs text-zinc-500">Cada workItem.history es un run. Creá work items o ajustá filtros.</p>
              </div>
            ) : (
              <>
                {Array.from(grouped.entries()).map(([workItemId, runs]) => {
                  const wiTitle = runs[0]?.workItemTitle ?? workItemId;
                  const wiCost = totalCost(runs);
                  return (
                    <div key={workItemId} className="rounded-[10px] border border-zinc-200 bg-white p-2">
                      <div className="mb-2 flex items-center justify-between px-1">
                        <span className="truncate text-xs font-[600] text-zinc-700">{wiTitle}</span>
                        <span className="shrink-0 text-[11px] text-zinc-500">
                          {runs.length} run{runs.length > 1 ? "s" : ""} · ${wiCost.toFixed(2)}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {runs
                          .slice()
                          .sort((a, b) => a.at.localeCompare(b.at))
                          .map((run) => {
                            return <RunCard key={run.id} run={run} selected={selectedId === run.id} onSelect={handleSelect} />;
                          })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Detail pane desktop */}
        <div className="hidden w-[420px] shrink-0 border-l border-zinc-200 bg-white lg:flex">
          <RunDetail
            run={selectedRun}
            workItemRuns={selectedWorkItemRuns}
            onClose={handleClose}
            onStop={handleStop}
            onScore={handleScore}
            onConvertBenchmark={handleBenchmark}
            onViewSession={handleViewSession}
          />
        </div>
      </div>

      {/* Mobile overlay */}
      {selectedRun && (
        <div className="fixed inset-0 z-10 flex flex-col bg-white lg:hidden">
          <RunDetail
            run={selectedRun}
            workItemRuns={selectedWorkItemRuns}
            onClose={handleClose}
            onStop={handleStop}
            onScore={handleScore}
            onConvertBenchmark={handleBenchmark}
            onViewSession={handleViewSession}
          />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}
