// KeyValuePort — DIP: el dominio y el store no conocen localStorage; solo este puerto.
// SRP: leer/escribir un string por clave. Nada de parsing ni de semántica de workspace.
// Source: WarpFactories.md §10 · US-001, US-002

export interface KeyValuePort {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export const WORKSPACE_STORAGE_KEY = "termcanvas.factory-workspace.v1";
export const WORKSPACE_STORAGE_KEY_V2 = "termcanvas.factory-workspace.v2";

/** Puerto en memoria — determinista, apto para tests y para SSR. */
export function createMemoryPort(seed: Readonly<Record<string, string>> = {}): KeyValuePort {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    read(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    write(key: string, value: string): void {
      map.set(key, value);
    },
  };
}

/**
 * Detecta errores de cuota excedida (QuotaExceededError / NS_ERROR_DOM_QUOTA_REACHED / code 22).
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  if (typeof error === "object") {
    const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
    if (candidate.name === "QuotaExceededError" || candidate.name === "NS_ERROR_DOM_QUOTA_REACHED") {
      return true;
    }
    if (candidate.code === 22) return true;
    if (typeof candidate.message === "string" && /quota/i.test(candidate.message)) {
      return true;
    }
  }
  if (error instanceof DOMException && error.name === "QuotaExceededError") return true;
  return false;
}

/**
 * Puerto sobre `window.localStorage`.
 * `namespace` prefija las claves (`namespace:key`) para aislar entornos; sin namespace
 * se usa la clave tal cual, que es lo que hace el workspace con `WORKSPACE_STORAGE_KEY`.
 * Si no hay `window`/`localStorage` (tests node, SSR) o la escritura falla (modo privado,
 * cuota llena), cae a memoria sin lanzar — excepto quota que se propaga para
 * que el caller pueda reportar `quota_exceeded` sin throw silencioso.
 */
export function createLocalStoragePort(namespace?: string): KeyValuePort {
  const fallback = createMemoryPort();
  const storage = resolveLocalStorage();
  if (!storage) return fallback;

  const prefix = namespace ? `${namespace}:` : "";
  return {
    read(key: string): string | null {
      try {
        return storage.getItem(prefix + key);
      } catch {
        return fallback.read(key);
      }
    },
    write(key: string, value: string): void {
      try {
        storage.setItem(prefix + key, value);
      } catch (error) {
        if (isQuotaExceededError(error)) throw error;
        fallback.write(key, value);
      }
    },
  };
}

function resolveLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window.localStorage;
    if (!storage) return null;
    // Algunos navegadores exponen el objeto pero lanzan al tocarlo (modo privado).
    storage.getItem("__probe__");
    return storage;
  } catch {
    return null;
  }
}

/**
 * Helpers con try/catch de quota — no rompen los ports existentes.
 * `readJson` nunca lanza: retorna null si no hay valor o JSON inválido.
 * `writeJson` retorna resultado discriminado; si es quota, el caller mapea a `quota_exceeded`.
 */
export function readJson<T>(port: KeyValuePort, key: string): T | null {
  try {
    const raw = port.read(key);
    if (raw === null || raw === undefined) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(
  port: KeyValuePort,
  key: string,
  value: unknown,
): { ok: true } | { ok: false; quotaExceeded: boolean; message: string } {
  try {
    port.write(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    const quota = isQuotaExceededError(error);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, quotaExceeded: quota, message };
  }
}
