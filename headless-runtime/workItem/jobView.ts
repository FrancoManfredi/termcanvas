/**
 * JobView — proyección única y pura para lista/detalle/preview (refactor ①, E1).
 *
 * Una sola implementación por forma (antes duplicada en
 * `WorkItemStore.toJSON`, `getAllJobsForList` y `getSingleJobResponse`):
 * - `toStoreJson`: forma del store (`WorkItemStore.toJSON`, delega acá en A3).
 * - `toListItem`: forma de lista (rama workItem de `getAllJobsForList`).
 * - `toDetail`: forma de detalle (rama workItem de `getSingleJobResponse`).
 * - `toResultPreview`: sub-objeto `resultPreview` del detalle.
 * - `verificationCreatedFiles`: `createdFiles` para vista verificación
 *   (ausente→`[]` SOLO acá; `[]` jamás es prueba de entrega — H-012).
 *
 * Puras (sin disco, sin fecha de escritura, sin lanzar ante opcionales
 * ausentes: todo opcional ausente se omite). Los extras triage/spec los
 * calcula el caller (`triageSpecExtras` en el server) y entran por parámetro:
 * esta capa no importa flujos (sin ciclos). La rama legacy `jobs` Map del
 * server queda congelada como compat (muere con el Map; NO se toca).
 * Aditivo UI: lista + detalle proyectan `isolation` (rama + worktree + PR)
 * cuando el record la trae — la vía durable sigue siendo la meta del
 * timeline; la proyección solo evita el reverse-scan en el poll 2.5s.
 */

import type { WorkItem } from "../../shared/types/workItem";
import { mapStatusToLegacyState } from "../../shared/types/workItem";

/** Default histórico de runner (proyección: jamás reescribe disco). */
const DEFAULT_RUNNER_ID = "linux-build";

/** Known isolation keys the list/detail projections carry (additive). */
const ISOLATION_TEXT_KEYS = [
  "branch",
  "baseBranch",
  "worktreePath",
  "repoRoot",
  "prUrl",
  "state",
] as const;

function cleanIsolationText(value: unknown, max: number): string | null {
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
 * Isolation passthrough for the poll reads the panel lives on
 * (`toListItem` every 2.5s, `toDetail` on drill-down): projects the
 * daemon `isolation` record (branch + worktree path + PR link) when it is
 * a record with at least a branch, else omits the key entirely
 * (honest-empty, same pattern as `dashboardUrl`). Without this the
 * renderer memory fast-path (`readFactoryJobIsolation`) never hits from
 * poll data and only the timeline reverse-scan carries the PR URL.
 * Pura (sin disco), nunca lanza.
 */
function projectIsolation(item: WorkItem): Record<string, unknown> {
  try {
    const raw = (item as unknown as { isolation?: unknown }).isolation;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const src = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of ISOLATION_TEXT_KEYS) {
      const max =
        key === "worktreePath" || key === "repoRoot" ? 1024 : 500;
      const cleaned = cleanIsolationText(src[key], max);
      if (cleaned !== null) out[key] = cleaned;
    }
    const prNumber = src.prNumber;
    if (
      typeof prNumber === "number" &&
      Number.isInteger(prNumber) &&
      prNumber > 0
    ) {
      out.prNumber = prNumber;
    }
    // No branch, no isolation worth projecting (a bare `{error}` failure
    // record stays out of the poll shape — the timeline keeps the trace).
    if (typeof out.branch !== "string") return {};
    return { isolation: out };
  } catch {
    return {};
  }
}

/** Extras calculados por el caller (ej. `triageSpecExtras`). */
export type JobViewExtras = Record<string, unknown>;

/**
 * Forma del store: réplica exacta de `WorkItemStore.toJSON`.
 * `logsCount` + `logs`; `cost` legacy intacto; `costSummary`/`agentSessions`/
 * `createdFiles`/`lastReview`/identidad solo si presentes.
 */
