/**
 * triageSpec/triageSpecService — FASE 2 E2: guards, validación, transiciones
 * y extras del dominio triageSpec.
 *
 * Dueño E2 en FASE 2 (§2+§3 de docs/MASTER-PLAN-MODULARIDAD.md): responde
 * triage humano (validación del cuerpo `{answers}` + transición
 * Triage→Foreman sin estados nuevos), aprueba spec humana (transición
 * Triage→Foreman; el re-disparo del foreman lo agenda el server, como hoy) y
 * calcula los extras triage/spec para la vista (mudados desde el server sin
 * cambiar la firma que E1 congeló: `(timeline, status) → extras`).
 * Todo best-effort que nunca lanza hacia el flujo principal: ausente → 404
 * honesto, transición inválida → 409 honesto. Sin HTTP acá.
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`; sin loops escritos ni timers
 *   (la validación del cuerpo usa map/filter/slice con terminación
 *   estructural sobre el arreglo del body; el re-disparo lo agenda el
 *   caller). Sin polling ni intervalos nuevos.
 * - C2 puras fail-safe donde toca validación: try/catch + 404/409/400
 *   honestos; ante fallo el job NO transiciona (fail-closed).
 * - C3 un escritor: las transiciones usan la tienda única (workItemStore);
 *   jamás escribe job.json, result.json ni verify.json.
 * - C4 disco best-effort: este módulo no toca disco (la tienda persiste).
 * - C5 aditivo: códigos, textos y mensajes de timeline idénticos a los
 *   helpers actuales del server (el server delega acá; pacts F01–F14,
 *   polling y transiciones permitidas intactos: Triage→Foreman ya existía).
 * - C6/C7 vocabulario único, nada duplicado: guards de approve y lecturas
 *   de triage/spec delegan en triageFlow/specFlow (implementación única);
 *   el cálculo de extras es EL cálculo (el server delega, no duplica).
 * - C10 trazabilidad: cada función cita su bloque espejo del server.
 *
 * Lista blanca de imports (ver tests/import-sweep-domains-f2e2.test.ts):
 * workItemStore (tienda), jobView SOLO tipo (vista), triageFlow (flujo),
 * specFlow (flujo). PROHIBIDO: todo el resto (incluidos review, medida,
 * avisos, definición, ejecutores y yaml).
 */

import { workItemStore } from "../../workItem/workItemStore";
import type { JobViewExtras } from "../../workItem/jobView";
import { getLatestTriage } from "../../triage/triageFlow";
import {
  checkSpecApproveGuards as checkSpecApproveGuardsFlow,
  getLatestSpec,
  hasPendingSpecApproval,
} from "../../spec/specFlow";

/** Vista del timeline que aportan los callers para el cálculo de extras. */
type TriageSpecTimeline = Parameters<typeof getLatestTriage>[0];

/**
 * Cálculo de extras triage/spec para la vista (mudado literal desde
 * `triageSpecExtras` del server: misma firma `(timeline, status)`, misma
 * semántica desde la meta del timeline sin tocar schemas). El caller lo
 * inyecta como `extrasFor` en jobs/jobService (contrato congelado por E1).
 * Nunca lanza (ante fallo, `{}` honesto).
 */
