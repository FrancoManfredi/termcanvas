import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import {
  useIssueReviewStore,
  type MergePrStatus,
} from "../stores/issueReviewStore";

const STATUS_LABELS: Record<MergePrStatus, string> = {
  pending: "Pendiente",
  working: "Procesando",
  merged: "Mergeado",
  conflicted: "Conflicto",
  error: "Error",
};

const STATUS_COLORS: Record<MergePrStatus, string> = {
  pending: "var(--text-faint)",
  working: "var(--accent)",
  merged: "var(--green)",
  conflicted: "var(--red)",
  error: "var(--red)",
};

// Live log of the bulk merge run (github:merge-approved-prs). Mounted as a
// modal overlay while a run is in progress; the log stays readable after the
// run finishes so the user can review what happened before closing it.
export function MergeProgressPanel() {
  const mergeProgress = useIssueReviewStore((s) => s.mergeProgress);
  const dismissMergeProgress = useIssueReviewStore(
    (s) => s.dismissMergeProgress,
  );
  const logRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(mergeProgress !== null);

  // Keep the newest line visible while the merge streams steps.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mergeProgress?.log.length]);

  useEffect(() => {
    if (!mergeProgress) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mergeProgress.finished) {
        dismissMergeProgress();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mergeProgress, dismissMergeProgress]);

  if (!mergeProgress) return null;

  const statusText = mergeProgress.error
    ? "Con error"
    : mergeProgress.finished
      ? "Terminado"
      : "En curso";
  const statusColor = mergeProgress.error
    ? "var(--red)"
    : mergeProgress.finished
      ? "var(--green)"
      : "var(--accent)";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Merge de PRs aprobados"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--scrim)] tc-enter-fade-up"
    >
      <div
        className="w-[480px] max-w-[90vw] rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 pt-3 pb-3 border-b border-[var(--border)]">
          <div className="flex items-baseline gap-2">
            <span
              className="tc-display"
              style={{
                fontSize: "15px",
                letterSpacing: "var(--tracking-title)",
              }}
            >
              Mergeando PRs aprobados
            </span>
            <span className="tc-eyebrow" style={{ color: statusColor }}>
              {statusText}
            </span>
          </div>
        </header>

        <ul className="px-3 py-2 border-b border-[var(--border)]">
          {mergeProgress.prNumbers.map((prNumber) => {
            const status = mergeProgress.statusByPr[prNumber] ?? "pending";
            return (
              <li
                key={prNumber}
                className="flex items-center gap-2 rounded-md px-1 py-1"
              >
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: STATUS_COLORS[status] }}
                  aria-hidden
                />
                <span className="tc-ui flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                  PR #{prNumber}
                </span>
                <span
                  className="tc-meta"
                  style={{ color: STATUS_COLORS[status] }}
                >
                  {STATUS_LABELS[status]}
                </span>
              </li>
            );
          })}
        </ul>

        <div
          ref={logRef}
          className="max-h-[220px] overflow-y-auto px-4 py-2 font-mono text-xs leading-5"
          style={{ color: "var(--text-secondary)" }}
        >
          {mergeProgress.log.map((line, index) => (
            <div key={index} className="flex gap-2">
              <span className="shrink-0" style={{ color: "var(--text-faint)" }}>
                {line.prNumber !== null ? `#${line.prNumber}` : "—"}
              </span>
              <span>{line.message}</span>
            </div>
          ))}
        </div>

        <footer className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)]">
          <span className="tc-timestamp" style={{ color: "var(--text-faint)" }}>
            {mergeProgress.finished ? "Presioná ESC para cerrar" : "Procesando..."}
          </span>
          <button
            type="button"
            disabled={!mergeProgress.finished}
            onClick={dismissMergeProgress}
            className="tc-ui rounded-md px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-30"
            style={{
              color: "var(--text-primary)",
              background: "var(--surface-hover)",
            }}
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
