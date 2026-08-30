interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  tooltip?: string;
  children?: React.ReactNode;
}

export function MetricCard({ title, value, subtitle, tooltip, children }: MetricCardProps) {
  return (
    <div className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-1.5">
        <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">{title}</div>
        {tooltip ? (
          <span
            className="group relative inline-flex"
            tabIndex={0}
            aria-label={tooltip}
            title={tooltip}
          >
            <span className="grid h-4 w-4 place-items-center rounded-full border border-zinc-200 bg-white text-[10px] font-bold leading-none text-zinc-500 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/20">
              ⓘ
            </span>
            <span
              className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 hidden max-w-[260px] -translate-x-1/2 whitespace-normal rounded-[6px] border border-zinc-200 bg-zinc-900 px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-lg group-hover:block group-focus:block group-focus-within:block"
              role="tooltip"
            >
              {tooltip}
            </span>
          </span>
        ) : null}
      </div>
      <div className="mt-1 text-[22px] font-[600] tracking-[-0.02em] text-zinc-900 tabular-nums">{value}</div>
      {subtitle && <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">{subtitle}</div>}
      {children && <div className="mt-3 border-t border-zinc-100 pt-3">{children}</div>}
    </div>
  );
}

export function MetricCardSkeleton() {
  return <div className="h-[110px] animate-pulse rounded-[12px] border border-zinc-200 bg-zinc-50" />;
}
