/**
 * review/reviewActions — FASE 2 E2: lecturas y transiciones del dominio review.
 *
 * Dueño E2 en FASE 2 (§2+§3 de docs/MASTER-PLAN-MODULARIDAD.md): ver review
 * por id, ver raw por id (flag de presencia best-effort), aceptar igual
 * (Review→Complete con guardas de transición), reintentar a Building
 * (guarda de budget máximo 2) y reintentar solo review (sin re-correr
 * implement). Todo best-effort que nunca lanza ante ausente (404 honesto) ni
 * ante transición inválida (409 honesto). Sin HTTP acá: retorna uniones
 * discriminadas y el server mapea a status/body (formas intactas,
 * pacts F01–F14, polling intacto).
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`; sin loops ni timers nuevos (el
 *   re-disparo en background lo agenda el caller con `schedule` inyectado,
 *   por defecto setImmediate como hoy; este módulo jamás crea intervalos).
 * - C2 fail-safe: cada export con try/catch; ausente → 404 honesto,
 *   transición inválida → 409 honesto.
 * - C3 un escritor: las transiciones usan la tienda única (workItemStore);
 *   el único toque directo a disco es `.done` (marca de Complete, como hoy)
 *   y lecturas best-effort.
 * - C4 disco best-effort: existsSync/readFileSync envueltos, nunca lanzan.
 * - C5 aditivo: códigos, textos y mensajes de timeline idénticos a los
 *   handlers actuales (el server delega acá; veredictos intactos, sin budget
 *   de revisiones: el humano reintenta siempre).
 * - C6/C7: guards de reintento y nombre del raw reutilizados desde
 *   factory/reviewRaw.ts (sin duplicar); lectura validada vía el lector
 *   único reviewDisk.readReviewJson; conteo y veredictos desde
 *   shared/types/review.
 * - C10 trazabilidad: cada función cita su bloque espejo del server.
 *
 * Lista blanca de imports (ver tests/import-sweep-domains-f2e2.test.ts):
 * node:fs, node:path, workItemStore (tienda), reviewDisk (disco),
 * factory/reviewRaw (raw: guards + nombre de archivo), shared/types/review.
 * PROHIBIDO: los dominios vecinos triage y spec, medida, avisos,
 * definición, ejecutores y todo lo demás.
 */

import fs from "node:fs";
import path from "node:path";
import { isInfraReviewResult } from "../../../shared/types/review";
import { workItemStore } from "../../workItem/workItemStore";
import { readReviewJson } from "../../review/reviewDisk";
import { checkRetryReviewGuards, resolveReviewRawFileName } from "../reviewRaw";

/** Entrada mínima de la tienda anterior para resolver dir/status (muere en FASE 4). */
export interface ReviewLegacyInput {
  readonly id: string;
  readonly dir: string | null;
  readonly status?: unknown;
}

/** Lectura segura de la tienda única (undefined ante cualquier fallo). */
function safeGet(id: string): ReturnType<typeof workItemStore.get> {
  try {
    return workItemStore.get(id);
  } catch {
    return undefined;
  }
}

/** Compat anterior válida y con el mismo id (si no, se ignora: honesto). */
function matchLegacy(
  legacy: ReviewLegacyInput | undefined,
  id: string,
): ReviewLegacyInput | undefined {
  try {
    if (!legacy || legacy.id !== id) return undefined;
    return legacy;
  } catch {
    return undefined;
  }
}

/** Conteo de revisiones best-effort (ausente o corrupto → 0, como hoy con `?? 0`). */
function safeReviewCount(wi: { reviewCount?: unknown } | null | undefined): number {
  try {
    const count = wi?.reviewCount;
    return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0;
  } catch {
    return 0;
  }
}

export type ReviewReadOk = {
  ok: true;
  workItemId: string;
  status: string;
  reviewCount: number;
  lastReview: unknown;
  hasRaw: boolean;
};
export type ReviewReadErr = { ok: false; code: 404; error: string };

