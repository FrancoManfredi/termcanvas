// SRP: Factory identity header — Identity, Repos, PW authorship, Analysis model, Runners, Deletion warning
// Renamed from FactorySettingsHeader to avoid overlap with factory-definition/SettingsPage (full page)
// DIP: recibe FactoryBundle (via hook), no hardcodes salvo fallback
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";

export function FactoryIdentityHeader() {
  const bundleRes = useFactoryBundle();
  const bundle = bundleRes.ok ? bundleRes.value! : null;
  const factory = bundle?.factory ?? null;
  const name = factory?.name ?? "wilson";
  const alias = factory?.alias ?? "wilson";
  const credentialStrategy = factory?.credentialStrategy ?? "EXECUTOR";
  const repos = factory?.repositories ?? [
    { owner: "acme", name: "payments-service" },
    { owner: "acme", name: "payments-api" },
  ];
  const aliasValid = alias.length <= 60 && /^[A-Za-z0-9 ._-]+$/.test(alias);
  return (
    <section className="rounded-[12px] border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 place-items-center rounded-[8px] bg-zinc-900 text-[13px] font-bold text-white"
          style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.18), 0 0 0 1px oklch(0 0 0 / 0.08)" }}
          aria-hidden
        >
          W
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">{name}</h2>
            <span className="rounded-full bg-zinc-900/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-600">
              wil via alias
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-zinc-500">
            <span>
              Foreman name (alias): <span className="font-medium text-zinc-700">{alias}</span>
            </span>
            {!aliasValid && <span className="text-[11px] font-medium text-red-600">alias max 60 [A-Za-z0-9 ._-] — invalido</span>}
            <span className="text-zinc-300">•</span>
            <span>{alias.length}/60</span>
          </div>
        </div>
        <span className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600">Identity</span>
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2.5">
          <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Repositories</div>
          <ul className="mt-1.5 space-y-0.5 text-[12px] text-zinc-700">
            {repos.map((r) => (
              <li key={`${r.owner}/${r.name}`} className="font-mono text-[12px] tabular-nums">
                {r.owner}/{r.name}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[11px] text-zinc-400">GitHub via repositories + GitHub App (no en integrations)</div>
        </div>
        <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2.5">
          <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Pull request authorship</div>
          <div className="mt-1.5 text-[12px] text-zinc-700">
            credentialStrategy: <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">{credentialStrategy}</span>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            <span className="font-medium text-zinc-600">EXECUTOR</span> (default) — runs con auth del principal que ejecuta el run.{" "}
            <span className="font-medium text-zinc-600">CREATOR</span> — atribuido al usuario que creó el run. Agents pueden override por role.
          </div>
        </div>
        <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2.5">
          <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Analysis model</div>
          <div className="mt-1.5 text-[12px] text-zinc-700">model para Self-improvement analysis (scorer judge model)</div>
          <div className="mt-1 font-mono text-[11px] text-zinc-500">scorer model: claude-4-5-haiku (tests-run)</div>
          <div className="mt-2 text-[11px] text-zinc-400">Runners: read-only si file-managed (runners/*.yaml es source of truth)</div>
        </div>
      </div>

      <div className="mt-3 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2.5">
        <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-red-600">Deletion — no reversible</div>
        <div className="mt-1 text-[11px] leading-relaxed text-zinc-600">
          Borra la factory. En GitLab/Slack además remueve bot/app. Factory name <span className="font-medium">{name}</span> no se recupera. Requiere Team Owner.
        </div>
      </div>
      <div className="mt-2 text-[11px] text-zinc-400">War pFactories.md §10 Factory Settings — Identity (alias ≤60 [A-Za-z0-9 ._-]), Repos, PW authorship, Analysis model, Runners, Integrations, Deletion.</div>
    </section>
  );
}

// Compat alias — remove in next major
export const FactorySettingsHeader = FactoryIdentityHeader;
