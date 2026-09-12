/**
 * Debug temporal de la sección Activity.
 *
 * Logs con prefijo greppable `[activity-debug]` en toda la cadena:
 * useActivity → adapter liveActivity → activityDerivation → ActivityPanel →
 * activityActions. Poner `ACTIVITY_DEBUG = false` silencia todo sin quitar
 * las llamadas.
 */

export const ACTIVITY_DEBUG = true;

let counter = 0;

export function activityLog(
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!ACTIVITY_DEBUG) return;
  try {
    counter += 1;
    if (data !== undefined) {
      console.log(`[activity-debug] #${counter} ${event}`, data);
    } else {
      console.log(`[activity-debug] #${counter} ${event}`);
    }
  } catch {
    // el logger nunca rompe la UI
  }
}

export function activityWarn(event: string, data?: unknown): void {
  if (!ACTIVITY_DEBUG) return;
  try {
    console.warn(`[activity-debug] ${event}`, data);
  } catch {
    // noop
  }
}
