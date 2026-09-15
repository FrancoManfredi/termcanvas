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
 * Gate del engine (aditivo): proyecta `engineGate` cuando es un record con
 * nodeId/kind/message legibles, else omite la key (null/ausente = sin gate —
 * honest-empty, mismo patrón que `dashboardUrl`). Pura, nunca lanza.
 */
function projectEngineGate(item: WorkItem): Record<string, unknown> {
  try {
    const g = (item as unknown as { engineGate?: unknown }).engineGate;
    if (g === null || g === undefined || typeof g !== "object" || Array.isArray(g)) {
      return {};
    }
    const src = g as Record<string, unknown>;
    if (typeof src.nodeId !== "string" || src.nodeId.trim() === "") return {};
    if (typeof src.kind !== "string" || src.kind.trim() === "") return {};
    if (typeof src.message !== "string") return {};
    const out: Record<string, unknown> = {
      nodeId: src.nodeId.trim().slice(0, 64),
      kind: src.kind.trim().slice(0, 32),
      message: src.message.slice(0, 2000),
    };
    if (typeof src.runId === "string" && src.runId !== "") {
      out.runId = src.runId.slice(0, 128);
    }
    if (typeof src.attempt === "number" && Number.isInteger(src.attempt)) {
      out.attempt = src.attempt;
    }
    return { engineGate: out };
  } catch {
    return {};
  }
}

/**
 * Avance del run (aditivo): proyecta `engineRun` cuando es un record legible,
 * else omite la key (null/ausente = sin run — honest-empty). Pura, nunca
 * lanza.
 */
function projectEngineRun(item: WorkItem): Record<string, unknown> {
  try {
    const r = (item as unknown as { engineRun?: unknown }).engineRun;
    if (r === null || r === undefined || typeof r !== "object" || Array.isArray(r)) {
      return {};
    }
    const src = r as Record<string, unknown>;
    if (typeof src.runId !== "string" || src.runId === "") return {};
    if (typeof src.workflow !== "string" || src.workflow === "") return {};
    if (typeof src.status !== "string" || src.status === "") return {};
    const out: Record<string, unknown> = {
      runId: src.runId.slice(0, 128),
      workflow: src.workflow.slice(0, 128),
      status: src.status.slice(0, 32),
    };
    if (typeof src.currentNodeId === "string" && src.currentNodeId !== "") {
      out.currentNodeId = src.currentNodeId.slice(0, 64);
    }
    if (Array.isArray(src.completedNodes)) {
      out.completedNodes = src.completedNodes
        .filter((n): n is string => typeof n === "string" && n.trim() !== "")
        .map((n) => n.trim())
        .slice(0, 50);
    }
    if (Array.isArray(src.nodes)) {
      out.nodes = src.nodes
        .filter((n): n is string => typeof n === "string" && n.trim() !== "")
        .map((n) => n.trim())
        .slice(0, 50);
    }
    const rawNodeSessions = src.nodeSessions;
    if (
      rawNodeSessions !== null &&
      typeof rawNodeSessions === "object" &&
      !Array.isArray(rawNodeSessions)
    ) {
      const sessions: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        rawNodeSessions as Record<string, unknown>,
      )) {
        if (
          typeof key === "string" && key.trim() !== "" && key.length <= 64 &&
          typeof value === "string" && value.trim() !== "" && value.length <= 128
        ) {
          sessions[key.trim()] = value.trim();
        }
        if (Object.keys(sessions).length >= 50) break;
      }
      if (Object.keys(sessions).length > 0) out.nodeSessions = sessions;
    }
    const rawNodeSessionRounds = src.nodeSessionRounds;
    if (Array.isArray(rawNodeSessionRounds)) {
      const rounds: Array<{
        nodeId: string;
        iteration: number;
        sessionId: string;
      }> = [];
      for (const entry of rawNodeSessionRounds) {
        try {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            continue;
          }
          const rec = entry as Record<string, unknown>;
          const nodeId =
            typeof rec.nodeId === "string" ? rec.nodeId.trim() : "";
          const iteration =
            typeof rec.iteration === "number" ? rec.iteration : NaN;
          const sid =
            typeof rec.sessionId === "string" ? rec.sessionId.trim() : "";
          if (
            nodeId === "" || nodeId.length > 64 ||
            !Number.isInteger(iteration) || iteration < 1 || iteration > 100 ||
            sid === "" || sid.length > 128
          ) {
            continue;
          }
          rounds.push({ nodeId, iteration, sessionId: sid });
        } catch {
          // una ronda rota nunca aborta a las demás
        }
        if (rounds.length >= 50) break;
      }
      if (rounds.length > 0) out.nodeSessionRounds = rounds;
    }
    const rawNodeStates = src.nodeStates;
    if (
      rawNodeStates !== null &&
      typeof rawNodeStates === "object" &&
      !Array.isArray(rawNodeStates)
    ) {
      const allowed = new Set([
        "pending",
        "running",
        "completed",
        "failed",
        "skipped",
        "cancelled",
      ]);
      const states: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        rawNodeStates as Record<string, unknown>,
      )) {
        if (
          typeof key === "string" && key.trim() !== "" && key.length <= 64 &&
          typeof value === "string" && allowed.has(value)
        ) {
          states[key.trim()] = value;
        }
        if (Object.keys(states).length >= 50) break;
      }
      if (Object.keys(states).length > 0) out.nodeStates = states;
    }
    const rawNodeAgents = src.nodeAgents;
    if (
      rawNodeAgents !== null &&
      typeof rawNodeAgents === "object" &&
      !Array.isArray(rawNodeAgents)
    ) {
      const agents: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        rawNodeAgents as Record<string, unknown>,
      )) {
        if (
          typeof key === "string" && key.trim() !== "" && key.length <= 64 &&
          typeof value === "string" && value.trim() !== "" && value.length <= 128
        ) {
          agents[key.trim()] = value.trim().slice(0, 128);
        }
        if (Object.keys(agents).length >= 50) break;
      }
      if (Object.keys(agents).length > 0) out.nodeAgents = agents;
    }
    if (typeof src.startedAt === "string" && src.startedAt !== "") {
      out.startedAt = src.startedAt.slice(0, 64);
    }
    return { engineRun: out };
  } catch {
    return {};
  }
}

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
    ...projectEngineGate(item),
    ...projectEngineRun(item),
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
    ...(projectIsolation(item)),
    ...projectEngineGate(item),
    ...projectEngineRun(item),
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
    ...projectEngineGate(item),
    ...projectEngineRun(item),
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
    ...projectEngineGate(item),
    ...projectEngineRun(item),
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
  /**
   * Ronda del nodo dentro de un `loop`/`loop_group` (1-based). Solo la
   * sesión más reciente del nodo y las rondas previas lo traen; ausente en
   * links legacy o nodos de una sola ejecución.
   */
  round?: number;
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

