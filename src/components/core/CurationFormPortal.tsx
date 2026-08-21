// Portal del formulario genérico de curaduría (RF / ASR / restricción / término).
//
// Extraído VERBATIM del overlay final de CoreArchitectureModal. Cada sección
// de curaduría instancia useCurationForm y renderiza este portal; solo la
// sección montada tiene formulario activo, así que el comportamiento es
// idéntico al del estado único del monolito.

import { createPortal } from "react-dom";
import { CURATION_FIELDS, CURATION_ADD_LABEL, CloseXIcon } from "./shared";
import type { CurFormState } from "./forms";

export interface CurationFormPortalProps {
  curForm: CurFormState;
  setCurForm: (updater: (f: CurFormState) => CurFormState) => void;
  setValue: (key: string, value: unknown) => void;
  submit: () => void;
  close: () => void;
}

export function CurationFormPortal({ curForm, setCurForm, setValue, submit, close }: CurationFormPortalProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-[var(--scrim)] p-4"
      onClick={() => {
        if (!curForm.busy) close();
      }}
    >
      <div
        className="w-[520px] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xs font-semibold text-[var(--text-primary)]">
              {curForm.mode === "add"
                ? CURATION_ADD_LABEL[curForm.kind]
                : `Editar ${curForm.id}`}
            </h3>
            {curForm.mode === "edit" && (
              <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">id y origen se preservan</p>
            )}
          </div>
          <button
            type="button"
            disabled={curForm.busy}
            onClick={close}
            className="shrink-0 p-0.5 rounded text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
            aria-label="Cerrar"
          >
            <CloseXIcon />
          </button>
        </div>

        {curForm.error && (
          <div className="p-2.5 rounded-md bg-[var(--red-soft)] border border-red-500/30 text-[11px] text-[var(--text-primary)]">
            {curForm.error}
          </div>
        )}

        <div className="space-y-2">
          {CURATION_FIELDS[curForm.kind].map((field) => {
            const value = curForm.values[field.key] ?? (field.type === "checkbox" ? false : "");
            const label = (
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                {field.label} {field.required && <span className="text-[var(--red)]">*</span>}
              </span>
            );
            if (field.type === "select") {
              return (
                <label key={field.key} className="block space-y-0.5">
                  {label}
                  <select
                    className="textarea-minimal text-xs py-1.5 w-full"
                    value={String(value)}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    disabled={curForm.busy}
                  >
                    {(field.options ?? []).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              );
            }
            if (field.type === "checkbox") {
              return (
                <label key={field.key} className="flex items-center gap-2 text-[11px] text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={value === true}
                    onChange={(e) => setValue(field.key, e.target.checked)}
                    disabled={curForm.busy}
                  />
                  {field.label}
                </label>
              );
            }
            if (field.type === "textarea") {
              return (
                <label key={field.key} className="block space-y-0.5">
                  {label}
                  <textarea
                    rows={field.rows ?? 2}
                    className="textarea-minimal text-xs py-1.5 w-full"
                    placeholder={field.placeholder}
                    value={String(value)}
                    onChange={(e) => setValue(field.key, e.target.value)}
                    disabled={curForm.busy}
                  />
                </label>
              );
            }
            return (
              <label key={field.key} className="block space-y-0.5">
                {label}
                <input
                  type="text"
                  className="textarea-minimal text-xs py-1.5 w-full"
                  placeholder={field.placeholder}
                  value={String(value)}
                  onChange={(e) => setValue(field.key, e.target.value)}
                  disabled={curForm.busy}
                />
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="btn btn-ghost text-xs py-1 min-h-[32px]"
            onClick={close}
            disabled={curForm.busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs py-1 min-h-[32px] font-semibold"
            onClick={() => void submit()}
            disabled={curForm.busy}
          >
            {curForm.busy ? "Guardando…" : curForm.mode === "add" ? "Añadir" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
