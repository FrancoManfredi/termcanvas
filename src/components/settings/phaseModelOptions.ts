// Helpers puros para el selector "Models per phase" en Settings: agrupan el
// catálogo normalizado y traducen el value del <select> de vuelta a ModelRef
// sin perder la variante cuando corresponde.

import type {
  CatalogProvider,
  ModelCatalog,
} from "../../../shared/modelCatalog";
import type { ModelRef } from "../../../shared/phaseModels";

export interface PhaseModelOption {
  /** Value canónico del select: "provider/model". */
  value: string;
  label: string;
  status: string;
}

export interface PhaseModelGroup {
  providerId: string;
  label: string;
  /** Proveedores sin auth se muestran pero deshabilitados. */
  connected: boolean;
  options: PhaseModelOption[];
}

export function buildPhaseModelGroups(
  catalog: ModelCatalog | null | undefined,
): PhaseModelGroup[] {
  if (!catalog) return [];
  return catalog.providers.map((provider: CatalogProvider) => ({
    providerId: provider.id,
    label: provider.name,
    connected: provider.connected,
    options: provider.models.map((model) => ({
      value: `${model.providerID}/${model.modelID}`,
      label: model.modelID,
      status: model.status,
    })),
  }));
}

/**
 * Traduce el value del select ("provider/model" o "" = sin override) a un
 * ModelRef. Si el usuario re-confirma el MISMO par provider/model que ya
 * está efectivo y ese par tiene variante, la variante se conserva (ej:
 * re-elegir deepseek-v4-flash no borra el "max" del default de síntesis).
 */
export function refFromOptionValue(
  value: string,
  currentEffective: ModelRef | null,
): ModelRef | null {
  if (!value) return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  const providerID = value.slice(0, slash);
  const modelID = value.slice(slash + 1);
  const ref: ModelRef = { providerID, modelID };
  if (
    currentEffective &&
    currentEffective.providerID === providerID &&
    currentEffective.modelID === modelID &&
    currentEffective.variant !== undefined
  ) {
    ref.variant = currentEffective.variant;
  }
  return ref;
}

// ─── Búsqueda para el combobox (catálogos con 1000+ pares) ───────────────

export interface FlatModelOption extends PhaseModelOption {
  providerId: string;
  providerLabel: string;
  connected: boolean;
}

/** Aplana los grupos una sola vez por catálogo (memoizado en la sección). */
export function flattenModelOptions(
  groups: PhaseModelGroup[],
): FlatModelOption[] {
  return groups.flatMap((group) =>
    group.options.map((option) => ({
      ...option,
      providerId: group.providerId,
      providerLabel: group.label,
      connected: group.connected,
    })),
  );
}

export interface FilteredModelOptions {
  /** Primeros `cap` resultados ya ordenados (conectados primero). */
  items: FlatModelOption[];
  /** Total de matches ANTES del cap — alimenta el pie "y N más". */
  total: number;
}

/**
 * Filtra por tokens AND sobre "providerLabel providerId modelID"
 * (case-insensitive). Orden estable: partición conectados-primero y dentro
 * de cada partición el orden del catálogo.
 */
export function filterModelOptions(
  flat: FlatModelOption[],
  query: string,
  cap = 40,
): FilteredModelOptions {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched =
    tokens.length === 0
      ? flat
      : flat.filter((option) => {
          const haystack = `${option.providerLabel} ${option.providerId} ${option.label}`.toLowerCase();
          return tokens.every((token) => haystack.includes(token));
        });
  const items = [
    ...matched.filter((o) => o.connected),
    ...matched.filter((o) => !o.connected),
  ].slice(0, cap);
  return { items, total: matched.length };
}
