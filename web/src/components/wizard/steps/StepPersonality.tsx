import { BackBtn } from "../../atoms/buttons/BackBtn";
import type { FactoryConfig } from "../wizard.types";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export function StepPersonality({
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
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Give your factory some personality</h1>
      <p className="text-sm text-gray-500 mb-7">Create a custom name for your factory as well as an optional avatar.</p>
      <div className="border border-gray-200 rounded-xl p-5 mb-6 space-y-5" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
        {[
          { key: "factoryName" as const, label: "Factory name", placeholder: "E.g. \"Main factory\"", hint: "This is the name that you will see in Warp Factories." },
          { key: "foremanName" as const, label: "Foreman name", placeholder: "E.g. \"main-factory\"", hint: "This is the name you will use to @-mention your factory foreman." },
        ].map(({ key, label, placeholder, hint }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
            <input
              type="text"
              placeholder={placeholder}
              value={config[key]}
              onChange={(e) => onChange({ [key]: e.target.value })}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 transition-[border-color,box-shadow] duration-150"
            />
            <p className="text-xs text-gray-400 mt-1.5">{hint}</p>
          </div>
        ))}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">A short description of what this factory does.</p>
          <textarea
            placeholder="E.g. Owns the checkout service and its bug backlog"
            value={config.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={3}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 resize-none transition-[border-color,box-shadow] duration-150"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Add an avatar <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">We will use this avatar for your factory list in Warp Factories.</p>
          <button type="button" className="w-12 h-12 border border-dashed border-gray-300 rounded-xl flex items-center justify-center text-gray-300 hover:border-gray-400 transition-[border-color,color] duration-150 active:scale-[0.96]">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1.5" y="3.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="6" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M1.5 12.5l4-3 3 3 2.5-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex justify-between">
        <BackBtn onClick={onBack} />
        <button type="button" onClick={onNext} disabled={!config.factoryName.trim()} className={`${BTN_PRIMARY} disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100`}>
          Next
        </button>
      </div>
    </div>
  );
}
