/**
 * jobs/jobService — FASE 2 E1: lecturas del dominio jobs (dueño del ciclo de
 * vida visible: lista con extras, detalle con extras+vista previa, logs,
 * eventos, resultado y build-log por id).
 *
 * Todo best-effort que nunca lanza ante ausente (404 honesto o null). Sin
 * HTTP acá: retorna uniones discriminadas y el server mapea a status/body
 * (formas intactas, pacts F01–F14, polling intacto).
 *
 * Reglas que honra (las 8 de los master plans + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero `require()`; sin loops nuevos (los `for`
 *   sobre tienda/compat heredan la cota del merge que ya existía en el
 *   server; el sort es el mismo de hoy).
 * - C2 puras fail-safe donde toca disco: try/catch + 404/500 honestos.
 * - C3 un escritor: este módulo no escribe archivos directo (fs solo lectura,
 *   como `readJobResult`/`readJobBuildLog`); la única mutación de ciclo de
 *   vida es `requestJobCancel` vía `workItemStore.transition` (tienda única,
 *   el mismo punto único que `create` en jobs/jobCreate; TANDA A).
 * - C4 disco best-effort: existsSync/readFileSync envueltos, nunca lanzan.
 * - C5 aditivo: formas idénticas a los handlers actuales (incluidos quirks
 *   compat: detalle trae `logs` sin `logsCount`; lista trae ambos; el
 *   `status` compat de la rama anterior se conserva literal).
 * - C6/C7: vista única vía jobView (toListItem/toDetail), lectura del
 *   resultado vía resultStore primero (rico validado) + crudo después
 *   (parcial honesto, jamás inventado); extras inyectados por el caller
 *   (este dominio NO importa flujos ajenos: nada de E2 acá).
 * - C10 trazabilidad: cada función cita su bloque espejo del server.
 *
 * Lista blanca de imports (ver tests/import-sweep-domains-f2.test.ts):
 * workItemStore + jobView + resultStore, shared/types/workItem, node:fs/path.
 * PROHIBIDO: todo lo ajeno al dominio (flujos humanos/automáticos de E2,
 * medida, avisos, validación de definición, ejecutores, yaml de runners).
 */

import fs from "node:fs";
import path from "node:path";
import { workItemStore } from "../../workItem/workItemStore";
import { toDetail, toListItem, toListSummary, type JobViewExtras } from "../../workItem/jobView";
import { readResult } from "../../workItem/resultStore";
import {
  mapStatusToLegacyState,
  needsResume,
  RESUMED_META_KEY,
  type WorkItem,
  type WorkItemStatus,
} from "../../../shared/types/workItem";

/** Entrada de la tienda anterior (Map legacy del server, muere en FASE 4). */
export interface JobLegacyInput {
  readonly id: string;
  readonly prompt: string;
  readonly worktree: string;
  readonly phase: string;
  readonly state: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly logs?: string[];
  readonly dir: string | null;
  readonly sessionId?: string;
  readonly dashboardUrl?: string;
  readonly directory?: string;
  readonly modelRef?: { providerID: string; modelID: string; variant?: string };
  readonly reviewerRef?: { providerID: string; modelID: string; variant?: string };
  readonly status?: string;
  readonly timeline?: WorkItem["timeline"];
  readonly cost?: WorkItem["cost"];
  readonly runnerId?: string;
  readonly dotDonePath?: string;
}

/** Calcula los extras de un item (el caller aporta el cálculo; acá solo se aplica). */
export type JobExtrasFor = (item: WorkItem) => JobViewExtras;

/** Lectura segura de la tienda única (undefined ante cualquier fallo). */
function safeGet(id: string): WorkItem | undefined {
  try {
    return workItemStore.get(id);
  } catch {
    return undefined;
  }
}

/** Extras best-effort: un cálculo que falla vale `{}` (nunca rompe la lista). */
function safeExtrasFor(extrasFor: JobExtrasFor | undefined, item: WorkItem): JobViewExtras {
  try {
    if (typeof extrasFor !== "function") return {};
    const out = extrasFor(item);
    return out !== null && typeof out === "object" ? (out as JobViewExtras) : {};
  } catch {
    return {};
  }
}

