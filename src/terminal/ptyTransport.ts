/**
 * src/terminal/ptyTransport.ts — dual-path PTY backend (F1).
 *
 * Mirror of the Electron bridge shape (`src/types/index.ts:678-700`):
 * bridge when `window.termcanvas.terminal` exists, WebSocket transport
 * (`wsPtyTransport.ts`, 1 socket/pty, no auto-reconnect) when not.
 * `getPid`/`detectCli` degrade honestly (null) without bridge.
 */
import type { TerminalType } from "../types";
import { getWsPtyBackend } from "./wsPtyTransport";

export interface PtyCreateOptions {
  cwd: string;
  shell?: string;
  args?: string[];
  terminalId?: string;
  terminalType?: string;
  theme?: "dark" | "light";
  envOverrides?: Record<string, string>;
}

export interface DetectedCliInfo {
  cliType: TerminalType;
  pid?: number;
  sessionName?: string;
  autoApprove?: boolean;
}

export interface TerminalPtyTransport {
  create(options: PtyCreateOptions): Promise<number>;
  destroy(ptyId: number): Promise<void>;
  getPid(ptyId: number): Promise<number | null>;
  input(ptyId: number, data: string): void;
  resize(ptyId: number, cols: number, rows: number): void;
  notifyThemeChanged(ptyId: number): void;
  onOutput(callback: (ptyId: number, data: string) => void): () => void;
  onExit(callback: (ptyId: number, exitCode: number) => void): () => void;
  detectCli(ptyId: number): Promise<DetectedCliInfo | null>;
}

type BridgeTerminal = TerminalPtyTransport;

export function hasHostBridge(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { termcanvas?: unknown }).termcanvas) &&
    Boolean(
      (window as unknown as { termcanvas?: { terminal?: unknown } }).termcanvas
        ?.terminal,
    )
  );
}

function getBridge(): BridgeTerminal | null {
  if (typeof window === "undefined") return null;
  const terminal = (window as unknown as { termcanvas?: { terminal?: BridgeTerminal } })
    .termcanvas?.terminal;
  return terminal ?? null;
}

/** Bridge when present, WS backend when not. Null when neither exists. */
export function getPtyTransport(): TerminalPtyTransport | null {
  return getBridge() ?? getWsPtyBackend();
}
