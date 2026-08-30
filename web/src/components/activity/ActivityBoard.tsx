import { useMemo, useState, useEffect } from "react";
import { Search, Plus, SlidersHorizontal } from "lucide-react";
import { useWorkItems, getWorkItemStore } from "../../lib/factory/hooks/useWorkItems";
import { ACTIVE_STAGES, ALL_STAGES } from "../../lib/factory/domain/workItem.types";
import type { WorkItemStage } from "../../lib/factory/domain/workItem.types";
import { ActivityDetail } from "./ActivityDetail";
import { HelpLink } from "../help/HelpLinks";


function hashForItem(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 0xffffff;
  const hex = h.toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
  return hex;
}

// Source: WarpFactories.md §10 · US-102 — Activity kanban Created by=you + 4 active por defecto
export const ACTIVITY_DEFAULT_CREATED_BY = "you";
export const ACTIVITY_DEFAULT_INCLUDE_TERMINALS = false;

function seedIfEmpty() {
  const store = getWorkItemStore();
  if (store.size() > 0) {
    return;
  }
  // Determinístico, sin Math.random — OCP puro domain + UI
  const creator = ACTIVITY_DEFAULT_CREATED_BY;
  // Triage 4 — todos con createdBy=you para default filter
  store.create({ factoryName: "payments-factory", title: "Update pin UI to left hover", description: "Origin Slack thread", source: "slack_mention", createdBy: creator, sourceRef: "slack:thread" });
  store.create({ factoryName: "payments-factory", title: "Replace ASCII caret with chevron icon", source: "github_issue", createdBy: creator });
  store.create({ factoryName: "payments-factory", title: "Debug GitHub Permissions Issue", source: "github_issue", createdBy: creator });
  store.create({ factoryName: "payments-factory", title: "Add Paste Option for Grok Auth Code", source: "github_issue", createdBy: creator });
  // Reviewing 3
  const r1 = store.create({ factoryName: "payments-factory", title: "Adjust Pin Icon Alignment", source: "github_issue", createdBy: creator, foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true, reason: "image" } });
  if (r1.ok) store.transition(r1.value!.id, "Reviewing", "implement");
  const r2 = store.create({ factoryName: "payments-factory", title: "Fix Hubble Factory Triager Issue", source: "github_issue", createdBy: creator, foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true, reason: "image" } });
  if (r2.ok) store.transition(r2.value!.id, "Reviewing", "implement");
  const r3 = store.create({ factoryName: "payments-factory", title: "Add /resume Command Suggestion", source: "github_issue", createdBy: creator, foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true, reason: "image" } });
  if (r3.ok) store.transition(r3.value!.id, "Reviewing", "implement");
  // Terminales para includeTerminals toggle — no visibles por defecto (includeTerminals false)
  const t1 = store.create({ factoryName: "payments-factory", title: "Self-improvement: enforce test evidence", source: "github_issue", createdBy: creator, foremanDecision: { shouldSkipTriage: true, shouldSkipPlanning: true, reason: "self-improvement" } });
  if (t1.ok) {
    store.transition(t1.value!.id, "Reviewing", "implement");
    store.transition(t1.value!.id, "Complete", "foreman", { reviewVerdict: "accept", handoffConfirmed: true });
  }
}

const stageConfig: Record<WorkItemStage, { bg: string; dot: string; label: string }> = {
  Triage: { bg: "bg-white", dot: "bg-zinc-400", label: "Triage" },
  Planning: { bg: "bg-[#fff6e9]", dot: "bg-amber-500", label: "Planning" },
  Building: { bg: "bg-[#f0f6ff]", dot: "bg-sky-500", label: "Building" },
  Reviewing: { bg: "bg-[#fff0f0]", dot: "bg-red-400", label: "Reviewing" },
  Complete: { bg: "bg-zinc-50", dot: "bg-zinc-400", label: "Complete" },
  Cancelled: { bg: "bg-zinc-50", dot: "bg-zinc-400", label: "Cancelled" },
};

