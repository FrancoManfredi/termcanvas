// useGitHubAuth — SRP: puente reactivo sobre GitHubAuthPort
// DIP: no conoce fetch/window; solo el port
// Fix H2: solo notify si cambió JSON distinto (adapter) + hook no depender version -> evita 542 req/2s

import { useCallback, useEffect, useSyncExternalStore, useState } from "react";
import type { GitHubAuthPort, GitHubAuthState } from "../ports/github.ports";
import { RemoteGitHubAuthAdapter } from "../adapters/githubAuth.adapter";

export interface UseGitHubAuthApi {
  readonly status: GitHubAuthState;
  readonly loading: boolean;
  connect(): Promise<GitHubAuthState>;
  connectWithPat(token: string): Promise<GitHubAuthState>;
  refresh(): Promise<GitHubAuthState>;
  disconnect(): Promise<void>;
}

export function useGitHubAuth(port?: GitHubAuthPort): UseGitHubAuthApi {
  const authPort = port ?? defaultPort;
  // Mantener suscripción para renders reactivos, pero NO usar version como trigger de fetch
  const version = useSyncExternalStore(
    (cb) => authPort.subscribe(cb),
    () => authPort.getVersion(),
    () => authPort.getVersion(),
  );

  // Evitar warning unused variable: version se usa para suscribir, el valor dispara re-render pero no fetch
  void version;

  const [status, setStatus] = useState<GitHubAuthState>(() => ({ connected: false, status: "idle" as const }));
  const [loading, setLoading] = useState(false);

  // hydrate status solo al montar o cambiar de port — NO depender de version (H2)
  useEffect(() => {
    let cancelled = false;
    void authPort.getStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [authPort]);

  // Sincronización optimista cuando adapter notifica (sin fetch extra): si es Remote y tiene cache, reflejar
  useEffect(() => {
    // cuando version cambia, intentar sincronizar desde cache sin red si es posible
    const maybeCached = (authPort as unknown as { getCached?: () => GitHubAuthState }).getCached;
    if (typeof maybeCached === "function") {
      try {
        const cached = maybeCached.call(authPort) as GitHubAuthState;
        // Solo actualizar si difiere del status actual para evitar cascada
        // Se hace en microtask para no bloquear render
        setStatus((prev) => {
          if (
            prev.connected === cached.connected &&
            prev.status === cached.status &&
            prev.username === cached.username &&
            prev.avatarUrl === cached.avatarUrl &&
            prev.error === cached.error
          ) {
            return prev;
          }
          return cached;
        });
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, authPort]);

  const connect = useCallback(async (): Promise<GitHubAuthState> => {
    setLoading(true);
    try {
      // Si el port expone connectWithPopup (Remote y Local mock), usarlo — evita abrir popup vacío
      const maybePopup = (authPort as unknown as { connectWithPopup?: () => Promise<GitHubAuthState> }).connectWithPopup;
      if (typeof maybePopup === "function") {
        const s = await maybePopup.call(authPort);
        setStatus(s);
        return s;
      }
      const url = await authPort.startAuth();
      if (url && typeof window !== "undefined") {
        window.open(url, "_blank");
      }
      const s = await authPort.getStatus();
      setStatus(s);
      return s;
    } finally {
      setLoading(false);
    }
  }, [authPort]);

  const connectWithPat = useCallback(async (token: string): Promise<GitHubAuthState> => {
    setLoading(true);
    try {
      const maybePat = (authPort as unknown as { connectWithPat?: (t: string) => Promise<GitHubAuthState> }).connectWithPat;
      if (typeof maybePat === "function") {
        const s = await maybePat.call(authPort, token);
        setStatus(s);
        return s;
      }
      // fallback: si el adapter no soporta PAT, error
      const next: GitHubAuthState = { connected: false, status: "error", error: "PAT no soportado por este adapter" };
      setStatus(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, [authPort]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await authPort.getStatus();
      setStatus(s);
      return s;
    } finally {
      setLoading(false);
    }
  }, [authPort]);

  const disconnect = useCallback(async () => {
    await authPort.logout();
    const s = await authPort.getStatus();
    setStatus(s);
  }, [authPort]);

  return { status, loading, connect, connectWithPat, refresh, disconnect };
}

// singleton default for simpler usage in steps
let defaultPort: GitHubAuthPort = new RemoteGitHubAuthAdapter();

export function setDefaultGitHubAuthPort(port: GitHubAuthPort): void {
  defaultPort = port;
}

export function getDefaultGitHubAuthPort(): GitHubAuthPort {
  return defaultPort;
}
