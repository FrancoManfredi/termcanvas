import { AgentTypeIcon } from "../../atoms/icons/AgentTypeIcon";
import { Toggle } from "../../atoms/Toggle";
import { BackBtn } from "../../atoms/buttons/BackBtn";
import { AGENTS_SETUP, TYPE_MAP } from "../../../lib/factory/fixtures/figma.fixtures";
import type { FactoryConfig } from "../wizard.types";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export function StepConfigureAgents({
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
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Configure your agents</h1>
      <p className="text-sm text-gray-500 mb-7 leading-relaxed">Determine which agents should be in your factory. Your Foreman requires at least one subagent for the factory to work.</p>
      <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 mb-6" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
        {AGENTS_SETUP.map((a) => (
          <div key={a.id} className="flex items-start gap-3 px-4 py-4">
            <AgentTypeIcon type={TYPE_MAP[a.id] ?? "custom"} size="sm" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">{a.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{a.desc}</p>
            </div>
            {a.required ? (
              <span className="text-xs text-gray-400 mt-1">Required</span>
            ) : (
              <Toggle
                checked={config.agents[a.id as keyof FactoryConfig["agents"]]}
                onChange={() => onChange({ agents: { ...config.agents, [a.id]: !config.agents[a.id as keyof FactoryConfig["agents"]] } as FactoryConfig["agents"] })}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <BackBtn onClick={onBack} />
        <button type="button" onClick={onNext} className={BTN_PRIMARY}>
          Next
        </button>
      </div>
    </div>
  );
}
