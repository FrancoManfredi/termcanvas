
import type { AutomationDefinition } from "../../lib/factory/domain/types";

interface AutomationCardProps {
  automation: AutomationDefinition;
  isSelected: boolean;
  isMatched: boolean;
  onSelect: (name: string) => void;
}

export function AutomationCard({ automation, isSelected, isMatched, onSelect }: AutomationCardProps) {
  function handleClick() {
    onSelect(automation.name);
  }
  function getProviderBadges() {
    return automation.triggers.map((t, i) => {
      return (
        <span key={i} className="inline-flex items-center rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {t.provider}:{t.event}
        </span>
      );
    });
  }
  function getFilterSummary() {
    const filters = automation.triggers
      .map((t) => {
        if (!t.filter || Object.keys(t.filter).length === 0) return "sin filtros";
        return Object.entries(t.filter)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(" · ");
      })
      .join(" | ");
    return filters || "—";
  }
  function getOverridesSummary() {
    const parts: string[] = [];
    if (automation.model) {
      parts.push(`model:${automation.model}`);
    }
    if (automation.harness) {
      parts.push(`harness:${automation.harness.type}`);
    }
    if (automation.runner) {
      parts.push(`runner:${automation.runner}`);
    }
    if (automation.secrets && automation.secrets.length > 0) {
      parts.push(`secrets:${automation.secrets.length}`);
    }
    const summary = parts.length ? parts.join(" · ") : "hereda de agent";
    return summary;
  }

  return (
    <button
      onClick={handleClick}
      className={[
        "w-full text-left rounded-[10px] border px-3 py-3 transition-[background-color,border-color,box-shadow,scale] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20",
        isSelected ? "bg-violet-50 border-violet-200 shadow-[0_0_0_1px_rgba(124,58,237,0.12)]" : "bg-white border-zinc-200 hover:bg-zinc-50",
        isMatched ? "ring-1 ring-emerald-400/40" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">{automation.name}</span>
            <span className={["inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium", automation.enabled ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"].join(" ")}>
              {automation.enabled ? "enabled" : "disabled"}
            </span>
            {isMatched && <span className="inline-flex rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white">matched</span>}
          </div>
          <p className="mt-0.5 text-[12px] text-zinc-500">agent: <span className="font-medium text-zinc-700">{automation.agent}</span> · {getOverridesSummary()}</p>
        </div>
        <span className="shrink-0 text-[11px] text-zinc-400">{automation.triggers.length} trigger{automation.triggers.length > 1 ? "s" : ""}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">{getProviderBadges()}</div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{getFilterSummary()}</p>
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-zinc-600">{automation.prompt.slice(0, 120)}</p>
    </button>
  );
}
