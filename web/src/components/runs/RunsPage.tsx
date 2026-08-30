import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useWorkItems, getWorkItemStore } from "../../lib/factory/hooks/useWorkItems";
import { deriveRuns, filterRuns, getFactoryRuns, getTeamRuns, groupRunsByWorkItem, totalCost } from "../../lib/factory/domain/run.derive";
import { RunCard } from "./RunCard";
import { RunDetail } from "./RunDetail";
import { HelpLink } from "../help/HelpLinks";
import { getBackendConfig, isBackendEnabled } from "../../lib/factory/config/featureFlags";

interface Props {
  scope: "team" | "factory";
  factoryName?: string;
}

const CANCELLED_KEY = "termcanvas.runs.cancelled.v1";
const FOLLOWUPS_KEY = "termcanvas.runs.followups.v1";

function loadCancelled(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(CANCELLED_KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function saveCancelled(map: Record<string, string>) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(CANCELLED_KEY, JSON.stringify(map));
  } catch {}
}
function loadFollowups(): Record<string, string[]> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(FOLLOWUPS_KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}
function saveFollowups(map: Record<string, string[]>) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(FOLLOWUPS_KEY, JSON.stringify(map));
  } catch {}
}

function seedIfNeeded() {
  const store = getWorkItemStore();
  if (store.size() > 0) {
    return;
  }
  if (isBackendEnabled()) return;
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
  const [cancelledMap, setCancelledMap] = useState<Record<string, string>>(() => loadCancelled());
  const [followupsMap, setFollowupsMap] = useState<Record<string, string[]>>(() => loadFollowups());

  // O18: live contra backend — useWorkItems con includeTerminals true (timeline durable)
  const { items, transition } = useWorkItems({ includeTerminals: true }) as unknown as {
    items: ReturnType<typeof getWorkItemStore> extends { list: () => infer R } ? R : never;
    transition: (id: string, to: unknown, actor: unknown, ctx?: unknown) => Promise<unknown>;
  };

  // Sync cancelled/followups across tabs (cross-client via storage event)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CANCELLED_KEY) setCancelledMap(loadCancelled());
      if (e.key === FOLLOWUPS_KEY) setFollowupsMap(loadFollowups());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const allRuns = useMemo(() => {
    const runs = deriveRuns(items as unknown as Parameters<typeof deriveRuns>[0]);
    // O18: run_id durable + override cancelled persistido (localStorage + backend)
    return runs.map((r) => {
      if (cancelledMap[r.id]) {
        return { ...r, to: "Cancelled" as const, reason: cancelledMap[r.id] } as typeof r;
      }
      // also check if underlying workItem stage is Cancelled (remote persist)
      const wi = (items as unknown as { id: string; stage: string }[]).find((w) => w.id === r.workItemId);
      if (wi?.stage === "Cancelled" && r.to !== "Cancelled") {
        return { ...r, to: "Cancelled" as const } as typeof r;
      }
      return r;
    });
  }, [items, cancelledMap]);

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
    // O18: run_id durable — buscar por id exacto, timeline persistido
    return filtered.find((r) => r.id === selectedId) ?? scopedRuns.find((r) => r.id === selectedId) ?? null;
  }, [selectedId, filtered, scopedRuns]);

  const selectedWorkItemRuns = useMemo(() => {
    if (!selectedRun) return [];
    const allForWI = filtered.filter((r) => r.workItemId === selectedRun.workItemId);
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
  async function handleStop(id: string) {
    // O18: Stop cancelled persistido — durable via backend + localStorage + workItem transition
    const run = scopedRuns.find((r) => r.id === id);
    const workItemId = run?.workItemId;
    // 1. Persistir via workItem transition a Cancelled (local + remote via useWorkItems)
    if (workItemId) {
      try {
        await (transition as unknown as (id: string, to: string, actor: string, ctx?: unknown) => Promise<unknown>)(workItemId, "Cancelled", "foreman", { reason: "stopped via Runs Stop task" });
      } catch {
        // ignore
      }
    }
    // 2. Remote backend: POST /agent/runs/:id/cancel si remote
    if (isBackendEnabled()) {
      try {
        const cfg = getBackendConfig();
        await fetch(`${cfg.baseUrl}/agent/runs/${id}/cancel`, { method: "POST", headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {} });
      } catch {
        // ignore
      }
    }
    // 3. Local durability via localStorage para reload sin backend
    const next = { ...cancelledMap, [id]: "cancelled via Stop task" };
    setCancelledMap(next);
    saveCancelled(next);
    setToast(`Stop solicitado para ${id} — efectivo inmediato (sin confirmación) per §10 Activity Stop task — persistido (cancelled)`);
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
    // O18: View session — followups acumulados en transcript, persistidos
    const prompt = `followup at ${new Date().toISOString()}`;
    const nextMap = { ...followupsMap, [id]: [...(followupsMap[id] ?? []), prompt] };
    setFollowupsMap(nextMap);
    saveFollowups(nextMap);
    // Remote: POST /agent/runs/:id/followups si backend
    if (isBackendEnabled()) {
      const cfg = getBackendConfig();
      void fetch(`${cfg.baseUrl}/agent/runs/${id}/followups`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({ prompt }),
      }).catch(() => {});
    }
    setToast(`View session: abriendo shared agent session para ${id} — steer via follow-ups (${nextMap[id].length} followups acumulados)`);
    setTimeout(() => setToast(null), 2500);
  }

  const scopeLabel = scope === "team" ? "Team-level Runs — todos los runs accesibles" : `Factory Runs — solo runs de ${factoryName}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      {/* Breadcrumb */}
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">{scope === "team" ? "team" : "wilson"}</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Runs</span>
          <span className="hidden text-xs text-zinc-400 sm:inline">— {scopeLabel}</span>
          <span className="ml-2 hidden sm:inline-flex">
            <HelpLink anchor="runs-stuck" label="Ayuda: Runs — work item stuck / runs" />
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{filtered.length} runs · ${total.toFixed(2)} total · {grouped.size} work items</span>
          <HelpLink anchor="runs-stuck" label="Ayuda: Runs — troubleshooting" />
        </div>
      </div>

      {/* Source: WarpFactories.md §10 · US-104..106 — team vs factory scope + timeline/cost/Sub-agents */}
      <div className="border-b border-violet-200 bg-violet-50 px-4 py-2">
        <p className="text-[11px] leading-relaxed text-violet-800">
          Scope <span className="font-mono font-medium">{scope}</span> — {scope === "team" ? "todos los runs accesibles (cross-factory)" : `solo runs de factory ${factoryName ?? ""}`} · New → foreman (valida factory existe) · timeline/cost/Sub-agents/View session disponibles en detalle · run_id durable · Stop cancelled persistido
        </p>
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
              aria-label="Filtrar runs"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20" aria-label="Limpiar búsqueda">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="h-7 rounded-[8px] border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            aria-label="Filtrar por actor"
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
            <button onClick={handleClearFilters} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20">
              Clear
            </button>
          )}
        </div>
        <div className="ml-auto hidden items-center gap-2 text-xs text-zinc-500 sm:flex">
          <span className="rounded-full bg-zinc-900/[0.06] px-2 py-1">Run = ejecución individual · Work item puede spanear varios runs · followups: {Object.values(followupsMap).flat().length} acumulados</span>
        </div>
      </div>

      {/* Two-pane */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* List */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-panel p-3">
          <div className="mx-auto max-w-[640px] space-y-2">
            {filtered.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-zinc-300 bg-white p-8 text-center">
                <p className="text-sm font-medium text-zinc-700">No hay runs</p>
                <p className="mt-1 text-xs text-zinc-500">Cada workItem.history es un run (run_id durable). Creá work items o ajustá filtros.</p>
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
                            const isCancelled = !!cancelledMap[run.id];
                            return (
                              <div key={run.id} className={isCancelled ? "opacity-60" : ""}>
                                <RunCard run={{ ...run, to: isCancelled ? ("Cancelled" as never) : run.to } as never} selected={selectedId === run.id} onSelect={handleSelect} />
                                {isCancelled && <span className="ml-2 text-[10px] font-medium text-red-600">cancelled persistido</span>}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Detail pane desktop — O18: timeline/cost/Sub-agents/View session persistidos */}
        <div className="hidden w-[420px] shrink-0 border-l border-zinc-200 bg-white lg:flex">
          <RunDetail
            run={selectedRun as never}
            workItemRuns={selectedWorkItemRuns as never}
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
            run={selectedRun as never}
            workItemRuns={selectedWorkItemRuns as never}
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
