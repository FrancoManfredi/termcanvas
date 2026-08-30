import { X, ChevronUp, ExternalLink } from "lucide-react";
import type { WorkItem } from "../../lib/factory/domain/workItem.types";


function hashForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 0xffffff;
  return h.toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
}

interface Props {
  item: WorkItem | null;
  onClose: () => void;
  onStop: (id: string) => void;
  onTransition: (id: string, to: WorkItem["stage"], ctx?: Record<string, unknown>) => void;
}

export function ActivityDetail({ item, onClose, onStop, onTransition }: Props) {
  if (!item) {
    return (
      <div className="flex w-full items-center justify-center p-6 text-center text-sm text-zinc-400">
        Select a work item to see details
      </div>
    );
  }

  const hash = hashForId(item.id);

  function handleStop() {
    onStop(item!.id);
  }
  function handleApprove() {
    onTransition(item!.id, "Building", { humanApproval: "approved" });
  }
  function handleRevise() {
    onTransition(item!.id, "Building", { reviewVerdict: "revise" });
  }
  function handleComplete() {
    onTransition(item!.id, "Complete", { reviewVerdict: "accept", handoffConfirmed: true });
  }
  function handleClose() {
    onClose();
  }

  const canApprove = item.stage === "Planning";
  const canRevise = item.stage === "Reviewing";
  const canComplete = item.stage === "Reviewing";
  const isTerminal = item.stage === "Complete" || item.stage === "Cancelled";

  return (
    <div className="flex min-h-0 w-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2">
        <span className="font-mono text-xs font-medium text-zinc-500">{hash}</span>
        <button className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-zinc-100">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto flex items-center gap-1">
          <span className="h-3 w-3 rounded-[2px] bg-red-500" />
          <button className="inline-flex items-center gap-1 rounded-[8px] border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            <ExternalLink className="h-3 w-3" /> View agent
          </button>
          <button onClick={handleClose} className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-zinc-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-[15px] font-[600] tracking-[-0.01em] text-zinc-900">{item.title}</h3>
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="h-2 w-2 rounded-full bg-violet-500" />
          {item.stage}
        </div>

        <div className="mt-4 rounded-[10px] border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="grid h-5 w-5 place-items-center rounded bg-white text-[10px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">✳</span>
            <span className="font-medium text-zinc-700">Origin Slack thread</span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Started this task 2 mins ago · {item.source} {item.sourceRef ? `· ${item.sourceRef}` : ""}</p>
          {item.description && <p className="mt-2 text-xs leading-relaxed text-zinc-600">{item.description}</p>}
        </div>

        <div className="mt-4 space-y-2 rounded-[10px] border border-zinc-200 bg-white p-3 font-mono text-xs">
          <div>
            <span className="text-zinc-500">factory:</span> {item.factoryName}
          </div>
          <div>
            <span className="text-zinc-500">createdBy:</span> {item.createdBy}
          </div>
          <div>
            <span className="text-zinc-500">stage:</span> {item.stage}
          </div>
        </div>

        <div className="mt-4">
          <h4 className="text-xs font-[600] tracking-[0.06em] uppercase text-zinc-500">Event history</h4>
          <ul className="mt-2 space-y-1.5">
            {item.history.map((ev) => {
              return (
                <li key={ev.id} className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium text-zinc-700">
                      {ev.from} → {ev.to}
                    </span>
                    <span className="text-[11px] text-zinc-400">{new Date(ev.at).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {ev.actor} {ev.reason ? `· ${ev.reason}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-4">
          <button className="flex w-full items-center justify-between rounded-[8px] border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            Task details <span className="text-zinc-400">›</span>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {canApprove && (
            <button onClick={handleApprove} className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
              Approve → Building
            </button>
          )}
          {canRevise && (
            <button onClick={handleRevise} className="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600">
              Revise → Building
            </button>
          )}
          {canComplete && (
            <button onClick={handleComplete} className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700">
              Handoff Complete
            </button>
          )}
          {!isTerminal && (
            <button onClick={handleStop} className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">
              Stop task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
