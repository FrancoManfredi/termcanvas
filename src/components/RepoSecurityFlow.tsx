import { PlannerTerminalPane } from "./PlannerTerminalPane";
import { useRepoSecurityStore } from "../stores/repoSecurityStore";
import { resolveActiveWorktree } from "../planner/planningSession";
import type {
  SecurityAudit,
  SecurityCategory,
} from "../types/repoSecurity";

// Flujo de seguridad del repositorio (PLANNING → Diagnóstico): checklist
// interactiva por categorías → aplicación con logs en streaming (terminal
// real del proceso headless) → pantalla de resultados por feature.
//
// El estado vive en repoSecurityStore (nivel módulo): cerrar el modal no
// cancela la corrida. El modal controla cuándo se renderiza (securityOpen)
// y esta componente maneja las fases internas.

const CATEGORY_ORDER: SecurityCategory[] = ["basic", "recommended", "advanced"];

const CATEGORY_LABEL: Record<SecurityCategory, string> = {
  basic: "BÁSICAS",
  recommended: "RECOMENDADAS",
  advanced: "AVANZADAS",
};

const CATEGORY_HINT: Record<SecurityCategory, string> = {
  basic: "gratis y no disruptivas",
  recommended: "dependen del repositorio actual",
  advanced: "dependientes del proyecto — revisar warnings",
};

const VISIBILITY_LABEL: Record<string, string> = {
  public: "Público",
  private: "Privado",
  internal: "Interno",
};

const STATUS_GLYPH = { ok: "✓", skip: "⚠", error: "✗" } as const;
const STATUS_TONE = {
  ok: "text-emerald-400 bg-emerald-500/15 border-emerald-500/25",
  skip: "text-amber-400 bg-amber-500/15 border-amber-500/20",
  error: "text-red-400 bg-red-500/15 border-red-500/25",
} as const;

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function BackGlyph() {
  return <span aria-hidden="true">←</span>;
}

