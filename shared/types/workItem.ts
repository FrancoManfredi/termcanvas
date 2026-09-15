/**
 * WorkItem domain types — shared between daemon (node) and renderer (browser).
 * Evolución de FactoryJob: añade timeline, cost, runnerId y máquina de estados estricta.
 * Mantiene compatibilidad con pacts F02-F12 (state legacy) via campos opcionales.
 */

import { z } from "zod";
import type { ReviewResult } from "./review";

// ── ModelRef (copiado de FactoryJob.modelRef) ──
export const ModelRefSchema = z.object({
  providerID: z.string().min(1),
  modelID: z.string().min(1),
  variant: z.string().optional(),
});

export type ModelRef = z.infer<typeof ModelRefSchema>;

// ── WorkItemStatus — Ola 2 extendido con Triage + Review ──
export const WorkItemStatusEnum = z.enum([
  "Intake",
  "Foreman",
  "Triage",
  "Building",
  "Review",
  "Complete",
  "Cancelled",
]);

export type WorkItemStatus = z.infer<typeof WorkItemStatusEnum>;

// ── Timeline ──
export const WorkItemTimelineEntrySchema = z.object({
  id: z.string().min(1),
  from: WorkItemStatusEnum,
  to: WorkItemStatusEnum,
  at: z.string().min(1), // ISO8601
  actor: z.enum(["user", "foreman", "runner", "system"]),
  message: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type WorkItemTimelineEntry = z.infer<
  typeof WorkItemTimelineEntrySchema
>;

// ── Cost ──
export const WorkItemCostSchema = z.object({
  estimatedUSD: z.number().min(0),
  currency: z.literal("USD"),
  tokensInput: z.number().optional(),
  tokensOutput: z.number().optional(),
  breakdown: z
    .array(z.object({ label: z.string(), amount: z.number() }))
    .optional(),
});

export type WorkItemCost = z.infer<typeof WorkItemCostSchema>;

// ── CostSummary (Ola 15 E2, aditivo, Paridad Warp costo real) ──
// Contador real por job: llamadas + tokens estimados (chars/4) + USD.
// Sin tarifa → estimatedUSD null + ratesRef null (NUNCA 0.00 inventado).
// costTracking:false → costSummary null explícito en disco ("—").
// Ausente (undefined) → sin datos todavía (job viejo, restore tolerante).
// Se mantiene `cost` legacy requerido intacto (pacts F02-F12).
// T4 (aditivo): `actual` trae la medición del servidor opencode
// (skills/MCPs/contexto inicial incluidos). Solo presente cuando hubo ≥1
// turno medido; ausente = solo estimado (forma intacta).
export const ActualCostSummarySchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  reasoningTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
  calls: z.number().int().min(0),
  /** USD: prefiere el costo del server; si no lo informó, rates con reasoning como output. */
  usd: z.number().min(0).nullable(),
  /** De dónde salió `usd`: "server" (el provider lo calculó) o "rates" (tarifas del yaml). */
  usdSource: z.enum(["server", "rates"]).nullable(),
  basis: z.literal("opencode-session"),
});
export type ActualCostSummary = z.infer<typeof ActualCostSummarySchema>;
export const CostSummarySchema = z
  .object({
    llmCalls: z.number().int().min(0),
    estimatedInputTokens: z.number().int().min(0),
    estimatedOutputTokens: z.number().int().min(0),
    estimatedUSD: z.number().min(0).nullable(),
    basis: z.literal("estimated-chars/4"),
    ratesRef: z.string().nullable(),
    actual: ActualCostSummarySchema.optional(),
  })
  .superRefine((d, ctx) => {
    if (d.estimatedUSD !== null && d.estimatedUSD !== undefined) {
      if (typeof d.ratesRef !== "string" || d.ratesRef.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "ratesRef requerido cuando hay estimatedUSD (sin tarifa → USD null)",
          path: ["ratesRef"],
        });
      }
    }
    if (d.estimatedUSD === null && d.ratesRef !== null) {
      ctx.addIssue({
        code: "custom",
        message: "ratesRef debe ser null cuando estimatedUSD es null (sin tarifa)",
        path: ["ratesRef"],
      });
    }
  });

