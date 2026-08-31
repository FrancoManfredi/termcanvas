import { LinearIcon } from "../../atoms/icons/LinearIcon";
import { JiraIcon } from "../../atoms/icons/JiraIcon";
import { BackBtn } from "../../atoms/buttons/BackBtn";
import type { FactoryConfig } from "../wizard.types";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export function StepTrackers({
  config,
  onChange,
  onNext,
  onBack,
}: {
  config: FactoryConfig;
  onChange: (patch: Partial<FactoryConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="anim-fade-in-up">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Connect your issue trackers</h1>
      <p className="text-sm text-gray-500 mb-7">Give your factory access to your issue trackers.</p>
      <div className="space-y-3 mb-6">
        {[
          { id: "linear" as const, name: "Linear", desc: "Connect Linear to bring issues into your factory.", icon: <LinearIcon size={28} /> },
          { id: "jira" as const, name: "Jira", desc: "Connect Jira to bring issues into your factory.", icon: <JiraIcon size={28} /> },
        ].map((t) => (
          <div key={t.id} className="flex items-center gap-4 border border-gray-200 rounded-xl px-4 py-4" style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.05)" }}>
            <div className="w-10 h-10 flex items-center justify-center">{t.icon}</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{t.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t.desc}</p>
            </div>
            <button
              type="button"
              onClick={() => onChange({ trackers: { ...config.trackers, [t.id]: !config.trackers[t.id] } })}
              className={`px-4 py-1.5 text-sm rounded-lg border font-medium transition-[background-color,border-color,color] duration-150 active:scale-[0.96] ${config.trackers[t.id] ? "bg-violet-600 border-violet-600 text-white hover:bg-violet-700" : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"}`}
            >
              {config.trackers[t.id] ? "Connected" : "Connect"}
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <BackBtn onClick={onBack} />
        <button type="button" onClick={onNext} className={BTN_PRIMARY}>
          Finish
        </button>
      </div>
    </div>
  );
}
