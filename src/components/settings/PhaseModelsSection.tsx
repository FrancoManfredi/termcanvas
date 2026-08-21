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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="tc-eyebrow">{t.phase_models_title}</div>
        <button
          type="button"
          className="tc-meta underline decoration-dotted hover:text-[var(--text-primary)]"
          onClick={() => {
            setCatalog(null);
            void api?.invalidate?.();
            void api?.listAvailable?.(true).then((res) => {
              if (res.ok) setCatalog(res.data);
              else setLoadError(res.error);
            });
          }}
        >
          {t.phase_models_refresh}
        </button>
      </div>
      <p className="tc-meta max-w-xl">{t.phase_models_desc}</p>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="tc-body-sm text-[var(--text-primary)]">
            {t.phase_cli_tui_label}
          </span>
          <span className="tc-meta">{t.phase_cli_tui_desc}</span>
        </div>
        <select
          className="shrink-0 rounded-[7px] border border-[var(--border)] bg-[var(--bg)] py-1 text-xs text-[var(--text-primary)] outline-none hover:border-[var(--accent)]"
          value={phaseCliTui ? "tui" : "headless"}
          onChange={(e) =>
            usePreferencesStore.getState().setPhaseCliTui(e.target.value === "tui")
          }
        >
          <option value="headless">{t.phase_cli_mode_headless}</option>
          <option value="tui">{t.phase_cli_mode_tui}</option>
        </select>
      </div>
      {loadError && (
        <p className="tc-meta text-[var(--text-danger, #f66)]">
          {t.phase_models_load_failed} ({loadError})
        </p>
      )}
      <div className="flex flex-col gap-4">
        {PHASE_IDS.map((phaseId) => {
          const override: ModelRef | undefined = phaseModels[phaseId];
          const effective = resolveModelForPhase(phaseId, phaseModels);
          const st = statusOf(validations[phaseId]);
          const statusText =
            st.key === "checking"
              ? t.phase_model_checking
              : st.key === "available"
                ? `${t.phase_model_available}: ${effective ? formatModelRef(effective) : "—"}`
                : st.detail ?? t.phase_model_missing;
          const labelKey = `phase_${phaseId.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
          const labelText = t[labelKey as keyof typeof t] as string;

          return (
            <div key={phaseId} className="flex flex-col gap-1.5">
              {/* Línea 1: label + estado — cada uno con truncate y title, sin
                  depender del ancho del control de abajo. */}
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className="tc-body-sm min-w-0 truncate text-[var(--text-primary)]"
                  title={labelText}
                >
                  {labelText}
                </span>
                <span
                  className={`tc-meta min-w-0 shrink-0 truncate text-right ${
                    st.key === "missing"
                      ? "text-[var(--text-danger, #f66)]"
                      : ""
                  }`}
                  title={statusText}
                >
                  {statusText}
                </span>
              </div>
              {/* Línea 2: control a ancho completo + reset. */}
              <div className="flex items-center gap-2">
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
                {override && (
                  <button
                    type="button"
                    className="tc-meta shrink-0 underline decoration-dotted hover:text-[var(--text-primary)]"
                    onClick={() => setPhaseModel(phaseId, null)}
                  >
                    {t.phase_model_default}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
