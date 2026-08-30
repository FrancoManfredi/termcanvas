// SRP: Secrets — factory-wide + per-agent scoping (reemplaza no agrega), mcpServers warpId, credential boundaries
// DIP: lee de FactoryBundle via useFactoryBundle / getFactoryBundle, no hardcodes nombres salvo fallback SAMPLE_FACTORY_FULL

import { useMemo } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import { resolveAllSecretsView, resolveAllMcpView } from "../../lib/factory/domain/secrets.derive";
import { FactoryIdentityHeader } from "../settings/FactoryIdentityHeader";
import { SecretsRedacted } from "./SecretsRedacted";
import { redactSecret } from "./secrets.redact";

function Badge({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "violet" | "emerald" | "amber" | "red" }) {
  const cls =
    tone === "violet"
      ? "bg-violet-50 text-violet-700 border-violet-200"
      : tone === "emerald"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : tone === "amber"
          ? "bg-amber-50 text-amber-700 border-amber-200"
          : tone === "red"
            ? "bg-red-50 text-red-700 border-red-200"
            : "bg-zinc-50 text-zinc-600 border-zinc-200";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function MaskedSecret({ name }: { name: string }) {
  // Nunca renderizar secretName completo — solo •••• + últimos 4
  return <SecretsRedacted value={name} canCopy={false} />;
}

export function SecretsPage() {
  const bundleRes = useFactoryBundle();
  const bundle = bundleRes.ok ? bundleRes.value! : null;
  const view = useMemo(() => (bundle ? resolveAllSecretsView(bundle) : null), [bundle]);
  const mcpView = useMemo(() => (bundle ? resolveAllMcpView(bundle) : null), [bundle]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-500">Team</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Secrets</span>
          <span className="ml-2 hidden text-[11px] text-zinc-400 sm:inline">team-level (arriba de factories) + wilson scoping</span>
        </div>
        <span className="ml-auto text-[11px] text-zinc-500">WarpFactories.md §7 + §13 Credential boundaries</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px] space-y-4">
          <FactoryIdentityHeader />

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">Secrets — scoping</h3>
              <Badge tone="amber">reemplaza, no agrega</Badge>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
              <span className="font-medium text-zinc-700">Factory-wide</span> <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">secrets[]</code> siempre aplica.{" "}
              <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">agentDefaults.secrets[]</code> es default para agents sin
              <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">secrets</code>. Un agent con{" "}
              <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">secrets</code> <span className="font-medium text-zinc-700">reemplaza</span>{" "}
              (no agrega) el listado de agentDefaults. WarpFactories.md:476. <span className="font-medium">agentType: FOREMAN</span> etc{" "}
              <span className="font-medium">no amplía acceso</span>; skill no amplía acceso.
            </p>

            {!view ? (
              <p className="mt-3 text-[12px] text-zinc-400">Sin bundle</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Factory-wide secrets</div>
                  <div className="text-[11px] text-zinc-400">factory.yaml → secrets[] — otorgados a todos los agents</div>
                  <ul className="mt-2 space-y-1.5">
                    {view.factoryWideSecrets.length === 0 ? (
                      <li className="text-[12px] text-zinc-400">—</li>
                    ) : (
                      view.factoryWideSecrets.map((s) => (
                        <li key={s} className="flex items-center justify-between rounded-[8px] border border-zinc-200 bg-white px-3 py-2">
                          <MaskedSecret name={s} />
                          <Badge tone="violet">factory-wide</Badge>
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="mt-2 text-[11px] text-zinc-400">
                    Real de <span className="font-mono">SAMPLE_FACTORY_FULL</span>: <span className="font-mono">••••</span> (redacted)
                  </div>
                </div>
                <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">agentDefaults secrets</div>
                  <div className="text-[11px] text-zinc-400">agentDefaults.secrets[] — default solo si agent no declara</div>
                  <ul className="mt-2 space-y-1.5">
                    {view.agentDefaultsSecrets.length === 0 ? (
                      <li className="text-[12px] text-zinc-400">—</li>
                    ) : (
                      view.agentDefaultsSecrets.map((s) => (
                        <li key={s} className="flex items-center justify-between rounded-[8px] border border-zinc-200 bg-white px-3 py-2">
                          <MaskedSecret name={s} />
                          <Badge>agentDefaults</Badge>
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="mt-2 text-[11px] text-zinc-400">Real: <span className="font-mono">••••</span> (redacted)</div>
                </div>
              </div>
            )}

            {view && (
              <div className="mt-4 overflow-hidden rounded-[8px] border border-zinc-200">
                <div className="bg-zinc-50 px-3 py-2 text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                  Per-agent effective secrets (factory-wide + per-agent — reemplaza)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead className="bg-white text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                      <tr>
                        <th className="px-3 py-2">Agent</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Declared (per-agent vs inherited)</th>
                        <th className="px-3 py-2">Effective (factory-wide + declared)</th>
                        <th className="px-3 py-2">Reemplaza?</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 bg-white">
                      {view.byAgent.map((row) => (
                        <tr key={row.agentName} className="hover:bg-zinc-50/60">
                          <td className="px-3 py-2 font-medium text-zinc-900">{row.agentName}</td>
                          <td className="px-3 py-2">
                            <Badge tone={row.agentType === "FOREMAN" ? "violet" : "zinc"}>{row.agentType}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            {row.inheritedOrOverridden.length === 0 ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              <span className="flex flex-wrap gap-1">
                                {row.inheritedOrOverridden.map((s) => (
                                  <span key={s} className="rounded bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
                                    {redactSecret(s)}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex flex-wrap gap-1">
                              {row.effective.map((s) => (
                                <span key={s} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
                                  {redactSecret(s)}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[11px] text-zinc-500">{row.usesPerAgentOverride ? "reemplaza" : "hereda"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-zinc-50 px-3 py-2 text-[11px] text-zinc-400">
                  Ejemplos reales: foreman → <span className="font-mono">••••</span> (per-agent), reviewer → <span className="font-mono">••••</span> (hereda), implement → <span className="font-mono">••••</span> (reemplaza). Skill no amplía acceso — ningún agentType añade secrets implícitos.
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">MCP servers — warpId requerido</h3>
            <p className="mt-1 text-[12px] text-zinc-500">
              <code className="rounded bg-zinc-50 px-1 py-0.5 font-mono text-[11px]">mcpServers: {"{name: {warpId}}"}</code> — mismo scoping reemplaza. warpId es required.
            </p>
            {!mcpView ? (
              <p className="mt-2 text-[12px] text-zinc-400">Sin bundle</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-[11px] font-[600] uppercase text-zinc-500">Factory-wide</div>
                  {Object.keys(mcpView.factoryWide).length === 0 ? (
                    <p className="mt-1 text-[12px] text-zinc-400">—</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-[12px]">
                      {Object.entries(mcpView.factoryWide).map(([k, v]) => (
                        <li key={k} className="flex items-center justify-between rounded-[8px] border bg-white px-2 py-1.5">
                          <span className="font-mono text-[11px]">{k}</span>
                          <span className="font-mono text-[11px] text-zinc-500">{redactSecret(v)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-[11px] font-[600] uppercase text-zinc-500">agentDefaults</div>
                  {Object.keys(mcpView.agentDefaults).length === 0 ? (
                    <p className="mt-1 text-[12px] text-zinc-400">—</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-[12px]">
                      {Object.entries(mcpView.agentDefaults).map(([k, v]) => (
                        <li key={k} className="flex justify-between rounded-[8px] border bg-white px-2 py-1.5">
                          <span className="font-mono text-[11px]">{k}</span>
                          <span className="font-mono text-[11px] text-zinc-500">{redactSecret(v)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-[11px] font-[600] uppercase text-zinc-500">Ejemplos per-agent</div>
                  <ul className="mt-2 space-y-1 text-[12px]">
                    {mcpView.byAgent.slice(0, 3).map((a) => (
                      <li key={a.agentName} className="rounded-[8px] border bg-white px-2 py-1.5">
                        <div className="font-medium text-zinc-800">{a.agentName}</div>
                        <div className="font-mono text-[11px] text-zinc-500">
                          {Object.keys(a.effective).length ? Object.entries(a.effective).map(([k, v]) => `${k}:${redactSecret(v)}`).join(", ") : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 text-[11px] text-zinc-400">Real: sentry → <span className="font-mono">••••</span> (factory + foreman/triage/implement/security)</div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
            <h3 className="text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">Credential boundaries — 4 tipos (§13)</h3>
            <div className="mt-3 overflow-hidden rounded-[8px] border border-zinc-200">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-zinc-50 text-[11px] font-[600] uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Credencial</th>
                    <th className="px-3 py-2">Para</th>
                    <th className="px-3 py-2">Boundary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 bg-white">
                  <tr>
                    <td className="px-3 py-2 font-medium">Inference credentials</td>
                    <td className="px-3 py-2 text-zinc-600">Model provider requests</td>
                    <td className="px-3 py-2 text-zinc-600">Solo en inference boundary; nunca inyectadas en sandbox</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Execution secrets</td>
                    <td className="px-3 py-2 text-zinc-600">APIs, registries, tools del agent</td>
                    <td className="px-3 py-2 text-zinc-600">
                      Per-agent allowlist; agents sin specific user no reciben por default. Redaction en output es backstop, no sustituto de
                      permisos narrow y rotación.
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Harness auth</td>
                    <td className="px-3 py-2 text-zinc-600">Solo oz (Warp Agent) - sin auth externa</td>
                    <td className="px-3 py-2 text-zinc-600">
                      oz no requiere auth ni reasoningLevel; harness.auth no aplica en este workspace (solo oz).
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium">Repository identity</td>
                    <td className="px-3 py-2 text-zinc-600">Checkout y push</td>
                    <td className="px-3 py-2 text-zinc-600">
                      EXECUTOR (default) vs CREATOR — set por credentialStrategy (factory o per-agent)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              §13 Deployment checklist: classify workload → choose execution → configure factory+runners → choose inference/storage → scope credentials →
              set review gates → validate operations (egress/isolation/rotation/redaction/capacity/observabilidad/metering).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}


