import { useMemo, useState } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import type { ScorerDefinition } from "../../lib/factory/domain/types";
import { deriveScorer } from "../../lib/factory/domain/scorer.derive";
import { ScorerCard } from "./ScorerCard";
import { ScorerDetail } from "./ScorerDetail";

function sortScorersForDisplay(scorers: ScorerDefinition[]): ScorerDefinition[] {
  return [...scorers].sort((a, b) => a.name.localeCompare(b.name));
}

function getSelectedScorer(scorers: ScorerDefinition[], selectedName: string | null): ScorerDefinition | null {
  if (!selectedName) return scorers[0] ?? null;
  const found = scorers.find((s) => s.name === selectedName) ?? null;
  return found ?? scorers[0] ?? null;
}

export function ScorersPage() {
  const bundleResult = useFactoryBundle();
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const content = useMemo(() => {
    if (!bundleResult.ok) {
      return { error: bundleResult.issues.map((i) => i.message).join("; "), factory: null, scorers: [] as ScorerDefinition[] };
    }
    const scorers = sortScorersForDisplay(bundleResult.value!.scorers);
    return { error: null, factory: bundleResult.value!.factory, scorers };
  }, [bundleResult]);

  const selectedScorer = useMemo(() => getSelectedScorer(content.scorers, selectedName), [content.scorers, selectedName]);

  if (content.error) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
        <div className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-4 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Scorers</span>
        </div>
        <div className="p-4 text-sm text-red-600">{content.error}</div>
      </div>
    );
  }

  if (content.scorers.length === 0) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
        <div className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-4 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Scorers</span>
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">0</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="max-w-[420px] rounded-[12px] border border-zinc-200 bg-white px-6 py-8 shadow-sm">
            <p className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">No scorers yet</p>
            <p className="mt-2 text-[12.5px] leading-snug text-zinc-600">
              Add a scorer at <span className="font-mono text-zinc-800">scorers/&lt;name&gt;/scorer.md</span> — fields: <span className="font-mono">name</span> (identity, not dir), <span className="font-mono">agents ≥1</span>, <span className="font-mono">labels</span> with <span className="font-mono">value/score/description</span>, <span className="font-mono">passingScore</span>, <span className="font-mono">samplingRate</span> default 25 (0 stop auto), <span className="font-mono">model</span> judge, <span className="font-mono">selfImprovement</span>, and <span className="font-mono">rubric</span> body. Invariant: ≥1 label ≥ passing and ≥1 below.
            </p>
            <p className="mt-3 font-mono text-[11px] text-zinc-500">Factory: {content.factory!.name} · Reads from real FactoryBundle (SAMPLE_SCORER_TESTS + ScorerParser)</p>
          </div>
        </div>
      </div>
    );
  }

  // derived counts for header insight
  const derivationForHeader = selectedScorer ? deriveScorer(selectedScorer) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Scorers</span>
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">{content.scorers.length}</span>
        </div>
        <span className="text-[11px] font-medium text-zinc-500">
          {derivationForHeader ? derivationForHeader.samplingStatus : ""} {derivationForHeader ? (derivationForHeader.selfImprovement ? "· self-improvement on" : "") : ""}
        </span>
      </div>

      <div className="border-b border-zinc-200 bg-white px-4 py-3">
        <p className="text-[13px] font-medium text-zinc-900">Scorers — LLM judge classification over finished runs</p>
        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
          Factory: {content.factory!.name} · Each scorer: name (identity), description, agents ≥1, output classification, labels[value/score/description], passingScore threshold, samplingRate default 25 (0 stop auto), model judge, selfImprovement, rubric. Read from real FactoryRegistry.
        </p>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-zinc-200 bg-[#f8f8f8] lg:max-w-[380px]">
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {content.scorers.map((scorer) => (
                <ScorerCard
                  key={scorer.name}
                  scorer={scorer}
                  selected={selectedScorer?.name === scorer.name}
                  onSelect={setSelectedName}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex">
          {selectedScorer ? <ScorerDetail scorer={selectedScorer} /> : <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">No scorer selected</div>}
        </div>
      </div>

      {selectedScorer && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-zinc-200 bg-white lg:hidden">
          <ScorerDetail scorer={selectedScorer} />
        </div>
      )}
    </div>
  );
}

export default ScorersPage;
