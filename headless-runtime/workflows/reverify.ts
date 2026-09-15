/**
 * WS3b — reverify system-owned del engine.
 *
 * Los findings estructurados del review pueden pedir una re-verificación
 * enfocada vía `reverify.commands`. El ENGINE valida los comandos contra la
 * allowlist cerrada (`review/reverifyAllowlist`) y los ejecuta en el worktree:
 * el agente jamás corre estos comandos, y la evidencia entra al historial de
 * la próxima ronda del `loop_group`.
 *
 * Fail-closed: lo no listado se ignora con nota; nunca lanza hacia el loop.
 */

import { runShellCommand } from "./nodes/shell";
import { validateReverifyCommands } from "../review/reverifyAllowlist";

const MAX_COMMANDS = 10;
const MAX_EVIDENCE_CHARS = 8 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;

export interface ReverifyRunResult {
  valid: string[];
  ignored: string[];
  evidence: string;
}

/**
 * Extrae los comandos pedidos por findings estructurados
 * (`[{reverify: {commands: [...]}}]`). Tope duro, sin duplicados.
 */
export function extractReverifyCommands(findings: unknown): string[] {
  try {
    if (!Array.isArray(findings)) return [];
    const out: string[] = [];
    for (const entry of findings) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const reverify = (entry as { reverify?: unknown }).reverify;
      if (!reverify || typeof reverify !== "object" || Array.isArray(reverify)) {
        continue;
      }
      const commands = (reverify as { commands?: unknown }).commands;
      if (!Array.isArray(commands)) continue;
      for (const command of commands) {
        if (typeof command === "string" && command.trim() !== "" && !out.includes(command)) {
          out.push(command);
        }
        if (out.length >= MAX_COMMANDS) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Valida y ejecuta los comandos pedidos en `worktree`. Null cuando no hay
 * nada válido que correr (sin pedidos, o todos fuera de allowlist).
 * Best-effort: un comando que revienta queda como evidencia, no como throw.
 */
export async function runAllowlistedReverify(
  findings: unknown,
  worktree: string,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ReverifyRunResult | null> {
  const requested = extractReverifyCommands(findings);
  if (requested.length === 0) return null;
  const validation = validateReverifyCommands(requested, worktree, []);
  const lines: string[] = ["[reverify system-owned]"];
  if (validation.invalid.length > 0) {
    lines.push(`ignorados (fuera de allowlist): ${validation.invalid.join(", ")}`);
  }
  for (const command of validation.valid) {
    const started = Date.now();
    let status = "pass";
    let output = "";
    try {
      const result = await runShellCommand(command, {
        cwd: worktree,
        env: opts.env,
        timeoutMs: opts.timeoutMs ?? COMMAND_TIMEOUT_MS,
        signal: opts.signal,
      });
      output = `${result.stdout}${result.stderr}`.trim();
      status = result.exitCode === 0 ? "pass" : `fail (exit ${result.exitCode})`;
    } catch (error) {
      status = `fail (${error instanceof Error ? error.message : String(error)})`;
    }
    lines.push("");
    lines.push(`$ ${command} [${status}] ${Date.now() - started}ms`);
    if (output !== "") lines.push(output.slice(-2_000));
  }
  const evidence = lines.join("\n");
  return {
    valid: validation.valid,
    ignored: validation.invalid,
    evidence:
      evidence.length <= MAX_EVIDENCE_CHARS
        ? evidence
        : `${evidence.slice(0, MAX_EVIDENCE_CHARS)}\n…[truncado]`,
  };
}
