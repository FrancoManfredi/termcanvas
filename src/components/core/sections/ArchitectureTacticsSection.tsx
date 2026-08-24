// Sección PLANNING → Tácticas de Arquitectura (ASR → ADR).
//
// El análisis corre como TRABAJO DE FONDO en el proceso main: esta sección
// solo ARRANCA el job y REFLEJA el estado persistido en
// <repo>/.agents/architecture/analisis-tacticas.json vía polling (~2s).
// Cerrar el modal o navegar no interrumpe nada; cerrar la APP a mitad de
// camino deja el doc marcado como interrumpido (stale) con reintento; los
// resultados terminados sobreviven al cierre para elegir con calma.
//
// Mismo patrón interactivo que la entrevista: candidatas con argumentación
// visible + siempre disponible el texto libre (con validación no bloqueante),
// conflictos de la consolidación como alerta NO bloqueante, y la decisión
// final SIEMPRE humana por tarjeta.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCoreModal } from "../context";
import { NoSynthesis, SearchHeader, SynthLoading } from "../sectionChrome";
import { resolveActiveWorktree } from "../../../planner/planningSession";
import { useNotificationStore } from "../../../stores/notificationStore";
import { AlertIcon, CheckIcon } from "../shared";
import type {
  ConflictoTacticas,
  ConfirmTacticDecisionInput,
  TacticsAnalysisOutput,
  TacticStatusEntry,
} from "../../../../headless-runtime/interview/tactics";
import {
  CATEGORIAS_TACTICAS,
  CATEGORIA_LABELS,
} from "../../../../shared/tacticCategorias";

// Traduce los errores del motor a mensajes accionables para el usuario
// (mismo criterio que friendlyMigrationError).
function friendlyTacticsError(raw: string): string {
  if (/no se pudo arrancar el server|no se pudo crear la sesión|error de llamada|API/i.test(raw)) {
    return "El motor de IA no está disponible. Verificá la configuración de opencode e intentá de nuevo.";
  }
  if (/no cumplió el schema|fuera de contrato|no validó el contrato/i.test(raw)) {
    return "El modelo no devolvió un formato válido. Reintentá (puede ser transitorio).";
  }
  if (/tiempo de espera|timeout|excedió el tiempo/i.test(raw)) {
    return "El análisis superó el tiempo de espera. Reintentá.";
  }
  return raw || "No se pudieron analizar las tácticas.";
}

interface AdvertenciaLibre {
  asrId: string;
  advertencia: string;
  yStatement: string;
  textoLibre: string;
}

type ResultadoAsr =
  | { ok: true; data: TacticsAnalysisOutput; categoriaUsada: string; categoriaConfiada: boolean }
  | { ok: false; reason?: "categoria_no_mapeada"; atributo?: string; error: string };

interface DocAnalisis {
  estado: "running" | "done" | "error";
  iniciado_at: string;
  resultados_por_asr: Record<string, { estado: string; resultado?: ResultadoAsr; error?: string }>;
  consolidacion?: {
    estado: string;
    data?: { conflictos?: ConflictoTacticas[] };
    error?: string;
  };
  error_global?: string;
}

type EstadoRemoto =
  | { estado: "idle" }
  | { estado: "stale"; doc: DocAnalisis }
  | { estado: "running" | "done" | "error"; doc: DocAnalisis };

const POLL_MS = 2000;

