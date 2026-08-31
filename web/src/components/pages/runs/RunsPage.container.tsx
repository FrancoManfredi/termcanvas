import { RunsList } from "./RunsList";
import { useFigmaRuns } from "../../../lib/factory/hooks/useFigmaFixtures";

const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

export function RunsPage({ factoryName = "My factory" }: { factoryName?: string }) {
  const runs = useFigmaRuns();
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-gray-700 font-medium">{factoryName}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">Runs</span>
        </div>
        <div className="flex items-center gap-1.5">
          {[
            <svg key="s" width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>,
            <svg key="c" width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 5.5v7M12 2v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>,
            <svg key="f" width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>,
          ].map((icon, i) => (
            <button key={i} type="button" className={`w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 ${BTN_PRESS}`}>
              {icon}
            </button>
          ))}
          <button type="button" className={BTN_PRIMARY}>New</button>
        </div>
      </div>

      <RunsList runs={runs} />
    </div>
  );
}