export function triageSpecExtras(timeline: unknown, status: unknown): JobViewExtras {
  try {
    // Perf (lista 2.5s): los extras triage/spec solo tienen lectores en jobs
    // ACTIVOS (gates H1/H2 del panel exigen job activo; las UIs de
    // FactoryLab leen la meta del timeline directo). En terminales se
    // devuelve `{}` sin escanear el timeline: con 300+ Complete por request
    // el scan era la mayor parte del costo de serializar la lista.
    if (status === "Complete" || status === "Cancelled") return {};
    const out: JobViewExtras = {};
    // Sin importar tipos ajenos (reparto F2 §3): el arreglo se estrecha acá
    // y se entrega por compatibilidad estructural (los flujos validan igual).
    const probe = {
      timeline: Array.isArray(timeline) ? timeline : [],
    } as TriageSpecTimeline;
    const triage = getLatestTriage(probe);
    if (triage) out.triage = triage;
    const spec = getLatestSpec(probe as Parameters<typeof getLatestSpec>[0]);
    if (spec) out.spec = spec;
    if (status === "Triage") {
      const approvalProbe = { status, timeline: probe?.timeline ?? [] } as Parameters<
        typeof hasPendingSpecApproval
      >[0];
      if (hasPendingSpecApproval(approvalProbe)) {
        out.specApprovalPending = true;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export type TriageRespondGuardOk = { ok: true };
export type TriageRespondGuardErr = { ok: false; code: 404 | 409; error: string };
export type TriageRespondGuard = TriageRespondGuardOk | TriageRespondGuardErr;

/**
 * Guards puros de POST .../triage/respond (misma semántica del server:
 * 404 si no existe el job, 409 si status !== "Triage"). Nunca lanza.
 */
export function checkTriageRespondGuards(
  job: { status?: unknown } | null | undefined,
  idForMsg = "",
): TriageRespondGuard {
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
    return { ok: false, code: 409, error: "triage respond failed" };
  }
}

export type TriageRespondBodyOk = { ok: true; answers: string[] };
export type TriageRespondBodyErr = { ok: false; error: string };
export type TriageRespondBody = TriageRespondBodyOk | TriageRespondBodyErr;

/**
 * Valida el body {answers:string[]} de POST .../triage/respond (misma
 * semántica del server: recorta a 500 por respuesta, topa en 10 útiles,
 * espejo de `normalizeTriageAnswers` del renderer). Sin loops escritos:
 * map/filter/slice con terminación estructural. Nunca lanza.
 */
export function parseTriageRespondBody(body: unknown): TriageRespondBody {
  try {
    const rec =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    if (!rec || !Array.isArray(rec.answers)) {
      return { ok: false, error: "answers must be a non-empty array of strings" };
    }
    const cleaned = (rec.answers as unknown[])
      .map((item) => (typeof item === "string" ? item.trim().slice(0, 500) : ""))
      .filter((kept) => kept.length > 0)
      .slice(0, 10);
    if (cleaned.length === 0) {
      return { ok: false, error: "answers must be a non-empty array of strings" };
    }
    return { ok: true, answers: cleaned };
  } catch {
    return { ok: false, error: "answers must be a non-empty array of strings" };
  }
}

/**
 * Aplica la respuesta humana (misma semántica del server: evento `user` con
 * las respuestas trazadas en la meta `triageRespond` + transición
 * Triage→Foreman ya permitida, sin estados nuevos). Deja que la tienda
 * lance 404/409 con `.status` (el handler los mapea). NO re-dispara el
 * foreman: eso lo agenda el handler HTTP vía setImmediate (espejo
 * spec/approve); así esta función es testeable sin daemon ni LLM.
 */
export function applyTriageRespondTransition(id: string, answers: string[]) {
  const preview = answers.map((a, i) => `Q${i + 1}: ${a}`).join(" | ").slice(0, 500);
  workItemStore.appendEvent(id, "user", `triage respond (${answers.length} respuestas): ${preview}`, {
    triageRespond: { answers },
  } as unknown as Record<string, unknown>);
  return workItemStore.transition(
    id,
    "Foreman",
    "user",
    "triage respond: re-corre foreman con respuestas humanas",
    { triageRespond: { answers } } as unknown as Record<string, unknown>,
  );
}

export type SpecApproveGuard = ReturnType<typeof checkSpecApproveGuardsFlow>;
/**
 * Guards puros de POST .../spec/approve (delega en specFlow: 404 si no
 * existe el job, 409 si status !== "Triage" o si no hay pedido de
 * aprobación pendiente). Nunca lanza.
 */
export function checkSpecApproveGuards(
  job: { status?: unknown; timeline?: unknown } | null | undefined,
  idForMsg = "",
): SpecApproveGuard {
  try {
    return checkSpecApproveGuardsFlow(
      job as Parameters<typeof checkSpecApproveGuardsFlow>[0],
      idForMsg,
    );
  } catch {
    return { ok: false, code: 409, error: "spec approve failed" } as SpecApproveGuard;
  }
}

/**
 * Aplica la aprobación humana de spec (misma semántica del server: evento
 * `user` con el resumen trazado + transición Triage→Foreman ya permitida
 * para re-correr el foreman con contexto spec). Re-deriva los guards (la
 * misma función pura: ante carrera responde el mismo 404/409 con `.status`
 * para que el handler los mapee). NO re-dispara el foreman: eso lo agenda
 * el handler HTTP vía setImmediate con `skipTriageSpec` (la spec ya está
 * aprobada y trazada).
 */
export function applySpecApproveTransition(id: string) {
  const current = workItemStore.get(id) ?? null;
  const guard = checkSpecApproveGuards(
    current as unknown as { status?: unknown; timeline?: unknown } | null,
    id,
  );
  if (!guard.ok) {
    throw Object.assign(new Error(guard.error), { status: guard.code });
  }
  try {
    workItemStore.appendEvent(
      id,
      "user",
      `spec aprobada por humano — ${guard.specSummary.slice(0, 120)}`,
      { specApproved: true, specSummary: guard.specSummary } as unknown as Record<string, unknown>,
    );
  } catch {
    // el evento es trazado best-effort: la transición manda (como hoy)
  }
  return workItemStore.transition(
    id,
    "Foreman",
    "user",
    "spec aprobada: re-corre foreman con contexto spec",
  );
}

export type SpecRejectGuard = SpecApproveGuard;

export type SpecRejectBodyOk = { ok: true; feedback: string | null };
export type SpecRejectBodyErr = { ok: false; error: string };
export type SpecRejectBody = SpecRejectBodyOk | SpecRejectBodyErr;

/**
 * Guards puros de POST .../spec/reject (misma semántica que approve: 404 si
 * no existe el job, 409 si status !== "Triage" o si no hay pedido de
 * aprobación pendiente — rechazar sin pedido pendiente no tiene sentido).
 * Nunca lanza.
 */
export function checkSpecRejectGuards(
  job: { status?: unknown; timeline?: unknown } | null | undefined,
  idForMsg = "",
): SpecRejectGuard {
  try {
    return checkSpecApproveGuardsFlow(
      job as Parameters<typeof checkSpecApproveGuardsFlow>[0],
      idForMsg,
    );
  } catch {
    return { ok: false, code: 409, error: "spec reject failed" } as SpecRejectGuard;
  }
}

/**
 * Valida el body `{feedback?}` de POST .../spec/reject. `feedback` ausente o
 * vacío = rechazo sin motivo (válido); string no vacío se recorta a 500;
 * otro tipo = 400 honesto. Puro, nunca lanza.
 */
export function parseSpecRejectBody(body: unknown): SpecRejectBody {
  try {
    if (body === null || body === undefined) return { ok: true, feedback: null };
    if (typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, error: "body must be an object with optional feedback string" };
    }
    const rec = body as Record<string, unknown>;
    if (rec.feedback === undefined || rec.feedback === null) return { ok: true, feedback: null };
    if (typeof rec.feedback !== "string") {
      return { ok: false, error: "feedback must be a string" };
    }
    const clean = rec.feedback.trim().slice(0, 500);
    return { ok: true, feedback: clean.length > 0 ? clean : null };
  } catch {
    return { ok: false, error: "feedback must be a string" };
  }
}

/**
 * Aplica el rechazo humano de spec (evento `user` con el motivo trazado en
 * meta `specRejected` — invalida el pedido pendiente vía
 * getLatestSpecApprovalRequest — SIN transición: el job queda en Triage y el
 * re-run del spec agent lo agenda el handler HTTP vía setImmediate, espejo
 * spec/approve). Re-deriva los guards (misma función pura: ante carrera
 * responde el mismo 404/409 con `.status` para que el handler los mapee).
 */
export function applySpecRejectTransition(id: string, feedback: string | null) {
  const current = workItemStore.get(id) ?? null;
  const guard = checkSpecRejectGuards(
    current as unknown as { status?: unknown; timeline?: unknown } | null,
    id,
  );
  if (!guard.ok) {
    throw Object.assign(new Error(guard.error), { status: guard.code });
  }
  const summary = guard.specSummary;
  try {
    workItemStore.appendEvent(
      id,
      "user",
      `spec rechazada por humano — ${summary.slice(0, 120)}${feedback ? ` (motivo: ${feedback.slice(0, 200)})` : ""}`,
      { specRejected: true, specSummary: summary, ...(feedback ? { specRejectFeedback: feedback } : {}) } as unknown as Record<string, unknown>,
    );
  } catch {
    // el evento es trazado best-effort (como approve)
  }
  return current;
}
