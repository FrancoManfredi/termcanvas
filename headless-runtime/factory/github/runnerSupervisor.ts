/**
 * Runner supervisor — keeps the self-hosted Actions runner alive while the
 * daemon lives (same lifecycle idea as OpencodeServerManager, but for
 * `run.cmd` instead of a server).
 *
 * Default-ON by user decision: when a configured runner dir exists, the
 * daemon starts it automatically — zero extra steps after this ships.
 * Guards prevent duplicates (service present / listener already running /
 * non-Windows / not configured). Starting an already-registered runner
 * needs NO token, so this module never touches secrets: it only checks
 * file EXISTENCE (`.runner` contents are never read) and process names.
 *
 * On daemon shutdown the child is stopped too (tree-kill best-effort:
 * killing `cmd.exe` alone would orphan `Runner.Listener.exe`). A crash
 * loop gives up honestly after MAX_RESTARTS instead of spinning forever.
 *
 * Pure decision helpers are exported for unit tests; the class takes
 * injectable fs/exec/spawn/clock so tests never touch real processes.
 * Never throws (all public methods are fail-safe).
 */

import { execFile } from "node:child_process";
import { existsSync as fsExistsSync } from "node:fs";
import { spawn as cpSpawn } from "node:child_process";
import { RUNNER_DEFAULT_DIR } from "./runnersService";

/** Give up after this many unexpected exits (then report stopped). */
export const RUNNER_MAX_RESTARTS = 5;

/** Backoff between restarts, indexed by restart count (capped). */
export function backoffForAttempt(attempt: number): number {
  try {
    const table = [5000, 15000, 30000, 60000, 300000];
    const idx = Number.isInteger(attempt) && attempt >= 0 ? Math.min(attempt, table.length - 1) : 0;
    return table[idx] as number;
  } catch {
    return 15000;
  }
}

export interface AutostartInput {
  readonly platform: string;
  readonly dirExists: boolean;
  readonly configured: boolean;
  readonly services: readonly string[];
  readonly listenerRunning: boolean;
}

export interface AutostartDecision {
  readonly start: boolean;
  readonly reason: string;
}

/**
 * Pure autostart gate. Order matters (cheapest, most decisive first).
 * Never throws.
 */
export function shouldAutostartRunner(input: AutostartInput): AutostartDecision {
  try {
    if (input.platform !== "win32") return { start: false, reason: "non-windows" };
    if (!input.dirExists) return { start: false, reason: "no-dir" };
    if (!input.configured) return { start: false, reason: "not-configured" };
    if (Array.isArray(input.services) && input.services.length > 0) {
      return { start: false, reason: "service-present" };
    }
    if (input.listenerRunning) return { start: false, reason: "already-running" };
    return { start: true, reason: "starting" };
  } catch {
    return { start: false, reason: "check-failed" };
  }
}

/**
 * True when `tasklist` output shows a listener process. The "no tasks"
 * INFO line never matches. Never throws.
 */
export function parseTasklistForListener(output: unknown): boolean {
  try {
    if (typeof output !== "string" || output.length === 0) return false;
    return /runner\.listener\.exe/i.test(output);
  } catch {
    return false;
  }
}

/** Minimal child surface the supervisor needs (real or fake). */
export interface SupervisedChild {
  readonly pid?: number;
  on(event: "exit" | "error", cb: (...args: never[]) => void): void;
  kill(signal?: string): boolean;
}

export interface SupervisorSnapshot {
  readonly running: boolean;
  readonly pid: number | null;
  readonly restarts: number;
  readonly lastExit: string | null;
  readonly dir: string;
}

