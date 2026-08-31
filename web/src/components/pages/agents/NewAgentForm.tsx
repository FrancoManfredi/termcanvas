import { useState } from "react";
import { AgentTypeIcon } from "../../atoms/icons/AgentTypeIcon";
import { McpModal } from "./McpModal";
import type { Agent } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]`;
const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";

export function NewAgentForm({ onBack, onSave }: { onBack: () => void; onSave: (a: Agent) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [harness, setHarness] = useState("Warp");
  const [model, setModel] = useState("auto (genius)");
  const [runner, setRunner] = useState("default");
  const [prompt, setPrompt] = useState("");
  const [showMcp, setShowMcp] = useState(false);

  return (
    <>
      {showMcp && <McpModal onClose={() => setShowMcp(false)} />}
      <div className="flex-1 overflow-y-auto anim-fade-in">
        <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <button type="button" onClick={onBack} className="hover:text-gray-900 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-[color,background-color] duration-150">
              {"←"} Agents
            </button>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900 font-medium">New Agent</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (name.trim()) onSave({ id: name.toLowerCase().replace(/\s+/g, "-"), name: name.trim(), description, type: "custom", mcps: [], secrets: [], harness, model, runner, host: "Warp hosted", prompt });
            }}
            disabled={!name.trim()}
            className={`${BTN_SECONDARY} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Save
          </button>
        </div>
        <div className="px-8 py-8 max-w-3xl">
          <AgentTypeIcon type="custom" size="lg" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter Agent Name"
            className="text-2xl font-semibold outline-none border-none bg-transparent mt-4 mb-6 w-full placeholder-gray-200 transition-[color] duration-150"
            style={{ color: name ? "#111827" : undefined }}
          />
          <div className="flex gap-0 border-b border-gray-200 mb-8">
            <button type="button" className="px-4 py-2.5 text-sm font-medium border-b-2 border-gray-900 text-gray-900 -mb-px hover:bg-gray-50 rounded-t transition-[background-color] duration-100">Settings</button>
            <button type="button" className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-400 -mb-px transition-[color,background-color] duration-150 hover:text-gray-600 hover:bg-gray-50 rounded-t">Automations</button>
          </div>
          <div className="space-y-10">
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Description</h2>
              <p className="text-sm text-gray-400 mb-3">Summarize what this agent is responsible for.</p>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this agent does"
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 transition-[border-color,box-shadow] duration-150"
              />
            </section>
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Agent resources</h2>
              <p className="text-sm text-gray-400 mb-5">Attach any relevant skills or app connections.</p>
              <div className="space-y-4">
                <div className="flex items-center">
                  <span className="text-sm text-gray-400 w-20 flex-shrink-0">MCPs</span>
                  <button type="button" onClick={() => setShowMcp(true)} className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 ${BTN_PRESS}`}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Add MCP
                  </button>
                </div>
                <div className="flex items-center">
                  <span className="text-sm text-gray-400 w-20 flex-shrink-0">Secrets</span>
                  <button type="button" className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 ${BTN_PRESS}`}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Add secret
                  </button>
                </div>
                {[
                  { label: "Harness", value: harness, opts: ["Warp", "OpenCode"], set: setHarness },
                  { label: "Model", value: model, opts: ["auto (genius)", "claude-sonnet-5", "claude-opus-5", "grok 4.5 (high)", "gpt-5"], set: setModel },
                  { label: "Runner", value: runner, opts: ["default", "linux-build", "macos-runner"], set: setRunner },
                ].map(({ label, value, opts, set }) => (
                  <div key={label} className="flex items-center">
                    <span className="text-sm text-gray-400 w-20 flex-shrink-0">{label}</span>
                    <div className="relative w-72">
                      <select
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white cursor-pointer transition-[border-color] duration-150"
                      >
                        {opts.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>
                ))}
                <div className="flex items-center">
                  <span className="text-sm text-gray-400 w-20 flex-shrink-0">Host</span>
                  <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 w-72 bg-gray-50/60">Warp hosted</div>
                </div>
              </div>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Agent prompt</h2>
              <p className="text-sm text-gray-400 mb-4">This is the base prompt the agent will use.</p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Write the agent's base prompt here..."
                rows={8}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder-gray-300 focus:ring-2 focus:ring-violet-500 transition-[border-color,box-shadow] duration-150"
              />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
