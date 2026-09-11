/**
 * verify/verifyService — FASE 2 E1: lecturas y encolado del dominio verify.
 *
 * Dueño E1 en FASE 2 (§2 de docs/MASTER-PLAN-MODULARIDAD.md): leer
 * `verify.json` por id (404 best-effort si no existe) y encolar el
 * reintento de verificación con dedupe de uno en vuelo por job.
 *
 * El trabajo pesado (re-correr la verificación y el disparo posterior) lo
 * aporta el caller por callback: este dominio jamás importa flujos ajenos
 * (reparto F2 §3, E2 es dueño de lo suyo) ni ningún otro módulo ajeno. Todo lo que toca disco es best-effort y nunca lanza.
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`; dedupe en un Set (una entrada
 *   por job en vuelo, se libera en finally); sin loops, sin polling, sin
 *   intervalos nuevos.
 * - C2 fail-safe: cada export con try/catch; ausente → 404 honesto.
 * - C3 un escritor: este módulo SOLO LEE verify.json (el escritor vive en
 *   implement/verifyEvidence).
 * - C4 disco best-effort: existsSync/readFileSync envueltos, nunca lanzan.
 * - C5 aditivo: códigos y textos idénticos a los handlers Ola 9 del server
 *   (el server delega acá; pacts y polling intactos).
 * - C6/C7: lectura validada vía el lector único de implement/verifyEvidence;
 *   guards con la misma semántica del server (404 sin job, 409 fuera de
 *   Triage — pacts nunca pisan Triage).
 * - C10 trazabilidad: cada función cita su bloque espejo del server.
 *
 * Lista blanca de imports (ver tests/import-sweep-domains-f2.test.ts):
 * workItemStore, implement/verifyEvidence, shared/types/implement (tipos),
 * node:fs/path. PROHIBIDO: todo el resto.
 */

import fs from "node:fs";
import path from "node:path";
import { workItemStore } from "../../workItem/workItemStore";
import { readVerifyJson, writeVerifyJsonAtomic } from "../../implement/verifyEvidence";
import type { VerificationReport } from "../../../shared/types/implement";

/** Entrada mínima de la tienda anterior para resolver el dir (muere en FASE 4). */
export interface VerifyLegacyInput {
  readonly id: string;
  readonly dir: string | null;
}

export type VerifyRetryGuardOk = { ok: true };
export type VerifyRetryGuardErr = { ok: false; code: 404 | 409; error: string };
export type VerifyRetryGuard = VerifyRetryGuardOk | VerifyRetryGuardErr;

/**
 * Guards puros de POST .../review/verify-retry (misma semántica del server:
 * 404 si no existe el job, 409 si status !== "Triage"). Nunca lanza.
 */
export function checkVerifyRetryGuards(
  job: { status?: unknown } | null | undefined,
  idForMsg = "",
): VerifyRetryGuard {
  try {
    const suffix = idForMsg ? `: ${idForMsg}` : "";
    if (!job) {
      return { ok: false, code: 404, error: `job not found${suffix}` };
    }
    const status = typeof job.status === "string" ? job.status : "";
    if (status !== "Triage") {
      return { ok: false, code: 409, error: `job not in Triage (status=${status || "?"})` };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 409, error: "verify-retry failed" };
  }
}

/** Compat anterior válida y con el mismo id (si no, se ignora: honesto). */
function matchLegacy(
  legacy: VerifyLegacyInput | undefined,
  id: string,
): VerifyLegacyInput | undefined {
  try {
    if (!legacy || legacy.id !== id) return undefined;
    return legacy;
  } catch {
    return undefined;
  }
}

export type VerifyReadOk = { ok: true; payload: Record<string, unknown> };
export type VerifyReadErr = { ok: false; code: 404 | 500; error: string; hint?: string };

/**
 * Lee verify.json por id (espejo del handler GET .../verify del server:
 * mismos 404 con hint y mismos 500). Nunca lanza.
 */
