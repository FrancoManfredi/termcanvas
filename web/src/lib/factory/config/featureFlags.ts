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

export const FACTORY_BACKEND_API_URL: string =
  (rawEnv?.VITE_FACTORY_BACKEND_API_URL as string | undefined)?.trim() || "http://localhost:8787";

export interface BackendConfig {
  readonly mode: BackendMode;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

/**
 * Base URL efectiva para fetch — CSP-friendly.
 * Si estamos en localhost (dev via Vite proxy) y el backend es localhost,
 * devolvemos "" para que FetchTransport use URL relativa `/api/...` y eluda CSP
 * (el proxy de vite.config.ts reenvía a :8787). En prod o si baseUrl es
 * https://app.warp.dev, se mantiene absoluta.
 * Nota: getBackendConfig().baseUrl sigue siendo absoluta para diagnóstico;
 * esta helper es opt-in para transporte.
 */
export function getEffectiveBaseUrl(): string {
  const raw = FACTORY_BACKEND_API_URL.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalPage = host === "localhost" || host === "127.0.0.1";
    const isLocalBackend = raw.includes("localhost") || raw.includes("127.0.0.1");
    if (isLocalPage && isLocalBackend) return "";
  }
  return raw;
}

export function getBackendConfig(): BackendConfig {
  const apiKey = (rawEnv?.VITE_WARP_API_KEY as string | undefined)?.trim() || undefined;
  return {
    mode: BACKEND_MODE,
    baseUrl: FACTORY_BACKEND_API_URL.replace(/\/$/, ""),
    ...(apiKey ? { apiKey } : {}),
  };
}

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
