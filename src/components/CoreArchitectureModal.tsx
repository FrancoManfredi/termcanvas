import { useEffect, useRef, useState } from "react";
import { RepoContextModal } from "./RepoContextModal";
import { InterviewModal } from "./InterviewModal";
import { JsonCodeBlock } from "./JsonCodeBlock";
import { PlannerTerminalPane } from "./PlannerTerminalPane";
import { useRepoContextStore } from "../stores/repoContextStore";
import { useInterviewStore } from "../stores/interviewStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import {
  resolveActiveWorktree,
} from "../planner/planningSession";
import type { AuditPlan } from "../types/issuePlanning.ts";
import type { SynthesisResult } from "../../headless-runtime/interview/index.ts";
import {
  useDiagnosisStore,
} from "../stores/diagnosisStore";
import {
  MOCK_PLAN_LOG_LINES,
  MOCK_PLAN_RESULT,
} from "./planningMockData.ts";

// Modal UNIFICADO de arquitectura (Figma: "Replicate Modal Dialog Design").
// Reemplaza a los dos modales separados de la toolbar: contexto del
// repositorio (Fase 0), entrevista de requerimientos (IA), y las secciones
// POST entrevista — requerimientos funcionales, atributos de calidad/ASR,
// restricciones globales y glosario — alimentadas con la SÍNTESIS REAL de
// la última entrevista completada (ledger.synthesis), más la conversión a
// GitHub Issues (github.createIssue, labels existentes del repo).
//
// La lógica del motor no vive acá: las entrevistas la corren los stores
// existentes (useRepoContextStore / useInterviewStore) y este modal solo
// las EMBEBE en modo inline + agrega las vistas de resultados.

export type CoreSubcategory =
  | "repo_context"
  | "requirements_interview"
  | "functional_requirements"
  | "quality_attributes"
  | "constraints"
  | "glossary"
  | "planning_diagnosis"
  | "planning_roadmap"
  | "github_issues";

interface ConvertibleItem {
  id: string;
  title: string;
  body: string;
  categoryLabel: string;
  priorityTag: string;
  githubLabels: string[];
  // Id del diagnóstico de origen (filtro FUENTE — DIAGNÓSTICO) y
  // archivo/línea del hallazgo (diseño v2).
  diagId?: string;
  fileLine?: string;
}

type IssueStatus =
  | { status: "pending" }
  | { status: "converting" }
  | { status: "converted"; issueNumber: number; url: string };

function makeDiagStats(findings: AuditPlan["findings"]) {
  return {
    uniqueFiles: new Set(findings.map((f) => f.file)).size,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    total: findings.length,
  };
}

// Orden de criticidad para la lista de hallazgos: críticos primero, después
// high, medium y low (estable para severidades desconocidas).
const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function sortFindingsBySeverity(findings: AuditPlan["findings"]): AuditPlan["findings"] {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
  );
}

// ─── Iconos (mismos SVG que el diseño) ──────────────────────────────────

const CloseXIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </svg>
);

const DocumentTextIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 1-2 2v16a2 2 0 0 1 2 2h12a2 2 0 0 1 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </svg>
);

const RequirementsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6"></line>
    <line x1="8" y1="12" x2="21" y2="12"></line>
    <line x1="8" y1="18" x2="21" y2="18"></line>
    <line x1="3" y1="6" x2="3.01" y2="6"></line>
    <line x1="3" y1="12" x2="3.01" y2="12"></line>
    <line x1="3" y1="18" x2="3.01" y2="18"></line>
  </svg>
);

const QualityIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
  </svg>
);

const ConstraintsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
  </svg>
);

const GlossaryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
  </svg>
);

const GitHubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
    <path d="M9 18c-4.51 2-5-2-7-2"></path>
  </svg>
);

// Icono de Diagnóstico (estetoscopio/lupa sobre repo) — del diseño v2.
const DiagnosisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v18h18"></path>
    <path d="M7 14l3-3 3 2 4-5"></path>
  </svg>
);

// Icono de Planificador (ruta con hitos) — del diseño v2.
const PlannerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

// ─── Terminal de sesión opencode con streaming simulado (diseño v2) ──────
// Terminal FALSA: pinta líneas de log en streaming para comunicar la
// actividad de la sesión mientras el diagnóstico/planificador corren en
// modo simulado (mock por ahora, sin sesión real de opencode).

function OpencodeterminalSession({
  logLines,
  active,
}: {
  logLines: string[];
  active: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (!active) {
      setVisibleCount(0);
      return;
    }
    setVisibleCount(1);
    let i = 1;
    const interval = setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= logLines.length) clearInterval(interval);
    }, 260);
    return () => clearInterval(interval);
  }, [active, logLines.length]);

  return (
    <div className="font-mono text-[11px] bg-[var(--bg)] border border-[var(--border)] rounded-md p-3.5 space-y-1 overflow-hidden">
      {logLines.slice(0, visibleCount).map((line, i) => {
        const isCmd = line.startsWith(">");
        const isWarn = line.includes("⚠");
        const isOk = line.includes("✓");
        const isRunning = line.includes("⚡");
        const cls = isCmd
          ? "text-[var(--accent)] font-semibold"
          : isWarn
            ? "text-amber-400"
            : isOk
              ? "text-emerald-400"
              : isRunning
                ? "text-[var(--text-secondary)] animate-pulse"
                : "text-[var(--text-muted)]";
        return (
          <div key={i} className={`leading-snug ${cls}`}>
            {line}
          </div>
        );
      })}
      {active && visibleCount < logLines.length && (
        <span className="inline-block w-2 h-3.5 bg-[var(--accent)] opacity-80 animate-pulse rounded-sm align-middle" />
      )}
    </div>
  );
}

function CollapsibleJson({
  label,
  data,
  open,
  onToggle,
}: {
  label: string;
  data: object;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <span>{label}</span>
        <span className="text-[10px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)]">
          <JsonCodeBlock data={data} maxHeight="256px" />
        </div>
      )}
    </div>
  );
}

// ─── Construcción de títulos/cuerpos/labels para GitHub ─────────────────

