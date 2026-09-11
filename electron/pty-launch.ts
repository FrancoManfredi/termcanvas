import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getTermCanvasDataDir,
  type TermCanvasInstance,
} from "../shared/termcanvas-instance";

export interface PtyLaunchOptions {
  cwd: string;
  shell?: string;
  args?: string[];
  extraPathEntries?: string[];
  envOverrides?: Record<string, string | undefined>;
  terminalId?: string;
  terminalType?: string;
  theme?: "dark" | "light";
}

export interface PtyResolvedLaunchSpec {
  cwd: string;
  file: string;
  args: string[] | string;
  env: Record<string, string>;
}

function applyThemeHints(
  env: Record<string, string>,
  theme: "dark" | "light" | undefined,
): void {
  if (!theme) return;

  env.TERMCANVAS_THEME = theme;
  env.COLORFGBG = theme === "dark" ? "15;0" : "0;15";
}

export interface LaunchResolverDeps {
  platform: NodeJS.Platform;
  pathDelimiter: string;
  pathSeparator: string;
  existsSync: (file: string) => boolean;
  isExecutable: (file: string) => boolean;
  readFileSync: (file: string, encoding: BufferEncoding) => string;
  homeDir: () => string;
  getShellEnv: () => Promise<Record<string, string | undefined>>;
}

const LOGIN_SHELL_ENV_BLOCKLIST = new Set([
  "NO_COLOR",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
]);

const LOGIN_SHELL_ENV_BLOCKED_PREFIXES = [
  "CODEX_",
  "P9K_",
] as const;

const TERMCANVAS_RUNTIME_ENV_BLOCKLIST = new Set([
  "TERMCANVAS_SOCKET",
  "TERMCANVAS_TERMINAL_ID",
  "TERMCANVAS_TERMINAL_TYPE",
  "TERMCANVAS_INSTANCE",
  "TERMCANVAS_PORT_FILE",
]);

function getEnvVarCaseInsensitive(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  if (typeof env[key] === "string") return env[key];

  const found = Object.entries(env).find(([entryKey, entryValue]) =>
    entryKey.toLowerCase() === key.toLowerCase() &&
    typeof entryValue === "string"
  );
  return found?.[1];
}

function getPlatformPath(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function defaultPathEntriesForPlatform(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  const platformPath = getPlatformPath(platform);

  if (platform === "win32") {
    return [
      "C:\\Windows\\System32",
      "C:\\Windows",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
      getEnvVarCaseInsensitive(env, "LOCALAPPDATA")
        ? platformPath.join(
            getEnvVarCaseInsensitive(env, "LOCALAPPDATA")!,
            "Microsoft",
            "WindowsApps",
          )
        : "",
      getEnvVarCaseInsensitive(env, "LOCALAPPDATA")
        ? platformPath.join(
            getEnvVarCaseInsensitive(env, "LOCALAPPDATA")!,
            "OpenAI",
            "Codex",
            "bin",
          )
        : "",
      getEnvVarCaseInsensitive(env, "APPDATA")
        ? platformPath.join(getEnvVarCaseInsensitive(env, "APPDATA")!, "npm")
        : "",
      getEnvVarCaseInsensitive(env, "USERPROFILE")
        ? platformPath.join(
            getEnvVarCaseInsensitive(env, "USERPROFILE")!,
            ".local",
            "bin",
          )
        : "",
      getEnvVarCaseInsensitive(env, "USERPROFILE")
        ? platformPath.join(getEnvVarCaseInsensitive(env, "USERPROFILE")!, "bin")
        : "",
    ].filter(Boolean);
  }
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
}

function mergePathValue(
  pathValue: string | undefined,
  platform: NodeJS.Platform,
  delimiter: string,
  env: Record<string, string | undefined>,
): string {
  const seen = new Set<string>();
  const merged: string[] = [];

  const addEntry = (value: string) => {
    const trimmed = value.trim();
    const key = platform === "win32" ? trimmed.toLowerCase() : trimmed;
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    merged.push(trimmed);
  };

  const addEntries = (value: string | undefined) => {
    if (!value) return;
    for (const entry of value.split(delimiter)) {
      addEntry(entry);
    }
  };

  addEntries(pathValue);
  for (const entry of defaultPathEntriesForPlatform(platform, env)) {
    addEntry(entry);
  }

  return merged.join(delimiter);
}

export function sanitizeEnv(
  env: Record<string, string | undefined>,
  deps: Pick<LaunchResolverDeps, "platform" | "pathDelimiter">,
): Record<string, string> {
  const cleaned: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      cleaned[key] = value;
    }
  }

  for (const key of TERMCANVAS_RUNTIME_ENV_BLOCKLIST) {
    delete cleaned[key];
  }

  cleaned.PATH = mergePathValue(
    getEnvVarCaseInsensitive(env, "PATH"),
    deps.platform,
    deps.pathDelimiter,
    env,
  );
  return cleaned;
}

