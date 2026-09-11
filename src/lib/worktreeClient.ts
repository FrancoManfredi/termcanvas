/**
 * src/lib/worktreeClient.ts — dual-path worktree ops (F3).
 *
 * Bridge (`window.termcanvas.project`) when present, headless daemon HTTP
 * (`POST /worktree/create`, `DELETE /worktree`) when not. Shapes match the
 * bridge envelopes so issue flows (resolve/review/fix/conflict) treat both
 * identically. Honest degradation: `{ ok: false }` instead of throws.
 */
import { resolveHeadlessHttpUrl } from "./githubClient.ts";

export interface SceneWorktree {
  path: string;
  branch: string;
  isPrimary: boolean;
}

export type CreateWorktreeResult =
  | { ok: true; path: string; worktrees: SceneWorktree[] }
  | { ok: false; error: string };

export type RemoveWorktreeResult =
  | { ok: true; worktrees: SceneWorktree[]; dirty?: boolean }
  | { ok: false; error: string; dirty?: boolean };

type BridgeProject = {
  createWorktree: (
    repoPath: string,
    branch: string,
  ) => Promise<CreateWorktreeResult>;
  createReviewWorktree: (
    repoPath: string,
    baseName: string,
    branch: string,
  ) => Promise<CreateWorktreeResult>;
  removeWorktree: (
    repoPath: string,
    worktreePath: string,
    force?: boolean,
  ) => Promise<RemoveWorktreeResult>;
  restoreWorktree: (
    repoPath: string,
    branch: string,
  ) => Promise<CreateWorktreeResult>;
};

function getBridge(): BridgeProject | null {
  if (typeof window === "undefined") return null;
  const project = (
    window as unknown as { termcanvas?: { project?: BridgeProject } }
  ).termcanvas?.project;
  return project ?? null;
}

interface DaemonCreateResponse {
  path?: string;
  branch?: string;
  worktrees?: SceneWorktree[];
  error?: string;
}

export async function createWorktree(
  repoPath: string,
  branch: string,
): Promise<CreateWorktreeResult> {
  const bridge = getBridge();
  if (bridge) return bridge.createWorktree(repoPath, branch);
  try {
    const res = await fetch(`${resolveHeadlessHttpUrl()}/worktree/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoPath, branch }),
    });
    const body = (await res.json()) as DaemonCreateResponse;
    if (!res.ok) {
      return { ok: false, error: body.error ?? `headless ${res.status}` };
    }
    if (!body.path) return { ok: false, error: "headless: missing path" };
    return { ok: true, path: body.path, worktrees: body.worktrees ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createReviewWorktree(
  repoPath: string,
  baseName: string,
  branch: string,
): Promise<CreateWorktreeResult> {
  const bridge = getBridge();
  if (bridge) return bridge.createReviewWorktree(repoPath, baseName, branch);
  try {
    const res = await fetch(`${resolveHeadlessHttpUrl()}/worktree/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoPath, baseName, branch }),
    });
    const body = (await res.json()) as DaemonCreateResponse;
    if (!res.ok) {
      return { ok: false, error: body.error ?? `headless ${res.status}` };
    }
    if (!body.path) return { ok: false, error: "headless: missing path" };
    return { ok: true, path: body.path, worktrees: body.worktrees ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface DaemonRemoveResponse {
  worktrees?: SceneWorktree[];
  error?: string;
}

export async function restoreWorktree(
  repoPath: string,
  branch: string,
): Promise<CreateWorktreeResult> {
  const bridge = getBridge();
  if (bridge) return bridge.restoreWorktree(repoPath, branch);
  try {
    const res = await fetch(`${resolveHeadlessHttpUrl()}/worktree/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoPath, branch }),
    });
    const body = (await res.json()) as DaemonCreateResponse;
    if (!res.ok) {
      return { ok: false, error: body.error ?? `headless ${res.status}` };
    }
    if (!body.path) return { ok: false, error: "headless: missing path" };
    return { ok: true, path: body.path, worktrees: body.worktrees ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force?: boolean,
): Promise<RemoveWorktreeResult> {
  const bridge = getBridge();
  if (bridge) return bridge.removeWorktree(repoPath, worktreePath, force);
  try {
    const params = new URLSearchParams({
      repo: repoPath,
      path: worktreePath,
    });
    if (force) params.set("force", "1");
    const res = await fetch(
      `${resolveHeadlessHttpUrl()}/worktree?${params.toString()}`,
      { method: "DELETE" },
    );
    const body = (await res.json()) as DaemonRemoveResponse;
    if (!res.ok) {
      return { ok: false, error: body.error ?? `headless ${res.status}` };
    }
    return { ok: true, worktrees: body.worktrees ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