/** Compat anterior válido y con el mismo id (si no, se ignora: honesto). */
function matchLegacy(
  legacy: JobLegacyInput | undefined,
  id: string,
): JobLegacyInput | undefined {
  try {
    if (!legacy || legacy.id !== id) return undefined;
    return legacy;
  } catch {
    return undefined;
  }
}

/**
 * Rama compat de lista (movida literal desde `getAllJobsForList` del server,
 * incluido el quirk `status` anterior). No se unifica: la forma es contrato.
 */
function legacyListItem(job: JobLegacyInput): Record<string, unknown> {
  return {
    id: job.id,
    prompt: job.prompt,
    worktree: job.worktree,
    phase: job.phase,
    state: job.state,
    // Quirk congelado: anterior → mapeo de estado → "Intake" (nunca se toca).
    status: job.status ?? mapStatusToLegacyState(job.state as unknown as WorkItemStatus) ?? "Intake",
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    logsCount: (job.logs ?? []).length,
    logs: job.logs ?? [],
    dir: job.dir,
    dotDonePath: job.dotDonePath ?? (job.dir ? path.join(job.dir, ".done") : ""),
    runnerId: job.runnerId ?? "linux-build",
    timeline: job.timeline ?? [],
    cost: job.cost ?? { estimatedUSD: 0, currency: "USD", breakdown: [] },
    ...(job.sessionId ? { sessionId: job.sessionId } : {}),
    ...(job.dashboardUrl ? { dashboardUrl: job.dashboardUrl } : {}),
    ...(job.directory ? { directory: job.directory } : {}),
    ...(job.modelRef ? { modelRef: job.modelRef } : {}),
    ...(job.reviewerRef ? { reviewerRef: job.reviewerRef } : {}),
  };
}

/**
 * Lista todos los jobs (compat anterior + tienda única, la vista manda ante
 * colisión; orden desc por createdAt). Espejo de `getAllJobsForList`.
 * Nunca lanza (ante fallo total, `[]` honesto).
 */
export function listJobs(opts?: {
  extrasFor?: JobExtrasFor;
  legacy?: Iterable<JobLegacyInput>;
}): Array<Record<string, unknown>> {
  try {
    const map = new Map<string, Record<string, unknown>>();
    try {
      const items = opts?.legacy;
      if (items) {
        // C1: iteración estructural sobre colección finita con forEach
        // (el meta-test de cotas solo admite archivos exentos y este dominio
        // nuevo no toca esa suite ajena; forEach es terminación estructural).
        [...items].forEach((job) => {
          try {
            if (job && typeof job.id === "string") map.set(job.id, legacyListItem(job));
          } catch {
            // una entrada anterior rota no rompe la lista (C4)
          }
        });
      }
    } catch {
      // compat anterior opcional: sin ella la tienda manda sola
    }
    let stored: WorkItem[] = [];
    try {
      stored = workItemStore.list();
    } catch {
      stored = [];
    }
    // C1: igual que arriba, forEach estructural.
    stored.forEach((wi) => {
      try {
        const merged = toListItem(wi, safeExtrasFor(opts?.extrasFor, wi));
        const existing = map.get(wi.id);
        map.set(wi.id, existing ? { ...existing, ...merged } : merged);
      } catch {
        // un item roto no rompe la lista (C4)
      }
    });
    const out = [...map.values()];
    try {
      out.sort((a, b) => {
        try {
          return new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime();
        } catch {
          return 0;
        }
      });
    } catch {
      // sin orden ante fechas rotas (igual se devuelve lo listado)
    }
    return out;
  } catch {
    return [];
  }
}

// Claves de meta del timeline que el summary proyecta (espejos exactos de
// las que lee el renderer en src/features/warpPanel/adapters/
// factoryIssueJobs.ts; este dominio NO importa el renderer — ver whitelist
// de imports arriba).
const SUMMARY_ISSUE_REF_KEY = "issueRef";
const SUMMARY_PR_KEY = "pr";
const SUMMARY_TRIAGE_RESPOND_KEY = "triageRespond";
const SUMMARY_FOREMAN_DECISION_KEY = "foremanDecision";