/**
 * Ver review por id (espejo del handler GET .../review del server: misma
 * forma `{workItemId, status, reviewCount, lastReview, hasRaw}`, mismo 404).
 * `lastReview` sale de la tienda y, si falta, del review.json validado en
 * disco (restore parcial); `hasRaw` es presencia best-effort del raw del
 * intento actual. Nunca lanza.
 */
export function getReviewById(
  id: unknown,
  opts?: { legacy?: ReviewLegacyInput | undefined },
): ReviewReadOk | ReviewReadErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    const prev = matchLegacy(opts?.legacy, id);
    if (!wi && !prev) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const reviewCount = safeReviewCount(
      wi as unknown as { reviewCount?: unknown } | undefined,
    );
    let lastReview: unknown = (
      wi as unknown as { lastReview?: unknown } | undefined
    )?.lastReview ?? null;
    if (!lastReview) {
      try {
        const dir = wi?.dir ?? prev?.dir ?? null;
        if (typeof dir === "string" && dir.length > 0) {
          lastReview = readReviewJson(dir);
        }
      } catch {
        lastReview = null;
      }
    }
    const status =
      typeof wi?.status === "string"
        ? wi.status
        : typeof prev?.status === "string"
          ? (prev.status as string)
          : "Intake";
    let hasRaw = false;
    try {
      const dirForRaw = wi?.dir ?? prev?.dir ?? null;
      if (typeof dirForRaw === "string" && dirForRaw.length > 0) {
        hasRaw = fs.existsSync(path.join(dirForRaw, resolveReviewRawFileName(reviewCount)));
      }
    } catch {
      hasRaw = false;
    }
    return { ok: true, workItemId: id, status, reviewCount, lastReview, hasRaw };
  } catch {
    return { ok: false, code: 404, error: `job not found: ${String(id).slice(0, 60)}` };
  }
}

export type ReviewRawReadOk = { ok: true; text: string };
export type ReviewRawReadErr = { ok: false; code: 404 | 500; error: string };

/**
 * Ver raw por id (espejo del handler GET .../review/raw del server: mismo
 * texto plano 200, mismos 404 con textos idénticos y mismo 500 de lectura).
 * Nunca lanza.
 */
export function readReviewRawById(
  id: unknown,
  opts?: { legacy?: ReviewLegacyInput | undefined },
): ReviewRawReadOk | ReviewRawReadErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    const prev = matchLegacy(opts?.legacy, id);
    if (!wi && !prev) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const dir = wi?.dir ?? prev?.dir ?? null;
    if (typeof dir !== "string" || dir.length === 0) {
      return { ok: false, code: 404, error: "review raw not found" };
    }
    const reviewCount = safeReviewCount(
      wi as unknown as { reviewCount?: unknown } | undefined,
    );
    const fileName = resolveReviewRawFileName(reviewCount);
    const targetPath = path.join(dir, fileName);
    let exists = false;
    try {
      exists = fs.existsSync(targetPath);
    } catch {
      exists = false;
    }
    if (!exists) {
      return { ok: false, code: 404, error: "review raw not found" };
    }
    try {
      return { ok: true, text: fs.readFileSync(targetPath, "utf-8") };
    } catch (e) {
      return { ok: false, code: 500, error: `failed to read ${fileName}: ${String(e).slice(0, 120)}` };
    }
  } catch (e) {
    return { ok: false, code: 500, error: `failed to read review raw: ${String(e).slice(0, 120)}` };
  }
}

export type ReviewAcceptOk = { ok: true; id: string; status: "Complete" };
export type ReviewAcceptErr = { ok: false; code: 404 | 409; error: string };

