/**
 * IssueDiscardMenu — popover de confirmación del "Descartar issue".
 *
 * Lo abre el icono de basura de la fila del Activity panel (solo en las
 * secciones habilitadas: In Progress / Awaiting You / Ready to Merge).
 * "Descartar issue" elimina TODO lo que el issue creó — jobs linkeados (con
 * su run cancelado, PR cerrado, rama/worktree/job borrados) — SIN tocar el
 * issue: al quedar sin jobs/PR la derivación lo devuelve a Pending.
 *
 * Presentacional puro: el panel dueño del estado pasa `busy`, `onDiscard` y
 * los listeners de cierre (outside click / Escape / scroll) viven allá. El
 * armado en dos pasos queda acá adentro (destructivo: primer click arma,
 * segundo confirma) y se resetea cuando cambia el target.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconTrash } from "./warpIcons";

export interface IssueDiscardTarget {
  issueNumber: number;
  title: string;
  x: number;
  y: number;
  /** Contexto capturado al abrir el popover (el issue puede cambiar de tick). */
  url?: string;
  worktreePath?: string;
}

const MENU_WIDTH = 300;
const MENU_HEIGHT = 132;

function clamp(value: number, min: number, max: number): number {
  try {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(value, max));
  } catch {
    return min;
  }
}

export function IssueDiscardMenu({
  target,
  busy,
  onDiscard,
}: {
  target: IssueDiscardTarget;
  busy: boolean;
  onDiscard: () => void;
}) {
  const [armed, setArmed] = useState(false);

  // Target nuevo ⇒ confirmación limpia (nunca se hereda el armado de otra fila).
  useEffect(() => {
    setArmed(false);
  }, [target.issueNumber, target.x, target.y]);

  if (typeof document === "undefined") return null;

  const viewportW =
    typeof window !== "undefined" && Number.isFinite(window.innerWidth)
      ? window.innerWidth
      : MENU_WIDTH + 16;
  const viewportH =
    typeof window !== "undefined" && Number.isFinite(window.innerHeight)
      ? window.innerHeight
      : MENU_HEIGHT + 16;
  const left = clamp(target.x, 8, Math.max(8, viewportW - MENU_WIDTH - 8));
  const top = clamp(target.y, 8, Math.max(8, viewportH - MENU_HEIGHT - 8));

  return createPortal(
    <div
      role="menu"
      aria-label={`Issue #${target.issueNumber} actions`}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left,
        top,
        width: MENU_WIDTH,
        zIndex: 4000,
        background: "#141414",
        border: "1px solid #2c2c2c",
        borderRadius: 8,
        boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        padding: 6,
        fontFamily: "var(--wp-font-sans)",
      }}
    >
      {/* Header: issue + título (1 línea) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px 7px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontFamily: "var(--wp-font-mono)",
            fontSize: 10,
            color: "#3e3e3e",
            flexShrink: 0,
          }}
        >
          #{target.issueNumber}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#8a8a8a",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {target.title}
        </span>
      </div>

      {/* Item destructivo (dos pasos) */}
      <button
        role="menuitem"
        disabled={busy}
        onClick={() => {
          if (busy) return;
          if (!armed) {
            setArmed(true);
            return;
          }
          onDiscard();
        }}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          textAlign: "left",
          padding: "8px 8px",
          borderRadius: 6,
          border: "none",
          cursor: busy ? "default" : "pointer",
          background: armed ? "rgba(248,81,73,0.14)" : "transparent",
          color: "#f85149",
          opacity: busy ? 0.6 : 1,
          transition: "background 100ms",
        }}
        onMouseEnter={(e) => {
          if (!busy && !armed) e.currentTarget.style.background = "#1e1e1e";
        }}
        onMouseLeave={(e) => {
          if (!armed) e.currentTarget.style.background = "transparent";
        }}
      >
        {busy ? (
          <span
            className="spin-icon"
            style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
        ) : (
          <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <IconTrash size={12} />
          </span>
        )}
        <span style={{ fontSize: 12, fontWeight: 500 }}>
          {busy
            ? "Eliminando…"
            : armed
              ? "Confirmar: borra TODO del issue"
              : "Descartar issue"}
        </span>
      </button>

      {/* Semántica explícita: cancela + borra, el issue queda en Pending */}
      <p
        style={{
          margin: "4px 8px 3px",
          fontFamily: "var(--wp-font-sans)",
          fontSize: 10,
          lineHeight: 1.45,
          color: "#5c5c5c",
        }}
      >
        {armed
          ? "Cancela el trabajo en curso y borra rama, PR, worktree y jobs. El issue no se elimina: queda en Pending."
          : "Elimina todo lo que el issue creó. El issue vuelve a Pending."}
      </p>
    </div>,
    document.body,
  );
}
