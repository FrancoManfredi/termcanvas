import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useProjectMcpStore } from "../../stores/projectMcpStore";
import { MCP_CATALOG, type McpServerId, type McpCatalogEntry } from "../../../shared/mcp";

const MONO = { fontFamily: '"Geist Mono", monospace' } as const;

// ── Status badge ──────────────────────────────────────────────────────────
const STATUS_META: Record<string, { dot: string; label: string; ring: string }> = {
  connected: { dot: "bg-[var(--green)]", label: "Conectado", ring: "border-[var(--green)]/20 bg-[var(--green)]/10 text-[var(--green)]" },
  connecting: { dot: "bg-[var(--amber)] animate-pulse", label: "Conectando…", ring: "border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber)]" },
  needs_auth: { dot: "bg-[var(--amber)]", label: "Requiere token", ring: "border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber)]" },
  error: { dot: "bg-[var(--red)]", label: "Error", ring: "border-[var(--red)]/20 bg-[var(--red)]/10 text-[var(--red)]" },
  disconnected: { dot: "bg-[var(--text-faint)]", label: "Desconectado", ring: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tracking-tight ${meta.ring}`} style={MONO}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className={`relative inline-flex cursor-pointer items-center ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
      <span className="sr-only">{label}</span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span
        aria-hidden
        className={`relative h-[22px] w-[42px] rounded-full border will-change-transform transition-[background-color,border-color] duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]/30 peer-focus-visible:ring-offset-0 after:absolute after:left-[3px] after:top-[3px] after:h-[14px] after:w-[14px] after:rounded-full after:bg-white after:shadow-sm after:will-change-transform after:transition-transform after:duration-200 after:ease-[cubic-bezier(0.2,0,0,1)] ${checked ? "bg-[var(--accent)] border-[var(--accent)]" : "bg-[var(--surface-hover)] border-[var(--border)]"} ${checked ? "after:translate-x-[20px]" : ""}`}
      />
    </label>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)]/30 px-4 py-4 animate-pulse" style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.03)" }}>
      <div className="flex gap-3">
        <div className="h-8 w-8 rounded-[10px] bg-[var(--surface-hover)]" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-32 rounded bg-[var(--surface-hover)]" />
          <div className="h-2 w-full rounded bg-[var(--surface-hover)]" />
          <div className="h-2 w-3/4 rounded bg-[var(--surface-hover)]" />
        </div>
        <div className="h-5 w-10 rounded-full bg-[var(--surface-hover)]" />
      </div>
    </div>
  );
}

function slugify(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
  return base || `mcp-${Date.now().toString(36)}`;
}

