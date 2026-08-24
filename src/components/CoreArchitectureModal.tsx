// Modal UNIFICADO de arquitectura (Figma: "Replicate Modal Dialog Design") — SHELL.
//
// Reemplaza al monolito de 3.400 líneas: este archivo es solo la CAPUCHA del
// modal — navegación lateral, header, tarjeta fija de seguridad, trampa de
// foco y el estado CRUZADO entre secciones (síntesis activa, búsqueda,
// portapapeles, filtros). Cada sección vive en src/components/core/sections/
// y se registra en core/registry.tsx: AGREGAR UNA FASE NUEVA = una carpeta +
// una entrada en el registro, sin tocar este archivo.
//
// La lógica del motor no vive acá: las entrevistas la corren los stores
// existentes (useRepoContextStore / useInterviewStore) y el shell solo las
// EMBEBE en modo inline + agrega las vistas de resultados.

import { useEffect, useRef, useState } from "react";
import { useRepoContextStore } from "../stores/repoContextStore";
import { useInterviewStore } from "../stores/interviewStore";
import { useDiagnosisStore } from "../stores/diagnosisStore";
import { useRepoSecurityStore } from "../stores/repoSecurityStore";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { resolveActiveWorktree } from "../planner/planningSession";
import { useActiveSynthesis } from "./core/useActiveSynthesis";
import {
  CoreModalContext,
  type CoreModalContextValue,
} from "./core/context";
import {
  SECTION_GROUPS,
  SECTION_REGISTRY,
  sectionBadge,
  sectionById,
} from "./core/registry";
import { CloseXIcon, SecurityShieldIcon, type CoreSubcategory } from "./core/shared";

export type { CoreSubcategory } from "./core/shared";

