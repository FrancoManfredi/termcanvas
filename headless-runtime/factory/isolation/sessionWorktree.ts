/**
 * Factory session worktree — single choke point for opencode `session.create`
 * directories (B2 fix).
 *
 * Root cause (B2): pipeline role sessions opened with the raw job anchor
 * (`workItem.worktree`) instead of the isolated jail. `implementService`
 * and `reviewService` already resolved the jail via `effectiveWorktreeFor`,
 * but `foreman.ts` (`directory = workItem.worktree`), `triageFlow.ts` and
 * `specFlow.ts` (`worktreePath: workItem.worktree`) did not — so foreman /
 * triage / spec sessions ran with the canvas anchor cwd (often the
 * termcanvas repo root via the `resolveOpencodeDirectory` fallback) while
 * the real work happens in the isolated `issue-N` worktree created
 * post-201 by `runIsolationPostCreate`.
 *
 * Every current and future `session.create` call site resolves its
 * directory through `resolveSessionWorktree`: the recorded jail when
 * present (memory fast path, then timeline durable path across restarts),
 * else the resolved anchor (legacy in-place behavior, pacts intact).
 * Pure, ESM, never throws, offline-testable. Zero `child_process` here.
 */

import { effectiveWorktreeFor } from "./isolationStore";

/** Minimal shape any session-creating call site can provide. */
export interface SessionWorktreeLike {
  readonly worktree?: unknown;
  readonly isolation?: { readonly worktreePath?: unknown } | null;
  readonly timeline?: unknown;
}

/**
 * Effective cwd for one opencode session: the isolation jail when
 * recorded, else `path.resolve(anchor)`. Never throws — falls back to the
 * raw anchor string (or "." when even that is unusable) instead of
 * inventing a repo root.
 */
export function resolveSessionWorktree(job: SessionWorktreeLike): string {
  try {
    return effectiveWorktreeFor({
      worktree: typeof job?.worktree === "string" ? job.worktree : "",
      ...(job?.isolation !== undefined && job.isolation !== null
        ? { isolation: job.isolation as { worktreePath?: unknown } }
        : {}),
      ...(job?.timeline !== undefined ? { timeline: job.timeline } : {}),
    });
  } catch {
    try {
      const anchor =
        job !== null &&
        typeof job === "object" &&
        typeof (job as { worktree?: unknown }).worktree === "string"
          ? String((job as { worktree?: unknown }).worktree)
          : ".";
      return anchor.length > 0 ? anchor : ".";
    } catch {
      return ".";
    }
  }
}
