import type { RunnerDefinition } from "../../lib/factory/domain/types";
import type { NormalizedRunner, RunnerUsage } from "../../lib/factory/domain/runner.derive";
import { formatInstanceShape } from "../../lib/factory/domain/runner.derive";

export interface RunnerCardProps {
  runner: RunnerDefinition;
  normalized: NormalizedRunner;
  usage: RunnerUsage;
  selected: boolean;
  onSelect: (name: string) => void;
}

function platformLabel(n: NormalizedRunner): string {
  if (n.platform.os === "macos") {
    return `macos · aarch64 · macOS ${n.platform.mac?.version ?? "26"}`;
  }
  return `linux · ${n.platform.arch} · ${n.platform.linux?.dockerImage ?? "—"}`;
}

function shapeLabel(runner: RunnerDefinition): string {
  return formatInstanceShape(runner.instanceShape);
}

export function RunnerCard({ runner, normalized, usage, selected, onSelect }: RunnerCardProps) {
  function handleClick() {
    onSelect(runner.name);
  }

  return (
    <button
      onClick={handleClick}
      aria-current={selected ? "true" : undefined}
      aria-label={`Select runner ${runner.name}`}
      className={[
        "flex w-full flex-col gap-2 rounded-[10px] border px-3 py-3 text-left transition-[background-color,box-shadow,border-color] duration-150",
        selected
          ? "border-violet-300 bg-violet-50 shadow-[0_1px_3px_rgba(124,58,237,0.12)]"
          : "border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">{runner.name}</span>
        {usage.isDefault && (
          <span className="inline-flex items-center rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-[700] tracking-[0.06em] uppercase text-white">
            default
          </span>
        )}
        <span
          className={[
            "ml-auto inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
            normalized.platform.os === "macos"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 bg-white text-zinc-600",
          ].join(" ")}
        >
          {normalized.platform.os}
        </span>
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-violet-600" aria-hidden />}
      </div>

      {runner.description && (
        <p className="line-clamp-2 text-[12.5px] leading-snug text-zinc-600">{runner.description}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          {platformLabel(normalized)}
        </span>
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600">
          {shapeLabel(runner)}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-full bg-zinc-900/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-700">
          {usage.agents.length} agent{usage.agents.length !== 1 ? "s" : ""}
        </span>
        {usage.automations.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-zinc-900/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-700">
            {usage.automations.length} automation{usage.automations.length !== 1 ? "s" : ""}
          </span>
        )}
        {runner.setupCommands?.length ? (
          <span className="text-[11px] text-zinc-500">{runner.setupCommands.length} setup cmd{runner.setupCommands.length !== 1 ? "s" : ""}</span>
        ) : null}
      </div>

      <span className="truncate font-mono text-[11px] text-zinc-400">{runner.rawPath}</span>
    </button>
  );
}

export default RunnerCard;
