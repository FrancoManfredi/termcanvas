/**
 * pipelineLive — interruptor "daemon vivo" para efectos best-effort.
 *
 * Los helpers que gastan LLM o spawnean procesos (reconciliación de sesión
 * huérfana, refresh de preguntas de triage) solo tienen sentido con el
 * factory server levantado. En tests (que importan handlers/servicios sin
 * bootear) deben ser inertes: un refresh real en un test spawnearía un
 * server opencode de verdad y quemaría llamadas LLM.
 *
 * - `markPipelineLive()`: lo llama el boot (`ensureFactoryServer`); los
 *   tests que verifican estos efectos la llaman a mano junto a sus mocks.
 * - `resetPipelineLiveForTests()`: solo tests (aislamiento entre suites).
 * Hoja pura: cero imports, nunca lanza.
 */

let live = false;

export function markPipelineLive(): void {
  try {
    live = true;
  } catch {
    // noop
  }
}

export function isPipelineLive(): boolean {
  try {
    return live === true;
  } catch {
    return false;
  }
}

export function resetPipelineLiveForTests(): void {
  try {
    live = false;
  } catch {
    // noop
  }
}
