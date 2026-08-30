// SRP: Integrations — providers table §9, integrations [{slack|linear|jira}] mutual exclusion, GitHub via repos, mock status
// DIP: lee de FactoryBundle via hook
import { useMemo } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import { PROVIDER_TABLE, deriveProviderStatuses, getIntegratedTypes } from "../../lib/factory/domain/integrations.derive";
import { FactoryIdentityHeader } from "../settings/FactoryIdentityHeader";

function StatusDot({ status }: { status: string }) {
  const cls =
    status === "connected"
      ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
      : status === "disconnected"
        ? "bg-zinc-300 shadow-[0_0_0_4px_rgba(0,0,0,0.06)]"
        : "bg-amber-400";
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-hidden />;
}

export function IntegrationsPage() {
  const bundleRes = useFactoryBundle();
  const bundle = bundleRes.ok ? bundleRes.value! : null;
  const types = bundle ? getIntegratedTypes(bundle) : [];
  const statuses = useMemo(() => (bundle ? deriveProviderStatuses(bundle) : {}), [bundle]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Integrations</span>
          <span className="ml-2 hidden text-[11px] text-zinc-400 sm:inline">Connect your factory — WarpFactories.md §9 + Factory Settings §10</span>
        </div>
        <span className="ml-auto text-[11px] text-zinc-500">§9 mapa general + §10 Integrations team-level</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px] space-y-4">
          <FactoryIdentityHeader />

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">factory.yaml integrations</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
              <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">integrations: [{`{type: slack|linear|jira}`}]</code> — a lo sumo un
              tracker (<span className="font-medium">linear y jira mutuamente excluyentes</span>; omitir tracker es válido).{" "}
              <span className="font-medium text-zinc-700">GitHub no se declara acá</span>; viene de{" "}
              <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">repositories</code> + GitHub App.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px]">
                <span className="text-zinc-500">Actual:</span>
                <span className="font-mono text-[11px] font-medium text-zinc-800">
                  {types.length ? types.map((t) => `{type: ${t}}`).join(", ") : "(sin integrations — solo GitHub via repos)"}
                </span>
              </span>
              <span className="inline-flex items-center rounded-[8px] bg-violet-50 px-3 py-2 text-[11px] font-medium text-violet-700">SAMPLE_FACTORY_FULL: slack</span>
              <span className="inline-flex items-center rounded-[8px] bg-white px-3 py-2 text-[11px] text-zinc-500 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
                GitHub: repositories acme/payments-service + acme/payments-api ⇒ connected
              </span>
            </div>
            <div className="mt-2 text-[11px] text-zinc-400">Alias charset: [A-Za-z0-9 ._-] ≤60 — WarpFactories.md §7 — ver Secrets page para validación.</div>
          </section>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">Providers — Connect your factory mapa general (§9)</h3>
            <p className="mt-1 text-[12px] text-zinc-500">Cada integración entra como work item que el foreman coordina. Repeated deliveries no duplican.</p>
            <div className="mt-3 overflow-hidden rounded-[8px] border border-zinc-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-zinc-50 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Provider</th>
                      <th className="px-3 py-2">Best for</th>
                      <th className="px-3 py-2">Continúa en</th>
                      <th className="px-3 py-2">Qué filtra (ver §6)</th>
                      <th className="px-3 py-2">Estado mock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 bg-white">
                    {PROVIDER_TABLE.map((row) => (
                      <tr key={row.provider} className="hover:bg-zinc-50/60">
                        <td className="px-3 py-2">
                          <div className="font-medium text-zinc-900">{row.provider}</div>
                          <div className="text-[11px] leading-tight text-zinc-400">{row.declareLocation}</div>
                        </td>
                        <td className="px-3 py-2 text-zinc-600">{row.bestFor}</td>
                        <td className="px-3 py-2 text-zinc-600">{row.continuesIn}</td>
                        <td className="px-3 py-2 text-zinc-600">{row.filters}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <StatusDot status={statuses[row.provider] ?? "disconnected"} />
                            <span className="text-[11px] font-medium text-zinc-700">{statuses[row.provider] ?? "disconnected"}</span>
                          </span>
                          <div className="text-[11px] leading-tight text-zinc-400">{row.notes.slice(0, 80)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-zinc-50 px-3 py-2 text-[11px] text-zinc-400">
                Fuente WarpFactories.md §9 tabla + deep dives Slack/GitHub/GitLab/Linear/Jira/Schedule/Factory/API/MCP. Factory trigger: work_item_stage_changed.
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-[11px] font-medium text-zinc-600">Deep dives:</span>
              {[
                { label: "GitLab", anchor: "GitLab Deep Dive" },
                { label: "Slack", anchor: "Slack Deep Dive" },
                { label: "Linear", anchor: "Linear Deep Dive" },
                { label: "Jira", anchor: "Jira Deep Dive" },
                { label: "Schedule", anchor: "Schedule Deep Dive" },
                { label: "Factory", anchor: "Factory Deep Dive" },
              ].map((d) => (
                <button
                  key={d.label}
                  data-testid={`deep-dive-link-${d.label.toLowerCase()}`}
                  onClick={() => {
                    const el = document.querySelector(`[data-nav="${d.anchor}"]`) as HTMLElement | null;
                    el?.click();
                  }}
                  className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20"
                >
                  {d.label} deep dive
                </button>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-[12px] border border-zinc-200 bg-white p-4">
              <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Estado conectado/desconectado (mock)</div>
              <p className="mt-1 text-[11px] text-zinc-400">Estático con sentido — sin provider real, muestra qué estaría conectado según factory.yaml.</p>
              <ul className="mt-3 space-y-2">
                {PROVIDER_TABLE.slice(0, 5).map((row) => (
                  <li key={row.provider} className="flex items-center justify-between rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <span className="text-[12px] font-medium text-zinc-800">{row.provider}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <StatusDot status={statuses[row.provider] ?? "disconnected"} />
                      <span className="text-[11px] font-medium text-zinc-600">{statuses[row.provider] ?? "disconnected"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[12px] border border-zinc-200 bg-white p-4">
              <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Cómo conectar (resumen)</div>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-zinc-600">
                <li>• Slack: Add to Slack + invitar app a channels + mention → reacciona 👀</li>
                <li>• GitHub: instalar Warp GitHub App (una install) + select repos — label factory:&lt;alias&gt; auto-creada</li>
                <li>• GitLab: conectar top-level group you own (Owner), Premium/Ultimate — bot &lt;alias&gt;-warp-&lt;id&gt;</li>
                <li>• Linear: OAuth workspace + choose teams → default automation agent_session_created</li>
                <li>• Jira: Cloud only + Rovo agent → integrations: [{`{type: jira}`}] + keywords case-insensitive</li>
                <li>• Schedule: trigger schedule cron_fired con cron 5 campos o @daily/@every 1h UTC</li>
              </ul>
              <div className="mt-2 text-[11px] text-zinc-400">Ver WarpFactories.md §9 deep dives por provider.</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

