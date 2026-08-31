import { StageIcon } from "../../atoms/icons/StageIcon";
import { GithubIcon } from "../../atoms/icons/GithubIcon";
import { LinearIcon } from "../../atoms/icons/LinearIcon";
import { SlackIcon } from "../../atoms/icons/SlackIcon";
import type { WorkItem } from "../../../lib/factory/fixtures/figma.fixtures";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";

export function ActivityDrawer({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  return (
    <div className="w-[340px] flex-shrink-0 border-l border-gray-200 flex flex-col bg-white anim-slide-right" style={{ boxShadow: "-4px 0 16px oklch(0 0 0 / 0.05)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-1">
          <span className="text-xs font-mono text-gray-700 font-semibold uppercase tabular-nums">{item.hash}</span>
          <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-[color,background-color] duration-100" aria-label="Previous">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M4 3l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-[color,background-color] duration-100" aria-label="Next">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M8 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="w-6 h-6 rounded-md bg-red-100 hover:bg-red-200 flex items-center justify-center active:scale-[0.9] transition-[background-color,transform] duration-100" aria-label="Stop">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.2" fill="#ef4444" />
            </svg>
          </button>
          <button type="button" className={`flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 rounded-md text-xs text-gray-700 hover:bg-gray-50 ${BTN_PRESS}`}>
            <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
              <path d="M2 9L9 2M6 2h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            View agent
          </button>
          <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-[color,background-color] duration-100" aria-label="History">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.5 4V6.5l2 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={onClose} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-[background-color,color] duration-100 active:scale-[0.9]" aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
              <path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">{item.title}</h2>
        <div className="flex items-center gap-1.5 mb-5">
          <StageIcon stage={item.stage} size={13} />
          <span className="text-xs text-gray-500 capitalize">{item.stage}</span>
        </div>
        <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
          <div className="mt-0.5 flex-shrink-0">
            {item.origin === "slack" ? <SlackIcon size={16} /> : item.origin === "github" ? <GithubIcon size={16} className="text-gray-700" /> : <LinearIcon size={16} />}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">Origin {item.origin === "slack" ? "Slack thread" : item.origin === "github" ? "GitHub issue" : "Linear issue"}</p>
            <p className="text-xs text-gray-400 mt-0.5">Started this task {item.startedAgo}</p>
          </div>
        </div>
      </div>

      <button type="button" className="flex items-center justify-between px-5 py-4 border-t border-gray-100 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-[background-color] duration-100 active:scale-[0.99]">
        Task details
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
