// githubAuth.adapter — SRP: GitHub OAuth BFF adapter para web
// DIP: implementa GitHubAuthPort sin exponer fetch/window al dominio
// Source: ADR-003 Q1+Q2+Q6 (BFF, hybrid, postMessage + polling fallback)
// Fix H2: solo notify si JSON distinto • H3: guard _pending + single interval + once + cleanup • H1: startAuth 503 throw
// Fase 1: LocalGitHubAuthAdapter ahora valida VITE_GITHUB_TOKEN contra api.github.com

import type { GitHubAuthPort, GitHubAuthState } from "../ports/github.ports";
import { GITHUB_AUTH_POLL_INTERVAL_MS, GITHUB_AUTH_POLL_MAX_MS } from "../ports/github.ports";
import { getEffectivePat, hasEnvPat } from "../config/githubToken";

function getBasePath(): string {
  return "";
}

function serializeState(s: GitHubAuthState): string {
  return JSON.stringify({
    connected: s.connected,
    username: s.username ?? null,
    avatarUrl: s.avatarUrl ?? null,
    scope: s.scope ?? null,
    status: s.status,
    error: s.error ?? null,
  });
}

export class RemoteGitHubAuthAdapter implements GitHubAuthPort {
  private cache: GitHubAuthState = { connected: false, status: "idle" };
  private listeners = new Set<() => void>();
  private version = 0;
  private _pending: Promise<GitHubAuthState> | null = null;
  private _lastNotifiedJson: string = serializeState(this.cache);

  private notifyIfChanged(next: GitHubAuthState): void {
    const nextJson = serializeState(next);
    // siempre actualizar cache
    this.cache = next;
    if (nextJson !== this._lastNotifiedJson) {
      this._lastNotifiedJson = nextJson;
      this.version += 1;
      for (const cb of [...this.listeners]) cb();
    }
  }

