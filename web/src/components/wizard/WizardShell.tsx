import type { ReactNode } from "react";
import { ProgressBar } from "./ProgressBar";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";

export function WizardShell({ children, onExit, step, total }: { children: ReactNode; onExit: () => void; step: number; total: number }) {
  return (
    <div className="min-h-full bg-white flex flex-col">
      <div className="px-6 pt-5 pb-2">
        <button type="button" onClick={onExit} className={`flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 ${BTN_PRESS}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Exit
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center px-6 py-4">
        <div className="w-full max-w-xl">
          <ProgressBar step={step} total={total} />
          {children}
        </div>
      </div>
    </div>
  );
}
