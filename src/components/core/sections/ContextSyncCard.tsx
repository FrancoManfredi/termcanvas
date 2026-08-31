// Tarjeta de sincronización de contexto (.agents) entre máquinas vía el
// sidecar privado termcanvas-context. Envuelve el mismo motor que el CLI
// (`termcanvas context ...`) expuesto por IPC en window.termcanvas.contextSync.
//
// Estados: sin inicializar → botón "Activar" (crea el repo privado con gh,
// con confirmación); inicializado → "Sincronizar" (pull + push) y línea de
// estado con lo que difiere contra el remoto real.

import { useCallback, useEffect, useState } from "react";

import { useProjectStore } from "../../../stores/projectStore";
import { useNotificationStore } from "../../../stores/notificationStore";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import type {
  ContextSyncStatus,
  ContextSyncConfig,
  IpcEnvelope,
} from "../../../types";

/** Worktree activo del canvas (mismo criterio que la sesión de planning). */
function useActiveRepoPath(): string | null {
  const projects = useProjectStore((s) => s.projects);
  const focusedProjectId = useProjectStore((s) => s.focusedProjectId);
  const focusedWorktreeId = useProjectStore((s) => s.focusedWorktreeId);

  const project =
    projects.find((p) => p.id === focusedProjectId) ?? projects[0] ?? null;
  if (!project) return null;
  const worktree =
    project.worktrees.find((w) => w.id === focusedWorktreeId) ??
    project.worktrees.find((w) => w.isPrimary) ??
    project.worktrees[0];
  return worktree?.path ?? project.path;
}

type Phase = "loading" | "ready" | "working";