  private notify(): void {
    // legacy: force notify (used only for connecting transient)
    this._lastNotifiedJson = serializeState(this.cache);
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
        this.notifyIfChanged(next);
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
      this.notifyIfChanged(next);
      return next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const next: GitHubAuthState = { connected: false, status: "error", error: msg };
      this.notifyIfChanged(next);
      return next;
    }
  }

  async startAuth(): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${getBasePath()}/api/auth/github/start`, {
        credentials: "include",
        redirect: "manual",
        headers: { accept: "application/json" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isNetworkDown = msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("ECONNREFUSED");
      const err = new Error(isNetworkDown ? "Servidor no disponible en :8787 — ¿ejecutaste el backend? Usando modo demo local." : msg) as Error & {
        code?: string;
        status?: number;
      };
      err.code = isNetworkDown ? "network_error" : "fetch_failed";
      // marcar como para que caller pueda hacer fallback demo en localhost
      (err as unknown as { isNetworkError?: boolean }).isNetworkError = isNetworkDown;
      throw err;
    }
    // H1: si 503 missing_config -> throw sin abrir popup
    if (res.status === 503) {
      let body: { error?: string; code?: string } | null = null;
      try {
        body = (await res.json()) as { error?: string; code?: string };
      } catch {
        body = null;
      }
      const msg = body?.error ?? "GitHub OAuth no configurado (GITHUB_CLIENT_ID)";
      const code = body?.code ?? "missing_config";
      const err = new Error(msg) as Error & { code?: string; status?: number };
      err.code = code;
      err.status = 503;
      throw err;
    }
    // Server puede responder 302 o JSON { authUrl }
    if (res.status === 302 || res.type === "opaqueredirect") {
      const loc = res.headers.get("location");
      if (loc) return loc;
    }
    // Intentar parsear JSON con authUrl (incluso si !ok, salvo 503 ya manejado)
    let data: { authUrl?: string; url?: string; error?: string; code?: string } | null = null;
    try {
      data = (await res.json()) as { authUrl?: string; url?: string; error?: string; code?: string };
    } catch {
      data = null;
    }
    if (data?.authUrl) return data.authUrl;
    if (data?.url) return data.url;
    if (!res.ok && data?.error && res.status >= 500) {
      const err = new Error(data.error) as Error & { code?: string; status?: number };
      if (data.code) err.code = data.code;
      err.status = res.status;
      throw err;
    }
    if (!res.ok && res.status >= 500 && !data?.authUrl && !data?.url) {
      // sin authUrl y error 5xx, no intentar fallback silencioso; dejar que caller decida
      // pero para compatibilidad devolvemos fallback solo si no es 503
    }
    // Fallback: pedir endpoint directo
    return `${getBasePath()}/api/auth/github/start`;
  }

  /**
   * Abre popup y resuelve con postMessage + polling fallback.
   * H3: guard _pending, single interval single fetch, once listener, clearTimeout+clearInterval+removeEventListener
   */
  async connectWithPopup(): Promise<GitHubAuthState> {
    if (this._pending) return this._pending;
    this._pending = this._connectWithPopupInternal();
    try {
      const res = await this._pending;
      return res;
    } finally {
      this._pending = null;
    }
  }

  private async _connectWithPopupInternal(): Promise<GitHubAuthState> {
    this.cache = { connected: false, status: "connecting" };
    this.notify();

    let authUrl: string;
    try {
      authUrl = await this.startAuth();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as unknown as { code?: string })?.code;
      const status = (e as unknown as { status?: number })?.status;
      const isMissingConfig = code === "missing_config" || status === 503 || msg.includes("no configurado") || msg.includes("missing_config");
      const isNetworkError =
        code === "network_error" ||
        (e as unknown as { isNetworkError?: boolean })?.isNetworkError === true ||
        msg.includes("Servidor no disponible");
      // Para uso local personal: no hacer fallback auto a demo, mostrar error y dejar que el usuario use PAT (recomendado) o demo manual.
      const errorMsg = isMissingConfig
        ? "GitHub OAuth no configurado. Para uso local personal usá Personal Access Token arriba (recomendado). Para OAuth: creá una OAuth App en github.com/settings/developers y configurá GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET en server/.env."
        : isNetworkError
          ? "Servidor no disponible en :8787. Para uso local con PAT no necesitás server (token queda en localStorage). O ejecutá `pnpm --filter server dev` en /server."
          : msg;
      const next: GitHubAuthState = { connected: false, status: "error", error: errorMsg };
      this.notifyIfChanged(next);
      return next;
    }

    // Intentar abrir popup
    let popup: Window | null = null;
    try {
      popup = window.open(authUrl, "_blank", "popup,width=600,height=700");
    } catch {
      popup = null;
    }

    if (!popup) {
      return this.pollUntilConnected();
    }

    const result = await new Promise<GitHubAuthState>((resolve) => {
      let settled = false;
      let pollId: number | undefined;
      let timeoutId: number | undefined;

      const settle = (state: GitHubAuthState) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.notifyIfChanged(state);
        resolve(state);
      };

      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data as { type?: string; username?: string; avatarUrl?: string } | undefined;
        if (data?.type !== "github:connected") return;
        void this.getStatus().then(settle);
      };

      const pollFallback = (): number => {
        const start = Date.now();
        const id = window.setInterval(() => {
          if (settled) return;
          // H2+H3: single fetch per tick via getStatus (con notify condicional)
          void this.getStatus()
            .then((s) => {
              if (settled) return;
              if (s.connected) {
                settle(s);
                window.clearInterval(id);
              }
            })
            .catch(() => {
              // ignore network blip
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
        if (pollId !== undefined) window.clearInterval(pollId);
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        try {
          if (popup && !popup.closed) popup.close();
        } catch {
          // ignore
        }
      };

      window.addEventListener("message", handleMessage, { once: true } as AddEventListenerOptions);
      pollId = pollFallback();

      timeoutId = window.setTimeout(() => {
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

  async connectWithPat(token: string): Promise<GitHubAuthState> {
    const t = token.trim();
    if (!t) {
      const next: GitHubAuthState = { connected: false, status: "error", error: "Token vacío" };
      this.notifyIfChanged(next);
      return next;
    }
    this.cache = { connected: false, status: "connecting" };
    this.notify();
    try {
      const res = await fetch(`${getBasePath()}/api/auth/pat`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ token: t }),
      });
      const data = (await res.json().catch(() => null)) as {
        connected?: boolean;
        username?: string;
        avatarUrl?: string;
        avatar_url?: string;
        error?: string;
        code?: string;
      } | null;
      if (!res.ok) {
        const msg = data?.error ?? `PAT falló (${res.status})`;
        const next: GitHubAuthState = { connected: false, status: "error", error: msg };
        this.notifyIfChanged(next);
        return next;
      }
      // éxito: refrescar estado desde /status (lee cookie)
      const s = await this.getStatus();
      return s;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const next: GitHubAuthState = { connected: false, status: "error", error: msg };
      this.notifyIfChanged(next);
      return next;
    }
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
    const next: GitHubAuthState = { connected: false, status: "idle" };
    this.notifyIfChanged(next);
  }

  private async pollUntilConnected(): Promise<GitHubAuthState> {
    const start = Date.now();
    while (Date.now() - start < GITHUB_AUTH_POLL_MAX_MS) {
      const s = await this.getStatus();
      if (s.connected) return s;
      await new Promise((r) => window.setTimeout(r, GITHUB_AUTH_POLL_INTERVAL_MS));
    }
    const next: GitHubAuthState = { connected: false, status: "error", error: "timeout" };
    this.notifyIfChanged(next);
    return next;
  }

  /** Expone cache sincrónica para initial render */
  getCached(): GitHubAuthState {
    return this.cache;
  }
}

const LOCAL_PAT_STORAGE_KEY = "github_pat_session";

function readLocalPatSession(): GitHubAuthState | null {
  try {
    const raw = localStorage.getItem(LOCAL_PAT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { username?: string; avatarUrl?: string; token?: string };
    if (!data.username || !data.token) return null;
    return { connected: true, status: "connected", username: data.username, avatarUrl: data.avatarUrl, scope: "repo" };
  } catch {
    return null;
  }
}
function writeLocalPatSession(username: string, avatarUrl: string, token: string): void {
  try {
    localStorage.setItem(LOCAL_PAT_STORAGE_KEY, JSON.stringify({ username, avatarUrl, token }));
  } catch {
    // ignore
  }
}
function clearLocalPatSession(): void {
  try {
    localStorage.removeItem(LOCAL_PAT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function validatePatWithGitHub(pat: string): Promise<{ login: string; avatar_url: string }> {
  const res = await fetch("https://api.github.com/user", {
    headers: { authorization: `token ${pat}`, accept: "application/vnd.github+json", "user-agent": "termcanvas" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `GitHub /user failed ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as { login: string; avatar_url: string };
}

