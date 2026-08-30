// SRP: GitLab deep dive — static, exact names from WarpFactories.md §9 GitLab
// DIP: no store, pure presentation

import {
  GITLAB_HOST,
  GITLAB_GROUP_REQUIREMENT,
  GITLAB_PLAN_REQUIRED,
  GITLAB_MANAGER,
  GITLAB_BOT,
  GITLAB_BOT_RESPONSE,
  GITLAB_DEFINITION_HOSTING_NOTE,
  GITLAB_FILTERS,
  GITLAB_MR_ACTIONS,
  GITLAB_PREMIUM_GATE,
} from "../../lib/factory/domain/integrations.deep";

export function GitLabPage() {
  return (
    <div className="space-y-4">
      <header className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-orange-500 text-[12px] font-bold text-white">GL</span>
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">GitLab — deep dive</h2>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">GitLab.com only</span>
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white">{GITLAB_PLAN_REQUIRED.join(" · ")} · Premium gate</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
          Fuente: <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">factories/integrations/gitlab</code> — WarpFactories.md §9.
          No self-managed; self-managed solo standalone cloud agents vía access token. <span className="font-medium text-amber-700">{GITLAB_PREMIUM_GATE}</span>
        </p>
      </header>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Prereqs — conexión</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
          <li>
            • <span className="font-medium text-zinc-800">Host:</span> <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">{GITLAB_HOST}</code> only
            (no self-managed). Requiere <span className="font-medium">group webhooks</span> + <span className="font-medium">service accounts</span>.
          </li>
          <li>
            • <span className="font-medium text-zinc-800">{GITLAB_GROUP_REQUIREMENT}</span> you own (one-to-one workspace ↔ group; requiere Owner role +
            Warp workspace admin).
          </li>
          <li>
            • Plan con service accounts + group webhooks = <span className="font-medium text-zinc-800">{GITLAB_PLAN_REQUIRED.join(" y ")}</span>.
            Sin group webhooks, credentials aún funcionan pero GitLab no dispara runs.
          </li>
          <li>
            • <span className="font-medium text-zinc-800">Conectar:</span> <code className="font-mono text-[11px]">+ Factories → I want to use repos from GitLab → Connect a GitLab group</code>{" "}
            → Warp crea manager + webhook → Select repos (projects anywhere bajo el group incluyendo subgroups).
          </li>
        </ul>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Service accounts — manager + bot</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-[10px] border border-zinc-200 bg-zinc-50 p-3">
            <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Manager account</div>
            <div className="mt-1 text-[12px] font-medium text-zinc-800">One manager account {GITLAB_MANAGER.scope}</div>
            <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-zinc-600">
              <li>• Granted <span className="font-medium">{GITLAB_MANAGER.role}</span></li>
              <li>• {GITLAB_MANAGER.purpose}</li>
              <li>
                • Provisioning token válido <span className="font-medium">{GITLAB_MANAGER.tokenValidity}</span>
              </li>
            </ul>
          </div>
          <div className="rounded-[10px] border border-zinc-200 bg-zinc-50 p-3">
            <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Bot account — *-warp-*</div>
            <div className="mt-1 text-[12px] font-medium text-zinc-800">One bot per factory — patrón *-warp-*</div>
            <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-zinc-600">
              <li>
                • Nombrado desde factory alias + <code className="rounded bg-white px-1 font-mono text-[11px]">-warp-</code> + short unique ID
              </li>
              <li>
                • Patrón: <code className="rounded bg-white px-1 font-mono text-[11px]">{GITLAB_BOT.namingPattern}</code> — contiene <span className="font-medium">-warp-</span>
              </li>
              <li>
                • Ej: <code className="rounded bg-white px-1 font-mono text-[11px]">{GITLAB_BOT.example}</code> (acepta *-warp-* validación)
              </li>
              <li>
                • Holds <span className="font-medium">{GITLAB_BOT.role} role exactly on selected projects</span> — Developer exacto
              </li>
              <li>• Bot es factory identity; runs auth como bot; username es handle mention; validar con isValidGitLabBotName</li>
              <li className="rounded bg-white px-2 py-1">
                • Demo: <code className="font-mono">acme-support-warp-01k2x3y4z5</code> — válido ✅ | <code className="font-mono">badname</code> — inválido ❌
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Supported triggers + filtros</h3>
        <div className="mt-3 overflow-hidden rounded-[8px] border border-zinc-200">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-zinc-50 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">Actions / evento</th>
                <th className="px-3 py-2">Filtros</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white">
              <tr>
                <td className="px-3 py-2 font-mono text-[11px] font-medium">merge_request</td>
                <td className="px-3 py-2 text-zinc-600">{GITLAB_MR_ACTIONS.join(", ")}</td>
                <td className="px-3 py-2 text-zinc-600">{GITLAB_FILTERS.merge_request.join(" · ")}</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-[11px] font-medium">bot_mentioned</td>
                <td className="px-3 py-2 text-zinc-600">new comment menciona factory&apos;s bot username</td>
                <td className="px-3 py-2 text-zinc-600">
                  {GITLAB_FILTERS.bot_mentioned.join(" · ")} <span className="text-[11px] text-amber-600">(solo repos filter — rechaza mentioned si lo pones manual)</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 rounded-[8px] bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          <span className="font-medium">Definition snippet:</span>{" "}
          <code className="font-mono">provider: gitlab event: merge_request filter: repos:[my-group/my-app] actions:[open]</code>;{" "}
          <code className="font-mono">bot_mentioned</code> solo <code className="font-mono">repos</code>.
        </div>
        <p className="mt-2 text-[11px] text-zinc-400">
          Mention: cada factory tiene su own bot → mencionarlo routea (no hay shared handle/label). Solo new comments cuentan (edits ignorados, Warp own service
          accounts nunca disparan → no self-loop).
        </p>
      </section>

      <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Cómo responde el bot</h3>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
          <li>• Replies en thread mencionado (links run + work item)</li>
          <li>
            • Pushes branches <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">{GITLAB_BOT_RESPONSE.branchPrefix}</code> (ej{" "}
            <code className="rounded bg-zinc-50 px-1 font-mono text-[11px]">{GITLAB_BOT_RESPONSE.branchExample}</code>) y abre{" "}
            <span className="font-medium">draft MRs</span> (marks ready cuando termina)
          </li>
          <li>• Commits/comments atribuidos a bot profile, labels MRs/issues <code className="font-mono text-[11px]">factory:</code>+Foreman name</li>
          <li>• Posts review feedback como summary note + inline discussions (replies + resolves cuando late revision addresses)</li>
          <li className="rounded-[8px] bg-rose-50 px-2 py-1.5 text-rose-700">
            • <span className="font-medium">Never merges / never approves MR</span> — handoff humano decide merge
          </li>
        </ul>
        <div className="mt-3 text-[11px] text-zinc-400">Permissions: runs auth como bot, no como persona que disparó. Anyone who can create matching activity can start work.</div>
      </section>

      <section className="rounded-[12px] border border-amber-200 bg-amber-50 p-4">
        <h3 className="text-[12px] font-[600] tracking-[0.06em] uppercase text-amber-800">Definitions as code — limitación</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-amber-800">{GITLAB_DEFINITION_HOSTING_NOTE}.</p>
        <p className="mt-1 text-[11px] text-amber-700">
          Declarar en Warp-managed o GitHub-hosted definition aunque automations corran vía GitLab.
        </p>
      </section>
    </div>
  );
}
