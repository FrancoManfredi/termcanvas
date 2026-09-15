import { useCallback, useId, useMemo, useState } from "react";
import type { CatalogResult, ModelCatalog } from "../../../../shared/modelCatalog";

/**
 * ModelPicker — campo de modelo del agente: input libre (`provider/model`) +
 * catálogo real de opencode vía `window.termcanvas.models.listAvailable`.
 * Vacío = sin pin (opencode usa su default). Sin bridge/catálogo el input
 * libre sigue funcionando (estado honesto, sin inventar opciones).
 */

interface ModelOption {
  value: string;
  model: string;
  provider: string;
}

const RESULT_CAP = 50;

function asCatalogResult(raw: unknown): ModelCatalog | null {
  try {
    if (raw && typeof raw === "object" && (raw as CatalogResult<ModelCatalog>).ok === true) {
      const data = (raw as { ok: true; data: ModelCatalog }).data;
      return data && typeof data === "object" ? data : null;
    }
    const direct = raw as ModelCatalog;
    return direct && Array.isArray(direct.providers) ? direct : null;
  } catch {
    return null;
  }
}

export function ModelPicker({
  value,
  onChange,
  disabled = false,
  showLabel = true,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const inputId = useId();

  const load = useCallback(async (): Promise<void> => {
    setState("loading");
    try {
      const api = (
        window as unknown as {
          termcanvas?: {
            models?: {
              listAvailable?: (force?: boolean, cli?: string) => Promise<unknown>;
            };
          };
        }
      ).termcanvas?.models;
      if (!api?.listAvailable) {
        setState("unavailable");
        return;
      }
      const raw = await api.listAvailable(true, "opencode");
      const catalog = asCatalogResult(raw);
      if (!catalog) {
        setState("unavailable");
        return;
      }
      const flat: ModelOption[] = [];
      for (const provider of catalog.providers) {
        // Los agentes corren con opencode (go) por doctrina del factory:
        // solo esos dos providers entran al catálogo por ahora.
        if (provider.id !== "opencode-go" && provider.id !== "opencode") continue;
        for (const model of provider.models ?? []) {
          flat.push({
            value: `${model.providerID ?? provider.id}/${model.modelID}`,
            model: model.name || model.modelID,
            provider: provider.connected ? `${provider.name} · connected` : provider.name,
          });
        }
      }
      setOptions(flat);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter(
          (option) =>
            option.value.toLowerCase().includes(q) ||
            option.model.toLowerCase().includes(q) ||
            option.provider.toLowerCase().includes(q),
        )
      : options;
    return matches.slice(0, RESULT_CAP);
  }, [options, query]);

  const toggleCatalog = () => {
    const next = !open;
    setOpen(next);
    if (next && state === "idle") void load();
  };

  return (
    <div className="ag-field">
      {showLabel ? (
        <label className="ag-label" htmlFor={inputId}>
          Model
        </label>
      ) : null}
      <div className="ag-model-row">
        <input
          id={inputId}
          className="ag-input"
          type="text"
          value={value}
          disabled={disabled}
          aria-label={showLabel ? undefined : "Model"}
          placeholder="provider/model (empty = opencode default)"
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className="ag-btn ag-btn--sm"
          onClick={toggleCatalog}
          disabled={disabled}
          aria-expanded={open}
        >
          {open ? "Close" : "Catalog"}
        </button>
      </div>
      <p className="ag-hint">
        A value without <code>provider/model</code> shape is kept in the file but
        opencode ignores it, so the default model applies.
      </p>
      {open ? (
        <div className="ag-model-pop">
          <input
            className="ag-input ag-model-search"
            type="search"
            value={query}
            placeholder="Search models..."
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          {state === "loading" ? (
            <div className="ag-empty-body" style={{ padding: 12 }}>
              Loading catalog...
            </div>
          ) : state === "unavailable" ? (
            <div className="ag-empty-body" style={{ padding: 12 }}>
              Model catalog unavailable. Type the model manually.
            </div>
          ) : filtered.length === 0 ? (
            <div className="ag-empty-body" style={{ padding: 12 }}>
              No models match that search.
            </div>
          ) : (
            <div className="ag-model-list">
              {filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="ag-model-item"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="ag-model-item-name">{option.model}</span>
                  <span className="ag-model-item-provider">
                    {option.provider} · {option.value}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
