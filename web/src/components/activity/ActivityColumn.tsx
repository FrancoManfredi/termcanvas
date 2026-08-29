import type { WorkItem, WorkItemStage } from "../../lib/factory/domain/workItem.types";
import { ActivityCard } from "./ActivityCard";


interface Props {
  stage: WorkItemStage;
  items: WorkItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const stageMeta: Record<WorkItemStage, { label: string; dot: string }> = {
  Triage: { label: "Triage", dot: "bg-violet-500" },
  Planning: { label: "Planning", dot: "bg-amber-500" },
  Building: { label: "Building", dot: "bg-emerald-500" },
  Reviewing: { label: "Reviewing", dot: "bg-sky-500" },
  Complete: { label: "Complete", dot: "bg-zinc-400" },
  Cancelled: { label: "Cancelled", dot: "bg-red-400" },
};

export function ActivityColumn({ stage, items, selectedId, onSelect }: Props) {
  const meta = stageMeta[stage];

  return (
    <div className="flex w-[280px] shrink-0 flex-col rounded-[12px] border border-zinc-200 bg-[#fcfcfc]">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
        <span className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-600">{meta.label}</span>
        <span className="ml-auto rounded-full bg-zinc-900/[0.06] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-500">{items.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-400">No items</p>
        ) : (
          items.map((item) => {
            return <ActivityCard key={item.id} item={item} selected={selectedId === item.id} onSelect={onSelect} />;
          })
        )}
      </div>
    </div>
  );
}