export function toStoreJson(item: WorkItem): Record<string, unknown> {
  return {
    id: item.id,
    prompt: item.prompt,
    worktree: item.worktree,
    phase: item.phase,
    status: item.status,
    state: item.state ?? mapStatusToLegacyState(item.status),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    timeline: item.timeline,
    cost: item.cost,
    // Ola 15 E2 (aditivo): null explícito se expone ("—"); undefined se
    // omite ("sin datos todavía"). El `cost` legacy sigue intacto (pacts).
    ...(item.costSummary !== undefined
      ? { costSummary: item.costSummary }
      : {}),
    // Ola 16 E1 (aditivo): sesiones por (job, rol). undefined se omite
    // (job viejo); presente → evidencia en disco vía job.json (Regla 5).
    ...(item.agentSessions !== undefined
      ? { agentSessions: { ...item.agentSessions } }
      : {}),
    // H-001 (aditivo): createdFiles top-level para igualdad exacta contra
    // disco. undefined se omite (job viejo); presente → evidencia (Regla 5).
    ...(item.createdFiles !== undefined
      ? { createdFiles: [...item.createdFiles] }
      : {}),
    dir: item.dir,
    dotDonePath: item.dotDonePath,
    runnerId: item.runnerId ?? DEFAULT_RUNNER_ID,
    logsCount: (item.logs ?? []).length,
    logs: item.logs ?? [],
    reviewCount: item.reviewCount ?? 0,
    ...(item.lastReview ? { lastReview: item.lastReview } : {}),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.dashboardUrl ? { dashboardUrl: item.dashboardUrl } : {}),
    ...(item.directory ? { directory: item.directory } : {}),
    ...(item.modelRef ? { modelRef: item.modelRef } : {}),
    ...(item.reviewerRef ? { reviewerRef: item.reviewerRef } : {}),
  };
}

/**
 * Forma de lista: réplica exacta de la rama workItem de `getAllJobsForList`.
 * `logsCount` + `logs` (compat: la lista hoy trae ambos); `agentSessions` NO
 * se expone en lista (compat: hoy no viaja — el detalle/store sí lo traen).
 * Aditivo T01-UI: `isolation` (ver `projectIsolation`) para que rama + PR
 * lleguen vivos al poll 2.5s sin escanear el timeline.
 */
export function toListItem(
  item: WorkItem,
  extras?: JobViewExtras,
): Record<string, unknown> {
  const legacyState = item.state ?? mapStatusToLegacyState(item.status);
  return {
    id: item.id,
    prompt: item.prompt,
    worktree: item.worktree,
    phase: item.phase,
    state: legacyState,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    timeline: item.timeline,
    cost: item.cost,
    // Ola 15 E2 (aditivo, sin cambiar formas): null explícito = "—",
    // undefined se omite = "sin datos todavía". `cost` legacy intacto.
    ...(item.costSummary !== undefined
      ? { costSummary: item.costSummary }
      : {}),
    dir: item.dir,
    dotDonePath: item.dotDonePath,
    runnerId: item.runnerId ?? DEFAULT_RUNNER_ID,
    logsCount: (item.logs ?? []).length,
    logs: item.logs ?? [],
    reviewCount: item.reviewCount ?? 0,
    ...(item.lastReview ? { lastReview: item.lastReview } : {}),
    // H-001 (aditivo): createdFiles top-level para igualdad exacta contra disco.
    ...(item.createdFiles !== undefined
      ? { createdFiles: item.createdFiles }
      : {}),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.dashboardUrl ? { dashboardUrl: item.dashboardUrl } : {}),
    ...(item.directory ? { directory: item.directory } : {}),
    ...(item.modelRef ? { modelRef: item.modelRef } : {}),
    ...(item.reviewerRef ? { reviewerRef: item.reviewerRef } : {}),
    ...projectIsolation(item),
    ...(extras ?? {}),
  };
}

/**
 * Forma de lista resumida (`GET /factory/jobs?view=summary`): lo que el poll
 * 2.5s del renderer necesita y nada más. Réplica el contrato de lectura del
 * panel (stage por `status`, links de sesión por extras, gates H1–H3 por
 * extras + `lastReview`, PR por `isolation`, `issueRef`/H0/H2-backstop/PR
 * proyectados por el caller vía `projectSummaryTimeline` en jobs/jobService)
 * sin `prompt`/`timeline`/`cost`/`logs`/`createdFiles`/`modelRef`/
 * `reviewerRef`/`agentSessions`/`dir`/`dotDonePath` (~80% del peso medido
 * 2026-09-09: timeline 54% + logs 24% de 6 MB por tick). `timeline: []` +
 * `timelineCount`/`lastEventAt` mantienen la firma de cambio con sentido; el
 * detalle full vive en `GET /factory/jobs/:id` (forma intacta). Pura, nunca
 * lanza.
 */
