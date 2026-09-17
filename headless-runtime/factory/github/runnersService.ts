/**
 * Factory github runners — read-only status for self-hosted GitHub
 * Actions runners (Windows), surfaced in the Dependencies panel next to
 * the step-by-step install guide.
 *
 * No installs here on purpose: installs kept failing on real machines
 * (locks, partial extractions, UAC), so the panel only guides and shows
 * state. Everything in this module is read-only: file EXISTENCE probes
 * (runner credential files are never read) and `gh api` listings (names
 * and statuses only, zero secrets).
 *
 * Every export is pure-ish and never throws (honest unions). Spawns use
 * argv arrays (no shell).
 *
 * Scanned by no-unbounded-loops: array methods only here, zero timers.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

/** Pinned runner release (bumped deliberately, never floating). */
export const RUNNER_VERSION = "2.337.0";
/** Only win-x64 is supported for now (all known PCs are Windows). */
export const RUNNER_PLATFORM = "win-x64";
/** SHA256 of the pinned zip (the guide shows it for manual verification). */
export const RUNNER_SHA256 =
  "1150692afa94e71f872017e254ea55b6eece1eece3fe7e3a6d4c93d0a1b85cfc";

/** Download URL for the pinned package. */
export const RUNNER_DOWNLOAD_URL =
  `https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-win-x64-${RUNNER_VERSION}.zip`;

/** Default install dir (GitHub recommendation: drive root). */
export const RUNNER_DEFAULT_DIR = "C:\\actions-runner";

/** Bound: version probes + `gh api` listings, single attempt each. */
export const RUNNERS_PROBE_TIMEOUT_MS = 15000;

/** Injectable spawn (tests pass a fake; production uses execFile). */
export type RunnerExec = (
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

/** Production spawn: argv array (no shell), explicit timeout. Throws on failure (callers catch). */
function defaultExec(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, [...args], {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env: opts.env ?? process.env,
    windowsHide: true,
  }).then((out) => ({
    stdout: typeof out.stdout === "string" ? out.stdout : String(out.stdout),
    stderr: typeof out.stderr === "string" ? out.stderr : String(out.stderr),
  }));
}

/**
 * Auth env mirror (same shape as isolation `ghEnv`: `gh` reads
 * `GH_TOKEN` or `GITHUB_TOKEN`; forward whichever is set).
 */
function runnerGhEnv(): NodeJS.ProcessEnv {
  try {
    const env = { ...process.env };
    if (!env.GH_TOKEN && process.env.GITHUB_TOKEN) {
      env.GH_TOKEN = process.env.GITHUB_TOKEN;
    }
    if (!env.GITHUB_TOKEN && process.env.GH_TOKEN) {
      env.GITHUB_TOKEN = process.env.GH_TOKEN;
    }
    return env;
  } catch {
    return { ...process.env };
  }
}

/** `owner/name` strict (GitHub slug charset), capped length. Null when invalid. Never throws. */
export function parseRepoSlug(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const slug = value.trim();
    if (slug.length === 0 || slug.length > 200) return null;
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

/** Absolute Windows dir, capped length. Null when invalid. Never throws. */
export function parseRunnerDir(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const dir = value.trim().replace(/\//g, "\\");
    if (dir.length === 0 || dir.length > 200) return null;
    if (!/^[A-Za-z]:\\/.test(dir)) return null;
    return dir;
  } catch {
    return null;
  }
}

/** One registered runner (subset of the GitHub API shape). */
export interface RunnerInfo {
  readonly name: string;
  readonly os: string;
  readonly labels: readonly string[];
  readonly online: boolean;
  readonly busy: boolean;
}

function parseRunnerInfo(value: unknown): RunnerInfo | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const r = value as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name.length === 0) return null;
    const labels: string[] = [];
    if (Array.isArray(r.labels)) {
      for (const l of r.labels) {
        try {
          if (l && typeof l === "object" && typeof (l as Record<string, unknown>).name === "string") {
            labels.push((l as Record<string, unknown>).name as string);
          } else if (typeof l === "string") {
            labels.push(l);
          }
        } catch {
          // skip junk label
        }
      }
    }
    return {
      name: r.name,
      os: typeof r.os === "string" ? r.os : "",
      labels,
      online: (r.status as string) === "online",
      busy: (r.busy as boolean) === true,
    };
  } catch {
    return null;
  }
}

