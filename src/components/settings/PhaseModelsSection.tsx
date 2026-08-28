// Sección "Models per phase" del tab Agent en Settings: una tarjeta por fase
// (label + estado inline arriba, combobox buscable + reset abajo) alimentada
// por el catálogo real de opencode.
//
// El estado vive en preferencesStore; el catálogo viene de
// window.termcanvas.models. Sin API de electron (tests/node) la sección
// muestra el estado vacío sin romper.

import { useEffect, useMemo, useState } from "react";
import {
  PHASE_IDS,
  formatModelRef,
  resolveModelForPhase,
  type ModelRef,
  type PhaseId,
} from "../../../shared/phaseModels";
import type {
  CatalogResult,
  ModelCatalog,
  PhaseValidation,
} from "../../../shared/modelCatalog";
import {
  buildPhaseModelGroups,
  refFromOptionValue,
} from "./phaseModelOptions";
import { ModelCombobox } from "./ModelCombobox";
import { usePreferencesStore } from "../../stores/preferencesStore";
import { useT } from "../../i18n/useT";

function statusOf(
  validation: PhaseValidation | undefined,
): { key: "checking" | "available" | "missing"; detail?: string } {
  if (!validation) return { key: "checking" };
  return validation.ok
    ? { key: "available" }
    : { key: "missing", detail: validation.reason };
}

const PHASE_ICONS: Record<PhaseId, string> = {
  brief: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  requirements: "M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z",
  synthesis: "M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5",
  gapCheck: "M11 19a8 8 0 100-16 8 8 0 000 16z M21 21l-4.3-4.3 M9 11l2 2 4-4",
  asrReview: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 100 6 3 3 0 000-6z",
  tactics: "M12 2L13.5 8.5 20 9l-5.5 4 1.5 6.5L12 16l-4 3.5L9.5 13 4 9l5.5-.5z",
  diagnosisLlm: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
};

function PhaseIcon({ phaseId }: { phaseId: PhaseId }) {
  const d = PHASE_ICONS[phaseId] ?? PHASE_ICONS.brief;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {d.split(" M").map((part, i) => (
        <path key={i} d={(i === 0 ? "" : "M") + part} />
      ))}
    </svg>
  );
}

function StatusBadge({ status, detail, t }: { status: "checking" | "available" | "missing"; detail?: string; t: { phase_model_checking: string; phase_model_available: string; phase_model_missing: string } }) {
  if (status === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium leading-none text-[var(--text-muted)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-muted)]" />
        {t.phase_model_checking}
      </span>
    );
  }
  if (status === "available") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--green)]/10 border border-[var(--green)]/20 px-2.5 py-1 text-[11px] font-medium leading-none text-[var(--green)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
        {t.phase_model_available}
      </span>
    );
  }
  return (
    <span
      className="inline-flex max-w-[180px] items-center gap-1.5 rounded-full bg-[var(--red-soft)] border border-[var(--red)]/20 px-2.5 py-1 text-[11px] font-medium leading-none text-[var(--red)]"
      title={detail}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--red)]" />
      <span className="truncate">{detail ? detail : t.phase_model_missing}</span>
    </span>
  );
}