function cleanSummaryText(value: unknown, max: number): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, max);
  } catch {
    return null;
  }
}

/**
 * Proyecciones timeline→summary en UNA pasada reversa por item. El renderer
 * las leía con reverse-scans por fila y por tick (índice + gates H0/H2 +
 * fallback PR); el server las calcula una vez por request:
 * - `issueRef`: meta `issueRef` más nueva válida (el índice se arma sin timeline)
 * - `parked`: `needsResume` (gate H0 — domina los demás)
 * - `triageAnswered`: `triageRespond` con ≥1 respuesta no vacía, solo en
 *   Triage (backstop H2 cuando el job ya respondió pero sigue en Triage)
 * - `pr`: meta `pr` más nueva con prUrl (fallback cuando `isolation` no trae URL)
 * - `foreman`: meta `foremanDecision` más nueva válida (decisión + motivo +
 *   confianza). El detalle la muestra para explicar el ruteo (por qué
 *   Triage y no Building) sin fetchear el job full.
 * Nunca lanza (ante fallo, `{}` honesto y el renderer degrada igual que hoy).
 */
export function projectSummaryTimeline(
  timeline: unknown,
  status: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    const entries = Array.isArray(timeline) ? timeline : [];
    let issueRef: Record<string, unknown> | null = null;
    let pr: Record<string, unknown> | null = null;
    let foreman: Record<string, unknown> | null = null;
    let answered = false;
    const wantAnswers = status === "Triage";
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      try {
        if (
          issueRef !== null &&
          pr !== null &&
          foreman !== null &&
          (!wantAnswers || answered)
        ) {
          break;
        }
        const entry = entries[i] as { meta?: unknown } | null;
        const meta = entry?.meta;
        if (meta === null || typeof meta !== "object" || Array.isArray(meta)) continue;
        const record = meta as Record<string, unknown>;
        if (issueRef === null) {
          const candidate = record[SUMMARY_ISSUE_REF_KEY];
          if (
            candidate !== null &&
            typeof candidate === "object" &&
            !Array.isArray(candidate)
          ) {
            const rec = candidate as Record<string, unknown>;
            if (
              rec.provider === "github" &&
              typeof rec.issueNumber === "number" &&
              Number.isInteger(rec.issueNumber) &&
              (rec.issueNumber as number) > 0
            ) {
              const projected: Record<string, unknown> = {
                provider: "github",
                issueNumber: rec.issueNumber,
              };
              const repo = cleanSummaryText(rec.repo, 256);
              if (repo !== null) projected.repo = repo;
              const url = cleanSummaryText(rec.url, 500);
              if (url !== null) projected.url = url;
              issueRef = projected;
            }
          }
        }
        if (pr === null) {
          const candidate = record[SUMMARY_PR_KEY];
          if (
            candidate !== null &&
            typeof candidate === "object" &&
            !Array.isArray(candidate)
          ) {
            const rec = candidate as Record<string, unknown>;
            const prUrl = cleanSummaryText(rec.prUrl, 500);
            if (prUrl !== null) {
              const projected: Record<string, unknown> = { prUrl };
              if (
                typeof rec.prNumber === "number" &&
                Number.isInteger(rec.prNumber) &&
                (rec.prNumber as number) > 0
              ) {
                projected.prNumber = rec.prNumber;
              }
              pr = projected;
            }
          }
        }
        if (foreman === null) {
          const candidate = record[SUMMARY_FOREMAN_DECISION_KEY];
          if (
            candidate !== null &&
            typeof candidate === "object" &&
            !Array.isArray(candidate)
          ) {
            const rec = candidate as Record<string, unknown>;
            const decision = cleanSummaryText(rec.decision, 64);
            if (decision !== null) {
              const projected: Record<string, unknown> = { decision };
              const reason = cleanSummaryText(rec.reason, 200);
              if (reason !== null) projected.reason = reason;
              if (
                typeof rec.confidence === "number" &&
                Number.isFinite(rec.confidence)
              ) {
                projected.confidence = rec.confidence;
              }
              if (rec.retryable === true) projected.retryable = true;
              foreman = projected;
            }
          }
        }
        if (wantAnswers && !answered) {
          const respond = record[SUMMARY_TRIAGE_RESPOND_KEY];
          if (
            respond !== null &&
            typeof respond === "object" &&
            !Array.isArray(respond)
          ) {
            const answers = (respond as Record<string, unknown>).answers;
            if (Array.isArray(answers)) {
              for (const answer of answers) {
                if (typeof answer === "string" && answer.trim().length > 0) {
                  answered = true;
                  break;
                }
              }
            }
          }
        }
      } catch {
        // una entrada rota nunca aborta la pasada
      }
    }
    if (issueRef !== null) out.issueRef = issueRef;
    if (pr !== null) out.pr = pr;
    if (foreman !== null) out.foreman = foreman;
    if (answered) out.triageAnswered = true;
    try {
      if (needsResume(status, entries as Parameters<typeof needsResume>[1])) {
        out.parked = true;
      }
    } catch {
      // H0 best-effort: sin marca legible no se declara parqueo
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Lista resumida (`GET /factory/jobs?view=summary`): misma tienda y orden
 * que `listJobs`, forma `toListSummary` + proyecciones timeline. Sin rama
 * legacy (vista nueva, cero compat que honrar). Nunca lanza.
 */
export function listJobSummaries(opts?: {
  extrasFor?: JobExtrasFor;
}): Array<Record<string, unknown>> {
  try {
    const out: Array<Record<string, unknown>> = [];
    let stored: WorkItem[] = [];
    try {
      stored = workItemStore.list();
    } catch {
      stored = [];
    }
    // C1: forEach estructural, igual que `listJobs`.
    stored.forEach((wi) => {
      try {
        out.push({
          ...toListSummary(wi, safeExtrasFor(opts?.extrasFor, wi)),
          ...projectSummaryTimeline(wi.timeline, wi.status),
        });
      } catch {
        // un item roto no rompe la lista (C4)
      }
    });
    try {
      out.sort((a, b) => {
        try {
          return new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime();
        } catch {
          return 0;
        }
      });
    } catch {
      // sin orden ante fechas rotas (igual se devuelve lo listado)
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Rama compat de detalle (movida literal desde `getSingleJobResponse`,
 * incluido el `resultPreview` y el quirk: `logs` sin `logsCount`).
 */
function legacyDetail(job: JobLegacyInput): Record<string, unknown> {
  return {
    id: job.id,
    prompt: job.prompt,
    worktree: job.worktree,
    phase: job.phase,
    state: job.state,
    status: job.status ?? "Intake",
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    logs: job.logs ?? [],
    dir: job.dir,
    dotDonePath: job.dotDonePath ?? (job.dir ? path.join(job.dir, ".done") : ""),
    runnerId: job.runnerId ?? "linux-build",
    timeline: job.timeline ?? [],
    cost: job.cost ?? { estimatedUSD: 0, currency: "USD", breakdown: [] },
    ...(job.sessionId ? { sessionId: job.sessionId } : {}),
    ...(job.dashboardUrl ? { dashboardUrl: job.dashboardUrl } : {}),
    ...(job.directory ? { directory: job.directory } : {}),
    ...(job.modelRef ? { modelRef: job.modelRef } : {}),
    ...(job.reviewerRef ? { reviewerRef: job.reviewerRef } : {}),
    resultPreview: {
      jobId: job.id,
      phase: job.phase,
      worktree: job.worktree,
      state: job.state,
      status: job.status ?? "Intake",
      promptPreview: job.prompt.slice(0, 120),
      createdAt: new Date(job.createdAt).toISOString(),
      summary: job.state === "done" ? "Job completado correctamente (local)." : "Job aun no finalizado.",
      ...(job.sessionId ? { sessionId: job.sessionId } : {}),
      ...(job.dashboardUrl ? { dashboardUrl: job.dashboardUrl } : {}),
      ...(job.directory ? { directory: job.directory } : {}),
      ...(job.modelRef ? { modelRef: job.modelRef } : {}),
      ...(job.reviewerRef ? { reviewerRef: job.reviewerRef } : {}),
    },
  };
}

/**
 * Detalle por id (tienda vía jobView con extras+vista previa; compat anterior
 * si la tienda no lo tiene; null honesto si nadie lo tiene).
 * Espejo de `getSingleJobResponse`. Nunca lanza.
 */
export function getJobDetail(
  id: unknown,
  opts?: { extrasFor?: JobExtrasFor; legacy?: JobLegacyInput | undefined },
): Record<string, unknown> | null {
  try {
    if (typeof id !== "string" || id.length === 0) return null;
    const wi = safeGet(id);
    if (wi) {
      try {
        return toDetail(wi, safeExtrasFor(opts?.extrasFor, wi));
      } catch {
        return null;
      }
    }
    const prev = matchLegacy(opts?.legacy, id);
    if (!prev) return null;
    try {
      return legacyDetail(prev);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export type JobLogsOk = { ok: true; id: string; logs: string[] };
export type JobLogsErr = { ok: false; code: 404; error: string };

/**
 * Logs por id (`{id, logs}`). Espejo del bloque LOGS JSON. 404 honesto ante
 * ausente; nunca lanza.
 */
export function getJobLogs(
  id: unknown,
  opts?: { legacy?: JobLegacyInput | undefined },
): JobLogsOk | JobLogsErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    const prev = matchLegacy(opts?.legacy, id);
    const target = wi ?? prev;
    if (!target) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const logs = (target as { logs?: string[] }).logs ?? [];
    return { ok: true, id, logs };
  } catch {
    return { ok: false, code: 404, error: `job not found: ${String(id).slice(0, 60)}` };
  }
}

export type JobEventsSnapshotOk = {
  ok: true;
  id: string;
  logs: string[];
  state: string;
  status: string;
  /** true ante estado final (el caller cierra el stream; ver bloque SSE). */
  terminal: boolean;
};
export type JobEventsSnapshotErr = { ok: false; code: 404; error: string };

/**
 * Foto de datos para el stream de eventos por id (el server conserva el cable
 * SSE: latidos y cierre finito; acá solo los datos). Espejo del bloque SSE:
 * misma resolución state/status y misma regla de terminal
 * (done/error/Complete/Cancelled). 404 honesto; nunca lanza.
 */
export function getJobEventsSnapshot(
  id: unknown,
  opts?: { legacy?: JobLegacyInput | undefined },
): JobEventsSnapshotOk | JobEventsSnapshotErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    const prev = matchLegacy(opts?.legacy, id);
    const target = wi ?? prev;
    if (!target) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const logs = (target as { logs?: string[] }).logs ?? [];
    const state =
      (target as { state?: string }).state ?? (wi ? mapStatusToLegacyState(wi.status) : "queued");
    const status = (target as { status?: string }).status ?? (wi?.status ?? "Intake");
    const terminal =
      state === "done" || state === "error" || status === "Complete" || status === "Cancelled";
    return { ok: true, id, logs, state, status, terminal };
  } catch {
    return { ok: false, code: 404, error: `job not found: ${String(id).slice(0, 60)}` };
  }
}

export type JobResultOk = { ok: true; payload: unknown };
export type JobResultErr = { ok: false; code: 400 | 404 | 500; error: string; hint?: string };

/**
 * Resultado por id. Rico primero (tienda única validada), crudo después
 * (parcial honesto: un result pobre se sirve tal cual, jamás se inventa ni
 * se esconde). Espejo del bloque Ola 3, rama result (mismos códigos y
 * textos). Nunca lanza.
 */
export function readJobResult(
  id: unknown,
  opts?: { legacy?: JobLegacyInput | undefined },
): JobResultOk | JobResultErr {
  try {
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id === "result" ||
      id === "build-log" ||
      id === "build.log"
    ) {
      return { ok: false, code: 400, error: "missing id for result/build-log" };
    }
    const wi = safeGet(id);
    const prev = matchLegacy(opts?.legacy, id);
    if (!wi && !prev) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const dir = wi?.dir ?? prev?.dir ?? null;
    if (typeof dir !== "string" || dir.length === 0) {
      return { ok: false, code: 404, error: "no dir for job" };
    }
    const resultPath = path.join(dir, "result.json");
    let exists = false;
    try {
      exists = fs.existsSync(resultPath);
    } catch {
      exists = false;
    }
    if (!exists) {
      return {
        ok: false,
        code: 404,
        error: "result not found",
        hint: "job not yet built or verification not finished",
      };
    }
    try {
      const rich = readResult(dir);
      if (rich) return { ok: true, payload: rich };
    } catch {
      // cae al crudo honesto (ver abajo)
    }
    try {
      const raw = fs.readFileSync(resultPath, "utf-8");
      return { ok: true, payload: JSON.parse(raw) as unknown };
    } catch (e) {
      return { ok: false, code: 500, error: `failed to read result.json: ${String(e)}` };
    }
  } catch (e) {
    return { ok: false, code: 500, error: `failed to read result.json: ${String(e)}` };
  }
}

export type JobBuildLogOk = { ok: true; text: string };
export type JobBuildLogErr = { ok: false; code: 400 | 404 | 500; error: string };

/**
 * Build-log por id (prefiere `logs/build.log`, cae a `build.log`).
 * Espejo del bloque Ola 3, rama build-log (mismos códigos y textos).
 * Sirve texto plano; nunca lanza.
 */
export function readJobBuildLog(
  id: unknown,
  opts?: { legacy?: JobLegacyInput | undefined },
): JobBuildLogOk | JobBuildLogErr {
  try {
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id === "result" ||
      id === "build-log" ||
      id === "build.log"
    ) {
      return { ok: false, code: 400, error: "missing id for result/build-log" };
    }
    const wi = safeGet(id);
    const prev = matchLegacy(opts?.legacy, id);
    if (!wi && !prev) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const dir = wi?.dir ?? prev?.dir ?? null;
    if (typeof dir !== "string" || dir.length === 0) {
      return { ok: false, code: 404, error: "no dir for job" };
    }
    const primary = path.join(dir, "logs", "build.log");
    const alt = path.join(dir, "build.log");
    let target: string | null = null;
    try {
      if (fs.existsSync(primary)) target = primary;
      else if (fs.existsSync(alt)) target = alt;
    } catch {
      target = null;
    }
    if (!target) {
      return { ok: false, code: 404, error: "build.log not found" };
    }
    try {
      return { ok: true, text: fs.readFileSync(target, "utf-8") };
    } catch (e) {
      return { ok: false, code: 500, error: `failed to read build.log: ${String(e)}` };
    }
  } catch (e) {
    return { ok: false, code: 500, error: `failed to read build.log: ${String(e)}` };
  }
}

// ── TANDA A — ops de respuesta para delegación del cascarón ──
// El cascarón conserva MATCH + escritura HTTP; la decisión vive acá
// (formas/códigos/textos byte-idénticos, C5 aditivo). Sin imports nuevos
// (la lista blanca del header sigue intacta) y sin timers ni `require()`.

/** Infra de dashboard inyectada por el cascarón (sin importar al cascarón: sin ciclos). */
export interface JobDashboardInfra {
  readonly resolveDirectory: (worktree: string) => string;
  readonly buildDashboardUrl: (sessionId?: string, directory?: string) => string;
}

/**
 * Aplica el merge de dashboard a una lista ya proyectada (espejo del `.map`
 * effUrl del bloque LIST JOBS del cascarón: misma regla `||` + mismo
 * condicional de agregado). Puro: no lee tiendas ni disco; ante item roto
 * lo pasa tal cual (C4). Nunca lanza.
 */
export function applyDashboardUrls(
  items: Array<Record<string, unknown>>,
  infra: JobDashboardInfra,
): Array<Record<string, unknown>> {
  try {
    if (!Array.isArray(items)) return [];
    const out: Array<Record<string, unknown>> = [];
    // C1: forEach estructural sobre colección finita (igual que `listJobs`).
    items.forEach((j) => {
      try {
        if (!j || typeof j !== "object") {
          out.push(j);
          return;
        }
        const dirField = (j.directory || infra.resolveDirectory(j.worktree as string)) as string;
        // Con sessionId la URL se reconstruye SIEMPRE con el puerto actual:
        // la persistida es de un server opencode anterior (puerto efímero
        // muerto, ej. 24511) y el link quedaba roto. Sin sessionId se
        // respeta la presente (histórico de jobs viejos).
        const effUrl = (j.sessionId as string | undefined)
          ? infra.buildDashboardUrl(j.sessionId as string, dirField)
          : (j.dashboardUrl as string | undefined);
        out.push({
          ...j,
          ...(effUrl && effUrl !== j.dashboardUrl ? { dashboardUrl: effUrl } : {}),
        });
      } catch {
        out.push(j);
      }
    });
    return out;
  } catch {
    return [];
  }
}

/** Campos de la tienda que alimentan la decisión de migración de dashboard. */
export interface JobDashboardMigrationInput {
  readonly sessionId?: string;
  readonly dashboardUrl?: string;
  readonly worktree: string;
  readonly directory?: string;
}

/**
 * Decide la migración de dashboard del bloque SINGLE JOB (espejo literal:
 * directorio efectivo por `||`, URL efectiva por sessionId, comparación de
 * cambio). Puro: no toca la tienda (el cascarón aplica + persiste por su
 * punto único). Null = nada que migrar. Nunca lanza.
 */
export function resolveDashboardMigration(
  input: JobDashboardMigrationInput,
  infra: JobDashboardInfra,
): { dashboardUrl: string; directory: string } | null {
  try {
    if (!input || typeof input !== "object") return null;
    if (typeof input.worktree !== "string") return null;
    const effectiveDirectoryForGet = input.directory || infra.resolveDirectory(input.worktree);
    const effectiveDashboardUrl = input.sessionId
      ? infra.buildDashboardUrl(input.sessionId, effectiveDirectoryForGet)
      : input.dashboardUrl;
    if (effectiveDashboardUrl && effectiveDashboardUrl !== input.dashboardUrl) {
      return { dashboardUrl: effectiveDashboardUrl, directory: effectiveDirectoryForGet };
    }
    return null;
  } catch {
    return null;
  }
}

export type JobResultRawOk = { ok: true; payload: unknown };
export type JobResultRawErr = { ok: false; code: 400 | 404 | 500; error: string; hint?: string };

/**
 * Rama result de Ola 3 en crudo (espejo del bloque del cascarón: mismos
 * guards 400/404, mismo 404 con hint, mismo 500; el 200 sirve el archivo tal
 * cual con `JSON.parse`, sin pasar por el rico validado). Solo tienda única
 * (el cascarón ya no alimenta compat desde FASE 4). Nunca lanza.
 */
export function readJobResultRaw(id: unknown): JobResultRawOk | JobResultRawErr {
  try {
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id === "result" ||
      id === "build-log" ||
      id === "build.log"
    ) {
      return { ok: false, code: 400, error: "missing id for result/build-log" };
    }
    const wi = safeGet(id);
    if (!wi) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const dir: string | null = wi.dir ?? null;
    if (!dir) {
      return { ok: false, code: 404, error: "no dir for job" };
    }
    const resultPath = path.join(dir, "result.json");
    let exists = false;
    try {
      exists = fs.existsSync(resultPath);
    } catch {
      exists = false;
    }
    if (!exists) {
      return {
        ok: false,
        code: 404,
        error: "result not found",
        hint: "job not yet built or verification not finished",
      };
    }
    try {
      const raw = fs.readFileSync(resultPath, "utf-8");
      return { ok: true, payload: JSON.parse(raw) as unknown };
    } catch (e) {
      return { ok: false, code: 500, error: `failed to read result.json: ${String(e)}` };
    }
  } catch (e) {
    return { ok: false, code: 500, error: `failed to read result.json: ${String(e)}` };
  }
}

