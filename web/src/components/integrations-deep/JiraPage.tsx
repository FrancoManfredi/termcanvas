// SRP: Jira deep dive — static, exact names from WarpFactories.md §9 Jira
// DIP: no store, pure presentation

import {
  JIRA_ONLY_EVENT,
  JIRA_STATUSES,
  JIRA_AGENT_CAPABILITIES,
} from "../../lib/factory/domain/integrations.deep";

export function JiraPage() {
  return (
    <div className="space-y-4">
      <header className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[#0052cc] text-[12px] font-bold text-white">Ji</span>
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">Jira — deep dive</h2>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">Cloud only + Rovo</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
          Fuente: <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">factories/integrations/jira</code> — WarpFactories.md §9.
          Declarar <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">integrations: [{`{type: jira}`}]</code> en <code className="font-mono text-[11px]">factory.yaml</code> — mutuamente excluyente con Linear. GitHub via repositories.
        </p>
      </header>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Prereqs</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
          <li>
            • <span className="font-medium">Jira Cloud only</span> (no Server/DC), Jira site admin para instalar Warp app y conectar workspace, factory en connected workspace con perm edit definition.
          </li>
          <li>• Warp agent debe estar disponible como <span className="font-medium">Rovo agent</span> en site.</li>
          <li>
            • Connect + automation: 1) Install Warp app on Jira site + connect a Warp workspace (once, cada factory en workspace puede usarlo), 2) Connect Jira a esta factory: Settings → connect Jira + select projects que la disparan. 3) Point automation a Jira: Automations → Add trigger Jira →{" "}
            <code className="font-mono text-[11px]">{JIRA_ONLY_EVENT}</code> con <span className="font-medium">Projects</span> + optional{" "}
            <span className="font-medium">Keywords</span> scope.
          </li>
        </ul>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Filtros — projects / keywords case-insensitive</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
          <span className="font-medium">Solo event</span> <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">{JIRA_ONLY_EVENT}</code> (dispara cuando assign/mention Warp).
          Filtros: <code className="font-mono text-[11px]">project_keys</code> (match work items en esos projects),{" "}
          <code className="font-mono text-[11px]">keywords</code> (assignment text contiene cualquiera,{" "}
          <span className="font-medium">case-insensitive</span>).
        </p>
        <pre className="mt-2 overflow-x-auto rounded-[8px] bg-zinc-50 p-2 font-mono text-[11px] leading-relaxed text-zinc-700">
{`# factory.yaml
integrations: [{type: jira}]
# automations/jira-assignment/automation.md
triggers:
  - provider: jira
    event: agent_session_created
    filter:
      project_keys: [ENG]
      keywords: [investigate, fix]  # matchea si assignment text contiene investigate/fix, case-insensitive`}
        </pre>
        <p className="mt-2 text-[11px] text-zinc-500">
          Must match every field seteado; within field any value match; omit field → match everything. Jira event offered to every automation en connected
          workspace → another team&apos;s broader filter puede disparar su propio run en mismo work item; filters don&apos;t control access.
        </p>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Qué pasa durante run — statuses</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {JIRA_STATUSES.map((s) => (
            <span key={s} className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white">
              {s}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-600">
          Jira muestra status: <span className="font-medium">{JIRA_STATUSES.join(", ")}</span>. Open run bajo matching automation para full run (cloud agent session sharing). Replies en misma session continúan mismo run. Cuando termina, result aparece en session; agent{" "}
          <span className="font-medium">no comenta en work item unless ask</span>.
        </p>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Capacidades del agent</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
          Cuando factory declara Jira integration, agent puede:
        </p>
        <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-zinc-600">
          {JIRA_AGENT_CAPABILITIES.map((c) => (
            <li key={c}>• {c}</li>
          ))}
        </ul>
        <div className="mt-3 rounded-[8px] bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
          <span className="font-medium">Notas:</span> Agent puede update work item, post/edit comments, change workflow status, add/remove labels, reassign — state actions en automation instructions/assignment; Jira permissions + valid transitions apply. Jira access no incluye code access.
        </div>
        <div className="mt-2 text-[11px] text-zinc-400">Connected Jira user becomes run&apos;s creator no agent; connect Jira account a Warp para attribution.</div>
      </section>
    </div>
  );
}
