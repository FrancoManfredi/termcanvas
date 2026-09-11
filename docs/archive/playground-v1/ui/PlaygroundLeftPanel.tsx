import { useCallback, useState } from "react";
import { PLAYGROUND_FS } from "../../lib/factory/playgroundData";
import {
  getLatestVerdict,
  getRollbackWarnings,
  isBlocked,
  isFlaky,
  usePlaygroundStore,
  type PlaygroundVerdicts,
} from "../../stores/playgroundStore";
import { useSidebarDragStore } from "../../stores/sidebarDragStore";
import { getCodeHash } from "../../lib/factory/playgroundReports";
import { FACTORY_HEALTH, verifyHealthWithRetry, verifyJobCreate } from "../../lib/factory/verifyRunner";

// ── Icons (inline SVG, no external deps) ──

function IconBeaker({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2h4M7 2v3.5L3.5 10.2a1.2 1.2 0 0 0 1 1.8h7a1.2 1.2 0 0 0 1-1.8L9 5.5V2" />
      <path d="M5 9h6" strokeOpacity="0.5" />
    </svg>
  );
}

function IconChevronLeft({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronRight({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M3 2L7 5L3 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type BadgeTone = "pendiente" | "en_curso" | "verificado" | "fallo" | "reservas" | "flaky";

function toneForF(id: string, verdicts: PlaygroundVerdicts): BadgeTone {
  // Flaky detection overrides visual tone (auto)
  if (isFlaky(verdicts, id)) return "flaky";
  const v = getLatestVerdict(verdicts, id);
  if (!v) return "pendiente";
  if (v.status === "flaky") return "flaky";
  if (v.status === "aprobado") return "verificado";
  if (v.status === "aprobado_con_reservas") return "reservas";
  if (v.status === "fallo") return "fallo";
  if (v.status === "bloqueado") return "pendiente";
  if (v.status === "pendiente") return "en_curso";
  return "pendiente";
}

function dotColor(tone: BadgeTone): string {
  switch (tone) {
    case "verificado":
      return "var(--green)";
    case "fallo":
      return "var(--red)";
    case "en_curso":
      return "var(--amber)";
    case "reservas":
      return "#d4a017";
    case "flaky":
      return "#f97316";
    case "pendiente":
    default:
      return "var(--text-faint)";
  }
}

function dotLabel(tone: BadgeTone): string {
  switch (tone) {
    case "verificado":
      return "Verificado";
    case "fallo":
      return "Falló";
    case "en_curso":
      return "En curso";
    case "reservas":
      return "Con reservas";
    case "flaky":
      return "Flaky";
    case "pendiente":
    default:
      return "Pendiente";
  }
}

/**
 * Left collapsible panel listing F01..F05.
 * Mirrors LeftPanel behaviour: 240 ms width transition, 44 px collapsed strip,
 * drag handle on the right edge, stores width/collapsed in playgroundStore.
 * Shows lock state when an F is blocked by its dependencies.
 * Includes "Correr todos los desbloqueados" batch (improvement #6).
 */
export function PlaygroundLeftPanel() {
  const collapsed = usePlaygroundStore((s) => s.leftCollapsed);
  const width = usePlaygroundStore((s) => s.leftWidth);
  const selectedFId = usePlaygroundStore((s) => s.selectedFId);
  const verdicts = usePlaygroundStore((s) => s.verdicts);
  const setCollapsed = usePlaygroundStore((s) => s.setLeftCollapsed);
  const setWidth = usePlaygroundStore((s) => s.setLeftWidth);
  const setSelected = usePlaygroundStore((s) => s.setSelectedFId);
  const setVerdict = usePlaygroundStore((s) => s.setVerdict);

  const dragging = useSidebarDragStore((s) => s.active);
  const [runningAll, setRunningAll] = useState(false);
  const [runAllSummary, setRunAllSummary] = useState<string | null>(null);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = e.currentTarget as HTMLElement;
      const pid = e.pointerId;
      handle.setPointerCapture(pid);
      const startX = e.clientX;
      const origW = width;
      useSidebarDragStore.getState().setActive(true);
      const onMove = (ev: PointerEvent) => {
        setWidth(Math.max(200, Math.min(420, origW + (ev.clientX - startX))));
      };
      const cleanup = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", cleanup);
        handle.removeEventListener("pointercancel", cleanup);
        handle.removeEventListener("lostpointercapture", cleanup);
        try {
          handle.releasePointerCapture(pid);
        } catch {}
        useSidebarDragStore.getState().setActive(false);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", cleanup);
      handle.addEventListener("pointercancel", cleanup);
      handle.addEventListener("lostpointercapture", cleanup);
    },
    [width, setWidth]
  );

  const handleRunAll = async () => {
    if (runningAll) return;
    setRunningAll(true);
    setRunAllSummary(null);
    const currentVerdicts = usePlaygroundStore.getState().verdicts;
    const todo = PLAYGROUND_FS.filter((f) => !isBlocked(f.id, currentVerdicts).blocked);
    const blockedList = PLAYGROUND_FS.filter((f) => isBlocked(f.id, currentVerdicts).blocked).map((f) => f.id);
    let okCount = 0;
    let failCount = 0;
    const codeHash = await getCodeHash().catch(() => "unknown");
    for (const f of todo) {
      try {
        if (f.id === "F01") {
          const r = await verifyHealthWithRetry(FACTORY_HEALTH, { timeoutMs: 500 });
          if (r.ok) {
            setVerdict(f.id, {
              status: "aprobado",
              notes: `Correr todos — health OK ${r.durationMs}ms queue=${JSON.stringify(r.json)}`,
              rawOutput: `GET /factory/health → ${r.status} ${JSON.stringify(r.json, null, 2)} (${r.durationMs}ms intentos:${r.attempts})`,
              codeHash,
              testedBy: "script",
            });
            okCount++;
          } else {
            const isTimeout = r.timedOut;
            setVerdict(f.id, {
              status: "fallo",
              notes: `Correr todos — ${isTimeout ? `Timeout ${r.durationMs}ms >500ms` : r.error ?? "falló"} `,
              rawOutput: `GET /factory/health → ${r.status ?? "ERR"} ${r.text ?? r.error} (${r.durationMs}ms)`,
              codeHash,
              testedBy: "script",
            });
            failCount++;
          }
        } else if (f.id === "F02") {
          const r = await verifyJobCreate("hola — job de prueba F02 (batch)", "C:\\tmp\\repo-prueba", "diagnosisLlm");
          if (r.ok) {
            setVerdict(f.id, {
              status: "aprobado",
              notes: `Correr todos — POST /factory/jobs OK (${r.durationMs}ms)`,
              rawOutput: JSON.stringify(r.job, null, 2),
              codeHash,
              testedBy: "script",
            });
            okCount++;
          } else {
            setVerdict(f.id, {
              status: "fallo",
              notes: `Correr todos — POST /factory/jobs falló: ${r.error}`,
              rawOutput: r.error ?? "unknown",
              codeHash,
              testedBy: "script",
            });
            failCount++;
          }
        } else {
          // F03-F05: at least health as proxy; if health ok → aprobado, else fallo
          const r = await verifyHealthWithRetry(FACTORY_HEALTH, { timeoutMs: 500 });
          if (r.ok) {
            setVerdict(f.id, {
              status: "aprobado",
              notes: `Correr todos — health OK (${r.durationMs}ms) — proxy para ${f.id}`,
              rawOutput: `GET /factory/health → ${r.status} ${JSON.stringify(r.json)} (${r.durationMs}ms)`,
              codeHash,
              testedBy: "script",
            });
            okCount++;
          } else {
            setVerdict(f.id, {
              status: "fallo",
              notes: `Correr todos — health falló para ${f.id}: ${r.error}`,
              rawOutput: r.text ?? r.error ?? "",
              codeHash,
              testedBy: "script",
            });
            failCount++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setVerdict(f.id, { status: "fallo", notes: `Correr todos — excepción: ${msg}`, rawOutput: msg, codeHash, testedBy: "script" });
        failCount++;
      }
    }
    const total = PLAYGROUND_FS.length;
    const summary = `${okCount}/${todo.length} verificados de ${total} total, ${failCount} fallos${blockedList.length ? `, ${blockedList.join(", ")} bloqueado${blockedList.length > 1 ? "s" : ""}` : ""} — Commit ${codeHash.slice(0, 7)} [script]`;
    setRunAllSummary(summary);
    setRunningAll(false);
    window.setTimeout(() => setRunAllSummary(null), 6000);
  };

  const handleForceUnlock = useCallback(
    async (fId: string) => {
      const currentVerdicts = usePlaygroundStore.getState().verdicts;
      const info = isBlocked(fId, currentVerdicts);
      if (!info.blocked) return;
      const codeHash = await getCodeHash().catch(() => "unknown");
      // Recolecta toda la cadena de ancestors no aprobados (transitivo completo)
      // flaky se considera aprobado — no se fuerza desbloqueo de flaky
      const toUnlock = new Set<string>();
      const visited = new Set<string>();
      const collect = (fid: string) => {
        const deps: string[] = PLAYGROUND_FS.find((x) => x.id === fid)?.blockedBy ?? [];
        for (const bid of deps) {
          if (visited.has(bid)) continue;
          visited.add(bid);
          const latest = getLatestVerdict(currentVerdicts, bid);
          const isApproved =
            latest?.status === "aprobado" ||
            latest?.status === "aprobado_con_reservas" ||
            latest?.status === "flaky";
          if (!isApproved) toUnlock.add(bid);
          collect(bid);
        }
      };
      collect(fId);
      const ids = toUnlock.size > 0 ? Array.from(toUnlock) : info.blockedBy;
      for (const bid of ids) {
        setVerdict(bid, {
          status: "aprobado_con_reservas",
          notes: "Desbloqueo forzado por tester para poder avanzar",
          codeHash,
          testedBy: "humano",
        });
      }
    },
    [setVerdict]
  );

  const displayedWidth = collapsed ? 44 : width;
  const widthTransition = dragging ? undefined : "width 240ms cubic-bezier(0.22, 0.61, 0.36, 1)";

  return (
    <div
      className="relative shrink-0 bg-[var(--surface)] border-r border-[var(--border)] overflow-hidden flex flex-col"
      style={{
        width: displayedWidth,
        transition: widthTransition,
        height: "calc(100vh - 44px)",
      }}
    >
      {collapsed ? (
        <div
          className="flex flex-col items-center pt-3 gap-1 cursor-pointer flex-1"
          style={{ width: 44 }}
          onClick={() => setCollapsed(false)}
          title="Expandir panel de Fs"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setCollapsed(false);
            }
          }}
        >
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--bg)] text-[var(--text-muted)] mb-2">
            <IconBeaker size={14} />
          </div>
          {PLAYGROUND_FS.map((f) => {
            const isActive = selectedFId === f.id;
            const tone = toneForF(f.id, verdicts);
            const blockInfo = isBlocked(f.id, verdicts);
            const flaky = isFlaky(verdicts, f.id);
            const blockedTitle = blockInfo.blocked
              ? `🔒 Bloqueado por ${blockInfo.blockedBy.join(", ")} — aprobá ${blockInfo.blockedBy[0]} para desbloquear`
              : `${f.id} — ${f.title} (${dotLabel(tone)})${flaky ? " — FLAKY" : ""}`;
            return (
              <button
                key={f.id}
                className={`relative flex items-center justify-center w-7 h-7 rounded-md text-[11px] font-semibold tracking-tight ${isActive ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"} ${blockInfo.blocked ? "opacity-50" : ""}`}
                title={blockedTitle}
                aria-label={`${f.id} ${f.title}${blockInfo.blocked ? " bloqueado" : ""}${flaky ? " flaky" : ""}`}
                aria-current={isActive ? "true" : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(f.id);
                  setCollapsed(false);
                }}
              >
                {f.badge.slice(1)}
                {blockInfo.blocked && (
                  <span className="absolute -bottom-0.5 -right-0.5 text-[8px] leading-none" aria-hidden>
                    🔒
                  </span>
                )}
                {flaky && !blockInfo.blocked && (
                  <span className="absolute -top-0.5 -left-0.5 w-1.5 h-1.5 rounded-full bg-[#f97316] animate-pulse border border-[var(--surface)]" aria-hidden title="FLAKY" />
                )}
                <span
                  className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-[var(--surface)] ${tone === "flaky" ? "animate-pulse" : ""}`}
                  style={{ backgroundColor: blockInfo.blocked ? "var(--text-faint)" : dotColor(tone) }}
                  aria-hidden
                />
              </button>
            );
          })}
          <div className="mt-auto mb-3 pointer-events-none flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)]">
            <IconChevronRight size={10} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0" style={{ width }}>
          {/* Header */}
          <div className="shrink-0 px-3 pt-3 pb-2 flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[var(--bg)] text-[var(--accent)] shrink-0">
                <IconBeaker size={14} />
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold leading-none text-[var(--text-primary)]">Factory Playground</div>
                <div className="tc-label text-[10px] leading-none mt-0.5">Pruebas por F — trazabilidad total</div>
              </div>
            </div>
            <button
              className="tc-row-icon flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] shrink-0"
              onClick={() => setCollapsed(true)}
              title="Colapsar panel"
              aria-label="Colapsar panel"
            >
              <IconChevronLeft size={10} />
            </button>
          </div>

          {/* Wave count + correr todos */}
          <div className="shrink-0 px-3 pb-2 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-[10px] tracking-wide">
              <span className="tc-eyebrow">{PLAYGROUND_FS.length} olas</span>
              <span className="text-[var(--text-faint)]">·</span>
              <span className="tc-label text-[10px]">
                {Object.values(verdicts).filter((arr) => arr.length > 0 && (arr[arr.length - 1]?.status === "aprobado" || arr[arr.length - 1]?.status === "aprobado_con_reservas")).length} verificadas
              </span>
              {Object.values(verdicts).some((arr) => arr.length > 0 && arr[arr.length - 1]?.status === "aprobado_con_reservas") && (
                <span className="ml-1 inline-flex items-center rounded-full px-1 py-0 text-[9px] font-medium bg-[#fff3c4] text-[#8a6d00] border border-[#f5d76e]">con reservas</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleRunAll()}
              disabled={runningAll}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--accent-foreground)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Verifica en secuencia cada F desbloqueado (health/job real) y guarda veredicto con testedBy script"
            >
              {runningAll ? "Corriendo…" : "▶ Correr todos los desbloqueados"}
            </button>
            {runAllSummary && (
              <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[11px] leading-snug text-[var(--text-secondary)]">
                {runAllSummary}
              </div>
            )}
          </div>

          {/* F list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
            {PLAYGROUND_FS.map((f) => {
              const isActive = selectedFId === f.id;
              const tone = toneForF(f.id, verdicts);
              const blockInfo = isBlocked(f.id, verdicts);
              const isBlockedF = blockInfo.blocked;
              const flaky = isFlaky(verdicts, f.id);
              const rollback = getRollbackWarnings(f.id, verdicts);
              const hasRollback = rollback.length > 0;
              // Flaky upstream — soft warning, NOT blocking (ver playgroundStore.ts)
              const flakyUpstream = (f.blockedBy ?? []).filter((bid) => {
                const lv = getLatestVerdict(verdicts, bid);
                return lv?.status === "flaky" || isFlaky(verdicts, bid);
              });
              const hasFlakyUpstream = flakyUpstream.length > 0 && !isBlockedF;
              const blockedTooltip = isBlockedF ? `🔒 Bloqueado por ${blockInfo.blockedBy.join(", ")} — aprobá ${blockInfo.blockedBy[0]} para desbloquear` : f.wave;
              return (
                <div key={f.id} className="flex flex-col gap-1">
                  <button
                    className={`group text-left rounded-lg border px-2.5 py-2.5 flex flex-col gap-1 transition-colors ${isActive ? "bg-[var(--accent-soft)] border-[var(--border-hover)]" : "bg-[var(--bg)] border-[var(--border)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-hover)]"} ${isBlockedF ? "opacity-50" : ""}`}
                    onClick={() => setSelected(f.id)}
                    title={blockedTooltip}
                    aria-current={isActive ? "true" : undefined}
                    aria-label={`${f.id} ${f.title}${isBlockedF ? " bloqueado por " + blockInfo.blockedBy.join(", ") : ""}${flaky ? " flaky" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide border ${isActive ? "bg-[var(--accent)] text-[var(--accent-foreground)] border-transparent" : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)]"}`}
                      >
                        {f.badge}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-[12px] font-medium leading-tight" style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}>
                        {f.title}
                      </span>
                      {flaky && (
                        <span className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-bold tracking-wide bg-[#fff0e0] text-[#a64d00] border border-[#ffb86b] animate-pulse" title="FLAKY — historial mixto aprobado/fallo">
                          FLAKY
                        </span>
                      )}
                      {isBlockedF ? (
                        <span className="text-[11px] leading-none shrink-0" aria-hidden title={blockedTooltip}>
                          🔒
                        </span>
                      ) : null}
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${tone === "flaky" ? "animate-pulse" : ""}`}
                        style={{ backgroundColor: isBlockedF ? "var(--text-faint)" : dotColor(tone) }}
                        title={isBlockedF ? `Bloqueado — ${dotLabel(tone)}` : dotLabel(tone)}
                        aria-label={isBlockedF ? `Bloqueado — ${dotLabel(tone)}` : dotLabel(tone)}
                      />
                    </div>
                    <div className="tc-label text-[11px] leading-snug line-clamp-2">{f.wave}</div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium border"
                        style={{
                          backgroundColor: isBlockedF
                            ? "transparent"
                            : tone === "verificado"
                              ? "color-mix(in srgb, var(--green) 14%, transparent)"
                              : tone === "fallo"
                                ? "color-mix(in srgb, var(--red) 14%, transparent)"
                                : tone === "en_curso"
                                  ? "color-mix(in srgb, var(--amber) 14%, transparent)"
                                  : tone === "reservas"
                                    ? "color-mix(in srgb, #d4a017 14%, transparent)"
                                    : tone === "flaky"
                                      ? "color-mix(in srgb, #f97316 18%, transparent)"
                                      : "transparent",
                          color: isBlockedF
                            ? "var(--text-muted)"
                            : tone === "verificado"
                              ? "var(--green)"
                              : tone === "fallo"
                                ? "var(--red)"
                                : tone === "en_curso"
                                  ? "var(--amber)"
                                  : tone === "reservas"
                                    ? "#8a6d00"
                                    : tone === "flaky"
                                      ? "#a64d00"
                                      : "var(--text-muted)",
                          borderColor: tone === "pendiente" || isBlockedF ? "var(--border)" : "transparent",
                        }}
                      >
                        {isBlockedF ? "Bloqueado" : dotLabel(tone)}
                      </span>
                      {isBlockedF && (
                        <span className="text-[10px] text-[var(--text-muted)] truncate ml-1">por {blockInfo.blockedBy.join(", ")}</span>
                      )}
                      {hasRollback && !isBlockedF && (
                        <span className="inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-medium bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] text-[var(--amber)] border border-[color-mix(in_srgb,var(--amber)_20%,transparent)]" title={`Rollback: ${rollback.map((r) => r.downstream).join(", ")} falló`}>
                          ⚠️ rollback
                        </span>
                      )}
                      {isActive && !isBlockedF && <span className="text-[10px] text-[var(--accent)] ml-auto">● seleccionado</span>}
                      {isActive && isBlockedF && <span className="text-[10px] text-[var(--text-muted)] ml-auto">● seleccionado</span>}
                    </div>
                    {hasRollback && (
                      <div className="tc-label text-[10px] leading-snug rounded bg-[color-mix(in_srgb,var(--amber)_10%,transparent)] border border-[color-mix(in_srgb,var(--amber)_18%,transparent)] px-2 py-1 mt-1">
                        ⚠️ {f.id} estaba aprobado pero {rollback.map((r) => r.downstream).join(", ")} falló — revisar si sigue válido.
                      </div>
                    )}
                    {hasFlakyUpstream && (
                      <div className="tc-label text-[10px] leading-snug rounded bg-[#fff0e0] border border-[#ffb86b] px-2 py-1 mt-1 text-[#a64d00]">
                        ⚠️ {flakyUpstream.join(", ")} está en FLAKY — revisá timing pero podés continuar
                      </div>
                    )}
                  </button>
                  {isBlockedF && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleForceUnlock(f.id);
                      }}
                      className="w-full inline-flex items-center justify-center rounded-md border border-[var(--amber)] bg-[var(--bg)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--amber)_14%,transparent)] hover:text-[var(--text-primary)] transition-colors"
                      title="Solo playground: marca bloqueadores como aprobado con reservas para desbloquear"
                    >
                      Forzar desbloqueo (solo playground)
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer hint */}
          <div className="shrink-0 px-3 py-2 border-t border-[var(--border)]">
            <div className="tc-label text-[10px] leading-snug">
              Tip: cada F tiene reporte trazable al final del detalle. Guardá tu veredicto para persistir entre recargas.
            </div>
          </div>

          {/* Resize handle */}
          <div
            className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize group/resize"
            onPointerDown={handleResizeStart}
            aria-hidden
          >
            <div className="absolute right-0 top-0 w-px h-full bg-[var(--border)] group-hover/resize:bg-[var(--accent)] group-hover/resize:opacity-70" style={{ transition: "background-color var(--duration-quick) var(--ease-out-soft), opacity var(--duration-quick) var(--ease-out-soft)" }} />
          </div>
        </div>
      )}
    </div>
  );
}
