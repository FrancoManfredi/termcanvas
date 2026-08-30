import type { RunnerDefinition } from "../../lib/factory/domain/types";
import type { FactoryBundle } from "../../lib/factory/store/factoryRegistry";
import type { NormalizedRunner, RunnerUsage } from "../../lib/factory/domain/runner.derive";
import {
  ENVIRONMENT_VS_RUNNER_VS_HOST,
  HOSTED_MAX_MEMORY_GB,
  HOSTED_MAX_VCPUS,
  formatInstanceShape,
  validateRunner,
} from "../../lib/factory/domain/runner.derive";

export interface RunnerDetailProps {
  runner: RunnerDefinition;
  normalized: NormalizedRunner;
  usage: RunnerUsage;
  bundle: FactoryBundle;
}

export function RunnerDetail({ runner, normalized, usage, bundle: _bundle }: RunnerDetailProps) {
  const validation = validateRunner(runner, { isSelfHosted: false });
  const isViolation = validation.issues.some((i) => i.code === "exceeds_max_vcpu" || i.code === "exceeds_max_memory");
  const shapeText = formatInstanceShape(runner.instanceShape);
  const hasSetup = runner.setupCommands && runner.setupCommands.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-[600] tracking-[-0.01em] text-zinc-900">{runner.name}</h2>
          {usage.isDefault && (
            <span className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase text-white">
              default
            </span>
          )}
          <span
            className={[
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
              normalized.platform.os === "macos"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-600",
            ].join(" ")}
          >
            {normalized.platform.os} · {normalized.platform.arch}
          </span>
        </div>
        {runner.description && <p className="mt-1 text-[12.5px] leading-snug text-zinc-600">{runner.description}</p>}
        <p className="mt-1 font-mono text-[11px] text-zinc-500">{runner.rawPath}</p>
        {usage.isDefault && (
          <p className="mt-1 text-[11px] text-zinc-500">
            agentDefaults.runner — agents/automations without explicit runner use this.
          </p>
        )}
      </div>

      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
        <p className="text-[11px] font-medium text-amber-800">
          File-managed — read-only. Source of truth is{" "}
          <span className="font-mono underline decoration-amber-300 underline-offset-2">{runner.rawPath}</span> — edit via PR (Settings → Runners reflects same file).
        </p>
        <p className="mt-0.5 text-[11px] text-amber-700">Como en Settings → Runners cuando runners/*.yaml es source of truth.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Platform</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">
                {normalized.platform.os} / {normalized.platform.arch}
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                {normalized.platform.os === "linux"
                  ? `dockerImage: ${normalized.platform.linux?.dockerImage ?? "—"}`
                  : `mac.version: "${normalized.platform.mac?.version ?? "26"}"`}
              </p>
            </div>
            <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
              <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Shape</p>
              <p className="mt-0.5 font-mono text-[12px] text-zinc-800">{shapeText}</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Hosted max {HOSTED_MAX_VCPUS} vCPU / {HOSTED_MAX_MEMORY_GB} GiB — self-hosted exempt.
              </p>
              {isViolation && (
                <p className="mt-1 text-[11px] font-medium text-red-600">
                  Exceeds hosted limit — Warp rejects, contact support or use self-hosted.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">setupCommands[]</p>
            {hasSetup ? (
              <ul className="mt-1 list-disc pl-4 font-mono text-[12px] text-zinc-800">
                {runner.setupCommands!.map((cmd, idx) => (
                  <li key={idx} className="break-all">
                    {cmd}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 font-mono text-[12px] text-zinc-500">— (none)</p>
            )}
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Agents using this runner</p>
            {usage.agents.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {usage.agents.map((a) => (
                  <span key={a} className="inline-flex items-center rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">
                    {a}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-[12px] text-zinc-500">No direct agent — may still be default for agents without override.</p>
            )}
            <p className="mt-1 text-[11px] text-zinc-500">
              agentDefaults.runner = <span className="font-mono">linux-build</span> (default). Each agent may override; e.g., foreman → linux, implement → macOS.
            </p>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-2">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Automations using this runner</p>
            {usage.automations.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {usage.automations.map((a) => (
                  <span key={a} className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                    {a}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 text-[12px] text-zinc-500">None with explicit runner — inherits from agent.</p>
            )}
            <p className="mt-1 text-[11px] text-zinc-500">Per-automation runner overrides agent setting for runs it starts.</p>
          </div>

          <div className="rounded-[8px] border border-zinc-200 bg-white px-3 py-3">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Environment vs Runner vs Host</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="text-left text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">
                    <th className="border-b border-zinc-200 px-2 py-1.5">Concept</th>
                    <th className="border-b border-zinc-200 px-2 py-1.5">What</th>
                    <th className="border-b border-zinc-200 px-2 py-1.5">Where</th>
                  </tr>
                </thead>
                <tbody>
                  {ENVIRONMENT_VS_RUNNER_VS_HOST.map((row) => (
                    <tr key={row.concept} className="align-top">
                      <td className="border-b border-zinc-100 px-2 py-2 font-[600] text-zinc-900">{row.concept}</td>
                      <td className="border-b border-zinc-100 px-2 py-2 text-zinc-700">{row.what}</td>
                      <td className="border-b border-zinc-100 px-2 py-2 font-mono text-[11px] text-zinc-600">{row.where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Factory colapsa Environment+Runner en <span className="font-mono">runners/*.yaml</span> +{" "}
              <span className="font-mono">agentDefaults.environmentId</span>, pero la plataforma los separa. Un run es{" "}
              <span className="font-medium">Environment + Runner + Host</span>.
            </p>
          </div>

          {validation.issues.length > 0 && isViolation === false && (
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-medium text-amber-800">Validation notes</p>
              <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-800/80">
                {validation.issues.map((iss, idx) => (
                  <li key={idx} className="break-all">
                    {iss.path}: {iss.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 px-3 py-2">
            <p className="text-[10px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Platform rules (WarpFactories.md §7/§8)</p>
            <ul className="mt-1 list-disc pl-4 text-[11px] leading-relaxed text-zinc-600">
              <li>os: linux (default) | macos; arch: x86_64 (default Linux) | aarch64 (only macOS is aarch64)</li>
              <li>Linux requires linux.dockerImage (any image with bash+coreutils)</li>
              <li>macOS accepts mac.version &quot;14&quot; | &quot;15&quot; | &quot;26&quot; | &quot;27&quot; default &quot;26&quot; quoted</li>
              <li>instanceShape: vcpus + memoryGb juntos — omit → workspace default</li>
              <li>Hosted max {HOSTED_MAX_VCPUS} vCPU / {HOSTED_MAX_MEMORY_GB} GiB (Enterprise) — self-hosted exempt</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RunnerDetail;
