import { useState } from "react";
import { AgentTypeIcon } from "../../atoms/icons/AgentTypeIcon";
import type { Agent } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;
const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 ${BTN_PRESS}`;

export function AgentPickerModal({
  agents,
  selected,
  onClose,
  onDone,
}: {
  agents: readonly Agent[];
  selected: string[];
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const [checked, setChecked] = useState<string[]>(selected);
  const toggle = (id: string) => setChecked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center anim-fade-in" style={{ background: "oklch(0 0 0 / 0.35)" }}>
      <div className="bg-white rounded-2xl w-[420px] p-6 anim-scale-in" style={{ boxShadow: "0 8px 32px oklch(0 0 0 / 0.16), 0 1px 4px oklch(0 0 0 / 0.08)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Select agents</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150 active:scale-[0.9]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="space-y-1 mb-5">
          {agents.map((a) => (
            <button key={a.id} type="button" onClick={() => toggle(a.id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-[background-color] duration-100 text-left active:scale-[0.98]">
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-[background-color,border-color] duration-150 ${checked.includes(a.id) ? "bg-violet-600 border-violet-600" : "border-gray-300"}`}>
                {checked.includes(a.id) && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5 3.5-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
              </div>
              <AgentTypeIcon type={a.type} size="sm" />
              <span className="text-sm text-gray-800">{a.name}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button
            type="button"
            onClick={() => {
              onDone(checked);
              onClose();
            }}
            className={BTN_PRIMARY}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
