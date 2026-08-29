import type { ScorerDefinition } from "../../lib/factory/domain/types";
import { deriveScorer, classifyLabel } from "../../lib/factory/domain/scorer.derive";

export interface ScorerDetailProps {
  scorer: ScorerDefinition;
}

export function ScorerDetail({ scorer }: ScorerDetailProps) {
  const d = deriveScorer(scorer);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">{scorer.name}</h2>
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase ${d.invariantValid ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
            {d.invariantValid ? "invariant ok" : "invariant fail"}
          </span>
        </div>
        {scorer.description && <p className="mt-1 text-[12.5px] leading-snug text-zinc-600">{scorer.description}</p>}
        <p className="mt-1 font-mono text-[11px] text-zinc-500">{scorer.rawPath} — slug: {scorer.slug} · name (identity): {scorer.name}</p>
      </div>

      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
        <p className="text-[11px] font-medium text-amber-800">
          scorer.md rubric defines the judge. Body must not be empty. Scoring is static here — reads real FactoryBundle.
        </p>
        <p className="mt-0.5 text-[11px] text-amber-700">samplingRate 0 = stop auto (manual still available) · default 25</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">name (identity)</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{scorer.name}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">slug (dir)</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{scorer.slug}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">model (judge)</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{scorer.model}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">output</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{d.outputValue}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">passingScore threshold</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">passingScore: {scorer.passingScore}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">samplingRate</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">samplingRate: {d.effectiveSamplingRate}</p>
              <p className="mt-0.5 text-[11px] text-zinc-600">{d.samplingStatus}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">selfImprovement</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">selfImprovement: {d.selfImprovement ? "true" : "false"}</p>
              <p className="mt-0.5 text-[11px] text-zinc-600">{d.selfImprovement ? "enabled — failing scores may feed self-improvement PRs" : "disabled"}</p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">agents (≥1 required)</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{scorer.agents.join(", ")}</p>
            </div>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-3">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">labels — classification with value/score/description — invariant: ≥1 ≥ passing and ≥1 below</p>
            <p className="mt-1 text-[11px] text-zinc-600">
              invariant: {d.invariantValid ? "ok" : "fail — need at least one PASS and one FAIL"} · passing labels: {d.passingLabels.length} · failing labels: {d.failingLabels.length}
            </p>
            <div className="mt-2 divide-y divide-zinc-100 overflow-hidden rounded-[8px] border border-zinc-200">
              {scorer.labels.map((label) => {
                const cls = classifyLabel(label, scorer.passingScore);
                return (
                  <div key={label.value} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[12px] font-medium text-zinc-900">{label.value}</p>
                      {label.description && <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">{label.description}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-[12px] text-zinc-800">score: {label.score}</p>
                      <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase ${cls === "pass" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-900 text-white"}`}>
                        {cls === "pass" ? "PASS" : "FAIL"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">labels with PASS are ≥ passingScore ({scorer.passingScore}), FAIL are below. Re-scoring replaces prior result; changing threshold only changes display.</p>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-3">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">rubric (judge instructions body — must not be empty)</p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-zinc-800">{scorer.rubric.trim()}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScorerDetail;
