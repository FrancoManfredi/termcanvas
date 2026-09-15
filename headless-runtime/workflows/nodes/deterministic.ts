/**
 * Nodos determinísticos Fase 0: bash, script, wait y cancel.
 * El executor resuelve templates antes de invocarlos.
 */

import fs from "node:fs";
import path from "node:path";
import type { NodeExecutionResult } from "../types";
import { NodeCancelSignal, NodeExecutionError } from "../errors";
import { runProcess, runShellCommand, tail } from "./shell";

export interface NodeRunContext {
  nodeId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  artifactsDir: string;
  stateDir: string;
}

export async function executeBash(
  command: string,
  ctx: NodeRunContext,
): Promise<NodeExecutionResult> {
  const result = await runShellCommand(command, {
    cwd: ctx.cwd,
    env: ctx.env,
    timeoutMs: ctx.timeoutMs,
    signal: ctx.signal,
  });
  if (result.exitCode !== 0) {
    throw new NodeExecutionError(
      ctx.nodeId,
      `bash exit ${result.exitCode}: ${tail(result.stderr) || tail(result.stdout)}`,
      tail(result.stderr),
    );
  }
  return { output: result.stdout.trimEnd() };
}

/**
 * Env para ejecutar un script node. Bajo Electron (`process.versions.electron`)
 * `process.execPath` es electron.exe: `ELECTRON_RUN_AS_NODE=1` lo hace correr
 * como Node puro. Sin esto, un `script:` node (verify-runner) lanzaría una
 * segunda instancia de Electron con ventanas/consola — y no ejecutaría el
 * script con semántica Node. Puro, nunca lanza.
 */
export function scriptExecEnv(
  env: NodeJS.ProcessEnv | undefined,
  isElectron: boolean,
): NodeJS.ProcessEnv | undefined {
  try {
    if (!isElectron) return env;
    return { ...(env ?? {}), ELECTRON_RUN_AS_NODE: "1" };
  } catch {
    return env;
  }
}

export async function executeScript(
  script: { code: string; runtime: "node" | "tsx" },
  ctx: NodeRunContext,
): Promise<NodeExecutionResult> {
  const ext = script.runtime === "tsx" ? "ts" : "mjs";
  const scriptPath = path.join(ctx.artifactsDir, "scripts", `${ctx.nodeId}.${ext}`);
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, script.code, "utf-8");
  const args =
    script.runtime === "tsx"
      ? ["--import", "tsx", scriptPath]
      : [scriptPath];
  const isElectron = Boolean(
    (process.versions as unknown as { electron?: string }).electron,
  );
  const result = await runProcess(process.execPath, args, {
    cwd: ctx.cwd,
    env: scriptExecEnv(ctx.env, isElectron),
    timeoutMs: ctx.timeoutMs,
    signal: ctx.signal,
  });
  if (result.exitCode !== 0) {
    throw new NodeExecutionError(
      ctx.nodeId,
      `script exit ${result.exitCode}: ${tail(result.stderr) || tail(result.stdout)}`,
      tail(result.stderr),
    );
  }
  return { output: result.stdout.trimEnd() };
}

function sleepAbortable(ms: number, ctx: NodeRunContext): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    ctx.signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new NodeExecutionError(ctx.nodeId, "wait cancelado"));
      },
      { once: true },
    );
  });
}

export async function executeWait(
  wait: { duration_ms?: number; until?: string; event?: string; deadline_ms?: number },
  ctx: NodeRunContext,
  waitForEvent?: (event: string, deadlineMs?: number) => Promise<void>,
): Promise<NodeExecutionResult> {
  if (wait.event !== undefined) {
    if (!waitForEvent) {
      throw new NodeExecutionError(
        ctx.nodeId,
        "wait por evento sin handler (onWait) en el runtime",
      );
    }
    await waitForEvent(wait.event, wait.deadline_ms);
    return { output: `event ${wait.event}` };
  }
  if (wait.until !== undefined) {
    const target = Date.parse(wait.until);
    if (Number.isNaN(target)) {
      throw new NodeExecutionError(ctx.nodeId, `wait.until inválido: ${wait.until}`);
    }
    await sleepAbortable(Math.max(0, target - Date.now()), ctx);
    return { output: `waited until ${wait.until}` };
  }
  if (wait.duration_ms !== undefined) {
    await sleepAbortable(wait.duration_ms, ctx);
    return { output: `waited ${wait.duration_ms}ms` };
  }
  throw new NodeExecutionError(
    ctx.nodeId,
    "wait requiere duration_ms, until o event",
  );
}

export function executeCancel(reason: string, ctx: NodeRunContext): never {
  throw new NodeCancelSignal(ctx.nodeId, reason);
}
