// Tipos del catálogo de modelos — contrato compartido entre el proceso principal
// (electron/model-catalog.ts, que normaliza la respuesta cruda del SDK por CLI)
// y el renderer (API window.termcanvas.models + Settings).
// Multi-CLI desde Fase A: opencode + codebuddy (futuros: claude, codex, gemini).
// SOLO tipos: sin lógica ni imports de node/electron, seguro para ambos lados.

import type { ModelRef, PhaseId, PhaseCli } from "./phaseModels";

/** Fuente de catálogo = CLI disponible (PhaseCli sin null). Derivado del contrato de fase para que agregar un CLI solo toque PHASE_CLIS. */
export type CliCatalogSource = Exclude<PhaseCli, null>;

export interface CatalogModel {
  providerID: string;
  modelID: string;
  name: string;
  /** Crudo del server ("active" | "deprecated" | ...): la UI decide cómo mostrarlo. */
  status: string;
  contextWindow: number | null;
  variants: string[];
}

export interface CatalogProvider {
  id: string;
  name: string;
  /** Auth resuelta: los únicos proveedores realmente llamables. */
  connected: boolean;
  models: CatalogModel[];
}

export interface ModelCatalog {
  providers: CatalogProvider[];
  /** Modelo default por proveedor (del endpoint), para preselección en UI. */
  defaults: Record<string, string>;
  fetchedAt: number;
  /** CLI de origen — para que el renderer sepa qué catálogo está viendo. Default "opencode" por compatibilidad. */
  source: CliCatalogSource;
}

export interface PhaseValidation {
  ok: boolean;
  phaseId: PhaseId;
  /** Modelo efectivo resuelto (override > default); null = fase sin pin. */
  effective: ModelRef | null;
  /** Motivo accionable del fallo; presente solo si ok=false. */
  reason?: string;
  /** Alternativas "provider/model" conectadas, para sugerir en el error. */
  alternatives?: string[];
}

/** Envelope serializable de los handlers IPC del catálogo. */
export type CatalogResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
