// Combobox buscable para "Models per phase": los catálogos reales de
// opencode traen 1000+ pares provider/model — un <select> nativo con miles
// de opciones es inusable. Este componente muestra un trigger, un panel con
// búsqueda tokenizada y una lista CAPADA (~40 resultados) ordenada
// conectados-primero, con teclado básico (↑↓ Enter Escape) y click-fuera.
//
// Es tonto a propósito: recibe grupos ya construidos y devuelve el value
// canónico ("provider/model" o "" = default); la traducción a ModelRef vive
// en phaseModelOptions.refFromOptionValue.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterModelOptions,
  flattenModelOptions,
  type FlatModelOption,
} from "./phaseModelOptions";
import type { PhaseModelGroup } from "./phaseModelOptions";
import { useT } from "../../i18n/useT";

const RESULT_CAP = 40;

interface ModelComboboxProps {
  /** Value canónico actual ("provider/model") o "" = sin override. */
  value: string;
  groups: PhaseModelGroup[];
  onChange: (value: string) => void;
  defaultLabel: string;
}

export function ModelCombobox({
  value,
  groups,
  onChange,
  defaultLabel,
}: ModelComboboxProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const flat = useMemo(() => flattenModelOptions(groups), [groups]);
  const filtered = useMemo(
    () => filterModelOptions(flat, query, RESULT_CAP),
    [flat, query],
  );
  // Fila 0 = "Default"; filas 1..n = resultados filtrados.
  const rowCount = filtered.items.length + 1;

  useEffect(() => {
    if (!open) return;
    setActive(0);
    // Autofocus del input al abrir (el render aún no lo montó).
    requestAnimationFrame(() => inputRef.current?.focus());
    const onDocMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-row="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  // El índice activo salta opciones deshabilitadas (proveedores sin auth).
  const selectable = useMemo(
    () => [true, ...filtered.items.map((o) => o.connected)],
    [filtered],
  );

  function move(delta: number): void {
    setActive((current) => {
      let next = current;
      for (let step = 0; step < rowCount; step++) {
        next = (next + delta + rowCount) % rowCount;
        if (selectable[next]) return next;
      }
      return current;
    });
  }

  function commit(index: number): void {
    if (index === 0) {
      onChange("");
    } else {
      const option: FlatModelOption | undefined = filtered.items[index - 1];
      if (!option || !option.connected) return;
      onChange(option.value);
    }
    setOpen(false);
    setQuery("");
  }

  function selectedDisplay(): string {
    if (!value) return defaultLabel;
    const found = flat.find((option) => option.value === value);
    return found ? `${found.providerLabel} · ${found.label}` : value;
  }

  return (
    <div className="relative min-w-0 flex-1" ref={rootRef}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-[7px] border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--accent)]"
        onClick={() => setOpen((o) => !o)}
        title={selectedDisplay()}
      >
        <span className={`truncate ${value ? "" : "text-[var(--text-muted)]"}`}>
          {selectedDisplay()}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className="shrink-0 opacity-60"
        >
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-[7px] border border-[var(--border)] bg-[var(--bg)] shadow-lg">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- popover efímero */}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                commit(active);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder={
              filtered.total > 0
                ? `${filtered.total} ${t.phase_model_models_suffix}`
                : t.phase_model_search_placeholder
            }
            className="w-full border-b border-[var(--border)] bg-transparent px-3 py-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <div ref={listRef} className="max-h-72 overflow-auto py-1">
            {[0, ...filtered.items.map((_, i) => i + 1)].map((rowIndex) => {
              const isDefaultRow = rowIndex === 0;
              const option = isDefaultRow ? undefined : filtered.items[rowIndex - 1];
              const disabled = !isDefaultRow && !option!.connected;
              const isActive = rowIndex === active;
              return (
                <button
                  key={isDefaultRow ? "__default__" : option!.value}
                  type="button"
                  data-row={rowIndex}
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(rowIndex)}
                  onMouseEnter={() => !disabled && setActive(rowIndex)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs ${
                    disabled
                      ? "cursor-not-allowed text-[var(--text-muted)] opacity-50"
                      : "text-[var(--text-primary)]"
                  } ${isActive && !disabled ? "bg-[var(--accent-soft)]" : ""}`}
                >
                  <span className="truncate">
                    {isDefaultRow ? `— ${defaultLabel} —` : option!.label}
                  </span>
                  {!isDefaultRow && (
                    <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
                      {option!.providerLabel}
                      {option!.connected ? "" : ` (${t.phase_model_no_auth})`}
                    </span>
                  )}
                </button>
              );
            })}
            {filtered.total > filtered.items.length && (
              <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
                {t.phase_model_more(filtered.total - filtered.items.length)}
              </div>
            )}
            {filtered.total === 0 && (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                {t.phase_model_no_results}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
