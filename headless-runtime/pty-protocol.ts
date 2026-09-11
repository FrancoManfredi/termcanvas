/**
 * headless-runtime/pty-protocol.ts — JSON framing for `/pty/stream` (F1).
 *
 * Raw mode (legacy) stays: server sends raw PTY bytes, client sends raw
 * input. JSON mode is negotiated per-socket: the first client message that
 * parses as a PtyClientMessage switches that socket to JSON; the server
 * then sends PtyServerMessages as JSON text frames.
 *
 * 1 socket = 1 pty. No multiplexing, no auto-reconnect (honest fail).
 */

export interface PtyCreateParams {
  cwd?: string;
  shell?: string;
  args?: string[];
  envOverrides?: Record<string, string>;
  terminalId?: string;
  terminalType?: string;
  cols?: number;
  rows?: number;
}

export type PtyClientMessage =
  | ({ type: "create" } & PtyCreateParams)
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "destroy" };

export type PtyServerMessage =
  | { type: "ready"; ptyId: number }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number };

export function parseClientMessage(raw: string): PtyClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (type === "input") {
    const data = (parsed as { data?: unknown }).data;
    return typeof data === "string" ? { type: "input", data } : null;
  }
  if (type === "resize") {
    const { cols, rows } = parsed as { cols?: unknown; rows?: unknown };
    return typeof cols === "number" && typeof rows === "number"
      ? { type: "resize", cols, rows }
      : null;
  }
  if (type === "destroy") return { type: "destroy" };
  if (type === "create") {
    const { cwd, shell, args, envOverrides, terminalId, terminalType, cols, rows } =
      parsed as {
        cwd?: unknown;
        shell?: unknown;
        args?: unknown;
        envOverrides?: unknown;
        terminalId?: unknown;
        terminalType?: unknown;
        cols?: unknown;
        rows?: unknown;
      };
    return {
      type: "create",
      ...(typeof cwd === "string" ? { cwd } : {}),
      ...(typeof shell === "string" ? { shell } : {}),
      ...(Array.isArray(args) && args.every((a) => typeof a === "string")
        ? { args: args as string[] }
        : {}),
      ...(envOverrides && typeof envOverrides === "object"
        ? { envOverrides: envOverrides as Record<string, string> }
        : {}),
      ...(typeof terminalId === "string" ? { terminalId } : {}),
      ...(typeof terminalType === "string" ? { terminalType } : {}),
      ...(typeof cols === "number" ? { cols } : {}),
      ...(typeof rows === "number" ? { rows } : {}),
    };
  }
  return null;
}

export function serializeServerMessage(msg: PtyServerMessage): string {
  return JSON.stringify(msg);
}

export function serializeClientMessage(msg: PtyClientMessage): string {
  return JSON.stringify(msg);
}

export function parseServerMessage(raw: string): PtyServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (type === "ready") {
    const ptyId = (parsed as { ptyId?: unknown }).ptyId;
    return typeof ptyId === "number" ? { type: "ready", ptyId } : null;
  }
  if (type === "output") {
    const data = (parsed as { data?: unknown }).data;
    return typeof data === "string" ? { type: "output", data } : null;
  }
  if (type === "exit") {
    const exitCode = (parsed as { exitCode?: unknown }).exitCode;
    return typeof exitCode === "number" ? { type: "exit", exitCode } : null;
  }
  return null;
}
