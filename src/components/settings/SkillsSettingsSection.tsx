import { useEffect, useState, useCallback } from "react";
import { DIAGNOSIS_CATEGORIES } from "../../types/diagnosisCategories";
import { useNotificationStore } from "../../stores/notificationStore";

type SkillEntry = { name: string; description: string; shared: boolean; dirPath: string };
type CategorySkills = { categoryId: string; skills: SkillEntry[] };

const CategoryIcon = ({ id }: { id: string }) => {
  const icons: Record<string, string> = {
    "diseno-patrones": "M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5",
    organizacion: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10",
    documentacion: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M10 13H8 M16 17H8 M13 13h2",
    seguridad: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    proteccion: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4",
    rendimiento: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    "buenas-practicas": "M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3",
    requerimientos: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8",
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icons[id]?.split(" M").map((d, i) => <path key={i} d={(i === 0 ? "" : "M") + d} />)}
    </svg>
  );
};

export function SkillsSettingsSection() {
  const [data, setData] = useState<CategorySkills[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [specInputs, setSpecInputs] = useState<Record<string, string>>({});
  const [pasteInputs, setPasteInputs] = useState<Record<string, string>>({});
  const [pasteNames, setPasteNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [copySource, setCopySource] = useState<string>("");

  const load = useCallback(async () => {
    if (!activeProject) {
      try {
        const { resolveActiveWorktree } = await import("../../planner/planningSession");
        const active = resolveActiveWorktree();
        if (active) {
          setActiveProject(active.path);
          return;
        }
      } catch {}
      // Ola 6 H1: sin proyecto resoluble en runtime no se adivina ruta — queda sin proyecto activo.
      setActiveProject(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await (window as unknown as { termcanvas: { skills: { listForProject: (repoPath: string) => Promise<CategorySkills[]> } } }).termcanvas.skills.listForProject(activeProject);
      setData(res);
    } catch {
      try {
        const res = await (window as unknown as { termcanvas: { skills: { list: () => Promise<CategorySkills[]> } } }).termcanvas.skills.list();
        setData(res);
      } catch (e) {
        console.error(e);
      }
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    // Detectar proyecto activo al montar — TermCanvas ya sabe cuál está cargado
    (async () => {
      try {
        const { resolveActiveWorktree } = await import("../../planner/planningSession");
        const active = resolveActiveWorktree();
        if (active) setActiveProject(active.path);
        else setActiveProject(null);
      } catch {
        setActiveProject(null);
      }
    })();
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleExpand = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleRemove = async (categoryId: string, skillName: string) => {
    if (!confirm(`¿Eliminar "${skillName}" de ${categoryId}?`)) return;
    if (!activeProject) return;
    setBusy(skillName);
    const perProject = (window as unknown as { termcanvas: { skills: { removeForProject?: (repoPath: string, c: string, n: string) => Promise<{ ok: boolean; error?: string }> } } }).termcanvas.skills.removeForProject;
    const res = perProject
      ? await perProject(activeProject, categoryId, skillName)
      : await (window as unknown as { termcanvas: { skills: { remove: (c: string, n: string) => Promise<{ ok: boolean; error?: string }> } } }).termcanvas.skills.remove(categoryId, skillName);
    if (!res.ok) useNotificationStore.getState().notify("error", res.error ?? "No se pudo eliminar");
    else {
      useNotificationStore.getState().notify("info", `Eliminada ${skillName}`);
      await load();
    }
    setBusy(null);
  };

  const handleReveal = async (dirPath: string) => {
    try {
      await (window as unknown as { termcanvas: { fs: { reveal: (p: string) => Promise<void> } } }).termcanvas.fs.reveal(dirPath);
    } catch (e) {
      console.error(e);
    }
  };

  const handlePickFile = async (categoryId: string) => {
    if (!activeProject) return;
    const dlg = await (window as unknown as { termcanvas: { dialog: { openSkillFile: () => Promise<{ canceled: true } | { canceled: false; filePath: string }> } } }).termcanvas.dialog.openSkillFile();
    if (dlg.canceled) return;
    setBusy(categoryId + ":file");
    const api = (window as unknown as { termcanvas: { skills: { saveFromFileForProject?: (repoPath: string, c: string, p: string) => Promise<{ ok: boolean; error?: string }>; saveFromFile: (c: string, p: string, s: boolean) => Promise<{ ok: boolean; error?: string }> } } }).termcanvas.skills;
    const res = api.saveFromFileForProject
      ? await api.saveFromFileForProject(activeProject, categoryId, dlg.filePath)
      : await api.saveFromFile(categoryId, dlg.filePath, true);
    if (!res.ok) useNotificationStore.getState().notify("error", res.error ?? "Error al guardar");
    else {
      useNotificationStore.getState().notify("info", "Skill importada");
      await load();
    }
    setBusy(null);
  };

  const handleFetchSpec = async (categoryId: string) => {
    const spec = (specInputs[categoryId] ?? "").trim();
    if (!spec || !activeProject) return;
    setBusy(categoryId + ":spec");
    const api = (window as unknown as { termcanvas: { skills: { fetchBySpecForProject?: (spec: string, repoPath: string, c: string) => Promise<{ ok: boolean; error?: string }>; fetchBySpec: (s: string, c: string, sh: boolean) => Promise<{ ok: boolean; error?: string }> } } }).termcanvas.skills;
    const res = api.fetchBySpecForProject
      ? await api.fetchBySpecForProject(spec, activeProject, categoryId)
      : await api.fetchBySpec(spec, categoryId, true);
    if (!res.ok) useNotificationStore.getState().notify("error", res.error ?? "No se pudo descargar");
    else {
      useNotificationStore.getState().notify("info", "Skill descargada");
      setSpecInputs((p) => ({ ...p, [categoryId]: "" }));
      await load();
    }
    setBusy(null);
  };

  const handlePasteSave = async (categoryId: string) => {
    const content = (pasteInputs[categoryId] ?? "").trim();
    const name = (pasteNames[categoryId] ?? "").trim();
    if (!content || !name || !activeProject) {
      useNotificationStore.getState().notify("error", "Completá nombre y contenido");
      return;
    }
    setBusy(categoryId + ":paste");
    const api = (window as unknown as { termcanvas: { skills: { saveFromContentForProject?: (repoPath: string, c: string, n: string, ct: string) => Promise<{ ok: boolean; error?: string }>; saveFromContent: (c: string, n: string, ct: string, s: boolean) => Promise<{ ok: boolean; error?: string }> } } }).termcanvas.skills;
    const res = api.saveFromContentForProject
      ? await api.saveFromContentForProject(activeProject, categoryId, name, content)
      : await api.saveFromContent(categoryId, name, content, true);
    if (!res.ok) useNotificationStore.getState().notify("error", res.error ?? "Error al guardar");
    else {
      useNotificationStore.getState().notify("info", "Skill guardada");
      setPasteInputs((p) => ({ ...p, [categoryId]: "" }));
      setPasteNames((p) => ({ ...p, [categoryId]: "" }));
      await load();
    }
    setBusy(null);
  };

  const handleCopyAll = async () => {
    if (!copySource || !activeProject) {
      useNotificationStore.getState().notify("error", "Elegí una carpeta origen");
      return;
    }
    if (copySource === activeProject) {
      useNotificationStore.getState().notify("error", "Origen y destino son el mismo");
      return;
    }
    if (!confirm(`¿Copiar TODAS las skills de ${copySource.split(/[\\/]/).pop()} → ${activeProject.split(/[\\/]/).pop()}? (8 categorías)`)) return;
    setBusy("copyAll");
    const api = (window as unknown as { termcanvas: { skills: { copyAll?: (from: string, to: string) => Promise<{ ok: boolean; error?: string; copied?: number }> } } }).termcanvas.skills;
    if (!api.copyAll) {
      useNotificationStore.getState().notify("error", "Función no disponible — actualizá la app");
      setBusy(null);
      return;
    }
    const res = await api.copyAll(copySource, activeProject);
    if (!res.ok) useNotificationStore.getState().notify("error", res.error ?? "No se pudo copiar");
    else {
      useNotificationStore.getState().notify("info", `Copiadas ${res.copied ?? "?"} skills`);
      await load();
    }
    setBusy(null);
  };

  const handlePickCopySource = async () => {
    try {
      const picked = await (window as unknown as { termcanvas: { project: { selectDirectory: () => Promise<string | null> } } }).termcanvas.project.selectDirectory();
      if (picked) setCopySource(picked);
    } catch (e) {
      console.error(e);
    }
  };

  if (loading && !activeProject) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-[13px] text-[var(--text-muted)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
          Cargando…
        </div>
      </div>
    );
  }

  const totalSkills = data.reduce((acc, c) => acc + c.skills.length, 0);
  const activeName = activeProject ? activeProject.split(/[\\/]/).pop() ?? activeProject : "—";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-[16px] bg-[var(--surface)]/40 p-4" style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.04), 0 4px 12px oklch(0 0 0 / 0.06)", outline: "1px solid oklch(0 0 0 / 0.06)", outlineOffset: "-1px" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent)]/10 text-[var(--accent)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M9 22V12h6v10" /></svg>
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Proyecto</span>
            <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{activeName}</span>
            <span className="truncate font-mono text-[11px] text-[var(--text-faint)]">{activeProject}</span>
          </div>
          <span className="ml-auto hidden sm:inline-flex items-center rounded-full bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] border border-[var(--border)]">
            {totalSkills} skills
          </span>
        </div>
        <p className="text-[11px] leading-4 text-[var(--text-secondary)]">
          Las skills viven en <span className="font-mono text-[11px] bg-[var(--surface)] px-1 py-0.5 rounded border border-[var(--border)]">&lt;repo&gt;/.agents/diagnosis-skills/&lt;categoria&gt;/&lt;skill&gt;/SKILL.md</span> — sincronizadas vía <strong>Sincronización</strong> en el modal general.
        </p>
        <p className="text-[11px] leading-4 text-[var(--text-muted)] rounded-[10px] border border-[var(--border)] bg-[var(--bg)]/60 px-3 py-2">
          Tip: usá los switches de <strong>Sincronización</strong> ( Entrevistas · Diagnósticos · MCPs · Skills ) para elegir qué viaja entre máquinas. Los secretos de MCP nunca se sincronizan.
        </p>
        <div className="flex flex-col gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/30 p-3.5">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">Copiar valija entera</span>
          <span className="text-[11px] leading-4 text-[var(--text-secondary)]">Clona las 8 categorías de otro proyecto a este.</span>
          <div className="flex gap-2">
            <button type="button" onClick={handlePickCopySource} className="flex-1 truncate rounded-full border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2 text-left text-[12px] text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-colors">
              {copySource ? copySource : "Elegir carpeta origen…"}
            </button>
            <button type="button" disabled={busy === "copyAll" || !copySource || !activeProject} onClick={handleCopyAll} className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--bg)] hover:brightness-110 active:scale-[0.96] disabled:opacity-50 transition-[transform,filter] duration-150 will-change-transform">
              {busy === "copyAll" ? "Copiando…" : "Copiar todo"}
            </button>
          </div>
          {copySource && <span className="truncate font-mono text-[10px] text-[var(--text-faint)]">{copySource}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {DIAGNOSIS_CATEGORIES.map((cat, idx) => {
          const entry = data.find((d) => d.categoryId === cat.id);
          const skills = entry?.skills ?? [];
          const isExpanded = expanded.has(cat.id);
          return (
            <div key={cat.id} className="group relative overflow-hidden rounded-[16px] bg-[var(--surface)]/40 will-change-transform" style={{ boxShadow: isExpanded ? "0 1px 2px oklch(0 0 0 / 0.05), 0 8px 24px oklch(0 0 0 / 0.08)" : "0 1px 2px oklch(0 0 0 / 0.04), 0 2px 8px oklch(0 0 0 / 0.04)", outline: "1px solid oklch(0 0 0 / 0.06)", outlineOffset: "-1px", animation: "skills-enter 0.4s cubic-bezier(0.2, 0, 0, 1) both", animationDelay: `${idx * 80}ms`, transition: "box-shadow 200ms cubic-bezier(0.2, 0, 0, 1)" }}>
              <button type="button" onClick={() => toggleExpand(cat.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--surface-hover)]/50 active:scale-[0.99] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] will-change-transform" style={{ transitionProperty: "background-color, transform" }}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--bg)] text-[var(--text-secondary)] border border-[var(--border)] group-hover:text-[var(--text-primary)] transition-colors duration-150">
                  <CategoryIcon id={cat.id} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium leading-none text-[var(--text-primary)]">{cat.label}</span>
                    {skills.length > 0 && <span className="inline-flex items-center rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--accent)]">{skills.length}</span>}
                  </div>
                  <span className="truncate text-[12px] leading-4 text-[var(--text-secondary)]">{cat.description}</span>
                </div>
                <div className="relative ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors duration-150">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </button>
              <div className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.2,0,0,1)]" style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}>
                <div className="overflow-hidden">
                  <div className="border-t border-[var(--border)] bg-[var(--bg)]/30 p-4 flex flex-col gap-5">
                    {skills.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--surface)]/30 px-4 py-8 text-center">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-faint)]">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /></svg>
                        </div>
                        <p className="text-[12px] font-medium text-[var(--text-secondary)]">Sin skills — solo la metodología diag-{cat.id}</p>
                        <p className="text-[11px] text-[var(--text-muted)] max-w-[32ch]">Agregá una skill abajo. Se usará solo durante el diagnóstico de esta categoría en este proyecto.</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {skills.map((s) => (
                          <div key={s.name} className="group/skill flex items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3 hover:border-[var(--border-hover)] hover:bg-[var(--surface)] transition-colors duration-150" style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.04)" }}>
                            <div className="min-w-0 flex flex-1 items-center gap-3">
                              <div className="hidden sm:flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)]">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M10 13H8M16 17H8" /></svg>
                              </div>
                              <div className="min-w-0 flex flex-col gap-1">
                                <span className="font-mono text-[12px] font-medium text-[var(--text-primary)]">{s.name}</span>
                                <span className="line-clamp-1 text-[11px] leading-4 text-[var(--text-secondary)]">{s.description}</span>
                                <span className="hidden sm:block truncate font-mono text-[10px] text-[var(--text-faint)]">{s.dirPath}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button type="button" onClick={() => handleReveal(s.dirPath)} className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] active:scale-[0.96] transition-[transform,background-color,color,border-color] duration-150 will-change-transform" aria-label={`Abrir carpeta de ${s.name}`} title="Abrir carpeta">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                              </button>
                              <button type="button" disabled={busy === s.name} onClick={() => handleRemove(cat.id, s.name)} className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent bg-transparent text-[var(--text-faint)] hover:bg-[var(--red)]/10 hover:text-[var(--red)] hover:border-[var(--red)]/20 active:scale-[0.96] disabled:opacity-50 transition-[transform,background-color,color,border-color] duration-150 will-change-transform" aria-label={`Eliminar ${s.name}`}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6" /></svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="group/card relative flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50 p-3.5 hover:border-[var(--border-hover)] hover:bg-[var(--surface)] hover:shadow-[0_2px_8px_oklch(0_0_0/0.06)] transition-all duration-150">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[var(--accent)]/10 text-[var(--accent)]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M12 11v6" /><path d="M9 14l3 3 3-3" /></svg>
                          </div>
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">Archivo</span>
                        </div>
                        <p className="text-[11px] leading-4 text-[var(--text-secondary)]">Elegí un <span className="font-mono">SKILL.md</span> de tu disco.</p>
                        <button type="button" disabled={busy === cat.id + ":file"} onClick={() => handlePickFile(cat.id)} className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[var(--text-primary)] px-3 py-2 text-[12px] font-medium text-[var(--bg)] hover:brightness-110 active:scale-[0.96] disabled:opacity-50 transition-[transform,filter] duration-150 will-change-transform">
                          {busy === cat.id + ":file" ? "Cargando…" : "Elegir archivo…"}
                        </button>
                      </div>
                      <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/50 p-3.5 hover:border-[var(--border-hover)] hover:bg-[var(--surface)] hover:shadow-[0_2px_8px_oklch(0_0_0/0.06)] transition-all duration-150 sm:col-span-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[var(--accent)]/10 text-[var(--accent)]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 18l6-6-6-6" /><path d="M8 6l-6 6 6 6" /></svg>
                          </div>
                          <span className="text-[12px] font-medium text-[var(--text-primary)]">Comando skills.sh</span>
                          <span className="ml-auto rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">Recomendado</span>
                        </div>
                        <code className="block rounded-[8px] bg-[var(--bg)] border border-[var(--border)] px-2.5 py-2 font-mono text-[10px] leading-4 text-[var(--text-secondary)] break-all">npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices</code>
                        <div className="flex gap-2">
                          <input type="text" placeholder="Pegá acá el comando npx skills add …" value={specInputs[cat.id] ?? ""} onChange={(e) => setSpecInputs((p) => ({ ...p, [cat.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") handleFetchSpec(cat.id); }} className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition-[border-color,box-shadow] duration-150" />
                          <button type="button" disabled={busy === cat.id + ":spec" || !(specInputs[cat.id] ?? "").trim()} onClick={() => handleFetchSpec(cat.id)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-[12px] font-medium text-[var(--accent-foreground)] hover:brightness-110 active:scale-[0.96] disabled:opacity-50 transition-[transform,filter] duration-150 will-change-transform">
                            {busy === cat.id + ":spec" ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Descargando…</> : "Descargar"}
                          </button>
                        </div>
                      </div>
                    </div>
                    <details className="group/details rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/30 open:bg-[var(--surface)]/50 transition-colors duration-150">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center gap-2">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>
                          Pegar SKILL.md manualmente
                        </span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="transition-transform duration-200 group-open/details:rotate-180"><path d="M6 9l6 6 6-6" /></svg>
                      </summary>
                      <div className="flex flex-col gap-3 border-t border-[var(--border)] p-3.5">
                        <input type="text" placeholder="nombre de la skill (slug, ej: mi-checklist)" value={pasteNames[cat.id] ?? ""} onChange={(e) => setPasteNames((p) => ({ ...p, [cat.id]: e.target.value }))} className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition-[border-color,box-shadow] duration-150" />
                        <textarea placeholder="Pegá acá el contenido completo del SKILL.md (con frontmatter --- name/description ---)…" value={pasteInputs[cat.id] ?? ""} onChange={(e) => setPasteInputs((p) => ({ ...p, [cat.id]: e.target.value }))} rows={5} className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[11px] leading-4 text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition-[border-color,box-shadow] duration-150 resize-y" />
                        <div className="flex justify-end">
                          <button type="button" disabled={busy === cat.id + ":paste"} onClick={() => handlePasteSave(cat.id)} className="inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface)] hover:border-[var(--border-hover)] active:scale-[0.96] disabled:opacity-50 transition-[transform,background-color,border-color] duration-150 will-change-transform">
                            Guardar pegado
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
