// Registración IPC del catálogo de modelos — separada del módulo puro para
// que los tests corran en node sin importar "electron".
//
// WIRING PENDIENTE: main.ts todavía no llama registerModelCatalogIpc() — se
// conecta junto con la UI de Settings (WU6) para minimizar la ventana de
// edición concurrente sobre main.ts con el trabajo paralelo en curso.
// Canales:
//   models:list-available      → catálogo normalizado (cache TTL 5 min; force=true refresca)
//   models:validate-phase      → valida UNA fase (con overrides opcionales)
//   models:invalidate          → invalida el cache (botón refresh de Settings)
//   models:set-phase-overrides → inyecta los overrides resueltos en preferences
//                                al motor de entrevista (setPhaseModelOverrides)

import { ipcMain } from "electron";
import {
  fetchModelCatalog,
  invalidateModelCatalog,
  validatePhaseAgainstCatalog,
  type CatalogResult,
  type ModelCatalog,
  type PhaseValidation,
} from "./model-catalog.ts";
import { setPhaseCliOverrides, setPhaseModelOverrides } from "../headless-runtime/interview/engine.ts";
import { PHASE_CLIS, isModelRef, isPhaseId, sanitizePhaseClis, sanitizePhaseModels, type ModelRef, type PhaseId } from "../shared/phaseModels";
import type { CliCatalogSource } from "../shared/modelCatalog";

function sanitizeCliParam(cli: unknown): CliCatalogSource {
  if (typeof cli === "string" && (PHASE_CLIS as readonly string[]).includes(cli)) {
    return cli as CliCatalogSource;
  }
  return "opencode";
}

export function registerModelCatalogIpc(): void {
  ipcMain.handle(
    "models:list-available",
    async (_event, force?: boolean, cli?: string): Promise<CatalogResult<ModelCatalog>> => {
      try {
        const source = sanitizeCliParam(cli);
        return { ok: true, data: await fetchModelCatalog(force === true, source) };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "models:validate-phase",
    async (
      _event,
      phaseId: PhaseId,
      overrides?: Partial<Record<PhaseId, ModelRef>> | null,
      cli?: string,
    ): Promise<CatalogResult<PhaseValidation>> => {
      try {
        if (!isPhaseId(phaseId)) {
          return { ok: false, error: `PhaseId desconocido: ${String(phaseId)}` };
        }
        const safeOverrides: Partial<Record<PhaseId, ModelRef>> = {};
        if (overrides && typeof overrides === "object") {
          for (const [key, value] of Object.entries(overrides)) {
            if (isPhaseId(key) && isModelRef(value)) safeOverrides[key] = value;
          }
        }
        const source = sanitizeCliParam(cli);
        const catalog = await fetchModelCatalog(false, source);
        return {
          ok: true,
          data: validatePhaseAgainstCatalog(phaseId, catalog, safeOverrides),
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle("models:invalidate", (_event, cli?: string): CatalogResult<{ invalidated: true }> => {
    const source = typeof cli === "string" && (PHASE_CLIS as readonly string[]).includes(cli) ? (cli as CliCatalogSource) : undefined;
    invalidateModelCatalog(source);
    return { ok: true, data: { invalidated: true } };
  });

  ipcMain.handle(
    "models:set-phase-overrides",
    (_event, overrides: unknown): CatalogResult<{ applied: number }> => {
      const safe = sanitizePhaseModels(overrides);
      setPhaseModelOverrides(safe);
      return { ok: true, data: { applied: Object.keys(safe).length } };
    },
  );

  ipcMain.handle(
    "models:set-phase-clis",
    (_event, overrides: unknown): CatalogResult<{ applied: number }> => {
      const safe = sanitizePhaseClis(overrides);
      setPhaseCliOverrides(safe);
      return { ok: true, data: { applied: Object.keys(safe).length } };
    },
  );
}
