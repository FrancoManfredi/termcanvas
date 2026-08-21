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
import { setPhaseModelOverrides } from "../headless-runtime/interview/engine.ts";
import { isModelRef, isPhaseId, sanitizePhaseModels, type ModelRef, type PhaseId } from "../shared/phaseModels";

export function registerModelCatalogIpc(): void {
  ipcMain.handle(
    "models:list-available",
    async (_event, force?: boolean): Promise<CatalogResult<ModelCatalog>> => {
      try {
        return { ok: true, data: await fetchModelCatalog(force === true) };
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
    ): Promise<CatalogResult<PhaseValidation>> => {
      try {
        if (!isPhaseId(phaseId)) {
          return { ok: false, error: `PhaseId desconocido: ${String(phaseId)}` };
        }
        // Los overrides viajan por IPC: se re-validan acá antes de confiar.
        const safeOverrides: Partial<Record<PhaseId, ModelRef>> = {};
        if (overrides && typeof overrides === "object") {
          for (const [key, value] of Object.entries(overrides)) {
            if (isPhaseId(key) && isModelRef(value)) safeOverrides[key] = value;
          }
        }
        const catalog = await fetchModelCatalog();
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

  ipcMain.handle("models:invalidate", (): CatalogResult<{ invalidated: true }> => {
    invalidateModelCatalog();
    return { ok: true, data: { invalidated: true } };
  });

  ipcMain.handle(
    "models:set-phase-overrides",
    (_event, overrides: unknown): CatalogResult<{ applied: number }> => {
      // Sanitizado defensivo: por acá viaja lo persistido en el renderer.
      const safe = sanitizePhaseModels(overrides);
      setPhaseModelOverrides(safe);
      return { ok: true, data: { applied: Object.keys(safe).length } };
    },
  );
}
