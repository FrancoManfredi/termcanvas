/**
 * Factory dependencies — status for machine-global CLIs
 * (python/gh as info rows; the external reviewer row is provided by the
 * configured reviewer integration — Pullfrog replaces pr-agent here).
 *
 * Tools are machine-global, never per-project: one install serves every
 * repo the daemon handles. Every export is pure-ish and never throws
 * (honest unions, errors sliced). Spawns use argv arrays (no shell).
 *
 * Scanned by no-unbounded-loops: array methods only here, zero timers.
 * Reviewer installs (if any) run only on explicit human action through
 * their own POST route — never automatically.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Bound: version probes (`--version`), single attempt each. */
export const DEPS_PROBE_TIMEOUT_MS = 15000;

/** Injectable spawn (tests pass a fake; production uses execFile). */
export type DepsExec = (
  cmd: string,
  args: readonly string[],
  opts: { timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

/** Production spawn: argv array (no shell), explicit timeout. Throws on failure (callers catch). */
function defaultExec(
  cmd: string,
  args: readonly string[],
  opts: { timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, [...args], {
    timeout: opts.timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  }).then((out) => ({
    stdout: typeof out.stdout === "string" ? out.stdout : String(out.stdout),
    stderr: typeof out.stderr === "string" ? out.stderr : String(out.stderr),
  }));
}

/** First `X.Y[.Z]` in combined output; null when absent. Never throws. */
export function parseToolVersion(output: unknown): string | null {
  try {
    if (typeof output !== "string") return null;
    const m = output.match(/(\d+\.\d+(?:\.\d+)?)/);
    return m ? (m[1] as string) : null;
  } catch {
    return null;
  }
}

async function probe(
  exec: DepsExec,
  cmd: string,
  args: readonly string[],
): Promise<{ present: boolean; version: string | null }> {
  try {
    const out = await exec(cmd, args, { timeoutMs: DEPS_PROBE_TIMEOUT_MS });
    const combined = `${out?.stdout ?? ""}\n${out?.stderr ?? ""}`;
    return { present: true, version: parseToolVersion(combined) };
  } catch {
    return { present: false, version: null };
  }
}

/** One row for the Dependencies section. `installCommand` present = Install button. */
export interface DependencyStatus {
  readonly name: string;
  readonly description: string;
  readonly installed: boolean;
  readonly version: string | null;
  readonly installable: boolean;
  readonly installCommand: string | null;
  readonly hint: string | null;
}

/**
 * Status of machine-global factory tools. python/gh are info rows
 * (managed outside the factory). The external reviewer integration
 * (Pullfrog) appends its own row when configured.
 * Never throws.
 */
export async function getDependenciesStatus(
  exec: DepsExec = defaultExec,
): Promise<{ tools: DependencyStatus[] }> {
  try {
    const run: DepsExec =
      typeof exec === "function"
        ? exec
        : async () => {
            throw new Error("no executor");
          };
    const [python, gh] = await Promise.all([
      probe(run, "python", ["--version"]),
      probe(run, "gh", ["--version"]),
    ]);
    return {
      tools: [
        {
          name: "python",
          description: "Python runtime used by factory tooling.",
          installed: python.present,
          version: python.version,
          installable: false,
          installCommand: null,
          hint: python.present ? null : "Install Python 3.10+ from python.org, then Re-check.",
        },
        {
          name: "gh",
          description: "GitHub CLI used by the factory for PR handoff.",
          installed: gh.present,
          version: gh.version,
          installable: false,
          installCommand: null,
          hint: gh.present ? null : "Install gh from cli.github.com and run gh auth login, then Re-check.",
        },
      ],
    };
  } catch {
    return { tools: [] };
  }
}