function shouldStripFromLoginShellSeed(key: string): boolean {
  if (LOGIN_SHELL_ENV_BLOCKLIST.has(key)) {
    return true;
  }

  return LOGIN_SHELL_ENV_BLOCKED_PREFIXES.some((prefix) =>
    key.startsWith(prefix)
  );
}

export function sanitizeLoginShellSeedEnv(
  env: Record<string, string | undefined>,
  deps: Pick<LaunchResolverDeps, "platform" | "pathDelimiter">,
): Record<string, string> {
  const cleaned = sanitizeEnv(env, deps);
  for (const key of Object.keys(cleaned)) {
    if (shouldStripFromLoginShellSeed(key)) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function pathEntryExists(
  entries: string[],
  target: string,
  platform: NodeJS.Platform,
): boolean {
  const normalizedTarget = platform === "win32"
    ? target.toLowerCase()
    : target;
  return entries.some((entry) =>
    (platform === "win32" ? entry.toLowerCase() : entry) === normalizedTarget
  );
}

function getWindowsCommandCandidates(command: string): string[] {
  const lower = command.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return [command];
  }
  return [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command];
}

function getWindowsPathCandidates(target: string): string[] {
  const lower = target.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return [target];
  }
  return [`${target}.exe`, `${target}.cmd`, `${target}.bat`, target];
}

function resolveExactExecutable(
  target: string,
  deps: Pick<LaunchResolverDeps, "existsSync" | "isExecutable">,
): string | null {
  if (!deps.existsSync(target)) return null;
  if (!deps.isExecutable(target)) return null;
  return target;
}

