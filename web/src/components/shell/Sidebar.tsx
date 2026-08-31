import { WarpLogo } from "../atoms/icons/WarpLogo";
import type { NavItemId } from "../../nav";

const TEAM_TOP = [
  { label: "Runs", icon: "runs" },
  { label: "MCPs and apps", icon: "apps" },
  { label: "Secrets", icon: "secrets" },
  { label: "Integrations", icon: "integrations" },
] as const;

const NAV_ITEMS = [
  { id: "Dashboard" as NavItemId, label: "Dashboard" },
  { id: "Activity" as NavItemId, label: "Activity" },
  { id: "Agents" as NavItemId, label: "Agents" },
  { id: "Automations" as NavItemId, label: "Automations" },
  { id: "Runs" as NavItemId, label: "Runs" },
  { id: "Scorers" as NavItemId, label: "Scorers" },
  { id: "Self-improvement" as NavItemId, label: "Self-improvement" },
  { id: "Factory definition" as NavItemId, label: "Factory definition" },
  { id: "Settings" as NavItemId, label: "Settings" },
] as const;

function TeamIcon({ kind }: { kind: string }) {
  if (kind === "runs") {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M1.5 3h10M1.5 6.5h10M1.5 10h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "apps") {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <rect x="1" y="1" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
        <rect x="7.5" y="1" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
        <rect x="1" y="7.5" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
        <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  }
  if (kind === "secrets") {
    return (
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <circle cx="6.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.1" />
        <path d="M4.5 7.5L3.5 12h6l-1-4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M1.5 6.5a5 5 0 0110 0M4 9a3 3 0 005 0" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function Sidebar({
  factoryName,
  activePage,
  onNav,
}: {
  factoryName: string;
  activePage: NavItemId;
  onNav: (p: NavItemId) => void;
}) {
  const initial = factoryName[0]?.toUpperCase() ?? "F";
  const shortName = factoryName.length > 14 ? factoryName.slice(0, 14) + "…" : factoryName;

  return (
    <div className="w-52 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <WarpLogo />
        <div className="flex items-center gap-1.5">
          <button type="button" className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150" aria-label="Search">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[background-color,color] duration-150" aria-label="Toggle panel">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <rect x="9" y="3" width="5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-3 py-2 space-y-0.5">
        {TEAM_TOP.map((item) => (
          <button
            key={item.label}
            type="button"
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-md transition-[background-color,color] duration-100"
          >
            <span className="text-gray-400">
              <TeamIcon kind={item.icon} />
            </span>
            {item.label}
          </button>
        ))}
      </div>

      <div className="px-3 mt-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2">Factories</span>
          <button type="button" className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-[color] duration-100" aria-label="Add factory">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M5.5 1.5v8M1.5 5.5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100 transition-[background-color] duration-100">
            <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">{initial}</div>
            <span className="text-xs font-medium text-gray-800 flex-1 truncate">{shortName}</span>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-gray-400 flex-shrink-0">
              <path d="M2 4l3.5 3.5L9 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <div className="mt-0.5 ml-2 pl-3 border-l border-gray-200 space-y-0.5 py-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNav(item.id)}
                className={`w-full text-left px-2 py-1.5 text-xs rounded-md transition-[background-color,color,font-weight] duration-100 ${
                  activePage === item.id
                    ? "text-gray-900 font-semibold bg-white shadow-sm border border-gray-100"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-auto border-t border-gray-100 px-3 py-3">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-[background-color] duration-100">
          <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-[10px] font-bold text-white" style={{ outline: "1px solid oklch(0 0 0 / 0.1)" }}>
            U
          </div>
          <span className="text-xs text-gray-600 truncate flex-1">youruser@example.com</span>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-gray-400">
            <path d="M2 4l3.5 3.5L9 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
