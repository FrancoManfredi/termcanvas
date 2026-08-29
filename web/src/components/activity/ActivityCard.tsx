import type { WorkItem } from "../../lib/factory/domain/workItem.types";


interface Props {
  item: WorkItem;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function ActivityCard({ item, selected, onSelect }: Props) {
  const stageColor: Record<string, string> = {
    Triage: "bg-violet-500",
    Planning: "bg-amber-500",
    Building: "bg-emerald-500",
    Reviewing: "bg-sky-500",
    Complete: "bg-zinc-400",
    Cancelled: "bg-red-400",
  };

  function handleClick() {
    onSelect(item.id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(item.id);
    }
  }

  return (
    <button
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-selected={selected}
      className={[
        "w-full text-left rounded-[10px] border bg-white p-3 text-[13px] leading-tight transition-[box-shadow,scale,background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
        selected ? "border-violet-300 shadow-[0_1px_8px_rgba(99,102,241,0.12),0_0_0_1px_rgba(99,102,241,0.15)]" : "border-zinc-200 hover:border-zinc-300 hover:shadow-[0_1px_4px_rgba(0,0,0,0.06)]",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 font-[500] tracking-[-0.01em] text-zinc-900">{item.title}</span>
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${stageColor[item.stage] ?? "bg-zinc-400"}`} aria-hidden />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
        <span className="truncate">{item.sourceRef ?? item.source}</span>
        <span className="h-1 w-1 rounded-full bg-zinc-300" />
        <span>{item.createdBy}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="rounded-full bg-zinc-900/[0.06] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600">{item.assigneeAgent ?? item.stage}</span>
        <span className="text-[11px] tabular-nums text-zinc-400">{new Date(item.createdAt).toLocaleDateString()}</span>
      </div>
      {item.linkedPRs.length > 0 && <div className="mt-1.5 truncate text-[11px] text-violet-600">{item.linkedPRs[0]}</div>}
    </button>
  );
}