export function toListSummary(
  item: WorkItem,
  extras?: JobViewExtras,
): Record<string, unknown> {
  try {
    if (!item || typeof item !== "object" || Array.isArray(item)) return {};
  } catch {
    return {};
  }
  const legacyState = item.state ?? mapStatusToLegacyState(item.status);
  const timeline = Array.isArray(item.timeline) ? item.timeline : [];
  let lastEventAt: string | null = null;
  try {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const at = (timeline[i] as { at?: unknown } | null)?.at;
      if (typeof at === "string" && at.trim() !== "") {
        lastEventAt = at;
        break;
      }
    }
  } catch {
    lastEventAt = null;
  }
  return {
    id: item.id,
    status: item.status,
    state: legacyState,
    phase: item.phase,
    worktree: item.worktree,
    runnerId: item.runnerId ?? DEFAULT_RUNNER_ID,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    reviewCount: item.reviewCount ?? 0,
    ...(item.lastReview ? { lastReview: item.lastReview } : {}),
    ...(item.costSummary !== undefined
      ? { costSummary: item.costSummary }
      : {}),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.dashboardUrl ? { dashboardUrl: item.dashboardUrl } : {}),
    ...(item.directory ? { directory: item.directory } : {}),
    ...projectIsolation(item),
    timeline: [],
    timelineCount: timeline.length,
    ...(lastEventAt !== null ? { lastEventAt } : {}),
    ...(extras ?? {}),
  };
}

/**
 * Sub-objeto `resultPreview` del detalle (vista previa estable).
 */
export function toResultPreview(item: WorkItem): Record<string, unknown> {
  const legacyState = item.state ?? mapStatusToLegacyState(item.status);
  return {
    jobId: item.id,
    phase: item.phase,
    worktree: item.worktree,
    state: legacyState,
    status: item.status,
    promptPreview: item.prompt.slice(0, 120),
    createdAt: item.createdAt,
    summary:
      item.status === "Complete"
        ? "Job completado correctamente (local)."
        : "Job aun no finalizado.",
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.dashboardUrl ? { dashboardUrl: item.dashboardUrl } : {}),
    ...(item.directory ? { directory: item.directory } : {}),
    ...(item.modelRef ? { modelRef: item.modelRef } : {}),
    ...(item.reviewerRef ? { reviewerRef: item.reviewerRef } : {}),
  };
}

/**
 * Forma de detalle: réplica exacta de la rama workItem de
 * `getSingleJobResponse` (quirk compat incluido: trae `logs` pero NO
 * `logsCount`, a diferencia de lista/store — no se unifica para no romper
 * pacts; el cambio de forma sería endpoint no-aditivo).
 */
export function toDetail(
  item: WorkItem,
  extras?: JobViewExtras,
): Record<string, unknown> {
  const legacyState = item.state ?? mapStatusToLegacyState(item.status);
  return {
    id: item.id,
    prompt: item.prompt,
    worktree: item.worktree,
    phase: item.phase,
    state: legacyState,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    logs: item.logs ?? [],
    dir: item.dir,
    dotDonePath: item.dotDonePath,
    runnerId: item.runnerId ?? DEFAULT_RUNNER_ID,
    timeline: item.timeline,
    cost: item.cost,
    // Ola 15 E2 (aditivo, sin cambiar formas): ver comentario en lista.
    ...(item.costSummary !== undefined
      ? { costSummary: item.costSummary }
      : {}),
    reviewCount: item.reviewCount ?? 0,
    ...(item.lastReview ? { lastReview: item.lastReview } : {}),
    // H-001 (aditivo): createdFiles top-level para igualdad exacta contra disco.
    ...(item.createdFiles !== undefined
      ? { createdFiles: item.createdFiles }
      : {}),
    ...(extras ?? {}),
    ...projectIsolation(item),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.dashboardUrl ? { dashboardUrl: item.dashboardUrl } : {}),
    ...(item.directory ? { directory: item.directory } : {}),
    ...(item.modelRef ? { modelRef: item.modelRef } : {}),
    ...(item.reviewerRef ? { reviewerRef: item.reviewerRef } : {}),
    resultPreview: toResultPreview(item),
  };
}

