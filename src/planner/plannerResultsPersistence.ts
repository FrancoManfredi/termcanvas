import type { PlanningResult } from "../types/issuePlanning.ts";
import { parsePlanningPlan } from "./parsePlanResult.ts";

// Persistencia del último resultado de planificación por repositorio. El
// archivo vive dentro del repo (`.agents/planner-results.json`) — igual
// que activity.json — para que sobreviva al cierre de la app y viaje
// entre PCs que comparten el repo. La app lo restaura al abrir el modal
// de planificación, así los hallazgos de la última auditoría siguen ahí
// hasta que el usuario corra una revisión nueva (que pisa el archivo) o
// descarte los resultados (resetAll/confirmDiscardChoice(true) lo borran).

const PLANNER_RESULTS_FILE = ".agents/planner-results.json";
const FILE_VERSION = 1;

export function plannerResultsPath(repoPath: string): string {
  return `${repoPath.replace(/[\\/]+$/, "")}/${PLANNER_RESULTS_FILE}`;
}

// Guarda el resultado validado. Se valida re-serializando y pasándolo por
// el mismo parser del contrato: si el modelo de datos cambia, un archivo
// viejo simplemente deja de restaurarse (falla la validación y se ignora).
export async function savePlannerResults(
  repoPath: string,
  result: PlanningResult,
): Promise<void> {
  try {
    await window.termcanvas.fs.mkdir(repoPath, ".agents");
  } catch {
    // El directorio ya existe (`.agents` es común) — la escritura de abajo
    // reportará un error real si el path completo sigue sin valer.
  }
  const content = JSON.stringify({ version: FILE_VERSION, result }, null, 2);
  await window.termcanvas.fs.writeFile(plannerResultsPath(repoPath), content);
}

export async function loadPlannerResults(
  repoPath: string,
): Promise<PlanningResult | null> {
  const read = await window.termcanvas.fs.readFile(plannerResultsPath(repoPath));
  if (!("content" in read)) return null;
  let raw: { version?: number; result?: unknown };
  try {
    raw = JSON.parse(read.content) as { version?: number; result?: unknown };
  } catch {
    return null; // archivo corrupto o pre-v1 — se ignora
  }
  if (raw.version !== FILE_VERSION || !raw.result) return null;
  const validated = parsePlanningPlan(JSON.stringify(raw.result));
  return validated ? validated.result : null;
}

// Borra los resultados guardados cuando el usuario los descarta
// explícitamente; si el archivo no existe, no hay nada que hacer.
export async function clearPlannerResults(repoPath: string): Promise<void> {
  try {
    await window.termcanvas.fs.delete(plannerResultsPath(repoPath));
  } catch {
    // No existe o no se pudo borrar: los resultados viejos quedan, no es
    // un error que deba molestar al flujo de descarte.
  }
}
