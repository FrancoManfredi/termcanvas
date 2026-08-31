import { GithubIcon } from "../../atoms/icons/GithubIcon";
import { BackBtn } from "../../atoms/buttons/BackBtn";
import type { Repo } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export function StepSelectRepo({
  repos,
  selectedId,
  onSelect,
  onNext,
  onBack,
}: {
  repos: readonly Repo[];
  selectedId: string | null;
  onSelect: (repo: Repo) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="anim-fade-in-up">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Select a repository</h1>
      <p className="text-sm text-gray-500 mb-7 leading-relaxed">Pick the GitHub repository you want to use for this factory.</p>
      <div className="border border-gray-200 rounded-xl overflow-hidden mb-6 divide-y divide-gray-100" style={{ boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)" }}>
        {repos.map((repo) => {
          const isSel = selectedId === repo.id;
          return (
            <button
              key={repo.id}
              type="button"
              onClick={() => onSelect(repo)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-[background-color] duration-100 active:scale-[0.99] ${isSel ? "bg-gray-900" : "hover:bg-gray-50"}`}
            >
              <GithubIcon size={15} className={isSel ? "text-white" : "text-gray-700"} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${isSel ? "text-white" : "text-gray-800"}`}>
                  {repo.owner}/{repo.name}
                </p>
                <p className={`text-xs mt-0.5 ${isSel ? "text-gray-300" : "text-gray-400"}`}>
                  {repo.language} · {repo.updatedAt}
                </p>
              </div>
              {isSel && <span className="text-xs text-violet-400">Selected</span>}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between">
        <BackBtn onClick={onBack} />
        <button type="button" onClick={onNext} disabled={!selectedId} className={`${BTN_PRIMARY} disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100`}>
          Next
        </button>
      </div>
    </div>
  );
}