/** Parse `gh api repos/{slug}/actions/runners` JSON. Never throws. */
export function parseRunnersResponse(value: unknown): RunnerInfo[] {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const rec = value as Record<string, unknown>;
    if (!Array.isArray(rec.runners)) return [];
    const out: RunnerInfo[] = [];
    for (const item of rec.runners as unknown[]) {
      const row = parseRunnerInfo(item);
      if (row) out.push(row);
    }
    return out;
  } catch {
    return [];
  }
}

/** Local PC state. File EXISTENCE only — runner credential files are never read. */
export interface LocalRunnerStatus {
  readonly dir: string;
  readonly dirExists: boolean;
  /** `.runner` config marker exists (presence only, contents never read). */
  readonly configured: boolean;
  /** `actions.runner*` service names visible on this machine (no secrets). */
  readonly services: readonly string[];
  /** Daemon-supervised `run.cmd` child (null when the status caller omits it). */
  readonly supervised: { readonly running: boolean; readonly pid: number | null; readonly restarts: number } | null;
}

async function probeLocalRunner(
  exec: RunnerExec,
  folder: string,
): Promise<LocalRunnerStatus> {
  const base: LocalRunnerStatus = { dir: folder, dirExists: false, configured: false, services: [] };
  try {
    let dirExists = false;
    let configured = false;
    try {
      dirExists = existsSync(folder);
      configured = dirExists && existsSync(`${folder}\\.runner`);
    } catch {
      // existence probe failed: report absent
    }
    let services: string[] = [];
    try {
      const out = await exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-Service -Name 'actions.runner*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name",
        ],
        { timeoutMs: RUNNERS_PROBE_TIMEOUT_MS, env: runnerGhEnv() },
      );
      const combined = `${out?.stdout ?? ""}`;
      services = combined
        .split("\n")
        .map((s) => {
          try {
            return s.trim();
          } catch {
            return "";
          }
        })
        .filter((s) => s.length > 0 && s.toLowerCase().indexOf("actions.runner") === 0);
    } catch {
      services = [];
    }
    return { dir: folder, dirExists, configured, services };
  } catch {
    return base;
  }
}

/** Remote repo state: registered runners (names/status only, zero secrets). */
export interface RemoteRunnerStatus {
  readonly reachable: boolean;
  readonly runners: readonly RunnerInfo[];
}

async function probeRemoteRunners(
  exec: RunnerExec,
  slug: string,
): Promise<RemoteRunnerStatus> {
  try {
    const out = await exec("gh", ["api", `repos/${slug}/actions/runners`], {
      timeoutMs: RUNNERS_PROBE_TIMEOUT_MS,
      env: runnerGhEnv(),
    });
    let json: unknown = null;
    try {
      json = JSON.parse(out?.stdout ?? "") as unknown;
    } catch {
      return { reachable: false, runners: [] };
    }
    return { reachable: true, runners: parseRunnersResponse(json) };
  } catch {
    return { reachable: false, runners: [] };
  }
}

export interface RunnersStatus {
  readonly local: LocalRunnerStatus;
  readonly remote: RemoteRunnerStatus;
  readonly pinned: { version: string; platform: string; url: string; sha256: string };
}

/**
 * Combined status for the Dependencies guide card: this PC + every
 * registered runner. `repo` is required for the remote list; `folder`
 * defaults to the drive-root dir. `supervised` is the daemon supervisor
 * snapshot (callers without a supervisor pass nothing). Never throws.
 */
export async function getRunnersStatus(
  input: { repo: unknown; folder?: unknown },
  exec: RunnerExec = defaultExec,
  supervised?: { running: boolean; pid: number | null; restarts: number } | null,
): Promise<RunnersStatus> {
  const empty: RunnersStatus = {
    local: { dir: RUNNER_DEFAULT_DIR, dirExists: false, configured: false, services: [], supervised: supervised ?? null },
    remote: { reachable: false, runners: [] },
    pinned: { version: RUNNER_VERSION, platform: RUNNER_PLATFORM, url: RUNNER_DOWNLOAD_URL, sha256: RUNNER_SHA256 },
  };
  try {
    const run: RunnerExec =
      typeof exec === "function"
        ? exec
        : async () => {
            throw new Error("no executor");
          };
    const slug = parseRepoSlug(input?.repo);
    const folder = parseRunnerDir(input?.folder) ?? RUNNER_DEFAULT_DIR;
    const local = await probeLocalRunner(run, folder);
    const withSupervised: LocalRunnerStatus = { ...local, supervised: supervised ?? null };
    if (slug === null) {
      return { ...empty, local: withSupervised };
    }
    const remote = await probeRemoteRunners(run, slug);
    return { local: withSupervised, remote, pinned: empty.pinned };
  } catch {
    return empty;
  }
}
