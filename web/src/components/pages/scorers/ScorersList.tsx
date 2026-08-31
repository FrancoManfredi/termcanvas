import type { Agent, Scorer } from "../../../lib/factory/fixtures/figma.fixtures";

export function ScorersList({
  factoryName,
  scorers,
  agents,
  onNew,
  onDelete,
}: {
  factoryName: string;
  scorers: readonly Scorer[];
  agents: readonly Agent[];
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";
  const BTN_PRIMARY = `px-4 py-1.5 bg-gray-900 text-white text-sm font-semibold rounded-md hover:bg-gray-700 ${BTN_PRESS}`;

  const agentLabel = (agentId: string) => {
    const a = agents.find((x) => x.id === agentId);
    if (!a) return agentId;
    return `${factoryName} ${a.name.charAt(0).toUpperCase() + a.name.slice(1)} Agent`;
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-8 py-3 border-b border-gray-100 sticky top-0 bg-white/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <span className="text-gray-700 font-medium">{factoryName}</span>
          <span className="text-gray-300">/</span>
          <span className="text-gray-900 font-medium">Scorers</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-[background-color,color] duration-150" aria-label="Search">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={onNew} className={BTN_PRIMARY}>New</button>
        </div>
      </div>

      <div className="px-8 py-2">
        {scorers.map((scorer, i) => {
          const stagger = ["delay-0", "delay-60", "delay-120", "delay-180", "delay-240"][Math.min(i, 4)];
          return (
            <div
              key={scorer.id}
              className={`group flex items-start gap-4 py-5 border-b border-gray-100 -mx-8 px-8 hover:bg-gray-50 transition-[background-color] duration-100 cursor-pointer anim-fade-in-up ${stagger}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 mb-1">{scorer.name}</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {scorer.classifications.length} outcome classification{scorer.classifications.length !== 1 ? "s" : ""}
                  {scorer.agentIds.length > 0 && <> • {scorer.agentIds.map(agentLabel).join(" • ")}</>}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(scorer.id);
                }}
                className="mt-0.5 p-1.5 rounded-md text-gray-300 hover:text-red-400 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-[opacity,color,background-color] duration-150 active:scale-[0.9]"
                aria-label="Delete scorer"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M3 5h10M5.5 5V3.5a.5.5 0 01.5-.5h4a.5.5 0 01.5.5V5M6.5 8v4M9.5 8v4M4 5l.7 7.3a1 1 0 001 .7h4.6a1 1 0 001-.7L12 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
