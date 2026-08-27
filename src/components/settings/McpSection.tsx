import { useEffect, useState, useCallback, useMemo } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useProjectMcpStore } from "../../stores/projectMcpStore";
import { MCP_CATALOG, type McpServerId } from "../../../shared/mcp";
import { CustomMcpSection } from "./CustomMcpSection";

const MONO = { fontFamily: '"Geist Mono", monospace' } as const;

// ── Status badge ──────────────────────────────────────────────────────────
const STATUS_META: Record<string, { dot: string; label: string; ring: string }> = {
  connected: { dot: "bg-[var(--green)]", label: "Conectado", ring: "border-[var(--green)]/20 bg-[var(--green)]/10" },
  connecting: { dot: "bg-[var(--yellow)] animate-pulse", label: "Conectando…", ring: "border-[var(--yellow)]/20 bg-[var(--yellow)]/10" },
  needs_auth: { dot: "bg-[var(--orange)]", label: "Requiere token", ring: "border-[var(--orange)]/20 bg-[var(--orange)]/10" },
  error: { dot: "bg-[var(--red)]", label: "Error", ring: "border-[var(--red)]/20 bg-[var(--red)]/10" },
  disconnected: { dot: "bg-[var(--text-faint)]", label: "Desconectado", ring: "border-[var(--border)] bg-[var(--surface)]" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.disconnected;
  const isActive = status === "connected" || status === "connecting" || status === "needs_auth" || status === "error";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tracking-tight ${meta.ring} ${isActive ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}
      style={MONO}
    >
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
        className={`relative h-[22px] w-[42px] rounded-full border transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]/30 peer-focus-visible:ring-offset-0 ${
          checked ? "bg-[var(--accent)] border-[var(--accent)]" : "bg-[var(--surface-hover)] border-[var(--border)]"
        } after:absolute after:left-[3px] after:top-[3px] after:h-[16px] after:w-[16px] after:rounded-full after:bg-white after:shadow-sm after:transition-all after:duration-200 ${checked ? "after:translate-x-[20px]" : ""}`}
      />
    </label>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/20 px-4 py-4 animate-pulse">
      <div className="flex gap-3">
        <div className="h-8 w-8 rounded-md bg-[var(--surface-hover)]" />
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

// ── Main ─────────────────────────────────────────────────────────────────
export function McpIntegrationsSection() {
  const projects = useProjectStore((s) => s.projects);
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const byProject = useProjectMcpStore((s) => s.byProject);
  const loading = useProjectMcpStore((s) => s.loading);
  const storeError = useProjectMcpStore((s) => s.error);
  const refresh = useProjectMcpStore((s) => s.refresh);
  const setEnabled = useProjectMcpStore((s) => s.setEnabled);
  const setSecret = useProjectMcpStore((s) => s.setSecret);
  const connect = useProjectMcpStore((s) => s.connect);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? projects[0] ?? null,
    [projects, selectedId],
  );

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
    if (!selectedProject) {
      setProjectOpencodeMcps([]);
      return;
    }
    void (window as any).termcanvas?.mcp?.projectOpencodeStatus?.(selectedProject.path)
      .then((res: any) => {
        if (res?.ok) setProjectOpencodeMcps(res.result);
      })
      .catch(() => {});
    void refresh(selectedProject.id, selectedProject.path);
  }, [selectedProject?.id, selectedProject?.path, refresh]);

  useEffect(() => {
    if (!selectedId && projects[0]) setSelectedId(projects[0].id);
    if (selectedId && !projects.find((p) => p.id === selectedId) && projects[0]) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [savingToken, setSavingToken] = useState<Record<string, boolean>>({});
  const [healthByServer, setHealthByServer] = useState<Record<string, { ok: boolean; latencyMs?: number; error?: string; details?: string } | null>>({});
  const [healthLoading, setHealthLoading] = useState<Record<string, boolean>>({});
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const handleToggle = useCallback(
    async (serverId: McpServerId, enabled: boolean) => {
      if (!selectedProject) return;
      setToggling((p) => ({ ...p, [serverId]: true }));
      try {
        await setEnabled(selectedProject.id, selectedProject.path, serverId, enabled);
      } finally {
        setToggling((p) => ({ ...p, [serverId]: false }));
      }
    },
    [selectedProject, setEnabled],
  );

  const handleSaveToken = useCallback(
    async (serverId: McpServerId) => {
      if (!selectedProject) return;
      const token = tokenDrafts[serverId]?.trim();
      if (!token) return;
      setSavingToken((p) => ({ ...p, [serverId]: true }));
      await setSecret(selectedProject.id, selectedProject.path, serverId, token);
      setTokenDrafts((p) => ({ ...p, [serverId]: "" }));
      setSavingToken((p) => ({ ...p, [serverId]: false }));
    },
    [selectedProject, tokenDrafts, setSecret],
  );

  const handleClearToken = useCallback(
    async (serverId: McpServerId) => {
      if (!selectedProject) return;
      setSavingToken((p) => ({ ...p, [serverId]: true }));
      await setSecret(selectedProject.id, selectedProject.path, serverId, null);
      setSavingToken((p) => ({ ...p, [serverId]: false }));
    },
    [selectedProject, setSecret],
  );

  const handleHealthCheck = useCallback(
    async (serverId: McpServerId) => {
      if (!selectedProject) return;
      setHealthLoading((p) => ({ ...p, [serverId]: true }));
      try {
        const res: any = await (window as any).termcanvas.mcp.healthCheck(selectedProject.id, serverId, selectedProject.path);
        if (res.ok) setHealthByServer((p) => ({ ...p, [serverId]: res.result }));
        else setHealthByServer((p) => ({ ...p, [serverId]: { ok: false, error: res.error } }));
      } catch (e) {
        setHealthByServer((p) => ({ ...p, [serverId]: { ok: false, error: e instanceof Error ? e.message : String(e) } }));
      } finally {
        setHealthLoading((p) => ({ ...p, [serverId]: false }));
      }
    },
    [selectedProject],
  );

  const status = selectedProject ? byProject[selectedProject.id] : undefined;
  const isLoading = selectedProject ? !!loading[selectedProject.id] : false;
  const projectError = selectedProject ? storeError[selectedProject.id] : null;

  // No fallback disconnected — si aún no hay status, mostramos skeletons para no mentir con "desconectado"
  const serversToRender = status?.servers ?? [];

  const stats = useMemo(() => {
    if (!status) return null;
    const total = status.servers.length;
    const connected = status.servers.filter((s) => s.status === "connected").length;
    const needsAuth = status.servers.filter((s) => s.status === "needs_auth").length;
    const enabled = status.servers.filter((s) => s.config.enabled).length;
    const errors = status.servers.filter((s) => s.status === "error").length;
    return { total, connected, needsAuth, enabled, errors };
  }, [status]);

  const hasProjects = projects.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Project picker ─────────────────────────────── */}
      {hasProjects ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="tc-eyebrow" style={MONO}>
              Proyecto
            </span>
            <span className="text-[11px] text-[var(--text-faint)]" style={MONO}>
              {projects.length} proyecto{projects.length !== 1 ? "s" : ""} en el canvas
            </span>
          </div>
          <div className="relative">
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)]/60 px-3 py-2.5 pr-8 text-[13px] font-medium text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-hover)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.path}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
          {selectedProject && (
            <p className="truncate text-[11px] text-[var(--text-faint)]" style={MONO} title={selectedProject.path}>
              {selectedProject.path}
            </p>
          )}
        </div>
      ) : (
        <div className="flex gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
          <span className="mt-0.5 shrink-0 text-amber-600">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 5v4M8 11h.01M13 8A5 5 0 1 1 3 8a5 5 0 0 1 10 0Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium leading-5 text-amber-700 dark:text-amber-300">Sin proyectos en el canvas</p>
            <p className="text-[11px] leading-4 text-amber-700/70 dark:text-amber-300/70">
              Agregá una carpeta al canvas para configurar MCPs por proyecto. Igual podés revisar abajo tus MCPs globales de Opencode (solo lectura).
            </p>
          </div>
        </div>
      )}

      {/* ── Explainer ─────────────────────────────────── */}
      <div className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/40 px-4 py-3">
        <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM8 7v3M8 13.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M10.5 8H11M5 8h.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-[12px] font-medium leading-5 text-[var(--text-primary)]">MCPs por proyecto, sincronizados entre dispositivos</p>
          <p className="text-[11px] leading-[1.5] text-[var(--text-muted)]">
            Activá un MCP para este proyecto y todos los LLMs (Claude, Codex, etc.) lo verán. La configuración viaja con el repo privado{" "}
            <code className="rounded bg-[var(--surface-hover)] px-1 py-0.5 text-[11px] text-[var(--text-secondary)]" style={MONO}>
              termcanvas-context
            </code>{" "}
            — en tu otra máquina solo te pedirá el token una vez (vault cifrado por dispositivo).
          </p>
        </div>
      </div>

      {projectError && (
        <div className="rounded-lg border border-[var(--red)]/20 bg-[var(--red)]/5 px-3 py-2.5 text-[12px] text-[var(--red)]">
          {projectError}
        </div>
      )}

      {/* ── Stats ─────────────────────────────────────── */}
      {stats && hasProjects && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Activos", value: stats.enabled, hint: `${stats.enabled}/${stats.total}` },
            { label: "Conectados", value: stats.connected, accent: stats.connected > 0 },
            { label: "Requieren token", value: stats.needsAuth, warn: stats.needsAuth > 0 },
            { label: "Con error", value: stats.errors, danger: stats.errors > 0 },
          ].map((s) => (
            <div
              key={s.label}
              className={`rounded-lg border px-3 py-2.5 text-center ${
                s.accent
                  ? "border-[var(--green)]/20 bg-[var(--green)]/5"
                  : s.warn
                    ? "border-[var(--orange)]/20 bg-[var(--orange)]/5"
                    : s.danger
                      ? "border-[var(--red)]/20 bg-[var(--red)]/5"
                      : "border-[var(--border)] bg-[var(--surface)]/30"
              }`}
            >
              <div
                className={`text-[17px] font-semibold leading-none tracking-tight ${s.accent ? "text-[var(--green)]" : s.warn ? "text-[var(--orange)]" : s.danger ? "text-[var(--red)]" : "text-[var(--text-primary)]"}`}
              >
                {s.value}
              </div>
              <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-[var(--text-muted)]">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Catalog ───────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="tc-eyebrow" style={MONO}>
            Catálogo del proyecto
          </h4>
          {status ? (
            <span className="text-[11px] text-[var(--text-faint)]" style={MONO}>
              {stats ? `${stats.total} MCPs` : ""}
              {selectedProject ? ` · ${selectedProject.name}` : ""}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--text-faint)]">cargando…</span>
          )}
        </div>

        {!hasProjects ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)]/20 px-4 py-8 text-center">
            <p className="text-[13px] font-medium text-[var(--text-secondary)]">Necesitás un proyecto para activar MCPs</p>
            <p className="mx-auto mt-1 max-w-[32ch] text-[11px] leading-4 text-[var(--text-muted)]">Arrastrá una carpeta al canvas o usá “Add Project” y volvé acá.</p>
          </div>
        ) : isLoading && !status ? (
          <div className="flex flex-col gap-2">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : serversToRender.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/20 px-4 py-6 text-center text-[11px] text-[var(--text-muted)]">No hay MCPs para mostrar.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {serversToRender.map((s) => {
              const isEnabled = s.config.enabled;
              const needsAuth = s.status === "needs_auth";
              const hasSecret = s.hasSecret;
              const isConnected = s.status === "connected";
              const isError = s.status === "error";
              const isConnecting = s.status === "connecting";
              const initial = s.catalog.name.slice(0, 1).toUpperCase();
              const transportLabel = s.catalog.transport === "http" ? "Remote" : "Local";
              const endpoint =
                s.catalog.transport === "http" ? s.catalog.defaultUrl ?? "" : `${s.catalog.defaultCommand ?? ""} ${(s.catalog.defaultArgs ?? []).join(" ")}`.trim();
              const health = healthByServer[s.catalog.id];
              const isHealthLoading = !!healthLoading[s.catalog.id];
              const isToggling = !!toggling[s.catalog.id];

              return (
                <div
                  key={s.catalog.id}
                  className={`group flex flex-col overflow-hidden rounded-xl border bg-[var(--surface)]/40 shadow-sm transition-colors ${
                    isEnabled
                      ? isConnected
                        ? "border-[var(--border)] hover:border-[var(--border-hover)]"
                        : needsAuth
                          ? "border-[var(--orange)]/25 hover:border-[var(--orange)]/30"
                          : isError
                            ? "border-[var(--red)]/25 hover:border-[var(--red)]/30"
                            : "border-[var(--border)]"
                      : "border-[var(--border)] opacity-[0.92] hover:opacity-100"
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    <div
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-[12px] font-semibold tracking-tight ${
                        isEnabled && isConnected
                          ? "border-[var(--green)]/20 bg-[var(--green)]/10 text-[var(--green)]"
                          : isEnabled && needsAuth
                            ? "border-[var(--orange)]/20 bg-[var(--orange)]/10 text-[var(--orange)]"
                            : isEnabled && isError
                              ? "border-[var(--red)]/20 bg-[var(--red)]/10 text-[var(--red)]"
                              : "border-[var(--border)] bg-[var(--surface-hover)] text-[var(--text-muted)]"
                      }`}
                      aria-hidden
                    >
                      {initial}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">{s.catalog.name}</span>
                        <StatusBadge status={s.status} />
                        {typeof s.toolCount === "number" && isConnected && (
                          <span className="inline-flex items-center rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]" style={MONO}>
                            {s.toolCount} tools
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest ${s.catalog.transport === "http" ? "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"}`}
                          style={MONO}
                          title={s.catalog.transport}
                        >
                          <span className={`h-1 w-1 rounded-full ${s.catalog.transport === "http" ? "bg-sky-500" : "bg-[var(--text-muted)]"}`} />
                          {transportLabel}
                        </span>
                        {isConnecting && <span className="text-[11px] text-[var(--text-muted)]">— conectando…</span>}
                      </div>

                      <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-[var(--text-muted)]">{s.catalog.description}</p>

                      <p
                        className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-[var(--text-faint)]"
                        style={MONO}
                        title={endpoint}
                      >
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="shrink-0 opacity-60" aria-hidden>
                          <path d="M3.5 4.5h5M3.5 6h5M3.5 7.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                          <rect x="2.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
                        </svg>
                        <span className="truncate">{endpoint || "—"}</span>
                      </p>
                    </div>

                    <div className="ml-2 flex shrink-0 flex-col items-end gap-1.5">
                      <Toggle
                        checked={isEnabled}
                        onChange={(v) => void handleToggle(s.catalog.id, v)}
                        disabled={isToggling || !hasProjects}
                        label={`Activar ${s.catalog.name}`}
                      />
                      <span className="text-[10px] font-medium tracking-wide text-[var(--text-faint)]" style={MONO}>
                        {isToggling ? "guardando…" : isEnabled ? "activo" : "inactivo"}
                      </span>
                    </div>
                  </div>

                  {/* Body when enabled */}
                  {isEnabled ? (
                    <div className="flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--bg)]/60 px-4 py-3">
                      {/* Auth block */}
                      {s.catalog.auth && (
                        <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]/60 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]" style={MONO}>
                              {s.catalog.auth.label}
                            </span>
                            {hasSecret ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--green)]/10 px-2 py-1 text-[11px] font-medium text-[var(--green)]">
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" /> Token guardado en este dispositivo
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--orange)]/10 px-2 py-1 text-[11px] font-medium text-[var(--orange)]">
                                Falta token — sin esto no conecta
                              </span>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <input
                                type={showToken[s.catalog.id] ? "text" : "password"}
                                placeholder={s.catalog.auth.placeholder}
                                value={tokenDrafts[s.catalog.id] ?? ""}
                                onChange={(e) => setTokenDrafts((p) => ({ ...p, [s.catalog.id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleSaveToken(s.catalog.id);
                                }}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 pr-8 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--accent)] focus:bg-[var(--surface)]"
                                style={MONO}
                                aria-label={`Token para ${s.catalog.name}`}
                              />
                              <button
                                type="button"
                                onClick={() => setShowToken((p) => ({ ...p, [s.catalog.id]: !p[s.catalog.id] }))}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                                aria-label={showToken[s.catalog.id] ? "Ocultar token" : "Mostrar token"}
                                title={showToken[s.catalog.id] ? "Ocultar" : "Mostrar"}
                              >
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                                  {showToken[s.catalog.id] ? (
                                    <path d="M2 7s2.2-3.2 5-3.2S12 7 12 7s-2.2 3.2-5 3.2S2 7 2 7Zm5 1.5A1.5 1.5 0 1 1 7 5.5a1.5 1.5 0 0 1 0 3Z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                                  ) : (
                                    <path d="M3 3 11 11M2 7s2.2-3.2 5-3.2c.9 0 1.7.3 2.5.8M9.8 9.1A4.2 4.2 0 0 1 7 10.2C4.2 10.2 2 7 2 7s.7-1 1.9-1.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                                  )}
                                </svg>
                              </button>
                            </div>

                            <button
                              type="button"
                              disabled={!tokenDrafts[s.catalog.id]?.trim() || !!savingToken[s.catalog.id]}
                              onClick={() => void handleSaveToken(s.catalog.id)}
                              className="shrink-0 rounded-md bg-[var(--accent)] px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {savingToken[s.catalog.id] ? "Guardando…" : hasSecret ? "Actualizar" : "Guardar"}
                            </button>

                            {hasSecret && (
                              <button
                                type="button"
                                onClick={() => void handleClearToken(s.catalog.id)}
                                disabled={!!savingToken[s.catalog.id]}
                                className="shrink-0 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--red)]/30 hover:bg-[var(--red)]/5 hover:text-[var(--red)] disabled:opacity-40"
                              >
                                Borrar
                              </button>
                            )}
                          </div>

                          {needsAuth && (
                            <p className="rounded-md bg-[var(--orange)]/8 px-2.5 py-2 text-[11px] leading-4 text-[var(--orange)]">
                              Este MCP está activo pero necesita token en este dispositivo. Lo activaste en otra PC — pegá el token acá una sola vez y todos los LLMs lo usarán.
                            </p>
                          )}

                          {s.catalog.auth.helpUrl && (
                            <a
                              href={s.catalog.auth.helpUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-[var(--accent)] hover:underline"
                            >
                              ¿Dónde consigo el token? <span aria-hidden>↗</span>
                            </a>
                          )}

                          {s.lastError && <p className="text-[11px] leading-4 text-[var(--red)]">{s.lastError}</p>}

                          {hasSecret && s.status !== "connected" && !needsAuth && (
                            <button
                              type="button"
                              onClick={() => void connect(selectedProject!.id, selectedProject!.path, s.catalog.id)}
                              className="self-start rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                            >
                              Reconectar
                            </button>
                          )}
                        </div>
                      )}

                      {/* Health */}
                      <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]/40 px-3 py-2.5">
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]" style={MONO}>
                          Health
                        </span>

                        <span className="min-w-0 flex-1 truncate text-[11px] leading-4">
                          {health ? (
                            health.ok ? (
                              <span className="inline-flex items-center gap-1.5 font-medium text-[var(--green)]">
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
                                OK {health.latencyMs != null ? `· ${health.latencyMs}ms` : ""} {health.details ? `· ${health.details}` : ""}
                              </span>
                            ) : (
                              <span className="inline-flex items-start gap-1.5 font-medium text-[var(--red)]">
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--red)]" />
                                <span className="break-words">
                                  {health.error} {health.details ? `(${health.details})` : ""}
                                </span>
                              </span>
                            )
                          ) : (
                            <span className="text-[var(--text-faint)]">
                              {needsAuth
                                ? "Requiere token — no se puede verificar"
                                : isConnected
                                  ? "Conectado — podés verificar la conexión"
                                  : isError
                                    ? "Error — probá verificar la conexión"
                                    : "Probá la conexión para confirmar"}
                            </span>
                          )}
                        </span>

                        <div className="ml-auto flex shrink-0 items-center gap-2">
                          {isHealthLoading ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]" aria-live="polite">
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden>
                                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                                <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                              Verificando…
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={needsAuth}
                              onClick={() => void handleHealthCheck(s.catalog.id)}
                              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                              title={needsAuth ? "Requiere token" : "Probar conexión al MCP"}
                            >
                              Probar
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Non-auth connect/error */}
                      {!s.catalog.auth && s.status !== "connected" && !isConnecting && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void connect(selectedProject!.id, selectedProject!.path, s.catalog.id)}
                            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                          >
                            Conectar
                          </button>
                          {s.lastError && <span className="text-[11px] text-[var(--red)]">{s.lastError}</span>}
                        </div>
                      )}

                      {isConnected && !s.catalog.auth && s.lastError && <p className="text-[11px] text-[var(--red)]">{s.lastError}</p>}
                    </div>
                  ) : (
                    <div className="border-t border-dashed border-[var(--border)] bg-[var(--surface)]/20 px-4 py-2.5">
                      <p className="text-[11px] leading-4 text-[var(--text-faint)]">
                        Desactivado — actívalo para que todos los LLMs de este proyecto lo vean. Sin instalaciones externas.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Customs ───────────────────────────────────── */}
      {selectedProject && status ? (
        <CustomMcpSection
          projectId={selectedProject.id}
          projectPath={selectedProject.path}
          customs={(() => {
            const builtInIds = new Set(MCP_CATALOG.map((c) => c.id));
            return status.servers.filter((s) => !builtInIds.has(s.catalog.id)).map((s) => s.catalog);
          })()}
          onRefresh={() => void refresh(selectedProject.id, selectedProject.path)}
        />
      ) : selectedProject && !status && !isLoading ? (
        <CustomMcpSection projectId={selectedProject.id} projectPath={selectedProject.path} customs={[]} onRefresh={() => void refresh(selectedProject.id, selectedProject.path)} />
      ) : null}

      {/* ── Opencode (read-only, collapsible) ─────────── */}
      <details className="group rounded-lg border border-[var(--border)] bg-[var(--surface)]/20">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[var(--text-muted)] group-open:rotate-90 transition-transform" aria-hidden>
              <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Opencode existente (solo lectura)
            <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]" style={MONO}>
              {globalMcps.length + projectOpencodeMcps.length}
            </span>
          </span>
          <span className="text-[11px] text-[var(--text-faint)]">avanzado</span>
        </summary>

        <div className="border-t border-[var(--border)] px-4 py-3 flex flex-col gap-4">
          <p className="text-[11px] leading-4 text-[var(--text-muted)]">
            Estos son tus MCPs ya configurados en <code style={MONO} className="rounded bg-[var(--surface-hover)] px-1 py-0.5">opencode.json</code> (global y del proyecto). Son
            solo lectura acá — los de arriba son los que TermCanvas gestiona por proyecto y sincroniza entre dispositivos.
          </p>

          <div className="flex flex-col gap-3">
            <h5 className="tc-eyebrow" style={MONO}>
              Global · ~/.config/opencode
            </h5>
            {globalMcps.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg)]/40 px-3 py-2.5 text-[11px] text-[var(--text-faint)]">
                No se detectaron MCPs globales. Los que actives por proyecto aparecerán arriba.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]/40">
                {globalMcps.map((g, idx) => (
                  <div key={g.name} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${idx > 0 ? "border-t border-[var(--border)]" : ""}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] font-medium text-[var(--text-primary)]">{g.name}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${g.enabled ? "bg-green-500/12 text-green-600 dark:text-green-400 border border-green-500/20" : "bg-[var(--surface-hover)] text-[var(--text-muted)] border border-transparent"}`}
                          style={MONO}
                        >
                          {g.enabled ? "activo" : "desactivado"}
                        </span>
                        <span className="text-[10px] text-[var(--text-faint)]" style={MONO}>
                          {g.type}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-[var(--text-faint)]" style={MONO}>
                        {g.url ?? g.command?.join(" ") ?? "—"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest text-[var(--text-faint)]" style={MONO}>
                      global
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedProject && projectOpencodeMcps.length > 0 && (
            <div className="flex flex-col gap-2">
              <h5 className="tc-eyebrow" style={MONO}>
                Proyecto · {selectedProject.name}
              </h5>
              <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]/40">
                {projectOpencodeMcps.map((g, idx) => (
                  <div key={g.name} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${idx > 0 ? "border-t border-[var(--border)]" : ""}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] font-medium text-[var(--text-primary)]">{g.name}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${g.enabled ? "bg-green-500/12 text-green-600 dark:text-green-400 border border-green-500/20" : "bg-[var(--surface-hover)] text-[var(--text-muted)] border border-transparent"}`}
                          style={MONO}
                        >
                          {g.enabled ? "activo" : "desactivado"}
                        </span>
                        <span className="text-[10px] text-[var(--text-faint)]" style={MONO}>
                          {g.type}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-[var(--text-faint)]" style={MONO}>
                        {g.url ?? g.command?.join(" ") ?? "—"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-widest text-[var(--text-faint)]" style={MONO}>
                      proyecto
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>

      <p className="text-center text-[11px] leading-4 text-[var(--text-faint)]">
        Los MCPs por proyecto se guardan y comparten vía <code style={MONO} className="rounded bg-[var(--surface-hover)] px-1 py-0.5">.agents/mcp.json</code> + el repo privado{" "}
        <code style={MONO} className="rounded bg-[var(--surface-hover)] px-1 py-0.5">
          termcanvas-context
        </code>
        . Los tokens nunca viajan por Git — quedan en el vault cifrado de cada dispositivo.
      </p>
    </div>
  );
}
