import { useMemo, useState } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import type { RunnerDefinition } from "../../lib/factory/domain/types";
import { RunnerCard } from "./RunnerCard";
import { RunnerDetail } from "./RunnerDetail";
import { deriveRunnerUsage, normalizeRunner } from "../../lib/factory/domain/runner.derive";

function sortRunnersForDisplay(runners: RunnerDefinition[]): RunnerDefinition[] {
  const sorted = [...runners].sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}

function getSelectedRunner(runners: RunnerDefinition[], selectedName: string | null): RunnerDefinition | null {
  if (!selectedName) return runners[0] ?? null;
  return runners.find((r) => r.name === selectedName) ?? runners[0] ?? null;
}

export function RunnersPage() {
  const bundleResult = useFactoryBundle();
  const [selectedName, setSelectedName] = useState<string | null>(null);

  function handleSelect(name: string) {
    setSelectedName(name);
  }

  const content = useMemo(() => {
    if (!bundleResult.ok) {
      return {
        error: bundleResult.issues.map((i) => i.message).join("; "),
        factory: null,
        runners: [] as RunnerDefinition[],
        usageMap: new Map<string, ReturnType<typeof deriveRunnerUsage>[number]>(),
      };
    }
    const sorted = sortRunnersForDisplay(bundleResult.value!.runners);
    const usage = deriveRunnerUsage(bundleResult.value!);
    const map = new Map(usage.map((u) => [u.runnerName, u]));
    return {
      error: null,
      factory: bundleResult.value!.factory,
      bundle: bundleResult.value!,
      runners: sorted,
      usageMap: map,
    };
  }, [bundleResult]);

  const selectedRunner = useMemo(() => {
    return getSelectedRunner(content.runners, selectedName);
  }, [content.runners, selectedName]);

  const selectedUsage = useMemo(() => {
    if (!selectedRunner) return null;
    return content.usageMap.get(selectedRunner.name) ?? null;
  }, [selectedRunner, content.usageMap]);

  const selectedNormalized = useMemo(() => {
    if (!selectedRunner) return null;
    return normalizeRunner(selectedRunner);
  }, [selectedRunner]);

  if (content.error) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
        <div className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-white px-4 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Runners</span>
        </div>
        <div className="p-4 text-sm text-red-600">{content.error}</div>
      </div>
    );
  }

  const factory = content.factory as NonNullable<typeof content.factory>;
  const bundle = (content as unknown as { bundle: typeof bundleResult extends { value: infer V } ? V : never }).bundle;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel">
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Runners</span>
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">{content.runners.length}</span>
        </div>
        <span className="text-[11px] font-medium text-zinc-500">Settings › Runners · file-managed — read-only</span>
      </div>

      <div className="border-b border-zinc-200 bg-white px-4 py-3">
        <p className="text-[13px] font-medium text-zinc-900">Runners — compute where agents run</p>
        <p className="mt-1 text-[12px] leading-snug text-zinc-500">
          Factory: {factory.name} · agentDefaults.runner = <span className="font-mono">{factory.agentDefaults.runner ?? "—"}</span> · Each runner: platform OS/arch + image, instanceShape (vcpus/memoryGb together, hosted max 32/64,
          self-hosted exempt), setupCommands. Per-agent/per-automation overrides shown in detail.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[11px] font-[600] tracking-[0.06em] uppercase text-amber-700">LOCAL — Concurrencia queueada (US-062 mock)</p>
            <p className="mt-1 text-[11px] leading-snug text-amber-800">Warp-hosted limitada por team → exceso queueado. En LOCAL es mock: todos corren. No hay límite real ni costo. Hosted max <span className="font-mono">32 vCPU / 64 GiB</span> (War p rechaza por encima; self-hosted exempt).</p>
          </div>
          <div className="rounded-[8px] border border-violet-200 bg-violet-50 px-3 py-2">
            <p className="text-[11px] font-[600] tracking-[0.06em] uppercase text-violet-700">LOCAL — OTel placeholder (US-066)</p>
            <p className="mt-1 text-[11px] leading-snug text-violet-800">Métricas OTel <span className="font-mono">worker health / task throughput / capacity saturation</span> solo en self-hosted real. En LOCAL son placeholder — no hay worker. Ver <span className="font-mono">runner.derive.ts</span> + <span className="font-mono">InfraPage</span>.</p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-zinc-200 bg-panel lg:max-w-[380px]">
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-2">
              {content.runners.map((runner) => {
                const normalized = normalizeRunner(runner);
                const usage = content.usageMap.get(runner.name)!;
                return (
                  <RunnerCard
                    key={runner.name}
                    runner={runner}
                    normalized={normalized}
                    usage={usage}
                    selected={selectedRunner?.name === runner.name}
                    onSelect={handleSelect}
                  />
                );
              })}
            </div>
            {content.runners.length === 0 && (
              <p className="mt-4 text-center text-[12px] text-zinc-500">No runners — add runners/*.yaml</p>
            )}
          </div>
        </div>

        <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex">
          {selectedRunner && selectedNormalized && selectedUsage && bundle ? (
            <RunnerDetail runner={selectedRunner} normalized={selectedNormalized} usage={selectedUsage} bundle={bundle} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">No runner selected</div>
          )}
        </div>
      </div>

      {selectedRunner && selectedNormalized && selectedUsage && bundle && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-zinc-200 bg-white lg:hidden">
          <RunnerDetail runner={selectedRunner} normalized={selectedNormalized} usage={selectedUsage} bundle={bundle} />
        </div>
      )}
    </div>
  );
}

export default RunnersPage;
