import type { Run } from "../../lib/factory/domain/run.types";

function hashForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 0xffffff;
  const hex = h.toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
  return hex;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

interface Props {
  run: Run;
  selected?: boolean;
  onSelect: (id: string) => void;
}

export function RunCard({ run, selected, onSelect }: Props) {
  const hash = hashForId(run.id);
  const timeLabel = new Date(run.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  function handleClick() {
    onSelect(run.id);
  }

  return (
    <button
      onClick={handleClick}
      className={[
        "flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
        selected ? "border-zinc-900 bg-zinc-900 text-white shadow" : "border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-900",
      ].join(" ")}
    >
      <span className={["grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold", selected ? "bg-white text-zinc-900" : "bg-zinc-900 text-white"].join(" ")}>
        {run.actor[0].toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className={["block truncate text-[13px] font-medium", selected ? "text-white" : "text-zinc-900"].join(" ")}>{run.workItemTitle}</span>
        <span className={["block truncate text-[11px]", selected ? "text-zinc-300" : "text-zinc-500"].join(" ")}>
          {run.from} -&gt; {run.to} · {run.actor} {run.isOrchestrator ? "· orchestrator" : ""}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className={["font-mono text-[11px]", selected ? "text-zinc-300" : "text-zinc-500"].join(" ")}>{hash}</span>
        <span className={["text-[11px] font-medium", selected ? "text-emerald-300" : "text-emerald-600"].join(" ")}>{formatCost(run.cost)}</span>
      </span>
      <span className={["hidden text-[11px] sm:inline", selected ? "text-zinc-400" : "text-zinc-400"].join(" ")}>{timeLabel}</span>
      <span className={["hidden text-[10px] tabular-nums sm:inline", selected ? "text-zinc-400" : "text-zinc-400"].join(" ")}>{formatDuration(run.durationMs)}</span>
    </button>
  );
}
