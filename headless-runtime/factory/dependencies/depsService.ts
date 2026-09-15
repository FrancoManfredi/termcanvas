/**
 * Factory dependencies — status + installer for machine-global CLIs
 * (pr-agent via uv/pip; python/gh as info rows).
 *
 * Tools are machine-global, never per-project: one install serves every
 * repo the daemon handles. Every export is pure-ish and never throws
 * (honest unions, errors sliced). Spawns use argv arrays (no shell).
 *
 * Scanned by no-unbounded-loops: array methods only here, zero timers.
 * No auto-install ever: installs run only on explicit
 * human action through POST .../pr-agent/install.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Bound: version probes (`--version`), single attempt each. */
export const DEPS_PROBE_TIMEOUT_MS = 15000;

/** Bound: package install (`uv tool install` / `pip install`), single attempt. */
export const DEPS_INSTALL_TIMEOUT_MS = 240000;

/** Tail width for honest install logs. */
const LOG_SLICE = 1500;

/** Slice width for honest error strings. */
const ERROR_SLICE = 200;

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

function sliceError(value: unknown): string {
  try {
    const msg = value instanceof Error ? value.message : String(value);
    return msg.slice(0, ERROR_SLICE);
  } catch {
    return "dependency probe failed";
  }
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

const PR_AGENT_INSTALL_UV = "uv tool install pr-agent";
const PR_AGENT_INSTALL_PIP = "python -m pip install --user pr-agent";

/**
 * Status of machine-global factory tools. pr-agent carries its install
 * command; python/gh are info rows (managed outside the factory).
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
    const [prAgent, python, gh] = await Promise.all([
      probe(run, "pr-agent", ["--version"]),
      probe(run, "python", ["--version"]),
      probe(run, "gh", ["--version"]),
    ]);
    return {
      tools: [
        {
          name: "pr-agent",
          description: "External PR reviewer (Qodo OSS) used by the factory after opening a PR.",
          installed: prAgent.present,
          version: prAgent.version,
          installable: true,
          installCommand: prAgent.present ? null : PR_AGENT_INSTALL_UV,
          hint: prAgent.present
            ? null
            : "Installed with uv (isolated). If the check still shows missing after install, restart the app so it picks up the new PATH.",
        },
        {
          name: "python",
          description: "Required to run pr-agent.",
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

export type InstallPrAgentResult =
  | { ok: true; method: "uv" | "pip"; version: string | null; log: string }
  | { ok: false; error: string; log: string };

function tailLog(value: unknown): string {
  try {
    const s = typeof value === "string" ? value : String(value ?? "");
    const flat = s.replace(/\r\n/g, "\n").trim();
    return flat.length > LOG_SLICE ? flat.slice(flat.length - LOG_SLICE) : flat;
  } catch {
    return "";
  }
}

/**
 * Installs pr-agent machine-global: `uv tool install` when uv exists,
 * else `python -m pip install --user`. A failed uv install falls back to
 * pip automatically (real case: uv resolving a pyyaml sdist on a machine
 * without MSVC build tools, where pip installs the wheel fine). Verifies
 * with `--version` after. Single attempt per command; explicit human
 * action only. Never throws.
 */
export async function installPrAgent(
  exec: DepsExec = defaultExec,
): Promise<InstallPrAgentResult> {
  const logs: string[] = [];
  try {
    const run: DepsExec =
      typeof exec === "function"
        ? exec
        : async () => {
            throw new Error("no executor");
          };
    const log = (s: string): void => {
      logs.push(s);
    };
    const runInstall = async (
      method: "uv" | "pip",
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const installArgs: readonly string[] =
        method === "uv"
          ? ["tool", "install", "pr-agent"]
          : ["-m", "pip", "install", "--user", "pr-agent"];
      const installCmd = method === "uv" ? "uv" : "python";
      log(`$ ${installCmd} ${installArgs.join(" ")}`);
      try {
        const out = await run(installCmd, installArgs, {
          timeoutMs: DEPS_INSTALL_TIMEOUT_MS,
        });
        log(tailLog(`${out?.stdout ?? ""}\n${out?.stderr ?? ""}`));
        return { ok: true };
      } catch (e) {
        const msg = sliceError(e);
        log(msg);
        return { ok: false, error: `install failed (${method}): ${msg}` };
      }
    };
    const finishVerify = async (
      method: "uv" | "pip",
    ): Promise<InstallPrAgentResult> => {
      const check = await probe(run, "pr-agent", ["--version"]);
      if (!check.present) {
        return {
          ok: false,
          error:
            "install finished but `pr-agent --version` is still missing (restart the app so it picks up the new PATH, then Re-check)",
          log: logs.join("\n").slice(-LOG_SLICE),
        };
      }
      return {
        ok: true,
        method,
        version: check.version,
        log: logs.join("\n").slice(-LOG_SLICE),
      };
    };
    const uvPresent = (await probe(run, "uv", ["--version"])).present;
    const first = await runInstall(uvPresent ? "uv" : "pip");
    if (first.ok) return finishVerify(uvPresent ? "uv" : "pip");
    // uv failed after claiming presence (or pip failed directly): try the
    // other installer once before reporting, when there is one left.
    if (uvPresent) {
      const second = await runInstall("pip");
      if (second.ok) return finishVerify("pip");
      return {
        ok: false,
        error: `${first.error}; fallback pip: ${second.error}`.slice(0, ERROR_SLICE),
        log: logs.join("\n").slice(-LOG_SLICE),
      };
    }
    return {
      ok: false,
      error: first.error,
      log: logs.join("\n").slice(-LOG_SLICE),
    };
  } catch (e) {
    return { ok: false, error: sliceError(e), log: logs.join("\n").slice(-LOG_SLICE) };
  }
}
