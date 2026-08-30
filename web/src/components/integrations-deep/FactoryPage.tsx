// SRP: Factory deep dive — static, US-093 · work_item_stage_changed
// DIP: no store, pure presentation
import { FACTORY_STAGE_TRIGGERS } from "../../lib/factory/domain/integrations.deep";

export function FactoryPage() {
  return (
    <div className="space-y-4">
      <header className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-zinc-900 text-[12px] font-bold text-white">F</span>
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">Factory — deep dive</h2>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">work_item_stage_changed</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
          Fuente: <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">automation trigger provider: factory</code> — WarpFactories.md §6 · US-093.
          Automatizar sobre el propio pipeline — stage changes.
        </p>
      </header>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Trigger — work_item_stage_changed</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FACTORY_STAGE_TRIGGERS.map((t) => (
            <span key={t.event} className="rounded-full bg-zinc-900 px-2.5 py-1 font-mono text-[11px] font-medium text-white">
              {t.provider}:{t.event}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">{FACTORY_STAGE_TRIGGERS[0]?.description} — {FACTORY_STAGE_TRIGGERS[0]?.trace}</p>
        <pre className="mt-3 overflow-x-auto rounded-[8px] bg-zinc-50 p-2 font-mono text-[11px] leading-relaxed text-zinc-700">
{`# automations/factory-stage/automation.md — US-093
 triggers:
  - provider: factory
    event: work_item_stage_changed
    # no filter requerido — dispara sobre pipeline stage change
    # optional filter: stage = [Triage, Planning, Building, Reviewing, Complete, Cancelled]`}
        </pre>
        <div className="mt-2 text-[11px] text-zinc-500">E2E simulado sin backend — factory trigger dispara work_item_stage_changed y el foreman coordina.</div>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Stages</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Triage", "Planning", "Building", "Reviewing", "Complete", "Cancelled"].map((s) => (
            <span key={s} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700">
              {s}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">Stage change triggers permiten automatizar transiciones del pipeline factory sin intervención manual.</p>
      </section>
    </div>
  );
}
