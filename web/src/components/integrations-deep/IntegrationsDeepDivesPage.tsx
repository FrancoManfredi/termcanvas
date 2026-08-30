// SRP: container with tabs for the 4 deep dives — OCP via registry, no switch edits for new provider beyond adding entry
// DIP: imports pure pages, no store

import { useState } from "react";
import { GitLabPage } from "./GitLabPage";
import { SlackPage } from "./SlackPage";
import { LinearPage } from "./LinearPage";
import { JiraPage } from "./JiraPage";
import type { DeepDiveProvider } from "../../lib/factory/domain/integrations.deep";

const TABS: { id: DeepDiveProvider; label: string; short: string }[] = [
  { id: "gitlab", label: "GitLab", short: "GitLab.com only · Premium/Ultimate" },
  { id: "slack", label: "Slack", short: "Add to Slack · 👀 · Home tab" },
  { id: "linear", label: "Linear", short: "OAuth · agent_session_created" },
  { id: "jira", label: "Jira", short: "Cloud + Rovo · case-insensitive" },
];

export function IntegrationsDeepDivesPage({ initialTab = "gitlab" as DeepDiveProvider }: { initialTab?: DeepDiveProvider }) {
  const [active, setActive] = useState<DeepDiveProvider>(initialTab);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f8f8f8]">
      <div className="flex h-[44px] shrink-0 items-center border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium text-zinc-900">wilson</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-zinc-900">Integrations</span>
          <span className="text-zinc-400">›</span>
          <span className="font-medium text-violet-700">Deep dives</span>
          <span className="ml-2 hidden text-[11px] text-zinc-400 sm:inline">E10 US-081→085 · E08 US-067→072 · E11 US-086→091 · WarpFactories.md §9</span>
        </div>
        <span className="ml-auto hidden text-[11px] text-zinc-500 sm:inline">Estático con nombres exactos del doc</span>
      </div>

      <div className="border-b border-zinc-200 bg-white px-4">
        <div className="mx-auto flex max-w-[1080px] gap-1 overflow-x-auto py-2">
          {TABS.map((t) => {
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "shrink-0 rounded-[10px] px-3 py-2 text-left transition-[background-color,color,box-shadow,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.98]",
                  isActive
                    ? "bg-zinc-900 text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                    : "bg-zinc-50 text-zinc-600 hover:bg-zinc-900/[0.06] hover:text-zinc-900",
                ].join(" ")}
              >
                <div className="text-[13px] font-[600] leading-none">{t.label}</div>
                <div className={["text-[11px] leading-none", isActive ? "text-white/70" : "text-zinc-400"].join(" ")}>{t.short}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[1080px]">
          {active === "gitlab" && <GitLabPage />}
          {active === "slack" && <SlackPage />}
          {active === "linear" && <LinearPage />}
          {active === "jira" && <JiraPage />}
        </div>
      </div>
    </div>
  );
}
