// Feed "IA actuando": línea por llamada del motor de entrevista (start/end
// con modelo, duración y tokens). Suscribe al canal interview:activity vía
// window.termcanvas.onPhaseActivity. Sin eventos muestra placeholder neutro.

import { useEffect, useRef, useState } from "react";
import {
  formatModelRef,
  type PhaseActivityEvent,
} from "../../../shared/phaseModels";
import { useT } from "../../i18n/useT";

const MAX_LINES = 25;

function lineKey(event: PhaseActivityEvent, index: number): string {
  return `${event.startedAt}-${event.context}-${event.kind}-${index}`;
}

function clockOf(startedAt: number): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function PhaseActivityFeed({
  className = "",
}: {
  className?: string;
}) {
  const t = useT();
  const [events, setEvents] = useState<PhaseActivityEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.termcanvas : undefined;
    if (!api?.onPhaseActivity) return;
    return api.onPhaseActivity((event) => {
      setEvents((current) => [...current.slice(-(MAX_LINES - 1)), event]);
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="tc-eyebrow">{t.ai_activity_title}</div>
      <div
        ref={scrollRef}
        className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 max-h-56 overflow-y-auto font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]"
      >
        {events.length === 0 && (
          <div className="text-[var(--text-muted)]">{t.ai_activity_empty}</div>
        )}
        {events.map((event, index) => (
          <div key={lineKey(event, index)} className="flex items-baseline gap-2 min-w-0">
            <span className="shrink-0 text-[var(--text-muted)]">
              {clockOf(event.startedAt)}
            </span>
            {event.kind === "start" ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse shrink-0 self-center" />
                <span className="truncate">
                  [{event.context}] consultando{" "}
                  {event.modelRef ? formatModelRef(event.modelRef) : "default"}…
                </span>
              </>
            ) : event.error ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 self-center" />
                <span className="truncate text-red-400" title={event.error}>
                  [{event.context}] ✗ {event.error}
                </span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 self-center" />
                <span className="truncate">
                  [{event.context}] ✓ {(event.durationMs ?? 0) / 1000}s
                  {event.usage
                    ? ` · ${event.usage.input_tokens} in / ${event.usage.output_tokens} out`
                    : ""}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
