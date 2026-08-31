import { Chevron } from "../../atoms/icons/Chevron";
import { StageIcon } from "../../atoms/icons/StageIcon";
import { STAGE_META } from "../../../lib/factory/fixtures/figma.fixtures";
import type { WorkItem } from "../../../lib/factory/fixtures/figma.fixtures";

export function ActivityGroupedList({
  grouped,
  collapsed,
  onToggleStage,
  selectedId,
  onSelect,
}: {
  grouped: Record<string, WorkItem[]>;
  collapsed: Record<string, boolean>;
  onToggleStage: (stage: string) => void;
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      {(["triage", "planning", "building", "reviewing"] as const).map((stage) => {
        const items = grouped[stage] ?? [];
        const meta = STAGE_META[stage];
        const isCollapsed = collapsed[stage];
        return (
          <div key={stage}>
            <button
              type="button"
              onClick={() => onToggleStage(stage)}
              className={`w-full flex items-center gap-2 px-8 py-3 text-sm font-semibold transition-[background-color] duration-150 hover:brightness-[0.97] ${meta.headerBg} ${meta.text}`}
            >
              <Chevron open={!isCollapsed} size={13} />
              <StageIcon stage={stage} size={14} />
              <span>{meta.label}</span>
              <span className="font-normal text-gray-400 ml-1">{items.length}</span>
            </button>

            {!isCollapsed &&
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className={`w-full flex items-center gap-3 px-8 py-3 text-left border-t border-gray-50 transition-[background-color] duration-100 active:scale-[0.99] ${selectedId === item.id ? "bg-gray-100/80 ring-1 ring-inset ring-gray-900/8" : "hover:bg-gray-50"}`}
                >
                  <StageIcon stage={stage} size={14} />
                  <span className="flex-1 text-sm text-gray-800 truncate">{item.title}</span>
                  <span className="text-xs font-mono text-gray-400 uppercase tabular-nums">{item.hash}</span>
                  <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ outline: "1px solid oklch(0 0 0 / 0.1)", outlineOffset: "0px" }}>
                    U
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap w-20 text-right tabular-nums">{item.time}</span>
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
