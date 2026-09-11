/**
 * src/terminal/wsPtyTransport.ts — WebSocket PTY backend (F1).
 *
 * 1 socket per pty against the headless `/pty/stream?format=json` endpoint
 * (see `headless-runtime/pty-protocol.ts`). No auto-reconnect: a dead
 * socket fails honestly (warn + close path) instead of inventing output.
 *
 * `getPid`/`detectCli` degrade honestly to null (no process visibility
 * over WS); `notifyThemeChanged` is a no-op (server ignores it).
 */
import {
  parseServerMessage,
  serializeClientMessage,
} from "../../headless-runtime/pty-protocol";
import type {
  DetectedCliInfo,
  PtyCreateOptions,
  TerminalPtyTransport,
} from "./ptyTransport";

export interface WsPtySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: (code: number, reason: string) => void): void;
  onOpen(cb: () => void): void;
  onError(cb: (err: unknown) => void): void;
}

export type WsPtySocketFactory = (url: string) => WsPtySocket;

const DEFAULT_HEADLESS_PORT = 7080;

let headlessWsUrlOverride: string | null = null;

/** Test/embed hook: force the WS URL instead of resolving it. */
export function setHeadlessWsUrl(url: string | null): void {
  headlessWsUrlOverride = url;
}

/**
 * Normalize any headless base URL (http://… from VITE_* env or ?headless=)
 * into a WebSocket /pty/stream URL. Full ws(s) URLs with a query pass
 * through untouched.
 */
export function toPtyStreamUrl(base: string): string {
  if (/^wss?:\/\/.+\?.+$/.test(base)) return base;
  let url = base;
  if (/^http:\/\//i.test(url)) url = url.replace(/^http:\/\//i, "ws://");
  else if (/^https:\/\//i.test(url)) url = url.replace(/^https:\/\//i, "wss://");
  return url.includes("?")
    ? url
    : `${url}${url.endsWith("/") ? "" : "/"}pty/stream?format=json`;
}

export function resolveHeadlessWsUrl(): string {
  if (headlessWsUrlOverride) return toPtyStreamUrl(headlessWsUrlOverride);
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const direct = params.get("headless");
      if (direct) return toPtyStreamUrl(direct);
      const port = params.get("headless-port");
      if (port && /^\d+$/.test(port)) {
        return `ws://127.0.0.1:${port}/pty/stream?format=json`;
      }
    } catch {
      // Fall through to the localhost default below.
    }
    const envUrl =
      (import.meta as unknown as { env?: Record<string, string | undefined> })
        .env?.VITE_TERMCANVAS_HEADLESS_URL ??
      (import.meta as unknown as { env?: Record<string, string | undefined> })
        .env?.VITE_HEADLESS_URL;
    if (envUrl) return toPtyStreamUrl(envUrl);
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    // Same-machine default: headless API on 7080 (TERMCANVAS_PORT).
    if (window.location.port === String(DEFAULT_HEADLESS_PORT)) {
      return `${proto}://${window.location.host}/pty/stream?format=json`;
    }
  }
  return `ws://127.0.0.1:${DEFAULT_HEADLESS_PORT}/pty/stream?format=json`;
}

function defaultSocketFactory(url: string): WsPtySocket {
  const Impl = (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  if (typeof Impl !== "function") {
    throw new Error(
      "WebSocket is not available in this environment (wsPtyTransport)",
    );
  }
  const WS = Impl as new (url: string) => WebSocket;
  const ws = new WS(url);
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onMessage: (cb) => {
      ws.addEventListener("message", (event) => {
        const data =
          typeof event.data === "string" ? event.data : String(event.data);
        cb(data);
      });
    },
    onClose: (cb) => {
      ws.addEventListener("close", (event) => {
        cb(event.code, event.reason);
      });
    },
    onOpen: (cb) => {
      if (ws.readyState === 1) {
        cb();
        return;
      }
      ws.addEventListener("open", () => cb(), { once: true });
    },
    onError: (cb) => {
      ws.addEventListener("error", () => cb(new Error("WebSocket error")));
    },
  };
}

const CREATE_TIMEOUT_MS = 10_000;

class WsPtyBackend implements TerminalPtyTransport {
  private readonly factory: WsPtySocketFactory;
  private readonly sockets = new Map<number, WsPtySocket>();
  private readonly outputListeners = new Set<
    (ptyId: number, data: string) => void
  >();
  private readonly exitListeners = new Set<
    (ptyId: number, exitCode: number) => void
  >();
  private readonly exitedPtys = new Set<number>();
  private nextLocalId = -1;

  constructor(factory?: WsPtySocketFactory) {
    this.factory = factory ?? defaultSocketFactory;
  }

  /** Test hook: register a socket for a ptyId without a network round-trip. */
  injectSocketForTest(ptyId: number, socket: WsPtySocket): void {
    this.sockets.set(ptyId, socket);
    this.wireSocket(ptyId, socket);
  }

  async create(options: PtyCreateOptions): Promise<number> {
    const socket = this.factory(resolveHeadlessWsUrl());
    const placeholder = this.nextLocalId--;
    this.sockets.set(placeholder, socket);

    return new Promise<number>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.sockets.delete(placeholder);
        try {
          socket.close(1000, "create failed");
        } catch {
          // Socket may already be closed.
        }
        reject(err);
      };
      const timer = setTimeout(() => {
        fail(new Error("Timed out waiting for PTY ready (wsPtyTransport)"));
      }, CREATE_TIMEOUT_MS);

