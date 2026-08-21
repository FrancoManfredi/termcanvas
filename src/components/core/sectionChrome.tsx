// Chrome compartido de las secciones post-entrevista: estado de carga,
// vista vacía sin síntesis y header con buscador. Extraído VERBATIM de los
// helpers render* de CoreArchitectureModal.

import { useCoreModal } from "./context";
import { DocumentTextIcon } from "./shared";

// Spinner centrado mientras la síntesis activa se carga por IPC.
export function SynthLoading() {
  return (
    <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      <p className="text-xs text-[var(--text-muted)]">Cargando resultados…</p>
    </div>
  );
}

// Vista vacía post-entrevista: todavía no hay resultados de ninguna entrevista.
export function NoSynthesis() {
  const { navigate } = useCoreModal();
  return (
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
        onClick={() => navigate("planning_diagnosis")}
      >
        Ir a Diagnóstico →
      </button>
    </div>
  );
}

// Header con buscador + contador + acciones opcionales (ej: "+ Nuevo").
export function SearchHeader({
  label,
  count,
  placeholder,
  actions,
}: {
  label: string;
  count: string;
  placeholder: string;
  actions?: React.ReactNode;
}) {
  const { search, setSearch } = useCoreModal();
  return (
    <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
      <input
        type="text"
        aria-label={label}
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="textarea-minimal text-xs py-1.5 max-w-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
      />
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">{count}</span>
        {actions}
      </div>
    </div>
  );
}
