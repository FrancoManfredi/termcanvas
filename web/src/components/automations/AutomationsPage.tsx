
import { useMemo, useState } from "react";
import { useFactoryBundle } from "../../lib/factory/hooks/useFactoryBundle";
import { AutomationParser } from "../../lib/factory/parsers/automation.parser";
import { findMatchingAutomations } from "../../lib/factory/domain/automation.engine";
import type { AutomationDefinition } from "../../lib/factory/domain/types";
import type { MockEvent } from "../../lib/factory/domain/automation.engine";
import { AutomationCard } from "./AutomationCard";
import { AutomationDetail } from "./AutomationDetail";

const EXTRA_SAMPLES: { raw: string; file: string }[] = [
  {
    raw: `---
enabled: true
agent: reviewer
triggers:
  - provider: github
    event: pull_request_opened
    filter:
      repos: ["acme/api-service"]
      base_branches: ["main"]
      labels:
        not_in: ["wip"]
---

Review PR against main without wip. Enforce tests and conventions.`,
    file: "automations/code-review-only/automation.md",
  },
  {
    raw: `---
enabled: true
agent: foreman
triggers:
  - provider: schedule
    event: cron_fired
    schedule: "@daily"
---

Run daily triage. Las automations schedule usan cron UTC (5 campos o @daily/@hourly).`,
    file: "automations/daily-cron/automation.md",
  },
  {
    raw: `---
enabled: true
agent: foreman
triggers:
  - provider: slack
    event: app_mention
    filter:
      repos: ["acme/payments-service"]
---

Slack app_mention en canal. Requiere Slack integration conectada.`,
    file: "automations/slack-mention/automation.md",
  },
  {
    raw: `---
enabled: false
agent: foreman
triggers:
  - provider: github
    event: issue_created
    filter:
      repos: ["acme/payments-service"]
---

Disabled example: nunca matchea aunque el evento coincida.`,
    file: "automations/disabled-example/automation.md",
  },
  {
    raw: `---
enabled: true
agent: foreman
triggers:
  - provider: github
    event: issue_labeled
    filter:
      labels:
        in: ["factory-ready", "urgent"]
        not_in: ["wontfix"]
      repos: ["acme/payments-service"]
---

Ejemplo in/not_in combinado.`,
    file: "automations/combined-labeled/automation.md",
  },
  {
    raw: `---
enabled: true
agent: foreman
triggers:
  - provider: linear
    event: issue_created
    filter:
      labels: ["factory-ready"]
---

Linear issue_created. Filtros por team/label/project/state según §6.`,
    file: "automations/linear-ready/automation.md",
  },
];

function buildDemoAutomations(base: AutomationDefinition[]): AutomationDefinition[] {
  const parser = new AutomationParser();
  const extras: AutomationDefinition[] = [];
  for (const s of EXTRA_SAMPLES) {
    const res = parser.parseAutomationMd(s.raw, s.file);
    if (res.ok && res.value) {
      extras.push(res.value);
    } else {
    }
  }
  const all = [...base, ...extras];
  return all;
}