export function resolveExecutable(
  command: string,
  env: Record<string, string>,
  deps: Pick<
    LaunchResolverDeps,
    "platform" | "pathDelimiter" | "existsSync" | "isExecutable"
  >,
): string | null {
  if (!command) return null;

  const platformPath = getPlatformPath(deps.platform);

  if (platformPath.isAbsolute(command) || hasPathSeparator(command)) {
    const candidates =
      deps.platform === "win32" ? getWindowsPathCandidates(command) : [command];

    for (const candidate of candidates) {
      const resolved = resolveExactExecutable(candidate, deps);
      if (resolved) return resolved;
    }

    return null;
  }

  const pathEntries = (env.PATH ?? "")
    .split(deps.pathDelimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const commandNames =
    deps.platform === "win32" ? getWindowsCommandCandidates(command) : [command];

  for (const dir of pathEntries) {
    for (const name of commandNames) {
      const candidate = platformPath.join(dir, name);
      const resolved = resolveExactExecutable(candidate, deps);
      if (resolved) return resolved;
    }
  }

  return null;
}

function isWindowsBatchScript(file: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  const lower = file.toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

// cmd.exe parses its own command line and does NOT understand the
// CommandLineToArgvW backslash-escaping node-pty applies to argv entries.
// The canonical wrap for launching a batch script whose path contains
// spaces is: cmd /c ""C:\path with spaces\script.cmd" arg1 "arg 2""
// Passing the WHOLE line as a single string makes node-pty forward it
// verbatim (isCommandLine path), so our quoting reaches cmd.exe intact.
function quoteCmdLineArg(arg: string): string {
  if (/^[^\s"&|<>^()%!]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

function buildWindowsBatchCommandLine(
  executable: string,
  launchArgs: string[],
): string {
  const argsPart = launchArgs.length
    ? ` ${launchArgs.map(quoteCmdLineArg).join(" ")}`
    : "";
  return `/d /s /c ""${executable}"${argsPart}"`;
}

interface WindowsShimTarget {
  file: string;
  prefixArgs: string[];
}

// npm installs `.cmd` shims that only delegate to the real binary, e.g.
//   "%dp0%\node_modules\opencode-ai\bin\opencode.exe"   %*
// or the node-based variant:
//   "%_prog%"  "%dp0%\node_modules\corepack\dist\pnpm.js" %*
// Launching the target directly (instead of wrapping the shim with cmd.exe)
// lets node-pty quote arguments with CommandLineToArgvW rules, which the
// target parses correctly. cmd.exe cannot escape double quotes inside an
// argument, so prompts containing e.g. "Closes #8" corrupt the command line.
function resolveWindowsShimTarget(
  shimPath: string,
  env: Record<string, string>,
  deps: Pick<
    LaunchResolverDeps,
    | "platform"
    | "pathDelimiter"
    | "existsSync"
    | "isExecutable"
    | "readFileSync"
  >,
): WindowsShimTarget | null {
  let content: string;
  try {
    content = deps.readFileSync(shimPath, "utf-8");
  } catch {
    return null;
  }

  const execLine = content
    .split(/\r?\n/)
    .find((line) => line.includes("%*") && !line.trim().startsWith("@"));
  if (!execLine) return null;

  const quotedTokens = [...execLine.matchAll(/"([^"]*)"/g)].map(
    (match) => match[1],
  );
  if (!quotedTokens.length) return null;

  const shimDir = path.win32.dirname(shimPath);
  const expandVars = (token: string): string | null => {
    let expanded = token
      .replace(/%~dp0/gi, `${shimDir}\\`)
      .replace(/%dp0%/gi, `${shimDir}\\`)
      .replace(/%_prog%/gi, () => {
        const localNode = path.win32.join(shimDir, "node.exe");
        return deps.existsSync(localNode) ? localNode : "node";
      });
    // %dp0% ends with a backslash, so shims like "%dp0%\node_modules\..."
    // expand to a double backslash that Windows tolerates but path checks
    // do not; collapse runs without touching a leading UNC prefix.
    expanded = expanded.replace(/\\{2,}/g, (run, offset: number) =>
      offset === 0 ? run : "\\",
    );
    if (/%[a-zA-Z_][a-zA-Z0-9_]*%/.test(expanded)) return null;
    return expanded;
  };

  const tokens: string[] = [];
  for (const raw of quotedTokens) {
    const expanded = expandVars(raw);
    if (expanded === null) return null;
    tokens.push(expanded);
  }

  const resolveProgram = (name: string): string | null => {
    const resolved = resolveExecutable(name, env, deps);
    if (!resolved || isWindowsBatchScript(resolved, deps.platform)) return null;
    return resolved;
  };

  const first = tokens[0];
  if (first.toLowerCase().endsWith(".js") && deps.existsSync(first)) {
    const node = resolveProgram("node");
    if (!node) return null;
    return { file: node, prefixArgs: tokens };
  }

  const program = resolveProgram(first);
  if (!program) return null;
  return { file: program, prefixArgs: tokens.slice(1) };
}

export function resolveUserShell(
  env: Record<string, string>,
  deps: Pick<
    LaunchResolverDeps,
    "platform" | "pathDelimiter" | "existsSync" | "isExecutable"
  >,
): string {
  const candidates =
    deps.platform === "win32"
      ? [env.ComSpec, "pwsh.exe", "powershell.exe", "cmd.exe"]
      : [env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = resolveExecutable(candidate, env, deps);
    if (resolved) return resolved;
  }

  throw new Error("Could not resolve a usable shell executable");
}

function parseNullDelimitedEnv(output: Buffer): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const entry of output.toString("utf-8").split("\0")) {
    if (!entry) continue;
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = entry.slice(0, separatorIndex);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
    const value = entry.slice(separatorIndex + 1);
    parsed[key] = value;
  }
  return parsed;
}

async function captureLoginShellEnv(
  shell: string,
  baseEnv: Record<string, string>,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    execFile(
      shell,
      ["-lic", "/usr/bin/env -0"],
      {
        env: baseEnv,
        encoding: "buffer",
        maxBuffer: 1024 * 1024 * 4,
        timeout: 10_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(parseNullDelimitedEnv(stdout as Buffer));
      },
    );
  });
}

let cachedShellEnvPromise: Promise<Record<string, string>> | null = null;

