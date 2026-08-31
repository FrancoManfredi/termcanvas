import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

type AgentShimProvider = "claude" | "codex";

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function commandCandidates(command: string): string[] {
  if (process.platform !== "win32") return [command];

  const lower = command.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return [command];
  }
  return [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command];
}

function normalizePathEntry(entry: string): string {
  const normalized = path.resolve(entry);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveRealCommand(command: string): string | null {
  const shimDir = normalizePathEntry(moduleDir());
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    if (normalizePathEntry(entry) === shimDir) continue;
    for (const candidateName of commandCandidates(command)) {
      const candidate = path.join(entry, candidateName);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep searching PATH.
      }
    }
  }

  return null;
}

export function runAgentShim(provider: AgentShimProvider): never {
  const realCommand = resolveRealCommand(provider);
  if (!realCommand) {
    console.error(`TermCanvas could not find the real ${provider} executable in PATH.`);
    process.exit(127);
  }

  const args = process.argv.slice(2);
  const result = spawnSync(realCommand, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`${provider} failed to start: ${result.error.message}`);
    process.exit(127);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  process.exit(result.status ?? 1);
}
