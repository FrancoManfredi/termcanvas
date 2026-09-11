/**
 * ForemanLogPanel — log Foreman vivo sin reload.
 * Ola 2: muestra decision + reason + confidence (building | needs_triage | needs_input).
 */

import type { ForemanLog } from "../../../../shared/types/foreman";
import { useWorkItemStore } from "@/stores/workItemStore";

function levelColor(level: string): string {
  switch (level) {
    case "decision":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "error":
      return "bg-red-50 text-red-800 border-red-200";
    case "warn":
      return "bg-amber-50 text-amber-800 border-amber-200";
    default:
      return "bg-zinc-50 text-zinc-700 border-zinc-200";
  }
}

function decisionBadge(decision: string): string {
  switch (decision) {
    case "building":
      return "bg-blue-600 text-white";
    case "needs_triage":
      return "bg-amber-500 text-white";
    case "needs_input":
      return "bg-orange-500 text-white";
    default:
      return "bg-zinc-600 text-white";
  }
}

export function ForemanLogPanel() {
  const { foremanLogs, isLoadingForemanLogs, foremanLogsError } = useWorkItemStore();

  if (isLoadingForemanLogs && foremanLogs.length === 0) {
    return <div className="mt-4 text-xs text-zinc-500" aria-live="polite">Cargando Foreman logs…</div>;
  }

  if (foremanLogsError) {
    return (
      <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" aria-live="polite">
        Error Foreman logs: {foremanLogsError}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-800">
        Foreman Log
        <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-normal text-white">{foremanLogs.length}</span>
        <span className="text-[11px] font-normal text-zinc-500">decision + reason + confidence</span>
      </h2>
      {foremanLogs.length === 0 ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600" aria-live="polite">
          Sin logs — creá un Work Item para ver “→ building | needs_triage” con reason.
        </div>
      ) : (
        <div className="max-h-[260px] overflow-auto rounded-md border border-zinc-200 bg-white p-2" aria-live="polite">
          <ul className="space-y-1.5">
            {foremanLogs.slice().reverse().map((log: ForemanLog) => (
              <li
                key={log.id}
                className={`rounded-md border px-3 py-2 text-[11px] leading-snug ${levelColor(log.level)}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-500">{new Date(log.at).toLocaleTimeString()}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold border border-zinc-200">{log.level}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${decisionBadge(log.decision.decision)}`}>
                    {log.decision.decision}
                  </span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-mono border border-zinc-200">
                    conf {(log.decision.confidence * 100).toFixed(0)}%
                  </span>
                  <span className="font-mono text-[11px]">{log.workItemId.slice(0, 12)}…</span>
                  <span className="ml-auto text-[10px] text-zinc-500">runner {log.decision.runnerId ?? "—"}</span>
                </div>
                <div className="mt-1 break-words whitespace-pre-wrap font-medium">{log.message}</div>
                <div className="mt-1 rounded bg-white/60 px-2 py-1 border border-zinc-200">
                  <span className="font-semibold text-zinc-700">reason:</span> <span className="text-zinc-700">“{log.decision.reason}”</span>
                </div>
                {log.context?.promptPreview ? (
                  <div className="mt-1 text-zinc-600">prompt: “{log.context.promptPreview}”</div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2 text-[11px] text-zinc-500">
        Polling GET /foreman/logs cada 2.5s — ring 500 — building vs needs_triage vs needs_input
      </div>
    </div>
  );
}

export default ForemanLogPanel;
