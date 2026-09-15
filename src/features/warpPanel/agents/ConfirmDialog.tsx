import { useEffect, useRef, type ReactNode } from "react";

/**
 * ConfirmDialog — diálogo de confirmación scopeado del Agents console.
 * Focus en el CTA al abrir, Escape y backdrop cierran. Sin dependencias del
 * host (el panel no importa `src/components/ui`).
 */

export interface ConfirmDialogProps {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="ag-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="ag-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="ag-dialog-title">{title}</h2>
        {body ? <div className="ag-dialog-body">{body}</div> : null}
        <div className="ag-dialog-actions">
          <button type="button" className="ag-btn ag-btn--ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`ag-btn ${danger ? "ag-btn--danger" : "ag-btn--primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