export function PhaseModelsSection() {
  const t = useT();
  const phaseModels = usePreferencesStore((s) => s.phaseModels);
  const phaseCliTui = usePreferencesStore((s) => s.phaseCliTui);
  const setPhaseModel = usePreferencesStore((s) => s.setPhaseModel);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validations, setValidations] = useState<
    Partial<Record<PhaseId, PhaseValidation>>
  >({});

  const api =
    typeof window !== "undefined" ? window.termcanvas?.models : undefined;

  useEffect(() => {
    if (!api?.listAvailable) return;
    let cancelled = false;
    void (async () => {
      try {
        const res: CatalogResult<ModelCatalog> = await api.listAvailable!(true);
        if (cancelled) return;
        if (res.ok) setCatalog(res.data);
        else setLoadError(res.error);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Validación por fase contra el server real (debounce corto para no
  // golpear el catálogo en cada cambio).
  useEffect(() => {
    if (!api?.validatePhase) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const entries = await Promise.all(
          PHASE_IDS.map(async (phaseId) => {
            const res = await api.validatePhase!(phaseId, phaseModels);
            return [phaseId, res.ok ? res.data : undefined] as const;
          }),
        );
        if (!cancelled) {
          setValidations(
            Object.fromEntries(entries) as Partial<
              Record<PhaseId, PhaseValidation>
            >,
          );
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, phaseModels]);

  const groups = useMemo(() => buildPhaseModelGroups(catalog), [catalog]);

  const configuredCount = Object.keys(phaseModels).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Header card — concentric radius: outer 16 / inner 10 */}
      <div
        className="flex flex-col gap-3 rounded-[16px] bg-[var(--surface)]/40 p-4"
        style={{
          boxShadow: "0 1px 2px oklch(0 0 0 / 0.04), 0 4px 12px oklch(0 0 0 / 0.06)",
          outline: "1px solid oklch(0 0 0 / 0.06)",
          outlineOffset: "-1px",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 8a3 3 0 100 6 3 3 0 000-6z" />
                <path d="M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M6.34 17.66l-1.41 1.41 M19.07 4.93l-1.41 1.41" />
                <path d="M9 12a3 3 0 016 0" opacity="0.5" />
              </svg>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-[13px] font-semibold leading-none tracking-tight text-[var(--text-primary)]">
                  {t.phase_models_title}
                </h4>
                {configuredCount > 0 && (
                  <span className="inline-flex items-center rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-medium tabular-nums leading-none text-[var(--accent-foreground)]">
                    {configuredCount}/{PHASE_IDS.length}
                  </span>
                )}
              </div>
              <p className="max-w-[52ch] text-[12px] leading-4 text-[var(--text-secondary)]">
                {t.phase_models_desc}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12px] font-medium leading-none text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] active:scale-[0.96] disabled:opacity-50 transition-[transform,background-color,border-color,color] duration-150 will-change-transform"
            style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
            onClick={() => {
              setCatalog(null);
              setLoadError(null);
              void api?.invalidate?.();
              void api?.listAvailable?.(true).then((res) => {
                if (res.ok) setCatalog(res.data);
                else setLoadError(res.error);
              });
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 11-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            {t.phase_models_refresh}
          </button>
        </div>
        {/* Subtle meta row: catalog size hint */}
        {catalog && (
          <div className="flex items-center gap-2 text-[11px] leading-none text-[var(--text-muted)]">
            <span className="h-1 w-1 rounded-full bg-[var(--text-faint)]" />
            {catalog.providers.length} providers · {catalog.providers.reduce((n, p) => n + p.models.length, 0)} models
            <span className="hidden sm:inline">— type to filter in each phase</span>
          </div>
        )}
      </div>

      {/* CLI mode — compact control card */}
      <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--bg)]/60 px-3.5 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[12px] font-medium leading-none text-[var(--text-primary)]">
            {t.phase_cli_tui_label}
          </span>
          <span className="text-[11px] leading-4 text-[var(--text-secondary)] line-clamp-2">
            {t.phase_cli_tui_desc}
          </span>
        </div>
        <div className="inline-flex shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)]/40 p-0.5">
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium leading-none transition-colors duration-150 ${!phaseCliTui ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
            onClick={() => usePreferencesStore.getState().setPhaseCliTui(false)}
          >
            {t.phase_cli_mode_headless}
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium leading-none transition-colors duration-150 ${phaseCliTui ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
            onClick={() => usePreferencesStore.getState().setPhaseCliTui(true)}
          >
            {t.phase_cli_mode_tui}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2.5 rounded-[12px] border border-[var(--red)]/20 bg-[var(--red-soft)] px-3.5 py-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--red)]/15 text-[var(--red)]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4 M12 16h.01" /></svg>
          </span>
          <p className="min-w-0 text-[12px] leading-4 text-[var(--red)]">
            {t.phase_models_load_failed} <span className="font-mono text-[11px] opacity-80">({loadError})</span>
          </p>
        </div>
      )}

      {/* Phase cards — staggered entrance, concentric radius, layered shadow */}
      <div className="flex flex-col gap-3">
        {PHASE_IDS.map((phaseId, idx) => {
          const override: ModelRef | undefined = phaseModels[phaseId];
          const effective = resolveModelForPhase(phaseId, phaseModels);
          const st = statusOf(validations[phaseId]);
          const hasOverride = Boolean(override);
          const statusText =
            st.key === "checking"
              ? t.phase_model_checking
              : st.key === "available"
                ? effective
                  ? formatModelRef(effective)
                  : "—"
                : st.detail ?? t.phase_model_missing;
          const labelKey = `phase_${phaseId.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
          const labelText = t[labelKey as keyof typeof t] as string;
          const isActive = st.key === "available" && hasOverride;

          return (
            <div
              key={phaseId}
              className="group relative flex flex-col rounded-[14px] border bg-[var(--bg)] focus-within:z-20"
              style={{
                borderColor: isActive ? "color-mix(in srgb, var(--accent) 18%, var(--border))" : "var(--border)",
                boxShadow: isActive
                  ? "0 1px 2px oklch(0 0 0 / 0.04), 0 4px 16px oklch(0 0 0 / 0.06), inset 0 1px 0 oklch(1 0 0 / 0.04)"
                  : "0 1px 2px oklch(0 0 0 / 0.03), 0 2px 8px oklch(0 0 0 / 0.04)",
                animation: "phase-card-in 0.38s cubic-bezier(0.2, 0, 0, 1) both",
                animationDelay: `${idx * 45}ms`,
                transition: "border-color 150ms cubic-bezier(0.2, 0, 0, 1), box-shadow 150ms cubic-bezier(0.2, 0, 0, 1)",
              } as React.CSSProperties}
            >
              {/* Top row: icon + label + status badge */}
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border text-[var(--text-secondary)] transition-colors duration-150 ${isActive ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)]" : "bg-[var(--surface)] border-[var(--border)] group-hover:border-[var(--border-hover)] group-hover:text-[var(--text-primary)]"}`}>
                  <PhaseIcon phaseId={phaseId} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className="truncate text-[13px] font-medium leading-none text-[var(--text-primary)]"
                    title={labelText}
                  >
                    {labelText}
                  </span>
                  <span
                    className="truncate font-mono text-[11px] leading-none text-[var(--text-muted)]"
                    title={statusText}
                  >
                    {st.key === "available" ? statusText : st.key === "checking" ? "—" : statusText}
                  </span>
                </div>
                <StatusBadge status={st.key} detail={st.detail} t={t} />
              </div>

              {/* Bottom row: combobox + reset — subtle surface lift. Rounded bottom keeps outer 14px corners crisp without needing overflow-hidden on the card (which would clip the dropdown). */}
              <div className="flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)]/30 px-3 py-3 rounded-b-[14px]">
                <ModelCombobox
                  value={override ? formatModelRef(override) : ""}
                  groups={groups}
                  defaultLabel={t.phase_model_default}
                  onChange={(value) => {
                    setPhaseModel(
                      phaseId,
                      refFromOptionValue(value, effective),
                    );
                  }}
                />
                {override ? (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12px] font-medium leading-none text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] active:scale-[0.96] transition-[transform,background-color,border-color,color] duration-150 will-change-transform"
                    style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                    onClick={() => setPhaseModel(phaseId, null)}
                    title="Reset to default"
                  >
                    {t.phase_model_default}
                  </button>
                ) : (
                  <span className="hidden sm:inline-flex shrink-0 items-center rounded-full bg-[var(--surface)] border border-[var(--border)] px-2.5 py-1 text-[11px] leading-none text-[var(--text-faint)]">
                    Default
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`@keyframes phase-card-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
