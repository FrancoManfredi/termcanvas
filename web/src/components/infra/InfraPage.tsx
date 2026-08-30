// InfraPage — SRP: static Infra/Security view, no side effects
// DIP: reads from infra.derive + runner.derive (pure) — OCP: add pattern via infra.derive without touching this file
import {
  DEPLOYMENT_PATTERNS,
  TEAM_CHOICES,
  CREDENTIAL_BOUNDARIES,
  ZDR_NOTE,
  GOVERNANCE_NOTE,
  METERING_NOTE,
  DEPLOYMENT_CHECKLIST,
  OTEL_METRICS,
  RUNNER_BACKENDS,
  CONCURRENCY_NOTE,
  HOSTED_MAX,
  CONTROL_VS_EXECUTION,
  ENVIRONMENT_VS_RUNNER_VS_HOST,
} from "../../lib/factory/domain/infra.derive";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-[13px] font-[650] tracking-[-0.01em] text-zinc-900">{title}</h3>
      {subtitle && <p className="mt-1 text-[11.5px] leading-snug text-zinc-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-[8px] border border-zinc-200">{children}</div>;
}

export function InfraPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-panel">
      <div className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-4 text-[13px]">
        <span className="font-medium text-zinc-900">wilson</span>
        <span className="text-zinc-400">›</span>
        <span className="font-medium text-zinc-900">Infra</span>
        <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">WarpFactories.md §8 §13 §14</span>
      </div>

      <div className="mx-auto w-full max-w-[1080px] p-4">
        <div className="mb-4">
          <h2 className="text-[18px] font-[650] tracking-[-0.02em] text-zinc-900">Infraestructura y Seguridad</h2>
          <p className="mt-1 text-[12.5px] leading-snug text-zinc-500">
            WarpFactories.md §13 Infraestructura y Seguridad + §8 Runners + §14 Sizing y Deployment. Nombres exactos del doc. Estático con sentido — no inventa, lee de <span className="font-mono">infra.derive</span> y <span className="font-mono">runner.derive</span>.
          </p>
        </div>

        <div className="space-y-4">
          {/* 3 deployment patterns */}
          <Section
            title="3 Deployment Patterns — platform/deployment-patterns (CLI-only / Warp-hosted / Self-hosted)"
            subtitle="WarpFactories.md §14 — Fuente: platform/deployment-patterns. 3 patrones con Trigger / Orchestration / Execution / Visibility."
          >
            <TableWrapper>
              <table className="w-full text-left text-[12px]">
                <thead className="bg-zinc-50 text-[11px] font-[600] uppercase tracking-[0.06em] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Pattern</th>
                    <th className="px-3 py-2">Trigger</th>
                    <th className="px-3 py-2">Orchestration</th>
                    <th className="px-3 py-2">Execution</th>
                    <th className="px-3 py-2">Visibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {DEPLOYMENT_PATTERNS.map((p) => (
                    <tr key={p.id} className="bg-white">
                      <td className="px-3 py-2 font-[600] text-zinc-900">{p.pattern}</td>
                      <td className="px-3 py-2 text-zinc-700">{p.trigger}</td>
                      <td className="px-3 py-2 text-zinc-700">{p.orchestration}</td>
                      <td className="px-3 py-2 text-zinc-700">{p.execution}</td>
                      <td className="px-3 py-2 text-zinc-700">{p.visibility}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrapper>
            <p className="mt-2 text-[11px] text-zinc-500">
              Unmanaged (<span className="font-mono">oz agent run</span>) y otros CLI agents <span className="font-medium text-zinc-700">no pueden ser factory&apos;s execution host</span> pero sí exchange work vía Factory MCP. Pattern 1 CLI-only = bring-your-own-orchestrator.
            </p>
          </Section>

          {/* Control vs Execution plane */}
          <Section title="Control plane vs Execution plane — §13" subtitle="WarpFactories.md §13 tabla + diagrama Mermaid.">
            <TableWrapper>
              <table className="w-full text-left text-[12px]">
                <thead className="bg-zinc-50 text-[11px] font-[600] uppercase tracking-[0.06em] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Plano</th>
                    <th className="px-3 py-2">Responsabilidades</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {CONTROL_VS_EXECUTION.map((r) => (
                    <tr key={r.plane}>
                      <td className="px-3 py-2 font-[600] text-zinc-900">{r.plane}</td>
                      <td className="px-3 py-2 text-zinc-700">{r.responsibilities}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrapper>
            <p className="mt-2 text-[11px] text-zinc-500">Session transcripts via Warp backend también bajo ZDR. Ver platform/self-hosting/security-and-networking.</p>
          </Section>

          {/* Environment vs Runner vs Host */}
          <Section
            title="Environment vs Runner vs Host — §8 Runners (Environment vs Runner vs Host)"
            subtitle="Ya existe en RunnersPage — reutilizado aquí via ENVIRONMENT_VS_RUNNER_VS_HOST (runner.derive). WarpFactories.md §8 y §13. Factory colapsa Environment+Runner en runners/*.yaml + agentDefaults.environmentId pero la plataforma los separa."
          >
            <TableWrapper>
              <table className="w-full text-left text-[12px]">
                <thead className="bg-zinc-50 text-[11px] font-[600] uppercase tracking-[0.06em] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Concepto</th>
                    <th className="px-3 py-2">Qué es</th>
                    <th className="px-3 py-2">Dónde se configura</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {ENVIRONMENT_VS_RUNNER_VS_HOST.map((r) => (
                    <tr key={r.concept}>
                      <td className="px-3 py-2 font-[600] text-zinc-900">{r.concept}</td>
                      <td className="px-3 py-2 text-zinc-700">{r.what}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-zinc-600">{r.where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrapper>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700">
                Hosted max <span className="font-mono">{HOSTED_MAX.vcpus} vCPU / {HOSTED_MAX.memoryGb} GiB</span> (Enterprise configurable hasta 32/64, más requiere soporte)
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700">{CONCURRENCY_NOTE}</span>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">OTel: {OTEL_METRICS.join(" · ")}</span>
              <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700">Backends: {RUNNER_BACKENDS.join(" / ")}</span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              Managed self-hosted runners están <span className="font-medium">exempt</span> de 32/64 (compute lo provee el team). Warp rechaza hosted shapes por encima. Concurrencia Warp-hosted limitada por team → exceso queueado; self-hosted depende de tu capacidad. Ver Settings › Runners (read-only si file-managed).
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">Runners: platform OS/arch + image, instanceShape (vcpus/memoryGb juntos), setupCommands. Per-agent/per-automation overrides en detail.</p>
          </Section>

          {/* 3 choices independientes */}
          <Section
            title="3 Choices independientes — execution / inference / storage — Enterprise only (§13)"
            subtitle="WarpFactories.md §13: son tres elecciones independientes, cada una mueve un boundary y deja el resto con Warp. Todas requieren Enterprise: managed self-hosted execution, customer-supplied inference, customer-owned storage."
          >
            <TableWrapper>
              <table className="w-full text-left text-[12px]">
                <thead className="bg-zinc-50 text-[11px] font-[600] uppercase tracking-[0.06em] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Team choice</th>
                    <th className="px-3 py-2">Qué cambia</th>
                    <th className="px-3 py-2">Qué queda con Warp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {TEAM_CHOICES.map((c) => (
                    <tr key={c.choice}>
                      <td className="px-3 py-2">
                        <span className="font-[600] text-zinc-900">{c.choice}</span>
                        <span className="ml-1 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-medium text-violet-700">Enterprise</span>
                        <div className="font-mono text-[11px] text-zinc-500">{c.options}</div>
                      </td>
                      <td className="px-3 py-2 text-zinc-700">{c.whatChanges}</td>
                      <td className="px-3 py-2 text-zinc-700">{c.whatStaysWithWarp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrapper>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-zinc-600">
              <li>Execution: customer-supplied inference limitado a providers que soportan cloud agents (enterprise/enterprise-features/team-managed-keys-and-endpoints, bring-your-own-llm). Cuando proveés el provider, la retention del provider sigue tu account/contrato; Warp no puede configurarla ni enforcearla. ZDR solo si el provider lo soporta.</li>
              <li>Storage: Enterprise puede persistir supported data classes (transcripts, artifacts, run attachments) en customer-owned S3/GCS bucket. Mucho factory state (config, run metadata, control-plane state) permanece con Warp.</li>
              <li>Runs son cloud agents → platform/services/metrics siguen por Warp control plane independiente de estas elecciones.</li>
            </ul>
          </Section>

          {/* 4 credential boundaries */}
          <Section
            title="4 Credential Boundaries — §13 (nombres exactos)"
            subtitle="WarpFactories.md §13 tabla con redaction como backstop, no sustituto de narrow permissions y rotación."
          >
            <TableWrapper>
              <table className="w-full text-left text-[12px]">
                <thead className="bg-zinc-50 text-[11px] font-[600] uppercase tracking-[0.06em] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Credencial</th>
                    <th className="px-3 py-2">Para</th>
                    <th className="px-3 py-2">Boundary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {CREDENTIAL_BOUNDARIES.map((b) => (
                    <tr key={b.credential}>
                      <td className="px-3 py-2 font-[600] text-zinc-900">{b.credential}</td>
                      <td className="px-3 py-2 text-zinc-700">{b.para}</td>
                      <td className="px-3 py-2 text-zinc-700">{b.boundary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrapper>
            <p className="mt-2 text-[11px] text-zinc-500">
              Scopear cada credential a los resources y actions que su agent necesita. Rotar narrow permissions en el provider externo. Redaction es backstop.
            </p>
          </Section>

          {/* ZDR */}
          <Section title="Zero Data Retention (ZDR) — §13" subtitle="Disclaimer exacto del doc.">
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-zinc-700">
              {ZDR_NOTE}
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">Code context en LLM prompts siempre fluye a Warp/providers bajo ZDR cuando el provider lo soporta — self-hosted no es fully offline. Ver platform/self-hosting/security-and-networking.</p>
          </Section>

          {/* Governance */}
          <Section title="Governance sin factory-specific role — §13" subtitle="WarpFactories.md §13 Governance y metering.">
            <p className="text-[12px] leading-relaxed text-zinc-700">{GOVERNANCE_NOTE}</p>
            <p className="mt-2 text-[11px] text-zinc-500">Ver también Settings → Identity (Foreman name alias) y Runners (read-only si file-managed) — WarpFactories.md §10 Factory Settings.</p>
          </Section>

          {/* Metering */}
          <Section title="Metering credits — §13" subtitle="WarpFactories.md §13 + support-and-community/plans-and-billing/platform-credits">
            <p className="text-[12px] leading-relaxed text-zinc-700">{METERING_NOTE}</p>
            <p className="mt-2 text-[11px] text-zinc-500">
              Usage-based per agent run. Hosted compute, Warp-provided inference y platform services consumen credits; self-hosted mueve compute a tu infra y BYO inference a tu provider, pero platform services siempre consumen credits.
            </p>
          </Section>

          {/* 7-step checklist */}
          <Section title="Deployment checklist — 7 pasos (§13)" subtitle="WarpFactories.md §13 checklist exacto.">
            <ol className="space-y-2">
              {DEPLOYMENT_CHECKLIST.map((s) => (
                <li key={s.step} className="flex gap-3 rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-900 text-[11px] font-[700] text-white">{s.step}</span>
                  <div>
                    <span className="text-[12px] font-[600] text-zinc-900">{s.title}</span>
                    <p className="text-[11.5px] leading-snug text-zinc-600">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-zinc-500">
              Elegir execution host: Deploy worker con agent API key (linux/amd64|arm64, Docker/K8s/Direct incl. Helm) → pair con runner compatible (platform match) → workerHost: ID en agentDefaults o per-agent/automation. Workers: linux/amd64 y linux/arm64; platform del worker determina workloads.
            </p>
          </Section>

          <div className="rounded-[8px] border border-dashed border-zinc-300 bg-white px-3 py-2 text-[11px] text-zinc-500">
            Ref: Factory colapsa Environment+Runner en <span className="font-mono">runners/*.yaml</span> + <span className="font-mono">agentDefaults.environmentId</span> pero la plataforma los separa. Ver platform/runners/#how-runners-fit-into-cloud-agent-runs. · Ver también web/WarpFactories.md §8 §13 §14 y web/WarpFactories-UserStories.md E15 US-131→139.
          </div>
        </div>
      </div>
    </div>
  );
}

export default InfraPage;
