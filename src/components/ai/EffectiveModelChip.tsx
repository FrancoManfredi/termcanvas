// Chip de modelo efectivo por fase: muestra provider/model resuelto
// (override del usuario > default) con estado de validación inline. Va en el
// header de cada fase para que "qué modelo va a correr" sea visible ANTES y
// DURANTE la corrida — cierra de raíz las disputas de pin.

import { useEffect, useState } from "react";
import {
  formatModelRef,
  resolveModelForPhase,
  type ModelRef,
  type PhaseId,
} from "../../../shared/phaseModels";
import type { PhaseValidation } from "../../../shared/modelCatalog";
import { usePreferencesStore } from "../../stores/preferencesStore";

export function EffectiveModelChip({ phaseId }: { phaseId: PhaseId }) {
  const phaseModels = usePreferencesStore((s) => s.phaseModels);
  const [validation, setValidation] = useState<PhaseValidation | null>(null);

  const effective: ModelRef | null = resolveModelForPhase(
    phaseId,
    phaseModels,
  );

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.termcanvas?.models : undefined;
    if (!api?.validatePhase) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api.validatePhase!(phaseId, phaseModels).then((res) => {
        if (!cancelled && res.ok) setValidation(res.data);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phaseId, phaseModels]);

  // Sin pin (fases CLI default): gris — usa el default global del CLI.
  if (!effective) {
    return (
      <span
        className="tc-meta inline-flex items-center gap-1.5 shrink-0"
        title="Sin pin: usa el default global de opencode"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] shrink-0" />
        Default CLI
      </span>
    );
  }

  const ok = validation?.ok;
  const color = validation
    ? ok
      ? "bg-emerald-500"
      : "bg-red-500"
    : "bg-[var(--text-muted)] animate-pulse";
  const detail = validation
    ? ok
      ? "disponible"
      : validation.reason ?? "no disponible"
    : "validando…";

  return (
    <span
      className="tc-meta inline-flex items-center gap-1.5 shrink-0 max-w-full"
      title={`${formatModelRef(effective)} — ${detail}${
        validation && !ok && validation.alternatives?.length
          ? ` | alternativas: ${validation.alternatives.join(", ")}`
          : ""
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${color} shrink-0`} />
      <span className="truncate">{formatModelRef(effective)}</span>
    </span>
  );
}