export type CostSummary = z.infer<typeof CostSummarySchema>;

// ── AgentSessions (Ola 16 E1, aditivo, Paridad Warp continuidad) ──
// UNA sesión por (job, rol) reutilizada entre turnos. Opcional: jobs viejos
// no lo tienen → undefined (restore tolerante); cada rol se guarda cuando
// habla por primera vez (objeto parcial válido, p. ej. solo `{foreman}`).
// Validación zod 4 con superRefine (sin `.refine` legacy, Regla de estilo).
const AgentSessionIdSchema = z.string().min(1);
export const AgentSessionsSchema = z
  .object({
    foreman: AgentSessionIdSchema.optional(),
    triage: AgentSessionIdSchema.optional(),
    spec: AgentSessionIdSchema.optional(),
    implement: AgentSessionIdSchema.optional(),
    review: AgentSessionIdSchema.optional(),
  })
  .superRefine((d, ctx) => {
    for (const [role, sid] of Object.entries(d)) {
      if (typeof sid === "string" && sid.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `agentSessions.${role} no puede estar vacío`,
          path: [role],
        });
      }
    }
  })
  .optional();

export type AgentSessions = z.infer<typeof AgentSessionsSchema>;

// ── HookRuns (agentes hook declarativos, aditivo, restore-tolerante) ──
// Resumen acotado de la última corrida por hook (nombre + stage + estado +
// sessionId opcional). Jobs viejos no lo tienen → undefined. Cap 20: el
// resumen nunca crece sin cota (Regla 7). Validación laxa a propósito
// (stage/status libres + superRefine solo anti-vacío): un hook nuevo con
// stage futuro no debe voltear el restore.
export const HOOK_RUNS_MAX = 20;
export const HookRunSchema = z
  .object({
    name: z.string().min(1).max(64),
    stage: z.string().min(1).max(32),
    status: z.string().min(1).max(16),
    blocking: z.boolean().optional(),
    sessionId: z.string().min(1).max(128).optional(),
    at: z.string().min(1).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.name.trim().length === 0) {
      ctx.addIssue({ code: "custom", message: "hookRuns.name no puede estar vacío", path: ["name"] });
    }
  });
export type HookRun = z.infer<typeof HookRunSchema>;
export const HookRunsSchema = z.array(HookRunSchema).max(HOOK_RUNS_MAX + 20).optional();

// ── EngineGate / EngineRun (workflow engine → panel, aditivo) ──
// El pipeline oficial es el engine (`factory-default`): el gate humano y el
// avance del run se persisten en el work item para que el poll 2.5s los
// proyecte sin leer el run store. Ausentes en jobs legacy (restore
// tolerante, nunca rompe). `engineGate: null` = sin gate (se limpia al
// responder); `engineRun: null`/ausente = sin run asociado.
export const EngineGateSchema = z
  .object({
    nodeId: z.string().min(1).max(64),
    kind: z.enum(["spec-approval", "ask-human"]),
    message: z.string().max(2000),
    runId: z.string().min(1).max(128),
    attempt: z.number().int().min(1).max(10).optional(),
  })
  .nullable()
  .optional();

export type EngineGate = z.infer<typeof EngineGateSchema>;

