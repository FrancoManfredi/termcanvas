import { AgentTypeIcon } from "../../atoms/icons/AgentTypeIcon";
import { DotMenu } from "../../atoms/icons/DotMenu";
import type { Agent } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export function AgentList({
  factoryName,
  agents,
  onSelect,
  onNew,
}: {
  factoryName: string;
  agents: readonly Agent[];
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const foreman = agents.find((a) => a.type === "foreman");
  const subAgents = agents.filter((a) => a.type !== "foreman");
  const staggerDelays = ["delay-0", "delay-60", "delay-120", "delay-180", "delay-240"];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-gray-700 font-medium truncate max-w-32">{factoryName}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">Agents</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-[background-color,color] duration-150" aria-label="Search">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={onNew} className={BTN_PRIMARY}>
            New
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="inline ml-1">
              <path d="M2.5 4l3.5 4 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-2">
        {foreman && (
          <button
            type="button"
            onClick={() => onSelect(foreman.id)}
            className="w-full flex items-center gap-4 px-5 py-4 border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer group anim-fade-in-up delay-0 transition-[background-color,border-color] duration-150 active:scale-[0.98] text-left"
            style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.05)" }}
          >
            <AgentTypeIcon type="foreman" size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{foreman.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{foreman.description}</p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-[opacity] duration-150">
              {foreman.mcps.slice(0, 3).map((mcp) => (
                <span key={mcp.name} title={mcp.name} className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: mcp.color }}>
                  {mcp.name[0].toUpperCase()}
                </span>
              ))}
              {foreman.mcps.length > 3 && <span className="text-xs text-gray-400 font-medium">+{foreman.mcps.length - 3}</span>}
            </div>
            <DotMenu />
          </button>
        )}

        {subAgents.map((agent, i) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelect(agent.id)}
            className={`w-full flex items-center gap-4 px-5 py-4 border border-gray-100 rounded-xl hover:bg-gray-50 hover:border-gray-200 cursor-pointer group anim-fade-in-up ${staggerDelays[Math.min(i + 1, 4)]} transition-[background-color,border-color] duration-150 active:scale-[0.98] text-left`}
          >
            <AgentTypeIcon type={agent.type} size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{agent.name}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{agent.description}</p>
            </div>
            <DotMenu />
          </button>
        ))}

        <button
          type="button"
          onClick={onNew}
          className={`w-full flex items-center justify-center gap-2 py-4 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-[color,background-color] duration-150 ${BTN_PRESS}`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          New agent
        </button>
      </div>
    </div>
  );
}
