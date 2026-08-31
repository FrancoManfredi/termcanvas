const BTN_PRESS = "transition-[transform,background-color,border-color,color,box-shadow] duration-150 active:scale-[0.96]";

export function ActivityFilters({ count }: { count: number }) {
  return (
    <div className="px-8 py-3 border-b border-gray-100 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {[
          {
            icon: (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="3 1.5" />
              </svg>
            ),
            bold: "Stage",
            sep: "is",
            val: "Triage, Planning, Building, ...",
          },
          {
            icon: (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="5" r="2.5" stroke="#9ca3af" strokeWidth="1.5" />
                <path d="M3.5 11.5a3.5 3.5 0 017 0" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ),
            bold: "Created",
            sep: "by",
            val: "youruser",
          },
        ].map((chip) => (
          <div key={chip.bold} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm" style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.04)" }}>
            {chip.icon}
            <span className="text-gray-600 font-medium">{chip.bold}</span>
            <span className="text-gray-400">{chip.sep}</span>
            <span className="text-gray-700">{chip.val}</span>
            <button type="button" className="text-gray-400 hover:text-gray-600 ml-1 transition-[color] duration-100" aria-label="Remove filter">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
        <button type="button" className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 border border-dashed border-gray-200 rounded-lg transition-[color,border-color] duration-150 active:scale-[0.96]" aria-label="Add filter">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-400">Showing {count} results</span>
          <button type="button" className={`text-gray-600 font-medium border border-gray-200 rounded-md px-3 py-1 hover:bg-gray-50 ${BTN_PRESS}`}>Clear</button>
        </div>
      </div>
    </div>
  );
}
