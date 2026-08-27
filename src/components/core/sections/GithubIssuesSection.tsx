// Sección INTEGRACIONES → GitHub Issues.
//
// Conversión REAL de hallazgos de diagnóstico a issues (github.createIssue).
// Extraída VERBATIM del cuerpo de CoreArchitectureModal: los issues SOLO se
// crean a partir de Planning; el estado de conversión/selección/labels es
// exclusivo de esta sección y el filtro FUENTE — DIAGNÓSTICO vive en el
// contexto (el shell lo resetea al navegar).

import { useEffect, useState } from "react";
import { buildFindingIssueBody } from "../../../planner/issueTemplate";
import {
  DIAGNOSIS_CATEGORIES,
  LEGACY_CATEGORY_ID,
  categoryLabel,
} from "../../../types/diagnosisCategories";
import { resolveActiveWorktree } from "../../../planner/planningSession";
import { useNotificationStore } from "../../../stores/notificationStore";
import { useCoreModal } from "../context";
import {
  ExternalLinkIcon,
  GitHubIcon,
  sortFindingsBySeverity,
} from "../shared";

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
  // Categoría del diagnóstico que emitió el hallazgo ("general" para los
  // previos al feature): alimenta el filtro CATEGORÍA del visor.
  diagCategory: string;
}

type IssueStatus =
  | { status: "pending" }
  | { status: "converting" }
  | { status: "converted"; issueNumber: number; url: string };

export function GithubIssuesSection() {
  const {
    navigate,
    search,
    setSearch,
    synthLoading,
    diagHistory,
    githubDiagFilter,
    setGithubDiagFilter,
    githubCategoryFilter,
    setGithubCategoryFilter,
  } = useCoreModal();

  const [issueState, setIssueState] = useState<Record<string, IssueStatus>>({});
  const [selectedForIssue, setSelectedForIssue] = useState<string[]>([]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);

  useEffect(() => {
    const active = resolveActiveWorktree();
    if (!active) return;
    void window.termcanvas.github
      .listLabels(active.path)
      .then((res) => setAvailableLabels(res.ok ? res.labels.map((l) => l.name) : []))
      .catch(() => setAvailableLabels([]));
  }, []);

  // Los issues SOLO se crean a partir de Planning: los hallazgos de los
  // diagnósticos completados (diseño v2), ordenados por criticidad.
  // RFs/ASRs/restricciones/glosario se ven en sus secciones, NO como issues.
  // El body se compone con el template de bug report del finding (mismo
  // ensamblado que el planner): si el finding trae template (los planes
  // nuevos lo traen por contrato), el issue se crea con el formulario
  // completo; si no (planes viejos), cae a la description sola.
  const convertibleItems: ConvertibleItem[] = diagHistory.flatMap((rec) =>
    sortFindingsBySeverity(rec.data.findings).map((finding, idx) => ({
      id: `${rec.id}::${idx}`,
      title: finding.title,
      body: buildFindingIssueBody(
        finding,
        `https://github.com/${rec.data.repo}`,
      ),
      categoryLabel: "Hallazgo de diagnóstico",
      priorityTag: finding.severity,
      githubLabels: [`severity: ${finding.severity}`, ...(finding.labels ?? [])],
      diagId: rec.id,
      fileLine: `${finding.file}:${finding.line}`,
      diagCategory: rec.category ?? rec.data.categoria ?? LEGACY_CATEGORY_ID,
    })),
  );

  const filteredIssueItems = convertibleItems.filter((item) => {
    const matchesSearch =
      item.id.toLowerCase().includes(search.toLowerCase()) ||
      item.title.toLowerCase().includes(search.toLowerCase());
    const matchesDiag =
      githubDiagFilter === "all" || item.diagId === githubDiagFilter;
    const matchesCategory =
      githubCategoryFilter === "all" || item.diagCategory === githubCategoryFilter;
    return matchesSearch && matchesDiag && matchesCategory;
  });

  // Chips del filtro CATEGORÍA: las del registro en su orden canónico, más
  // cualquier categoría desconocida (plan de una versión futura) al final.
  const presentCategories = [
    ...DIAGNOSIS_CATEGORIES.map((c) => c.id).filter((id) =>
      convertibleItems.some((i) => i.diagCategory === id),
    ),
    ...[...new Set(convertibleItems.map((i) => i.diagCategory))].filter(
      (id) => !DIAGNOSIS_CATEGORIES.some((c) => c.id === id),
    ),
  ];

  const allFilteredIds = filteredIssueItems.map((i) => i.id);
  const isAllSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedForIssue.includes(id));

  // ── GitHub Issues (REAL: github.createIssue con labels existentes) ────
  const convertToIssue = async (id: string) => {
    const item = convertibleItems.find((i) => i.id === id);
    if (!item) return;
    setIssueState((prev) => ({ ...prev, [id]: { status: "converting" } }));
    try {
      const active = resolveActiveWorktree();
      if (!active) throw new Error("Open a project first.");
      // Se pasan TODAS las labels del hallazgo (severity + temáticas): el
      // handler github:create-issue asegura las que no existen en el repo
      // (gh label create --force) antes de crear el issue, así el issue
      // sale siempre etiquetado. No filtrar por availableLabels — ese filtro
      // descartaba las severity/temáticas nuevas y dejaba el issue sin
      // etiquetas (bug reportado en el E2E del 20/8).
      const labels = item.githubLabels;
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

  return (
    <>
      {synthLoading ? (
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
            onClick={() => navigate("planning_diagnosis")}
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

            {/* CATEGORÍA: filtra por la categoría del diagnóstico que emitió
                cada hallazgo; compone con el filtro de origen de arriba. */}
            {presentCategories.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-[var(--border)]">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold block">
                  CATEGORÍA
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors border ${
                      githubCategoryFilter === "all"
                        ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)] font-semibold"
                        : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]"
                    }`}
                    onClick={() => {
                      setGithubCategoryFilter("all");
                      setSelectedForIssue([]);
                    }}
                  >
                    Todas ({convertibleItems.length})
                  </button>
                  {presentCategories.map((id) => {
                    const count = convertibleItems.filter(
                      (i) => i.diagCategory === id,
                    ).length;
                    const isActive = githubCategoryFilter === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors border max-w-[220px] truncate ${
                          isActive
                            ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-[var(--accent)] font-semibold"
                            : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]"
                        }`}
                        onClick={() => {
                          setGithubCategoryFilter(id);
                          setSelectedForIssue([]);
                        }}
                        title={id}
                      >
                        {categoryLabel(id)} · {count}
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
                          {categoryLabel(item.diagCategory)}
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
                            title={availableLabels.includes(lbl) ? undefined : "Label inexistente en el repo: se crea automáticamente al convertir"}
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
      )}
    </>
  );
}
