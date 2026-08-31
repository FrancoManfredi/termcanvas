import { GithubIcon } from "../../atoms/icons/GithubIcon";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";

export function StepConnectHost({ onNext }: { onNext: () => void }) {
  return (
    <div className="anim-fade-in-up">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Connect your code host</h1>
      <p className="text-sm text-gray-500 mb-7 leading-relaxed">Warp will connect to your code host so that you can select which repos you want to use in your factory.</p>
      <button
        type="button"
        onClick={onNext}
        className={`w-full flex items-center gap-4 px-5 py-4 border border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 text-left ${BTN_PRESS}`}
        style={{ boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)" }}
      >
        <GithubIcon size={32} className="text-gray-900" />
        <div>
          <p className="text-sm font-semibold text-gray-900">I want to use repos from GitHub</p>
          <p className="text-xs text-gray-400 mt-0.5">Connected as youruser</p>
        </div>
      </button>
    </div>
  );
}