export function ArchitectureTacticsSection() {
  const { synthesis, synthesisPath, synthLoading, search } = useCoreModal();
  const hasSynthesis = synthesis !== null;

  // ── Estado espejo del job de fondo ─────────────────────────────────────
  const [run, setRun] = useState<{ phase: "idle" | "running" | "done" | "error"; error?: string }>({
    phase: "idle",
  });
  const [status, setStatus] = useState<TacticStatusEntry[]>([]);
  const [analisis, setAnalisis] = useState<Record<string, TacticsAnalysisOutput>>({});
  const [metaAnalisis, setMetaAnalisis] = useState<
    Record<string, { categoriaUsada: string; confiado: boolean }>
  >({});
  const [erroresAnalisis, setErroresAnalisis] = useState<
    Record<string, { mensaje: string; sinCategoria?: boolean }>
  >({});
  const [conflictos, setConflictos] = useState<ConflictoTacticas[] | null>(null);
  const [conflictosError, setConflictosError] = useState<string | null>(null);

  // ── Estado de la decisión por tarjeta ──────────────────────────────────
  const [seleccion, setSeleccion] = useState<Record<string, number | "libre">>({});
  const [textoLibre, setTextoLibre] = useState<Record<string, string>>({});
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [advertencia, setAdvertencia] = useState<AdvertenciaLibre | null>(null);
  const [categoriaManual, setCategoriaManual] = useState<Record<string, string>>({});

  const prevPhaseRef = useRef<"idle" | "running" | "done" | "error">("idle");

  const genuinos = status.filter((a) => a.es_asr_genuino);
  const q = search.trim().toLowerCase();
  const visibles = genuinos.filter(
    (g) =>
      !q ||
      g.asrId.toLowerCase().includes(q) ||
      g.atributo.toLowerCase().includes(q),
  );

  const loadStatus = useCallback(async () => {
    if (!synthesisPath) return;
    try {
      const active = resolveActiveWorktree();
      if (!active) return;
      const res = await window.termcanvas.interview.tacticsStatus(active.path, synthesisPath);
      setStatus(res.asrs);
    } catch {
      // Best-effort: sin status la sección muestra los datos del análisis local.
    }
  }, [synthesisPath]);

  const registrarResultado = useCallback((asrId: string, r: ResultadoAsr) => {
    if (r.ok) {
      setAnalisis((prev) => ({ ...prev, [asrId]: r.data }));
      setMetaAnalisis((prev) => ({
        ...prev,
        [asrId]: { categoriaUsada: r.categoriaUsada, confiado: r.categoriaConfiada },
      }));
      setErroresAnalisis((e) => {
        const next = { ...e };
        delete next[asrId];
        return next;
      });
    } else {
      setErroresAnalisis((e) => ({
        ...e,
        [asrId]: { mensaje: friendlyTacticsError(r.error), sinCategoria: r.reason === "categoria_no_mapeada" },
      }));
    }
  }, []);

  const aplicarEstadoRemoto = useCallback(
    (remoto: EstadoRemoto): "idle" | "running" | "stale" | "done" | "error" => {
      if (remoto.estado === "idle") return "idle";
      if (remoto.estado === "stale") {
        setRun({
          phase: "error",
          error:
            "El análisis quedó interrumpido (se cerró la app o murió a mitad de camino). Reintentá.",
        });
        return "error";
      }
      const doc = remoto.doc;
      for (const [asrId, entry] of Object.entries(doc.resultados_por_asr ?? {})) {
        if (entry.estado === "corriendo") continue;
        if (entry.resultado) registrarResultado(asrId, entry.resultado);
        else
          setErroresAnalisis((e) => ({
            ...e,
            [asrId]: { mensaje: friendlyTacticsError(entry.error ?? "Fallo desconocido.") },
          }));
      }
      const c = doc.consolidacion;
      if (c?.estado === "skipped") {
        setConflictosError(null);
        setConflictos([]);
      } else if (c?.estado === "ok") {
        setConflictosError(null);
        setConflictos(c.data?.conflictos ?? []);
      } else if (c?.estado === "error") {
        setConflictos(null);
        setConflictosError(c.error ?? "No se pudo ejecutar la consolidación.");
      }
      if (doc.error_global) {
        setRun({ phase: "error", error: friendlyTacticsError(doc.error_global) });
        return "error";
      }
      const fase: "running" | "done" = remoto.estado === "running" ? "running" : "done";
      setRun({ phase: fase });
      return remoto.estado;
    },
    [registrarResultado],
  );

  const refrescarEstadoRemoto = useCallback(async () => {
    const active = resolveActiveWorktree();
    if (!active || !synthesisPath) return;
    try {
      const remoto = await window.termcanvas.interview.tacticsAnalysisState(active.path, synthesisPath);
      const antes = prevPhaseRef.current;
      const nueva = aplicarEstadoRemoto(remoto);
      prevPhaseRef.current = nueva === "idle" ? antes : (nueva as typeof antes);
      // Transición running → done detectada por el poll: aviso no intrusivo.
      if (antes === "running" && nueva !== "running" && nueva !== "idle") {
        useNotificationStore.getState().notify("info", "Análisis de tácticas terminado.");
      }
    } catch {
      // Best-effort: un poll fallido no rompe nada.
    }
  }, [synthesisPath, aplicarEstadoRemoto]);

  // Al cambiar de síntesis activa se limpia TODO el estado efímero y se
  // hidrata desde disco: otro proyecto/entrevista no hereda selecciones, y
  // un análisis en curso/terminado reaparece aunque se haya cerrado todo.
  useEffect(() => {
    void loadStatus();
    setRun({ phase: "idle" });
    setAnalisis({});
    setMetaAnalisis({});
    setErroresAnalisis({});
    setConflictos(null);
    setConflictosError(null);
    setSeleccion({});
    setTextoLibre({});
    setAdvertencia(null);
    setCategoriaManual({});
    void refrescarEstadoRemoto();
  }, [synthesisPath, loadStatus, refrescarEstadoRemoto]);

  // Polling SOLO mientras hay trabajo en vuelo (el job vive en el proceso
  // main: este componente puede desmontarse sin consecuencias).
  useEffect(() => {
    if (run.phase !== "running" || !synthesisPath) return;
    const timer = setInterval(() => void refrescarEstadoRemoto(), POLL_MS);
    return () => clearInterval(timer);
  }, [run.phase, synthesisPath, refrescarEstadoRemoto]);

  const conflictsFor = useCallback(
    (asrId: string): ConflictoTacticas[] =>
      (conflictos ?? []).filter((c) => c.asr_a === asrId || c.asr_b === asrId),
    [conflictos],
  );

  const runAnalysis = async () => {
    const active = resolveActiveWorktree();
    if (!active || !synthesisPath) {
      setRun({ phase: "error", error: "No hay una síntesis activa para analizar." });
      return;
    }
    setRun({ phase: "running" });
    prevPhaseRef.current = "running";
    try {
      const res = await window.termcanvas.interview.analyzeTactics(active.path, synthesisPath);
      if (!res.started && res.motivo !== "ya_en_curso") {
        setRun({
          phase: "error",
          error:
            res.motivo === "no_genuine_asrs"
              ? "No hay restricciones arquitectónicas genuinas en esta síntesis."
              : res.motivo === "no_synthesis"
                ? "La síntesis no existe o no es válida."
                : "No se pudo iniciar el análisis.",
        });
      }
      // El primer tick del poll trae el estado real del doc.
    } catch (err) {
      setRun({ phase: "error", error: friendlyTacticsError(err instanceof Error ? err.message : String(err)) });
    }
  };

  // Reintento quirúrgico: SOLO el ASR indicado (lo lanza el proceso main;
  // este componente solo marca el poll activo y limpia el error local).
  const retryOne = async (asrId: string) => {
    const active = resolveActiveWorktree();
    if (!active || !synthesisPath) return;
    setErroresAnalisis((e) => {
      const next = { ...e };
      delete next[asrId];
      return next;
    });
    setRun((r) => (r.phase === "running" ? r : { phase: "running" }));
    prevPhaseRef.current = "running";
    try {
      await window.termcanvas.interview.analyzeOneTactic(
        active.path,
        synthesisPath,
        asrId,
        categoriaManual[asrId],
      );
    } catch (err) {
      setErroresAnalisis((e) => ({
        ...e,
        [asrId]: { mensaje: friendlyTacticsError(err instanceof Error ? err.message : String(err)) },
      }));
    }
  };

  const retryConsolidacion = async () => {
    const active = resolveActiveWorktree();
    if (!active || !synthesisPath) return;
    const recomendadas = Object.entries(analisis)
      .map(([asrId, data]) => {
        const atributo = status.find((s) => s.asrId === asrId)?.atributo ?? "";
        const candidata = data.candidatas.find((c) => c.es_recomendada);
        return candidata ? { asrId, atributo, candidata } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    setConflictosError(null);
    try {
      const res = await window.termcanvas.interview.consolidateTactics(active.path, recomendadas);
      if (!res.ok) {
        setConflictosError(res.error);
      } else {
        setConflictosError(null);
        setConflictos(res.skipped ? [] : res.data.conflictos);
      }
    } catch (err) {
      setConflictosError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmarConPayload = async (
    entry: TacticStatusEntry,
    payload: ConfirmTacticDecisionInput,
  ): Promise<boolean> => {
    const active = resolveActiveWorktree();
    if (!active) {
      useNotificationStore.getState().notify("error", "No hay un proyecto activo.");
      return false;
    }
    setConfirmando(entry.asrId);
    try {
      const res = await window.termcanvas.interview.confirmTacticDecision(active.path, payload);
      if (!res.ok) {
        if (res.reason === "needs_confirmation") {
          setAdvertencia({
            asrId: entry.asrId,
            advertencia: res.error,
            yStatement: "",
            textoLibre: (textoLibre[entry.asrId] ?? "").trim(),
          });
          return false;
        }
        useNotificationStore.getState().notify("error", res.error);
        return false;
      }
      await Promise.all([loadStatus(), refrescarEstadoRemoto()]);
      setSeleccion((s) => {
        const next = { ...s };
        delete next[entry.asrId];
        return next;
      });
      setTextoLibre((t) => {
        const next = { ...t };
        delete next[entry.asrId];
        return next;
      });
      return true;
    } catch (err) {
      useNotificationStore.getState().notify(
        "error",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    } finally {
      setConfirmando(null);
    }
  };

  const confirmar = async (entry: TacticStatusEntry) => {
    if (!synthesisPath) return;
    const analysis = analisis[entry.asrId];
    if (!analysis) return;
    const sel = seleccion[entry.asrId];
    if (sel === undefined) return;

    if (sel === "libre") {
      const texto = (textoLibre[entry.asrId] ?? "").trim();
      if (!texto) return;
      const active = resolveActiveWorktree();
      if (!active) {
        useNotificationStore.getState().notify("error", "No hay un proyecto activo.");
        return;
      }
      setConfirmando(entry.asrId);
      try {
        const v = await window.termcanvas.interview.validateTacticText(
          active.path,
          synthesisPath,
          entry.asrId,
          texto,
        );
        if (!v.ok) {
          useNotificationStore.getState().notify("error", v.error);
          return;
        }
        if (v.data.aparta_de_restriccion) {
          setAdvertencia({
            asrId: entry.asrId,
            advertencia: v.data.advertencia ?? "La decisión parece apartarse de una restricción global.",
            yStatement: v.data.y_statement,
            textoLibre: texto,
          });
          return;
        }
        await confirmarConPayload(entry, {
          synthesisPath,
          asrId: entry.asrId,
          tipo: "libre",
          analysis,
          textoLibre: texto,
          yStatementLibre: v.data.y_statement,
          conflictosInvolucrados: conflictsFor(entry.asrId),
          conflictosAceptados: conflictsFor(entry.asrId).length > 0,
        });
      } finally {
        setConfirmando(null);
      }
      return;
    }

    await confirmarConPayload(entry, {
      synthesisPath,
      asrId: entry.asrId,
      tipo: "candidata",
      analysis,
      candidataIndex: sel,
      conflictosInvolucrados: conflictsFor(entry.asrId),
      // Confirmar con conflicto visible = aceptación consciente: el ADR lo
      // registra en Consecuencias, no solo en el header.
      conflictosAceptados: conflictsFor(entry.asrId).length > 0,
    });
  };

  const confirmarAdvertencia = async () => {
    if (!advertencia || !synthesisPath) return;
    const entry = genuinos.find((g) => g.asrId === advertencia.asrId);
    const analysis = analisis[advertencia.asrId];
    if (!entry || !analysis) {
      setAdvertencia(null);
      return;
    }
    const ok = await confirmarConPayload(entry, {
      synthesisPath,
      asrId: advertencia.asrId,
      tipo: "libre",
      analysis,
      textoLibre: advertencia.textoLibre,
      ...(advertencia.yStatement.trim() ? { yStatementLibre: advertencia.yStatement } : {}),
      advertenciaConfirmada: true,
      conflictosInvolucrados: conflictsFor(advertencia.asrId),
      conflictosAceptados: conflictsFor(advertencia.asrId).length > 0,
    });
    if (ok) setAdvertencia(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (synthLoading) return <SynthLoading />;
  if (!hasSynthesis) return <NoSynthesis />;

  const hayAnalisisPendienteDeCTA = run.phase === "idle" && Object.keys(analisis).length === 0;

  return (
    <>
      <div className="space-y-4">
        <SearchHeader
          label="Tácticas de arquitectura por ASR"
          count={`${visibles.length} de ${genuinos.length} ASR genuinos`}
          placeholder="Buscar ASR…"
          actions={
            <button
              type="button"
              className="btn btn-primary min-h-[30px] px-3 text-xs font-semibold"
              onClick={() => void runAnalysis()}
              disabled={run.phase === "running" || genuinos.length === 0}
              title={
                genuinos.length === 0
                  ? "No hay restricciones arquitectónicas genuinas en este proyecto todavía"
                  : undefined
              }
            >
              {run.phase === "running"
                ? "Analizando…"
                : hayAnalisisPendienteDeCTA
                  ? "Analizar tácticas de arquitectura"
                  : "Re-analizar tácticas"}
            </button>
          }
        />

        {/* Sin ASR genuinos: aviso explícito (el botón queda deshabilitado). */}
        {genuinos.length === 0 && (
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            No hay restricciones arquitectónicas genuinas en este proyecto todavía — las preferencias
            de UX no requieren esta disciplina. Marcá un ASR como genuino en su sección para habilitar
            el análisis.
          </p>
        )}

        {/* Fallo global del análisis: banner visible con reintento (nunca silencioso). */}
        {run.phase === "error" && (
          <div className="w-full p-3 rounded-md bg-[var(--red-soft)] border border-red-500/30 text-[11px] text-[var(--text-primary)] space-y-2">
            <div className="flex items-start gap-2">
              <AlertIcon />
              <p className="leading-snug">{run.error}</p>
            </div>
            <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => void runAnalysis()}>
              Reintentar
            </button>
          </div>
        )}

        {run.phase === "running" && (
          <div className="flex items-center gap-2.5 text-xs text-[var(--text-muted)]">
            <div className="w-4 h-4 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
            <span>
              Analizando en segundo plano — podés cerrar este modal o seguir trabajando: los resultados
              quedan acá al volver.
            </span>
          </div>
        )}

        {/* Fallo de la consolidación: las candidatas siguen usables, pero el aviso de conflicto no está disponible. */}
        {conflictosError && (
          <div className="w-full p-3 rounded-md bg-[var(--red-soft)] border border-red-500/30 text-[11px] text-[var(--text-primary)] space-y-2">
            <div className="flex items-start gap-2">
              <AlertIcon />
              <p className="leading-snug">
                No se pudo ejecutar la detección de conflictos entre tácticas recomendadas:{" "}
                {friendlyTacticsError(conflictosError)}
              </p>
            </div>
            <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => void retryConsolidacion()}>
              Reintentar consolidación
            </button>
          </div>
        )}

        {/* Conflictos detectados (ATAM tradeoff point): alerta NO bloqueante. */}
        {conflictos !== null && conflictos.length > 0 && (
          <div className="p-3 rounded-md bg-[var(--amber-soft)] border border-amber-500/30 space-y-1.5">
            <p className="text-[11px] font-semibold text-[var(--amber)]">
              {conflictos.length} conflicto{conflictos.length === 1 ? "" : "s"} entre tácticas recomendadas
            </p>
            {conflictos.map((c, i) => (
              <p key={i} className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                <span className="font-mono font-semibold">
                  {c.asr_a}/{c.tactica_a} ↔ {c.asr_b}/{c.tactica_b}
                </span>{" "}
                — {c.explicacion}
              </p>
            ))}
            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
              Podés confirmar igual si el trade-off vale la pena — quedará registrado como riesgo
              aceptado en las Consecuencias del ADR.
            </p>
          </div>
        )}

        {/* Tarjetas: una por ASR genuino visible según búsqueda. */}
        <div className="space-y-3">
          {visibles.map((entry) => {
            const analysis = analisis[entry.asrId];
            const errorAsr = erroresAnalisis[entry.asrId];
            const sel = seleccion[entry.asrId];
            const enConflicto = conflictsFor(entry.asrId);
            const meta = metaAnalisis[entry.asrId];
            const categoriaElegida = categoriaManual[entry.asrId] ?? meta?.categoriaUsada ?? "";
            return (
              <div key={entry.asrId} className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2 flex-wrap border-b border-[var(--border)] pb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[10.5px] font-semibold text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                      {entry.asrId}
                    </span>
                    <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate">{entry.atributo}</span>
                    {analysis && (
                      <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border)] shrink-0">
                        {analysis.categoria_atributo}
                      </span>
                    )}
                  </div>
                  {entry.adrActivo && (
                    <span
                      className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-400 border-emerald-500/20 shrink-0"
                      title={`${entry.adrActivo.adr} — ${entry.adrActivo.yStatement}`}
                    >
                      {entry.adrActivo.adr} · decisión activa
                    </span>
                  )}
                </div>

                {enConflicto.length > 0 && (
                  <p className="text-[10.5px] text-[var(--amber)] leading-relaxed">
                    En tensión con otra táctica recomendada ({enConflicto.map((c) => (c.asr_a === entry.asrId ? c.asr_b : c.asr_a)).join(", ")}) — ver detalle arriba.
                  </p>
                )}

                {entry.adrActivo && (
                  <blockquote className="p-2 rounded border-l-2 border-emerald-500/40 bg-[var(--surface)] text-[11px] text-[var(--text-secondary)] italic leading-relaxed">
                    {entry.adrActivo.yStatement}
                  </blockquote>
                )}

                {!analysis && !errorAsr && (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {run.phase === "running" ? "Analizando…" : "Sin análisis todavía."}
                  </p>
                )}

                {errorAsr && (
                  <div className="w-full p-2.5 rounded-md bg-[var(--red-soft)] border border-red-500/30 text-[11px] text-[var(--text-primary)] space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertIcon />
                      <p className="leading-snug">{errorAsr.mensaje}</p>
                    </div>
                    {errorAsr.sinCategoria && (
                      <p className="text-[10.5px] text-[var(--text-muted)] leading-relaxed">
                        Elegí la categoría del catálogo que corresponde a este atributo:
                      </p>
                    )}
                    {(errorAsr.sinCategoria || categoriaManual[entry.asrId]) && (
                      <select
                        className="textarea-minimal text-xs py-1.5 w-full"
                        value={categoriaElegida}
                        onChange={(e) =>
                          setCategoriaManual((m) => ({ ...m, [entry.asrId]: e.target.value }))
                        }
                      >
                        <option value="">— categoría del catálogo —</option>
                        {CATEGORIAS_TACTICAS.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORIA_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost text-xs py-1 min-h-[28px]"
                      disabled={errorAsr.sinCategoria && !categoriaElegida}
                      onClick={() => void retryOne(entry.asrId)}
                    >
                      Reintentar {entry.asrId}
                      {errorAsr.sinCategoria && categoriaElegida ? ` (${CATEGORIA_LABELS[categoriaElegida as keyof typeof CATEGORIA_LABELS] ?? categoriaElegida})` : ""}
                    </button>
                  </div>
                )}

                {/* Mapeo automático dudoso: aviso + re-mapeo manual opcional. */}
                {!errorAsr && meta && !meta.confiado && (
                  <div className="w-full p-2.5 rounded-md bg-[var(--amber-soft)] border border-amber-500/30 text-[11px] space-y-2">
                    <p className="text-[var(--amber)] leading-snug">
                      El atributo se mapeó a <span className="font-semibold">{CATEGORIA_LABELS[meta.categoriaUsada as keyof typeof CATEGORIA_LABELS] ?? meta.categoriaUsada}</span> con baja confianza — verificá si es la categoría correcta.
                    </p>
                    <div className="flex items-center gap-2">
                      <select
                        className="textarea-minimal text-xs py-1 flex-1"
                        value={categoriaManual[entry.asrId] ?? ""}
                        onChange={(e) =>
                          setCategoriaManual((m) => ({ ...m, [entry.asrId]: e.target.value }))
                        }
                      >
                        <option value="">— cambiar categoría y re-analizar —</option>
                        {CATEGORIAS_TACTICAS.filter((c) => c !== meta.categoriaUsada).map((c) => (
                          <option key={c} value={c}>
                            {CATEGORIA_LABELS[c]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost text-xs py-1 px-2.5 min-h-[28px] shrink-0 border border-[var(--border)]"
                        disabled={!categoriaManual[entry.asrId]}
                        onClick={() => void retryOne(entry.asrId)}
                      >
                        Re-analizar
                      </button>
                    </div>
                  </div>
                )}

                {analysis &&
                  analysis.candidatas.map((c, i) => {
                    const elegida = sel === i;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSeleccion((s) => ({ ...s, [entry.asrId]: i }))}
                        className={`w-full text-left p-2.5 rounded-md border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none space-y-1.5 ${
                          elegida
                            ? "border-[var(--accent)] ring-1 ring-[var(--accent)] bg-[var(--surface)]"
                            : "border-[var(--border)] hover:border-[var(--text-faint)] bg-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`w-3 h-3 rounded-full border shrink-0 ${elegida ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--text-faint)]"}`} />
                          <span className="text-[11.5px] font-semibold text-[var(--text-primary)]">{c.nombre_tactica}</span>
                          {c.es_recomendada && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                              Recomendada
                            </span>
                          )}
                          {c.es_unica_viable && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--border)]">
                              Única viable
                            </span>
                          )}
                        </div>
                        <p className="text-[10.5px] text-[var(--text-muted)] italic">{c.proposito}</p>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{c.argumentacion}</p>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                          <span className="font-semibold">Trade-offs: </span>
                          {c.trade_offs_para_este_proyecto}
                        </p>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                          <span className="font-semibold">Objetivo de negocio: </span>
                          {c.conexion_con_objetivo_de_negocio}
                        </p>
                        {!c.cumple_totalmente_la_restriccion && (c.que_se_sacrifica ?? "").trim() && (
                          <p className="text-[10.5px] text-[var(--amber)] leading-relaxed">
                            No cubre totalmente la restricción — sacrifica: {c.que_se_sacrifica}
                          </p>
                        )}
                      </button>
                    );
                  })}

                {analysis && (
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      className={`text-[10.5px] underline decoration-dotted cursor-pointer ${
                        sel === "libre" ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                      onClick={() =>
                        setSeleccion((s) => {
                          const next = { ...s };
                          if (s[entry.asrId] === "libre") delete next[entry.asrId];
                          else next[entry.asrId] = "libre";
                          return next;
                        })
                      }
                    >
                      {sel === "libre" ? "← volver a las candidatas" : "Ninguna me cierra — escribir decisión propia"}
                    </button>
                    {sel === "libre" && (
                      <textarea
                        rows={3}
                        className="textarea-minimal text-xs py-1.5 w-full"
                        placeholder="Tu decisión de arquitectura para este ASR…"
                        value={textoLibre[entry.asrId] ?? ""}
                        onChange={(e) => setTextoLibre((t) => ({ ...t, [entry.asrId]: e.target.value }))}
                      />
                    )}
                    <div className="flex items-center justify-end gap-2">
                      {sel !== undefined && sel !== "libre" && <CheckIcon />}
                      <button
                        type="button"
                        className="btn btn-primary text-xs py-1 px-3 min-h-[32px] font-semibold"
                        disabled={sel === undefined || confirmando === entry.asrId || (sel === "libre" && !(textoLibre[entry.asrId] ?? "").trim())}
                        onClick={() => void confirmar(entry)}
                      >
                        {confirmando === entry.asrId
                          ? "Escribiendo ADR…"
                          : entry.adrActivo
                            ? `Confirmar decisión (supersede ${entry.adrActivo.adr})`
                            : "Confirmar decisión"}
                      </button>
                    </div>
                    {entry.adrActivo && (
                      <p className="text-[10px] text-[var(--text-muted)] text-right">
                        Re-confirmar crea un ADR nuevo; el anterior queda marcado como superseded (nunca se edita).
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Overlay: advertencia de decisión propia vs restricciones (no bloqueante). */}
      {advertencia &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--scrim)] p-4"
            onClick={() => setAdvertencia(null)}
          >
            <div
              className="w-[460px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xs font-semibold text-[var(--amber)] flex items-center gap-2">
                <AlertIcon />
                Tu decisión parece apartarse de una restricción
              </h3>
              <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">{advertencia.advertencia}</p>
              <p className="text-[10.5px] text-[var(--text-muted)] leading-relaxed">
                Podés confirmar igual — seguís siendo la autoridad final. Quedará registrado en el ADR.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setAdvertencia(null)}>
                  Volver
                </button>
                <button
                  type="button"
                  className="btn btn-primary text-xs py-1 min-h-[32px] font-semibold"
                  disabled={confirmando === advertencia.asrId}
                  onClick={() => void confirmarAdvertencia()}
                >
                  {confirmando === advertencia.asrId ? "Escribiendo ADR…" : "Es intencional — confirmar"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