export function readVerifyById(
  id: unknown,
  opts?: { legacy?: VerifyLegacyInput | undefined },
): VerifyReadOk | VerifyReadErr {
  const NOT_FOUND_HINT = "sin verify.json todavía (re-verificación no corrida o writer pendiente)";
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    let wi: { dir?: string | null } | undefined;
    try {
      wi = workItemStore.get(id);
    } catch {
      wi = undefined;
    }
    const prev = matchLegacy(opts?.legacy, id);
    if (!wi && !prev) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const dir = wi?.dir ?? prev?.dir ?? null;
    if (typeof dir !== "string" || dir.length === 0) {
      return { ok: false, code: 404, error: "verify not found", hint: "job sin directorio todavía" };
    }
    const verifyPath = path.join(dir, "verify.json");
    let exists = false;
    try {
      exists = fs.existsSync(verifyPath);
    } catch {
      exists = false;
    }
    if (!exists) {
      return { ok: false, code: 404, error: "verify not found", hint: NOT_FOUND_HINT };
    }
    let payload: { workItemId: string; verification: VerificationReport } | null = null;
    try {
      const read = readVerifyJson(dir) as unknown as {
        workItemId: string;
        verification: VerificationReport;
      } | null;
      payload = read;
    } catch (e) {
      return { ok: false, code: 500, error: `failed to read verify.json: ${String(e).slice(0, 120)}` };
    }
    if (!payload) {
      let stillExists = false;
      try {
        stillExists = fs.existsSync(verifyPath);
      } catch {
        stillExists = false;
      }
      if (!stillExists) {
        return { ok: false, code: 404, error: "verify not found", hint: NOT_FOUND_HINT };
      }
      return { ok: false, code: 500, error: "verify.json inválido" };
    }
    return { ok: true, payload: payload as unknown as Record<string, unknown> };
  } catch (e) {
    return { ok: false, code: 500, error: `failed to read verify.json: ${String(e).slice(0, 120)}` };
  }
}

/** Jobs con re-verificación en curso (dedupe: uno en vuelo por job, cota C1). */
const retryInFlight = new Set<string>();

function releaseRetry(id: string): void {
  try {
    retryInFlight.delete(id);
  } catch {
    // noop
  }
}

/** True si el job tiene un reintento en vuelo (dedupe observable, tests). */
export function isVerifyRetryInFlight(id: unknown): boolean {
  try {
    return typeof id === "string" && retryInFlight.has(id);
  } catch {
    return false;
  }
}

/** Limpia el registro de vuelo (SOLO tests). */
export function resetVerifyRetryForTests(): void {
  try {
    retryInFlight.clear();
  } catch {
    // noop
  }
}

/** Trabajo pesado aportado por el caller (vive en el server, dominio ajeno acá). */
export type VerifyRetryRun = (id: string) => unknown | Promise<unknown>;

/** Planificador del disparo en background (default: setImmediate, como hoy). */
export type VerifyRetrySchedule = (fn: () => void) => unknown;

/**
 * Encola el reintento con dedupe (espejo del worker Ola 9 del server):
 * si ya hay uno en vuelo para el job, NO lanza otro (retorna false) pero
 * tampoco falla — el 200 HTTP lo decide el caller con `requestVerifyRetry`.
 * Ante `run` inválido o fallo del planificador, retorna false. Nunca lanza.
 */
