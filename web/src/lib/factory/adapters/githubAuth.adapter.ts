// githubAuth.adapter — SRP: GitHub OAuth BFF adapter para web
// DIP: implementa GitHubAuthPort sin exponer fetch/window al dominio
// Source: ADR-003 Q1+Q2+Q6 (BFF, hybrid, postMessage + polling fallback)

import type { GitHubAuthPort, GitHubAuthState } from "../ports/github.ports";
import { GITHUB_AUTH_POLL_INTERVAL_MS, GITHUB_AUTH_POLL_MAX_MS } from "../ports/github.ports";

function getBasePath(): string {
  // Usar ruta relativa para que vite proxy funcione; en remote será absoluta pero igual proxy
  return "";
}

export class RemoteGitHubAuthAdapter implements GitHubAuthPort {
  private cache: GitHubAuthState = { connected: false, status: "idle" };
  private listeners = new Set<() => void>();
  private version = 0;

  private notify(): void {
    this.version += 1;
    for (const cb of [...this.listeners]) cb();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getVersion(): number {
    return this.version;
  }

  async getStatus(): Promise<GitHubAuthState> {
    try {
      const res = await fetch(`${getBasePath()}/api/auth/status`, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        const next: GitHubAuthState = { connected: false, status: "idle" };
        this.cache = next;
        this.notify();
        return next;
      }
      const data = (await res.json()) as {
        connected?: boolean;
        username?: string;
        avatarUrl?: string;
        avatar_url?: string;
        scope?: string;
      };
      const next: GitHubAuthState = {
        connected: Boolean(data.connected),
        username: data.username,
        avatarUrl: data.avatarUrl ?? data.avatar_url,
        scope: data.scope,
        status: data.connected ? "connected" : "idle",
      };
      this.cache = next;
      this.notify();
      return next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const next: GitHubAuthState = { connected: false, status: "error", error: msg };
      this.cache = next;
      this.notify();
      return next;
    }
  }

  async startAuth(): Promise<string> {
    const res = await fetch(`${getBasePath()}/api/auth/github/start`, {
      credentials: "include",
      redirect: "manual",
      headers: { accept: "application/json" },
    });
    // Server puede responder 302 o JSON { authUrl }
    if (res.status === 302 || res.type === "opaqueredirect") {
      const loc = res.headers.get("location");
      if (loc) return loc;
    }
    const data = (await res.json().catch(() => null)) as { authUrl?: string; url?: string } | null;
    if (data?.authUrl) return data.authUrl;
    if (data?.url) return data.url;
    // Fallback: pedir endpoint directo
    return `${getBasePath()}/api/auth/github/start`;
  }

  /**
   * Abre popup y resuelve con postMessage + polling fallback.
   * No es parte del port core, pero es la implementación P0 que el hook usa.
   */
  async connectWithPopup(): Promise<GitHubAuthState> {
    this.cache = { connected: false, status: "connecting" };
    this.notify();

    const authUrl = await this.startAuth();

    // Intentar abrir popup
    let popup: Window | null = null;
    try {
      popup = window.open(authUrl, "_blank", "popup,width=600,height=700");
    } catch {
      popup = null;
    }

    // Si popup bloqueado, fallback a navegar en misma pestaña? Para P0 solo poll
    if (!popup) {
      // Poll sin popup (usuario debe navegar manualmente)
      return this.pollUntilConnected();
    }

    // Promesa postMessage + poll race
    const result = await new Promise<GitHubAuthState>((resolve) => {
      let settled = false;
      const settle = (state: GitHubAuthState) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.cache = state;
        this.notify();
        resolve(state);
      };

      const handleMessage = (event: MessageEvent) => {
        // Validar origen
        if (event.origin !== window.location.origin) return;
        const data = event.data as { type?: string; username?: string; avatarUrl?: string } | undefined;
        if (data?.type !== "github:connected") return;
        void this.getStatus().then(settle);
      };

      const pollFallback = () => {
        const start = Date.now();
        const id = window.setInterval(() => {
          if (settled) return;
          if (popup?.closed) {
            // Si popup cerrado, chequear status una vez
            void this.getStatus().then((s) => {
              if (s.connected) settle(s);
            });
          }
          void fetch(`${getBasePath()}/api/auth/status`, { credentials: "include" })
            .then((r) => r.json().catch(() => ({ connected: false })))
            .then((d: { connected?: boolean }) => {
              if (d.connected) {
                void this.getStatus().then(settle);
                window.clearInterval(id);
              }
            })
            .catch(() => {
              // ignore
            });
          if (Date.now() - start > GITHUB_AUTH_POLL_MAX_MS) {
            window.clearInterval(id);
            if (!settled) settle({ connected: false, status: "error", error: "timeout" });
          }
        }, GITHUB_AUTH_POLL_INTERVAL_MS);
        return id;
      };

      const cleanup = () => {
        window.removeEventListener("message", handleMessage);
        if (pollId) window.clearInterval(pollId);
        try {
          if (popup && !popup.closed) popup.close();
        } catch {
          // ignore
        }
      };

      window.addEventListener("message", handleMessage);
      const pollId = pollFallback();

      // Timeout absoluto 60s
      window.setTimeout(() => {
        if (!settled) {
          void this.getStatus().then((s) => {
            if (s.connected) settle(s);
            else settle({ connected: false, status: "error", error: "timeout" });
          });
        }
      }, GITHUB_AUTH_POLL_MAX_MS);
    });

    return result;
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${getBasePath()}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore
    }
    this.cache = { connected: false, status: "idle" };
    this.notify();
  }

  private async pollUntilConnected(): Promise<GitHubAuthState> {
    const start = Date.now();
    while (Date.now() - start < GITHUB_AUTH_POLL_MAX_MS) {
      const s = await this.getStatus();
      if (s.connected) return s;
      await new Promise((r) => window.setTimeout(r, GITHUB_AUTH_POLL_INTERVAL_MS));
    }
    const next: GitHubAuthState = { connected: false, status: "error", error: "timeout" };
    this.cache = next;
    this.notify();
    return next;
  }

  /** Expone cache sincrónica para initial render */
  getCached(): GitHubAuthState {
    return this.cache;
  }
}

export class LocalGitHubAuthAdapter implements GitHubAuthPort {
  private state: GitHubAuthState = { connected: false, status: "idle" };
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  getVersion(): number {
    return this.version;
  }
  async getStatus(): Promise<GitHubAuthState> {
    return this.state;
  }
  async startAuth(): Promise<string> {
    return "";
  }
  async logout(): Promise<void> {
    this.state = { connected: false, status: "idle" };
    this.version += 1;
    for (const cb of [...this.listeners]) cb();
  }
}
