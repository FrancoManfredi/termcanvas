// useGitHubAuth — SRP: puente reactivo sobre GitHubAuthPort
// DIP: no conoce fetch/window; solo el port

import { useCallback, useEffect, useSyncExternalStore, useState } from "react";
import type { GitHubAuthPort, GitHubAuthState } from "../ports/github.ports";
import { RemoteGitHubAuthAdapter } from "../adapters/githubAuth.adapter";

export interface UseGitHubAuthApi {
  readonly status: GitHubAuthState;
  readonly loading: boolean;
  connect(): Promise<GitHubAuthState>;
  refresh(): Promise<GitHubAuthState>;
  disconnect(): Promise<void>;
}

export function useGitHubAuth(port?: GitHubAuthPort): UseGitHubAuthApi {
  const authPort = port ?? defaultPort;
  const version = useSyncExternalStore(
    (cb) => authPort.subscribe(cb),
    () => authPort.getVersion(),
    () => authPort.getVersion(),
  );

  const [status, setStatus] = useState<GitHubAuthState>(() => ({ connected: false, status: "idle" as const }));
  const [loading, setLoading] = useState(false);

  // hydrate status
  useEffect(() => {
    let cancelled = false;
    void authPort.getStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
    // version triggers re-read after notify, but we also effect on version
  }, [authPort, version]);

  const connect = useCallback(async (): Promise<GitHubAuthState> => {
    setLoading(true);
    try {
      if (authPort instanceof RemoteGitHubAuthAdapter) {
        const s = await authPort.connectWithPopup();
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

  return { status, loading, connect, refresh, disconnect };
}

// singleton default for simpler usage in steps
let defaultPort: GitHubAuthPort = new RemoteGitHubAuthAdapter();

export function setDefaultGitHubAuthPort(port: GitHubAuthPort): void {
  defaultPort = port;
}

export function getDefaultGitHubAuthPort(): GitHubAuthPort {
  return defaultPort;
}