// ── Main ─────────────────────────────────────────────────────────────────
export function McpIntegrationsSection() {
  const projects = useProjectStore((s) => s.projects);
  // Proyecto activo: solo uno, sin dropdown
  const activeProject = useMemo(() => projects[0] ?? null, [projects]);
  const byProject = useProjectMcpStore((s) => s.byProject);
  const loading = useProjectMcpStore((s) => s.loading);
  const storeError = useProjectMcpStore((s) => s.error);
  const refresh = useProjectMcpStore((s) => s.refresh);
  const setEnabled = useProjectMcpStore((s) => s.setEnabled);
  const setSecret = useProjectMcpStore((s) => s.setSecret);
  const connect = useProjectMcpStore((s) => s.connect);

  const [globalMcps, setGlobalMcps] = useState<Array<{ name: string; type: string; enabled: boolean; url?: string; command?: string[]; sourcePath: string }>>([]);
  const [projectOpencodeMcps, setProjectOpencodeMcps] = useState<Array<{ name: string; type: string; enabled: boolean; url?: string; command?: string[]; sourcePath: string }>>([]);

  useEffect(() => {
    void (window as any).termcanvas?.mcp?.globalStatus?.()
      .then((res: any) => {
        if (res?.ok) setGlobalMcps(res.result);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeProject) {
      setProjectOpencodeMcps([]);
      return;
    }
    void (window as any).termcanvas?.mcp?.projectOpencodeStatus?.(activeProject.path)
      .then((res: any) => {
        if (res?.ok) setProjectOpencodeMcps(res.result);
      })
      .catch(() => {});
    void refresh(activeProject.id, activeProject.path);
  }, [activeProject?.id, activeProject?.path, refresh]);

  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [savingToken, setSavingToken] = useState<Record<string, boolean>>({});
  const [healthByServer, setHealthByServer] = useState<Record<string, { ok: boolean; latencyMs?: number; error?: string; details?: string } | null>>({});
  const [healthLoading, setHealthLoading] = useState<Record<string, boolean>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const handleToggle = useCallback(
    async (serverId: McpServerId, enabled: boolean) => {
      if (!activeProject) return;
      setToggling((p) => ({ ...p, [serverId]: true }));
      try {
        await setEnabled(activeProject.id, activeProject.path, serverId, enabled);
      } finally {
        setToggling((p) => ({ ...p, [serverId]: false }));
      }
    },
    [activeProject, setEnabled],
  );

  const handleSaveToken = useCallback(
    async (serverId: McpServerId) => {
      if (!activeProject) return;
      const token = tokenDrafts[serverId]?.trim();
      if (!token) return;
      setSavingToken((p) => ({ ...p, [serverId]: true }));
      await setSecret(activeProject.id, activeProject.path, serverId, token);
      setTokenDrafts((p) => ({ ...p, [serverId]: "" }));
      setSavingToken((p) => ({ ...p, [serverId]: false }));
    },
    [activeProject, tokenDrafts, setSecret],
  );

  const handleClearToken = useCallback(
    async (serverId: McpServerId) => {
      if (!activeProject) return;
      setSavingToken((p) => ({ ...p, [serverId]: true }));
      await setSecret(activeProject.id, activeProject.path, serverId, null);
      setSavingToken((p) => ({ ...p, [serverId]: false }));
    },
    [activeProject, setSecret],
  );

  const handleHealthCheck = useCallback(
    async (serverId: McpServerId) => {
      if (!activeProject) return;
      setHealthLoading((p) => ({ ...p, [serverId]: true }));
      try {
        const res: any = await (window as any).termcanvas.mcp.healthCheck(activeProject.id, serverId, activeProject.path);
        if (res.ok) setHealthByServer((p) => ({ ...p, [serverId]: res.result }));
        else setHealthByServer((p) => ({ ...p, [serverId]: { ok: false, error: res.error } }));
      } catch (e) {
        setHealthByServer((p) => ({ ...p, [serverId]: { ok: false, error: e instanceof Error ? e.message : String(e) } }));
      } finally {
        setHealthLoading((p) => ({ ...p, [serverId]: false }));
      }
    },
    [activeProject],
  );

  const status = activeProject ? byProject[activeProject.id] : undefined;
  const isLoading = activeProject ? !!loading[activeProject.id] : false;
  const projectError = activeProject ? storeError[activeProject.id] : null;
  const serversToRender = status?.servers ?? [];
  const builtInIds = useMemo(() => new Set(MCP_CATALOG.map((c) => c.id)), []);

  const stats = useMemo(() => {
    if (!status) return null;
    const total = status.servers.length;
    const connected = status.servers.filter((s) => s.status === "connected").length;
    const needsAuth = status.servers.filter((s) => s.status === "needs_auth").length;
    const enabled = status.servers.filter((s) => s.config.enabled).length;
    const errors = status.servers.filter((s) => s.status === "error").length;
    return { total, connected, needsAuth, enabled, errors };
  }, [status]);

  const hasProjects = !!activeProject;

  // ── Custom MCP dialog (simplificado) ─────────────────────────
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [customForm, setCustomForm] = useState<Partial<McpCatalogEntry>>({
    name: "",
    description: "",
    transport: "http",
    defaultUrl: "",
    defaultCommand: "",
    defaultArgs: [],
  });
  const [customAuthEnabled, setCustomAuthEnabled] = useState(false);
  const [customEnvVar, setCustomEnvVar] = useState("");
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [customServerError, setCustomServerError] = useState<string | null>(null);
  const [customSaving, setCustomSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstCustomInputRef = useRef<HTMLInputElement>(null);

  const resetCustomForm = useCallback(() => {
    setCustomForm({ name: "", description: "", transport: "http", defaultUrl: "", defaultCommand: "", defaultArgs: [] });
    setCustomAuthEnabled(false);
    setCustomEnvVar("");
    setEditingCustomId(null);
    setCustomFieldErrors({});
    setCustomServerError(null);
  }, []);

  const openCustomAdd = useCallback(() => {
    resetCustomForm();
    setShowCustomForm(true);
  }, [resetCustomForm]);

  const openCustomEdit = useCallback((entry: McpCatalogEntry) => {
    setCustomForm({ ...entry, defaultArgs: entry.defaultArgs ? [...entry.defaultArgs] : [] });
    setEditingCustomId(entry.id);
    if (entry.auth) {
      setCustomAuthEnabled(true);
      setCustomEnvVar(entry.auth.envVar ?? "");
    } else {
      setCustomAuthEnabled(false);
      setCustomEnvVar("");
    }
    setCustomFieldErrors({});
    setCustomServerError(null);
    setShowCustomForm(true);
  }, []);

  useEffect(() => {
    if (showCustomForm) {
      requestAnimationFrame(() => firstCustomInputRef.current?.focus());
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setShowCustomForm(false);
          resetCustomForm();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [showCustomForm, resetCustomForm]);

  useEffect(() => {
    if (!showCustomForm || !dialogRef.current) return;
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
  }, [showCustomForm]);

  const validateCustom = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (!customForm.name?.trim()) errs.name = "Requerido";
    if (customForm.transport === "http") {
      const url = customForm.defaultUrl?.trim() ?? "";
      if (!url) errs.url = "Requerido";
      else {
        try {
          new URL(url);
        } catch {
          errs.url = "URL inválida";
        }
      }
    } else {
      if (!customForm.defaultCommand?.trim()) errs.command = "Requerido";
    }
    if (customAuthEnabled && customEnvVar.trim() && !/^[A-Z][A-Z0-9_]*$/.test(customEnvVar.trim())) {
      errs.envVar = "Mayúsculas, números y _ (ej. MY_TOKEN)";
    }
    setCustomFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }, [customForm, customAuthEnabled, customEnvVar]);

  const handleSaveCustom = useCallback(async () => {
    if (!activeProject || !validateCustom()) return;
    const baseId = editingCustomId ?? slugify(customForm.name!.trim());
    let finalId = baseId;
    // ensure uniqueness if adding
    if (!editingCustomId) {
      const existing = new Set(serversToRender.map((s) => s.catalog.id));
      let suffix = 1;
      while (existing.has(finalId)) {
        finalId = `${baseId}-${suffix++}`;
      }
    } else {
      finalId = editingCustomId;
    }
    const entry: McpCatalogEntry = {
      id: finalId,
      name: customForm.name!.trim(),
      description: (customForm.description?.trim() ?? "") || customForm.name!.trim(),
      transport: customForm.transport as "http" | "stdio",
      auth: customAuthEnabled
        ? {
            label: "Token",
            placeholder: "sk-…",
            envVar: customEnvVar.trim() || `MCP_${finalId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_TOKEN`,
            helpUrl: undefined,
          }
        : null,
    };
    if (entry.transport === "http") entry.defaultUrl = customForm.defaultUrl!.trim();
    else {
      entry.defaultCommand = customForm.defaultCommand!.trim();
      const raw = customForm.defaultArgs;
      if (Array.isArray(raw)) entry.defaultArgs = raw.filter((a) => typeof a === "string" && a.trim());
      else if (typeof raw === "string") entry.defaultArgs = (raw as string).split(/\s+/).filter(Boolean);
      else entry.defaultArgs = [];
    }
    setCustomSaving(true);
    setCustomServerError(null);
    try {
      if (editingCustomId) {
        const res: any = await (window as any).termcanvas.mcp.updateCustom(activeProject.id, activeProject.path, editingCustomId, entry);
        if (!res.ok) throw new Error(res.error);
      } else {
        const res: any = await (window as any).termcanvas.mcp.addCustom(activeProject.id, activeProject.path, entry);
        if (!res.ok) throw new Error(res.error);
      }
      setShowCustomForm(false);
      resetCustomForm();
      await refresh(activeProject.id, activeProject.path);
    } catch (e) {
      setCustomServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomSaving(false);
    }
  }, [activeProject, customForm, customAuthEnabled, customEnvVar, editingCustomId, serversToRender, refresh, resetCustomForm, validateCustom]);

  const hideBuiltIn = useProjectMcpStore((s) => s.hideBuiltIn);

  const handleRemoveCustom = useCallback(
    async (id: string) => {
      if (!activeProject) return;
      if (!confirm(`¿Eliminar MCP "${id}"? Esta acción no se puede deshacer.`)) return;
      try {
        const res: any = await (window as any).termcanvas.mcp.removeCustom(activeProject.id, activeProject.path, id);
        if (!res.ok) throw new Error(res.error);
        await refresh(activeProject.id, activeProject.path);
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
      }
    },
    [activeProject, refresh],
  );

  const handleHideBuiltIn = useCallback(
    async (id: string) => {
      if (!activeProject) return;
      if (!confirm(`¿Eliminar "${id}" del catálogo? Podés volver a agregarlo después como MCP personalizado si lo necesitás.`)) return;
      try {
        await hideBuiltIn(activeProject.id, activeProject.path, id);
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
      }
    },
    [activeProject, hideBuiltIn],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header card ───────────────────────────── */}
      <div
        className="flex flex-col gap-3 rounded-[16px] bg-[var(--surface)]/40 p-4"
        style={{ boxShadow: "0 1px 2px oklch(0 0 0 / 0.04), 0 4px 12px oklch(0 0 0 / 0.06)", outline: "1px solid oklch(0 0 0 / 0.06)", outlineOffset: "-1px" }}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/10">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              <path d="M12 12h.01" strokeWidth="2" />
            </svg>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[13px] font-semibold leading-none tracking-tight text-[var(--text-primary)]">MCPs</h4>
              {stats && (
                <span className="inline-flex items-center rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-medium tabular-nums leading-none text-[var(--accent-foreground)]">
                  {stats.enabled}/{stats.total} activos
                </span>
              )}
            </div>
            <p className="max-w-[58ch] text-[12px] leading-4 text-[var(--text-secondary)]">
              Conectores por proyecto. Cada LLM (Claude, Codex, etc.) los ve al instante y la config viaja con{" "}
              <code className="rounded bg-[var(--surface)] border border-[var(--border)] px-1 py-0.5 text-[11px]" style={MONO}>
                termcanvas-context
              </code>{" "}
              para trabajar igual en otra máquina.
            </p>
          </div>
        </div>
        {stats && (
          <div className="flex items-center gap-2 text-[11px] leading-none text-[var(--text-muted)]">
            <span className="h-1 w-1 rounded-full bg-[var(--green)]" /> {stats.connected} conectados
            {stats.needsAuth > 0 && (
              <>
                <span className="h-1 w-1 rounded-full bg-[var(--text-faint)]" /> {stats.needsAuth} requieren token
              </>
            )}
            {stats.errors > 0 && (
              <>
                <span className="h-1 w-1 rounded-full bg-[var(--text-faint)]" /> {stats.errors} con error
              </>
            )}
          </div>
        )}
      </div>

      {/* Vault — debajo de la tarjeta MCPs, no dentro */}
      <div className="flex gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/30 px-3.5 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
            <circle cx="12" cy="16" r="1.5" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium leading-4 text-[var(--text-primary)]">Sincronizado y seguro</p>
          <p className="mt-0.5 text-[11px] leading-[1.5] text-[var(--text-secondary)]">
            Los tokens nunca viajan por Git — quedan en el vault cifrado de cada dispositivo. En otra máquina solo te pide el token una vez.
          </p>
        </div>
      </div>

      {/* ── Active project (single, no dropdown) ─────── */}
      {hasProjects && activeProject ? (
        <div className="flex items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)]/60 px-3.5 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <path d="M9 22V12h6v10" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-none text-[var(--text-primary)]" title={activeProject.name}>{activeProject.name}</p>
            <p className="truncate font-mono text-[11px] leading-none text-[var(--text-faint)] mt-1" style={MONO} title={activeProject.path}>{activeProject.path}</p>
          </div>
          <span className="hidden sm:inline-flex shrink-0 items-center rounded-full bg-[var(--surface)] border border-[var(--border)] px-2.5 py-1 text-[11px] leading-none text-[var(--text-muted)]">Activo</span>
        </div>
      ) : (
        <div className="flex gap-3 rounded-[12px] border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
          <span className="mt-0.5 shrink-0 text-amber-600">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 5v4M8 11h.01M13 8A5 5 0 1 1 3 8a5 5 0 0 1 10 0Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium leading-5 text-amber-700 dark:text-amber-300">Sin proyecto activo</p>
            <p className="text-[11px] leading-4 text-amber-700/70 dark:text-amber-300/70">Agregá una carpeta al canvas para configurar MCPs. Abajo podés revisar tus MCPs globales (solo lectura).</p>
          </div>
        </div>
      )}

      {projectError && (
        <div className="flex items-start gap-2.5 rounded-[12px] border border-[var(--red)]/20 bg-[var(--red-soft)] px-3.5 py-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--red)]/15 text-[var(--red)]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4 M12 16h.01" /></svg>
          </span>
          <p className="min-w-0 text-[12px] leading-4 text-[var(--red)]">{projectError}</p>
        </div>
      )}

      {/* ── Stats ─────────────────────────────────────── */}
      {stats && hasProjects && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Activos", value: stats.enabled, tone: "default" },
            { label: "Conectados", value: stats.connected, tone: stats.connected > 0 ? "green" : "default" },
            { label: "Token", value: stats.needsAuth, tone: stats.needsAuth > 0 ? "amber" : "default" },
            { label: "Error", value: stats.errors, tone: stats.errors > 0 ? "red" : "default" },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-[12px] border px-3 py-2.5 text-center transition-colors duration-150 ${s.tone === "green" ? "border-[var(--green)]/20 bg-[var(--green)]/5" : s.tone === "amber" ? "border-[var(--amber)]/20 bg-[var(--amber)]/5" : s.tone === "red" ? "border-[var(--red)]/20 bg-[var(--red-soft)]" : "border-[var(--border)] bg-[var(--surface)]/40"}`}
              style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
            >
              <div className={`text-[17px] font-semibold leading-none tracking-tight tabular-nums ${s.tone === "green" ? "text-[var(--green)]" : s.tone === "amber" ? "text-[var(--amber)]" : s.tone === "red" ? "text-[var(--red)]" : "text-[var(--text-primary)]"}`}>{s.value}</div>
              <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)]">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Catalog ───────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]" style={MONO}>
            Catálogo del proyecto
          </h4>
          <div className="flex items-center gap-2">
            {status ? (
              <span className="hidden sm:inline text-[11px] tabular-nums text-[var(--text-faint)]" style={MONO}>
                {stats ? `${stats.total} MCPs` : ""}
              </span>
            ) : (
              <span className="text-[11px] text-[var(--text-faint)]">cargando…</span>
            )}
            {hasProjects && (
              <button
                type="button"
                onClick={openCustomAdd}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--text-primary)] px-3.5 py-1.5 text-[12px] font-medium leading-none text-[var(--bg)] shadow-sm will-change-transform transition-[transform,filter] duration-150 hover:brightness-[1.08] active:scale-[0.96]"
                style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Agregar MCP
              </button>
            )}
          </div>
        </div>

        {!hasProjects ? (
          <div className="rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--surface)]/20 px-4 py-8 text-center">
            <p className="text-[13px] font-medium text-[var(--text-secondary)]">Necesitás un proyecto para activar MCPs</p>
            <p className="mx-auto mt-1 max-w-[32ch] text-[11px] leading-4 text-[var(--text-muted)]">Arrastrá una carpeta al canvas o usá “Add Project” y volvé acá.</p>
          </div>
        ) : isLoading && !status ? (
          <div className="flex flex-col gap-2.5">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : serversToRender.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)]/20 px-6 py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M12 8a3 3 0 00-3 3v1H6a2 2 0 00-2 2v4a2 2 0 002 2h12a2 2 0 002-2v-4a2 2 0 00-2-2h-3v-1a3 3 0 00-3-3z" /></svg>
            </div>
            <p className="text-[13px] font-medium text-[var(--text-secondary)]">Sin MCPs todavía</p>
            <p className="max-w-[30ch] text-[11px] leading-4 text-[var(--text-muted)]">Agregá tu primer conector para este proyecto. Puede ser remoto (URL) o local (npx).</p>
            <button
              type="button"
              onClick={openCustomAdd}
              className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3.5 py-1.5 text-[12px] font-medium leading-none text-[var(--text-secondary)] will-change-transform transition-[transform,background-color,border-color,color] duration-150 hover:border-[var(--border-hover)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] active:scale-[0.96]"
              style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
            >
              Crear el primero
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {serversToRender.map((s, idx) => {
              const isEnabled = s.config.enabled;
              const needsAuth = s.status === "needs_auth";
              const hasSecret = s.hasSecret;
              const isConnected = s.status === "connected";
              const isError = s.status === "error";
              const isConnecting = s.status === "connecting";
              const isCustom = !builtInIds.has(s.catalog.id);
              const initial = s.catalog.name.slice(0, 1).toUpperCase();
              const transportLabel = s.catalog.transport === "http" ? "Remote" : "Local";
              const endpoint = s.catalog.transport === "http" ? s.catalog.defaultUrl ?? "" : `${s.catalog.defaultCommand ?? ""} ${(s.catalog.defaultArgs ?? []).join(" ")}`.trim();
              const health = healthByServer[s.catalog.id];
              const isHealthLoading = !!healthLoading[s.catalog.id];
              const isToggling = !!toggling[s.catalog.id];
              return (
                <div
                  key={s.catalog.id}
                  className="group relative flex flex-col rounded-[14px] border bg-[var(--bg)] focus-within:z-10"
                  style={{
                    borderColor: isEnabled
                      ? isConnected
                        ? "var(--border)"
                        : needsAuth
                          ? "color-mix(in srgb, var(--amber) 24%, var(--border))"
                          : isError
                            ? "color-mix(in srgb, var(--red) 24%, var(--border))"
                            : "var(--border)"
                      : "var(--border)",
                    boxShadow: isEnabled && isConnected ? "0 1px 2px oklch(0 0 0 / 0.03), 0 4px 16px oklch(0 0 0 / 0.05)" : "0 1px 2px oklch(0 0 0 / 0.03), 0 2px 8px oklch(0 0 0 / 0.04)",
                    animation: "mcp-card-in 0.38s cubic-bezier(0.2, 0, 0, 1) both",
                    animationDelay: `${idx * 55}ms`,
                    opacity: isEnabled ? 1 : 0.92,
                    transition: "border-color 150ms cubic-bezier(0.2, 0, 0, 1), box-shadow 150ms cubic-bezier(0.2, 0, 0, 1), opacity 150ms cubic-bezier(0.2, 0, 0, 1)",
                  } as React.CSSProperties}
                >
                  {/* Header */}
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border text-[12px] font-semibold tracking-tight transition-colors duration-150 ${isEnabled && isConnected ? "border-[var(--green)]/20 bg-[var(--green)]/10 text-[var(--green)]" : isEnabled && needsAuth ? "border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber)]" : isEnabled && isError ? "border-[var(--red)]/20 bg-[var(--red-soft)] text-[var(--red)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] group-hover:border-[var(--border-hover)]"}`}
                      aria-hidden
                    >
                      {initial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">{s.catalog.name}</span>
                        <StatusBadge status={s.status} />
                        {typeof s.toolCount === "number" && isConnected && (
                          <span className="inline-flex items-center rounded-full bg-[var(--surface)] border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-muted)]" style={MONO}>
                            {s.toolCount} tools
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest ${s.catalog.transport === "http" ? "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"}`} style={MONO} title={s.catalog.transport}>
                          <span className={`h-1 w-1 rounded-full ${s.catalog.transport === "http" ? "bg-sky-500" : "bg-[var(--text-muted)]"}`} />
                          {transportLabel}
                        </span>
                        {isConnecting && <span className="text-[11px] text-[var(--text-muted)]">— conectando…</span>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-[var(--text-muted)]">{s.catalog.description}</p>
                      <p className="mt-1.5 flex items-center gap-1.5 truncate text-[11px] leading-none text-[var(--text-faint)]" style={MONO} title={endpoint}>
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="shrink-0 opacity-60" aria-hidden>
                          <path d="M3.5 4.5h5M3.5 6h5M3.5 7.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                          <rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
                        </svg>
                        <span className="truncate">{endpoint || "—"}</span>
                      </p>
                    </div>
                    <div className="ml-2 flex shrink-0 flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        {isCustom && (
                          <button
                            type="button"
                            onClick={() => openCustomEdit(s.catalog)}
                            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] will-change-transform transition-[transform,background-color,border-color,color] duration-150 hover:bg-[var(--surface)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] active:scale-[0.96]"
                            style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                            aria-label={`Editar ${s.catalog.name}`}
                            title="Editar"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void (isCustom ? handleRemoveCustom(s.catalog.id) : handleHideBuiltIn(s.catalog.id))}
                          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-transparent bg-transparent text-[var(--text-faint)] will-change-transform transition-[transform,background-color,color,border-color] duration-150 hover:bg-[var(--red-soft)] hover:text-[var(--red)] hover:border-[var(--red)]/20 active:scale-[0.96]"
                          style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                          aria-label={`Eliminar ${s.catalog.name}`}
                          title={isCustom ? "Eliminar" : "Eliminar del catálogo"}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6" /></svg>
                        </button>
                        <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
                        <Toggle checked={isEnabled} onChange={(v) => void handleToggle(s.catalog.id, v)} disabled={isToggling || !hasProjects} label={`Activar ${s.catalog.name}`} />
                      </div>
                      <span className="text-[10px] font-medium tracking-wide tabular-nums text-[var(--text-faint)]" style={MONO}>{isToggling ? "guardando…" : isEnabled ? "activo" : "inactivo"}</span>
                    </div>
                  </div>
                  {isEnabled ? (
                    <div className="flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--surface)]/30 px-4 py-3 rounded-b-[14px]">
                      {s.catalog.auth && (
                        <div className="flex flex-col gap-2.5 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] p-3.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]" style={MONO}>{s.catalog.auth.label}</span>
                            {hasSecret ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--green)]/10 border border-[var(--green)]/15 px-2 py-1 text-[11px] font-medium leading-none text-[var(--green)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" /> Guardado en este dispositivo</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--amber)]/10 border border-[var(--amber)]/15 px-2 py-1 text-[11px] font-medium leading-none text-[var(--amber)]">Falta token — sin esto no conecta</span>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <input type={showToken[s.catalog.id] ? "text" : "password"} placeholder={s.catalog.auth.placeholder} value={tokenDrafts[s.catalog.id] ?? ""} onChange={(e) => setTokenDrafts((p) => ({ ...p, [s.catalog.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveToken(s.catalog.id); }} className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 pr-9 text-[12px] leading-none text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition-[border-color,box-shadow,background-color] duration-150 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--surface)]" style={MONO} aria-label={`Token para ${s.catalog.name}`} />
                              <button type="button" onClick={() => setShowToken((p) => ({ ...p, [s.catalog.id]: !p[s.catalog.id] }))} className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:scale-[0.96] transition-[transform,background-color,color] duration-150" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} aria-label={showToken[s.catalog.id] ? "Ocultar token" : "Mostrar token"} title={showToken[s.catalog.id] ? "Ocultar" : "Mostrar"}>
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>{showToken[s.catalog.id] ? (<path d="M2 7s2.2-3.2 5-3.2S12 7 12 7s-2.2 3.2-5 3.2S2 7 2 7Zm5 1.5A1.5 1.5 0 1 1 7 5.5a1.5 1.5 0 0 1 0 3Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />) : (<path d="M3 3 11 11M2 7s2.2-3.2 5-3.2c.9 0 1.7.3 2.5.8M9.8 9.1A4.2 4.2 0 0 1 7 10.2C4.2 10.2 2 7 2 7s.7-1 1.9-1.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />)}</svg>
                              </button>
                            </div>
                            <button type="button" disabled={!tokenDrafts[s.catalog.id]?.trim() || !!savingToken[s.catalog.id]} onClick={() => void handleSaveToken(s.catalog.id)} className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium leading-none text-[var(--bg)] shadow-sm will-change-transform transition-[transform,filter,opacity] duration-150 hover:brightness-[1.08] active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>{savingToken[s.catalog.id] ? "Guardando…" : hasSecret ? "Actualizar" : "Guardar"}</button>
                            {hasSecret && (<button type="button" onClick={() => void handleClearToken(s.catalog.id)} disabled={!!savingToken[s.catalog.id]} className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2 text-[12px] font-medium leading-none text-[var(--text-muted)] will-change-transform transition-[transform,background-color,border-color,color] duration-150 hover:border-[var(--border-hover)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] active:scale-[0.96] disabled:opacity-40" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>Borrar</button>)}
                          </div>
                          {needsAuth && (<p className="rounded-[10px] bg-[var(--amber)]/8 border border-[var(--amber)]/15 px-2.5 py-2 text-[11px] leading-4 text-[var(--amber)]">Está activo pero necesita token en este dispositivo. Lo activaste en otra PC — pegá el token acá una sola vez.</p>)}
                          {s.catalog.auth.helpUrl && (<a href={s.catalog.auth.helpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-[var(--accent)] hover:underline">¿Dónde consigo el token? <span aria-hidden>↗</span></a>)}
                          {s.lastError && <p className="text-[11px] leading-4 text-[var(--red)]">{s.lastError}</p>}
                          {hasSecret && s.status !== "connected" && !needsAuth && (<button type="button" onClick={() => void connect(activeProject!.id, activeProject!.path, s.catalog.id)} className="inline-flex cursor-pointer self-start items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium leading-none text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] active:scale-[0.96] transition-[transform,background-color,border-color,color] duration-150" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>Reconectar</button>)}
                        </div>
                      )}
                      <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg)]/60 px-3 py-2.5">
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]" style={MONO}>Health</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] leading-4">{health ? (health.ok ? (<span className="inline-flex items-center gap-1.5 font-medium text-[var(--green)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />OK {health.latencyMs != null ? `· ${health.latencyMs}ms` : ""} {health.details ? `· ${health.details}` : ""}</span>) : (<span className="inline-flex items-start gap-1.5 font-medium text-[var(--red)]"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--red)]" /><span className="break-words">{health.error} {health.details ? `(${health.details})` : ""}</span></span>)) : (<span className="text-[var(--text-faint)]">{needsAuth ? "Requiere token" : isConnected ? "Conectado" : isError ? "Error — probá verificar" : "Probá la conexión"}</span>)}</span>
                        <div className="ml-auto flex shrink-0 items-center gap-2">{isHealthLoading ? (<span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]" aria-live="polite"><svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" /><path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>Verificando…</span>) : (<button type="button" disabled={needsAuth} onClick={() => void handleHealthCheck(s.catalog.id)} className="inline-flex cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[11px] font-medium leading-none text-[var(--text-secondary)] shadow-sm will-change-transform transition-[transform,background-color,border-color,color] duration-150 hover:bg-[var(--surface)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} title={needsAuth ? "Requiere token" : "Probar conexión al MCP"}>Probar</button>)}</div>
                      </div>
                      {!s.catalog.auth && s.status !== "connected" && !isConnecting && (<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => void connect(activeProject!.id, activeProject!.path, s.catalog.id)} className="inline-flex cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[11px] font-medium leading-none text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] active:scale-[0.96] transition-[transform,background-color,border-color,color] duration-150" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>Conectar</button>{s.lastError && <span className="text-[11px] text-[var(--red)]">{s.lastError}</span>}</div>)}
                      {isConnected && !s.catalog.auth && s.lastError && <p className="text-[11px] text-[var(--red)]">{s.lastError}</p>}
                    </div>
                  ) : (
                    <div className="border-t border-dashed border-[var(--border)] bg-[var(--surface)]/15 px-4 py-2.5 rounded-b-[14px]"><p className="text-[11px] leading-4 text-[var(--text-faint)]">Desactivado — actívalo para que todos los LLMs de este proyecto lo vean.</p></div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Custom MCP dialog (simplificado) ───────── */}
      {showCustomForm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <button type="button" aria-label="Cerrar" onClick={() => { setShowCustomForm(false); resetCustomForm(); }} className="absolute inset-0 cursor-pointer bg-[var(--scrim)] backdrop-blur-[8px] tc-enter-fade" />
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={editingCustomId ? "Editar MCP" : "Nuevo MCP"} className="relative flex max-h-[86vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--bg)] shadow-2xl tc-enter-fade-up">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h5 className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">{editingCustomId ? "Editar MCP" : "Nuevo MCP"}</h5>
                <p className="text-[11px] leading-4 text-[var(--text-muted)]">Solo para este proyecto. Se guarda junto al catálogo.</p>
              </div>
              <button type="button" onClick={() => { setShowCustomForm(false); resetCustomForm(); }} className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:scale-[0.96] transition-[transform,background-color,color] duration-150 will-change-transform" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} aria-label="Cerrar">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Nombre <span className="text-[var(--red)]">*</span></span>
                <input ref={firstCustomInputRef} value={customForm.name ?? ""} onChange={(e) => setCustomForm((f) => ({ ...f, name: e.target.value }))} placeholder="Mi conector" aria-invalid={!!customFieldErrors.name} className={`rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-[13px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 ${customFieldErrors.name ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"}`} style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} />
                {customFieldErrors.name && <span className="text-[11px] text-[var(--red)]">{customFieldErrors.name}</span>}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Descripción <span className="text-[11px] font-normal text-[var(--text-faint)]">(opcional)</span></span>
                <input value={customForm.description ?? ""} onChange={(e) => setCustomForm((f) => ({ ...f, description: e.target.value }))} placeholder="Qué hace este MCP" className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} />
              </label>
              <div className="flex flex-col gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]" style={MONO}>Transporte</span>
                <div className="inline-flex self-start rounded-full border border-[var(--border)] bg-[var(--surface)]/60 p-0.5">
                  {(["http", "stdio"] as const).map((v) => (
                    <button key={v} type="button" onClick={() => setCustomForm((f) => ({ ...f, transport: v }))} className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[12px] font-medium leading-none transition-colors duration-150 ${customForm.transport === v ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`} style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>{v === "http" ? "Remote · HTTP" : "Local · stdio"}</button>
                  ))}
                </div>
                {customForm.transport === "http" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">URL <span className="text-[var(--red)]">*</span></span>
                    <input value={customForm.defaultUrl ?? ""} onChange={(e) => setCustomForm((f) => ({ ...f, defaultUrl: e.target.value }))} placeholder="https://mcp.example.com/mcp" aria-invalid={!!customFieldErrors.url} className={`rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 ${customFieldErrors.url ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"}`} style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} />
                    {customFieldErrors.url && <span className="text-[11px] text-[var(--red)]">{customFieldErrors.url}</span>}
                  </label>
                ) : (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">Command <span className="text-[var(--red)]">*</span></span>
                      <input value={customForm.defaultCommand ?? ""} onChange={(e) => setCustomForm((f) => ({ ...f, defaultCommand: e.target.value }))} placeholder="npx" aria-invalid={!!customFieldErrors.command} className={`rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 ${customFieldErrors.command ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]"}`} style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} />
                      {customFieldErrors.command && <span className="text-[11px] text-[var(--red)]">{customFieldErrors.command}</span>}
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">Args</span>
                      <input value={Array.isArray(customForm.defaultArgs) ? (customForm.defaultArgs as string[]).join(" ") : (customForm.defaultArgs as unknown as string) ?? ""} onChange={(e) => setCustomForm((f) => ({ ...f, defaultArgs: e.target.value.split(/\s+/).filter(Boolean) as unknown as string[] }))} placeholder="-y @modelcontextprotocol/server-memory" className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] leading-none outline-none placeholder:text-[var(--text-faint)] transition-[border-color,box-shadow] duration-150 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--bg)]" style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} />
                    </label>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/30 p-3.5">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={customAuthEnabled} onChange={(e) => setCustomAuthEnabled(e.target.checked)} className="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] focus:ring-2" />
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">Requiere token</span>
                  <span className="text-[11px] text-[var(--text-faint)]">— opcional</span>
                </label>
                {customAuthEnabled && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-medium text-[var(--text-secondary)]">Variable de entorno <span className="text-[11px] font-normal text-[var(--text-faint)]">(opcional, se autogenera)</span></span>
                    <input value={customEnvVar} onChange={(e) => setCustomEnvVar(e.target.value.toUpperCase())} placeholder="MY_API_TOKEN" aria-invalid={!!customFieldErrors.envVar} className={`rounded-[10px] border bg-[var(--bg)] px-3 py-2 text-[12px] leading-none outline-none transition-[border-color,box-shadow] duration-150 ${customFieldErrors.envVar ? "border-[var(--red)]/40 focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]" : "border-[var(--border)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:bg-[var(--surface)]"}`} style={{ ...MONO, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }} />
                    {customFieldErrors.envVar ? <span className="text-[11px] text-[var(--red)]">{customFieldErrors.envVar}</span> : <span className="text-[11px] text-[var(--text-faint)]">Si lo dejás vacío usamos MCP_ID_TOKEN.</span>}
                  </label>
                )}
              </div>
              {customServerError && <p className="rounded-[10px] border border-[var(--red)]/20 bg-[var(--red-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--red)]">{customServerError}</p>}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)]/20 px-5 py-3 rounded-b-[16px]">
              <button type="button" onClick={() => { setShowCustomForm(false); resetCustomForm(); }} className="inline-flex cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-[12px] font-medium leading-none text-[var(--text-secondary)] will-change-transform transition-[transform,background-color,border-color,color] duration-150 hover:bg-[var(--surface)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] active:scale-[0.96]" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>Cancelar</button>
              <button type="button" disabled={customSaving} onClick={() => void handleSaveCustom()} className="inline-flex cursor-pointer items-center justify-center rounded-full bg-[var(--text-primary)] px-5 py-2 text-[12px] font-medium leading-none text-[var(--bg)] shadow-sm will-change-transform transition-[transform,filter,opacity] duration-150 hover:brightness-[1.08] active:scale-[0.96] disabled:opacity-40" style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}>{customSaving ? "Guardando…" : editingCustomId ? "Actualizar" : "Crear"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Opencode (read-only, collapsible) ─────────── */}
      <details className="group/details rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/20 open:bg-[var(--surface)]/30 transition-colors duration-150">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] group-open/details:bg-[var(--bg)] transition-colors duration-150">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-[var(--text-muted)] group-open/details:rotate-90 transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)]" aria-hidden>
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Opencode existente
            <span className="hidden sm:inline text-[11px] font-normal text-[var(--text-muted)]">— solo lectura</span>
            <span className="rounded-full bg-[var(--surface)] border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-muted)]" style={MONO}>
              {globalMcps.length + projectOpencodeMcps.length}
            </span>
          </span>
          <span className="text-[11px] text-[var(--text-faint)]">avanzado</span>
        </summary>
        <div className="border-t border-[var(--border)] px-4 py-4 flex flex-col gap-4">
          <p className="text-[11px] leading-4 text-[var(--text-muted)]">
            Tus MCPs ya configurados en <code style={MONO} className="rounded-[6px] bg-[var(--surface)] border border-[var(--border)] px-1.5 py-0.5 text-[11px]">opencode.json</code> (global y proyecto). Solo lectura — los de arriba son los gestionados por TermCanvas.
          </p>
          <div className="flex flex-col gap-3">
            <h5 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]" style={MONO}>Global · ~/.config/opencode</h5>
            {globalMcps.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--bg)]/40 px-3 py-3 text-[11px] leading-4 text-[var(--text-faint)]">No se detectaron MCPs globales. Los que actives por proyecto aparecerán arriba.</p>
            ) : (
              <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)]/40">
                {globalMcps.map((g, idx) => (
                  <div key={g.name} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${idx > 0 ? "border-t border-[var(--border)]" : ""}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] font-medium text-[var(--text-primary)]">{g.name}</span>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${g.enabled ? "bg-green-500/12 text-green-600 dark:text-green-400 border border-green-500/20" : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]"}`} style={MONO}>{g.enabled ? "activo" : "desactivado"}</span>
                        <span className="text-[10px] text-[var(--text-faint)]" style={MONO}>{g.type}</span>
                      </div>
                      <p className="truncate text-[11px] text-[var(--text-faint)]" style={MONO}>{g.url ?? g.command?.join(" ") ?? "—"}</p>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest text-[var(--text-faint)]" style={MONO}>global</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {activeProject && projectOpencodeMcps.length > 0 && (
            <div className="flex flex-col gap-2">
              <h5 className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]" style={MONO}>Proyecto · {activeProject.name}</h5>
              <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)]/40">
                {projectOpencodeMcps.map((g, idx) => (
                  <div key={g.name} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${idx > 0 ? "border-t border-[var(--border)]" : ""}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] font-medium text-[var(--text-primary)]">{g.name}</span>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${g.enabled ? "bg-green-500/12 text-green-600 dark:text-green-400 border border-green-500/20" : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]"}`} style={MONO}>{g.enabled ? "activo" : "desactivado"}</span>
                        <span className="text-[10px] text-[var(--text-faint)]" style={MONO}>{g.type}</span>
                      </div>
                      <p className="truncate text-[11px] text-[var(--text-faint)]" style={MONO}>{g.url ?? g.command?.join(" ") ?? "—"}</p>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest text-[var(--text-faint)]" style={MONO}>proyecto</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>
      <p className="text-center text-[11px] leading-4 text-[var(--text-faint)]">
        Se guardan en <code style={MONO} className="rounded-[6px] bg-[var(--surface)] border border-[var(--border)] px-1.5 py-0.5 text-[11px]">.agents/mcp.json</code> + repo <code style={MONO} className="rounded-[6px] bg-[var(--surface)] border border-[var(--border)] px-1.5 py-0.5 text-[11px]">termcanvas-context</code>. Los tokens quedan en el vault local.
      </p>
      <style>{`@keyframes mcp-card-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
