// Piezas compartidas por las secciones del modal unificado de arquitectura.
// Extraídas VERBATIM de CoreArchitectureModal.tsx durante el refactor del
// registro de secciones (Fase A): iconos SVG del diseño, bloques colapsables
// de recuperables, JSON colapsable, terminal simulada del planificador y la
// configuración del formulario genérico de curaduría (RF/ASR/restricción/término).

import { useEffect, useState } from "react";
import { JsonCodeBlock } from "../JsonCodeBlock";
import type { AuditPlan } from "../../types/issuePlanning.ts";

// ─── Tipos compartidos ───────────────────────────────────────────────────

export type CoreSubcategory =
  | "repo_context"
  | "requirements_interview"
  | "user_stories"
  | "functional_requirements"
  | "quality_attributes"
  | "architecture_tactics"
  | "constraints"
  | "glossary"
  | "planning_diagnosis"
  | "planning_roadmap"
  | "github_issues";

export type SectionGroup = "entrevistas" | "post" | "planning" | "integraciones";

// ─── Iconos (mismos SVG que el diseño) ──────────────────────────────────

export const CloseXIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const ChatBubbleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </svg>
);

export const DocumentTextIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </svg>
);

export const RequirementsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="8" y1="6" x2="21" y2="6"></line>
    <line x1="8" y1="12" x2="21" y2="12"></line>
    <line x1="8" y1="18" x2="21" y2="18"></line>
    <line x1="3" y1="6" x2="3.01" y2="6"></line>
    <line x1="3" y1="12" x2="3.01" y2="12"></line>
    <line x1="3" y1="18" x2="3.01" y2="18"></line>
  </svg>
);

export const QualityIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
  </svg>
);

export const TacticsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
  </svg>
);

export const ConstraintsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
  </svg>
);

export const GlossaryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
  </svg>
);

export const GitHubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
    <path d="M9 18c-4.51 2-5-2-7-2"></path>
  </svg>
);

// Icono de Diagnóstico (estetoscopio/lupa sobre repo) — del diseño v2.
export const DiagnosisIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v18h18"></path>
    <path d="M7 14l3-3 3 2 4-5"></path>
  </svg>
);

// Icono de Planificador (ruta con hitos) — del diseño v2.
export const PlannerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
  </svg>
);

export const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

export const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

export const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

// Icono de Seguridad del repositorio (escudo) — tarjeta fija del diagnóstico.
export const SecurityShieldIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
    <path d="M9 12l2 2 4-4"></path>
  </svg>
);

export const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

// Icono de Historia de Usuario (persona + texto) — artefacto de producto
// primario de la síntesis (las historias preceden a los RFs que las formalizan).
export const UserStoryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
    <path d="M12 11l1.5 1.5L17 9"></path>
  </svg>
);

export const AlertIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="8" x2="12" y2="12"></line>
    <line x1="12" y1="16" x2="12.01" y2="16"></line>
  </svg>
);

export const PencilIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
  </svg>
);

export const RestoreIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1 4 1 10 7 10"></polyline>
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
  </svg>
);

// ─── Utilidades de diagnóstico ───────────────────────────────────────────

