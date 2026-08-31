import { useState } from "react";
import { AgentTypeIcon } from "../../atoms/icons/AgentTypeIcon";
import { Toggle } from "../../atoms/Toggle";
import { SliderRow } from "../../atoms/SliderRow";
import { ClassificationModal } from "./ClassificationModal";
import { AgentPickerModal } from "./AgentPickerModal";
import { JUDGE_MODELS } from "../../../lib/factory/fixtures/figma.fixtures";
import type { Agent, Scorer, ScorerClassification } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 ${BTN_PRESS}`;

export function NewScorerForm({
  agents,
  onBack,
  onSave,
}: {
  factoryName: string;
  agents: readonly Agent[];
  onBack: () => void;
  onSave: (s: Scorer) => void;
}) {
  const [scorerName, setScorerName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [judgeInstructions, setJudgeInstructions] = useState("");
  const [judgeModel, setJudgeModel] = useState("kimi k2.7 code");
  const [classifications, setClassifications] = useState<ScorerClassification[]>([]);
  const [passThreshold, setPassThreshold] = useState(1.0);
  const [sampleRate, setSampleRate] = useState(75);
  const [selfImprovement, setSelfImprovement] = useState(false);
  const [showClassModal, setShowClassModal] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);

  const selectedAgents = agents.filter((a) => selectedAgentIds.includes(a.id));
  const canSave = scorerName.trim() && selectedAgentIds.length > 0 && judgeInstructions.trim() && classifications.length > 0;

  return (
    <>
      {showClassModal && <ClassificationModal onClose={() => setShowClassModal(false)} onAdd={(c) => setClassifications((p) => [...p, c])} />}
      {showAgentPicker && <AgentPickerModal agents={agents} selected={selectedAgentIds} onClose={() => setShowAgentPicker(false)} onDone={setSelectedAgentIds} />}

      <div className="flex-1 overflow-y-auto anim-fade-in">
        <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <button type="button" onClick={onBack} className="hover:text-gray-900 hover:bg-gray-100 px-1.5 py-0.5 rounded transition-[color,background-color] duration-150">
              {"←"} Scorers
            </button>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900 font-medium">{scorerName.trim() || "Untitled"}</span>
          </div>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              onSave({ id: Date.now().toString(), name: scorerName.trim(), description, agentIds: selectedAgentIds, judgeInstructions, judgeModel, classifications, passThreshold, sampleRate, selfImprovement });
              onBack();
            }}
            className={`${BTN_SECONDARY} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Save
          </button>
        </div>

        <div className="px-10 py-10 max-w-3xl">
          <input
            value={scorerName}
            onChange={(e) => setScorerName(e.target.value)}
            placeholder="Enter scorer name"
            className="text-[28px] font-semibold outline-none border-none bg-transparent w-full mb-10 placeholder-gray-200"
            style={{ color: scorerName ? "#111827" : undefined }}
          />

          <div className="space-y-10">
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Description</h3>
              <p className="text-xs text-gray-400 mb-3">Summarize what this scorer measures, for anyone browsing your scorers.</p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={"E.g. \"Checks that agent responses stay concise\""}
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder-gray-300 focus:ring-2 focus:ring-violet-500 transition-[border-color,box-shadow] duration-150"
              />
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Agent(s) to evaluate <span className="text-red-400 font-normal">*</span></h3>
              <p className="text-xs text-gray-400 mb-3">Select the agents you would like this scorer to apply to.</p>
              {selectedAgents.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedAgents.map((a) => (
                    <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 rounded-lg text-sm text-gray-700">
                      <AgentTypeIcon type={a.type} size="sm" />
                      <span className="text-xs font-medium">{a.name}</span>
                      <button type="button" onClick={() => setSelectedAgentIds((p) => p.filter((id) => id !== a.id))} className="text-gray-400 hover:text-gray-600 ml-0.5 transition-[color] duration-100 active:scale-[0.9]">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowAgentPicker(true)}
                className={`w-full flex items-center gap-2 border border-dashed border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-[color,border-color] duration-150 ${BTN_PRESS}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add agent
              </button>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Judge instructions <span className="text-red-400 font-normal">*</span></h3>
              <p className="text-xs text-gray-400 mb-3">Give the scorer specific instructions on how it should evaluate the agents.</p>
              <textarea
                value={judgeInstructions}
                onChange={(e) => setJudgeInstructions(e.target.value)}
                placeholder={"E.g. \"You should look specifically for how many tests are being created for new functions\""}
                rows={5}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder-gray-300 focus:ring-2 focus:ring-violet-500 transition-[border-color,box-shadow] duration-150"
              />
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Judge model <span className="text-red-400 font-normal">*</span></h3>
              <p className="text-xs text-gray-400 mb-3">The model this scorer's judge runs on.</p>
              <div className="relative">
                <select
                  value={judgeModel}
                  onChange={(e) => setJudgeModel(e.target.value)}
                  className="w-full appearance-none px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white cursor-pointer transition-[border-color] duration-150"
                >
                  {JUDGE_MODELS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Classifications <span className="text-red-400 font-normal">*</span></h3>
              <p className="text-xs text-gray-400 mb-3">Define specific criteria that should result in the agent receiving either a passing or failing score.</p>
              {classifications.length > 0 && (
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 mb-2" style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.04)" }}>
                  {classifications.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3 group">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${c.outcome === "pass" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>{c.outcome}</span>
                      <span className="text-sm text-gray-800 flex-1 font-medium">{c.name}</span>
                      {c.description && <span className="text-xs text-gray-400 truncate max-w-40">{c.description}</span>}
                      <button type="button" onClick={() => setClassifications((p) => p.filter((x) => x.id !== c.id))} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-[opacity,color] duration-150 active:scale-[0.9]">
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowClassModal(true)}
                className={`w-full flex items-center gap-2 border border-dashed border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-[color,border-color] duration-150 ${BTN_PRESS}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add classification
              </button>
            </section>

            <SliderRow label="Pass threshold" required subtitle="Set a score threshold for what counts as a pass (0 to 1)." value={passThreshold} min={0} max={1} step={0.01} onChange={setPassThreshold} />
            <SliderRow label="Sample rate" required subtitle="Select how frequently this scorer should run across all runs involving the selected agents." value={sampleRate} min={0} max={100} step={1} suffix="%" onChange={setSampleRate} />

            <section>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-0.5">Self-improvement <span className="text-red-400 font-normal">*</span></h3>
                  <p className="text-xs text-gray-400 leading-relaxed">When turned on, Self-improvement will analyze failing runs in order to suggest improvements to your factory.</p>
                </div>
                <Toggle checked={selfImprovement} onChange={() => setSelfImprovement((p) => !p)} />
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