export function CoreArchitectureModal({
  isOpen,
  onClose,
  projectName,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectName?: string;
}) {
  const [activeSubcategory, setActiveSubcategory] = useState<CoreSubcategory>("functional_requirements");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Resultados de la última entrevista completada (ledger.synthesis).
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const [projectTitle, setProjectTitle] = useState(projectName ?? "");

  // GitHub Issues
  const [issueState, setIssueState] = useState<Record<string, IssueStatus>>({});
  const [selectedForIssue, setSelectedForIssue] = useState<string[]>([]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);

  // ── Planning: Diagnóstico (auditoría REAL) y Planificador (roadmap MOCK) ─
  // El estado de la sesión de diagnóstico (phase, runtime, historial, error)
  // vive en diagnosisStore a nivel módulo: cerrar el modal NO la cancela, la
  // sesión sigue de fondo y el resultado se agrega al historial igual.
  const diagPhase = useDiagnosisStore((s) => s.phase);
  const diagSessionRuntime = useDiagnosisStore((s) => s.sessionRuntime);
  const diagError = useDiagnosisStore((s) => s.error);
  const diagHistory = useDiagnosisStore((s) => s.history);
  const diagLatestId = useDiagnosisStore((s) => s.latestDiagnosisId);
  const diagToolsDone = useDiagnosisStore((s) => s.toolsDone);
  const diagToolsSummary = useDiagnosisStore((s) => s.toolsSummary);
  const [viewingDiagId, setViewingDiagId] = useState<string | null>(null);
  const [diagJsonOpen, setDiagJsonOpen] = useState(false);
  const [deletingDiag, setDeletingDiag] = useState<{
    id: string;
    filename: string;
  } | null>(null);
  const [planJsonOpen, setPlanJsonOpen] = useState(false);
  const [githubDiagFilter, setGithubDiagFilter] = useState<string>("all");

  // Un diagnóstico terminado (en primer plano o de fondo) se consume una
  // sola vez: la primera apertura del modal muestra su detalle.
  useEffect(() => {
    if (!isOpen) return;
    const latest = useDiagnosisStore.getState().takeLatestId();
    if (latest) {
      setViewingDiagId(latest);
      setDiagJsonOpen(false);
    }
  }, [isOpen, diagLatestId]);

  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useBodyScrollLock(isOpen);

  const interviewPhase = useInterviewStore((s) => s.phase);

  // Carga la síntesis de la entrevista ACTIVA del proyecto (la que el usuario
  // eligió en el pick phase); sin selección, la última completada.
  const loadSynthesis = async (projectPath: string) => {
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
            return;
          }
        } catch {
          // Ledger corrupto: probar con la siguiente entrevista.
        }
      }
      setSynthesis(null);
    } catch {
      setSynthesis(null);
    } finally {
      setSynthLoading(false);
    }
  };

  // Al abrir: inicializa los stores de las entrevistas (como hacían los dos
  // botones de la toolbar) y carga los resultados post-entrevista.
  useEffect(() => {
    if (!isOpen) return;
    lastActiveElementRef.current = document.activeElement as HTMLElement;
    const active = resolveActiveWorktree();
    if (!active) return;
    setProjectTitle(projectName ?? active.path.split(/[\\/]/).pop() ?? active.path);
    void useRepoContextStore.getState().openModal(active.path);
    void useInterviewStore.getState().openModal();
    void loadSynthesis(active.path);
    // Sincroniza el historial de diagnósticos con los JSON reales de
    // <repo>/.agents/planning/ (diagnostico-<ts>.json + plan-<ts>.json
    // legacy con mode audit).
    void useDiagnosisStore.getState().loadHistory(active.path);
    void window.termcanvas.github
      .listLabels(active.path)
      .then((res) => setAvailableLabels(res.ok ? res.labels.map((l) => l.name) : []))
      .catch(() => setAvailableLabels([]));
    return () => {
      if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === "function") {
        lastActiveElementRef.current.focus();
      }
    };
  }, [isOpen, projectName]);

  // Al terminar la entrevista de requerimientos, refresca la síntesis para
  // que las secciones post-entrevista muestren los resultados al instante.
  useEffect(() => {
    if (interviewPhase === "done") {
      const active = resolveActiveWorktree();
      if (active) void loadSynthesis(active.path);
    }
  }, [interviewPhase]);

  // Al cambiar la entrevista ACTIVA (pick phase del InterviewModal), las
  // secciones post-entrevista muestran la síntesis de la nueva activa.
  const activeInterviewPath = useInterviewStore((s) => s.activeInterviewPath);
  useEffect(() => {
    const active = resolveActiveWorktree();
    if (active) void loadSynthesis(active.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInterviewPath]);

  // Escape cierra; Tab queda atrapado dentro del modal (diseño).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubcategoryChange = (sub: CoreSubcategory) => {
    setActiveSubcategory(sub);
    setSearch("");
    // Al salir del detalle de un diagnóstico se vuelve a la lista; y si el
    // usuario navega a otra sección, el filtro de GitHub por diagnóstico
    // no debe quedar colgado apuntando a un diagnóstico ya no visible.
    setViewingDiagId(null);
    if (sub !== "github_issues") setGithubDiagFilter("all");
  };

  // ── Planning (diagnóstico REAL — planificador sigue MOCK) ─────────────
  // El Diagnóstico lanza una sesión REAL y headless de opencode
  // (launchPlanningSessionForActiveWorktree con mode "audit"): `opencode
  // run <prompt> --auto`, sin TUI. El runtime spawnea el proceso, el pane
  // muestra su output en streaming, y el poller de la sesión resuelve
  // cuando aparece .agents/planning/diagnostico-*.json (o si el proceso
  // termina con error). El Planificador (roadmap) sigue simulado con
  // planningMockData.ts.
  //
  // El estado vive en diagnosisStore (nivel módulo): cerrar el modal NO
  // cancela la sesión; sigue corriendo de fondo y el resultado se agrega
  // al historial igual. El botón Cancelar del running view la detiene.

  // Estado de la simulación del planificador.
  const [planRun, setPlanRun] = useState<{
    phase: "idle" | "running" | "done";
  }>({ phase: "idle" });

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

  // ── Datos reales de la síntesis ────────────────────────────────────────
  const requirements = synthesis?.requerimientos_funcionales ?? [];
  const qualityAttributes = synthesis?.atributos_de_calidad_y_asrs ?? [];
  const constraints = synthesis?.restricciones_globales ?? [];
  const glossaryEntries = Object.entries(synthesis?.glosario_de_terminos ?? {});
  const hasSynthesis = synthesis !== null;

  const filteredRequirements = requirements.filter(
    (r) =>
      r.descripcion.toLowerCase().includes(search.toLowerCase()) ||
      r.justificacion.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.origen.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredQuality = qualityAttributes.filter(
    (q) =>
      q.atributo.toLowerCase().includes(search.toLowerCase()) ||
      q.justificacion_arquitectonica.toLowerCase().includes(search.toLowerCase()) ||
      q.id.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredConstraints = constraints.filter(
    (c) =>
      c.tipo.toLowerCase().includes(search.toLowerCase()) ||
      c.descripcion.toLowerCase().includes(search.toLowerCase()) ||
      c.impacto.toLowerCase().includes(search.toLowerCase()) ||
      c.id.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredGlossary = glossaryEntries.filter(
    ([term, def]) =>
      term.toLowerCase().includes(search.toLowerCase()) ||
      def.toLowerCase().includes(search.toLowerCase()),
  );

  // Los issues SOLO se crean a partir de Planning: los hallazgos de los
  // diagnósticos completados (diseño v2), ordenados por criticidad.
  // RFs/ASRs/restricciones/glosario se ven en sus secciones, NO como issues.
  const convertibleItems: ConvertibleItem[] = diagHistory.flatMap((rec) =>
    sortFindingsBySeverity(rec.data.findings).map((finding, idx) => ({
      id: `${rec.id}::${idx}`,
      title: finding.title,
      body: finding.description,
      categoryLabel: "Hallazgo de diagnóstico",
      priorityTag: finding.severity,
      githubLabels: [`severity: ${finding.severity}`, ...(finding.labels ?? [])],
      diagId: rec.id,
      fileLine: `${finding.file}:${finding.line}`,
    })),
  );

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      useNotificationStore.getState().notify("error", "Could not copy to clipboard.");
    }
  };

  // ── GitHub Issues (REAL: github.createIssue con labels existentes) ────
  const convertToIssue = async (id: string) => {
    const item = convertibleItems.find((i) => i.id === id);
    if (!item) return;
    setIssueState((prev) => ({ ...prev, [id]: { status: "converting" } }));
    try {
      const active = resolveActiveWorktree();
      if (!active) throw new Error("Open a project first.");
      const labels = item.githubLabels.filter((l) => availableLabels.includes(l));
      const res = await window.termcanvas.github.createIssue(active.path, item.title, item.body, labels);
      if (!res.ok) throw new Error(res.error);
      setIssueState((prev) => ({
        ...prev,
        [id]: { status: "converted", issueNumber: res.number, url: res.url },
      }));
    } catch (err) {
      setIssueState((prev) => ({ ...prev, [id]: { status: "pending" } }));
      useNotificationStore
        .getState()
        .notify("error", err instanceof Error ? err.message : "Could not create the issue.");
    }
  };

  const handleToggleSelectForIssue = (id: string) => {
    setSelectedForIssue((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const handleSelectAllForIssue = (allIds: string[]) => {
    if (selectedForIssue.length === allIds.length) setSelectedForIssue([]);
    else setSelectedForIssue(allIds);
  };

  const handleConvertBatch = () => {
    if (selectedForIssue.length === 0) return;
    for (const id of selectedForIssue) {
      const st = issueState[id];
      if (!st || st.status !== "converted") void convertToIssue(id);
    }
  };

  // ── Vista vacía post-entrevista ────────────────────────────────────────
  const renderNoSynthesis = () => (
    <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
      <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center border border-[var(--border)]">
        <DocumentTextIcon />
      </div>
      <div className="space-y-1 max-w-sm">
        <h3 className="text-xs font-semibold text-[var(--text-primary)]">Todavía no hay resultados</h3>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          Completá la entrevista de requerimientos (RFs, ASRs, restricciones, glosario) o un diagnóstico del repositorio
          para habilitar la conversión a GitHub Issues.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary min-h-[38px] px-4 text-xs font-semibold"
        onClick={() => handleSubcategoryChange("planning_diagnosis")}
      >
        Ir a Diagnóstico →
      </button>
    </div>
  );

  const renderSearchHeader = (label: string, count: string, placeholder: string) => (
    <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
      <input
        type="text"
        aria-label={label}
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="textarea-minimal text-xs py-1.5 max-w-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      />
      <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">{count}</span>
    </div>
  );

  // ── Sidebar ────────────────────────────────────────────────────────────
  const sidebarBtnClass = (active: boolean) =>
    `w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
      active
        ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
    }`;

  const sidebarItem = (
    sub: CoreSubcategory,
    icon: React.ReactNode,
    label: string,
    badge: string,
  ) => (
    <button
      type="button"
      aria-current={activeSubcategory === sub ? "page" : undefined}
      className={sidebarBtnClass(activeSubcategory === sub)}
      onClick={() => handleSubcategoryChange(sub)}
    >
      <div className="flex items-center gap-2 truncate">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <span className="text-[9.5px] font-mono shrink-0 tabular-nums">{badge}</span>
    </button>
  );

  const filteredIssueItems = convertibleItems.filter((item) => {
    const matchesSearch =
      item.id.toLowerCase().includes(search.toLowerCase()) ||
      item.title.toLowerCase().includes(search.toLowerCase());
    const matchesDiag =
      githubDiagFilter === "all" || item.diagId === githubDiagFilter;
    return matchesSearch && matchesDiag;
  });

  const allFilteredIds = filteredIssueItems.map((i) => i.id);
  const isAllSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedForIssue.includes(id));

  return (
    <div
      className="modal-scrim p-4 flex items-center justify-center z-[250] overscroll-contain"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="core-modal-title"
    >
      {/* Live region for screen reader notifications */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {copiedId ? `Elemento ${copiedId} copiado al portapapeles` : ""}
      </div>

      {/* Contenedor único 92vw x 90vh — sin scrims anidados */}
      <div
        ref={modalRef}
        className="w-[92vw] max-w-[1400px] h-[90vh] max-h-[900px] bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl flex overflow-hidden tc-enter relative"
      >
        {/* Sidebar de navegación */}
        <aside className="w-64 bg-[var(--bg)] border-r border-[var(--border)] flex flex-col justify-between p-4 shrink-0 overflow-y-auto">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                ENTREVISTAS
              </span>
              <nav className="space-y-1" aria-label="Navegación de Entrevistas">
                {sidebarItem("repo_context", <ChatBubbleIcon />, "Contexto del Repositorio", "Fase 0")}
                {sidebarItem("requirements_interview", <DocumentTextIcon />, "Entrevista de Requerimientos", "IA")}
              </nav>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
              <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                POST ENTREVISTAS
              </span>
              <nav className="space-y-1" aria-label="Navegación Post Entrevistas">
                {sidebarItem("functional_requirements", <RequirementsIcon />, "Requerimientos Funcionales", String(requirements.length))}
                {sidebarItem("quality_attributes", <QualityIcon />, "Atributos de Calidad (ASR)", String(qualityAttributes.length))}
                {sidebarItem("constraints", <ConstraintsIcon />, "Restricciones Globales", String(constraints.length))}
                {sidebarItem("glossary", <GlossaryIcon />, "Glosario del Proyecto", String(glossaryEntries.length))}
              </nav>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
              <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                PLANNING
              </span>
              <nav className="space-y-1" aria-label="Navegación de Planning">
                {sidebarItem("planning_diagnosis", <DiagnosisIcon />, "Diagnóstico", "Repo")}
                {sidebarItem("planning_roadmap", <PlannerIcon />, "Planificador", "Roadmap")}
              </nav>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-[var(--border)]">
              <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                INTEGRACIONES
              </span>
              <nav className="space-y-1" aria-label="Navegación de Integraciones">
                {sidebarItem("github_issues", <GitHubIcon />, "GitHub Issues", "IA")}
              </nav>
            </div>
          </div>
        </aside>

        {/* Panel principal */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--surface)]">
          <header className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)]/50 shrink-0">
            <h2 id="core-modal-title" className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {projectTitle}
            </h2>
            <button
              type="button"
              className="icon-btn text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
              onClick={onClose}
              aria-label="Cerrar modal"
            >
              <CloseXIcon />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5">
            {/* 1. Contexto del Repositorio INLINE */}
            {activeSubcategory === "repo_context" && (
              <div className="w-full space-y-4">
                <RepoContextModal isInline />
              </div>
            )}

            {/* 2. Entrevista de Requerimientos INLINE */}
            {activeSubcategory === "requirements_interview" && (
              <div className="w-full space-y-4">
                <InterviewModal
                  isInline
                  onClose={onClose}
                  onViewResults={() => handleSubcategoryChange("functional_requirements")}
                  onOpenContextModal={() => handleSubcategoryChange("repo_context")}
                />
              </div>
            )}

            {/* 3. Requerimientos Funcionales */}
            {activeSubcategory === "functional_requirements" &&
              (synthLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
                  <p className="text-xs text-[var(--text-muted)]">Cargando resultados…</p>
                </div>
              ) : !hasSynthesis ? (
                renderNoSynthesis()
              ) : (
                <div className="space-y-4">
                  {renderSearchHeader(
                    "Buscar requerimientos funcionales",
                    `${filteredRequirements.length} requerimientos funcionales`,
                    "Buscar requerimiento…",
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                    {filteredRequirements.map((req) => (
                      <div
                        key={req.id}
                        className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 flex flex-col justify-between text-xs"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10.5px] font-semibold text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                              {req.id}
                            </span>
                            <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-[var(--red-soft)] text-[var(--red)] border-red-500/20">
                              {req.prioridad}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{req.descripcion}</p>
                          <div className="space-y-0.5 pt-1 border-t border-[var(--border)]">
                            <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                              JUSTIFICACIÓN
                            </span>
                            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{req.justificacion}</p>
                          </div>
                          <div className="space-y-0.5">
                            <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                              CRITERIO DE AJUSTE
                            </span>
                            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{req.criterio_de_ajuste}</p>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                          <span className="truncate max-w-[200px]" title={`Origen: ${req.origen}`}>
                            Origen: {req.origen}
                          </span>
                          <button
                            type="button"
                            className="hover:text-[var(--text-primary)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                            onClick={() => handleCopy(`${req.id}: ${req.descripcion}\nJustificación: ${req.justificacion}`, req.id)}
                            aria-label={`Copiar requerimiento ${req.id}`}
                            title={`Copiar requerimiento ${req.id}`}
                          >
                            {copiedId === req.id ? <CheckIcon /> : <CopyIcon />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

            {/* 4. Atributos de Calidad (ASR) */}
            {activeSubcategory === "quality_attributes" &&
              (synthLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
                  <p className="text-xs text-[var(--text-muted)]">Cargando resultados…</p>
                </div>
              ) : !hasSynthesis ? (
                renderNoSynthesis()
              ) : (
                <div className="space-y-4">
                  {renderSearchHeader(
                    "Buscar atributos de calidad",
                    `${filteredQuality.length} atributos ASR`,
                    "Buscar atributo de calidad…",
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {filteredQuality.map((q) => (
                      <div key={q.id} className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 text-xs">
                        <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10.5px] font-semibold text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                              {q.id}
                            </span>
                            <span
                              className={`text-[9.5px] font-semibold px-2 py-0.5 rounded ${
                                q.es_asr_genuino
                                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                                  : "bg-[var(--accent-soft)] text-[var(--accent)]"
                              }`}
                            >
                              {q.es_asr_genuino ? "ASR Genuino" : "Preferencia UX / Calidad"}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="hover:text-[var(--text-primary)] text-[var(--text-muted)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
                            onClick={() => handleCopy(`${q.id}: ${q.atributo}\n${q.justificacion_arquitectonica}`, q.id)}
                            aria-label={`Copiar atributo de calidad ${q.id}`}
                            title={`Copiar ASR ${q.id}`}
                          >
                            {copiedId === q.id ? <CheckIcon /> : <CopyIcon />}
                          </button>
                        </div>

                        <h3 className="text-xs font-bold text-[var(--text-primary)]">{q.atributo}</h3>

                        <div className="space-y-0.5">
                          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                            JUSTIFICACIÓN ARQUITECTÓNICA
                          </span>
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{q.justificacion_arquitectonica}</p>
                        </div>

                        <div className="p-2.5 rounded bg-[var(--surface)] border border-[var(--border)] space-y-1.5 text-[10.5px]">
                          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                            ESCENARIO TÉCNICO (6 PARTES)
                          </span>
                          <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                            <div>
                              <span className="text-[var(--text-muted)] block">Fuente:</span>
                              <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.fuente}</span>
                            </div>
                            <div>
                              <span className="text-[var(--text-muted)] block">Estímulo:</span>
                              <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.estimulo}</span>
                            </div>
                            <div>
                              <span className="text-[var(--text-muted)] block">Artefacto:</span>
                              <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.artefacto}</span>
                            </div>
                            <div>
                              <span className="text-[var(--text-muted)] block">Entorno:</span>
                              <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.entorno}</span>
                            </div>
                            <div>
                              <span className="text-[var(--text-muted)] block">Respuesta:</span>
                              <span className="text-[var(--text-primary)] font-medium">{q.escenario_tecnico_6_partes.respuesta}</span>
                            </div>
                            <div>
                              <span className="text-[var(--text-muted)] block">Medida de respuesta:</span>
                              <span className="text-[var(--accent)] font-mono font-semibold">{q.escenario_tecnico_6_partes.medida_de_respuesta}</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-0.5 pt-1 border-t border-[var(--border)]">
                          <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
                            TRADE-OFFS IDENTIFICADOS
                          </span>
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{q.trade_offs_identificados}</p>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] block pt-0.5">Origen: {q.origen}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

            {/* 5. Restricciones Globales */}
            {activeSubcategory === "constraints" &&
              (synthLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
                  <p className="text-xs text-[var(--text-muted)]">Cargando resultados…</p>
                </div>
              ) : !hasSynthesis ? (
                renderNoSynthesis()
              ) : (
                <div className="space-y-4">
                  {renderSearchHeader(
                    "Buscar restricciones globales",
                    `${filteredConstraints.length} restricciones globales`,
                    "Buscar restricción…",
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                    {filteredConstraints.map((c) => (
                      <div
                        key={c.id}
                        className="p-3.5 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-2.5 flex flex-col justify-between text-xs"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] font-semibold text-[var(--amber)] bg-[var(--amber-soft)] px-2 py-0.5 rounded border border-amber-500/20 uppercase tracking-wider">
                              {c.tipo}
                            </span>
                            <span className="font-mono text-[10.5px] font-semibold text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                              {c.id}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-[var(--text-primary)] leading-relaxed">{c.descripcion}</p>
                          <div className="p-2.5 rounded bg-[var(--red-soft)] border border-red-500/20 text-[11px] text-[var(--text-primary)] space-y-0.5">
                            <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--red)] font-semibold block">
                              ⚠ IMPACTO EN DISEÑO
                            </span>
                            <p className="leading-snug">{c.impacto}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

            {/* 6. Glosario del Proyecto */}
            {activeSubcategory === "glossary" &&
              (synthLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
                  <p className="text-xs text-[var(--text-muted)]">Cargando resultados…</p>
                </div>
              ) : !hasSynthesis ? (
                renderNoSynthesis()
              ) : (
                <div className="space-y-4">
                  {renderSearchHeader(
                    "Buscar términos en el glosario",
                    `${filteredGlossary.length} términos registrados`,
                    "Buscar término en el glosario…",
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {filteredGlossary.map(([term, definition], idx) => (
                      <div key={idx} className="p-3 rounded-md border border-[var(--border)] bg-[var(--bg)] space-y-1 text-xs">
                        <h3 className="text-xs font-bold text-[var(--text-primary)] font-mono">{term}</h3>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{definition}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

            {/* ── PLANNING: Diagnóstico (auditoría real) ────────────────────── */}
            {activeSubcategory === "planning_diagnosis" && (() => {
              // Vista detalle de un diagnóstico del historial.
              if (viewingDiagId !== null) {
                const rec = diagHistory.find((d) => d.id === viewingDiagId);
                if (!rec) {
                  setViewingDiagId(null);
                  return null;
                }
                const stats = makeDiagStats(rec.data.findings);
                return (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        onClick={() => {
                          setViewingDiagId(null);
                          setDiagJsonOpen(false);
                        }}
                      >
                        <span>←</span>
                        <span>Volver al diagnóstico</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] flex items-center gap-1.5"
                        onClick={() => {
                          handleSubcategoryChange("github_issues");
                          setGithubDiagFilter(rec.id);
                        }}
                      >
                        <GitHubIcon />
                        <span>Ver en GitHub Issues →</span>
                      </button>
                    </div>

                    <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-500/8 border border-emerald-500/25">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-sm shrink-0 mt-0.5">✓</div>
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-emerald-400">Diagnóstico completado</p>
                        <p className="text-[10.5px] font-mono text-[var(--text-muted)]">{rec.repo}</p>
                        <p className="text-[10px] font-mono text-[var(--text-muted)]">{rec.filename} · {rec.timestamp}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          label: "% Cobertura",
                          value:
                            rec.toolCoverage?.pct != null
                              ? `${rec.toolCoverage.pct}%`
                              : "—",
                          sub:
                            rec.toolCoverage?.packages?.length
                              ? rec.toolCoverage.packages
                                  .map((p) =>
                                    p.scanned != null
                                      ? `${p.scanned}/${p.files} ${p.name}`
                                      : `${p.name}: sin herramienta de archivos`,
                                  )
                                  .join(" · ")
                              : undefined,
                        },
                        { label: "Hallazgos", value: stats.total },
                        { label: "Issues críticos", value: stats.critical, highlight: true },
                        { label: "Archivos con issues", value: stats.uniqueFiles },
                      ].map(({ label, value, sub, highlight }) => (
                        <div key={label} className={`p-3 rounded-md border text-center space-y-0.5 ${highlight ? "bg-red-500/8 border-red-500/25" : "bg-[var(--bg)] border-[var(--border)]"}`}>
                          <p className={`text-base font-bold font-mono tabular-nums ${highlight ? "text-red-400" : "text-[var(--text-primary)]"}`}>{value}</p>
                          <p className="text-[10px] text-[var(--text-muted)] leading-tight">{label}</p>
                          {sub && <p className="text-[9px] font-mono text-[var(--text-muted)] leading-tight">{sub}</p>}
                        </div>
                      ))}
                    </div>

                    {rec.toolCoverage && (
                      <div className="flex items-center justify-between gap-2 p-2.5 rounded-md border border-[var(--border)] bg-[var(--bg)]">
                        <span className="text-[10px] font-mono text-[var(--text-muted)]">
                          Herramientas deterministas:{" "}
                          <span className="text-emerald-400 font-semibold">
                            {rec.toolCoverage.toolsOk}/{rec.toolCoverage.toolsTotal} ok
                          </span>
                          {rec.toolCoverage.notEvaluated.length > 0 && (
                            <span className="text-amber-400">
                              {" "}· {rec.toolCoverage.notEvaluated.length} no evaluada(s):{" "}
                              {rec.toolCoverage.notEvaluated.join("; ")}
                            </span>
                          )}
                          {rec.toolCoverage.packages.some((p) => p.scanned == null) && (
                            <span>
                              {" "}·{" "}
                              {rec.toolCoverage.packages
                                .filter((p) => p.scanned == null)
                                .map((p) => p.name)
                                .join(", ")}{" "}
                              sin herramienta de archivos
                            </span>
                          )}
                        </span>
                        <span className="text-[9.5px] font-mono text-[var(--text-muted)] shrink-0">
                          cobertura por herramientas, no del LLM
                        </span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">ISSUES DETECTADOS</span>
                        <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
                          {stats.total} hallazgos · {stats.critical} críticos · {stats.high} altos
                        </span>
                      </div>
                      {sortFindingsBySeverity(rec.data.findings).map((finding, i) => {
                        const sStyle = finding.severity === "critical" ? "border-red-500/25 bg-red-500/5" : finding.severity === "high" ? "border-amber-500/20 bg-amber-500/5" : "border-[var(--border)] bg-[var(--bg)]";
                        const sBadge = finding.severity === "critical" ? "text-red-400 bg-red-500/15 border-red-500/25" : finding.severity === "high" ? "text-amber-400 bg-amber-500/15 border-amber-500/20" : "text-[var(--text-muted)] bg-[var(--surface)] border-[var(--border)]";
                        return (
                          <div key={i} className={`p-3 rounded-md border text-xs space-y-1.5 ${sStyle}`}>
                            <div className="flex items-start gap-2 flex-wrap">
                              <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${sBadge}`}>{finding.severity.toUpperCase()}</span>
                              {finding.rule === "requisito-no-cumplido" && (
                                <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent)]/30">
                                  Requisito
                                </span>
                              )}
                              <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug flex-1">{finding.title}</p>
                            </div>
                            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{finding.description}</p>
                            <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                              <span className="font-mono text-[9.5px] text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">{finding.file}:{finding.line}</span>
                              {(finding.labels ?? []).map((lbl) => (
                                <span key={lbl} className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]">{lbl}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <CollapsibleJson label={`Ver JSON resultante (${rec.filename})`} data={rec.data} open={diagJsonOpen} onToggle={() => setDiagJsonOpen((v) => !v)} />

                    {rec.data.requisitos && rec.data.requisitos.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                            CUMPLIMIENTO DE REQUERIMIENTOS
                          </span>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
                            {(() => {
                              const c = { CUMPLE: 0, NO_CUMPLE: 0, PARCIAL: 0, NO_VERIFICABLE: 0 } as Record<string, number>;
                              for (const v of rec.data.requisitos ?? []) c[v.estado] = (c[v.estado] ?? 0) + 1;
                              const total = rec.data.requisitos?.length ?? 0;
                              const defectos = c.NO_CUMPLE + c.PARCIAL;
                              return `${c.CUMPLE}/${total} cumplen · ${defectos} defecto(s) · ${c.NO_VERIFICABLE} sin medición`;
                            })()}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {rec.data.requisitos.map((v) => {
                            const style =
                              v.estado === "CUMPLE"
                                ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/25"
                                : v.estado === "NO_CUMPLE"
                                  ? "text-red-400 bg-red-500/15 border-red-500/25"
                                  : v.estado === "PARCIAL"
                                    ? "text-amber-400 bg-amber-500/15 border-amber-500/25"
                                    : "text-orange-400 bg-orange-500/15 border-orange-500/25";
                            const border =
                              v.estado === "CUMPLE"
                                ? "border-emerald-500/20 bg-emerald-500/5"
                                : v.estado === "NO_CUMPLE"
                                  ? "border-red-500/25 bg-red-500/5"
                                  : v.estado === "PARCIAL"
                                    ? "border-amber-500/20 bg-amber-500/5"
                                    : "border-orange-500/20 bg-orange-500/5";
                            return (
                              <div key={v.id} className={`p-2.5 rounded-md border text-xs space-y-1 ${border}`}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-[10px] font-semibold text-[var(--text-primary)]">{v.id}</span>
                                  <span className={`font-mono text-[9.5px] font-semibold px-1.5 py-0.5 rounded border ${style}`}>
                                    {v.estado}
                                    {v.estado === "NO_VERIFICABLE" ? " · requiere medición" : ""}
                                  </span>
                                </div>
                                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{v.justificacion}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {rec.prompt && (
                      <details className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
                        <summary className="flex items-center justify-between px-3 py-2 text-[11px] font-mono text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors list-none">
                          <span>Ver prompt enviado a opencode</span>
                          <span className="text-[10px]">▾</span>
                        </summary>
                        <pre className="p-3 border-t border-[var(--border)] bg-[var(--surface)] text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {rec.prompt}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              }

              return (
                <div className={diagPhase !== "idle" ? "h-full flex flex-col gap-5" : "space-y-5"}>
                  {/* RUNNING (tools + LLM): sesión headless real (xterm) */}
                  {diagPhase !== "idle" && (
                    <div className="flex flex-col gap-3 min-h-0 flex-1">
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border)] shrink-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
                          <span className="text-[11px] font-mono font-semibold text-[var(--text-secondary)]">
                            {diagPhase === "tools"
                              ? diagToolsDone
                                ? "Herramientas completadas — revisá el log antes de continuar"
                                : "Herramientas deterministas — escaneando el repositorio"
                              : "Sesión opencode activa — diagnóstico en curso"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] shrink-0"
                          onClick={() => useDiagnosisStore.getState().cancel()}
                        >
                          Cancelar
                        </button>
                      </div>
                      {diagSessionRuntime ? (
                        <div className="flex flex-col gap-2 min-h-0 flex-1">
                          {diagSessionRuntime.prompt && (
                            <details className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden shrink-0">
                              <summary className="flex items-center justify-between px-3 py-2 text-[11px] font-mono text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] transition-colors list-none">
                                <span>Prompt enviado a opencode</span>
                                <span className="text-[10px]">▾</span>
                              </summary>
                              <pre className="p-3 border-t border-[var(--border)] bg-[var(--surface)] text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                                {diagSessionRuntime.prompt}
                              </pre>
                            </details>
                          )}
                          <div className="relative flex-1 min-h-[240px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)]">
                            <PlannerTerminalPane terminalId={diagSessionRuntime.terminalId} />
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] font-mono text-[var(--text-muted)] py-6 text-center animate-pulse shrink-0">
                          {diagPhase === "tools"
                            ? "Iniciando pipeline de herramientas…"
                            : "Iniciando sesión de opencode…"}
                        </div>
                      )}

                      {/* Gate herramientas → LLM: el botón se habilita cuando
                          TODAS las herramientas terminaron (archivo + exit 0) */}
                      {diagPhase === "tools" && (
                        <div className="flex items-center justify-between gap-3 p-3.5 rounded-md border bg-[var(--bg)] border-[var(--border)] shrink-0">
                          {diagToolsDone ? (
                            <>
                              <div className="space-y-0.5 min-w-0">
                                <p className="text-xs font-bold text-emerald-400">Herramientas completadas</p>
                                <p className="text-[10px] font-mono text-[var(--text-muted)]">
                                  {diagToolsSummary
                                    ? `${diagToolsSummary.toolsOk}/${diagToolsSummary.toolsTotal} herramientas ok${diagToolsSummary.notEvaluated.length > 0 ? ` · ${diagToolsSummary.notEvaluated.length} no evaluada(s)` : ""}`
                                    : "Escaneo completo"}{" "}
                                  — revisá el log y continuá con el diagnóstico LLM
                                </p>
                              </div>
                              <button
                                type="button"
                                className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0"
                                onClick={() => void useDiagnosisStore.getState().continueToLlm()}
                              >
                                Continuar al diagnóstico LLM →
                              </button>
                            </>
                          ) : (
                            <>
                              <p className="text-[10.5px] font-mono text-[var(--text-muted)]">
                                Esperando a que todas las herramientas terminen de escanear…
                              </p>
                              <button
                                type="button"
                                disabled
                                className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0 opacity-50 cursor-not-allowed"
                              >
                                Herramientas escaneando…
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* IDLE: acción + historial */}
                  {diagPhase === "idle" && (
                    <>
                      {diagError && (
                        <div className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-red-500/8 border border-red-500/25">
                          <div className="space-y-0.5 min-w-0">
                            <p className="text-xs font-bold text-red-400">El diagnóstico falló</p>
                            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{diagError}</p>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] shrink-0"
                            onClick={() => useDiagnosisStore.getState().dismissError()}
                          >
                            Cerrar
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-4 p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                        <div className="w-9 h-9 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
                          <DiagnosisIcon />
                        </div>
                        <div className="space-y-1 flex-1">
                          <h3 className="text-xs font-bold text-[var(--text-primary)]">Diagnóstico del Repositorio</h3>
                          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                            Ejecuta una sesión de opencode que examina la estructura de archivos, dependencias y cobertura para detectar issues reproducibles y brechas de arquitectura.
                          </p>
                          <p className="text-[10.5px] font-mono text-[var(--text-muted)] pt-0.5">
                            Resultado guardado en{" "}
                            <code className="text-[var(--text-secondary)] bg-[var(--surface)] px-1 rounded border border-[var(--border)]">
                              .agents/planning/diagnostico-*.json
                            </code>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            className="btn btn-ghost text-[11px] py-2 px-3 border border-[var(--border)] shrink-0"
                            onClick={() => void useDiagnosisStore.getState().startLlmDirect()}
                            title="Saltea el análisis de herramientas y lanza el LLM con el tool-findings más reciente"
                          >
                            → LLM directo
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0"
                            onClick={() => void useDiagnosisStore.getState().start()}
                          >
                            + Nuevo diagnóstico
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                            HISTORIAL DE DIAGNÓSTICOS
                          </span>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
                            {diagHistory.length} diagnóstico(s)
                          </span>
                        </div>

                        {diagHistory.length === 0 ? (
                          <p className="text-[11px] text-[var(--text-muted)] py-4 text-center">
                            Todavía no hay diagnósticos completados.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {diagHistory.map((rec) => {
                              const stats = makeDiagStats(rec.data.findings);
                              return (
                                <div
                                  key={rec.id}
                                  className="p-3 rounded-md border text-xs flex items-center justify-between gap-3 cursor-pointer transition-all border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/50 hover:bg-[var(--surface)]"
                                  onClick={() => {
                                    setViewingDiagId(rec.id);
                                    setDiagJsonOpen(false);
                                  }}
                                >
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <span className="font-mono text-[10.5px] text-[var(--text-muted)] shrink-0">{rec.timestamp}</span>
                                    <span className="font-mono text-[10px] text-[var(--text-muted)] truncate">{rec.repo}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {stats.critical > 0 && (
                                      <span className="text-[9.5px] font-semibold text-red-400 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded font-mono">
                                        {stats.critical} crítico{stats.critical > 1 ? "s" : ""}
                                      </span>
                                    )}
                                    <span className="text-[9.5px] font-mono text-[var(--text-muted)]">{stats.total} hallazgos</span>
                                    <button
                                      type="button"
                                      className="btn btn-ghost text-[11px] py-0.5 px-2 border border-[var(--border)]"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSubcategoryChange("github_issues");
                                        setGithubDiagFilter(rec.id);
                                      }}
                                    >
                                      GitHub Issues →
                                    </button>
                                    <button
                                      type="button"
                                      className="icon-btn w-5 h-5 p-0 rounded text-[var(--red)] hover:bg-[var(--red-soft)]"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeletingDiag({ id: rec.id, filename: rec.filename });
                                      }}
                                      title="Eliminar diagnóstico"
                                      aria-label={`Eliminar diagnóstico ${rec.filename}`}
                                    >
                                      <TrashIcon />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── PLANNING: Planificador desde roadmap (MOCK) ─────────────── */}
            {activeSubcategory === "planning_roadmap" && (
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
            )}

            {/* 7. GitHub Issues (conversión REAL — solo hallazgos de Planning) */}
            {activeSubcategory === "github_issues" &&
              (synthLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
                  <p className="text-xs text-[var(--text-muted)]">Cargando resultados…</p>
                </div>
              ) : convertibleItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]">
                    <GitHubIcon />
                  </div>
                  <p className="text-xs font-semibold text-[var(--text-primary)]">Sin diagnósticos completados</p>
                  <p className="text-[11px] text-[var(--text-muted)] max-w-xs leading-relaxed">
                    Completá al menos un diagnóstico en la sección PLANNING → Diagnóstico para habilitar la conversión a GitHub Issues.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary text-xs py-1.5 px-4 font-semibold"
                    onClick={() => handleSubcategoryChange("planning_diagnosis")}
                  >
                    Ir a Diagnóstico →
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-[var(--bg)] border border-[var(--border)] space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <GitHubIcon />
                          <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase font-semibold">
                            CONVERSIÓN AUTOMÁTICA A GITHUB ISSUES CON ETIQUETAS
                          </span>
                        </div>
                        <h3 className="text-xs font-bold text-[var(--text-primary)]">
                          Conversión de Hallazgos de Diagnóstico (Planning)
                        </h3>
                        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                          Crea issues reales en el repositorio del proyecto con las etiquetas existentes del repo
                          (las que no existen se omiten para no fallar el create).
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          className="btn btn-ghost text-xs py-1.5 px-3 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                          onClick={() => handleSelectAllForIssue(allFilteredIds)}
                        >
                          {isAllSelected ? "Desmarcar todos" : "Seleccionar todos"}
                        </button>
                        <button
                          type="button"
                          disabled={selectedForIssue.length === 0}
                          className="btn btn-primary text-xs py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                          onClick={handleConvertBatch}
                        >
                          <GitHubIcon />
                          <span>Convertir Seleccionados ({selectedForIssue.length})</span>
                        </button>
                      </div>
                    </div>

                    {/* FUENTE — DIAGNÓSTICO (diseño v2): filtra hallazgos por
                        diagnóstico de origen; "all" muestra todo. */}
                    {diagHistory.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-[var(--border)]">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold block">
                          FUENTE — DIAGNÓSTICO
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors border ${
                              githubDiagFilter === "all"
                                ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)] font-semibold"
                                : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]"
                            }`}
                            onClick={() => {
                              setGithubDiagFilter("all");
                              setSelectedForIssue([]);
                            }}
                          >
                            Todos ({convertibleItems.length})
                          </button>
                          {diagHistory.map((rec) => {
                            const count = rec.data.findings.length;
                            const isActive = githubDiagFilter === rec.id;
                            return (
                              <button
                                key={rec.id}
                                type="button"
                                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors border max-w-[220px] truncate ${
                                  isActive
                                    ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)] font-semibold"
                                    : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]"
                                }`}
                                onClick={() => {
                                  setGithubDiagFilter(rec.id);
                                  setSelectedForIssue([]);
                                }}
                                title={`${rec.repo} · ${rec.timestamp}`}
                              >
                                {rec.timestamp} · {count} hallazgo{count !== 1 ? "s" : ""}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        aria-label="Buscar hallazgo para convertir"
                        placeholder="Filtrar por texto o archivo…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="textarea-minimal text-xs py-1.5 max-w-xs focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                      />
                    </div>
                    <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">
                      {filteredIssueItems.length} elementos visibles
                    </span>
                  </div>

                  <div className="space-y-2">
                    {filteredIssueItems.map((item) => {
                      const st = issueState[item.id] || { status: "pending" };
                      const isSelected = selectedForIssue.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (st.status !== "converted") handleToggleSelectForIssue(item.id);
                          }}
                          className={`p-3 rounded-md border text-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            st.status === "converted"
                              ? "bg-emerald-500/5 border-emerald-500/20"
                              : isSelected
                                ? "bg-[var(--bg)] border-[var(--accent)] ring-1 ring-[var(--accent)] cursor-pointer"
                                : "bg-[var(--bg)] border-[var(--border)] hover:border-[var(--text-muted)] cursor-pointer"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={st.status === "converted"}
                              onChange={() => handleToggleSelectForIssue(item.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
                              aria-label={`Seleccionar ${item.id} para convertir`}
                            />
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[10.5px] font-semibold text-[var(--text-primary)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                                  {item.id}
                                </span>
                                <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-400 border-amber-500/20">
                                  Hallazgo de Diagnóstico
                                </span>
                                <span
                                  className={`font-mono text-[9.5px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                                    item.priorityTag === "critical"
                                      ? "text-red-400 bg-red-500/15 border-red-500/25"
                                      : item.priorityTag === "high"
                                        ? "text-amber-400 bg-amber-500/15 border-amber-500/20"
                                        : "text-[var(--text-muted)] bg-[var(--surface)] border-[var(--border)]"
                                  }`}
                                >
                                  {item.priorityTag.toUpperCase()}
                                </span>
                              </div>
                              <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{item.title}</p>
                              {item.fileLine && (
                                <span className="font-mono text-[9.5px] text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)] self-start">
                                  {item.fileLine}
                                </span>
                              )}
                              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span className="text-[9.5px] font-mono text-[var(--text-muted)]">Labels de GitHub:</span>
                                {item.githubLabels.map((lbl, idx) => (
                                  <span
                                    key={idx}
                                    className={`font-mono text-[9px] px-1.5 py-0.2 rounded border ${
                                      availableLabels.includes(lbl)
                                        ? "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)]"
                                        : "bg-transparent text-[var(--text-faint)] border-[var(--border)] opacity-50"
                                    }`}
                                    title={availableLabels.includes(lbl) ? undefined : "Label inexistente en el repo: se omite al crear"}
                                  >
                                    label:{lbl}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                            {st.status === "pending" && (
                              <button
                                type="button"
                                className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] hover:bg-[var(--surface-hover)] flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                                onClick={() => void convertToIssue(item.id)}
                              >
                                <GitHubIcon />
                                <span>Convertir</span>
                              </button>
                            )}
                            {st.status === "converting" && (
                              <span className="text-[11px] font-mono text-[var(--accent)] flex items-center gap-1.5 animate-pulse">
                                <span>⚡ Creando Issue…</span>
                              </span>
                            )}
                            {st.status === "converted" && (
                              <a
                                href={st.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded border border-emerald-500/20 flex items-center gap-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                              >
                                <span>Issue #{st.issueNumber}</span>
                                <ExternalLinkIcon />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Overlay: confirmar eliminación de un diagnóstico */}
        {deletingDiag && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="p-3.5 rounded-md bg-[var(--surface)] border border-[var(--border)] max-w-xs w-full space-y-2.5 shadow-xl">
              <h3 className="text-xs font-semibold text-[var(--red)]">¿Eliminar este diagnóstico?</h3>
              <p className="text-[11px] text-[var(--text-muted)] break-all">{deletingDiag.filename}</p>
              <p className="text-[11px] text-[var(--text-muted)]">El JSON se borrará del disco.</p>
              <div className="flex justify-end gap-2 pt-0.5">
                <button type="button" className="btn btn-ghost text-xs py-1 min-h-[32px]" onClick={() => setDeletingDiag(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary bg-[var(--red)] text-white hover:opacity-90 text-xs py-1 min-h-[32px]"
                  onClick={() => {
                    const active = resolveActiveWorktree();
                    if (active) {
                      void useDiagnosisStore.getState().removeRecord(deletingDiag.id, active.path);
                    }
                    if (viewingDiagId === deletingDiag.id) setViewingDiagId(null);
                    setDeletingDiag(null);
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
