import { useState } from "react";
import { AgentTypeIcon } from "../../atoms/icons/AgentTypeIcon";
import { TriggerDropdown } from "./TriggerDropdown";
import type { Agent, Automation, TriggerConfig } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]`;

export function NewAutomationForm({
  factoryName,
  agents,
  onBack,
  onSave,
}: {
  factoryName: string;
  agents: readonly Agent[];
  onBack: () => void;
  onSave: (a: Automation) => void;
}) {
  const [trigger, setTrigger] = useState<TriggerConfig>(null);
  const [showTriggerPicker, setShowTriggerPicker] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(agents.find((a) => a.type === "foreman")?.id ?? agents[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [triggerDay, setTriggerDay] = useState("Monday");
  const [triggerTime, setTriggerTime] = useState("09:00 AM");
  const [triggerFreq, setTriggerFreq] = useState<"weekly" | "hourly" | "daily" | "custom">("weekly");

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const TIMES = ["06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "12:00 PM", "02:00 PM", "04:00 PM", "06:00 PM"];

  return (
    <div className="flex-1 overflow-y-auto anim-fade-in">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <button type="button" onClick={onBack} className="hover:text-gray-900 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-[color,background-color] duration-150">
            {"←"} Automations
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">New automation</span>
        </div>
        <button
          type="button"
          onClick={() => {
            onSave({ id: Date.now().toString(), name: `automation-${Date.now()}`, triggers: trigger ? `Scheduled: ${triggerFreq}` : "None", agent: agents.find((a) => a.id === selectedAgent)?.name ?? "", created: "Just now" });
            onBack();
          }}
          className={BTN_SECONDARY}
        >
          Save
        </button>
      </div>

      <div className="px-10 py-8 max-w-3xl">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">New automation</h1>
        <div className="flex gap-0 border-b border-gray-200 mb-8">
          <button type="button" className="px-4 py-2.5 text-sm font-medium border-b-2 border-gray-900 text-gray-900 -mb-px hover:bg-gray-50 rounded-t transition-[background-color] duration-100">Settings</button>
          <button type="button" className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-400 -mb-px hover:text-gray-600 hover:bg-gray-50 rounded-t transition-[color,background-color] duration-150">Runs</button>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Triggers</label>
          <div className="border border-gray-200 rounded-xl overflow-visible" style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.05)" }}>
            {trigger && (
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 text-sm text-gray-700">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-gray-400 flex-shrink-0">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 4.5V7l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <div className="relative">
                  <select value={triggerFreq} onChange={(e) => setTriggerFreq(e.target.value as typeof triggerFreq)} className="appearance-none pr-5 text-sm text-gray-800 bg-transparent outline-none cursor-pointer font-semibold">
                    {["hourly", "daily", "weekly", "custom"].map((f) => (
                      <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                    ))}
                  </select>
                  <svg className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </div>
                {triggerFreq === "weekly" && (
                  <>
                    <span className="text-gray-400">on</span>
                    <div className="relative">
                      <select value={triggerDay} onChange={(e) => setTriggerDay(e.target.value)} className="appearance-none pr-5 text-sm text-gray-800 bg-transparent outline-none cursor-pointer font-semibold">
                        {DAYS.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                      <svg className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    </div>
                  </>
                )}
                <span className="text-gray-400">at</span>
                <div className="relative">
                  <select value={triggerTime} onChange={(e) => setTriggerTime(e.target.value)} className="appearance-none pr-5 text-sm text-gray-800 bg-transparent outline-none cursor-pointer font-semibold">
                    {TIMES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <svg className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </div>
                <span className="text-gray-400 text-xs">EDT</span>
                <span className="text-xs text-gray-400 ml-1">Next run {triggerDay} at {triggerTime} EDT</span>
                <button type="button" onClick={() => setTrigger(null)} className="ml-auto text-gray-400 hover:text-gray-600 transition-[color] duration-100 active:scale-[0.9]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTriggerPicker(!showTriggerPicker)}
                className={`w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-b-xl transition-[background-color,color] duration-100 ${!trigger ? "rounded-t-xl" : ""}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add trigger
              </button>
              {showTriggerPicker && (
                <div className="absolute left-0 top-full z-50 mt-1">
                  <TriggerDropdown
                    onSelect={(t) => {
                      setTrigger(t);
                      if (t) setTriggerFreq(t.frequency as typeof triggerFreq);
                      setShowTriggerPicker(false);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Agents</label>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <AgentTypeIcon type={agents.find((a) => a.id === selectedAgent)?.type ?? "foreman"} size="sm" />
            </div>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full appearance-none pl-12 pr-8 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white cursor-pointer transition-[border-color] duration-150"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{factoryName} {a.name.charAt(0).toUpperCase() + a.name.slice(1)} Agent</option>
              ))}
            </select>
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">Agent prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Add a prompt for the agent(s)."
            rows={10}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder-gray-300 focus:ring-2 focus:ring-violet-500 transition-[border-color,box-shadow] duration-150"
          />
        </div>
      </div>
    </div>
  );
}
