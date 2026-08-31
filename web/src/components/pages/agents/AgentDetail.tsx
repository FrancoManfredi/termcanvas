import { useState } from "react";
import { GithubIcon } from "../../atoms/icons/GithubIcon";
import { AgentTypeIcon } from "../../atoms/icons/AgentTypeIcon";
import type { Agent } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]`;

export function AgentDetail({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const [tab, setTab] = useState<"settings" | "automations">("settings");
  return (
    <div className="flex-1 overflow-y-auto anim-fade-in">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <button type="button" onClick={onBack} className="hover:text-gray-900 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-[color,background-color] duration-150">
            {"←"} Agents
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">{agent.name}</span>
        </div>
        <button type="button" className={BTN_SECONDARY}>Save</button>
      </div>
      <div className="px-8 py-8 max-w-3xl">
        <div className="flex items-center gap-4 border border-gray-200 rounded-xl px-5 py-4 mb-8" style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)" }}>
          <GithubIcon size={18} className="text-gray-700" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">Managed in GitHub</p>
            <p className="text-xs text-gray-500 mt-0.5">Configuration is read-only here. Make changes in <span className="font-medium">acme-corp/factory-dev</span> at main:v1.</p>
          </div>
          <button type="button" className={`flex items-center gap-1.5 whitespace-nowrap ${BTN_SECONDARY}`}>
            Open in GitHub
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 9L9 2M6 2h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <AgentTypeIcon type={agent.type} size="lg" />
        <h1 className="text-2xl font-semibold text-gray-900 mt-4 mb-6">{agent.name}</h1>
        <div className="flex gap-0 border-b border-gray-200 mb-8">
          {(["settings", "automations"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px rounded-t transition-[color,border-color,background-color] duration-150 ${tab === t ? "border-gray-900 text-gray-900 hover:bg-gray-50" : "border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "settings" && (
          <div className="space-y-10 anim-fade-in">
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Description</h2>
              <p className="text-sm text-gray-400 mb-3">Summarize what this agent is responsible for.</p>
              <p className="text-sm text-gray-800">{agent.description}</p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Agent resources</h2>
              <p className="text-sm text-gray-400 mb-5">Resources attached to this {agent.name} agent.</p>
              <div className="space-y-4">
                <div className="flex items-start gap-8">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0 pt-0.5">MCPs</span>
                  <div className="flex flex-wrap gap-2">
                    {agent.mcps.length === 0 ? (
                      <span className="text-sm text-gray-400">—</span>
                    ) : (
                      agent.mcps.map((mcp) => (
                        <span key={mcp.name} className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-full text-xs font-medium text-gray-700">
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: mcp.color }}>
                            {mcp.name[0].toUpperCase()}
                          </span>
                          {mcp.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-8">
                  <span className="text-sm text-gray-400 w-16 flex-shrink-0 pt-0.5">Secrets</span>
                  <div className="flex flex-wrap gap-3">
                    {agent.secrets.length === 0 ? (
                      <span className="text-sm text-gray-400">—</span>
                    ) : (
                      agent.secrets.map((s) => (
                        <span key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <circle cx="6" cy="4.5" r="2.5" stroke="#9ca3af" strokeWidth="1.1" />
                            <path d="M4 7l-1 4h6l-1-4" stroke="#9ca3af" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {s}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                {[
                  { label: "Harness", value: agent.harness },
                  { label: "Model", value: agent.model },
                  { label: "Runner", value: agent.runner },
                  { label: "Host", value: agent.host },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-8">
                    <span className="text-sm text-gray-400 w-16 flex-shrink-0">{label}</span>
                    <span className="text-sm font-medium text-gray-900">{value}</span>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Agent prompt</h2>
              <p className="text-sm text-gray-400 mb-4">This is the base prompt the agent will use.</p>
              <div
                className="border border-gray-200 rounded-xl p-5 bg-gray-50/60 font-mono text-xs text-gray-700 whitespace-pre-wrap leading-relaxed"
                style={{ outline: "1px solid oklch(0 0 0 / 0.04)", outlineOffset: "-1px" }}
              >
                {agent.prompt}
              </div>
            </section>
          </div>
        )}
        {tab === "automations" && (
          <div className="flex flex-col items-center justify-center py-16 text-center anim-fade-in">
            <p className="text-sm text-gray-400">No automations configured for this agent.</p>
          </div>
        )}
      </div>
    </div>
  );
}