export class LocalGitHubAuthAdapter implements GitHubAuthPort {
  private state: GitHubAuthState = (() => {
    try {
      if (typeof window !== "undefined" && hasEnvPat()) {
        return { connected: false, status: "connecting" as const };
      }
    } catch {
      // ignore
    }
    const cached = typeof window !== "undefined" ? readLocalPatSession() : null;
    return cached ?? { connected: false, status: "idle" };
  })();
  private listeners = new Set<() => void>();
  private version = 0;
  private _lastNotifiedJson: string = serializeState(this.state);
  // simple cache: evitar revalidar si mismo pat y <30s
  private _lastValidatedPat: string | null = null;
  private _lastValidatedAt = 0;

  private notifyIfChanged(next: GitHubAuthState): void {
    const nextJson = serializeState(next);
    this.state = next;
    if (nextJson !== this._lastNotifiedJson) {
      this._lastNotifiedJson = nextJson;
      this.version += 1;
      for (const cb of [...this.listeners]) cb();
    }
  }

  private notify(): void {
    this._lastNotifiedJson = serializeState(this.state);
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
    const pat = getEffectivePat();
    if (pat) {
      // cache 30s: si mismo pat y reciente, devolver cache sin fetch
      const now = Date.now();
      if (this._lastValidatedPat === pat && now - this._lastValidatedAt < 30_000 && this.state.connected) {
        return this.state;
      }
      try {
        const data = await validatePatWithGitHub(pat);
        const next: GitHubAuthState = {
          connected: true,
          status: "connected",
          username: data.login,
          avatarUrl: data.avatar_url,
          scope: "repo",
        };
        this._lastValidatedPat = pat;
        this._lastValidatedAt = now;
        this.notifyIfChanged(next);
        return next;
      } catch (e) {
        const status = (e as unknown as { status?: number })?.status;
        let msg: string;
        if (status === 401) {
          msg = "Token inválido o expirado (401) — revisá VITE_GITHUB_TOKEN en web/.env y reiniciá vite";
        } else if (status === 403 || status === 429) {
          msg = "Rate limited — esperá un minuto";
        } else {
          const raw = e instanceof Error ? e.message : String(e);
          const isNetwork = raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("fetch failed");
          msg = isNetwork ? `Network error — verificá conexión: ${raw.slice(0, 120)}` : raw.slice(0, 200) || `GitHub /user falló ${status ?? "error"}`;
          if (status && !msg.includes(String(status))) msg = `GitHub /user falló ${status} — ${msg}`;
        }
        const next: GitHubAuthState = { connected: false, status: "error", error: msg };
        this.notifyIfChanged(next);
        return next;
      }
    }
    // Sin PAT -> modo demo idle (siempre desconectado)
    // Si había un estado conectado previo de localStorage pero ahora no hay pat, limpiar
    const idle: GitHubAuthState = { connected: false, status: "idle" };
    // Solo notificar si cambió
    if (this.state.connected || this.state.status !== "idle") {
      this.notifyIfChanged(idle);
    }
    return idle;
  }

