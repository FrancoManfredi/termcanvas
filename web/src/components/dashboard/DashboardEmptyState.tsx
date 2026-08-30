// DashboardEmptyState — SRP: empty honesto + CTA cuando no hay datos reales

export interface DashboardEmptyStateProps {
  readonly title?: string;
  readonly message?: string;
  readonly ctaLabel?: string;
  readonly onCta?: () => void;
}

export function DashboardEmptyState({ title = "Sin datos todavía", message = "Tus métricas van a aparecer acá cuando tu factory tenga actividad.", ctaLabel, onCta }: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-white text-zinc-400 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">∅</div>
      <p className="mt-3 text-sm font-medium text-zinc-700">{title}</p>
      <p className="mt-1 max-w-[28ch] text-xs leading-relaxed text-zinc-500">{message}</p>
      {ctaLabel && onCta && (
        <button type="button" onClick={onCta} className="mt-4 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800">
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
