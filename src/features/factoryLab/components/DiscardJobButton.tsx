/**
 * DiscardJobButton — NO RETOMAR TRABAJO (flujo simple, sin reintentos).
 *
 * Botón compartido para jobs parados: cancela el job y limpia todo lo que
 * hizo (POST /factory/jobs/:id/discard → Cancelled + revierte archivos del
 * worktree + borra artefactos). Acción destructiva: doble clic para
 * confirmar (el primero arma, el segundo ejecuta; se desarma solo).
 * Nunca lanza: los errores viajan al mensaje inline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { postFactoryJobDiscard } from "@/lib/factoryClient";

const DISARM_MS = 8000;

export function DiscardJobButton({
  jobId,
  port,
  onDone,
  className,
}: {
  jobId: string | null;
  port: number | null;
  onDone?: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const disarmTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
    };
  }, []);

  const disarm = useCallback(() => {
    setArmed(false);
    if (disarmTimer.current !== null) {
      window.clearTimeout(disarmTimer.current);
      disarmTimer.current = null;
    }
  }, []);

  const handleClick = useCallback(async () => {
    if (!jobId || busy) return;
    if (!armed) {
      setArmed(true);
      setMsg(null);
      setErr(null);
      if (disarmTimer.current !== null) window.clearTimeout(disarmTimer.current);
      disarmTimer.current = window.setTimeout(() => setArmed(false), DISARM_MS);
      return;
    }
    disarm();
    if (port === null) {
      setErr("daemon no disponible");
      return;
    }
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await postFactoryJobDiscard(jobId, { port, timeoutMs: 30000 });
      if (!res.ok) {
        setErr(res.error.slice(0, 200));
        return;
      }
      const cleaned = (res.data.cleaned ?? {}) as {
        deleted?: unknown;
        restored?: unknown;
        skipped?: unknown;
        artifactsRemoved?: unknown;
      };
      const nDel = Array.isArray(cleaned.deleted) ? cleaned.deleted.length : 0;
      const nRes = Array.isArray(cleaned.restored) ? cleaned.restored.length : 0;
      const nArt = Array.isArray(cleaned.artifactsRemoved) ? cleaned.artifactsRemoved.length : 0;
      const nPr = Array.isArray((cleaned as { prClosed?: unknown }).prClosed)
        ? ((cleaned as { prClosed: unknown[] }).prClosed.length)
        : 0;
      const nBr = Array.isArray((cleaned as { branchDeleted?: unknown }).branchDeleted)
        ? ((cleaned as { branchDeleted: unknown[] }).branchDeleted.length)
        : 0;
      setMsg(
        `Descartado: job eliminado (PR ${nPr}, ramas ${nBr}, borrados ${nDel}, revertidos ${nRes}, artefactos ${nArt})`,
      );
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160));
    } finally {
      setBusy(false);
    }
  }, [jobId, port, armed, busy, disarm, onDone]);

  if (!jobId) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        disabled={busy || port === null}
        onClick={() => void handleClick()}
        className={
          armed
            ? "rounded bg-red-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            : "rounded border border-red-300 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        }
        title={
          armed
            ? "Confirmar: cierra el PR, borra rama/worktree/job y limpia todo lo que hizo"
            : "NO RETOMAR TRABAJO: elimina el job parado y todo lo que hizo — cierra el PR, borra la rama, el worktree y sus archivos (clic de nuevo para confirmar)"
        }
      >
        {busy ? "descartando…" : armed ? "Confirmar: cancela y borra todo" : "No retomar trabajo"}
      </button>
      {msg ? <span className="text-[11px] text-green-700">{msg}</span> : null}
      {err ? <span className="text-[11px] text-red-700">{err}</span> : null}
    </span>
  );
}

export default DiscardJobButton;