/**
 * Aceptar igual por id humano (espejo del handler POST .../review/accept:
 * guardas 404 sin job / 409 fuera de Review / 409 cuando el review nunca
 * corrió por fallo de infra (isInfraReviewResult: memoria + disco),
 * transición Review→Complete con
 * el mismo mensaje de timeline, escritura de `.done`, misma forma
 * `{ok:true, id, status:"Complete"}`). El aviso posterior (log + auto-score)
 * lo aporta el caller por `onAccepted` (vive en el server, dominio ajeno
 * acá). Nunca lanza.
 */
export function acceptReviewEqual(
  id: unknown,
  opts?: { onAccepted?: (id: string) => void },
): ReviewAcceptOk | ReviewAcceptErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    if (!wi) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    if (wi.status !== "Review") {
      return { ok: false, code: 409, error: `job not in Review (status=${wi.status})` };
    }
    // El review NUNCA corrió (fallo de infra/proveedor: rate limit, 5xx,
    // timeout...): aceptar igual completaría a ciegas sin ningún review
    // real. Se bloquea con 409 honesto y se indica el camino (reintentar
    // solo el review). Memoria primero, disco como restore parcial (igual
    // que getReviewById).
    try {
      let lastReview: unknown = null;
      try {
        lastReview = (wi as unknown as { lastReview?: unknown })?.lastReview ?? null;
      } catch {
        lastReview = null;
      }
      if (!lastReview) {
        try {
          const dir = (wi as unknown as { dir?: unknown })?.dir;
          if (typeof dir === "string" && dir.length > 0) {
            lastReview = readReviewJson(dir);
          }
        } catch {
          lastReview = null;
        }
      }
      if (isInfraReviewResult(lastReview)) {
        return {
          ok: false,
          code: 409,
          error:
            "review never ran (infra error): aceptar igual está bloqueado sin un review real — reintentá con POST .../review/retry-review y aceptá cuando haya veredicto",
        };
      }
    } catch {
      // ante cualquier duda se permite aceptar (fail-open como hoy)
    }
    try {
      const completed = workItemStore.transition(
        id,
        "Complete",
        "user",
        "humano acepta igual (POST /review/accept)",
      );
      try {
        const dir = completed.dir ?? null;
        if (typeof dir === "string" && dir.length > 0) {
          fs.mkdirSync(dir, { recursive: true });
          const donePath = path.join(dir, ".done");
          if (!fs.existsSync(donePath)) fs.writeFileSync(donePath, "", "utf-8");
        }
      } catch {
        // `.done` best-effort: la transición ya quedó persistida por la tienda
      }
      try {
        opts?.onAccepted?.(id);
      } catch {
        // el aviso nunca rompe el 200 (best-effort, como hoy)
      }
      return { ok: true, id, status: "Complete" };
    } catch (e) {
      const maybe = e as { status?: unknown; message?: unknown };
      const code = maybe?.status === 404 ? 404 : 409;
      const message = typeof maybe?.message === "string" ? maybe.message : "transition failed";
      return { ok: false, code, error: message };
    }
  } catch {
    return { ok: false, code: 409, error: "transition failed" };
  }
}

export type ReviewRetryOk = { ok: true; id: string; status: "Building" };
export type ReviewRetryErr = { ok: false; code: 404 | 409; error: string };

/**
 * Reintentar a Building por id humano (espejo del handler POST
 * .../review/retry: guardas 404 sin job / 409 fuera de Review, transición
 * Review→Building con el mismo mensaje de timeline, borrado best-effort de
 * `.done`, misma forma `{ok:true, id, status:"Building"}`). Sin budget
 * máximo (doctrina sin-límites): el humano reintenta siempre. El re-disparo
 * de implement lo agenda el caller (vive en el server). Nunca lanza.
 */
