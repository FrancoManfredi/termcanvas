// SRP: SettingsPage composes identity, repos, PW authorship, analysis model, runners, integrations, deletion
// DIP: reads FactoryBundle via hook, derive via settings.derive (pura)

import { useState } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import {
  deriveAnalysisModel,
  deriveIdentity,
  deriveIntegrations,
  deriveRepositories,
  getEffectiveCredentialStrategy,
  getRunnerSourceOfTruth,
  validateForemanAlias,
} from "../../lib/factory/domain/settings.derive";
import { normalizeRunner, formatPlatform, formatInstanceShape } from "../../lib/factory/domain/runner.derive";
import { SettingsSection } from "./SettingsSection";
import type { DefinitionMode } from "../../lib/factory/domain/factory.definition.derive";

export interface SettingsPageProps {
  mode?: DefinitionMode;
}

export function SettingsPage({ mode = "warp-managed" }: SettingsPageProps) {
  const res = useFactoryBundle();
  const bundle = res.ok ? res.value! : null;
  const [draftAlias, setDraftAlias] = useState<string | null>(null);
  const [showDeletionConfirm, setShowDeletionConfirm] = useState(false);

  if (!bundle) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-zinc-500">Factory bundle not available — check warp/factory-config</p>
      </div>
    );
  }

  const identity = deriveIdentity(bundle, []); // workspace uniqueness would need full list — static uses single factory
  const repos = deriveRepositories(bundle);
  const credentialStrategy = getEffectiveCredentialStrategy(bundle);
  const analysisModel = deriveAnalysisModel(bundle);
  const integrations = deriveIntegrations(bundle);
  const runnerSource = getRunnerSourceOfTruth(mode);
  const isFileManaged = mode === "github-backed";

  const currentAlias = draftAlias !== null ? draftAlias : identity.alias;
  const aliasValidation = validateForemanAlias(currentAlias, { existingAliases: [] });
  const aliasValid = aliasValidation.ok;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#f6f6f6] p-4">
      <div className="mx-auto max-w-[880px] space-y-4">
        <div>
          <h2 className="text-[18px] font-[650] tracking-[-0.02em] text-zinc-900">Factory Settings</h2>
          <p className="mt-1 text-[12px] text-zinc-500">WarpFactories.md §10 Factory Settings — Identity, Repositories, Pull request authorship, Analysis model, Runners, Integrations, Deletion.</p>
        </div>

        <SettingsSection
          title="Identity"
          description="name, avatar, Foreman name (alias) — ≤60 [A-Za-z0-9 ._-] único case-insensitive por workspace. WarpFactories.md:496"
        >
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 place-items-center rounded-[10px] bg-zinc-900 text-[14px] font-bold text-white"
              style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
            >
              {identity.avatar}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-[600] text-zinc-900">{identity.name}</div>
              <div className="text-[11px] text-zinc-500">avatar + name (editable in Warp-managed)</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Factory name</span>
              <input
                readOnly
                value={identity.name}
                className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[12px] text-zinc-700"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Foreman name (alias)</span>
              <input
                value={currentAlias}
                onChange={(e) => setDraftAlias(e.target.value)}
                maxLength={60}
                placeholder="alias"
                className={[
                  "mt-1 w-full rounded-[8px] border px-2.5 py-1.5 font-mono text-[12px]",
                  aliasValid ? "border-zinc-200 bg-white text-zinc-800" : "border-red-300 bg-red-50 text-red-800",
                ].join(" ")}
              />
              <span className="mt-1 flex items-center gap-2 text-[11px]">
                <span className={aliasValid ? "text-zinc-400" : "font-medium text-red-600"}>
                  {aliasValid ? `${currentAlias.length}/60 — [A-Za-z0-9 ._-]` : aliasValidation.issues.map((i) => i.message).join(" · ")}
                </span>
              </span>
            </label>
          </div>
        </SettingsSection>

        <SettingsSection title="Repositories" description="owner/name list — GitHub via repositories + GitHub App (no en integrations). WarpFactories.md §7">
          <ul className="space-y-1">
            {repos.map((r) => (
              <li key={`${r.owner}/${r.name}`} className="flex items-center gap-2 rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-mono text-[12px] text-zinc-700">{r.owner}/{r.name}</span>
                <a
                  href={`https://github.com/${r.owner}/${r.name}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-auto text-[11px] font-medium text-violet-600 hover:underline"
                >
                  Open in GitHub
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-zinc-400">factory.yaml → repositories: [{repos.map((r) => `${r.owner}/${r.name}`).join(", ")}]</p>
        </SettingsSection>

        <SettingsSection
          title="Pull request authorship"
          description="credentialStrategy = EXECUTOR (default) vs CREATOR — §7 + §13 credential boundaries (Repository identity)"
        >
          <div className="flex items-center gap-2">
            <span className="rounded bg-zinc-900 px-2 py-1 font-mono text-[11px] font-medium text-white">{credentialStrategy}</span>
            <span className="text-[11px] text-zinc-500">
              {credentialStrategy === "EXECUTOR"
                ? "EXECUTOR (default) — runs con auth del principal que ejecuta el run"
                : "CREATOR — atribuido al usuario que creó el run"}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["EXECUTOR", "CREATOR"] as const).map((opt) => (
              <div
                key={opt}
                className={[
                  "rounded-[8px] border px-3 py-2",
                  credentialStrategy === opt ? "border-violet-300 bg-violet-50" : "border-zinc-200 bg-zinc-50",
                ].join(" ")}
              >
                <div className="text-[11px] font-[600] text-zinc-700">{opt} {opt === "EXECUTOR" && "(default)"}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  {opt === "EXECUTOR" ? "Runs se autentican con el executor principal, no con el event author. Agents pueden override por role." : "Changes atribuidos al usuario que creó el run (requiere mapping de creator)."}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">Agents pueden override por role: agents/&lt;name&gt;/agent.md → credentialStrategy</p>
        </SettingsSection>

        <SettingsSection title="Analysis model" description="modelo que Self-improvement usa para analizar failed runs — WarpFactories.md §10">
          <div className="inline-flex items-center gap-2 rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
            <span className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Analysis model</span>
            <span className="font-mono text-[12px] text-zinc-700">{analysisModel}</span>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">Scorer judge model (scorers/&lt;name&gt;/scorer.md → model) alimenta selfImprovement. Default: auto si no hay scorer.</p>
        </SettingsSection>

        <SettingsSection
          title="Runners"
          description={`${runnerSource} — WarpFactories.md §8. Settings → Runners muestra OS/arch, setup, size y si es default.`}
        >
          {bundle.runners.length === 0 ? (
            <p className="text-[12px] text-zinc-500">Sin runners definidos — usa default del workspace.</p>
          ) : (
            <ul className="space-y-2">
              {bundle.runners.map((r) => {
                const normalized = normalizeRunner(r);
                const platformStr = formatPlatform(r.platform);
                const shapeStr = formatInstanceShape(r.instanceShape);
                const isDefault = bundle.factory.agentDefaults.runner === r.name;
                const githubUrl = `https://github.com/${repos[0]?.owner ?? "acme"}/${repos[0]?.name ?? "payments-service"}/blob/main/${r.rawPath}#L1`;
                return (
                  <li key={r.name} className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-medium text-zinc-800">{r.name}</span>
                      {isDefault && <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white">default</span>}
                      {isFileManaged && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">read-only</span>}
                      {isFileManaged && (
                        <a href={githubUrl} target="_blank" rel="noreferrer noopener" className="ml-auto text-[11px] font-medium text-violet-600 hover:underline">
                          {r.rawPath}
                        </a>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">{platformStr} · {shapeStr} {isFileManaged ? "· file-managed" : "· warp-managed"}</div>
                    {r.description && <div className="mt-1 text-[11px] text-zinc-600">{r.description}</div>}
                    {r.setupCommands?.length ? <div className="mt-1 font-mono text-[11px] text-zinc-500">setup: {r.setupCommands.join(" && ")}</div> : null}
                    <div className="mt-1 text-[11px] text-zinc-400">normalized arch: {normalized.platform.arch} · os: {normalized.platform.os}</div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-zinc-400">Runner vs Environment vs Host: ver §8 table. File-managed = runners/*.yaml es source of truth (read-only en Settings).</p>
        </SettingsSection>

        <SettingsSection title="Integrations" description="slack / linear / jira — WarpFactories.md §9. GitHub via repositories, GitLab vía group conectado.">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {integrations.map((it) => (
              <li key={it.type} className={["rounded-[8px] border px-3 py-2.5", it.status === "connected" ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-zinc-50"].join(" ")}>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-[600] capitalize text-zinc-800">{it.type}</span>
                  <span className={["rounded-full px-1.5 py-0.5 text-[10px] font-medium", it.status === "connected" ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-600"].join(" ")}>{it.status}</span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-500">
                  {it.type === "slack" && "Slack App — mentions/DMs requieren account linkeada"}
                  {it.type === "linear" && "Linear OAuth — teams que disparan factory (mut excl. con Jira)"}
                  {it.type === "jira" && "Jira Cloud + Rovo — mutuamente excluyente con Linear"}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-zinc-400">GitHub no en integrations (repositories + GitHub App). Schedule/factory siempre disponibles vía automation triggers.</p>
        </SettingsSection>

        <SettingsSection title="Deletion" description="Borra la factory — Irreversible. En GitLab/Slack además remueve bot/app.">
          <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-3">
            <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-red-600">Deletion — no reversible</div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-700">
              Borra la factory <span className="font-mono font-medium">{identity.name}</span>. En GitLab/Slack además remueve bot/app. Requiere Team Owner. Esta acción no se puede deshacer.
            </p>
            {!showDeletionConfirm ? (
              <button
                onClick={() => setShowDeletionConfirm(true)}
                className="mt-2 rounded-[8px] bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700"
              >
                Delete factory
              </button>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <button className="rounded-[8px] bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white">Confirm deletion (stub)</button>
                <button onClick={() => setShowDeletionConfirm(false)} className="rounded-[8px] border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700">Cancel</button>
              </div>
            )}
          </div>
        </SettingsSection>

        <p className="pb-2 text-[11px] text-zinc-400">Nombres exactos del doc: Identity, Repositories, Pull request authorship, Analysis model, Runners, Integrations, Deletion.</p>
      </div>
    </div>
  );
}