interface NodeSessionRound {
  nodeId: string;
  iteration: number;
  sessionId: string;
}

/**
 * Historial de sesiones por ronda desde `engineRun.nodeSessionRounds`
 * (nodos dentro de `loop`/`loop_group`). Orden de llegada (R1 primero),
 * tope 50. Entradas rotas se omiten; ausente → `[]`. Puro, nunca lanza.
 */
function readEngineRunRounds(engineRun: unknown): NodeSessionRound[] {
  const out: NodeSessionRound[] = [];
  try {
    if (!engineRun || typeof engineRun !== "object" || Array.isArray(engineRun)) {
      return out;
    }
    const raw = (engineRun as Record<string, unknown>).nodeSessionRounds;
    if (!Array.isArray(raw)) return out;
    for (const entry of raw) {
      try {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const rec = entry as Record<string, unknown>;
        const nodeId = typeof rec.nodeId === "string" ? rec.nodeId.trim() : "";
        const iteration = typeof rec.iteration === "number" ? rec.iteration : NaN;
        const sessionId =
          typeof rec.sessionId === "string" ? rec.sessionId.trim() : "";
        if (
          nodeId === "" || nodeId.length > 64 ||
          !Number.isInteger(iteration) || iteration < 1 || iteration > 100 ||
          sessionId === "" || sessionId.length > 128
        ) {
          continue;
        }
        out.push({ nodeId, iteration, sessionId });
      } catch {
        // una ronda rota nunca aborta a las demás
      }
      if (out.length >= 50) break;
    }
  } catch {
    // best-effort: sin rondas legibles
  }
  return out;
}

/**
 * Ronda más alta registrada para el nodo (la vigente). `undefined` cuando
 * el nodo no loopéo o no hay rondas legibles.
 */
