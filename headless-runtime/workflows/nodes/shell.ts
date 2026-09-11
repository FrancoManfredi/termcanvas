/**
 * Runner de subprocesos para nodos determinísticos (bash/script).
 * Usa exec/execFile con timeout, maxBuffer y soporte de AbortSignal.
 */

import { exec, execFile } from "node:child_process";

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 16 * 1024 * 1024;
const TAIL_LIMIT = 2_000;

export function tail(text: string, limit = TAIL_LIMIT): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

interface ExecErrorLike {
  message: string;
  code?: string | number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}

function describeFailure(error: ExecErrorLike): string {
  if (error.killed || error.signal) return "timeout";
  if (typeof error.code === "string") return error.message;
  return `exit ${String(error.code ?? 1)}`;
}

export function runShellCommand(command: string, opts: ShellOptions): Promise<ShellResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        signal: opts.signal,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        if (opts.signal?.aborted) {
          reject(new Error("cancelado"));
          return;
        }
        if (typeof error.code === "string" || error.killed || error.signal) {
          reject(new Error(describeFailure(error)));
          return;
        }
        resolve({ stdout, stderr, exitCode: Number(error.code ?? 1) });
      },
    );
  });
}

export function runProcess(
  executable: string,
  args: string[],
  opts: ShellOptions,
): Promise<ShellResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        signal: opts.signal,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        if (opts.signal?.aborted) {
          reject(new Error("cancelado"));
          return;
        }
        if (typeof error.code === "string" || error.killed || error.signal) {
          reject(new Error(describeFailure(error)));
          return;
        }
        resolve({ stdout, stderr, exitCode: Number(error.code ?? 1) });
      },
    );
  });
}
