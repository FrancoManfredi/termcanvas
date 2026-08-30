
import type { AutomationDefinition } from "../../lib/factory/domain/types";

interface AutomationDetailProps {
  automation: AutomationDefinition | null;
  onClose?: () => void;
}

export function AutomationDetail({ automation, onClose }: AutomationDetailProps) {
  function handleClose() {
    onClose?.();
  }
  function formatFilter(filter: Record<string, unknown> | undefined) {
    if (!filter || Object.keys(filter).length === 0) {
      return "sin filtros — match todo (mismo provider+event)";
    }
    const lines = Object.entries(filter).map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}: [${(v as string[]).join(", ")}] (OR)`;
      }
      if (v !== null && typeof v === "object") {
        const obj = v as { in?: string[]; not_in?: string[] };
        const parts: string[] = [];
        if (obj.in) parts.push(`in: [${obj.in.join(", ")}]`);
        if (obj.not_in) parts.push(`not_in: [${obj.not_in.join(", ")}]`);
        return `${k}: { ${parts.join(", ")} }`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    });
    const result = lines.join("  AND  ");
    return result;
  }
  function getExecutionOverrides() {
    if (!automation) {
      return [];
    }
    const rows: { label: string; value: string }[] = [];
    if (automation.model) {
      rows.push({ label: "model", value: automation.model });
    }
    if (automation.harness) {
      rows.push({ label: "harness", value: `${automation.harness.type}${automation.harness.model ? ` (${automation.harness.model})` : ""}` });
    }
    if (automation.runner) {
      rows.push({ label: "runner", value: automation.runner });
    }
    if (automation.environmentId) {
      rows.push({ label: "environmentId", value: automation.environmentId });
    }
    if (automation.secrets && automation.secrets.length > 0) {
      rows.push({ label: "secrets", value: automation.secrets.join(", ") });
    }
    if (automation.mcpServers && Object.keys(automation.mcpServers).length > 0) {
      rows.push({ label: "mcpServers", value: Object.keys(automation.mcpServers).join(", ") });
    }
    if (automation.workerHost) {
      rows.push({ label: "workerHost", value: automation.workerHost });
    }
    return rows;
  }

  if (!automation) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm font-medium text-zinc-700">Seleccioná una automation</p>
          <p className="mt-1 text-xs text-zinc-500">Verás triggers, filtros, prompt y overrides</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-[600] tracking-[-0.01em] text-zinc-900">{automation.name}</h3>
          <p className="text-[11px] text-zinc-500">automations/{automation.name}/automation.md</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={["rounded-full px-2 py-0.5 text-[11px] font-medium", automation.enabled ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"].join(" ")}>
            {automation.enabled ? "enabled: true" : "enabled: false"}
          </span>
          {onClose && (
            <button onClick={handleClose} className="grid h-7 w-7 place-items-center rounded-[8px] border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50">
              ×
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section>
          <h4 className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Agent</h4>
          <p className="mt-1 text-[13px] text-zinc-800">
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white">{automation.agent}</span>
            <span className="ml-2 text-[11px] text-zinc-500">default: foreman</span>
          </p>
        </section>

        <section>
          <h4 className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Triggers ({automation.triggers.length})</h4>
          <div className="mt-2 space-y-2">
            {automation.triggers.map((t, idx) => {
              return (
                <div key={idx} className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-white border border-zinc-200 px-2 py-0.5 font-medium text-zinc-700">{t.provider}</span>
                    <span className="text-zinc-400">·</span>
                    <span className="font-mono text-[11px] text-zinc-700">{t.event}</span>
                    {t.schedule && <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">schedule: {t.schedule}</span>}
                    {t.name && <span className="rounded bg-white border px-1.5 py-0.5 text-[10px] text-zinc-600">{t.name}</span>}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{formatFilter(t.filter as Record<string, unknown> | undefined)}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            Reglas: todos los filtros <b>AND</b>, dentro de un filtro <b>OR</b>, filtro vacío = <b>match todo</b>. Un evento puede matchear varias automations.
          </p>
        </section>

        <section>
          <h4 className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Prompt (body Markdown)</h4>
          <pre className="mt-2 whitespace-pre-wrap rounded-[8px] border border-zinc-200 bg-subsurface p-3 text-[12px] leading-relaxed text-zinc-700">{automation.prompt}</pre>
        </section>

        <section>
          <h4 className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Execution overrides</h4>
          {getExecutionOverrides().length === 0 ? (
            <p className="mt-1 text-[12px] text-zinc-500">Sin overrides — hereda de FactoryRegistry agentDefaults y del agent target.</p>
          ) : (
            <dl className="mt-2 space-y-1">
              {getExecutionOverrides().map((row) => {
                return (
                  <div key={row.label} className="flex gap-2 text-[12px]">
                    <dt className="w-28 shrink-0 text-zinc-500">{row.label}</dt>
                    <dd className="font-mono text-zinc-800">{row.value}</dd>
                  </div>
                );
              })}
            </dl>
          )}
          <p className="mt-1 text-[11px] text-zinc-400">Keys: model/harness (mutuamente excluyentes), runner, environmentId, secrets, mcpServers, workerHost.</p>
        </section>

        <section className="rounded-[8px] border border-zinc-200 bg-white p-3">
          <h4 className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Raw path</h4>
          <p className="mt-1 font-mono text-[11px] text-zinc-600">{automation.rawPath}</p>
        </section>
      </div>
    </div>
  );
}
