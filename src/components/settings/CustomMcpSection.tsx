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
      // focus first input after paint
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

  // focus trap inside dialog (simple: keep focus within)
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
          <h4 className="tc-eyebrow" style={MONO}>
            MCPs personalizados
          </h4>
          <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]" style={MONO}>
            {customs.length}
          </span>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Agregar MCP
        </button>
      </div>

      <p className="text-[11px] leading-4 text-[var(--text-muted)]">
        Servidores propios: remotos por URL o locales por comando (npx). Se guardan por proyecto y aparecen junto a los del catálogo.
      </p>

      {serverError && !showForm && (
        <div className="rounded-md border border-[var(--red)]/20 bg-[var(--red)]/5 px-3 py-2 text-[11px] text-[var(--red)]">{serverError}</div>
      )}

      {customs.length === 0 && !showForm ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/20 px-6 py-8 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M5 5.5h6M5 8h4M3 3.5h10v9H3z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <path d="M6 3.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </div>
          <p className="text-[12px] font-medium text-[var(--text-secondary)]">Sin MCPs personalizados</p>
          <p className="max-w-[34ch] text-[11px] leading-4 text-[var(--text-faint)]">Agregá un servidor remoto (URL) o local (npx/comando). Quedará disponible solo para este proyecto.</p>
          <button
            type="button"
            onClick={openAdd}
            className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            Crear el primero
          </button>
        </div>
      ) : customs.length > 0 ? (
        <div className="flex flex-col gap-2">
          {customs.map((c) => (
            <div
              key={c.id}
              className="group flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/40 px-3.5 py-3 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--surface)]/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-[var(--text-primary)]">{c.name}</span>
                  <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-faint)]" style={MONO}>
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
                <p className="mt-1 truncate text-[11px] text-[var(--text-faint)]" style={MONO} title={c.transport === "http" ? c.defaultUrl : `${c.defaultCommand} ${(c.defaultArgs ?? []).join(" ")}`}>
                  {c.transport === "http" ? c.defaultUrl : `${c.defaultCommand} ${(c.defaultArgs ?? []).join(" ")}`}
                </p>
                {c.auth && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300" style={MONO}>
                    token · {c.auth.envVar}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openEdit(c)}
                  className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemove(c.id)}
                  className="rounded-md border border-transparent bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-muted)] hover:border-[var(--red)]/20 hover:bg-[var(--red)]/5 hover:text-[var(--red)]"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Dialog */}
      {showForm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <button type="button" aria-label="Cerrar" onClick={() => { setShowForm(false); resetForm(); }} className="absolute inset-0 bg-[var(--scrim)]/60 backdrop-blur-[2px]" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Editar MCP" : "Nuevo MCP"}
            className="relative flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div>
                <h5 className="text-[13px] font-semibold text-[var(--text-primary)]">{editingId ? "Editar MCP" : "Nuevo MCP personalizado"}</h5>
                <p className="text-[11px] text-[var(--text-muted)]">Quedará disponible solo para este proyecto.</p>
              </div>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm(); }}
                className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                aria-label="Cerrar"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
              {/* Identidad */}
              <div className="flex flex-col gap-3">
                <span className="tc-eyebrow" style={MONO}>
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
                      className={`rounded-md border bg-[var(--surface)] px-2.5 py-2 text-[12px] outline-none transition-colors placeholder:text-[var(--text-faint)] disabled:opacity-60 ${fieldErrors.id ? "border-[var(--red)]/40 focus:border-[var(--red)]" : "border-[var(--border)] focus:border-[var(--accent)]"}`}
                      style={MONO}
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
                      className={`rounded-md border bg-[var(--surface)] px-2.5 py-2 text-[12px] outline-none placeholder:text-[var(--text-faint)] ${fieldErrors.name ? "border-[var(--red)]/40 focus:border-[var(--red)]" : "border-[var(--border)] focus:border-[var(--accent)]"}`}
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
                    className={`rounded-md border bg-[var(--surface)] px-2.5 py-2 text-[12px] outline-none placeholder:text-[var(--text-faint)] ${fieldErrors.description ? "border-[var(--red)]/40" : "border-[var(--border)] focus:border-[var(--accent)]"}`}
                  />
                  {fieldErrors.description && <span className="text-[11px] text-[var(--red)]">{fieldErrors.description}</span>}
                </label>
              </div>

              {/* Transporte */}
              <div className="flex flex-col gap-3">
                <span className="tc-eyebrow" style={MONO}>
                  Transporte
                </span>
                <div className="inline-flex self-start rounded-lg border border-[var(--border)] bg-[var(--surface)]/60 p-0.5">
                  {(["http", "stdio"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, transport: v }))}
                      className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${form.transport === v ? "bg-[var(--accent-soft)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
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
                      className={`rounded-md border bg-[var(--surface)] px-2.5 py-2 text-[12px] outline-none placeholder:text-[var(--text-faint)] ${fieldErrors.url ? "border-[var(--red)]/40 focus:border-[var(--red)]" : "border-[var(--border)] focus:border-[var(--accent)]"}`}
                      style={MONO}
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
                        className={`rounded-md border bg-[var(--surface)] px-2.5 py-2 text-[12px] outline-none placeholder:text-[var(--text-faint)] ${fieldErrors.command ? "border-[var(--red)]/40" : "border-[var(--border)] focus:border-[var(--accent)]"}`}
                        style={MONO}
                      />
                      {fieldErrors.command && <span className="text-[11px] text-[var(--red)]">{fieldErrors.command}</span>}
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">Args</span>
                      <input
                        value={Array.isArray(form.defaultArgs) ? (form.defaultArgs as string[]).join(" ") : (form.defaultArgs as unknown as string) ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, defaultArgs: e.target.value.split(/\s+/).filter(Boolean) as unknown as string[] }))}
                        placeholder="-y @modelcontextprotocol/server-memory"
                        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[12px] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]"
                        style={MONO}
                      />
                      <span className="text-[11px] text-[var(--text-faint)]">
                        Separados por espacio. Usá <code style={MONO} className="rounded bg-[var(--surface-hover)] px-1 py-0.5">{`{projectPath}`}</code> si necesitás la ruta del proyecto.
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* Auth */}
              <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/30 p-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={authEnabled} onChange={(e) => setAuthEnabled(e.target.checked)} className="h-3.5 w-3.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]" />
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">Requiere token</span>
                  <span className="text-[11px] text-[var(--text-faint)]">— se guarda en vault cifrado, no va a GitHub</span>
                </label>
                {authEnabled && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                        Label <span className="text-[var(--red)]">*</span>
                      </span>
                      <input value={authLabel} onChange={(e) => setAuthLabel(e.target.value)} placeholder="API Token" aria-invalid={!!fieldErrors.authLabel} className={`rounded-md border bg-[var(--bg)] px-2.5 py-1.5 text-[12px] outline-none ${fieldErrors.authLabel ? "border-[var(--red)]/40" : "border-[var(--border)] focus:border-[var(--accent)]"}`} />
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
                        className={`rounded-md border bg-[var(--bg)] px-2.5 py-1.5 text-[12px] outline-none ${fieldErrors.authEnvVar ? "border-[var(--red)]/40" : "border-[var(--border)] focus:border-[var(--accent)]"}`}
                        style={MONO}
                      />
                      {fieldErrors.authEnvVar && <span className="text-[11px] text-[var(--red)]">{fieldErrors.authEnvVar}</span>}
                    </label>
                    <label className="flex flex-col gap-1 col-span-2">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">Placeholder</span>
                      <input value={authPlaceholder} onChange={(e) => setAuthPlaceholder(e.target.value)} placeholder="sk-…" className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]" style={MONO} />
                    </label>
                  </div>
                )}
              </div>

              {serverError && <p className="rounded-md border border-[var(--red)]/20 bg-[var(--red)]/5 px-3 py-2 text-[11px] leading-4 text-[var(--red)]">{serverError}</p>}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)]/30 px-5 py-3">
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                Cancelar
              </button>
              <button type="button" disabled={saving} onClick={() => void handleSave()} className="rounded-md bg-[var(--accent)] px-5 py-2 text-[12px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40">
                {saving ? "Guardando…" : editingId ? "Actualizar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