      socket.onError((err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });
      socket.onClose((code, reason) => {
        fail(new Error(`PTY socket closed before ready (${code} ${reason})`));
      });
      socket.onMessage((raw) => {
        const msg = parseServerMessage(raw);
        if (!msg || msg.type !== "ready") return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.sockets.delete(placeholder);
        // Late duplicate: an old socket for the same pty stays usable.
        if (!this.sockets.has(msg.ptyId)) {
          this.sockets.set(msg.ptyId, socket);
          this.wireSocket(msg.ptyId, socket);
        }
        resolve(msg.ptyId);
      });
      socket.onOpen(() => {
        try {
          socket.send(
            serializeClientMessage({
              type: "create",
              cwd: options.cwd,
              ...(options.shell ? { shell: options.shell } : {}),
              ...(options.args ? { args: options.args } : {}),
              ...(options.terminalId ? { terminalId: options.terminalId } : {}),
              ...(options.terminalType
                ? { terminalType: options.terminalType }
                : {}),
              ...(options.envOverrides
                ? { envOverrides: options.envOverrides }
                : {}),
            }),
          );
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  async destroy(ptyId: number): Promise<void> {
    const socket = this.sockets.get(ptyId);
    if (!socket) return;
    this.sockets.delete(ptyId);
    try {
      socket.send(serializeClientMessage({ type: "destroy" }));
    } catch {
      // Socket already dead — the close path still notifies exit.
    }
    try {
      socket.close(1000, "PTY destroyed");
    } catch {
      // Already closed.
    }
    // User-initiated teardown: the session is over by request.
    this.emitExit(ptyId, 0);
  }

  async getPid(_ptyId: number): Promise<number | null> {
    return null;
  }

  input(ptyId: number, data: string): void {
    const socket = this.sockets.get(ptyId);
    if (!socket) {
      console.warn(`[wsPty] input dropped: no socket for pty ${ptyId}`);
      return;
    }
    try {
      socket.send(serializeClientMessage({ type: "input", data }));
    } catch (err) {
      console.warn(`[wsPty] input failed for pty ${ptyId}:`, err);
    }
  }

  resize(ptyId: number, cols: number, rows: number): void {
    const socket = this.sockets.get(ptyId);
    if (!socket) {
      console.warn(`[wsPty] resize dropped: no socket for pty ${ptyId}`);
      return;
    }
    try {
      socket.send(serializeClientMessage({ type: "resize", cols, rows }));
    } catch (err) {
      console.warn(`[wsPty] resize failed for pty ${ptyId}:`, err);
    }
  }

  notifyThemeChanged(_ptyId: number): void {
    // No-op over WS: the headless server has no theme side-channel.
  }

  onOutput(callback: (ptyId: number, data: string) => void): () => void {
    this.outputListeners.add(callback);
    return () => {
      this.outputListeners.delete(callback);
    };
  }

  onExit(callback: (ptyId: number, exitCode: number) => void): () => void {
    this.exitListeners.add(callback);
    return () => {
      this.exitListeners.delete(callback);
    };
  }

  async detectCli(_ptyId: number): Promise<DetectedCliInfo | null> {
    return null;
  }

  /** Test hook: drop all sockets/listeners. */
  resetForTest(): void {
    for (const socket of this.sockets.values()) {
      try {
        socket.close(1000, "reset");
      } catch {
        // Ignore close errors in tests.
      }
    }
    this.sockets.clear();
    this.outputListeners.clear();
    this.exitListeners.clear();
    this.exitedPtys.clear();
  }

  private wireSocket(ptyId: number, socket: WsPtySocket): void {
    socket.onMessage((raw) => {
      const msg = parseServerMessage(raw);
      if (!msg) return;
      if (msg.type === "output") {
        for (const cb of [...this.outputListeners]) cb(ptyId, msg.data);
        return;
      }
      if (msg.type === "exit") {
        this.emitExit(ptyId, msg.exitCode);
      }
    });
    socket.onClose((code) => {
      // No auto-reconnect: an unexpected close surfaces as exit so the
      // tile shows it instead of hanging on a dead socket. Only a normal
      // closure (1000) maps to 0 — an abnormal drop is a failure, not
      // a success.
      this.sockets.delete(ptyId);
      this.emitExit(ptyId, code === 1000 ? 0 : 1);
    });
  }

  private emitExit(ptyId: number, exitCode: number): void {
    if (this.exitedPtys.has(ptyId)) return;
    this.exitedPtys.add(ptyId);
    this.sockets.delete(ptyId);
    for (const cb of [...this.exitListeners]) cb(ptyId, exitCode);
  }
}

let singleton: WsPtyBackend | null = null;

export function getWsPtyBackend(
  factory?: WsPtySocketFactory,
): TerminalPtyTransport | null {
  if (factory) return new WsPtyBackend(factory);
  if (typeof window === "undefined") return null;
  // No WebSocket in this environment (e.g. node tests with a fake window)
  // means no WS transport exists — report null so callers stay dormant
  // instead of starting runtimes that can only fail at create() time.
  if (typeof (globalThis as unknown as { WebSocket?: unknown }).WebSocket !== "function") {
    return null;
  }
  if (!singleton) singleton = new WsPtyBackend();
  return singleton;
}

export function __resetWsPtyBackendForTest(): void {
  singleton?.resetForTest();
  singleton = null;
  headlessWsUrlOverride = null;
}