export interface SupervisorDeps {
  existsSync?: (path: string) => boolean;
  execFile?: (
    cmd: string,
    args: readonly string[],
    opts: { timeoutMs: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  spawnFn?: (cmd: string, args: readonly string[], opts: { cwd: string }) => SupervisedChild;
  execTaskkill?: (pid: number) => Promise<void>;
  platform?: string;
  maxRestarts?: number;
  backoffMs?: (attempt: number) => number;
  log?: (msg: string) => void;
}

const SERVICE_PROBE_TIMEOUT_MS = 15000;

export class RunnerSupervisor {
  private readonly deps: Required<Omit<SupervisorDeps, "platform" | "maxRestarts">> & {
    platform: string;
    maxRestarts: number;
  };
  private child: SupervisedChild | null = null;
  private stopping = false;
  private restarts = 0;
  private lastExit: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dir: string = RUNNER_DEFAULT_DIR;

  constructor(deps: SupervisorDeps = {}) {
    const noopLog = (_msg: string): void => undefined;
    this.deps = {
      existsSync: deps.existsSync ?? fsExistsSync,
      execFile:
        deps.execFile ??
        ((cmd, args, opts) =>
          new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            try {
              execFile(cmd, [...args], { timeout: opts.timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
              });
            } catch (e) {
              reject(e);
            }
          })),
      spawnFn:
        deps.spawnFn ??
        ((cmd, args, opts) => {
          const child = cpSpawn(cmd, [...args], { cwd: opts.cwd, windowsHide: true });
          return child as unknown as SupervisedChild;
        }),
      execTaskkill:
        deps.execTaskkill ??
        (async (pid) => {
          const { promisify } = await import("node:util");
          const execFileAsync = promisify(execFile);
          await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            timeout: 15000,
            windowsHide: true,
          });
        }),
      platform: deps.platform ?? process.platform,
      maxRestarts: deps.maxRestarts ?? RUNNER_MAX_RESTARTS,
      backoffMs: deps.backoffMs ?? backoffForAttempt,
      log: deps.log ?? ((msg: string) => console.log(`[Factory] runner supervisor ${msg}`)),
    };
  }

  private async listServices(): Promise<string[]> {
    try {
      const out = await this.deps.execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-Service -Name 'actions.runner*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name",
        ],
        { timeoutMs: SERVICE_PROBE_TIMEOUT_MS },
      );
      return `${out?.stdout ?? ""}`
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
      return [];
    }
  }

  private async isListenerRunning(): Promise<boolean> {
    try {
      const out = await this.deps.execFile("tasklist", ["/FI", "IMAGENAME eq Runner.Listener.exe", "/FO", "CSV", "/NH"], {
        timeoutMs: SERVICE_PROBE_TIMEOUT_MS,
      });
      return parseTasklistForListener(`${out?.stdout ?? ""}`);
    } catch {
      return false;
    }
  }

  private dirState(dir: string): { dirExists: boolean; configured: boolean } {
    try {
      const dirExists = this.deps.existsSync(dir);
      const configured = dirExists && this.deps.existsSync(`${dir}\\.runner`);
      return { dirExists, configured };
    } catch {
      return { dirExists: false, configured: false };
    }
  }

  /**
   * Start supervising (idempotent while a child lives). Resolves fast
   * with the decision — the child runs detached from this promise.
   * Never throws.
   */
  async start(dir: string = RUNNER_DEFAULT_DIR): Promise<{ started: boolean; reason: string }> {
    try {
      if (this.child !== null) return { started: false, reason: "already-supervised" };
      this.dir = dir;
      this.stopping = false;
      const state = this.dirState(dir);
      const services = await this.listServices();
      const listenerRunning = await this.isListenerRunning();
      const decision = shouldAutostartRunner({
        platform: this.deps.platform,
        dirExists: state.dirExists,
        configured: state.configured,
        services,
        listenerRunning,
      });
      if (!decision.start) {
        this.deps.log(`skip (${decision.reason})`);
        return { started: false, reason: decision.reason };
      }
      this.spawnChild();
      return { started: true, reason: decision.reason };
    } catch (e) {
      return { started: false, reason: e instanceof Error ? e.message.slice(0, 120) : "start-failed" };
    }
  }

  private spawnChild(): void {
    try {
      // run.cmd is a batch file: it needs cmd.exe as interpreter. Fixed
      // argv, zero user input — no shell-injection surface.
      const child = this.deps.spawnFn("cmd.exe", ["/d", "/s", "/c", "run.cmd"], { cwd: this.dir });
      this.child = child;
      const pid = typeof child.pid === "number" ? child.pid : null;
      this.deps.log(`started (pid ${pid ?? "?"}) in ${this.dir}`);
      child.on("exit", (...args: never[]) => {
        try {
          this.onChildExit(args);
        } catch {
          // noop
        }
      });
      child.on("error", (...args: never[]) => {
        try {
          const msg = args.length > 0 ? String(args[0]) : "spawn error";
          this.lastExit = msg.slice(0, 200);
          this.deps.log(`spawn error: ${this.lastExit}`);
        } catch {
          // noop
        }
      });
    } catch (e) {
      this.child = null;
      this.lastExit = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
      this.deps.log(`spawn failed: ${this.lastExit}`);
    }
  }

  private onChildExit(args: never[]): void {
    try {
      this.child = null;
      if (this.stopping) return;
      const code = args.length > 0 ? String(args[0]) : "?";
      this.lastExit = `exit ${code}`.slice(0, 200);
      if (this.restarts >= this.deps.maxRestarts) {
        this.deps.log(`gave up after ${this.restarts} restarts (last: ${this.lastExit})`);
        return;
      }
      const delay = this.deps.backoffMs(this.restarts);
      this.restarts += 1;
      this.deps.log(`child exited (${this.lastExit}), restart ${this.restarts} in ${delay}ms`);
      this.timer = setTimeout(() => {
        this.timer = null;
        try {
          if (!this.stopping) this.spawnChild();
        } catch {
          // noop
        }
      }, delay);
      // Don't hold the daemon open for a restart timer alone.
      try {
        (this.timer as unknown as { unref?: () => void }).unref?.();
      } catch {
        // noop
      }
    } catch {
      // noop
    }
  }

  /** Stop the child (tree-kill: cmd.exe alone would orphan the listener). Never throws. */
  stop(): void {
    try {
      this.stopping = true;
      if (this.timer !== null) {
        try {
          clearTimeout(this.timer);
        } catch {}
        this.timer = null;
      }
      const child = this.child;
      this.child = null;
      if (!child) return;
      const pid = typeof child.pid === "number" ? child.pid : null;
      try {
        child.kill();
      } catch {}
      if (pid !== null) {
        void this.deps.execTaskkill(pid).catch(() => undefined);
      }
      this.deps.log("stopped");
    } catch {
      // noop
    }
  }

  getSnapshot(): SupervisorSnapshot {
    try {
      return {
        running: this.child !== null,
        pid: this.child !== null && typeof this.child.pid === "number" ? this.child.pid : null,
        restarts: this.restarts,
        lastExit: this.lastExit,
        dir: this.dir,
      };
    } catch {
      return { running: false, pid: null, restarts: 0, lastExit: null, dir: this.dir };
    }
  }
}

/** Process-wide singleton owned by the daemon lifecycle. */
export const runnerSupervisor = new RunnerSupervisor();