  async startAuth(): Promise<string> {
    return "";
  }

  async connectWithPopup(): Promise<GitHubAuthState> {
    const pat = getEffectivePat();
    if (pat) {
      return this.getStatus();
    }
    this.state = { connected: false, status: "connecting" };
    this.notify();
    await new Promise((r) => setTimeout(r, 500));
    const next: GitHubAuthState = { connected: true, status: "connected", username: "demo", avatarUrl: "", scope: "demo" };
    this.notifyIfChanged(next);
    return next;
  }

  async connectWithPat(token: string): Promise<GitHubAuthState> {
    const t = token.trim();
    if (!t) {
      const next: GitHubAuthState = { connected: false, status: "error", error: "Token vacío" };
      this.notifyIfChanged(next);
      return next;
    }
    this.state = { connected: false, status: "connecting" };
    this.notify();
    try {
      const data = await validatePatWithGitHub(t);
      const next: GitHubAuthState = {
        connected: true,
        status: "connected",
        username: data.login,
        avatarUrl: data.avatar_url,
        scope: "repo",
      };
      writeLocalPatSession(data.login, data.avatar_url, t);
      this._lastValidatedPat = getEffectivePat();
      this._lastValidatedAt = Date.now();
      this.notifyIfChanged(next);
      return next;
    } catch (e) {
      const status = (e as unknown as { status?: number })?.status;
      let msg: string;
      if (status === 401) {
        msg = "Token inválido o expirado (401) — revisá que lo copiaste completo";
      } else if (status === 403 || status === 429) {
        msg = "Rate limited — esperá un minuto";
      } else {
        msg = e instanceof Error ? e.message : String(e);
      }
      const next: GitHubAuthState = { connected: false, status: "error", error: msg };
      this.notifyIfChanged(next);
      return next;
    }
  }

  getCached(): GitHubAuthState {
    return this.state;
  }

  async logout(): Promise<void> {
    clearLocalPatSession();
    this._lastValidatedPat = null;
    this._lastValidatedAt = 0;
    // Si hay token en env, logout no desconecta env (queda connecting/connected en próximo getStatus)
    // pero por ahora pasamos a idle; el próximo getStatus revalidará env y volverá a connected si es válido.
    // Esto evita que UI quede "pegada" en connected tras logout intencional en demo.
    if (hasEnvPat()) {
      // Limpiar cache local pero mantener estado idle hasta próxima validación
      const idle: GitHubAuthState = { connected: false, status: "idle" };
      this.notifyIfChanged(idle);
      return;
    }
    const next: GitHubAuthState = { connected: false, status: "idle" };
    this.notifyIfChanged(next);
  }
}
