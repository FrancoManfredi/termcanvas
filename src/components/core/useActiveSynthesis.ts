// Síntesis activa de la entrevista de requerimientos (ledger.synthesis).
//
// Extraído VERBATIM del cuerpo de CoreArchitectureModal (estado + loadSynthesis
// + los efectos que la refrescan). La capucha lo instancia UNA vez y comparte
// el resultado por CoreModalContext, así cambiar de sección no re-dispara las
// llamadas IPC.

import { useCallback, useEffect, useState } from "react";
import { useInterviewStore } from "../../stores/interviewStore";
import { resolveActiveWorktree } from "../../planner/planningSession";
import type { SynthesisResult } from "../../../headless-runtime/interview/index.ts";

export function useActiveSynthesis() {
  // Resultados de la última entrevista completada (ledger.synthesis).
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [synthesisPath, setSynthesisPath] = useState<string | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);

  // Carga la síntesis de la entrevista ACTIVA del proyecto (la que el usuario
  // eligió en el pick phase); sin selección, la última completada.
  const loadSynthesis = useCallback(async (projectPath: string) => {
    setSynthLoading(true);
    try {
      const summaries = await window.termcanvas.interview.list(projectPath);
      const activa = useInterviewStore.getState().activeInterviewPath;
      const sorted = [...summaries].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      // La activa primero; después las completadas por orden.
      const ordered = activa
        ? [...sorted.filter((s) => s.ledgerPath === activa), ...sorted.filter((s) => s.ledgerPath !== activa)]
        : sorted;
      for (const s of ordered) {
        try {
          const { ledger } = await window.termcanvas.interview.state(s.ledgerPath);
          if (ledger?.synthesis?.data) {
            setSynthesis(ledger.synthesis.data);
            // La síntesis standalone vive junto al ledger (entrevista-<ts>-sintesis.json):
            // es la que la migración legacy reescribe.
            setSynthesisPath(s.ledgerPath.replace(/\.json$/, "-sintesis.json"));
            return;
          }
        } catch {
          // Ledger corrupto: probar con la siguiente entrevista.
        }
      }
      setSynthesis(null);
      setSynthesisPath(null);
    } catch {
      setSynthesis(null);
    } finally {
      setSynthLoading(false);
    }
  }, []);

  // Al terminar la entrevista de requerimientos, refresca la síntesis para
  // que las secciones post-entrevista muestren los resultados al instante.
  const interviewPhase = useInterviewStore((s) => s.phase);
  useEffect(() => {
    if (interviewPhase === "done") {
      const active = resolveActiveWorktree();
      if (active) void loadSynthesis(active.path);
    }
  }, [interviewPhase, loadSynthesis]);

  // Al cambiar la entrevista ACTIVA (pick phase del InterviewModal), las
  // secciones post-entrevista muestran la síntesis de la nueva activa.
  const activeInterviewPath = useInterviewStore((s) => s.activeInterviewPath);
  useEffect(() => {
    const active = resolveActiveWorktree();
    if (active) void loadSynthesis(active.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInterviewPath]);

  const applySynthesis = useCallback((next: SynthesisResult) => {
    setSynthesis(next);
  }, []);

  return {
    synthesis,
    synthesisPath,
    synthLoading,
    loadSynthesis,
    applySynthesis,
  };
}
