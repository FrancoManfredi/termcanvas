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
  const result = await runProcess(process.execPath, args, {
    cwd: ctx.cwd,
    env: ctx.env,
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

export async function executeWait(
  wait: { duration_ms?: number; until?: string; event?: string; deadline_ms?: number },
  ctx: NodeRunContext,
): Promise<NodeExecutionResult> {
  if (wait.duration_ms === undefined && !wait.until && !wait.event) {
    throw new NodeExecutionError(
      ctx.nodeId,
      "wait requiere duration_ms, until o event",
    );
  }
  if (wait.until || wait.event) {
    throw new NodeExecutionError(
      ctx.nodeId,
      "wait durable (until/event) llega en Fase 6; usar duration_ms",
    );
  }
  const duration = wait.duration_ms ?? 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, duration);
    ctx.signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new NodeExecutionError(ctx.nodeId, "wait cancelado"));
      },
      { once: true },
    );
  });
  return { output: `waited ${duration}ms` };
}

export function executeCancel(reason: string, ctx: NodeRunContext): never {
  throw new NodeCancelSignal(ctx.nodeId, reason);
}