function latestRoundFor(rounds: NodeSessionRound[], nodeId: string): number | undefined {
  let max: number | undefined;
  for (const entry of rounds) {
    if (entry.nodeId !== nodeId) continue;
    if (max === undefined || entry.iteration > max) max = entry.iteration;
  }
  return max;
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
    engineRun?: unknown;
  },
  buildUrl: (sessionId: string, directory?: string) => string,
): Record<string, unknown> {
  try {
    const sessions =
      item?.agentSessions !== null && typeof item?.agentSessions === "object"
        ? (item.agentSessions as Record<string, unknown>)
        : null;
    const rawDir =
      typeof item?.directory === "string" && item.directory !== ""
        ? item.directory
        : typeof item?.worktree === "string"
          ? item.worktree
          : undefined;
    const links: PhaseSessionLinks = [];
    // Rondas por nodo (loops): para marcar la vigente y listar las previas.
    const rounds = readEngineRunRounds(item?.engineRun);
    if (sessions) {
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
          const link: RoleSessionLink = { role, sessionId, sessionUrl };
          const round = latestRoundFor(rounds, role);
          if (round !== undefined) link.round = round;
          links.push(link);
        } catch {
          // un rol roto nunca aborta a los demás
        }
      });
    }
    // F11: sesiones por nodo del engine (workflows arbitrarios) con
    // `role = nodeId` → la UI las muestra como fila dinámica (DEPLOY, VERIFY,
    // lo que traiga el YAML). F16: si el nodo ya está cubierto por un rol
    // canónico (alias por hoja de loop_group, mismo sessionId), MANDA el
    // nodeId exacto: el alias se renombra en su lugar, sin duplicar la
    // entrada — la fila de Agent Sessions vuelve a encontrar su sesión.
    try {
      const run = item?.engineRun;
      if (run && typeof run === "object" && !Array.isArray(run)) {
        const rec = run as Record<string, unknown>;
        const nodeSessions = rec.nodeSessions;
        if (
          nodeSessions !== null &&
          typeof nodeSessions === "object" &&
          !Array.isArray(nodeSessions)
        ) {
          const order = Array.isArray(rec.nodes)
            ? rec.nodes.filter(
                (n): n is string => typeof n === "string" && n !== "",
              )
            : [];
          const entries = Object.entries(
            nodeSessions as Record<string, unknown>,
          )
            .map(([nodeId, sid]) => ({ nodeId, sid: cleanSessionId(sid) }))
            .filter(
              (entry): entry is { nodeId: string; sid: string } =>
                entry.sid !== null && entry.nodeId !== "",
            );
          entries.sort((a, b) => {
            const ia = order.indexOf(a.nodeId);
            const ib = order.indexOf(b.nodeId);
            const ra = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
            const rb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
            return ra - rb || a.nodeId.localeCompare(b.nodeId);
          });
          for (const entry of entries) {
            if (links.length >= 20) break;
            const covered = links.find((link) => link.sessionId === entry.sid);
            if (covered) {
              // Alias canónico por hoja (`implement`) cubierto por el nodo
              // namespaced (`build.implement`): el rol exacto manda.
              const exactRole = entry.nodeId.slice(0, 64) as RoleSessionRole;
              if (covered.role !== exactRole) covered.role = exactRole;
              const round = latestRoundFor(rounds, entry.nodeId);
              if (round !== undefined) covered.round = round;
              continue;
            }
            let sessionUrl: string | null = null;
            try {
              const built = buildUrl(entry.sid, rawDir);
              sessionUrl =
                typeof built === "string" && /^https?:\/\//i.test(built.trim())
                  ? built.trim().slice(0, 500)
                  : null;
            } catch {
              sessionUrl = null;
            }
            if (sessionUrl === null) continue;
            const nodeLink: RoleSessionLink = {
              role: entry.nodeId.slice(0, 64) as RoleSessionRole,
              sessionId: entry.sid,
              sessionUrl,
            };
            const nodeRound = latestRoundFor(rounds, entry.nodeId);
            if (nodeRound !== undefined) nodeLink.round = nodeRound;
            links.push(nodeLink);
          }
          // Rondas previas (loops): una entrada por sesión que ya NO es la
          // vigente del nodo (esa quedó arriba con su round). Orden de
          // llegada (R1 primero) para que la fila muestre la historia.
          try {
            const linked = new Set(links.map((link) => link.sessionId));
            for (const roundEntry of rounds) {
              if (links.length >= 20) break;
              try {
                if (linked.has(roundEntry.sessionId)) continue;
                let roundUrl: string | null = null;
                try {
                  const built = buildUrl(roundEntry.sessionId, rawDir);
                  roundUrl =
                    typeof built === "string" &&
                    /^https?:\/\//i.test(built.trim())
                      ? built.trim().slice(0, 500)
                      : null;
                } catch {
                  roundUrl = null;
                }
                if (roundUrl === null) continue;
                links.push({
                  role: roundEntry.nodeId.slice(0, 64) as RoleSessionRole,
                  sessionId: roundEntry.sessionId,
                  sessionUrl: roundUrl,
                  round: roundEntry.iteration,
                });
                linked.add(roundEntry.sessionId);
              } catch {
                // una ronda rota nunca aborta a las demás
              }
            }
          } catch {
            // best-effort: los links vigentes ya quedaron arriba
          }
        }
      }
    } catch {
      // best-effort: las sesiones canónicas ya quedaron arriba
    }
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