export function scheduleVerifyRetryRun(
  id: string,
  run: VerifyRetryRun,
  schedule?: VerifyRetrySchedule,
): boolean {
  try {
    if (typeof id !== "string" || id.length === 0) return false;
    if (typeof run !== "function") return false;
    if (retryInFlight.has(id)) return false;
    retryInFlight.add(id);
    const sched: VerifyRetrySchedule =
      typeof schedule === "function" ? schedule : (fn) => setImmediate(fn);
    const invoke = (): void => {
      let out: unknown = null;
      try {
        out = run(id);
      } catch {
        releaseRetry(id);
        return;
      }
      try {
        if (out !== null && typeof out === "object" && typeof (out as Promise<unknown>).then === "function") {
          (out as Promise<unknown>).then(
            () => releaseRetry(id),
            () => releaseRetry(id),
          );
        } else {
          releaseRetry(id);
        }
      } catch {
        releaseRetry(id);
      }
    };
    try {
      sched(invoke);
    } catch {
      releaseRetry(id);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export type RequestVerifyRetryOk = { ok: true; id: string; status: "Triage" };
export type RequestVerifyRetryErr = { ok: false; code: 404 | 409; error: string };

/**
 * Composición HTTP del reintento (espejo del handler POST
 * .../review/verify-retry): guards 404/409, `onAccepted` (el caller anota el
 * pedido donde ya lo hace hoy) y encolado con dedupe. Responde la MISMA
 * forma `{ok:true, id, status:"Triage"}` (sin campos extra). Nunca lanza.
 */
export function requestVerifyRetry(
  id: unknown,
  opts?: {
    run?: VerifyRetryRun;
    schedule?: VerifyRetrySchedule;
    onAccepted?: (id: string) => void;
  },
): RequestVerifyRetryOk | RequestVerifyRetryErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    let wi: { status?: unknown } | undefined;
    try {
      wi = workItemStore.get(id);
    } catch {
      wi = undefined;
    }
    const guard = checkVerifyRetryGuards(wi ?? null, id);
    if (!guard.ok) return guard;
    try {
      opts?.onAccepted?.(id);
    } catch {
      // el aviso nunca rompe el 200 (best-effort, como hoy)
    }
    try {
      if (typeof opts?.run === "function") {
        scheduleVerifyRetryRun(id, opts.run, opts?.schedule);
      }
    } catch {
      // encolar nunca rompe el 200 (el worker se reintentará por UI)
    }
    return { ok: true, id, status: "Triage" };
  } catch {
    return { ok: false, code: 409, error: "verify-retry failed" };
  }
}

/** Jobs con el worker pesado en curso (dedupe propio del worker, cota C1). */
const workerInFlight = new Set<string>();

/** True si el worker pesado está en curso para el job (observable, tests). */
export function isVerifyWorkerInFlight(id: unknown): boolean {
  try {
    return typeof id === "string" && workerInFlight.has(id);
  } catch {
    return false;
  }
}

/** Limpia el registro del worker (SOLO tests). */
export function resetVerifyWorkerForTests(): void {
  try {
    workerInFlight.clear();
  } catch {
    // noop
  }
}

/** Callbacks del cascarón para efectos laterales (el dominio no importa al cascarón). */
export interface VerifyWorkerOpts {
  readonly log?: (id: string, line: string) => void;
  readonly onNoted?: (id: string, message: string) => void;
  readonly onPassReview?: (id: string) => void;
}

/**
 * Worker pesado del verify-retry (TANDA 2, espejo del bloque verify-retry
 * del cascarón, ~184 líneas, con reconcile H-013 intacto).
 * - Lee createdFiles previos desde result.json crudo (tolerante, tope 50).
 * - Corre la verificación del implement sobre el worktree (inyectable vía
 *   importación dinámica; ante fallo usa reporte fail honesto).
 * - H-013: reconcilia escrituras tardías contra disco ANTES de persistir
 *   (prev + pedidas existentes en disco, filtrado en el punto único).
 *   Sin late-write es idéntico al comportamiento anterior.
 * - Escribe result.json vía la tienda única + verify.json (best-effort).
 * - overall=pass → Triage→Review + nota `reconciledLateFiles` si hubo
 *   tardías + aviso al caller para el disparo posterior existente.
 * - overall=fail (o error del corredor) → queda en Triage con evento +
 *   verificación en meta (nota tardía incluida si aplica).
 * Dedupe propio uno-en-vuelo (no interfiere con el de encolado);
 * veredictos y topes intactos. Nunca lanza.
 */
export async function runVerifyRetryWorker(id: string, opts?: VerifyWorkerOpts): Promise<void> {
  if (typeof id !== "string" || id.length === 0) return;
  if (workerInFlight.has(id)) return;
  workerInFlight.add(id);
  try {
    const wi = (() => {
      try {
        return workItemStore.get(id);
      } catch {
        return undefined;
      }
    })();
    if (!wi || wi.status !== "Triage") return;
    const dir = (wi.dir as string | undefined) ?? null;
    if (!dir) {
      try {
        workItemStore.appendEvent(id, "runner", "verify-retry sin dir: no se puede re-verificar (queda en Triage)");
      } catch {
        // noop
      }
      return;
    }
    let prevCreatedFiles: string[] = [];
    try {
      const rawPrev = fs.readFileSync(path.join(dir, "result.json"), "utf-8");
      const parsedPrev = JSON.parse(rawPrev) as Record<string, unknown>;
      if (Array.isArray(parsedPrev.createdFiles)) {
        prevCreatedFiles = (parsedPrev.createdFiles as unknown[])
          .filter((x): x is string => typeof x === "string")
          .slice(0, 50);
      }
    } catch {
      // Sin result.json previo: se verifica igual con lista vacía.
    }
    const worktreePath = (() => {
      try {
        return path.resolve(wi.worktree);
      } catch {
        return wi.worktree;
      }
    })();
    let verification: VerificationReport;
    try {
      const mod = (await import("../../implement/verification")) as unknown as {
        verificationService: { run: (w: string, d: string, p: string, c: string[]) => Promise<VerificationReport> };
      };
      verification = await mod.verificationService.run(worktreePath, dir, wi.prompt, prevCreatedFiles);
    } catch (e) {
      const nowIso = new Date().toISOString();
      verification = {
        steps: [
          {
            name: "test",
            command: "pnpm test",
            exitCode: null,
            durationMs: 0,
            status: "fail",
            logSnippet: `verify-retry error: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`,
            logPath: "logs/build.log",
          },
        ],
        overall: "fail",
        startedAt: nowIso,
        finishedAt: nowIso,
        durationMs: 0,
      } as VerificationReport;
    }
    let retryCreatedFiles = prevCreatedFiles;
    let retryLateAdded: string[] = [];
    try {
      const store = (await import("../../workItem/resultStore")) as unknown as {
        resolveVerifyRetryCreatedFiles: (p: unknown, w: unknown, pr: unknown) => { kept: string[]; added: string[] };
        buildResultPayload: (p: Record<string, unknown>) => Record<string, unknown>;
        writeResult: (d: string, p: unknown) => void;
      };
      try {
        const resolved = store.resolveVerifyRetryCreatedFiles(prevCreatedFiles, worktreePath, wi.prompt);
        retryCreatedFiles = resolved.kept.slice(0, 50);
        retryLateAdded = resolved.added.slice(0, 50);
      } catch {
        retryCreatedFiles = prevCreatedFiles;
        retryLateAdded = [];
      }
      const payload = store.buildResultPayload({
        workItemId: id,
        ...(wi.modelRef ? { modelRef: wi.modelRef } : {}),
        worktreePath,
        verification,
        createdFiles: retryCreatedFiles,
      });
      store.writeResult(dir, payload);
      try {
        writeVerifyJsonAtomic(dir, { workItemId: id, verification, createdFiles: retryCreatedFiles });
      } catch (e) {
        try {
          console.warn(`[Factory] verify-retry write verify.json fail ${id}: ${String(e).slice(0, 120)}`);
        } catch {
          // noop
        }
      }
    } catch (e) {
      try {
        console.warn(`[Factory] verify-retry write result fail ${id}: ${String(e).slice(0, 120)}`);
      } catch {
        // noop
      }
    }
    if (verification.overall === "pass") {
      try {
        const moved = workItemStore.transitionWithVerification(
          id,
          "Review",
          verification,
          retryCreatedFiles,
          "verify-retry pass → Review (re-verificación desde Triage)",
        );
        void moved;
        try {
          if (retryLateAdded.length > 0) {
            workItemStore.appendEvent(
              id,
              "runner",
              `verify-retry: reconciliadas ${retryLateAdded.length} ruta(s) tardía(s) en disco (H-013): ${retryLateAdded.slice(0, 5).join(", ").slice(0, 200)}`,
              {
                reconciledLateFiles: retryLateAdded.slice(0, 10),
              } as unknown as Record<string, unknown>,
            );
          }
        } catch {
          // noop
        }
        try {
          fs.unlinkSync(path.join(dir, ".done"));
        } catch {
          // noop
        }
        try {
          opts?.log?.(id, `[${new Date().toISOString()}] verify-retry: verification pass → Review (await review)`);
        } catch {
          // noop
        }
        try {
          opts?.onNoted?.(id, `[Verify] ${id} → Review (verify-retry pass)`);
        } catch {
          // noop
        }
        try {
          opts?.onPassReview?.(id);
        } catch (e) {
          try {
            console.warn(`[Factory] verify-retry review trigger fail ${id}: ${String(e).slice(0, 120)}`);
          } catch {
            // noop
          }
        }
      } catch (e) {
        try {
          console.warn(`[Factory] verify-retry Triage→Review fail ${id}: ${String(e).slice(0, 120)}`);
        } catch {
          // noop
        }
      }
    } else {
      try {
        const failMsg =
          retryLateAdded.length > 0
            ? `verify-retry fail: queda en Triage (reconciliadas ${retryLateAdded.length} tardía(s) en disco: ${retryLateAdded.slice(0, 3).join(", ").slice(0, 120)})`
            : "verify-retry fail: queda en Triage";
        workItemStore.appendEvent(id, "runner", failMsg, {
          verification,
          createdFiles: retryCreatedFiles,
          runnerId: "linux-build",
          ...(retryLateAdded.length > 0
            ? { reconciledLateFiles: retryLateAdded.slice(0, 10) }
            : {}),
        } as unknown as Record<string, unknown>);
      } catch {
        // noop
      }
      try {
        opts?.log?.(id, `[${new Date().toISOString()}] verify-retry: verification fail → Triage`);
      } catch {
        // noop
      }
    }
  } finally {
    try {
      workerInFlight.delete(id);
    } catch {
      // noop
    }
  }
}
