/**
 * Debug de la sección Activity (sin salida a consola).
 *
 * La instrumentación `[activity-debug]` que recorría useActivity →
 * liveActivity → activityDerivation → ActivityPanel → activityActions se
 * retiró: sus salidas a consola saturaban el log del renderer. El API se
 * conserva como no-op para instrumentación futura sin ruido.
 */

export const ACTIVITY_DEBUG = false;

export function activityLog(
  _event: string,
  _data?: Record<string, unknown>,
): void {
  // no-op: sin salida a consola
}

export function activityWarn(_event: string, _data?: unknown): void {
  // no-op: sin salida a consola
}