export function requestReviewRetryToBuilding(
  id: unknown,
  opts?: { onAccepted?: (id: string, count: number) => void },
): ReviewRetryOk | ReviewRetryErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    const count = safeReviewCount(
      (wi ?? null) as unknown as { reviewCount?: unknown } | null,
    );
    const guard = checkRetryReviewGuards(
      wi ? { status: wi.status, reviewCount: count } : null,
      id,
    );
    if (!guard.ok) return guard;
    try {
      const back = workItemStore.transition(
        id,
        "Building",
        "user",
        `humano reintenta (POST /review/retry, count=${count})`,
      );
      try {
        const dir = back.dir ?? null;
        if (typeof dir === "string" && dir.length > 0) {
          try {
            fs.unlinkSync(path.join(dir, ".done"));
          } catch {
            // sin `.done`: nada que limpiar (best-effort)
          }
        }
      } catch {
        // limpieza best-effort: la transición ya quedó persistida
      }
      try {
        opts?.onAccepted?.(id, count);
      } catch {
        // el aviso nunca rompe el 200 (best-effort, como hoy)
      }
      return { ok: true, id, status: "Building" };
    } catch (e) {
      const maybe = e as { status?: unknown; message?: unknown };
      const code = maybe?.status === 404 ? 404 : 409;
      const message = typeof maybe?.message === "string" ? maybe.message : "transition failed";
      return { ok: false, code, error: message };
    }
  } catch {
    return { ok: false, code: 409, error: "transition failed" };
  }
}

export type ReviewRetryOnlyOk = { ok: true; status: "Review" };
export type ReviewRetryOnlyErr = { ok: false; code: 404 | 409; error: string };

/** Trabajo pesado aportado por el caller (re-disparo solo-review, vive en el server). */
export type ReviewRetryOnlyRun = (id: string) => unknown | Promise<unknown>;

/** Planificador del disparo en background (default: setImmediate, como hoy). */
export type ReviewRetryOnlySchedule = (fn: () => void) => unknown;

/**
 * Reintentar SOLO review por id humano (espejo del handler POST
 * .../review/retry-review: guardas 404 sin job / 409 fuera de Review /
 * 409 con budget máximo, misma forma `{ok:true, status:"Review"}` sin
 * re-correr implement). El `run` (re-disparo solo de revisión vía import
 * dinámico aportado por el caller) y su agenda se inyectan; ante `run`
 * ausente solo se validan guardas. Nunca lanza.
 */
export function requestReviewRetryOnly(
  id: unknown,
  opts?: {
    run?: ReviewRetryOnlyRun;
    schedule?: ReviewRetryOnlySchedule;
    onAccepted?: (id: string, count: number) => void;
  },
): ReviewRetryOnlyOk | ReviewRetryOnlyErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    const count = safeReviewCount(
      (wi ?? null) as unknown as { reviewCount?: unknown } | null,
    );
    const guard = checkRetryReviewGuards(
      wi ? { status: wi.status, reviewCount: count } : null,
      id,
    );
    if (!guard.ok) return guard;
    try {
      opts?.onAccepted?.(id, count);
    } catch {
      // el aviso nunca rompe el 200 (best-effort, como hoy)
    }
    try {
      if (typeof opts?.run === "function") {
        const run = opts.run;
        const sched: ReviewRetryOnlySchedule =
          typeof opts?.schedule === "function" ? opts.schedule : (fn) => setImmediate(fn);
        const invoke = (): void => {
          let out: unknown = null;
          try {
            out = run(id);
          } catch {
            return;
          }
          try {
            if (out !== null && typeof out === "object" && typeof (out as Promise<unknown>).then === "function") {
              (out as Promise<unknown>).then(
                () => undefined,
                () => undefined,
              );
            }
          } catch {
            // encolado best-effort: el 200 ya está decidido
          }
        };
        try {
          sched(invoke);
        } catch {
          // encolar nunca rompe el 200 (el reintento se pide por UI)
        }
      }
    } catch {
      // encolar nunca rompe el 200
    }
    return { ok: true, status: "Review" };
  } catch {
    return { ok: false, code: 409, error: "retry-review failed" };
  }
}
