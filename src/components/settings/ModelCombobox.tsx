// Combobox buscable para "Models per phase": los catálogos reales de
// opencode traen 1000+ pares provider/model — un <select> nativo con miles
// de opciones es inusable. Este componente muestra un trigger, un panel con
// búsqueda tokenizada y una lista CAPADA (~40 resultados) ordenada
// conectados-primero, con teclado básico (↑↓ Enter Escape) y click-fuera.
//
// Es tonto a propósito: recibe grupos ya construidos y devuelve el value
// canónico ("provider/model" o "" = default); la traducción a ModelRef vive
// en phaseModelOptions.refFromOptionValue.
//
// H-007 (lab E2E): el trigger mostraba label y provider en spans adyacentes
// separados solo por margen CSS (`ml-1.5`) — el nombre accesible concatenaba
// ambos sin separador textual (`muse-spark-1.2-contributoropencode-go`).
// Formato elegido `modelo (provider)`: el modelo sigue prominente
// (font-medium, como antes) y los paréntesis son separador textual visible
// para lectores de pantalla y snapshots sin cambiar el layout.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const flat = useMemo(() => flattenModelOptions(groups), [groups]);
  const filtered = useMemo(
    () => filterModelOptions(flat, query, RESULT_CAP),
    [flat, query],
  );
  // Fila 0 = "Default"; filas 1..n = resultados filtrados.
  const rowCount = filtered.items.length + 1;

  const updateCoords = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const GAP = 6;
    const ESTIMATED_H = 320;
    let top = rect.bottom + GAP;
    // Flip above if it would overflow viewport bottom
    if (typeof window !== "undefined" && top + ESTIMATED_H > window.innerHeight && rect.top - ESTIMATED_H - GAP > 8) {
      top = rect.top - ESTIMATED_H - GAP;
    }
    // Clamp left if near right edge
    let left = rect.left;
    const width = rect.width;
    if (typeof window !== "undefined" && left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setCoords({ top, left, width });
  };

  useEffect(() => {
    if (!open) return;
    setActive(0);
    updateCoords();
    // Autofocus del input al abrir (el render aún no lo montó).
    requestAnimationFrame(() => inputRef.current?.focus());
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideRoot = rootRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideRoot && !insideDropdown) {
        setOpen(false);
      }
    };
    const onReposition = () => updateCoords();
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  // Keep coords in sync while open if root rect changes (e.g. modal scroll)
  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
  }, [open, filtered.total]);

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

  function selectedDisplay(): { label: string; provider?: string; isDefault: boolean } {
    if (!value) return { label: defaultLabel, isDefault: true };
    const found = flat.find((option) => option.value === value);
    if (found) return { label: found.label, provider: found.providerLabel, isDefault: false };
    return { label: value, isDefault: false };
  }

  const sel = selectedDisplay();
  const isDefault = !value;

  return (
    <div className="relative min-w-0 flex-1" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-[10px] border bg-[var(--bg)] px-3 py-2 text-[12px] font-medium leading-none outline-none will-change-transform focus-visible:border-[var(--accent)] focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] ${open ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]" : "border-[var(--border)] hover:border-[var(--border-hover)] hover:bg-[var(--surface)]"} ${isDefault ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"} active:scale-[0.96]`}
        style={{
          minHeight: 36,
          transitionProperty: "transform, background-color, border-color, box-shadow, color",
          transitionDuration: "150ms",
          transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
        }}
        onClick={() => setOpen((o) => !o)}
        title={isDefault ? defaultLabel : `${sel.provider ?? ""} · ${sel.label}`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {/* status dot */}
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${isDefault ? "bg-[var(--text-faint)]" : "bg-[var(--green)]"}`}
            aria-hidden
          />
          <span className="truncate">
            {isDefault ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="opacity-80">{defaultLabel}</span>
                <span className="hidden sm:inline text-[11px] font-normal text-[var(--text-faint)]">— global default</span>
              </span>
            ) : (
              <>
                <span className="font-medium">{sel.label}</span>
                {sel.provider && (
                  <span className="ml-1.5 text-[11px] font-normal text-[var(--text-muted)]">({sel.provider})</span>
                )}
              </>
            )}
          </span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-[var(--text-muted)]"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms cubic-bezier(0.2, 0, 0, 1)",
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[300] overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--bg)]"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            boxShadow: "0 4px 16px oklch(0 0 0 / 0.10), 0 1px 3px oklch(0 0 0 / 0.08)",
            animation: "combobox-in 140ms cubic-bezier(0.2, 0, 0, 1) both",
          }}
        >
          {/* Search input */}
          <div className="relative border-b border-[var(--border)]">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M16.5 16.5L21 21" />
            </svg>
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
              className="w-full bg-transparent py-2.5 pl-9 pr-9 text-[12px] leading-none text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)] active:scale-[0.96] transition-[transform,background-color,color] duration-150"
                style={{ transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setActive(0);
                  inputRef.current?.focus();
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
          </div>

          <div ref={listRef} className="max-h-72 overflow-auto p-1">
            {[0, ...filtered.items.map((_, i) => i + 1)].map((rowIndex) => {
              const isDefaultRow = rowIndex === 0;
              const option = isDefaultRow ? undefined : filtered.items[rowIndex - 1];
              const disabled = !isDefaultRow && !option!.connected;
              const isActive = rowIndex === active;
              const isSelected = isDefaultRow ? isDefault : option!.value === value;
              return (
                <button
                  key={isDefaultRow ? "__default__" : option!.value}
                  type="button"
                  data-row={rowIndex}
                  disabled={disabled}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(rowIndex)}
                  onMouseEnter={() => !disabled && setActive(rowIndex)}
                  className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[12px] leading-none will-change-transform ${
                    disabled
                      ? "cursor-not-allowed text-[var(--text-muted)] opacity-50"
                      : isActive
                        ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
                        : "text-[var(--text-primary)] hover:bg-[var(--surface)]"
                  }`}
                  style={{
                    transitionProperty: "background-color, color, opacity",
                    transitionDuration: "120ms",
                    transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
                  }}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${isSelected && !disabled ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]" : "border-[var(--border)] bg-transparent text-transparent"}`}>
                    {isSelected && !disabled && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12l5 5L20 7" /></svg>
                    )}
                  </span>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isDefaultRow ? "bg-[var(--text-faint)]" : disabled ? "bg-[var(--text-faint)]" : option!.connected ? "bg-[var(--green)]" : "bg-[var(--amber)]"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {isDefaultRow ? defaultLabel : option!.label}
                  </span>
                  {!isDefaultRow && (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className={`max-w-[110px] truncate text-[11px] ${disabled ? "text-[var(--text-faint)]" : "text-[var(--text-muted)]"}`}>
                        {option!.providerLabel}
                      </span>
                      {!option!.connected && (
                        <span className="inline-flex items-center rounded-full bg-[var(--amber)]/12 border border-[var(--amber)]/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--amber)]">
                          {t.phase_model_no_auth}
                        </span>
                      )}
                    </span>
                  )}
                  {isDefaultRow && (
                    <span className="shrink-0 text-[11px] text-[var(--text-faint)]">reset</span>
                  )}
                </button>
              );
            })}
            {filtered.total > filtered.items.length && (
              <div className="mx-1 mt-1 rounded-[8px] bg-[var(--surface)]/60 px-2.5 py-2 text-[11px] leading-4 text-[var(--text-muted)]">
                {t.phase_model_more(filtered.total - filtered.items.length)}
              </div>
            )}
            {filtered.total === 0 && (
              <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-faint)]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5L21 21" /></svg>
                </span>
                <p className="text-[12px] font-medium text-[var(--text-secondary)]">{t.phase_model_no_results}</p>
                <p className="max-w-[22ch] text-[11px] leading-4 text-[var(--text-muted)]">Try a different provider or model name.</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
      <style>{`@keyframes combobox-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