export function CoreArchitectureModal({
  isOpen,
  onClose,
  projectName,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectName?: string;
}) {
  const [activeSubcategory, setActiveSubcategory] =
    useState<CoreSubcategory>("functional_requirements");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  // Flujo de seguridad del repositorio: la tarjeta fija del diagnóstico
  // abre la checklist como vista interna de planning_diagnosis.
  const [securityOpen, setSecurityOpen] = useState(false);

  // Abre el flujo de seguridad; si no hay audit previo, lo lanza.
  const openSecurityFlow = () => {
    setSecurityOpen(true);
    const active = resolveActiveWorktree();
    const store = useRepoSecurityStore.getState();
    if (active && !store.audit && store.phase !== "auditing" && store.phase !== "running") {
      void store.runAudit(active.path);
    }
  };
  const closeSecurityFlow = () => setSecurityOpen(false);

  const [projectTitle, setProjectTitle] = useState(projectName ?? "");

  // Filtro FUENTE — DIAGNÓSTICO compartido con la sección de GitHub Issues.
  const [githubDiagFilter, setGithubDiagFilter] = useState<string>("all");

  // Colapso compartido del bloque "Eliminados" entre las 4 secciones de curaduría.
  const [curDeletedOpen, setCurDeletedOpen] = useState(false);

  // Síntesis activa de la entrevista (compartida por contexto con las secciones).
  const { synthesis, synthesisPath, synthLoading, loadSynthesis, applySynthesis } =
    useActiveSynthesis();

  // Historial de diagnósticos para el contexto (las secciones también pueden
  // suscribirse directo al store; acá alimenta los badges/filtros del shell).
  const diagHistory = useDiagnosisStore((s) => s.history);

  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useBodyScrollLock(isOpen);

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
    return () => {
      if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === "function") {
        lastActiveElementRef.current.focus();
      }
    };
  }, [isOpen, projectName, loadSynthesis]);

  // Highlight: al clickear el chip de una historia en un RF, se navega a la
  // sección y el borde de la tarjeta destino se ilumina por ~1s.
  const [highlightStoryId, setHighlightStoryId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  const jumpToStory = (storyId: string) => {
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    setActiveSubcategory("user_stories");
    setSearch("");
    setHighlightStoryId(storyId);
    highlightTimer.current = window.setTimeout(() => setHighlightStoryId(null), 1000);
  };

  useEffect(() => {
    return () => {
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Scroll la tarjeta destino al centro cuando el highlight está activo.
  useEffect(() => {
    if (!highlightStoryId) return;
    const el = document.getElementById(`story-${highlightStoryId}`);
    if (el) {
      // Un tick después del render de la sección recién navegada.
      const id = window.setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      return () => window.clearTimeout(id);
    }
  }, [highlightStoryId, activeSubcategory]);

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

  const navigate = (sub: CoreSubcategory) => {
    setActiveSubcategory(sub);
    setSearch("");
    // Si el usuario navega a otra sección, el filtro de GitHub por diagnóstico
    // no debe quedar colgado apuntando a un diagnóstico ya no visible. Los
    // estados internos de cada sección (vistas detalle, overlays) se resetean
    // solos por desmontaje.
    if (sub !== "github_issues") setGithubDiagFilter("all");
    setSecurityOpen(false);
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Sin notificación global acá para no duplicar feedback visual del icono.
    }
  };

  // ── Valor del contexto compartido por todas las secciones ─────────────

  const ctxValue: CoreModalContextValue = {
    close: onClose,
    navigate,
    search,
    setSearch,
    copiedId,
    copy: (text, id) => void handleCopy(text, id),
    synthesis,
    synthesisPath,
    synthLoading,
    applySynthesis,
    highlightStoryId,
    jumpToStory,
    rfCountForStory: (storyId) =>
      (synthesis?.requerimientos_funcionales ?? []).filter((r) =>
        (r.historias_origen ?? []).includes(storyId),
      ).length,
    openGithubIssues: (diagId) => {
      setGithubDiagFilter(diagId);
      setSearch("");
      setActiveSubcategory("github_issues");
    },
    githubDiagFilter,
    setGithubDiagFilter,
    curDeletedOpen,
    setCurDeletedOpen,
    securityOpen,
    openSecurityFlow,
    closeSecurityFlow,
    diagHistory,
  };

  // ── Sidebar ────────────────────────────────────────────────────────────
  const sidebarBtnClass = (active: boolean) =>
    `w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none ${
      active
        ? "bg-[var(--accent)] text-[var(--accent-foreground)] font-semibold shadow-xs"
        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
    }`;

  // ── Sección activa ─────────────────────────────────────────────────────
  const ActiveSection = sectionById(activeSubcategory).Component;

  // Estado de la seguridad del repo para la tarjeta fija del diagnóstico.
  const securityAudit = useRepoSecurityStore((s) => s.audit);
  const securityPhase = useRepoSecurityStore((s) => s.phase);
  const securityResult = useRepoSecurityStore((s) => s.result);
  const securityError = useRepoSecurityStore((s) => s.error);

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
      {/* Contenedor único 92vw x 90vh — sin scrims anidados */}
      <div
        ref={modalRef}
        className="w-[92vw] max-w-[1400px] h-[90vh] max-h-[900px] bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl flex overflow-hidden tc-enter relative"
      >
        <CoreModalContext.Provider value={ctxValue}>
          {/* Sidebar de navegación: grupos scrolleables + footer FIJO con la
              sección de Sincronización (transversal, siempre visible abajo). */}
          <aside className="w-64 bg-[var(--bg)] border-r border-[var(--border)] flex flex-col shrink-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {SECTION_GROUPS.filter((group) => group.id !== "sincronizacion").map((group, groupIdx, arr) => (
                <div
                  key={group.id}
                  className={`space-y-1.5 ${groupIdx > 0 ? "pt-2 border-t border-[var(--border)]" : ""}`}
                >
                  <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                    {group.heading}
                  </span>
                  <nav className="space-y-1" aria-label={group.ariaLabel}>
                    {SECTION_REGISTRY.filter((def) => def.group === group.id).map((def) => {
                      const Icon = def.icon;
                      const isActive = activeSubcategory === def.id;
                      return (
                        <button
                          key={def.id}
                          type="button"
                          aria-current={isActive ? "page" : undefined}
                          className={sidebarBtnClass(isActive)}
                          onClick={() => navigate(def.id)}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Icon />
                            <span className="truncate">{def.label}</span>
                          </div>
                          <span className="text-[9.5px] font-mono shrink-0 tabular-nums">
                            {sectionBadge(def, { synthesis })}
                          </span>
                        </button>
                      );
                    })}
                  </nav>
                  {groupIdx === arr.length - 1 && <div className="pt-2" />}
                </div>
              ))}
            </div>

            {/* Footer fijo: SINCRONIZACIÓN (nunca scrollea). */}
            {SECTION_GROUPS.filter((group) => group.id === "sincronizacion").map((group) => (
              <div
                key={group.id}
                className="shrink-0 border-t border-[var(--border)] p-4 space-y-1.5 bg-[var(--bg)]"
              >
                <span className="text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase block px-1 font-semibold">
                  {group.heading}
                </span>
                <nav className="space-y-1" aria-label={group.ariaLabel}>
                  {SECTION_REGISTRY.filter((def) => def.group === group.id).map((def) => {
                    const Icon = def.icon;
                    const isActive = activeSubcategory === def.id;
                    return (
                      <button
                        key={def.id}
                        type="button"
                        aria-current={isActive ? "page" : undefined}
                        className={sidebarBtnClass(isActive)}
                        onClick={() => navigate(def.id)}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Icon />
                          <span className="truncate">{def.label}</span>
                        </div>
                        <span className="text-[9.5px] font-mono shrink-0 tabular-nums">
                          {sectionBadge(def, { synthesis })}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            ))}
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
              <ActiveSection />
            </div>

            {/* Tarjeta fija de seguridad del repositorio (solo en Diagnóstico).
                Muestra el resumen del audit y abre el flujo de checklist. */}
            {activeSubcategory === "planning_diagnosis" && (
              <div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg)]/70 px-5 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
                    <SecurityShieldIcon />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">
                      Seguridad del repositorio
                    </p>
                    <p className="text-[10px] font-mono text-[var(--text-muted)] truncate">
                      {securityPhase === "auditing"
                        ? "Auditando el repositorio…"
                        : securityResult
                          ? `${securityResult.summary.ok} aplicadas · ${securityResult.summary.skip} omitidas · ${securityResult.summary.error} con error — ${securityResult.owner}/${securityResult.repo}`
                          : securityAudit
                            ? (() => {
                                const pending = securityAudit.features.filter((f) => f.selectable).length;
                                const base = pending === 0
                                  ? "Todas las capas disponibles configuradas ✓"
                                  : `${pending} capa(s) sin activar`;
                                return `${base} · ${securityAudit.owner}/${securityAudit.repo} · ${
                                  securityAudit.visibility === "public" ? "público" : "privado"
                                }`;
                              })()
                            : securityError
                              ? "No se pudo auditar — configuración manual en GitHub"
                              : "Sin auditar"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost text-[11px] py-1.5 px-3 border border-[var(--border)] shrink-0 flex items-center gap-1.5"
                  onClick={openSecurityFlow}
                >
                  <SecurityShieldIcon />
                  <span>{securityOpen ? "Ver flujo" : "Configurar"}</span>
                </button>
              </div>
            )}
          </div>
        </CoreModalContext.Provider>
      </div>
    </div>
  );
}