export const EngineRunSchema = z
  .object({
    runId: z.string().min(1).max(128),
    workflow: z.string().min(1).max(128),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
    currentNodeId: z.string().max(64).nullable().optional(),
    completedNodes: z.array(z.string().min(1).max(64)).max(50).optional(),
    /**
     * Orden real de nodos del workflow (stepper del panel). Opcional:
     * jobs viejos no lo traen (el panel cae al stepper legacy).
     */
    nodes: z.array(z.string().min(1).max(64)).max(50).optional(),
    /**
     * Sesión OpenCode por nodo del run (`nodeId → sessionId`), para que
     * Agent Sessions muestre workflows arbitrarios sin mapeos hardcodeados.
     */
    nodeSessions: z.record(z.string(), z.string()).optional(),
    /**
     * Sesiones por ronda de nodos con múltiples ejecuciones (`loop` /
     * `loop_group`): cada ronda de IA abre su propia sesión y
     * `nodeSessions` solo guarda la última. Historial acotado en orden de
     * llegada para que Agent Sessions ofrezca una entrada por ronda.
     */
    nodeSessionRounds: z
      .array(
        z.object({
          nodeId: z.string().min(1).max(64),
          iteration: z.number().int().min(1).max(100),
          sessionId: z.string().min(1).max(128),
        }),
      )
      .max(50)
      .optional(),
    /**
     * Estado por nodo (`nodeId → estado`): fuente única del stepper de Agent
     * Progress y de las filas de Agent Sessions. Aditivo: jobs viejos no lo
     * traen y el panel cae a `completedNodes`/`currentNodeId`.
     */
    nodeStates: z
      .record(
        z.string(),
        z.enum(["pending", "running", "completed", "failed", "skipped", "cancelled"]),
      )
      .optional(),
    /**
     * Agente real por nodo (`nodeId → nombre`), espejado cuando la sesión se
     * attachea. La fila muestra la identidad que efectivamente ejecutó.
     */
    nodeAgents: z.record(z.string(), z.string().min(1).max(128)).optional(),
    startedAt: z.string().max(64).optional(),
  })
  .nullable()
  .optional();

export type EngineRun = z.infer<typeof EngineRunSchema>;

// ── Isolation (Factory jobs isolation, aditivo, restore-tolerante) ──
// Solo jobs creados con `issueRef` válido (hook post-201 en
// `headless-runtime/factory/factoryServer.ts`). `worktree` sigue siendo el
// ancla del repo (pact-estable); `isolation.worktreePath` es la jaula donde
// implement realmente corrió. Jobs viejos lo leen `undefined` (nunca se
// inventa). Vía rápida en memoria: el objeto; vía durable: la meta
// `isolation`/`pr` del timeline (mismo patrón que `issueRef`).
export const IsolationStateEnum = z.enum([
  "created",
  "ready",
  "pr-open",
  "pr-merged",
  "cleaned",
]);

export type IsolationState = z.infer<typeof IsolationStateEnum>;

export const IsolationSchema = z
  .object({
    branch: z.string().min(1).max(128),
    baseBranch: z.string().min(1).max(128),
    worktreePath: z.string().min(1),
    repoRoot: z.string().min(1),
    prNumber: z.number().int().positive().optional(),
    prUrl: z.string().min(1).optional(),
    state: IsolationStateEnum,
    createdAt: z.string().min(1),
  })
  .superRefine((d, ctx) => {
    if (d.prUrl !== undefined && d.prNumber === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "prNumber required when prUrl present",
        path: ["prNumber"],
      });
    }
    if (d.prUrl !== undefined) {
      try {
        const parsed = new URL(d.prUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          ctx.addIssue({
            code: "custom",
            message: "prUrl must be an http(s) URL",
            path: ["prUrl"],
          });
        }
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "prUrl must be a valid URL",
          path: ["prUrl"],
        });
      }
    }
  });

export type Isolation = z.infer<typeof IsolationSchema>;