export function ContextSyncCard() {
  const repoPath = useActiveRepoPath();
  const notify = useNotificationStore((s) => s.notify);

  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<ContextSyncStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastSyncSummary, setLastSyncSummary] = useState<string | null>(null);
  const [confirmInitOpen, setConfirmInitOpen] = useState(false);
  const [syncConfig, setSyncConfig] = useState<ContextSyncConfig | null>(null);
  const [cfgBusy, setCfgBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!repoPath) return;
    setPhase("loading");
    setStatusError(null);
    try {
      const [res, cfgRes] = await Promise.all([
        window.termcanvas.contextSync.status(repoPath) as Promise<IpcEnvelope<ContextSyncStatus>>,
        (window.termcanvas.contextSync.getConfig?.(repoPath) as Promise<IpcEnvelope<ContextSyncConfig>> | undefined)?.catch(() => null),
      ]);
      if (!res.ok) {
        setStatus(null);
        setStatusError(res.error);
        setPhase("ready");
        if (cfgRes && cfgRes.ok) setSyncConfig(cfgRes.result);
        return;
      }
      setStatus(res.result);
      // cfgRes tiene prioridad, si no viene usamos status.syncConfig
      if (cfgRes && cfgRes.ok) setSyncConfig(cfgRes.result);
      else if (res.result.syncConfig) setSyncConfig(res.result.syncConfig);
      setPhase("ready");
    } catch (err) {
      setStatus(null);
      setStatusError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  }, [repoPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activate = async () => {
    if (!repoPath) return;
    setConfirmInitOpen(false);
    setPhase("working");
    try {
      const res = await window.termcanvas.contextSync.init(repoPath);
      if (!res.ok) throw new Error(res.error);
      notify("info", `Sincronización activada: ${res.result.slug}`);
      await refresh();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  };

  const toggleCfg = async (key: keyof ContextSyncConfig) => {
    if (!repoPath || !syncConfig) return;
    const next = { ...syncConfig, [key]: !syncConfig[key] };
    setSyncConfig(next);
    setCfgBusy(key);
    try {
      const res = await window.termcanvas.contextSync.setConfig(repoPath, next);
      if (!res.ok) throw new Error(res.error);
      setSyncConfig(res.result);
      void refresh();
      notify("info", `${key} ${res.result[key] ? "activado" : "pausado"} para sincronización`);
    } catch (err) {
      setSyncConfig(syncConfig);
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setCfgBusy(null);
    }
  };

  const syncNow = async () => {
    if (!repoPath) return;
    setPhase("working");
    setStatusError(null);
    try {
      const res = await window.termcanvas.contextSync.sync(repoPath);
      if (!res.ok) throw new Error(res.error);
      const { pulled, pushed } = res.result;
      const parts: string[] = [];
      if (pulled.pulled) parts.push(`${pulled.addedKeys.length} nuevo(s) del remoto`);
      if (pulled.conflicts.length > 0)
        parts.push(`${pulled.conflicts.length} conflicto(s) guardado(s) como .conflict-*`);
      parts.push(pushed.pushed ? `${pushed.copiedCount} archivo(s) pusheado(s)` : "nada para pushear");
      setLastSyncSummary(parts.join(" · "));
      await refresh();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  };

  if (!repoPath) return null;

  const busy = phase !== "ready";
  const needsInit = status !== null && !status.initialized;
  const hasLocalAgents = statusError === null || !/no hay contexto/.test(statusError);

  const cfgItems: Array<{ key: keyof ContextSyncConfig; label: string; hint: string }> = [
    { key: "entrevistas", label: "Entrevistas", hint: ".agents/interview" },
    { key: "diagnosticos", label: "Diagnósticos", hint: ".agents/planning" },
    { key: "mcp", label: "MCPs", hint: "mcp.json · sin secretos" },
    { key: "skills", label: "Skills", hint: ".agents/diagnosis-skills" },
  ];

  return (
    <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 self-center">
          <p className="text-[11px] font-semibold text-[var(--text-primary)]">
            Sincronización entre máquinas
          </p>
          <p className="text-[10px] text-[var(--text-muted)] truncate">
            .agents en repo privado termcanvas-context · elegí qué sincronizar
          </p>
        </div>
        {needsInit ? (
          <button
            type="button"
            className="btn btn-primary text-[11px] py-1 px-2.5 min-h-[30px] shrink-0 self-center"
            disabled={busy}
            onClick={() => setConfirmInitOpen(true)}
          >
            Activar
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary text-[11px] py-1 px-2.5 min-h-[30px] shrink-0 self-center"
            disabled={busy || !hasLocalAgents}
            onClick={() => void syncNow()}
            title="Pull + push del contexto .agents"
          >
            {busy ? "…" : "Sincronizar"}
          </button>
        )}
      </div>

      {/* Switches: qué se sincroniza */}
      {syncConfig && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/40 divide-y divide-[var(--border)]">
          {cfgItems.map((it) => {
            const on = syncConfig[it.key];
            const disabled = cfgBusy !== null || busy;
            return (
              <div key={it.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-[var(--text-primary)] leading-none">{it.label}</p>
                  <p className="text-[10px] font-mono text-[var(--text-muted)] truncate">{it.hint}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => void toggleCfg(it.key)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 ${on ? "bg-[var(--accent)] border-[var(--accent)]" : "bg-[var(--surface)] border-[var(--border)]"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-1"}`} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {busy && phase === "loading" && (
        <p className="text-[10px] text-[var(--text-muted)]">Consultando estado…</p>
      )}

      {statusError && (
        <p className="text-[10px] leading-snug text-[var(--red)] whitespace-pre-wrap">
          {statusError}
        </p>
      )}

      {!statusError && status?.initialized && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-[var(--text-muted)]">
          <span>solo local: {status.onlyLocal.length}</span>
          <span>cambiados: {status.changed.length}</span>
          <span>solo remoto: {status.onlyRemote.length}</span>
          {status.behindRemote > 0 && (
            <span className="text-[var(--amber)]">detrás: {status.behindRemote}</span>
          )}
          {status.unpushedCommits > 0 && (
            <span className="text-[var(--amber)]">sin pushear: {status.unpushedCommits}</span>
          )}
        </div>
      )}

      {!statusError && status && !status.initialized && (
        <p className="text-[10px] leading-snug text-[var(--text-muted)]">
          Sin sidecar inicializado. Se crea un repo PRIVADO en tu cuenta de GitHub
          y se agrega .agents/ al .gitignore del proyecto.
        </p>
      )}

      {lastSyncSummary && (
        <p className="text-[10px] leading-snug text-[var(--text-secondary)]">
          Última sincronización: {lastSyncSummary}
        </p>
      )}

      <ConfirmDialog
        open={confirmInitOpen}
        title="Activar sincronización de contexto"
        body={
          <div className="space-y-1.5 text-xs">
            <p>
              Se va a crear el repositorio <strong>privado</strong>{" "}
              <code>&lt;tu-usuario&gt;/termcanvas-context</code> en tu cuenta de
              GitHub (usa gh autenticado) y se clonará localmente.
            </p>
            <p>
              El contexto (.agents/) de este proyecto se sincronizará ahí, nunca
              en el repo del proyecto. Requiere gh autenticado.
            </p>
          </div>
        }
        confirmLabel="Crear repo privado y activar"
        busy={false}
        onCancel={() => setConfirmInitOpen(false)}
        onConfirm={() => void activate()}
      />
    </div>
  );
}