export type JobCancelOk = { ok: true; id: string; state: string; status: string };
export type JobCancelErr = { ok: false; code: 404 | 409 | 500; error: string };

/**
 * Cancelación por id (espejo del bloque CANCEL del cascarón: mismo guard
 * 404, misma regla de terminal con el mismo mensaje `job already ...`,
 * misma transición a Cancelled con el mismo mensaje actor, mismo 409 de la
 * tienda con su mensaje, mismo re-leído de estado final). La transición
 * persiste vía la tienda única (mismo punto que `create` en jobCreate); los
 * avisos (log + foreman) los conserva el cascarón tras el ok, en el mismo
 * orden de escrituras. Nunca lanza: el 500 viaja en la unión con el mismo
 * cuerpo que el catch exterior del cascarón.
 */
export function requestJobCancel(id: unknown): JobCancelOk | JobCancelErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    if (!wi) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const stateForCheck = mapStatusToLegacyState(wi.status);
    const statusForCheck = wi.status;
    const isTerminal =
      stateForCheck === "done" ||
      stateForCheck === "error" ||
      statusForCheck === "Complete" ||
      statusForCheck === "Cancelled";
    if (isTerminal) {
      const already =
        stateForCheck === "done"
          ? "done"
          : stateForCheck === "error"
            ? "error"
            : statusForCheck === "Complete"
              ? "done"
              : "error";
      return { ok: false, code: 409, error: `job already ${already}` };
    }
    try {
      workItemStore.transition(id, "Cancelled", "user", "cancelado por usuario (POST /cancel)");
    } catch (e) {
      const maybe = e as { status?: number; message?: string };
      if (maybe?.status === 409) {
        return { ok: false, code: 409, error: maybe.message ?? `job already ${statusForCheck}` };
      }
      return { ok: false, code: 500, error: e instanceof Error ? e.message : String(e) };
    }
    let finalState = "error";
    let finalStatus: string = "Cancelled";
    try {
      const updatedAfter = safeGet(id);
      finalState = updatedAfter ? mapStatusToLegacyState(updatedAfter.status) : "error";
      finalStatus = updatedAfter?.status ?? "Cancelled";
    } catch {
      // re-leído best-effort: ante fallo valen los valores Cancelled
    }
    return { ok: true, id, state: finalState, status: finalStatus };
  } catch (e) {
    return { ok: false, code: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

export type JobResumeOk = { ok: true; id: string; status: string };
export type JobResumeErr = { ok: false; code: 404 | 409 | 500; error: string };

/**
 * Retomar un turno parqueado por reinicio (P3d, parqueo honesto). Guards:
 * 404 sin job; 409 si el status no es obrero (nada que retomar) o si está
 * obrero pero SIN marca de interrupción (sigue corriendo: retomarlo
 * duplicaría el worker). En ok, anexa el evento `resumed` SINCRÓNICO (así un
 * segundo POST ve la marca y responde 409: sin doble disparo) y el caller
 * agenda el worker de la fase. Nunca lanza.
 */
export function requestJobResume(id: unknown): JobResumeOk | JobResumeErr {
  try {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, code: 404, error: "job not found: " };
    }
    const wi = safeGet(id);
    if (!wi) {
      return { ok: false, code: 404, error: `job not found: ${id}` };
    }
    const status = wi.status;
    if (!needsResume(status, wi.timeline)) {
      const parkable =
        status === "Foreman" || status === "Building" || status === "Review";
      return {
        ok: false,
        code: 409,
        error: parkable
          ? `job is running (not parked): ${id}`
          : `job not resumable (status=${typeof status === "string" ? status : "?"})`,
      };
    }
    try {
      workItemStore.appendEvent(id, "user", `turno retomado por humano tras reinicio (estaba en ${status})`, {
        [RESUMED_META_KEY]: true,
      } as unknown as Record<string, unknown>);
    } catch (e) {
      return { ok: false, code: 500, error: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true, id, status: typeof status === "string" ? status : "Building" };
  } catch (e) {
    return { ok: false, code: 500, error: e instanceof Error ? e.message : String(e) };
  }
}
