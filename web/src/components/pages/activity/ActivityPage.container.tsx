import { useState } from "react";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityGroupedList } from "./ActivityGroupedList";
import { ActivityDrawer } from "./ActivityDrawer";
import { useFigmaWorkItems } from "../../../lib/factory/hooks/useFigmaFixtures";
import type { WorkItem } from "../../../lib/factory/fixtures/figma.fixtures";

export function ActivityPage({ factoryName = "My factory" }: { factoryName?: string }) {
  const workItems = useFigmaWorkItems();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ planning: false, building: false });
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  const grouped: Record<string, WorkItem[]> = { triage: [], planning: [], building: [], reviewing: [] };
  (workItems as readonly WorkItem[]).forEach((item) => {
    if (grouped[item.stage]) grouped[item.stage].push(item);
  });

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="text-gray-700 font-medium">{factoryName}</span>
            <span className="text-gray-300">/</span>
            <span className="text-gray-900 font-medium">Activity</span>
          </div>
          <div className="flex items-center gap-1.5">
            {[
              <svg key="s" width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>,
              <svg key="f" width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 5.5v7M12 2v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>,
              <svg key="o" width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>,
            ].map((icon, i) => (
              <button key={i} type="button" className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-[background-color,color] duration-150 active:scale-[0.96]">
                {icon}
              </button>
            ))}
          </div>
        </div>

        <ActivityFilters count={workItems.length} />

        <ActivityGroupedList
          grouped={grouped}
          collapsed={collapsed}
          onToggleStage={(stage) => setCollapsed((p) => ({ ...p, [stage]: !p[stage] }))}
          selectedId={selectedItem?.id ?? null}
          onSelect={(item) => setSelectedItem((prev) => (prev?.id === item.id ? null : item))}
        />
      </div>

      {selectedItem && <ActivityDrawer item={selectedItem} onClose={() => setSelectedItem(null)} />}
    </div>
  );
}