export function RepoSecurityFlow({ onBack }: { onBack: () => void }) {
  const phase = useRepoSecurityStore((s) => s.phase);
  const audit = useRepoSecurityStore((s) => s.audit);
  const result = useRepoSecurityStore((s) => s.result);
  const sessionRuntime = useRepoSecurityStore((s) => s.sessionRuntime);
  const error = useRepoSecurityStore((s) => s.error);
  const selections = useRepoSecurityStore((s) => s.selections);
  const toggleFeature = useRepoSecurityStore((s) => s.toggleFeature);
  const toggleSubOption = useRepoSecurityStore((s) => s.toggleSubOption);

  const active = resolveActiveWorktree();

  const runAudit = () => {
    if (active) void useRepoSecurityStore.getState().runAudit(active.path);
  };

  const apply = () => {
    if (active) void useRepoSecurityStore.getState().apply(active.path);
  };

  // ── Fases transitorias ──────────────────────────────────────────────────

  if (phase === "auditing") {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
        <p className="text-xs text-[var(--text-muted)]">Auditando el repositorio…</p>
        <p className="text-[10.5px] font-mono text-[var(--text-muted)]">
          Detectando visibilidad, permisos y estado actual de cada capa
        </p>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className="flex flex-col gap-3 min-h-0 flex-1">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
            <span className="text-[11px] font-mono font-semibold text-[var(--text-secondary)]">
              Aplicando configuración de seguridad — {audit ? `${audit.owner}/${audit.repo}` : "repo"}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] shrink-0"
            onClick={() => useRepoSecurityStore.getState().cancel()}
          >
            Cancelar
          </button>
        </div>
        {sessionRuntime ? (
          <div className="relative flex-1 min-h-[240px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)]">
            <PlannerTerminalPane terminalId={sessionRuntime.terminalId} />
          </div>
        ) : (
          <div className="text-[11px] font-mono text-[var(--text-muted)] py-6 text-center animate-pulse shrink-0">
            Iniciando proceso de configuración…
          </div>
        )}
      </div>
    );
  }

  if (phase === "done" && result) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            onClick={onBack}
          >
            <BackGlyph />
            <span>Volver al diagnóstico</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)]"
            onClick={() => {
              useRepoSecurityStore.getState().reset();
              runAudit();
            }}
          >
            Revisar checklist
          </button>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
          <div className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
            ✓
          </div>
          <div className="space-y-0.5 min-w-0">
            <p className="text-xs font-bold text-[var(--text-primary)]">
              Configuración de seguridad aplicada
            </p>
            <p className="text-[10.5px] font-mono text-[var(--text-muted)]">
              {result.owner}/{result.repo} · {VISIBILITY_LABEL[result.visibility] ?? result.visibility} ·{" "}
              {new Date(result.timestamp).toLocaleString("es-AR")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Aplicadas", value: result.summary.ok, tone: "text-emerald-400" },
            { label: "Omitidas", value: result.summary.skip, tone: "text-amber-400" },
            { label: "Con error", value: result.summary.error, tone: "text-red-400" },
          ].map(({ label, value, tone }) => (
            <div key={label} className="p-3 rounded-md border border-[var(--border)] bg-[var(--bg)] text-center space-y-0.5">
              <p className={`text-base font-bold font-mono tabular-nums ${tone}`}>{value}</p>
              <p className="text-[10px] text-[var(--text-muted)] leading-tight">{label}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold block">
            RESULTADO POR CAPA
          </span>
          <div className="space-y-1.5">
            {result.features.map((f) => {
              const label = audit?.features.find((a) => a.id === f.id)?.label ?? f.id;
              return (
                <div
                  key={f.id}
                  className="p-2.5 rounded-md border text-xs flex items-center gap-3 bg-[var(--bg)] border-[var(--border)]"
                >
                  <span
                    className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${STATUS_TONE[f.status]}`}
                  >
                    {STATUS_GLYPH[f.status]} {f.status.toUpperCase()}
                  </span>
                  <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 min-w-0">
                    {label}
                  </span>
                  {f.reason && (
                    <span className="text-[10px] font-mono text-[var(--text-muted)] truncate max-w-[45%]" title={f.reason}>
                      {f.reason}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Error fatal (sin gh, sin remote…) o cancelado sin audit.
  if (phase === "idle" && !audit) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            onClick={onBack}
          >
            <BackGlyph />
            <span>Volver al diagnóstico</span>
          </button>
        </div>
        {error && (
          <div className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-red-500/8 border border-red-500/25">
            <div className="space-y-0.5 min-w-0">
              <p className="text-xs font-bold text-red-400">No se pudo auditar el repositorio</p>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{error}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost text-[11px] py-1 px-2.5 border border-[var(--border)] shrink-0"
              onClick={() => useRepoSecurityStore.getState().dismissError()}
            >
              Cerrar
            </button>
          </div>
        )}
        <div className="flex flex-col items-center py-16 text-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center border border-[var(--border)]">
            <ShieldIcon />
          </div>
          <p className="text-xs font-semibold text-[var(--text-primary)]">Seguridad del repositorio</p>
          <p className="text-[11px] text-[var(--text-muted)] max-w-sm leading-relaxed">
            Audita el estado actual del repositorio y preconfigura las capas de seguridad gratuitas.
          </p>
          <button
            type="button"
            className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0"
            onClick={runAudit}
          >
            + Auditar repositorio
          </button>
        </div>
      </div>
    );
  }

  // ── Checklist ───────────────────────────────────────────────────────────
  const pendingCount = audit ? audit.features.filter((f) => f.selectable).length : 0;
  const selectedCount = selections.features.length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          onClick={onBack}
        >
          <BackGlyph />
          <span>Volver al diagnóstico</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
            {audit ? `${audit.owner}/${audit.repo}` : ""}
          </span>
          {audit && (
            <span
              className={`text-[9.5px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                audit.visibility === "public"
                  ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/25"
                  : "text-amber-400 bg-amber-500/15 border-amber-500/20"
              }`}
            >
              {VISIBILITY_LABEL[audit.visibility]}
            </span>
          )}
        </div>
      </div>

      {audit && (
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-md border bg-[var(--bg)] border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-md bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <ShieldIcon />
            </div>
            <div className="space-y-0.5 min-w-0">
              <h3 className="text-xs font-bold text-[var(--text-primary)]">
                Seguridad del repositorio
              </h3>
              <p className="text-[10.5px] font-mono text-[var(--text-muted)]">
                {pendingCount === 0
                  ? "Todas las capas disponibles ya están configuradas ✓"
                  : `${pendingCount} capa(s) disponibles sin activar · rama principal: ${audit.defaultBranch}`}
                {!audit.isAdmin && " · sin permisos de admin"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary text-xs py-2 px-4 font-semibold shadow-xs shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={selectedCount === 0}
            onClick={apply}
          >
            Aplicar selección ({selectedCount})
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-500/8 border border-red-500/25 text-[11px] text-[var(--text-secondary)]">
          {error}
        </div>
      )}

      {CATEGORY_ORDER.map((category) => {
        const features = audit?.features.filter((f) => f.category === category) ?? [];
        if (features.length === 0) return null;
        return (
          <div key={category} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-[var(--border)]">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                {CATEGORY_LABEL[category]}
              </span>
              <span className="text-[9.5px] font-mono text-[var(--text-faint)]">{CATEGORY_HINT[category]}</span>
            </div>
            <div className="space-y-1.5">
              {features.map((feature) => (
                <FeatureRow
                  key={feature.id}
                  feature={feature}
                  checked={selections.features.includes(feature.id)}
                  selectedSubOptions={selections.subOptions[feature.id] ?? []}
                  onToggleFeature={() => toggleFeature(feature.id)}
                  onToggleSubOption={(optionId) => toggleSubOption(feature.id, optionId)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureRow({
  feature,
  checked,
  selectedSubOptions,
  onToggleFeature,
  onToggleSubOption,
}: {
  feature: SecurityAudit["features"][number];
  checked: boolean;
  selectedSubOptions: string[];
  onToggleFeature: () => void;
  onToggleSubOption: (optionId: string) => void;
}) {
  const isSelectable = feature.selectable;
  const showSubOptions = checked && feature.subOptions.length > 0;

  const recommended = feature.subOptions.filter((o) => o.tier === "recommended");
  const advanced = feature.subOptions.filter((o) => o.tier === "advanced");

  return (
    <div
      className={`p-3 rounded-md border text-xs transition-all ${
        feature.enabled
          ? "bg-emerald-500/5 border-emerald-500/20"
          : isSelectable
            ? "bg-[var(--bg)] border-[var(--border)]"
            : "bg-[var(--bg)] border-[var(--border)] opacity-60"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={!isSelectable}
          onChange={onToggleFeature}
          className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer disabled:cursor-not-allowed"
          aria-label={`Activar ${feature.label}`}
        />
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${feature.enabled ? "text-emerald-400" : "text-[var(--text-primary)]"}`}>
              {feature.label}
            </span>
            {feature.enabled && (
              <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
                Ya activo
              </span>
            )}
            {feature.reason && (
              <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/20">
                {feature.reason}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{feature.description}</p>

          {showSubOptions && (
            <div className="space-y-2 pt-1.5">
              <SubOptionGroup title="Opciones recomendadas" options={recommended} selected={selectedSubOptions} onToggle={onToggleSubOption} />
              {advanced.length > 0 && (
                <SubOptionGroup title="Opciones avanzadas" options={advanced} selected={selectedSubOptions} onToggle={onToggleSubOption} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubOptionGroup({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: SecurityAudit["features"][number]["subOptions"];
  selected: string[];
  onToggle: (optionId: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="space-y-1 pl-6">
      <span className="text-[9.5px] font-mono uppercase tracking-wider text-[var(--text-muted)] block font-semibold">
        {title}
      </span>
      {options.map((opt) => {
        const on = selected.includes(opt.id);
        return (
          <div key={opt.id} className="space-y-0.5">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(opt.id)}
                className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
                aria-label={`${opt.label} (${title})`}
              />
              <span className="text-[11px] text-[var(--text-primary)] leading-snug">{opt.label}</span>
            </label>
            <p className="text-[10.5px] text-[var(--text-muted)] leading-snug pl-5">{opt.description}</p>
            {opt.warning && on && (
              <p className="text-[10.5px] text-amber-400 leading-snug pl-5">⚠ {opt.warning}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