export function makeDiagStats(findings: AuditPlan["findings"]) {
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

export function sortFindingsBySeverity(findings: AuditPlan["findings"]): AuditPlan["findings"] {
  return [...findings].sort(
    (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
  );
}

// Badge de color por prioridad MoSCoW (historias y requerimientos).
export function priorityBadgeClass(priority: string): string {
  const p = (priority ?? "").trim().toLowerCase();
  if (p.startsWith("must")) return "bg-[var(--red-soft)] text-[var(--red)] border-red-500/20";
  if (p.startsWith("should")) return "bg-[var(--amber-soft)] text-[var(--amber)] border-amber-500/20";
  if (p.startsWith("nice")) return "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--border)]";
  return "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]";
}

// ─── Terminal de sesión opencode con streaming simulado (diseño v2) ──────
// Terminal FALSA: pinta líneas de log en streaming para comunicar la
// actividad de la sesión mientras el diagnóstico/planificador corren en
// modo simulado (mock por ahora, sin sesión real de opencode).

export function OpencodeterminalSession({
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

export function CollapsibleJson({
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

// ─── Config de curaduría de ítems (RF / ASR / restricción / término) ─────
// Impulsa el formulario add/edit genérico y la traducción a los inputs del
// motor. Las claves "esc.*" del ASR se anidan bajo escenario_tecnico_6_partes.

export type CurationKind = "rf" | "asr" | "constraint" | "term";

export interface CurationFieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox";
  required?: boolean;
  rows?: number;
  options?: string[];
  placeholder?: string;
}

export const CURATION_FIELDS: Record<CurationKind, CurationFieldDef[]> = {
  rf: [
    { key: "descripcion", label: "Descripción", type: "textarea", required: true, rows: 2 },
    { key: "justificacion", label: "Justificación", type: "textarea", rows: 2 },
    { key: "prioridad", label: "Prioridad", type: "select", options: ["Must have", "Should have", "Nice to have"] },
    { key: "criterio_de_ajuste", label: "Criterio de ajuste", type: "textarea", rows: 2 },
  ],
  asr: [
    { key: "atributo", label: "Atributo", type: "text", required: true, placeholder: "Rendimiento | Disponibilidad | Seguridad…" },
    { key: "es_asr_genuino", label: "ASR genuino (fuerza decisión estructural)", type: "checkbox" },
    { key: "justificacion_arquitectonica", label: "Justificación arquitectónica", type: "textarea", rows: 2 },
    { key: "esc.fuente", label: "Escenario · Fuente", type: "text" },
    { key: "esc.estimulo", label: "Escenario · Estímulo", type: "text" },
    { key: "esc.artefacto", label: "Escenario · Artefacto", type: "text" },
    { key: "esc.entorno", label: "Escenario · Entorno", type: "text" },
    { key: "esc.respuesta", label: "Escenario · Respuesta", type: "text" },
    { key: "esc.medida_de_respuesta", label: "Escenario · Medida de respuesta", type: "text" },
    { key: "trade_offs_identificados", label: "Trade-offs identificados", type: "textarea", rows: 2 },
  ],
  constraint: [
    { key: "tipo", label: "Tipo", type: "text", required: true, placeholder: "Legal | Presupuesto | Stack Tecnológico | Tiempo" },
    { key: "descripcion", label: "Descripción", type: "textarea", required: true, rows: 2 },
    { key: "impacto", label: "Impacto en el diseño", type: "textarea", rows: 2 },
  ],
  term: [
    { key: "termino", label: "Término", type: "text", required: true },
    { key: "definicion", label: "Definición", type: "textarea", required: true, rows: 3 },
  ],
};

export const CURATION_ADD_LABEL: Record<CurationKind, string> = {
  rf: "+ Nuevo requerimiento",
  asr: "+ Nuevo ASR",
  constraint: "+ Nueva restricción",
  term: "+ Nuevo término",
};

// Convierte los valores planos del formulario al input del motor.
export function buildCurationInput(kind: CurationKind, values: Record<string, unknown>): unknown {
  const str = (k: string) => (typeof values[k] === "string" ? (values[k] as string).trim() : undefined);
  const opt = (k: string) => {
    const v = str(k);
    return v ? v : undefined;
  };
  switch (kind) {
    case "rf":
      return {
        descripcion: str("descripcion") ?? "",
        justificacion: opt("justificacion"),
        prioridad: opt("prioridad"),
        criterio_de_ajuste: opt("criterio_de_ajuste"),
      };
    case "asr":
      return {
        atributo: str("atributo") ?? "",
        es_asr_genuino: values.es_asr_genuino === true,
        justificacion_arquitectonica: opt("justificacion_arquitectonica"),
        escenario_tecnico_6_partes: {
          fuente: opt("esc.fuente"),
          estimulo: opt("esc.estimulo"),
          artefacto: opt("esc.artefacto"),
          entorno: opt("esc.entorno"),
          respuesta: opt("esc.respuesta"),
          medida_de_respuesta: opt("esc.medida_de_respuesta"),
        },
        trade_offs_identificados: opt("trade_offs_identificados"),
      };
    case "constraint":
      return { tipo: str("tipo") ?? "", descripcion: str("descripcion") ?? "", impacto: opt("impacto") };
    case "term":
      return { termino: str("termino") ?? "", definicion: str("definicion") ?? "" };
  }
}

// Pre-carga los valores de un ítem existente para el modo edición.
export function itemToValues(kind: CurationKind, item: unknown): Record<string, unknown> {
  const it = item as Record<string, unknown>;
  if (kind === "asr") {
    const esc = (it.escenario_tecnico_6_partes ?? {}) as Record<string, unknown>;
    return {
      atributo: it.atributo,
      es_asr_genuino: it.es_asr_genuino === true,
      justificacion_arquitectonica: it.justificacion_arquitectonica,
      "esc.fuente": esc.fuente,
      "esc.estimulo": esc.estimulo,
      "esc.artefacto": esc.artefacto,
      "esc.entorno": esc.entorno,
      "esc.respuesta": esc.respuesta,
      "esc.medida_de_respuesta": esc.medida_de_respuesta,
      trade_offs_identificados: it.trade_offs_identificados,
    };
  }
  return { ...it };
}

// Vuelve un ítem a texto legible para el título del confirm de eliminación.
export function curationItemLabel(kind: CurationKind, item: unknown): string {
  const it = item as Record<string, unknown>;
  switch (kind) {
    case "rf":
      return typeof it.descripcion === "string" ? it.descripcion : String(it.id);
    case "asr":
      return typeof it.atributo === "string" ? it.atributo : String(it.id);
    case "constraint":
      return `${it.tipo ?? "?"}: ${it.descripcion ?? ""}`;
    case "term":
      return String(it.termino ?? "");
  }
}

// ─── Bloques de eliminados (recuperables) ────────────────────────────────

// Bloque colapsable "Eliminados (N) — recuperables" reutilizable por sección.
export function DeletedBlock({
  count,
  open,
  onToggle,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>Eliminados ({count}) — recuperables</span>
        <span className="text-[10px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="p-2.5 border-t border-[var(--border)] space-y-1.5">{children}</div>}
    </div>
  );
}

export function DeletedRow({
  idLabel,
  title,
  meta,
  onRestore,
  onPurge,
  disabled,
}: {
  idLabel: string;
  title: string;
  meta: string;
  onRestore: () => void;
  onPurge?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)]">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0">{idLabel}</span>
          <span className="truncate text-[var(--text-primary)]">{title}</span>
        </div>
        {meta && <div className="text-[10px] text-[var(--text-muted)]">{meta}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          className="text-[var(--red)] hover:bg-[var(--red-soft)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none p-1 rounded"
          onClick={onPurge}
          disabled={disabled}
          title="Eliminar definitivamente (sin recuperación)"
          aria-label={`Eliminar definitivamente ${idLabel}`}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          className="btn btn-ghost text-[10.5px] py-1 px-2.5 border border-[var(--border)] flex items-center gap-1.5"
          onClick={onRestore}
          disabled={disabled}
        >
          <RestoreIcon />
          Restaurar
        </button>
      </div>
    </div>
  );
}
