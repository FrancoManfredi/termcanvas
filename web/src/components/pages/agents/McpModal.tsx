import { useState } from "react";

export function McpModal({ onClose }: { onClose: () => void }) {
  const [jsonConfig, setJsonConfig] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center anim-fade-in" style={{ background: "oklch(0 0 0 / 0.35)" }}>
      <div
        className="bg-white rounded-2xl w-[780px] max-h-[560px] flex overflow-hidden anim-scale-in"
        style={{ boxShadow: "0 8px 32px oklch(0 0 0 / 0.16), 0 1px 4px oklch(0 0 0 / 0.08), inset 0 0 0 1px oklch(0 0 0 / 0.06)" }}
      >
        <div className="w-[280px] flex-shrink-0 border-r border-gray-100 flex flex-col">
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50/60 focus-within:border-gray-300 transition-[border-color] duration-150">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-gray-400">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input autoFocus placeholder="Search apps and MCP servers" className="flex-1 text-sm outline-none placeholder-gray-400 bg-transparent" />
            </div>
          </div>
          <div className="px-3 py-2">
            <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-[background-color] duration-150">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Custom MCP
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-4 text-center">
            <p className="text-sm text-gray-400">No connected MCP servers are available to add.</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col p-5">
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Add custom MCP</h2>
            <div className="flex items-center gap-2">
              <button type="button" className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-[background-color] duration-150">Add</button>
              <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150 active:scale-[0.96]">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            Add one or more MCP configs as JSON, keyed by MCP name. Use <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{"{{secret_name}}"}</code> to reference a managed secret.
          </p>
          <p className="text-xs font-semibold text-gray-600 mb-2">Configuration</p>
          <div className="flex-1 flex border border-gray-200 rounded-xl overflow-hidden bg-gray-50/50" style={{ outline: "1px solid oklch(0 0 0 / 0.04)", outlineOffset: "-1px" }}>
            <div className="w-8 pt-3 flex flex-col items-center text-xs text-gray-300 font-mono select-none">
              <span>1</span>
            </div>
            <textarea
              value={jsonConfig}
              onChange={(e) => setJsonConfig(e.target.value)}
              className="flex-1 pt-3 pr-3 pb-3 text-sm font-mono bg-transparent outline-none resize-none text-gray-800"
              placeholder={'{\n  "my-mcp": {\n    "command": "npx",\n    "args": ["-y", "my-mcp-server"]\n  }\n}'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
