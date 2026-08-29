
interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  children?: React.ReactNode;
}

export function MetricCard({ title, value, subtitle, children }: MetricCardProps) {
  return (
    <div className="rounded-[12px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="text-[11px] font-[600] tracking-[0.06em] uppercase text-zinc-500">{title}</div>
      <div className="mt-1 text-[22px] font-[600] tracking-[-0.02em] text-zinc-900 tabular-nums">{value}</div>
      {subtitle && <div className="mt-1 text-[11px] leading-relaxed text-zinc-500">{subtitle}</div>}
      {children && <div className="mt-3 border-t border-zinc-100 pt-3">{children}</div>}
    </div>
  );
}

export function MetricCardSkeleton() {
  return <div className="h-[110px] animate-pulse rounded-[12px] border border-zinc-200 bg-zinc-50" />;
}