/**
 * `createdFiles` para la VISTA VERIFICACIÓN (panel/verify): ausente o
 * inválido → `[]` honesto. SOLO en vista verificación: en lista/detalle el
 * ausente se omite (ver formas). Y `[]` jamás es prueba de entrega
 * (H-012 agregará la regla de archivo-ausente; este helper ya deja el lugar).
 * Puro, nunca lanza.
 */
export function verificationCreatedFiles(item: {
  createdFiles?: unknown;
}): string[] {
  try {
    const raw = item?.createdFiles;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .slice(0, 50);
  } catch {
    return [];
  }
}

/** Rol con sesión propia por job (espejo de `SessionAgentRole`). */
export type RoleSessionRole =
  | "foreman"
  | "triage"
  | "spec"
  | "implement"
  | "review";

/** Sesión del rol que trabaja AHORA (para el botón View Agent). */
export interface RoleSessionLink {
  role: RoleSessionRole;
  sessionId: string;
  sessionUrl: string;
}

/** Todas las sesiones por fase del job (para el desplegable del detalle). */
export type PhaseSessionLinks = RoleSessionLink[];

/** Resumen de corrida hook para el panel (progreso + sesiones). */
export interface HookRunView {
  name: string;
  stage: string;
  status: string;
  blocking: boolean;
  sessionId: string | null;
  sessionUrl: string | null;
}

/** Roles con sesión posible, en orden de fase (estable para el desplegable). */
const SESSION_ROLES_IN_ORDER: readonly RoleSessionRole[] = [
  "foreman",
  "triage",
  "spec",
  "implement",
  "review",
];

/**
 * Job status → rol con la sesión que trabaja ahora. Solo stages con agente
 * corriendo mapean (Intake/Complete/Cancelled no tienen turno activo).
 * Puro, nunca lanza.
 */
const ROLE_BY_STATUS: Readonly<Record<string, RoleSessionRole>> = {
  Foreman: "foreman",
  Triage: "triage",
  Building: "implement",
  Review: "review",
};

