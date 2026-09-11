/**
 * agentDirty — flag en memoria "los prompts cambiaron, reciclar antes del próximo JOB".
 *
 * Contrato con el usuario (sin costo extra de tokens, sin tocar el turno):
 * - El `PUT /factory/agents/:name` escribe a disco + regenera espejos
 *   proyecto/global y marca dirty (ver `agentFileRoutes`).
 * - El intake del próximo job (`dispatchJobPostCreateT2` en factoryServer)
 *   consume el flag: si no hay otros jobs corriendo, cierra el server
 *   opencode efímero para que el próximo `ensureClient()` bootee fresco y
 *   lea los espejos nuevos. El texto del turno queda byte-idéntico.
 * - Si hay jobs corriendo, se re-marca (defer) para no romper sesiones vivas:
 *   el job en curso usa el prompt anterior, el siguiente idle aplica el nuevo.
 * - ESM puro, cero deps (importable desde daemon y server sin ciclos),
 *   nunca lanza.
 */

let dirty = false;

/** Marca que hubo un cambio de prompts (PUT/POST/DELETE de agentes). Nunca lanza. */
export function markAgentsDirty(): void {
  try {
    dirty = true;
  } catch {
    // noop
  }
}

/**
 * Consume el flag (true = había cambio pendiente, se limpia).
 * El caller decide si recicla ahora o re-marca (sistema ocupado).
 * Nunca lanza.
 */
export function consumeAgentsDirty(): boolean {
  try {
    const was = dirty;
    dirty = false;
    return was;
  } catch {
    return false;
  }
}

/** Lectura sin consumir (para health/debug). Nunca lanza. */
export function isAgentsDirty(): boolean {
  try {
    return dirty;
  } catch {
    return false;
  }
}

/** Limpia el flag (solo tests). Nunca lanza. */
export function resetAgentsDirtyForTests(): void {
  try {
    dirty = false;
  } catch {
    // noop
  }
}
