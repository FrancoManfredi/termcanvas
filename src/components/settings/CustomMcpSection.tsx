import { useState, useCallback, useEffect, useRef } from "react";
import type { McpCatalogEntry } from "../../../shared/mcp";

const MONO = { fontFamily: '"Geist Mono", monospace' } as const;

interface Props {
  projectId: string;
  projectPath: string;
  customs: McpCatalogEntry[];
  onRefresh: () => void;
}

function validateId(id: string): string | null {
  if (!id) return "Requerido";
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) return "2–32: a–z, 0–9, -, _";
  return null;
}

type FieldErrors = Partial<Record<"id" | "name" | "description" | "url" | "command" | "authLabel" | "authEnvVar", string>>;

export function CustomMcpSection({ projectId, projectPath, customs, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<McpCatalogEntry>>({
    id: "",
    name: "",
    description: "",
    transport: "http",
    defaultUrl: "",
    defaultCommand: "",
    defaultArgs: [],
    auth: null,
  });
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authLabel, setAuthLabel] = useState("");
  const [authPlaceholder, setAuthPlaceholder] = useState("");
  const [authEnvVar, setAuthEnvVar] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const resetForm = useCallback(() => {
    setForm({
      id: "",
      name: "",
      description: "",
      transport: "http",
      defaultUrl: "",
      defaultCommand: "",
      defaultArgs: [],
      auth: null,
    });
    setAuthEnabled(false);
    setAuthLabel("");
    setAuthPlaceholder("");
    setAuthEnvVar("");
    setEditingId(null);
    setFieldErrors({});
    setServerError(null);
  }, []);

  const openAdd = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((entry: McpCatalogEntry) => {
    setForm({ ...entry, defaultArgs: entry.defaultArgs ? [...entry.defaultArgs] : [] });
    setEditingId(entry.id);
    if (entry.auth) {
      setAuthEnabled(true);
      setAuthLabel(entry.auth.label);
      setAuthPlaceholder(entry.auth.placeholder);
      setAuthEnvVar(entry.auth.envVar ?? "");
    } else {
      setAuthEnabled(false);
      setAuthLabel("");
      setAuthPlaceholder("");
      setAuthEnvVar("");
    }
    setFieldErrors({});
    setServerError(null);
    setShowForm(true);
  }, []);

  useEffect(() => {
    if (showForm) {
      requestAnimationFrame(() => firstInputRef.current?.focus());
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setShowForm(false);
          resetForm();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [showForm, resetForm]);

  useEffect(() => {
    if (!showForm || !dialogRef.current) return;
    const el = dialogRef.current;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null);
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", handler as any);
    return () => el.removeEventListener("keydown", handler as any);
  }, [showForm]);

  const validate = useCallback((): boolean => {
    const errs: FieldErrors = {};
    const idErr = validateId((form.id as string) ?? "");
    if (idErr) errs.id = idErr;
    if (!form.name?.trim()) errs.name = "Requerido";
    if (!form.description?.trim()) errs.description = "Requerido";
    if (form.transport === "http") {
      const url = form.defaultUrl?.trim() ?? "";
      if (!url) errs.url = "Requerido";
      else {
        try {
          new URL(url);
        } catch {
          errs.url = "URL inválida";
        }
      }
    } else {
      if (!form.defaultCommand?.trim()) errs.command = "Requerido";
    }
    if (authEnabled) {
      if (!authLabel.trim()) errs.authLabel = "Requerido";
      if (!authEnvVar.trim()) errs.authEnvVar = "Requerido";
      else if (!/^[A-Z][A-Z0-9_]*$/.test(authEnvVar.trim())) errs.authEnvVar = "Mayúsculas, _ y números (ej. MY_TOKEN)";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form, authEnabled, authLabel, authEnvVar]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;

    const entry: McpCatalogEntry = {
      id: (form.id as string).trim(),
      name: form.name!.trim(),
      description: form.description!.trim(),
      transport: form.transport as "http" | "stdio",
      auth: authEnabled
        ? { label: authLabel.trim(), placeholder: authPlaceholder.trim() || "…", envVar: authEnvVar.trim(), helpUrl: undefined }
        : null,
    };
    if (entry.transport === "http") entry.defaultUrl = form.defaultUrl!.trim();
    else {
      entry.defaultCommand = form.defaultCommand!.trim();
      const raw = form.defaultArgs;
      if (Array.isArray(raw)) entry.defaultArgs = raw.filter((a) => typeof a === "string" && a.trim());
      else if (typeof raw === "string") entry.defaultArgs = (raw as string).split(/\s+/).filter(Boolean);
      else entry.defaultArgs = [];
    }

    setSaving(true);
    setServerError(null);
    try {
      if (editingId) {
        const res: any = await (window as any).termcanvas.mcp.updateCustom(projectId, projectPath, editingId, entry);
        if (!res.ok) throw new Error(res.error);
      } else {
        const res: any = await (window as any).termcanvas.mcp.addCustom(projectId, projectPath, entry);
        if (!res.ok) throw new Error(res.error);
      }
      setShowForm(false);
      resetForm();
      onRefresh();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, authEnabled, authLabel, authPlaceholder, authEnvVar, editingId, projectId, projectPath, onRefresh, resetForm, validate]);

  const handleRemove = useCallback(
    async (id: string) => {
      if (!confirm(`¿Eliminar MCP personalizado "${id}"? Esta acción no se puede deshacer.`)) return;
      try {
        const res: any = await (window as any).termcanvas.mcp.removeCustom(projectId, projectPath, id);
        if (!res.ok) throw new Error(res.error);
        onRefresh();
      } catch (e) {
        setServerError(e instanceof Error ? e.message : String(e));
      }
    },
    [projectId, projectPath, onRefresh],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]" style={MONO}>
            MCPs personalizados
          </h4>
          <span className="inline-flex items-center rounded-full bg-[var(--surface)] border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-muted)]" style={MONO}>
            {customs.length}
          </span>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--text-primary)] px-3.5 py-1.5 text-[12px] font-medium leading-none text-[var(--bg)] shadow-sm will-change-transform transition-[transform,filter] duration-150 hover:brightness-[1.08] active:scale-[0.96]"
          style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Agregar MCP
        </button>
      </div>

      <p className="text-[11px] leading-4 text-[var(--text-muted)]">
        Servidores propios: remotos por URL o locales por comando. Se guardan por proyecto y aparecen junto a los del catálogo.
      </p>

      {serverError && !showForm && (
        <div className="flex items-start gap-2 rounded-[12px] border border-[var(--red)]/20 bg-[var(--red-soft)] px-3.5 py-3 text-[11px] leading-4 text-[var(--red)]">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--red)]/15 text-[var(--red)] flex-shrink-0">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M12 8v4 M12 16h.01" /></svg>
          </span>
          <span className="min-w-0 break-words">{serverError}</span>
        </div>
      )}

      {customs.length === 0 && !showForm ? (
        <div
          className="flex flex-col items-center gap-3 rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)]/20 px-6 py-8 text-center"
          style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.03)" }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M12 11v6" />
              <path d="M9 14l3 3 3-3" />
            </svg>
          </div>
          <p className="text-[13px] font-medium text-[var(--text-secondary)]">Sin MCPs personalizados</p>
          <p className="max-w-[34ch] text-[11px] leading-4 text-[var(--text-muted)]">Agregá un servidor remoto (URL) o local (npx/comando). Quedará disponible solo para este proyecto.</p>
          <button
            type="button"
            onClick={openAdd}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3.5 py-1.5 text-[12px] font-medium leading-none text-[var(--text-secondary)] will-change-transform transition-[transform,background-color,border-color,color] duration-150 hover:border-[var(--border-hover)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] active:scale-[0.96]"
            style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
          >
            Crear el primero
          </button>
        </div>
      ) : customs.length > 0 ? (
        <div className="flex flex-col gap-2">
          {customs.map((c, idx) => (
            <div
              key={c.id}
              className="group flex items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/40 px-3.5 py-3 will-change-transform transition-[border-color,background-color,transform] duration-150 hover:border-[var(--border-hover)] hover:bg-[var(--surface)]/60 active:scale-[0.99]"
              style={{
                transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
                animation: "mcp-custom-in 0.38s cubic-bezier(0.2, 0, 0, 1) both",
                animationDelay: `${idx * 40}ms`,
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">{c.name}</span>
                  <span className="rounded-full bg-[var(--surface)] border border-[var(--border)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--text-faint)]" style={MONO}>
                    {c.id}
                  </span>
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest ${c.transport === "http" ? "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"}`}
                    style={MONO}
                  >
                    {c.transport}
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-[11px] leading-4 text-[var(--text-muted)]">{c.description}</p>
                <p className="mt-1 truncate text-[11px] leading-none text-[var(--text-faint)]" style={MONO} title={c.transport === "http" ? c.defaultUrl : `${c.defaultCommand} ${(c.defaultArgs ?? []).join(" ")}`}>
                  {c.transport === "http" ? c.defaultUrl : `${c.defaultCommand} ${(c.defaultArgs ?? []).join(" ")}`}
                </p>
                {c.auth && (
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/15 px-2 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-300" style={MONO}>
                    token · {c.auth.envVar}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openEdit(c)}
                  className="inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[11px] font-medium leading-none text-[var(--text-secondary)] will-change-transform transition-[transform,background-color,border-color,color] duration-150 hover:bg-[var(--surface)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] active:scale-[0.96]"
                  style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemove(c.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent bg-transparent text-[var(--text-faint)] will-change-transform transition-[transform,background-color,color,border-color] duration-150 hover:bg-[var(--red-soft)] hover:text-[var(--red)] hover:border-[var(--red)]/20 active:scale-[0.96]"
                  style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                  aria-label={`Eliminar ${c.name}`}
                  title="Eliminar"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Dialog */}
      {showForm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <button type="button" aria-label="Cerrar" onClick={() => { setShowForm(false); resetForm(); }} className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[8px] tc-enter-fade" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Editar MCP" : "Nuevo MCP"}
            className="relative flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--bg)] shadow-2xl tc-enter-fade-up"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h5 className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">{editingId ? "Editar MCP" : "Nuevo MCP personalizado"}</h5>
                <p className="text-[11px] leading-4 text-[var(--text-muted)]">Quedará disponible solo para este proyecto.</p>
              </div>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:scale-[0.96] transition-[transform,background-color,color] duration-150 will-change-transform"
                style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                aria-label="Cerrar"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
              {/* Identidad */}
              <div className="flex flex-col gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]" style={MONO}>
                  Identidad
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      ID <span className="font-normal text-[var(--text-faint)]">· a–z, 0–9, -, _</span>
                      <span className="text-[var(--red)]"> *</span>
                    </span>
                    <input
                      ref={firstInputRef}
                      value={form.id ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, id: e.target.value.toLowerCase() }))}
                      disabled={!!editingId}
                      placeholder="mi-servidor"
                      aria-invalid={!!fieldErrors.id}
                      className={`rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none will-change-transform transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-[var(--text-faint)] disabled:opacity-60 ${fieldErrors.id ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"}`}
                      style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                    />
                    {fieldErrors.id && <span className="text-[11px] text-[var(--red)]">{fieldErrors.id}</span>}
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      Nombre <span className="text-[var(--red)]">*</span>
                    </span>
                    <input
                      value={form.name ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Mi Servidor"
                      aria-invalid={!!fieldErrors.name}
                      className={`rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 ${fieldErrors.name ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"}`}
                      style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                    />
                    {fieldErrors.name && <span className="text-[11px] text-[var(--red)]">{fieldErrors.name}</span>}
                  </label>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                    Descripción <span className="text-[var(--red)]">*</span>
                  </span>
                  <input
                    value={form.description ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Qué hace este MCP"
                    aria-invalid={!!fieldErrors.description}
                    className={`rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 ${fieldErrors.description ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"}`}
                    style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                  />
                  {fieldErrors.description && <span className="text-[11px] text-[var(--red)]">{fieldErrors.description}</span>}
                </label>
              </div>

              {/* Transporte */}
              <div className="flex flex-col gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]" style={MONO}>
                  Transporte
                </span>
                <div className="inline-flex self-start rounded-full border border-[var(--border)] bg-[var(--surface)]/60 p-0.5">
                  {(["http", "stdio"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, transport: v }))}
                      className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium leading-none transition-colors duration-150 ${form.transport === v ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
                      style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                    >
                      {v === "http" ? "Remote · HTTP" : "Local · stdio"}
                    </button>
                  ))}
                </div>

                {form.transport === "http" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                      URL <span className="text-[var(--red)]">*</span>
                    </span>
                    <input
                      value={form.defaultUrl ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, defaultUrl: e.target.value }))}
                      placeholder="https://mcp.example.com/mcp"
                      aria-invalid={!!fieldErrors.url}
                      className={`rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 ${fieldErrors.url ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"}`}
                      style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                    />
                    {fieldErrors.url ? <span className="text-[11px] text-[var(--red)]">{fieldErrors.url}</span> : <span className="text-[11px] text-[var(--text-faint)]">Endpoint remoto del MCP (debe responder JSON-RPC initialize).</span>}
                  </label>
                ) : (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                        Command <span className="text-[var(--red)]">*</span>
                      </span>
                      <input
                        value={form.defaultCommand ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, defaultCommand: e.target.value }))}
                        placeholder="npx"
                        aria-invalid={!!fieldErrors.command}
                        className={`rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 ${fieldErrors.command ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"}`}
                        style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                      />
                      {fieldErrors.command && <span className="text-[11px] text-[var(--red)]">{fieldErrors.command}</span>}
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">Args</span>
                      <input
                        value={Array.isArray(form.defaultArgs) ? (form.defaultArgs as string[]).join(" ") : (form.defaultArgs as unknown as string) ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, defaultArgs: e.target.value.split(/\s+/).filter(Boolean) as unknown as string[] }))}
                        placeholder="-y @modelcontextprotocol/server-memory"
                        className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"
                        style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                      />
                      <span className="text-[11px] leading-4 text-[var(--text-faint)]">
                        Separados por espacio. Usá <code style={MONO} className="rounded-[6px] bg-[var(--surface)] border border-[var(--border)] px-1 py-0.5 text-[11px]">{`{projectPath}`}</code> si necesitás la ruta del proyecto.
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Auth */}
              <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/30 p-3.5">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={authEnabled} onChange={(e) => setAuthEnabled(e.target.checked)} className="h-3.5 w-3.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] focus:ring-2" />
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">Requiere token</span>
                  <span className="text-[11px] text-[var(--text-faint)]">— vault cifrado, no va a Git</span>
                </label>
                {authEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                        Label <span className="text-[var(--red)]">*</span>
                      </span>
                      <input value={authLabel} onChange={(e) => setAuthLabel(e.target.value)} placeholder="API Token" aria-invalid={!!fieldErrors.authLabel} className={`rounded-[10px] border bg-[var(--bg)] px-3 py-2 text-[12px] leading-none outline-none transition-[border-color,box-shadow] duration-150 ${fieldErrors.authLabel ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--surface)]"}`} style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} />
                      {fieldErrors.authLabel && <span className="text-[11px] text-[var(--red)]">{fieldErrors.authLabel}</span>}
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                        Env var <span className="text-[var(--red)]">*</span>
                      </span>
                      <input
                        value={authEnvVar}
                        onChange={(e) => setAuthEnvVar(e.target.value.toUpperCase())}
                        placeholder="MY_API_TOKEN"
                        aria-invalid={!!fieldErrors.authEnvVar}
                        className={`rounded-[10px] border bg-[var(--bg)] px-3 py-2 text-[12px] leading-none outline-none transition-[border-color,box-shadow] duration-150 ${fieldErrors.authEnvVar ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--surface)]"}`}
                        style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                      />
                      {fieldErrors.authEnvVar && <span className="text-[11px] text-[var(--red)]">{fieldErrors.authEnvVar}</span>}
                    </label>
                    <label className="flex flex-col gap-1 col-span-2">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">Placeholder</span>
                      <input value={authPlaceholder} onChange={(e) => setAuthPlaceholder(e.target.value)} placeholder="sk-…" className="rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] leading-none outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--surface)]" style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} />
                    </label>
                  </div>
                )}
              </div>

              {serverError && <p className="rounded-[10px] border border-[var(--red)]/20 bg-[var(--red-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--red)]">{serverError}</p>}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)]/20 px-5 py-3 rounded-b-[16px]">
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-[12px] font-medium leading-none text-[var(--text-secondary)] will-change-transform transition-[transform,background-color,border-color,color] duration-150 hover:bg-[var(--surface)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] active:scale-[0.96]" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>
                Cancelar
              </button>
              <button type="button" disabled={saving} onClick={() => void handleSave()} className="inline-flex items-center justify-center rounded-full bg-[var(--text-primary)] px-5 py-2 text-[12px] font-medium leading-none text-[var(--bg)] shadow-sm will-change-transform transition-[transform,filter,opacity] duration-150 hover:brightness-[1.08] active:scale-[0.96] disabled:opacity-40" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>
                {saving ? "Guardando…" : editingId ? "Actualizar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes mcp-custom-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
