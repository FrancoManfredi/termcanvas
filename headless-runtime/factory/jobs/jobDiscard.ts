/**
 * jobs/jobDiscard — NO RETOMAR TRABAJO (flujo simple, sin reintentos).
 *
 * POST /factory/jobs/:id/discard (+ alias): teardown completo del job
 * parado para que el issue vuelva a pendientes (sin PR abierto, sin rama,
 * sin worktree, sin job, la derivación N1/C1 no tiene de qué agarrarse):
 * 1. cierra el PR abierto (`gh pr close`, sin mergear),
 * 2. borra el worktree aislado (`git worktree remove --force` + prune),
 * 3. borra la rama (remota + local; la base nunca se toca),
 * 4. revierte archivos sueltos del worktree (untracked → se borran;
 *    tracked modificados → `git checkout --`),
 * 5. borra el job COMPLETO (memoria + dir `.agents/factory/<id>` + índice
 *    + sessions; sin job.json no hay restore),
 * 6. devuelve resumen honesto por pasos (cada fallo → `skipped` con motivo).
 *
 * Flujo simple: UNA llamada async, sin reintentos ni loops (iteración
 * estructural con forEach sobre listados finitos). Nunca lanza: 404/409
 * honestos. Solo actúa dentro del worktree/repo efectivo y fuera de
 * prefijos excluidos (.git, node_modules, .agents, dist*, logs).
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { workItemStore } from "../../workItem/workItemStore";
import {
  effectiveWorktreeFor,
  readIsolationFromTimeline,
  readPrFromTimeline,
  type IsolationRecordLike,
} from "../isolation/isolationStore";
import { removeJobDirFromIndex } from "../../workItem/workItemDisk";
import { removeAgentSessionsForJob } from "../../sessions/agentSessions";
import {
  closePrForJob,
  type GhExecRun,
} from "../isolation/gitHubPr";
import { removeIsolatedWorktree } from "../isolation/gitWorktree";
import type { WorkItem } from "../../../shared/types/workItem";

/** Prefijos nunca tocados dentro del worktree (ruido de build/deps/estado). */
const DISCARD_EXCLUDED_PREFIXES = [
  ".git/",
  "node_modules/",
  ".agents/",
  "dist/",
  "dist-electron/",
  "dist-cli/",
  "dist-headless/",
  "logs/",
] as const;

const execFileAsync = promisify(execFile);

/** Spawn real (argv sin shell, timeout explícito). Nunca lanza. */
async function defaultRun(
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const out = await execFileAsync(cmd, [...args], {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      stdout: typeof out.stdout === "string" ? out.stdout : String(out.stdout),
      stderr: typeof out.stderr === "string" ? out.stderr : String(out.stderr),
    };
  } catch (e) {
    const err = e as { stdout?: unknown; stderr?: unknown; message?: unknown };
    if (typeof err?.stdout === "string" || typeof err?.stderr === "string") {
      return {
        stdout: typeof err.stdout === "string" ? err.stdout : "",
        stderr:
          typeof err.stderr === "string"
            ? err.stderr
            : e instanceof Error
              ? e.message
              : String(e),
      };
    }
    throw e;
  }
}

export interface JobDiscardSeams {
  run?: GhExecRun;
}

function isDiscardExcluded(rel: string): boolean {
  const norm = rel.replace(/\\/g, "/");
  if (norm.startsWith(".git") || norm === ".git") return true;
  return DISCARD_EXCLUDED_PREFIXES.some((p) => norm.startsWith(p));
}

/** Rutas candidatas: top-level del item + metas del timeline (dedupe, cap 50). */
function collectCandidateFiles(item: WorkItem): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown): void => {
    if (typeof v !== "string" || v.length === 0 || v.length > 512) return;
    const norm = v.replace(/\\/g, "/").replace(/^\/+/, "");
    if (norm.length === 0 || seen.has(norm)) return;
    seen.add(norm);
    if (out.length < 50) out.push(norm);
  };
  try {
    (Array.isArray(item.createdFiles) ? item.createdFiles : []).forEach(push);
  } catch {
    // sin top-level: sigue al timeline
  }
  try {
    (Array.isArray(item.timeline) ? item.timeline : []).forEach((e) => {
      try {
        const meta = (e as { meta?: unknown }).meta as Record<string, unknown> | undefined;
        const list = meta?.createdFiles;
        (Array.isArray(list) ? list : []).forEach(push);
      } catch {
        // una meta rota nunca frena a las demás
      }
    });
  } catch {
    // sin timeline: solo top-level
  }
  return out;
}

