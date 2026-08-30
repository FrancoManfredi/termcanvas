// SRP: feature flag de backend — sin I/O, sin store, sin React
// Source: PLAN-OLAS-WARP-FACTORIES §8.4 · Apéndice B.3
// OCP: agregar modo = agregar unión sin tocar consumidores; DIP: UI/hooks leen este flag, no fetch directo

/**
 * Modo de backend. LOCAL es el default sin credenciales (demo 5 min irrompible).
 * REMOTE es el futuro con fetch contra https://app.warp.dev y WARP_API_KEY.
 */
export type BackendMode = "local" | "remote";

/**
 * Lee VITE_FACTORY_BACKEND del entorno Vite. Cualquier valor distinto de "remote"
 * cae a "local" — fail-closed sin credenciales.
 *
 * Uso futuro (no en este spike):
 * const transport: FactoryApiTransportPort = isBackendEnabled() ? new FetchTransport(env) : createFactoryApi({ store, factories });
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env;
export const BACKEND_MODE: BackendMode =
  (rawEnv?.VITE_FACTORY_BACKEND as BackendMode | undefined) === "remote" ? "remote" : "local";

/**
 * True solo cuando BACKEND_MODE === "remote".
 * Testeable: en tests sin env es false; con VITE_FACTORY_BACKEND=remote sería true.
 */
export function isBackendEnabled(): boolean {
  return BACKEND_MODE === "remote";
}

/**
 * Helper puro para tests — verifica la lógica sin depender de import.meta.
 * No es parte del contrato runtime, solo seam de test.
 */
export function isBackendEnabledFor(mode: BackendMode): boolean {
  return mode === "remote";
}