// ── WorkItem ──
// Ola 4: reviewCount 0..2 + lastReview (opcionales para compat con Ola1-3 en disco)
// Se usa z.custom para evitar ciclo workItem ↔ review (review.ts no importa workItem).
const ReviewResultLazy = z.custom<ReviewResult>(
  (v) =>
    !!v &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>).workItemId === "string" &&
    typeof (v as Record<string, unknown>).verdict === "string",
);
export const WorkItemSchema = z.object({
  id: z.string().regex(/^job-[a-z0-9\-]+$/),
  prompt: z.string(),
  worktree: z.string().min(1),
  modelRef: ModelRefSchema.optional(),
  reviewerRef: ModelRefSchema.optional(),
  status: WorkItemStatusEnum,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  timeline: z.array(WorkItemTimelineEntrySchema),
  cost: WorkItemCostSchema,
  // Ola 15 E2 (aditivo, opcional): costo real medido. Jobs viejos no lo
  // tienen → undefined (restore tolerante); tracking apagado → null ("—").
  costSummary: CostSummarySchema.nullable().optional(),
  // Ola 16 E1 (aditivo, opcional): UNA sesión por (job, rol). Jobs viejos no
  // lo tienen → undefined (restore tolerante, nunca rompe).
  agentSessions: AgentSessionsSchema,
  dir: z.string().nullable(),
  dotDonePath: z.string(),
  runnerId: z.string(),
  logsNdjsonPath: z.string().optional(),
  sessionId: z.string().optional(),
  dashboardUrl: z.string().optional(),
  directory: z.string().optional(),
  phase: z.string(),
  // Compatibilidad legacy con FactoryJob
  state: z.enum(["queued", "running", "done", "error"]).optional(),
  logs: z.array(z.string()).optional(),
  // Ola 4 Review (sin budget: el count crece por revise hasta accept/ask_human)
  reviewCount: z.number().int().min(0).optional(),
  lastReview: ReviewResultLazy.optional(),
  // H-001 (aditivo, opcional): rutas creadas por el implement, espejo del
  // `createdFiles` de la meta del timeline. Jobs viejos no lo tienen →
  // undefined (restore tolerante, nunca rompe). Se persiste en job.json para
  // que la UI y el E2E-05 puedan exigir igualdad exacta contra disco.
  createdFiles: z.array(z.string()).optional(),
  // Factory isolation T01 (aditivo, opcional): jaula worktree + PR por job
  // con `issueRef`. Jobs viejos no lo tienen → undefined (restore
  // tolerante, nunca rompe). La meta `isolation`/`pr` del timeline es la
  // vía durable (igual que `issueRef`).
  isolation: IsolationSchema.optional(),
  // Hooks declarativos (aditivo, opcional): última corrida por hook. Jobs
  // viejos no lo tienen → undefined (restore tolerante, nunca rompe).
  hookRuns: HookRunsSchema,
  // Engine (aditivo, opcional): gate humano pendiente y avance del run
  // oficial. Jobs legacy no los tienen → undefined (restore tolerante).
  engineGate: EngineGateSchema,
  engineRun: EngineRunSchema,
});

export type WorkItem = z.infer<typeof WorkItemSchema>;

// ── State machine — Ola 4: Building(pass)→Review fire-and-forget; Review decide ──
// Ola 4: Building → Review (pass) | Building → Triage (fail) | Building → Complete (pact legacy).
// Review → Complete (accept) | Review → Building (revise con rondas restantes, ver MAX_REVIEW_ROUNDS) | stay Review (ask_human / rondas agotadas).
// Cancelled → Building: reopen DELIBERADO para el re-sync del engine (un run
// vivo que quedó con el job terminal, ej. reject + resume posterior). No hay
// otras salidas de Cancelled/Complete.
export const ALLOWED_TRANSITIONS: Record<
  WorkItemStatus,
  WorkItemStatus[]
> = {
  Intake: ["Foreman", "Cancelled"],
  Foreman: ["Building", "Triage", "Cancelled"],
  Triage: ["Foreman", "Review", "Cancelled"],
  Building: ["Complete", "Triage", "Cancelled", "Review"],
  Review: ["Complete", "Building", "Triage", "Cancelled"],
  Complete: [],
  Cancelled: ["Building"],
};

/**
 * Returns true if transition from -> to is allowed.
 */
export function canTransition(
  from: WorkItemStatus,
  to: WorkItemStatus,
): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Throws if transition is invalid. Used by WorkItemStore.transition.
 */
export function assertTransition(
  from: WorkItemStatus,
  to: WorkItemStatus,
): void {
  if (!canTransition(from, to)) {
    const err = new Error(
      `invalid transition ${from} → ${to}`,
    ) as Error & { status?: number };
    (err as { status?: number }).status = 409;
    throw err;
  }
}

/**
 * Map new status to legacy FactoryJobState for pact backward compat.
 * Intake/Foreman/Triage → queued, Building/Review → running, Complete → done, Cancelled → error
 */
export function mapStatusToLegacyState(
  status: WorkItemStatus,
): "queued" | "running" | "done" | "error" {
  switch (status) {
    case "Intake":
      return "queued";
    case "Foreman":
      return "queued";
    case "Triage":
      return "queued";
    case "Building":
      return "running";
    case "Review":
      return "running";
    case "Complete":
      return "done";
    case "Cancelled":
      return "error";
    default:
      return "queued";
  }
}

