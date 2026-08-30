import { useState } from "react";
import { X, ExternalLink, Square, Star, FlaskConical } from "lucide-react";
import type { Run } from "../../lib/factory/domain/run.types";
import { totalCost } from "../../lib/factory/domain/run.derive";

function hashForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 0xffffff;
  return h.toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
}

interface Props {
  run: Run | null;
  workItemRuns: Run[];
  onClose: () => void;
  onStop?: (runId: string) => void;
  onScore?: (runId: string) => void;
  onConvertBenchmark?: (runId: string) => void;
  onViewSession?: (runId: string) => void;
}

export function RunDetail({ run, workItemRuns, onClose, onStop, onScore, onConvertBenchmark, onViewSession }: Props) {
  const [activeTab, setActiveTab] = useState<"timeline" | "subagents">("timeline");

  if (!run) {
    return <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-zinc-400">Select a run to see details</div>;
  }

  const hash = hashForId(run.id);

  function handleStop() {
    onStop?.(run!.id);
  }
  function handleScore() {
    onScore?.(run!.id);
  }
  function handleConvert() {
    onConvertBenchmark?.(run!.id);
  }
  function handleViewSession() {
    onViewSession?.(run!.id);
  }
  function handleTab(tab: "timeline" | "subagents") {
    setActiveTab(tab);
  }
  function handleClose() {
    onClose();
  }

  const timeline = [...workItemRuns].sort((a, b) => a.at.localeCompare(b.at));
  const relatedCost = totalCost(workItemRuns);

  return (
    <div className="flex min-h-0 w-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <span className="font-mono text-xs font-medium text-zinc-500">{hash}</span>
        <span className="rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white">{run.actor}</span>
        <span className="hidden text-[11px] text-zinc-400 sm:inline">{new Date(run.at).toLocaleString()}</span>
        <span className="ml-auto flex items-center gap-1">
          <button
            onClick={handleViewSession}
            className="inline-flex items-center gap-1 rounded-[8px] border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <ExternalLink className="h-3 w-3" /> View agent
          </button>
          <button onClick={handleClose} className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-zinc-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {/* Summary */}
      <div className="px-4 py-3">
        <h3 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">{run.workItemTitle}</h3>
        <p className="mt-1 text-xs text-zinc-500">
          {run.from} -&gt; {run.to} · {run.factoryName} · {run.source}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Cost</div>
            <div className="text-sm font-[600] text-emerald-600">${run.cost.toFixed(2)}</div>
            <div className="text-[11px] text-zinc-400">work item total ${relatedCost.toFixed(2)}</div>
          </div>
          <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Duration</div>
            <div className="text-sm font-medium text-zinc-800">{Math.round(run.durationMs / 1000)}s</div>
            <div className="text-[11px] text-zinc-400">{new Date(run.at).toLocaleTimeString()}</div>
          </div>
          <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Agent</div>
            <div className="text-sm font-medium text-zinc-800">{run.actor}</div>
            <div className="text-[11px] text-zinc-400">{run.isOrchestrator ? "orchestrator" : "single"}</div>
          </div>
        </div>

        {/* Actions - run pages no chat input but steer via View session §10 */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={handleViewSession} className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            <ExternalLink className="h-3 w-3" /> View session
          </button>
          <button onClick={handleStop} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">
            <Square className="h-3 w-3" /> Stop
          </button>
          <button onClick={handleScore} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
            <Star className="h-3 w-3" /> Score
          </button>
          <button onClick={handleConvert} className="inline-flex items-center gap-1 rounded-full bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700">
            <FlaskConical className="h-3 w-3" /> Convert to benchmark
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">Run pages no incluyen chat input — steer via View session (shared agent session, follow-ups mientras sandbox activo, luego transcript) per §10.</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 px-4">
        <button
          onClick={() => handleTab("timeline")}
          className={["border-b-2 px-2 py-2 text-xs font-medium", activeTab === "timeline" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-700"].join(" ")}
        >
          Timeline
        </button>
        <button
          onClick={() => handleTab("subagents")}
          className={["border-b-2 px-2 py-2 text-xs font-medium", activeTab === "subagents" ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-700"].join(" ")}
        >
          Sub-agents {run.isOrchestrator ? `(${run.childRuns.length})` : ""}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "timeline" ? (
          <div>
            <h4 className="text-xs font-[600] tracking-[0.06em] uppercase text-zinc-500">Timeline por work item ({timeline.length} runs)</h4>
            <p className="mt-1 text-[11px] text-zinc-400">Un run = ejecución individual de un agente. Este work item spanea {timeline.length} runs.</p>
            <ul className="mt-3 space-y-2">
              {timeline.map((r) => {
                const isCurrent = r.id === run.id;
                return (
                  <li key={r.id} className={["rounded-[8px] border px-3 py-2 text-xs", isCurrent ? "border-violet-300 bg-violet-50" : "border-zinc-200 bg-white"].join(" ")}>
                    <div className="flex justify-between">
                      <span className="font-medium text-zinc-700">
                        {r.from} -&gt; {r.to} · {r.actor}
                      </span>
                      <span className="text-[11px] text-zinc-400">{new Date(r.at).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px] text-zinc-500">
                      <span>{r.reason ?? ""}</span>
                      <span className="font-medium text-emerald-600">${r.cost.toFixed(2)}</span>
                    </div>
                    {isCurrent && <span className="mt-1 inline-block rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-medium text-white">current</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div>
            <h4 className="text-xs font-[600] tracking-[0.06em] uppercase text-zinc-500">Sub-agents</h4>
            {!run.isOrchestrator ? (
              <p className="mt-2 text-xs text-zinc-400">Solo orchestrator runs (foreman) tienen tab de sub-agents. Este run es {run.actor} — single execution.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {run.childRuns.map((child) => {
                  return (
                    <li key={child.id} className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2 text-xs">
                      <div className="flex justify-between">
                        <span className="font-medium text-zinc-700">{child.actor} — sub-agent</span>
                        <span className="text-emerald-600">${child.cost.toFixed(2)}</span>
                      </div>
                      <div className="text-[11px] text-zinc-500">{child.reason}</div>
                      <div className="text-[11px] text-zinc-400">{child.durationMs}ms</div>
                    </li>
                  );
                })}
                {run.childRuns.length === 0 && <li className="text-xs text-zinc-400">No child runs (mock 1-2 expected for foreman).</li>}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-zinc-400">Tab mock — child runs derivadas deterministicamente del parent foreman run.</p>
          </div>
        )}
      </div>
    </div>
  );
}