function cleanSessionId(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Extras de sesión del rol activo para lista/detalle (el caller lo compone
 * con `triageSpecExtras` en su `extrasFor`: misma firma, mismo contrato).
 * Lee `agentSessions` del WorkItem (memoria + job.json, Ola 16) y arma la
 * URL con el builder inyectado (el renderer no conoce el puerto efímero).
 * Sin sesión del rol (o stage sin turno) → `{}` honesto y el panel usa el
 * link MVP (`dashboardUrl`) como antes. Puro (el builder inyectado nunca
 * debe lanzar; si lanza, `{}`), nunca lanza.
 */
export function roleSessionExtras(
  item: {
    status?: unknown;
    directory?: unknown;
    worktree?: unknown;
    agentSessions?: unknown;
  },
  buildUrl: (sessionId: string, directory?: string) => string,
): Record<string, unknown> {
  try {
    const status = typeof item?.status === "string" ? item.status : "";
    const role = ROLE_BY_STATUS[status];
    if (!role) return {};
    const sessions =
      item?.agentSessions !== null && typeof item?.agentSessions === "object"
        ? (item.agentSessions as Record<string, unknown>)
        : null;
    if (!sessions) return {};
    const sessionId = cleanSessionId(sessions[role]);
    if (sessionId === null) return {};
    const rawDir =
      typeof item?.directory === "string" && item.directory !== ""
        ? item.directory
        : typeof item?.worktree === "string"
          ? item.worktree
          : undefined;
    let sessionUrl: string | null = null;
    try {
      const built = buildUrl(sessionId, rawDir);
      sessionUrl =
        typeof built === "string" && /^https?:\/\//i.test(built.trim())
          ? built.trim().slice(0, 500)
          : null;
    } catch {
      sessionUrl = null;
    }
    if (sessionUrl === null) return {};
    const link: RoleSessionLink = { role, sessionId, sessionUrl };
    return { liveSession: link };
  } catch {
    return {};
  }
}

/**
 * TODAS las sesiones por fase del job (desplegable del detalle de la
 * issue: una entrada por rol con sesión registrada, en orden de fase).
 * Misma fuente (`agentSessions`) y mismo builder que `roleSessionExtras`:
 * el renderer no conoce el puerto efímero. Roles sin sesión se omiten
 * (nunca vacíos/inventados); sin ninguna → `{}` honesto. Puro, nunca lanza.
 */
export function allSessionsExtras(
  item: {
    directory?: unknown;
    worktree?: unknown;
    agentSessions?: unknown;
  },
  buildUrl: (sessionId: string, directory?: string) => string,
): Record<string, unknown> {
  try {
    const sessions =
      item?.agentSessions !== null && typeof item?.agentSessions === "object"
        ? (item.agentSessions as Record<string, unknown>)
        : null;
    if (!sessions) return {};
    const rawDir =
      typeof item?.directory === "string" && item.directory !== ""
        ? item.directory
        : typeof item?.worktree === "string"
          ? item.worktree
          : undefined;
    const links: PhaseSessionLinks = [];
    SESSION_ROLES_IN_ORDER.forEach((role) => {
      try {
        const sessionId = cleanSessionId(sessions[role]);
        if (sessionId === null) return;
        let sessionUrl: string | null = null;
        try {
          const built = buildUrl(sessionId, rawDir);
          sessionUrl =
            typeof built === "string" && /^https?:\/\//i.test(built.trim())
              ? built.trim().slice(0, 500)
              : null;
        } catch {
          sessionUrl = null;
        }
        if (sessionUrl === null) return;
        links.push({ role, sessionId, sessionUrl });
      } catch {
        // un rol roto nunca aborta a los demás
      }
    });
    if (links.length === 0) return {};
    return { sessions: links };
  } catch {
    return {};
  }
}

/**
 * Corridas hook del job (progreso visual + dropdown de sesiones).
 * Lee `hookRuns` del WorkItem (resumen acotado que mantiene el corredor,
 * ver `recordHookRun`): por cada hook con sessionId válida arma la URL con
 * el builder inyectado (igual que las sesiones por fase). Sin hooks →
 * `{}` honesto. Puro (el builder nunca debe lanzar), nunca lanza.
 */
export function hookRunsExtras(
  item: {
    directory?: unknown;
    worktree?: unknown;
    hookRuns?: unknown;
  },
  buildUrl: (sessionId: string, directory?: string) => string,
): Record<string, unknown> {
  try {
    const raw = item?.hookRuns;
    if (!Array.isArray(raw) || raw.length === 0) return {};
    const rawDir =
      typeof item?.directory === "string" && item.directory !== ""
        ? item.directory
        : typeof item?.worktree === "string"
          ? item.worktree
          : undefined;
    const views: HookRunView[] = [];
    for (const entry of raw.slice(-20)) {
      try {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const rec = entry as Record<string, unknown>;
        const name = typeof rec.name === "string" ? rec.name.trim() : "";
        const stage = typeof rec.stage === "string" ? rec.stage.trim() : "";
        const status = typeof rec.status === "string" ? rec.status.trim() : "";
        if (!name || !stage || !status) continue;
        const sessionId = cleanSessionId(rec.sessionId);
        let sessionUrl: string | null = null;
        if (sessionId !== null) {
          try {
            const built = buildUrl(sessionId, rawDir);
            sessionUrl =
              typeof built === "string" && /^https?:\/\//i.test(built.trim())
                ? built.trim().slice(0, 500)
                : null;
          } catch {
            sessionUrl = null;
          }
        }
        views.push({
          name: name.slice(0, 64),
          stage: stage.slice(0, 32),
          status: status.slice(0, 16),
          blocking: rec.blocking === true,
          sessionId,
          sessionUrl,
        });
      } catch {
        // una corrida rota nunca aborta a las demás
      }
    }
    if (views.length === 0) return {};
    return { hookRuns: views };
  } catch {
    return {};
  }
}
