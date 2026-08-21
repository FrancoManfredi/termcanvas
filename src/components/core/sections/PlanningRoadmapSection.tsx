// Sección PLANNING → Planificador desde roadmap (MOCK).
//
// Extraída VERBATIM del cuerpo de CoreArchitectureModal: la sesión sigue
// simulada con planningMockData (terminal falsa + plan de fases de ejemplo).
// El estado (planRun/planJsonOpen) es exclusivo de esta sección.

import { useState } from "react";
import { MOCK_PLAN_LOG_LINES, MOCK_PLAN_RESULT } from "../../planningMockData";
import {
  CollapsibleJson,
  OpencodeterminalSession,
  PlannerIcon,
} from "../shared";

export function PlanningRoadmapSection() {
  // Estado de la simulación del planificador.
  const [planRun, setPlanRun] = useState<{
    phase: "idle" | "running" | "done";
  }>({ phase: "idle" });
  const [planJsonOpen, setPlanJsonOpen] = useState(false);

  // Lanza el PLANIFICADOR simulado: avanza la terminal falsa y al terminar
  // muestra el plan de fases (MOCK_PLAN_RESULT).
  const runPlanner = () => {
    if (planRun.phase === "running") return;
    setPlanRun({ phase: "running" });
    setTimeout(() => {
      setPlanRun({ phase: "done" });
      setPlanJsonOpen(false);
    }, MOCK_PLAN_LOG_LINES.length * 260 + 600);
  };

  return (
    <div className="space-y-5">
      {/* IDLE: acción + descripción */}
      {planRun.phase === "idle" && (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-4 p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <div className="w-9 h-9 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <PlannerIcon />
            </div>
            <div className="space-y-1 flex-1">
              <h3 className="text-xs font-bold text-[var(--text-primary)]">Planificador desde Roadmap</h3>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                Ejecuta una sesión de opencode que sintetiza los RFs, ASRs y restricciones del proyecto para estructurar las etapas del roadmap con duraciones estimadas.
              </p>
              <p className="text-[10.5px] font-mono text-[var(--text-muted)] pt-0.5">
                Resultado guardado en{" "}
                <code className="text-[var(--text-secondary)] bg-[var(--surface)] px-1 rounded border border-[var(--border)]">
                  .agents/planning/plan-*.json
                </code>
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0"
              onClick={runPlanner}
            >
              Planificar desde roadmap
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center py-16 text-center">
            <p className="text-xs text-[var(--text-muted)] max-w-sm leading-relaxed">
              Generá la planificación de tareas y etapas del roadmap a partir del contexto completo del proyecto.
            </p>
          </div>
        </div>
      )}

      {/* RUNNING: terminal simulada (streaming de logs) */}
      {planRun.phase === "running" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-[var(--border)]">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
            <span className="text-[11px] font-mono font-semibold text-[var(--text-secondary)]">
              Sesión opencode activa — generando roadmap en curso
            </span>
          </div>
          <OpencodeterminalSession logLines={MOCK_PLAN_LOG_LINES} active />
        </div>
      )}

      {/* DONE: fases del roadmap (MOCK) */}
      {planRun.phase === "done" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 rounded-lg bg-emerald-500/8 border border-emerald-500/25">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-sm shrink-0">
                ✓
              </div>
              <div>
                <p className="text-xs font-semibold text-emerald-400">Planificación completada</p>
                <p className="text-[10.5px] font-mono text-[var(--text-muted)]">
                  {MOCK_PLAN_RESULT.timestamp} · {MOCK_PLAN_RESULT.session_id}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)]"
              onClick={() => {
                setPlanRun({ phase: "idle" });
                setPlanJsonOpen(false);
              }}
            >
              Volver a ejecutar
            </button>
          </div>

          {/* Phase timeline */}
          <div className="space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold block">
              FASES DEL ROADMAP
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {MOCK_PLAN_RESULT.fases.map((fase) => (
                <div
                  key={fase.fase}
                  className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[10px] font-bold flex items-center justify-center font-mono shrink-0">
                        {fase.fase}
                      </span>
                      <span className="text-xs font-bold text-[var(--text-primary)]">{fase.nombre}</span>
                    </div>
                    <span className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                      {fase.duracion_semanas} sem
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {fase.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)] leading-snug">
                        <span className="text-emerald-400 shrink-0 mt-px">·</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Summary metrics */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Plazo total", value: `${MOCK_PLAN_RESULT.metricas_exito.plazo_total_semanas} sem` },
              { label: "Objetivo rechazos", value: MOCK_PLAN_RESULT.metricas_exito.objetivo_rechazos_por_trazabilidad },
              { label: "Escuelas piloto", value: MOCK_PLAN_RESULT.metricas_exito.cooperativas_piloto },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="p-3 rounded-md border border-[var(--border)] bg-[var(--bg)] text-center space-y-0.5"
              >
                <p className="text-base font-bold font-mono tabular-nums text-[var(--text-primary)]">{value}</p>
                <p className="text-[10px] text-[var(--text-muted)] leading-tight">{label}</p>
              </div>
            ))}
          </div>

          <CollapsibleJson
            label={`Ver JSON resultante (.agents/planning/${MOCK_PLAN_RESULT.session_id}.json)`}
            data={MOCK_PLAN_RESULT}
            open={planJsonOpen}
            onToggle={() => setPlanJsonOpen((v) => !v)}
          />
        </div>
      )}
    </div>
  );
}
