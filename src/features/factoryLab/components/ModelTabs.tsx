/**
 * ModelTabs — Ola 2 P0-1: tabs All / opencode-go / opencode (free) con badge FREE y contadores.
 * Filtro de vista, no fuente de datos. Tailwind tabs con role="tablist".
 */

export type TabId = "All" | "opencode-go" | "opencode (free)";

interface ModelTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  counts: {
    all: number;
    opencodeGo: number;
    free: number;
  };
}

const TAB_DEFS: { id: TabId; label: string; testId: string }[] = [
  { id: "All", label: "All", testId: "tab-all" },
  { id: "opencode-go", label: "opencode-go", testId: "tab-opencode-go" },
  { id: "opencode (free)", label: "opencode (free)", testId: "tab-opencode-free" },
];

export function ModelTabs({ activeTab, onTabChange, counts }: ModelTabsProps) {
  const getCount = (id: TabId): number => {
    switch (id) {
      case "All":
        return counts.all;
      case "opencode-go":
        return counts.opencodeGo;
      case "opencode (free)":
        return counts.free;
      default:
        return 0;
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Model provider tabs"
      className="mb-3 flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1"
    >
      {TAB_DEFS.map((tab) => {
        const isActive = activeTab === tab.id;
        const count = getCount(tab.id);
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.testId}`}
            data-testid={tab.testId}
            onClick={() => onTabChange(tab.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
              isActive
                ? "bg-white text-zinc-900 shadow-sm border border-zinc-200"
                : "text-zinc-600 hover:bg-white hover:text-zinc-900"
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                isActive ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-700"
              }`}
            >
              {count}
            </span>
            {tab.id === "opencode (free)" ? (
              <span className="ml-1 rounded bg-emerald-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white" aria-label="FREE">
                FREE
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default ModelTabs;