export function ActivityBoard() {
  const [search, setSearch] = useState("");
  const [createdBy, setCreatedBy] = useState(ACTIVITY_DEFAULT_CREATED_BY);
  const [stages, setStages] = useState<WorkItemStage[]>([]);
  const [includeTerminals, setIncludeTerminals] = useState(ACTIVITY_DEFAULT_INCLUDE_TERMINALS);
  // Tri-state selection: undefined = derive the first Triage item, null = detail explicitly closed.
  const [selection, setSelection] = useState<string | null | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ Planning: true, Building: true });

  useEffect(() => {
    seedIfEmpty();
  }, []);

  const filter = useMemo(() => {
    const wantStage = stages.length === 1 ? stages[0] : undefined;
    return {
      search: search || undefined,
      createdBy: createdBy || undefined,
      stage: wantStage,
      includeTerminals: includeTerminals || stages.some((s) => s === "Complete" || s === "Cancelled") || undefined,
    };
  }, [search, createdBy, stages, includeTerminals]);

  const { items, transition, cancel, store } = useWorkItems(filter);

  const grouped = useMemo(() => {
    const map = new Map<WorkItemStage, typeof items>();
    const stagesToShow: WorkItemStage[] = stages.length > 0 ? stages : includeTerminals ? [...ALL_STAGES] : [...ACTIVE_STAGES];
    for (const stage of stagesToShow) {
      if (stages.length > 1) {
        const all = getWorkItemStore().list({ search: search || undefined, createdBy: createdBy || undefined, includeTerminals: true });
        map.set(stage, all.filter((it) => it.stage === stage));
      } else {
        map.set(stage, items.filter((it) => it.stage === stage));
      }
    }
    return map;
  }, [items, stages, includeTerminals, search, createdBy]);

  // Derived during render instead of stored: removes the set-state-in-effect and its act() risk.
  const selectedItem =
    selection === undefined
      ? (grouped.get("Triage")?.[0] ?? null)
      : selection === null
        ? null
        : (store.getById(selection) ?? null);

  function handleSelect(id: string) {
    setSelection(id);
  }
  function handleClose() {
    setSelection(null);
  }
  function handleStop(id: string) {
    cancel(id, "foreman", "stopped via Activity Stop task");
  }
  function handleTransition(id: string, to: WorkItemStage, ctx?: Record<string, unknown>) {
    const actor = to === "Complete" ? "foreman" : to === "Cancelled" ? "foreman" : "human";
    transition(id, to, actor as never, ctx as never);
  }
  function toggleCollapsed(stage: string) {
    setCollapsed((prev) => ({ ...prev, [stage]: !prev[stage] }));
  }

  const total = getWorkItemStore().list({ search: search || undefined, createdBy: createdBy || undefined, includeTerminals: true }).length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      {/* Breadcrumb + top actions */}
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Activity</span>
          <span className="ml-2 hidden items-center gap-1 text-[11px] sm:inline-flex">
            <HelpLink anchor="two-runs" label="Ayuda: Activity — Two runs / Stop task" />
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button className="grid h-7 w-7 place-items-center rounded-[8px] border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20" aria-label="Buscar">
            <Search className="h-3.5 w-3.5" />
          </button>
          <button className="grid h-7 w-7 place-items-center rounded-[8px] border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20" aria-label="Filtros">
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
          <button className="grid h-7 w-7 place-items-center rounded-[8px] border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20" aria-label="Menú">
            <span className="text-[11px]">≡</span>
          </button>
          <HelpLink anchor="two-runs" label="Ayuda: Activity — Two runs / Stop task" />
        </div>
      </div>

      {/* Filters as pills */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
        <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs">
          <span className="text-zinc-500">Stage</span>
          <span className="text-zinc-900">is</span>
          <span className="max-w-[180px] truncate text-zinc-700">{stages.length ? stages.join(", ") : "Triage, Planning, Building, ..."}</span>
          {stages.length > 0 && (
            <button onClick={() => setStages([])} className="ml-1 grid h-4 w-4 place-items-center rounded-full hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20" aria-label="Limpiar filtro Stage">
              ×
            </button>
          )}
        </div>
        {/* US-102: terminal stages are hidden by default — one click brings them back. */}
        <button
          type="button"
          onClick={() => setIncludeTerminals((v) => !v)}
          aria-pressed={includeTerminals}
          title={includeTerminals ? "Ocultar etapas terminales" : "Mostrar Complete y Cancelled"}
          className={[
            "flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-[background-color,color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
            includeTerminals
              ? "border-violet-300 bg-violet-50 font-medium text-violet-700"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800",
          ].join(" ")}
        >
          <span className={["h-1.5 w-1.5 rounded-full", includeTerminals ? "bg-violet-500" : "bg-zinc-300"].join(" ")} />
          Complete/Cancelled
        </button>
        {createdBy && (
          <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs">
            <span className="text-zinc-500">Created</span>
            <span className="text-zinc-900">by</span>
            <span className="text-zinc-700">{createdBy}</span>
            <button onClick={() => setCreatedBy("")} className="ml-1 grid h-4 w-4 place-items-center rounded-full hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20" aria-label="Limpiar filtro Created by">
              ×
            </button>
          </div>
        )}
        <button
          onClick={() => {
            setCreatedBy(ACTIVITY_DEFAULT_CREATED_BY);
          }}
          className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-zinc-300 text-zinc-500 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
          aria-label="Agregar filtro Created by"
          title="Created by=you"
        >
          <Plus className="h-3 w-3" />
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          <span>Showing {total} results</span>
          <button
            onClick={() => {
              setSearch("");
              setCreatedBy("");
              setStages([]);
              setIncludeTerminals(false);
            }}
            className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Main two-pane: list + detail */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* List */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-panel p-3">
          <div className="mx-auto max-w-[640px] space-y-3">
            {/* Search mini */}
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="h-7 flex-1 rounded-[8px] border border-zinc-200 bg-white px-3 text-xs focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                aria-label="Buscar work items"
              />
            </div>

            {[...grouped.entries()].map(([stage, stageItems]) => {
              const cfg = stageConfig[stage];
              const isCollapsed = !!collapsed[stage];
              return (
                <div key={stage} className="overflow-hidden rounded-[10px] border border-zinc-200 bg-white">
                  <button
                    onClick={() => toggleCollapsed(stage)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${cfg.label} — ${stageItems.length} items`}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left ${cfg.bg} border-b border-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20`}
                  >
                    <span className={`grid h-4 w-4 place-items-center rounded-full ${isCollapsed ? "text-zinc-500" : "text-zinc-700"}`}>
                      <span className="text-[10px]">{isCollapsed ? "›" : "⌄"}</span>
                    </span>
                    <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                    <span className="text-xs font-[600] tracking-[0.04em] uppercase text-zinc-700">{cfg.label}</span>
                    <span className="text-xs text-zinc-500">{stageItems.length}</span>
                  </button>

                  {!isCollapsed && (
                    <div className="divide-y divide-zinc-100">
                      {stageItems.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-zinc-400">No items</p>
                      ) : (
                        stageItems.map((item) => {
                          const isSelected = selection === item.id;
                          const hash = hashForItem(item.id);
                          // vary time for demo
                          const timeLabel = item.title.includes("Replace") || item.title.includes("Debug") || item.title.includes("Add Paste") ? "1 week ago" : item.title.includes("Adjust") ? "2 days ago" : "1 min ago";
                          return (
                            <button
                              key={item.id}
                              onClick={() => handleSelect(item.id)}
                              aria-current={isSelected ? "true" : undefined}
                              className={[
                                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-[background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
                                isSelected ? "bg-zinc-900 text-white" : "bg-white hover:bg-zinc-50",
                              ].join(" ")}
                            >
                              <span
                                className={[
                                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[8px]",
                                  isSelected ? "border-white bg-white text-zinc-900" : "border-zinc-300 bg-white text-white",
                                ].join(" ")}
                              >
                                {isSelected ? "●" : "○"}
                              </span>
                              <span className={`flex-1 truncate text-[13px] ${isSelected ? "font-medium text-white" : "text-zinc-800"}`}>{item.title}</span>
                              <span className={`shrink-0 font-mono text-[11px] ${isSelected ? "text-zinc-300" : "text-zinc-500"}`}>{hash}</span>
                              <img src={`https://i.pravatar.cc/100?img=${(parseInt(hash.slice(0, 2), 16) % 8) + 1}`} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" style={{ boxShadow: "0 0 0 1px oklch(0 0 0 / 0.08)" }} />
                              <span className={`hidden shrink-0 text-[11px] sm:inline ${isSelected ? "text-zinc-300" : "text-zinc-500"}`}>{timeLabel}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail */}
        <div className="hidden w-[380px] shrink-0 border-l border-zinc-200 bg-white lg:flex">
          <ActivityDetail item={selectedItem} onClose={handleClose} onStop={handleStop} onTransition={handleTransition} />
        </div>
      </div>

      {/* Mobile detail overlay */}
      {selectedItem && (
        <div className="fixed inset-0 z-10 flex flex-col bg-white lg:hidden">
          <ActivityDetail item={selectedItem} onClose={handleClose} onStop={handleStop} onTransition={handleTransition} />
        </div>
      )}
    </div>
  );
}
