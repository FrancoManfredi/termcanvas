/**
 * workerActivity — in-flight worker marker (Agents tiempo-real).
 *
 * Problema que resuelve: los prompts de `factory/agents/<name>/agent.md` se
 * espejan a `.opencode/agents/<name>.md` y el server opencode los cachea al
 * arrancar. Cuando la UI guarda un prompt, el daemon marca "agents dirty" y
 * debe reciclar el server para que la PRÓXIMA sesión use el prompt nuevo —
 * pero solo si no hay otro worker ejecutando (cerrar el server mata su
 * turno). El predicado viejo contaba cualquier job no terminal como
 * "corriendo": los jobs trabados en Triage (que por diseño nunca se parkean)
 * bloqueaban el reciclado para siempre y la sesión nueva seguía usando el
 * prompt viejo cacheado.
 *
 * Este módulo aporta la señal real de "worker en vuelo":
 * - `markWorkerActive` / `clearWorkerActive` alrededor de los orquestadores
 *   asíncronos (foreman/triage/spec y resume); implement/review ya exponen
 *   sus locks en `workItemStore` (`isBuildingLocked` / `isReviewLocked`).
 * - `hasActiveWorkers` es el predicado puro que decide si se puede reciclar.
 *
 * ESM puro, en memoria, nunca lanza. El estado se pierde en un reinicio del
 * daemon: correcto, porque un reinicio también recrea el server opencode.
 */

const activeWorkers = new Set<string>();

/** Normaliza un id de job ('' para basura). Nunca lanza. */
function cleanWorkerId(id: unknown): string {
  try {
    return typeof id === "string" ? id.trim() : "";
  } catch {
    return "";
  }
}

/** Marca un worker como en vuelo (idempotente). Nunca lanza. */
export function markWorkerActive(id: unknown): void {
  try {
    const clean = cleanWorkerId(id);
    if (clean !== "") activeWorkers.add(clean);
  } catch {
    // noop
  }
}

/** Desmarca un worker (idempotente). Nunca lanza. */
export function clearWorkerActive(id: unknown): void {
  try {
    const clean = cleanWorkerId(id);
    if (clean !== "") activeWorkers.delete(clean);
  } catch {
    // noop
  }
}

/** True solo con evidencia positiva (marcado y no limpiado). Nunca lanza. */
export function isWorkerActive(id: unknown): boolean {
  try {
    const clean = cleanWorkerId(id);
    return clean !== "" && activeWorkers.has(clean);
  } catch {
    return false;
  }
}

/** Limpia todo (solo tests). Nunca lanza. */
export function resetWorkersForTests(): void {
  try {
    activeWorkers.clear();
  } catch {
    // noop
  }
}

/** Fuentes de liveness inyectables (locks de la tienda en producción). */
export interface WorkerLiveness {
  isWorker: (id: string) => boolean;
  isLocked: (id: string) => boolean;
}

const NON_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "Intake",
  "Foreman",
  "Triage",
  "Building",
  "Review",
]);

/**
 * True si OTRO job (distinto de `currentJobId`) tiene un worker en vuelo o
 * un lock tomado. Estados terminales y jobs sin marcador/lock (p. ej. un
 * Triage colgado, un job parqueado tras un reinicio) NO cuentan: bloquear
 * el reciclado por ellos dejaba los prompts viejos para siempre.
 * Pura, defensiva, nunca lanza.
 */
export function hasActiveWorkers(
  jobs: unknown,
  currentJobId: unknown,
  live: WorkerLiveness,
): boolean {
  try {
    if (!Array.isArray(jobs)) return false;
    const current = cleanWorkerId(currentJobId);
    for (const job of jobs) {
      try {
        if (job === null || typeof job !== "object") continue;
        const rec = job as Record<string, unknown>;
        const id = cleanWorkerId(rec.id);
        if (id === "" || id === current) continue;
        const status = typeof rec.status === "string" ? rec.status : "";
        if (!NON_TERMINAL_STATUSES.has(status)) continue;
        if (live.isWorker(id) || live.isLocked(id)) return true;
      } catch {
        // una entrada rota nunca aborta el scan
      }
    }
    return false;
  } catch {
    return false;
  }
}
