import type { ScorerDefinition } from "../../lib/factory/domain/types";
import { deriveScorer } from "../../lib/factory/domain/scorer.derive";

export interface ScorerCardProps {
  scorer: ScorerDefinition;
  selected: boolean;
  onSelect: (name: string) => void;
}

export function ScorerCard({ scorer, selected, onSelect }: ScorerCardProps) {
  const d = deriveScorer(scorer);
  return (
    <button
      onClick={() => onSelect(scorer.name)}
      aria-current={selected ? "true" : undefined}
      aria-label={`Select scorer ${scorer.name}`}
      className={[
        "flex w-full flex-col gap-2 rounded-[10px] border px-3 py-3 text-left transition-[background-color,box-shadow] duration-150",
        selected
          ? "border-violet-300 bg-violet-50 shadow-[0_1px_3px_rgba(124,58,237,0.12)]"
          : "border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">{scorer.name}</span>
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase ${d.invariantValid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
          {d.invariantValid ? "invariant ok" : "invariant fail"}
        </span>
        {selected && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-600" aria-hidden />}
      </div>
      {scorer.description && <p className="line-clamp-2 text-[12.5px] leading-snug text-zinc-600">{scorer.description}</p>}
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          {scorer.model}
        </span>
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          samplingRate: {d.effectiveSamplingRate}% — {d.autoScoringEnabled ? "auto on" : "Stopped"}
        </span>
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          agents: {scorer.agents.join(", ")}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">
          {d.outputValue}
        </span>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${d.selfImprovement ? "bg-violet-600 text-white" : "bg-zinc-100 text-zinc-600 border border-zinc-200"}`}>
          selfImprovement: {d.selfImprovement ? "true" : "false"}
        </span>
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          passingScore: {scorer.passingScore}
        </span>
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          labels: {scorer.labels.length}
        </span>
      </div>
      <span className="truncate font-mono text-[11px] text-zinc-400">{scorer.rawPath} · slug: {scorer.slug}</span>
    </button>
  );
}

export default ScorerCard;
