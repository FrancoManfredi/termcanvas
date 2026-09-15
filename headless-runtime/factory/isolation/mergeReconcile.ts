/**
 * Merge reconcile (close-out externo): detecta PRs mergeados FUERA de la app
 * (GitHub UI/consola) sobre jobs factory `Complete` con isolation `pr-open`.
 *
 * Disparo on-read: el daemon lo invoca desde la ruta LIST (el renderer ya
 * pollea cada 2.5s) — cero intervalos nuevos. Cada job se chequea como máximo
 * una vez por TTL. Al detectar MERGED:
 *   1. `notePrMergedEqual` → evento durable + isolation `pr-merged`
 *      (idempotente; el mismo registro usa la ruta merge-notify del panel).
 *   2. Cleanup del worktree aislado (carpeta): solo si está limpio; con
 *      cambios locales se conserva y se registra el motivo (nunca se pierde
 *      trabajo sin commitear). La rama no se toca (doctrina gitWorktree).
 * Best-effort, nunca lanza.
 */

import fs from "node:fs";
import { workItemStore } from "../../workItem/workItemStore";
import {
  defaultGhRun,
  notePrMergedEqual,
  readPrState,
  readWorktreeStatusPorcelain,
  type GhExecRun,
} from "./gitHubPr";
import { removeIsolatedWorktree } from "./gitWorktree";

/** TTL por job: el poll de 2.5s no golpea `gh` más de 1 vez por ventana. */
export const MERGE_RECONCILE_TTL_MS = 30_000;

const lastCheckAtByJob = new Map<string, number>();
const inFlightJobs = new Set<string>();

export interface MergeReconcileSeams {
  /** Runner inyectable (tests offline); default = spawn real. */
  readonly run?: GhExecRun;
  /** Reloj inyectable (tests de TTL). */
  readonly now?: () => number;
}

interface JobIsolationLike {
  readonly state?: unknown;
  readonly prNumber?: unknown;
  readonly worktreePath?: unknown;
  readonly repoRoot?: unknown;
}

interface JobLike {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly isolation?: JobIsolationLike | null;
}

/** Test seam: limpia TTL/in-flight entre casos. Nunca en prod. */
export function resetMergeReconcileForTests(): void {
  try {
    lastCheckAtByJob.clear();
    inFlightJobs.clear();
  } catch {
    // noop
  }
}

/**
 * Reconcilia (secuencial y acotado por TTL) los jobs Complete con PR abierto:
 * si el forge los mergeó, registra el close-out y limpia el worktree. Acepta
 * la proyección del listado (`id/status/isolation`) tal cual la sirve la API.
 */
export async function reconcileMergedPrsForJobs(
  list: unknown,
  seams?: MergeReconcileSeams,
): Promise<void> {
  try {
    if (!Array.isArray(list)) return;
    const now = (): number => (seams?.now ? seams.now() : Date.now());
    for (const raw of list) {
      try {
        const job = raw as JobLike;
        if (!job || typeof job.id !== "string" || job.id.length === 0) continue;
        if (job.status !== "Complete") continue;
        const iso = job.isolation;
        if (!iso || iso.state !== "pr-open") continue;
        const prNumber = iso.prNumber;
        if (
          typeof prNumber !== "number" ||
          !Number.isInteger(prNumber) ||
          prNumber <= 0
        ) {
          continue;
        }
        const at = now();
        if (
          at - (lastCheckAtByJob.get(job.id) ?? 0) <
          MERGE_RECONCILE_TTL_MS
        ) {
          continue;
        }
        if (inFlightJobs.has(job.id)) continue;
        lastCheckAtByJob.set(job.id, at);
        inFlightJobs.add(job.id);
        try {
          await reconcileOneMergedJob(job.id, iso, prNumber, seams);
        } finally {
          inFlightJobs.delete(job.id);
        }
      } catch {
        // una fila rota nunca aborta el reconcile
      }
    }
  } catch {
    // best-effort
  }
}

async function reconcileOneMergedJob(
  jobId: string,
  iso: JobIsolationLike,
  prNumber: number,
  seams?: MergeReconcileSeams,
): Promise<void> {
  try {
    const repoPath =
      typeof iso.repoRoot === "string" && iso.repoRoot.trim() !== ""
        ? iso.repoRoot
        : "";
    if (repoPath === "") return;
    const state = await readPrState({
      repoPath,
      prNumber,
      ...(seams?.run ? { run: seams.run } : {}),
    });
    if (!state.ok || state.state !== "merged") return;
    const noted = notePrMergedEqual(jobId, prNumber);
    if (!noted.ok) return;
    await cleanupMergedJobWorktree(jobId, seams);
  } catch {
    // best-effort: el próximo tick reintenta
  }
}

/**
 * Cleanup del worktree aislado tras un merge confirmado: borra la CARPETA
 * solo si el worktree está limpio; con cambios locales se conserva con un
 * evento honesto. Nunca borra la rama. Idempotente, nunca lanza.
 */
export async function cleanupMergedJobWorktree(
  jobId: unknown,
  seams?: MergeReconcileSeams,
): Promise<{ ok: boolean; removed: boolean; skipped?: string }> {
  const run: GhExecRun = seams?.run ?? defaultGhRun;
  try {
    if (typeof jobId !== "string" || jobId.length === 0) {
      return { ok: false, removed: false, skipped: "bad-id" };
    }
    const job = workItemStore.get(jobId) as
      | { isolation?: JobIsolationLike }
      | undefined;
    if (!job) return { ok: false, removed: false, skipped: "unknown-job" };
    const iso = job.isolation;
    const worktreePath =
      iso &&
      typeof iso.worktreePath === "string" &&
      iso.worktreePath.trim() !== ""
        ? iso.worktreePath
        : "";
    if (worktreePath === "") {
      return { ok: false, removed: false, skipped: "no-worktree" };
    }
    if (!fs.existsSync(worktreePath)) {
      appendCloseOutEvent(
        jobId,
        `merge close-out: worktree ya no existe (${worktreePath})`,
        { cleaned: true, reason: "already-gone" },
      );
      return { ok: true, removed: false, skipped: "already-gone" };
    }
    const status = await readWorktreeStatusPorcelain({
      repoPath: worktreePath,
      run,
    });
    if (status === null || status !== "") {
      appendCloseOutEvent(
        jobId,
        "merge close-out: worktree conservado (cambios locales sin commitear)",
        { cleaned: false, reason: "dirty" },
      );
      return { ok: false, removed: false, skipped: "dirty" };
    }
    const removed = await removeIsolatedWorktree({ worktreePath, run });
    if (removed.ok) {
      appendCloseOutEvent(
        jobId,
        `merge close-out: worktree eliminado (${worktreePath})`,
        { cleaned: true, worktreePath },
      );
      return { ok: true, removed: true };
    }
    appendCloseOutEvent(
      jobId,
      `merge close-out: no se pudo eliminar el worktree (${removed.error.slice(0, 120)})`,
      { cleaned: false, reason: "remove-failed" },
    );
    return { ok: false, removed: false, skipped: "remove-failed" };
  } catch {
    return { ok: false, removed: false, skipped: "error" };
  }
}

function appendCloseOutEvent(
  jobId: string,
  message: string,
  meta: Record<string, unknown>,
): void {
  try {
    workItemStore.appendEvent(jobId, "system", message.slice(0, 300), {
      pr: { merged: true, ...meta },
    } as unknown as Record<string, unknown>);
  } catch {
    // best-effort
  }
}