export function AutomationsPage() {
  const bundle = useFactoryBundle();
  const [selected, setSelected] = useState<string | null>(null);
  const [provider, setProvider] = useState("github");
  const [event, setEvent] = useState("issue_labeled");
  const [repos, setRepos] = useState("acme/payments-service");
  const [labels, setLabels] = useState("factory-ready");
  const [branches, setBranches] = useState("");
  const [baseBranches, setBaseBranches] = useState("");
  const [schedule, setSchedule] = useState("");

  const automations = useMemo(() => {
    if (!bundle.ok) {
      return [] as AutomationDefinition[];
    }
    const base = bundle.value!.automations;
    return buildDemoAutomations(base);
  }, [bundle]);

  const mockEvent: MockEvent = useMemo(() => {
    const ev: MockEvent = { provider, event };
    if (repos.trim()) {
      ev.repos = repos.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (labels.trim()) {
      ev.labels = labels.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (branches.trim()) {
      ev.branches = branches.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (baseBranches.trim()) {
      ev.base_branches = baseBranches.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (schedule.trim()) {
      ev.schedule = schedule.trim();
    }
    return ev;
  }, [provider, event, repos, labels, branches, baseBranches, schedule]);

  const matched = useMemo(() => {
    const m = findMatchingAutomations(automations, mockEvent);
    return m;
  }, [automations, mockEvent]);

  const matchedNames = useMemo(() => {
    const set = new Set(matched.map((a) => a.name));
    return set;
  }, [matched]);

  const selectedAutomation = useMemo(() => {
    if (!selected) return automations[0] ?? null;
    const found = automations.find((a) => a.name === selected) ?? automations[0] ?? null;
    return found;
  }, [selected, automations]);

  function handleSelect(name: string) {
    setSelected(name);
  }
  function handleProviderChange(v: string) {
    setProvider(v);
  }
  function handleEventChange(v: string) {
    setEvent(v);
  }
  function handlePresetFactoryReady() {
    setProvider("github");
    setEvent("issue_labeled");
    setRepos("acme/payments-service");
    setLabels("factory-ready");
    setBranches("");
    setBaseBranches("");
    setSchedule("");
  }
  function handlePresetWip() {
    setProvider("github");
    setEvent("pull_request_opened");
    setRepos("acme/api-service");
    setLabels("wip");
    setBranches("");
    setBaseBranches("main");
    setSchedule("");
  }
  function handlePresetSchedule() {
    setProvider("schedule");
    setEvent("cron_fired");
    setRepos("");
    setLabels("");
    setBranches("");
    setBaseBranches("");
    setSchedule("@daily");
  }

  if (!bundle.ok) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-red-600">Error cargando factory: {bundle.issues.map((i) => i.message).join("; ")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
      <div className="flex h-[44px] shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Automations</span>
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">{automations.length}</span>
        </div>
        <span className="text-[11px] text-zinc-500">Factory as Code · automations/*/automation.md</span>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-zinc-200 bg-[#f8f8f8]">
          <div className="bg-white border-b border-zinc-200 p-3">
            <h3 className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Simulador / Preview de filtro (v1 estático)</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              Sin provider real (WarpFactories.md §17). Ingresá un evento mock y ve qué automations matchean. Reglas: todos los filtros <b>AND</b>, dentro de un filtro <b>OR</b>, filtro vacío = match todo, un evento puede matchear varias.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-zinc-600">
                provider
                <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-white px-2 py-1.5 text-xs">
                  <option value="github">github</option>
                  <option value="gitlab">gitlab</option>
                  <option value="slack">slack</option>
                  <option value="linear">linear</option>
                  <option value="jira">jira</option>
                  <option value="schedule">schedule</option>
                  <option value="factory">factory</option>
                </select>
              </label>
              <label className="text-[11px] text-zinc-600">
                event
                <input value={event} onChange={(e) => handleEventChange(e.target.value)} placeholder="issue_labeled" className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-white px-2 py-1.5 text-xs" />
              </label>
              <label className="text-[11px] text-zinc-600">
                repos (coma)
                <input value={repos} onChange={(e) => setRepos(e.target.value)} placeholder="acme/payments-service" className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-white px-2 py-1.5 text-xs" />
              </label>
              <label className="text-[11px] text-zinc-600">
                labels (coma)
                <input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="factory-ready" className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-white px-2 py-1.5 text-xs" />
              </label>
              <label className="text-[11px] text-zinc-600">
                branches
                <input value={branches} onChange={(e) => setBranches(e.target.value)} placeholder="main" className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-white px-2 py-1.5 text-xs" />
              </label>
              <label className="text-[11px] text-zinc-600">
                base_branches
                <input value={baseBranches} onChange={(e) => setBaseBranches(e.target.value)} placeholder="main" className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-white px-2 py-1.5 text-xs" />
              </label>
            </div>
            <label className="mt-2 block text-[11px] text-zinc-600">
              schedule (para cron_fired)
              <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="@daily" className="mt-1 w-full rounded-[8px] border border-zinc-200 bg-white px-2 py-1.5 text-xs" />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button onClick={handlePresetFactoryReady} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50">preset: issue_labeled factory-ready</button>
              <button onClick={handlePresetWip} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50">preset: PR wip → no match</button>
              <button onClick={handlePresetSchedule} className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50">preset: schedule @daily</button>
            </div>
            <div className="mt-3 rounded-[8px] border border-zinc-200 bg-zinc-50 p-2">
              <p className="text-[11px] font-medium text-zinc-700">Evento mock</p>
              <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-600">{JSON.stringify(mockEvent, null, 2)}</pre>
              <p className="mt-2 text-[11px] text-zinc-600">
                Matched: <span className="font-medium text-emerald-700">{matched.length}</span> / {automations.length} ·{" "}
                <span className="font-mono text-[11px]">{matched.map((m) => m.name).join(", ") || "—"}</span>
              </p>
            </div>
          </div>

          <div className="p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">Automations ({automations.length})</h4>
              <span className="text-[11px] text-zinc-400">GitHub-backed · solo lectura</span>
            </div>
            <div className="mt-2 space-y-2">
              {automations.map((a) => {
                return (
                  <AutomationCard
                    key={a.name}
                    automation={a}
                    isSelected={selectedAutomation?.name === a.name}
                    isMatched={matchedNames.has(a.name)}
                    onSelect={handleSelect}
                  />
                );
              })}
            </div>
            <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] font-medium text-amber-800">Filtros por provider (WarpFactories.md §6)</p>
              <ul className="mt-1 list-disc pl-4 text-[11px] leading-relaxed text-amber-800/80">
                <li>GitHub: repos, branches, base_branches, labels, paths, authors, assignees...</li>
                <li>Slack: conversations, authors, keywords, emoji</li>
                <li>Linear: teams, labels, project, state, assignee</li>
                <li>Jira: projects, assignment keywords</li>
                <li>schedule: cron UTC (5 campos o @daily/@hourly)</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="hidden w-[420px] shrink-0 bg-white lg:flex">
          <AutomationDetail automation={selectedAutomation} />
        </div>
      </div>

      {selectedAutomation && (
        <div className="fixed inset-0 z-10 flex flex-col bg-white lg:hidden">
          <div className="flex justify-end border-b border-zinc-200 p-2">
            <button onClick={() => setSelected(null)} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs">Cerrar</button>
          </div>
          <AutomationDetail automation={selectedAutomation} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
