// SRP: MCPs and apps — team-level (arriba de factories) vs factory-level (§10 Getting oriented)
// DIP: usa FactoryBundle para factory-level mcpServers, mock para team-level
import { useMemo } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import { resolveAllMcpView } from "../../lib/factory/domain/secrets.derive";
import { redactSecret } from "../secrets/SecretsRedacted";

const TEAM_MCPS_MOCK: Array<{ name: string; warpId: string; scope: string; installed: boolean }> = [
  { name: "sentry", warpId: "<REPLACE_ME>", scope: "team-level", installed: true },
  { name: "linear-mcp", warpId: "<REPLACE_ME>", scope: "team-level", installed: false },
];

export function McpsPage() {
  const bundleRes = useFactoryBundle();
  const bundle = bundleRes.ok ? bundleRes.value! : null;
  const mcpView = useMemo(() => (bundle ? resolveAllMcpView(bundle) : null), [bundle]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-500">Team</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">MCPs and apps</span>
          <span className="ml-2 hidden text-[11px] text-zinc-400 sm:inline">team-level arriba de factories — WarpFactories.md §10 + §12</span>
        </div>
        <span className="ml-auto text-[11px] text-zinc-500">Runs / MCPs / Secrets / Integrations son team-level</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px] space-y-4">
          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">Team-level vs Factory-level (§10 Getting oriented)</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
              Sidebar: selección de factory → páginas de esa factory. Arriba, siempre visibles: <span className="font-medium text-zinc-700">Runs</span> (todos),{" "}
              <span className="font-medium text-zinc-700">MCPs and apps</span>, <span className="font-medium text-zinc-700">Secrets</span>,{" "}
              <span className="font-medium text-zinc-700">Integrations</span>. Factory-level <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">mcpServers</code> en factory.yaml + per-agent; team-level MCPs viven arriba de factories.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Team-level MCPs (mock)</div>
                <ul className="mt-2 space-y-1.5">
                  {TEAM_MCPS_MOCK.map((m) => (
                    <li key={m.name} className="flex items-center justify-between rounded-[8px] border bg-white px-3 py-2">
                      <div>
                        <div className="font-mono text-[12px] font-medium text-zinc-800">{m.name}</div>
                        <div className="font-mono text-[11px] text-zinc-400">{redactSecret(m.warpId)}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.installed ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                        {m.installed ? "installed" : "available"}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 text-[11px] text-zinc-400">MCPs team-level se declaran en Warp dashboard team settings, no en factory.yaml.</div>
              </div>
              <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Factory-level — wilson</div>
                {!mcpView ? (
                  <p className="mt-2 text-[12px] text-zinc-400">Sin bundle</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    <li className="rounded-[8px] border bg-white px-3 py-2">
                      <div className="text-[12px] font-medium text-zinc-800">factory.yaml mcpServers</div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {Object.keys(mcpView.factoryWide).length ? Object.entries(mcpView.factoryWide).map(([k, v]) => `${k}: ${redactSecret(v)}`).join(", ") : "—"}
                      </div>
                    </li>
                    {mcpView.byAgent.slice(0, 3).map((a) => (
                      <li key={a.agentName} className="rounded-[8px] border bg-white px-3 py-2">
                        <div className="text-[12px] font-medium text-zinc-800">{a.agentName} — {a.agentType}</div>
                        <div className="font-mono text-[11px] text-zinc-500">
                          {Object.keys(a.effective).length ? Object.entries(a.effective).map(([k, v]) => `${k}:${redactSecret(v)}`).join(", ") : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">Factory MCP — §12</h3>
            <p className="mt-1 text-[12px] text-zinc-500">
              Hosted MCP server{" "}
              <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">https://app.warp.dev/api/v1/mcp/factory</code> — 19 tools (list_factories, send_task,
              get_task con worktree guidance, message_foreman, complete_task, etc.). Sin read-only ni per-factory scopes: full permissions. Guardar API keys en secret storage, nunca en repo.
            </p>
            <div className="mt-2 text-[11px] text-zinc-400">Setup prompt canónico: &quot;Set up a factory for me. Read https://docs.warp.dev/factories/factory-mcp.md...&quot;</div>
          </section>
        </div>
      </div>
    </div>
  );
}
