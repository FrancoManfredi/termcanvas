// SRP: Schedule deep dive — static, US-092 · cron UTC @daily/@every 1h
// DIP: no store, pure presentation
import { SCHEDULE_PRESETS } from "../../lib/factory/domain/integrations.deep";
import { describeSchedule, isValidCron } from "../../lib/factory/domain/schedule.derive";

export function SchedulePage() {
  return (
    <div className="space-y-4">
      <header className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-violet-600 text-[12px] font-bold text-white">◷</span>
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">Schedule — deep dive</h2>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">cron_fired · UTC</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
          Fuente: <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">automation trigger provider: schedule</code> — WarpFactories.md §6 · US-092.
          Trigger <code className="font-mono text-[11px]">cron_fired</code> con <code className="font-mono text-[11px]">schedule</code> cron 5 campos o descriptor, siempre UTC, optional <code className="font-mono text-[11px]">name</code>.
        </p>
      </header>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Presets — cron @daily / @every 1h UTC</h3>
        <div className="mt-2 grid gap-2">
          {SCHEDULE_PRESETS.map((p) => (
            <div key={p.cron} className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center gap-2">
                <code className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-[11px] font-medium text-white">{p.cron}</code>
                {p.name && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">{p.name}</span>}
                <span className="text-[11px] text-zinc-500">{p.trace}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${isValidCron(p.cron) ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                  {isValidCron(p.cron) ? "válido" : "inválido"}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-600">{describeSchedule(p.cron)}</div>
            </div>
          ))}
        </div>
        <pre className="mt-3 overflow-x-auto rounded-[8px] bg-zinc-50 p-2 font-mono text-[11px] leading-relaxed text-zinc-700">
{`# automations/weekly-dependency-audit/automation.md — US-092
 triggers:
  - provider: schedule
    event: cron_fired
    schedule: {name: weekly-dependency-audit, cron: "0 9 * * 1"} # UTC
 # presets: "@daily" y "@every 1h" también válidos, siempre UTC`}
        </pre>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-violet-600 px-2.5 py-1 font-mono text-[11px] font-medium text-white">@daily</span>
          <span className="rounded-full bg-violet-600 px-2.5 py-1 font-mono text-[11px] font-medium text-white">@every 1h</span>
          <span className="rounded-full bg-zinc-900 px-2.5 py-1 font-mono text-[11px] font-medium text-white">0 9 * * 1</span>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">Siempre UTC. 5-field cron o descriptor. isValidCron valida ambos; describeSchedule retorna texto ES.</p>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Validación</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
          <li>• <code className="font-mono text-[11px]">0 9 * * 1</code> → {describeSchedule("0 9 * * 1")} — válido {String(isValidCron("0 9 * * 1"))}</li>
          <li>• <code className="font-mono text-[11px]">@daily</code> → {describeSchedule("@daily")} — válido {String(isValidCron("@daily"))}</li>
          <li>• <code className="font-mono text-[11px]">@every 1h</code> → {describeSchedule("@every 1h")} — válido {String(isValidCron("@every 1h"))}</li>
          <li>• <code className="font-mono text-[11px]">not a cron</code> → válido {String(isValidCron("not a cron"))} — inválido esperado</li>
        </ul>
      </section>
    </div>
  );
}
