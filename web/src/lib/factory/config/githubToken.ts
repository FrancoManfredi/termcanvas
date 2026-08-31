// githubToken — SRP: resolución de PAT para Fase 1 (cliente)
// Prioridad: 1) VITE_GITHUB_TOKEN (build-time, import.meta.env) 2) localStorage github_pat_session 3) null -> demo
// Nunca loguea el token. Maneja window/import.meta indefinidos (SSR/tests).

/**
 * Lee VITE_GITHUB_TOKEN del entorno Vite (build-time).
 * Requiere restart del dev server tras editar .env.
 */
export function getEnvPat(): string | null {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_GITHUB_TOKEN;
    if (typeof raw !== "string") return null;
    const t = raw.trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/**
 * Lee token guardado en localStorage bajo clave github_pat_session.
 * Formato esperado: JSON { token: string, username?, avatarUrl? }
 */
export function getLocalPat(): string | null {
  try {
    if (typeof window === "undefined") return null;
    // localStorage puede no existir en algunos entornos (SSR)
    const storage = (typeof localStorage !== "undefined" ? localStorage : null) as Storage | null;
    if (!storage) return null;
    const raw = storage.getItem("github_pat_session");
    if (!raw) return null;
    const data = JSON.parse(raw) as { token?: unknown };
    if (typeof data.token !== "string") return null;
    const t = data.token.trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/**
 * Token efectivo según prioridad: env > storage > null (demo).
 */
export function getEffectivePat(): string | null {
  return getEnvPat() ?? getLocalPat();
}

/**
 * True si hay token en env (VITE_GITHUB_TOKEN).
 */
export function hasEnvPat(): boolean {
  return getEnvPat() !== null;
}

/**
 * Origen del token efectivo.
 */
export function tokenSource(): "env" | "storage" | "none" {
  if (getEnvPat()) return "env";
  if (getLocalPat()) return "storage";
  return "none";
}
