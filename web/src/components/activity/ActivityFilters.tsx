import { Search, X } from "lucide-react";
import type { WorkItemStage } from "../../lib/factory/domain/workItem.types";
import { ALL_STAGES } from "../../lib/factory/domain/workItem.types";


interface Props {
  search: string;
  onSearch: (v: string) => void;
  createdBy: string;
  onCreatedBy: (v: string) => void;
  stages: WorkItemStage[];
  onStages: (v: WorkItemStage[]) => void;
  includeTerminals: boolean;
  onIncludeTerminals: (v: boolean) => void;
}

export function ActivityFilters({ search, onSearch, createdBy, onCreatedBy, stages, onStages, includeTerminals, onIncludeTerminals }: Props) {

  function handleStageToggle(stage: WorkItemStage) {
    if (stages.includes(stage)) onStages(stages.filter((s) => s !== stage));
    else onStages([...stages, stage]);
  }

  function handleClear() {
    onSearch("");
    onCreatedBy("");
    onStages([]);
    onIncludeTerminals(false);
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    onSearch(e.target.value);
  }

  function handleCreatedByChange(e: React.ChangeEvent<HTMLInputElement>) {
    onCreatedBy(e.target.value);
  }

  function handleIncludeTerminalsChange(e: React.ChangeEvent<HTMLInputElement>) {
    onIncludeTerminals(e.target.checked);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-3">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" strokeWidth={1.7} />
        <input
          value={search}
          onChange={handleSearchChange}
          placeholder="Search title or description"
          className="h-7 w-[220px] rounded-[8px] border border-zinc-200 bg-zinc-50 pl-7 pr-2 text-[13px] placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
        />
      </div>

      {/* CreatedBy */}
      <input
        value={createdBy}
        onChange={handleCreatedByChange}
        placeholder="Created by"
        className="h-7 w-[140px] rounded-[8px] border border-zinc-200 bg-zinc-50 px-2 text-[13px] placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20"
      />

      {/* Stage chips */}
      <div className="flex items-center gap-1">
        {ALL_STAGES.map((stage) => {
          const active = stages.includes(stage);
          return (
            <button
              key={stage}
              onClick={() => handleStageToggle(stage)}
              className={[
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-[background-color,color,border-color] duration-150",
                active ? "border-violet-300 bg-violet-50 text-violet-700" : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50",
              ].join(" ")}
            >
              {stage}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-1.5 text-xs text-zinc-600">
        <input type="checkbox" checked={includeTerminals} onChange={handleIncludeTerminalsChange} className="h-3.5 w-3.5 rounded border-zinc-300 text-violet-600 focus:ring-violet-500/20" />
        Include terminals
      </label>

      <button
        onClick={handleClear}
        className="ml-auto inline-flex items-center gap-1 rounded-[8px] border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50"
      >
        <X className="h-3 w-3" /> Clear
      </button>
    </div>
  );
}