async function tryRun(
  run: GhExecRun,
  cmd: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string }> {
  try {
    const out = await run(cmd, args, { cwd, timeoutMs });
    return { ok: true, stdout: typeof out.stdout === "string" ? out.stdout : "" };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export interface JobDiscardSummary {
  deleted: string[];
  restored: string[];
  skipped: string[];
  prClosed: string[];
  branchDeleted: string[];
  worktreeRemoved: string[];
  jobDeleted: boolean;
}

export type JobDiscardOk = {
  ok: true;
  id: string;
  state: string;
  status: string;
  cleaned: JobDiscardSummary;
};
export type JobDiscardErr = { ok: false; code: 404 | 409 | 500; error: string };

/**
 * Teardown completo del job parado. Guards: 404 ausente; 409 SOLO si está
 * en curso (lock de Building y estado NO terminal). Los estados terminales
 * (Cancelled/Complete) SIEMPRE se descartan: antes Cancelled devolvía 409
 * "job already discarded" y el job quedaba para siempre en el store
 * (resucitaba en cada restore y no había forma de borrarlo desde la UI).
 * Un terminal nunca está "en curso" (una cancelación puede dejar el lock
 * unos ms). El doble-discard no necesita guard: el job se borra, el
 * segundo intento da 404. Nunca lanza.
 */
export async function requestJobDiscard(
  id: unknown,
  seams?: JobDiscardSeams,
): Promise<JobDiscardOk | JobDiscardErr> {
  const run: GhExecRun = seams?.run ?? defaultRun;
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = workItemStore.get(id);
    if (!wi) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const terminal = wi.status === "Cancelled" || wi.status === "Complete";
    if (!terminal) {
      try {
        if (workItemStore.isBuildingLocked(id)) {
          return { ok: false, code: 409, error: "job en curso: no se puede descartar mientras corre" };
        }
      } catch {
        // ante duda se sigue (los guards de abajo frenan igual si cambió)
      }
    }

    const cleaned: JobDiscardSummary = {
      deleted: [],
      restored: [],
      skipped: [],
      prClosed: [],
      branchDeleted: [],
      worktreeRemoved: [],
      jobDeleted: false,
    };
    const isolation: IsolationRecordLike | null = (() => {
      try {
        const mem = (wi as { isolation?: unknown }).isolation;
        if (
          mem !== null &&
          typeof mem === "object" &&
          !Array.isArray(mem) &&
          typeof (mem as Record<string, unknown>).branch === "string"
        ) {
          return mem as IsolationRecordLike;
        }
        return readIsolationFromTimeline(wi.timeline);
      } catch {
        return null;
      }
    })();
    const repoRoot = (() => {
      try {
        if (isolation && typeof isolation.repoRoot === "string" && isolation.repoRoot.length > 0) {
          return path.resolve(isolation.repoRoot);
        }
        return path.resolve(effectiveWorktreeFor(wi));
      } catch {
        return "";
      }
    })();

    // 1. Cierra el PR abierto (sin mergear). Sin PR registrado → se busca
    // por rama; sin rama tampoco → skipped honesto (nada para cerrar).
    try {
      const pr = (() => {
        try {
          return readPrFromTimeline(wi.timeline);
        } catch {
          return null;
        }
      })();
      const branch =
        isolation && typeof isolation.branch === "string" && isolation.branch.length > 0
          ? isolation.branch
          : "";
      if (!pr?.prNumber && branch === "") {
        cleaned.skipped.push("(PR: sin número ni rama, nada para cerrar)");
      } else {
        const closed = await closePrForJob({
          repoPath: repoRoot,
          ...(pr?.prNumber ? { prNumber: pr.prNumber } : {}),
          ...(branch !== "" ? { branch } : {}),
          run,
        }).catch(() => null);
        if (closed === null) {
          cleaned.skipped.push("(PR: fallo inesperado al cerrar)");
        } else if (!closed.ok) {
          cleaned.skipped.push(`(PR: ${closed.error.slice(0, 120)})`);
        } else if (closed.closed) {
          cleaned.prClosed.push(
            typeof closed.prNumber === "number" ? `PR #${closed.prNumber}` : branch !== "" ? branch : "PR",
          );
        } else {
          cleaned.skipped.push(`(PR: ${closed.reason})`);
        }
      }
    } catch {
      cleaned.skipped.push("(PR: error inesperado)");
    }

    // 2. Borra el worktree aislado (carpeta; la rama se borra en el paso 3).
    try {
      const wtPath =
        isolation && typeof isolation.worktreePath === "string" && isolation.worktreePath.length > 0
          ? isolation.worktreePath
          : "";
      if (wtPath === "") {
        cleaned.skipped.push("(worktree: sin path registrado, nada para borrar)");
      } else {
        const removed = await removeIsolatedWorktree({ worktreePath: wtPath, force: true, run }).catch(() => null);
        if (removed !== null && removed.ok) {
          cleaned.worktreeRemoved.push(wtPath);
        } else {
          cleaned.skipped.push(`(worktree: ${removed === null ? "fallo inesperado" : removed.error.slice(0, 120)})`);
        }
      }
    } catch {
      cleaned.skipped.push("(worktree: error inesperado)");
    }

    // 3. Borra la rama (remota + local). La base nunca se toca.
    try {
      const branch =
        isolation && typeof isolation.branch === "string" && isolation.branch.length > 0
          ? isolation.branch
          : "";
      const base =
        isolation && typeof isolation.baseBranch === "string" ? isolation.baseBranch : "";
      if (branch === "") {
        cleaned.skipped.push("(rama: sin nombre registrado, nada para borrar)");
      } else if (base !== "" && branch === base) {
        cleaned.skipped.push(`(rama: ${branch} es la base, no se toca)`);
      } else if (repoRoot === "") {
        cleaned.skipped.push(`(rama: sin repo, no se toca ${branch})`);
      } else {
        const pushDel = await tryRun(run, "git", ["push", "origin", "--delete", branch], repoRoot, 30000);
        const localDel = await tryRun(run, "git", ["branch", "-D", branch], repoRoot, 15000);
        if (pushDel.ok || localDel.ok) {
          cleaned.branchDeleted.push(branch);
        } else {
          cleaned.skipped.push(`(rama: no se pudo borrar ${branch})`);
        }
      }
    } catch {
      cleaned.skipped.push("(rama: error inesperado)");
    }

    // 4. Revierte archivos sueltos del worktree efectivo.
    try {
      const worktree = path.resolve(effectiveWorktreeFor(wi));
      const candidates = collectCandidateFiles(wi);
      const insideRepo = repoRoot !== "";
      const untracked = new Set<string>();
      if (insideRepo) {
        const listed = await tryRun(run, "git", ["ls-files", "--others", "--exclude-standard"], repoRoot, 8000);
        if (listed.ok) {
          listed.stdout
            .split("\n")
            .map((l) => l.trim().replace(/\\/g, "/"))
            .filter((l) => l.length > 0)
            .slice(0, 2000)
            .forEach((l) => {
              untracked.add(l);
            });
        }
      }
      await Promise.all(
        candidates.map(async (rel) => {
          try {
            if (isDiscardExcluded(rel)) {
              cleaned.skipped.push(`${rel} (excluido)`);
              return;
            }
            const full = path.resolve(worktree, rel);
            const inside =
              full === worktree || full.startsWith(worktree + path.sep);
            if (!inside) {
              cleaned.skipped.push(`${rel} (fuera del worktree)`);
              return;
            }
            let stat: fs.Stats | null = null;
            try {
              stat = fs.statSync(full);
            } catch {
              stat = null;
            }
            if (stat === null) {
              cleaned.skipped.push(`${rel} (ya no existe)`);
              return;
            }
            if (stat.isDirectory()) {
              cleaned.skipped.push(`${rel} (es directorio: no se borra)`);
              return;
            }
            if (!insideRepo) {
              cleaned.skipped.push(`${rel} (sin repo: no se toca)`);
              return;
            }
            // Relativo al repo para los comandos git.
            const relToRepo = path.relative(repoRoot, full).replace(/\\/g, "/");
            if (relToRepo.startsWith("..") || path.isAbsolute(relToRepo)) {
              cleaned.skipped.push(`${rel} (fuera del repo)`);
              return;
            }
            // Untracked creado por el job → se borra. Tracked (modificado
            // o dudoso) → se revierte a HEAD, nunca se borra.
            if (untracked.has(relToRepo)) {
              try {
                fs.rmSync(full, { force: true });
                cleaned.deleted.push(rel);
                pruneEmptyParents(worktree, full, cleaned);
              } catch {
                cleaned.skipped.push(`${rel} (no se pudo borrar)`);
              }
              return;
            }
            const reverted = await tryRun(run, "git", ["checkout", "--", relToRepo], repoRoot, 8000);
            if (reverted.ok) cleaned.restored.push(rel);
            else cleaned.skipped.push(`${rel} (checkout falló)`);
          } catch {
            cleaned.skipped.push(`${rel} (error inesperado)`);
          }
        }),
      );
    } catch {
      // limpieza de archivos best-effort: el borrado del job igual sigue
    }

    // 5. Borra el job COMPLETO (dir + índice + sessions + memoria, en
    // ese orden). La verificación usa `has()` — NUNCA `get()`, que
    // rehidrataría desde disco si el rm falló y el job volvería a la
    // lista (bug: había que clickear varias veces). El rm lleva reintentos
    // acotados del propio fs (locks transitorios de Windows).
    try {
      const dir = (() => {
        try {
          const d = wi.dir ?? null;
          return typeof d === "string" && d.length > 0 ? d : "";
        } catch {
          return "";
        }
      })();
      if (dir !== "") {
        try {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
          // dir best-effort
        }
      }
      try {
        removeJobDirFromIndex(id);
      } catch {
        // índice best-effort
      }
      try {
        removeAgentSessionsForJob(id);
      } catch {
        // sessions best-effort
      }
      try {
        workItemStore.delete(id);
      } catch {
        // memoria best-effort
      }
      try {
        workItemStore.releaseBuildingLock(id);
      } catch {
        // locks best-effort
      }
      try {
        workItemStore.releaseReviewLock(id);
      } catch {
        // locks best-effort
      }
      cleaned.jobDeleted = !workItemStore.has(id) && (dir === "" || !fs.existsSync(dir));
    } catch {
      cleaned.jobDeleted = false;
    }

    // El job ya no existe: estado legacy "error" (igual que Cancelled).
    return { ok: true, id, state: "error", status: "Discarded", cleaned };
  } catch (e) {
    return { ok: false, code: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Poda best-effort de padres recién vaciados (solo dentro del worktree). */
function pruneEmptyParents(worktree: string, deletedFile: string, cleaned: JobDiscardSummary): void {
  try {
    const parts = path
      .dirname(path.relative(worktree, deletedFile))
      .split(path.sep)
      .filter((p) => p.length > 0 && p !== "." && p !== "..");
    const chain: string[] = [];
    parts.forEach((_, i) => {
      chain.push(path.join(worktree, ...parts.slice(0, i + 1)));
    });
    chain
      .reverse()
      .slice(0, 10)
      .forEach((d) => {
        try {
          if (fs.existsSync(d) && fs.readdirSync(d).length === 0) {
            fs.rmdirSync(d);
            cleaned.deleted.push(`${path.relative(worktree, d).replace(/\\/g, "/")}/ (dir vacío)`);
          }
        } catch {
          // no vacío o con error: se deja como está
        }
      });
  } catch {
    // poda best-effort
  }
}
