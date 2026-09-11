import { execSync } from "node:child_process";

/**
 * Git helpers for traceability (R5).
 * Used to stamp providerVersion and verdict commitSha.
 */

export function getCommitSha(): string {
  try {
    const sha = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^[0-9a-f]{5,40}$/.test(sha)) return sha;
    return sha;
  } catch {
    return "local";
  }
}

export function isDirty(): boolean {
  try {
    const out = execSync("git status --porcelain", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export function getCommitInfo(): { sha: string; dirty: boolean } {
  const sha = getCommitSha();
  const dirty = isDirty();
  return { sha, dirty };
}

export function getProviderVersion(): string {
  const sha = getCommitSha();
  if (sha === "local") return "local";
  const dirty = isDirty();
  return dirty ? `dirty-${sha.slice(0, 8)}` : sha.slice(0, 8);
}
