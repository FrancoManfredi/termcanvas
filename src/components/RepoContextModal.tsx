import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useRepoContextStore } from "../stores/repoContextStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useT } from "../i18n/useT";

const MONO_STYLE = { fontFamily: '"Geist Mono", monospace' } as const;

const REPO_CONTEXT_FILE = ".agents/repo-context.md";

export function RepoContextModal() {
  const t = useT() as Record<string, unknown>;
  const { open, content, loading, closeModal, setContent, save } =
    useRepoContextStore();
  useBodyScrollLock(open);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    const ok = await save();
    setSaving(false);
    if (ok) {
      useNotificationStore
        .getState()
        .notify("info", (t.repo_context_saved as string) ?? "Repository context saved.");
      closeModal();
    }
  };

  const label = (key: string, fallback: string) =>
    (t[key] as string | undefined) ?? fallback;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh]"
      style={{ backgroundColor: "var(--scrim)" }}
      onClick={(e) => {
        if (e.target === backdropRef.current) closeModal();
      }}
    >
      <div
        className="tc-enter-fade-up flex w-full max-w-2xl mx-4 flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{
          backgroundColor: "var(--bg)",
          borderColor: "var(--border)",
        }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="tc-display text-[13px]">
            {label("repo_context_title", "Repository context")}
          </h2>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] transition-colors duration-quick"
            onClick={closeModal}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div
          className="px-4 py-2 text-[11px] leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          {label("repo_context_hint", "Free-form Markdown injected into every planning session.")}
        </div>

        <div className="flex flex-1 flex-col px-4 pb-2 min-h-[260px]">
          {loading ? (
            <div
              className="flex flex-1 items-center justify-center text-[12px]"
              style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            >
              Loading…
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                label(
                  "repo_context_placeholder",
                  "# Repository context\n\nWhat is this project about?",
                )
              }
              spellCheck={false}
              className="w-full flex-1 resize-none rounded-md border bg-[var(--surface)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
              style={{
                ...MONO_STYLE,
                minHeight: "220px",
                borderColor: "var(--border)",
              }}
            />
          )}
        </div>

        <div
          className="flex items-center justify-between border-t px-4 py-2.5"
          style={{ borderColor: "var(--border)" }}
        >
          <span
            className="truncate text-[10.5px]"
            style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            title={REPO_CONTEXT_FILE}
          >
            {label("repo_context_path_label", "Saved to")} {REPO_CONTEXT_FILE}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={closeModal}
              className="inline-flex items-center rounded-md border px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-all duration-quick hover:bg-[var(--surface-hover)]"
              style={{ borderColor: "var(--border)" }}
            >
              {label("repo_context_cancel", "Cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-foreground)] transition-all duration-quick hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : label("repo_context_save", "Save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
