// SRP: Linear deep dive — static, exact names from WarpFactories.md §9 Linear
// DIP: no store, pure presentation

import {
  LINEAR_CONNECT_METHOD,
  LINEAR_DEFAULT_AUTOMATION_EVENT,
  LINEAR_AGENT_SESSION_NARROW_LIMIT,
  LINEAR_TRIGGERS,
  LINEAR_ISSUE_TRIGGERS,
  LINEAR_EVENTS_OUTPUTS,
} from "../../lib/factory/domain/integrations.deep";

export function LinearPage() {
  return (
    <div className="space-y-4">
      <header className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-indigo-600 text-[12px] font-bold text-white">Li</span>
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">Linear — deep dive</h2>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">{LINEAR_CONNECT_METHOD}</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
          Fuente: <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">factories/integrations/linear</code> — WarpFactories.md §9.
          Declarar <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">integrations: [{`{type: linear}`}]</code> — mutuamente excluyente con Jira.
        </p>
      </header>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Connect — OAuth workspace + teams</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
          <li>• Prereq: factory, Linear workspace (account puede autorizar Warp app), <span className="font-medium">linked Warp account (agent sessions only)</span> — anyone que inicia Linear agent session debe linkear Linear user a Warp account.</li>
          <li>• Code host access vía GitHub connection separada.</li>
          <li>• Al crear factory en <code className="font-mono text-[11px]">Connect your issue trackers</code> o después en Settings: 1) Authorize Warp for Linear workspace (OAuth once per workspace), 2) Choose Linear teams que disparan esta factory.</li>
          <li>
            • Luego Warp agrega <span className="font-medium">default automation routes new <code className="font-mono text-[11px]">{LINEAR_DEFAULT_AUTOMATION_EVENT}</code> de esos teams</span> → assigning issue o taggear factory en comment alcanza para disparar.
          </li>
        </ul>
        <div className="mt-3 rounded-[8px] bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          <span className="font-medium">Route agent sessions:</span> cuando alguien mentions/assigns/delegates Warp app en issue, Linear inicia agent session. Default automation routea new sessions de selected teams. Si session no matchea automation, Linear integration la maneja con default behavior. Replies en existing session continúan ese run.
        </div>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">agent_session_created — narrow solo en files</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
          Para narrow por creator/keyword, editar <code className="font-mono text-[11px]">{LINEAR_DEFAULT_AUTOMATION_EVENT}</code> trigger en definition files;{" "}
          <span className="font-medium">session routing no es editable desde automation editor</span> — <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{LINEAR_AGENT_SESSION_NARROW_LIMIT}</span>.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-[8px] bg-zinc-50 p-2 font-mono text-[11px] leading-relaxed text-zinc-700">
{`# automations/linear-session/automation.md
triggers:
  - provider: linear
    event: agent_session_created
    filter:
      teams: [ENG]
# narrow por creator/keyword solo editable en files, no en editor`}
        </pre>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Triggers Linear</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LINEAR_TRIGGERS.map((e) => (
            <span key={e} className="rounded-full bg-indigo-600 px-2.5 py-1 font-mono text-[11px] font-medium text-white">
              {e}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          Issue triggers: <code className="font-mono text-[11px]">{LINEAR_ISSUE_TRIGGERS.join(", ")}</code> + <code className="font-mono text-[11px]">comment_created</code> +{" "}
          <code className="font-mono text-[11px]">agent_session_created</code>. Every trigger filtra en <span className="font-medium">teams+labels</span> + More filters agrega{" "}
          project, workflow state, assignee, mentioned user, y para comment events <span className="font-medium">specific issue</span>.
        </p>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Supported events / outputs</h3>
        <div className="mt-3 overflow-hidden rounded-[8px] border border-zinc-200">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-zinc-50 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Linear event</th>
                <th className="px-3 py-2">Qué recibe el agent</th>
                <th className="px-3 py-2">Qué manda de vuelta la factory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white">
              {LINEAR_EVENTS_OUTPUTS.map((row) => (
                <tr key={row.event}>
                  <td className="px-3 py-2 font-medium text-zinc-800">{row.event}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.receives}</td>
                  <td className="px-3 py-2 text-zinc-600">{row.sendsBack}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[12px] border border-amber-200 bg-amber-50 p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-amber-800">Loop caution — 2 runs</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-amber-800">
          One comment puede matchear 2 routes: comment que crea agent session también matchea <code className="font-mono">Comment created</code> → si ambos
          point to factory, single action dispara 2 runs → scopear para que un path own cada kind.
        </p>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Follow-up — misma issue continúa mismo work item</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
          Once issue linkeada a factory work item, later matching events en misma issue <span className="font-medium">continúan mismo work item</span> — no
          duplican. Replies en existing agent session continúan ese run, no nuevo work item.
        </p>
      </section>
    </div>
  );
}