const defaultDeps: LaunchResolverDeps = {
  platform: process.platform,
  pathDelimiter: path.delimiter,
  pathSeparator: path.sep,
  existsSync: (file) => fs.existsSync(file),
  readFileSync: (file, encoding) => fs.readFileSync(file, encoding),
  homeDir: () => os.homedir(),
  isExecutable: (file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  getShellEnv: async () => {
    if (cachedShellEnvPromise) {
      return cachedShellEnvPromise;
    }

    const baseEnv = sanitizeLoginShellSeedEnv(process.env, {
      platform: process.platform,
      pathDelimiter: path.delimiter,
    });

    if (process.platform === "win32") {
      return baseEnv;
    }

    const shell = resolveUserShell(baseEnv, {
      platform: process.platform,
      pathDelimiter: path.delimiter,
      existsSync: (file) => fs.existsSync(file),
      isExecutable: (file) => {
        try {
          fs.accessSync(file, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      },
    });

    cachedShellEnvPromise = captureLoginShellEnv(shell, baseEnv)
      .then((loginEnv) =>
        sanitizeEnv(loginEnv, {
          platform: process.platform,
          pathDelimiter: path.delimiter,
        }),
      )
      .catch((error) => {
        console.warn(
          `[TermCanvas] Failed to capture login shell environment via ${shell}; falling back to process env.`,
          error,
        );
        return baseEnv;
      });

    return cachedShellEnvPromise;
  },
};

export class PtyLaunchError extends Error {
  readonly code: string;
  readonly command: string;

  constructor(code: string, message: string, command: string) {
    super(message);
    this.name = "PtyLaunchError";
    this.code = code;
    this.command = command;
  }
}

export async function buildLaunchSpec(
  options: PtyLaunchOptions,
  deps: LaunchResolverDeps = defaultDeps,
): Promise<PtyResolvedLaunchSpec> {
  if (!deps.existsSync(options.cwd)) {
    throw new Error(`Directory does not exist: ${options.cwd}`);
  }

  const shellEnv = sanitizeEnv(await deps.getShellEnv(), deps);

  if (options.terminalId) {
    shellEnv.TERMCANVAS_TERMINAL_ID = options.terminalId;
  }
  if (options.terminalType) {
    shellEnv.TERMCANVAS_TERMINAL_TYPE = options.terminalType;
  }
  const instance: TermCanvasInstance = process.env.VITE_DEV_SERVER_URL
    ? "dev"
    : "prod";
  shellEnv.TERMCANVAS_INSTANCE = instance;
  shellEnv.TERMCANVAS_PORT_FILE = path.join(
    getTermCanvasDataDir(instance),
    "port",
  );
  applyThemeHints(shellEnv, options.theme);
  if (options.envOverrides) {
    for (const [key, value] of Object.entries(options.envOverrides)) {
      if (value === undefined) {
        delete shellEnv[key];
      } else {
        shellEnv[key] = value;
      }
    }
  }

  const launchArgs = options.args ?? [];

  if (options.extraPathEntries?.length) {
    const entries = shellEnv.PATH.split(deps.pathDelimiter);
    for (const dir of options.extraPathEntries) {
      if (!pathEntryExists(entries, dir, deps.platform)) entries.unshift(dir);
    }
    shellEnv.PATH = entries.join(deps.pathDelimiter);
  }

  if (options.shell) {
    const executable = resolveExecutable(options.shell, shellEnv, deps);
    if (!executable) {
      throw new PtyLaunchError(
        "executable-not-found",
        `Executable not found: ${options.shell}`,
        options.shell,
      );
    }

    if (isWindowsBatchScript(executable, deps.platform)) {
      const shimTarget = resolveWindowsShimTarget(executable, shellEnv, deps);
      if (shimTarget) {
        return {
          cwd: options.cwd,
          file: shimTarget.file,
          args: [...shimTarget.prefixArgs, ...launchArgs],
          env: shellEnv,
        };
      }

      const commandShell = resolveExecutable(
        shellEnv.ComSpec ?? "cmd.exe",
        shellEnv,
        deps,
      );
      if (!commandShell) {
        throw new Error("Could not resolve cmd.exe for Windows batch launch");
      }

      return {
        cwd: options.cwd,
        file: commandShell,
        args: buildWindowsBatchCommandLine(executable, launchArgs),
        env: shellEnv,
      };
    }

    return {
      cwd: options.cwd,
      file: executable,
      args: launchArgs,
      env: shellEnv,
    };
  }

  const shell = resolveUserShell(shellEnv, deps);
  return {
    cwd: options.cwd,
    file: shell,
    args: deps.platform === "win32" ? launchArgs : ["-l", ...launchArgs],
    env: shellEnv,
  };
}
