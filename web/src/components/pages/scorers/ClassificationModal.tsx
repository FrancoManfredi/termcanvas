import { useState } from "react";
import type { ScorerClassification } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;
const BTN_SECONDARY = `px-4 py-1.5 border border-gray-200 text-gray-500 text-sm rounded-md hover:border-gray-300 hover:bg-gray-50 ${BTN_PRESS}`;

export function ClassificationModal({ onClose, onAdd }: { onClose: () => void; onAdd: (c: ScorerClassification) => void }) {
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState<"pass" | "fail">("pass");
  const [description, setDescription] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center anim-fade-in" style={{ background: "oklch(0 0 0 / 0.35)" }}>
      <div className="bg-white rounded-2xl w-[480px] p-6 anim-scale-in" style={{ boxShadow: "0 8px 32px oklch(0 0 0 / 0.16), 0 1px 4px oklch(0 0 0 / 0.08)" }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Add classification</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150 active:scale-[0.9]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Name <span className="text-red-400 font-normal">*</span></label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={"E.g. \"Concise\""}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 transition-[border-color,box-shadow] duration-150"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Outcome</label>
            <div className="flex gap-2">
              {(["pass", "fail"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcome(o)}
                  className={`flex-1 py-2.5 text-sm font-medium rounded-lg border capitalize transition-[background-color,border-color,color] duration-150 active:scale-[0.97] ${outcome === o ? (o === "pass" ? "bg-green-50 border-green-300 text-green-700" : "bg-red-50 border-red-300 text-red-600") : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                >
                  {o === "pass" ? "✓  Pass" : "✗  Fail"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description <span className="font-normal text-gray-400">(optional)</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this classification means..."
              rows={3}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder-gray-300 resize-none transition-[border-color,box-shadow] duration-150"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancel</button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              onAdd({ id: Date.now().toString(), name: name.trim(), outcome, description });
              onClose();
            }}
            className={`${BTN_PRIMARY} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
