import { DotMenu } from "../../atoms/icons/DotMenu";
import type { Automation } from "../../../lib/factory/fixtures/figma.fixtures";

export function AutomationsList({
  factoryName,
  automations,
  onNew,
}: {
  factoryName: string;
  automations: readonly Automation[];
  onNew: () => void;
}) {
  const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
  const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-gray-700 font-medium">{factoryName}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">Automations</span>
        </div>
        <button type="button" onClick={onNew} className={BTN_PRIMARY}>New</button>
      </div>

      <div className="px-8 py-4">
        <div className="grid grid-cols-[180px_1fr_180px_120px] gap-4 px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
          <span>Automation</span>
          <span>Trigger</span>
          <span>Agent</span>
          <span>Created</span>
        </div>
        {automations.map((auto, i) => (
          <div
            key={auto.id}
            className={`grid grid-cols-[180px_1fr_180px_120px] gap-4 px-4 py-4 items-start border-b border-gray-50 hover:bg-gray-50 group transition-[background-color] duration-100 rounded-lg anim-fade-in-up ${i === 0 ? "delay-0" : "delay-60"}`}
          >
            <span className="text-sm font-medium text-gray-800 break-words">{auto.name}</span>
            <span className="text-sm text-gray-500">{auto.triggers}</span>
            <span className="text-sm text-gray-700">{factoryName} {auto.agent}</span>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400 tabular-nums">{auto.created}</span>
              <DotMenu />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