/**
 * Map legacy state to new status (for restore migration).
 */
export function mapLegacyStateToStatus(
  legacy: string,
): WorkItemStatus {
  switch (legacy) {
    case "queued":
      return "Intake";
    case "running":
      return "Building";
    case "done":
      return "Complete";
    case "error":
      return "Cancelled";
    default:
      return "Intake";
  }
}

/**
 * Creates a new WorkItem with Intake status and initial timeline entry.
 */
export function createWorkItemInput(params: {  id: string;
  prompt: string;
  worktree: string;
  modelRef?: ModelRef;
  reviewerRef?: ModelRef;
  phase?: string;
  runnerId?: string;
  dir?: string | null;
}): WorkItem {
  const nowIso = new Date().toISOString();
  const worktreeResolved = params.worktree;
  const dir = params.dir ?? null;
  const dotDonePath = dir ? `${dir}/.done` : "";
  const id = params.id;
  const status: WorkItemStatus = "Intake";
  const entry: WorkItemTimelineEntry = {
    id: `${id}-t0`,
    from: "Intake",
    to: "Intake",
    at: nowIso,
    actor: "user",
    message: "created Intake",
  };
  // For Intake creation, timeline contains single self-transition entry for traceability.
  // Alternative: empty timeline, but spec asks timeline.length >=1 and later transitions append.
  return {
    id,
    prompt: params.prompt,
    worktree: worktreeResolved,
    modelRef: params.modelRef,
    reviewerRef: params.reviewerRef,
    status,
    createdAt: nowIso,
    updatedAt: nowIso,
    timeline: [entry],
    cost: { estimatedUSD: 0, currency: "USD", breakdown: [] },
    dir,
    dotDonePath,
    runnerId: params.runnerId ?? "linux-build",
    phase: params.phase ?? "diagnosisLlm",
    state: mapStatusToLegacyState(status),
    logs: [],
    reviewCount: 0,
  };
}

// ── Parqueo honesto por reinicio (P3d) ──

/** Clave de meta del evento que marca un turno interrumpido por reinicio del daemon. */
export const BOOT_INTERRUPTED_META_KEY = "bootInterrupted";

/**
 * Clave de meta del evento de parqueo con el ISO de la última actividad real
 * (el `updatedAt` previo al marcador). Permite que el auto-resume distinga
 * una interrupción fresca de un job zombi de días atrás. Opcional en
 * marcadores viejos: sin ella el auto-resume cae al evento previo del timeline.
 */
export const BOOT_INTERRUPTED_AT_META_KEY = "interruptedAt";

/** Clave de meta del evento que limpia la marca (el turno se retomó). */
export const RESUMED_META_KEY = "resumed";

/**
 * Estados con worker vivo: si el daemon muere con un job acá, el turno
 * quedó interrumpido (los fire-and-forget no sobreviven al proceso).
 * Intake/Triage esperan humano y Complete/Cancelled son terminales: no se parquean.
 */
export const PARKABLE_STATUSES: readonly WorkItemStatus[] = ["Foreman", "Building", "Review"];

interface BootMarkerTimelineLike {
  meta?: Record<string, unknown> | undefined;
}

/**
 * True si el job necesita Retomar: está en estado obrero y la marca más
 * nueva del timeline es `bootInterrupted` (un `resumed` posterior la
 * limpia). Puro, nunca lanza.
 */
export function needsResume(
  status: unknown,
  timeline: readonly BootMarkerTimelineLike[] | null | undefined,
): boolean {
  try {
    if (typeof status !== "string") return false;
    if (!(PARKABLE_STATUSES as readonly string[]).includes(status)) return false;
    if (!Array.isArray(timeline)) return false;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const meta = timeline[i]?.meta;
      if (!meta || typeof meta !== "object") continue;
      if ((meta as Record<string, unknown>)[RESUMED_META_KEY] === true) return false;
      if ((meta as Record<string, unknown>)[BOOT_INTERRUPTED_META_KEY] === true) return true;
    }
    return false;
  } catch {
    return false;
  }
}
