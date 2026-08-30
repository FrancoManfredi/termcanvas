// SRP: Slack deep dive — static, exact names from WarpFactories.md §9 Slack
// DIP: no store, pure presentation

import {
  SLACK_CONNECT_METHOD,
  SLACK_INVITE_NOTE,
  SLACK_MENTION_REACTION,
  SLACK_EVENTS,
  SLACK_EVENTS_FULL,
  SLACK_FILTERS,
  SLACK_REACTION_INTAKE_EXAMPLE,
  SLACK_HOME_TAB_STAGES,
  SLACK_PRIVACY,
} from "../../lib/factory/domain/integrations.deep";

export function SlackPage() {
  return (
    <div className="space-y-4">
      <header className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[#611f69] text-[12px] font-bold text-white">#</span>
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">Slack — deep dive</h2>
          <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white">{SLACK_CONNECT_METHOD}</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
          Fuente: <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">factories/integrations/slack</code> — WarpFactories.md §9.
          Prereqs: permiso para instalar Slack apps, permiso para actualizar factory.
        </p>
      </header>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Connect — Add to Slack</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
          <li>
            • Al crear factory seleccionar Slack o después en <code className="font-mono text-[11px]">Settings</code> → Warp instala Slack app; si el workspace
            requiere admin approval → <span className="font-medium">{SLACK_CONNECT_METHOD}</span>
          </li>
          <li>
            • <span className="font-medium">{SLACK_INVITE_NOTE}</span> — conversations picker solo muestra channels donde la app está invitada → invite +
            refresh.
          </li>
          <li>
            • Confirmar con mention → reacciona <span className="inline-flex h-5 items-center rounded-full bg-zinc-900 px-2 text-[11px] text-white">{SLACK_MENTION_REACTION}</span>
          </li>
        </ul>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Automations — triggers + filtros</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SLACK_EVENTS.map((e) => (
            <span key={e} className="rounded-full bg-zinc-900 px-2.5 py-1 font-mono text-[11px] font-medium text-white">
              {e}
            </span>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-zinc-400">
          Full provider events: <code className="font-mono">{SLACK_EVENTS_FULL.join(", ")}</code>
        </div>
        <div className="mt-3 overflow-hidden rounded-[8px] border border-zinc-200">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-zinc-50 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">Filtrable por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              <tr>
                <td className="px-3 py-2 font-mono text-[11px]">app_mention</td>
                <td className="px-3 py-2 text-zinc-600">joined conversations, authors, keywords</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-[11px]">message_posted</td>
                <td className="px-3 py-2 text-zinc-600">conversations, authors/members</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-[11px]">message_dm / message_im / message_mpim</td>
                <td className="px-3 py-2 text-zinc-600">DM / IM / MPIM — linked account required</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-[11px]">reaction_added</td>
                <td className="px-3 py-2 text-zinc-600">conversations, reactors, keywords, emoji, reacted-message authors</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-[11px]">member_joined_channel</td>
                <td className="px-3 py-2 text-zinc-600">conversations</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">
          Filtros WarpFactories §9: <span className="font-medium">{SLACK_FILTERS.join(" · ")}</span>
        </div>
        <div className="mt-3 rounded-[8px] bg-zinc-50 p-3">
          <div className="text-[11px] font-medium text-zinc-700">Ejemplo reaction intake:</div>
          <pre className="mt-1 overflow-x-auto rounded-[8px] bg-white p-2 font-mono text-[11px] leading-relaxed text-zinc-700">
{`# slack-reaction-intake/automation.md
triggers:
  - provider: slack
    event: reaction_added
    filter:
      channels: [${SLACK_REACTION_INTAKE_EXAMPLE.channels.join(", ")}]
      emojis: [${SLACK_REACTION_INTAKE_EXAMPLE.emojis.join(", ")}]`}
          </pre>
        </div>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Constraints</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
          <li>• Conversations picker solo muestra channels donde la app está invitada → invite + refresh.</li>
          <li className="rounded-[8px] bg-amber-50 px-2 py-1.5 text-amber-800">
            • <span className="font-medium">Un Slack message puede matchear &gt;1 automation</span> (app_mention + message_posted mismo channel → 2 runs) →
            narrow/remove overlapping.
          </li>
          <li>
            • <span className="font-medium">Solo new content cuenta</span>; edits ignorados.
          </li>
          <li>• Plain reply en thread solo continúa si el thread ya tiene factory work item; para new work → mention.</li>
        </ul>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-[12px] border border-zinc-200 bg-white p-4">
          <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Start / continue</h3>
          <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
            <li>• Mention app en channel/thread o DM → pick up con thread history + supported attachments</li>
            <li>• Plain reply en thread para add info/attachments o pick up later</li>
            <li className="text-[11px] text-zinc-400">Unsupported attachments no bloquean texto. Solo new content.</li>
          </ul>
        </div>
        <div className="rounded-[12px] border border-zinc-200 bg-white p-4">
          <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Follow — Home tab</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
            Slack thread donde empezó = seguimiento; app posts progress + final.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {SLACK_HOME_TAB_STAGES.map((s) => (
              <span key={s} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                {s}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">Home tab en Slack agrupa work items by mismos stages Activity (Triage…Cancelled) con stage/date filters + links a thread/run/issue/PR.</p>
        </div>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Quién puede iniciar + privacy</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
          <li>
            • <span className="font-medium">Slack account must be linked to active member del factory&apos;s Warp team</span> para mentions/DMs; si no → prompt
            connect account. Automation runs como factory agent elegido, no como trigger user.
          </li>
          <li>
            • Privacy: app lee solo donde es <span className="font-medium">{SLACK_PRIVACY.readsOnlyWhere}</span>; message content + attachments usados para
            run; Slack profile email usado para mapear a Warp account. Data per Warp Privacy Policy.
          </li>
        </ul>
      </section>
    </div>
  );
}
