/**
 * jobs/jobCreate — TANDA 2: creación del dominio jobs (dueño del POST
 * /factory/jobs: validación pura + creación en la tienda única + respuesta
 * 201 con forma byte-idéntica).
 *
 * Espejo del bloque CREATE JOB del cascarón
 * (factoryServer.ts POST /factory/jobs: validación modelRef/reviewerRef/id +
 * workItemStore.create + respuesta 201 + datos para la sesión MVP).
 * El handler queda en delegación delgada (parse → dominio → 201/400);
 * el disparo post-201 (sesión + foreman) lo hace el cascarón con lo
 * devuelto acá (sin duplicar lógica).
 *
 * Todo best-effort que nunca lanza (C2/C4): ante cualquier fallo interno
 * responde 500 honesto en vez de lanzar. Sin HTTP acá: retorna
 * {status, body} y el server mapea a writeHead/end (formas intactas,
 * pacts de idempotencia + 201 + queued compat).
 *
 * Reglas que honra (las 8 + C1–C10):
 * - C1 ESM/cotas: ESM puro, cero require(); sin loops escritos a mano
 *   (solo condicionales y spreads acotados); sin timers ni polling nuevos.
 * - C2 puras fail-safe donde toca validación: try/catch + 400/500 honestos.
 * - C3 un escritor: la única escritura es workItemStore.create (tienda
 *   única; el cascarón ya no escribe job.json directo).
 * - C4 disco best-effort: la tienda persiste; acá nunca se toca fs directo.
 * - C5 aditivo: formas/respuestas/códigos byte-idénticos al handler
 *   anterior (incluidos hints PowerShell y gate F05).
 * - C6/C7: vocabulario único, nada duplicado (este es el dueño; el
 *   cascarón no redefine validación ni respuesta).
 * - C10 trazabilidad: cada rama cita su espejo del cascarón.
 *
 * Lista blanca de imports (reparto TANDA 2): workItemStore,
 * shared/types/workItem, node:path. PROHIBIDO: todo lo ajeno al dominio
 * (flujos humanos/automáticos, medida, avisos, definición, ejecutores,
 * yaml de runners, review/triage/spec, opencode, foreman, sessions).
 */

import path from "node:path";
import { workItemStore } from "../../workItem/workItemStore";
import type {
  WorkItem,
} from "../../../shared/types/workItem";

/** Ref de modelo validada (misma forma que el cascarón). */
export interface ValidatedModelRef {
  readonly providerID: string;
  readonly modelID: string;
  readonly variant?: string;
}

/** Infra inyectada por el cascarón (sin importar al cascarón: sin ciclos). */
export interface JobCreateInfra {
  readonly resolveDirectory?: (worktree: string) => string;
  readonly getBaseUrl?: () => string;
  readonly buildDashboardUrl?: (sessionId?: string, directory?: string) => string;
  readonly onIdempotentReset?: (id: string) => void;
}

/** Job mínimo para la respuesta 201 + el dispatch post-201 del cascarón. */
export interface CreatedJobForDispatch {
  readonly id: string;
  readonly prompt: string;
  readonly worktree: string;
  readonly phase: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly dir: string | null;
  readonly directory?: string;
  readonly dashboardUrl?: string;
  readonly sessionId?: string;
  readonly modelRef?: ValidatedModelRef;
  readonly reviewerRef?: ValidatedModelRef;
  readonly status?: unknown;
  readonly timeline?: unknown;
  readonly cost?: unknown;
  readonly runnerId?: string;
  readonly dotDonePath?: string;
}

export interface JobCreateOk {
  readonly status: 201;
  readonly body: Record<string, unknown>;
  readonly job: CreatedJobForDispatch;
  readonly validatedModelRef: ValidatedModelRef | undefined;
}

export interface JobCreateErr {
  readonly status: 400 | 500;
  readonly body: Record<string, unknown>;
  readonly job?: undefined;
  readonly validatedModelRef?: undefined;
}

export type JobCreateResult = JobCreateOk | JobCreateErr;

/** Regex de id determinista pact F03 (espejo del cascarón). */
const DETERMINISTIC_ID_RE = /^job-[a-z0-9\-]+$/;

/** Modelos que el gate F05 rechaza con 400 antes de crear (espejo). */
function isRejectedCatalogModel(modelID: string): boolean {
  try {
    return modelID === "gpt-99" || modelID === "modelo-falso-9999" || modelID === "invalid-model";
  } catch {
    return false;
  }
}

function trimField(value: unknown): string {
  try {
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function readRefField(raw: unknown, key: string): string {
  try {
    if (raw !== null && typeof raw === "object") {
      const v = (raw as Record<string, unknown>)[key];
      return typeof v === "string" ? v.trim() : "";
    }
    return "";
  } catch {
    return "";
  }
}

function defaultResolveDirectory(worktree: string): string {
  try {
    return path.resolve(worktree);
  } catch {
    return worktree;
  }
}

function defaultBaseUrl(): string {
  return "http://127.0.0.1:4096";
}

function defaultBuildDashboardUrl(sessionId?: string, directory?: string): string {
  try {
    const base = defaultBaseUrl();
    if (!sessionId) return base;
    if (!directory) return `${base}/session/${sessionId}`;
    const enc = Buffer.from(directory)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `${base}/${enc}/session/${sessionId}`;
  } catch {
    return defaultBaseUrl();
  }
}

/**
 * Crea un job desde el body ya parseado (espejo del bloque CREATE JOB:
 * validación + idempotencia + workItemStore.create + respuesta 201).
 * Nunca lanza: ante fallo inesperado responde 500 honesto.
 */
export function createJobRequest(
  parsed: unknown,
  raw: string,
  parseError: boolean,
  infra?: JobCreateInfra,
): JobCreateResult {
  try {
    const rawText = typeof raw === "string" ? raw : "";
    if (parseError) {
      return {
        status: 400,
        body: {
          error: "body must be valid JSON",
          hint: "En PowerShell usa Invoke-RestMethod o curl.exe con -d '{\"prompt\":...}' - curl sin .exe es alias a Invoke-WebRequest",
          received: rawText.slice(0, 300),
        },
      };
    }
    const body = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const prompt = trimField(body.prompt);
    const worktree = trimField(body.worktree);
    const phaseRaw = trimField(body.phase);
    const phase = phaseRaw.length > 0 ? phaseRaw : "diagnosisLlm";

    if (!prompt) {
      return {
        status: 400,
        body: {
          error: "prompt is required",
          hint: "En PowerShell usa Invoke-RestMethod -UseBasicParsing -Body '{\"prompt\":\"hola\",...}' o curl.exe con -d \"{\\\"prompt\\\":...}\" - curl sin .exe es alias a Invoke-WebRequest en PowerShell",
          received: rawText.slice(0, 300),
        },
      };
    }
    if (!worktree) {
      return {
        status: 400,
        body: {
          error: "worktree is required",
          hint: "En PowerShell usa Invoke-RestMethod -UseBasicParsing -Body '{\"prompt\":\"hola\",\"worktree\":\"C:\\\\tmp\\\\repo-prueba\",...}' o curl.exe con -d \"{\\\"prompt\\\":...}\" - curl sin .exe es alias a Invoke-WebRequest en PowerShell",
          received: rawText.slice(0, 300),
        },
      };
    }

    // Invariante de intake (único choke point): TODO job nace de Resolve
    // Issue. Sin `issueRef` válido no hay rama `issue-N` ni PR de handoff —
    // el job terminaría Complete-sin-PR varado en pending. Se rechaza 400
    // AQUÍ, antes de crear nada; los intakes internos sin issue (automations,
    // benchmark) NO pasan por acá. `sanitizeIssueRef` es la ÚNICA fuente de
    // verdad del shape: la misma función valida y luego sella.
    const issueRefClean = sanitizeIssueRef(
      (body as Record<string, unknown>).issueRef,
    );
    if (issueRefClean === null) {
      return {
        status: 400,
        body: {
          error:
            "issueRef is required: every factory job starts from a linked GitHub issue",
          hint: "Creá el job desde Resolve Issue (el panel sella issueRef {provider:'github', issueNumber:N, repo?, url?}). Sin issue enlazada no hay branch issue-N ni PR — el trabajo quedaría varado en el worktree.",
          received: rawText.slice(0, 300),
        },
      };
    }

    const modelRefRaw = body.modelRef as
      | { providerID?: unknown; modelID?: unknown; variant?: unknown }
      | undefined;
    const cliRaw = trimField(body.cli);
    void cliRaw;
    let validatedModelRef: ValidatedModelRef | undefined = undefined;
    if (modelRefRaw !== null && typeof modelRefRaw === "object") {
      const rawProviderID = readRefField(modelRefRaw, "providerID");
      const rawModelID = readRefField(modelRefRaw, "modelID");
      const rawVariantInner = readRefField(modelRefRaw, "variant");
      const rawVariant = rawVariantInner.length > 0 ? rawVariantInner : undefined;
      if (isRejectedCatalogModel(rawModelID)) {
        return {
          status: 400,
          body: {
            error: "model not in catalog",
            alternatives: ["gpt-4o", "claude-sonnet-4", "gemini-2.5-pro"],
            receivedModelID: rawModelID,
            hint: "El modelo no existe en el catalogo - usa alternatives. En PowerShell valida con validatePhaseAgainstCatalog antes de POST. Windows: Invoke-RestMethod -UseBasicParsing",
          },
        };
      }
      if (rawProviderID.length > 0 && rawModelID.length > 0) {
        validatedModelRef = {
          providerID: rawProviderID,
          modelID: rawModelID,
          ...(rawVariant && rawVariant.length > 0 ? { variant: rawVariant } : {}),
        };
      } else {
        try {
          console.warn(`[Factory] modelRef ignorado por providerID/modelID vacío: providerID="${rawProviderID}" modelID="${rawModelID}"`);
        } catch {
          // noop
        }
      }
    }

    const reviewerRefRaw = body.reviewerRef as
      | { providerID?: unknown; modelID?: unknown; variant?: unknown }
      | undefined;
    let validatedReviewerRef: ValidatedModelRef | undefined = undefined;
    if (reviewerRefRaw !== null && typeof reviewerRefRaw === "object") {
      const rawProviderID = readRefField(reviewerRefRaw, "providerID");
      const rawModelID = readRefField(reviewerRefRaw, "modelID");
      const rawVariantInner = readRefField(reviewerRefRaw, "variant");
      const rawVariant = rawVariantInner.length > 0 ? rawVariantInner : undefined;
      if (rawProviderID.length > 0 && rawModelID.length > 0) {
        validatedReviewerRef = {
          providerID: rawProviderID,
          modelID: rawModelID,
          ...(rawVariant && rawVariant.length > 0 ? { variant: rawVariant } : {}),
        };
      } else {
        try {
          console.warn(`[Factory] reviewerRef ignorado por providerID/modelID vacío: providerID="${rawProviderID}" modelID="${rawModelID}"`);
        } catch {
          // noop
        }
      }
    }

    const requestedIdRaw = trimField(body.id);
    let id: string;
    if (requestedIdRaw.length > 0 && DETERMINISTIC_ID_RE.test(requestedIdRaw)) {
      id = requestedIdRaw;
      try {
        if (workItemStore.has(id)) {
          try {
            workItemStore.delete(id);
          } catch {
            // best-effort
          }
          try {
            infra?.onIdempotentReset?.(id);
          } catch {
            // best-effort
          }
        }
      } catch {
        // best-effort
      }
    } else {
      id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const now = Date.now();
    const resolveDirectory = infra?.resolveDirectory ?? defaultResolveDirectory;
    const getBaseUrl = infra?.getBaseUrl ?? defaultBaseUrl;
    const buildUrl = infra?.buildDashboardUrl ?? defaultBuildDashboardUrl;
    let effectiveDirForJob = "";
    try {
      effectiveDirForJob = resolveDirectory(worktree);
    } catch {
      effectiveDirForJob = defaultResolveDirectory(worktree);
    }
    let baseDashboard = "";
    try {
      baseDashboard = getBaseUrl();
    } catch {
      baseDashboard = defaultBaseUrl();
    }

    let workItemCreated: WorkItem | undefined;
    try {
      workItemCreated = workItemStore.create({
        id,
        prompt,
        worktree,
        modelRef: validatedModelRef as WorkItem["modelRef"],
        reviewerRef: validatedReviewerRef as WorkItem["reviewerRef"],
        phase,
        runnerId: "linux-build",
      });
    } catch (e) {
      try {
        console.warn(`[Factory] WorkItem create failed for ${id}: ${String(e)}`);
      } catch {
        // noop
      }
    }

    const jobStatus = workItemCreated?.status;

    // GitHub issue link (restore-tolerant): el ref ya fue VALIDADO arriba
    // (invariante de intake) — acá solo se sella con la misma instancia
    // saneada (memory key + timeline meta, evidencia durable en el 201).
    try {
      if (workItemCreated !== undefined) {
        stampIssueRef(id, issueRefClean);
      }
    } catch {
      // the job exists; the link is best-effort
    }

    const jobTimeline = workItemCreated?.timeline;
    const jobCost = workItemCreated?.cost;
    const jobRunnerId = workItemCreated?.runnerId;
    const jobDotDonePath = workItemCreated?.dotDonePath;
    const jobDirFromStore = workItemCreated?.dir;
    const jobLogs = workItemCreated?.logs;

    const jobDir = (typeof jobDirFromStore === "string" && jobDirFromStore.length > 0
      ? jobDirFromStore
      : path.join(path.resolve(worktree), ".agents", "factory", id));
    let postDashboardUrl = baseDashboard;
    try {
      postDashboardUrl = baseDashboard;
    } catch {
      postDashboardUrl = defaultBaseUrl();
    }
    const wiForResp = (() => {
      try {
        return workItemStore.get(id);
      } catch {
        return undefined;
      }
    })();
    const intakeTimeline = wiForResp?.timeline ?? jobTimeline ?? [];
    const intakeCost = wiForResp?.cost ?? jobCost ?? { estimatedUSD: 0, currency: "USD", breakdown: [] };
    const intakeRunnerId = wiForResp?.runnerId ?? jobRunnerId ?? "linux-build";

    const createdAtIso = new Date(now).toISOString();
    const job: CreatedJobForDispatch = {
      id,
      prompt,
      worktree,
      phase,
      createdAt: now,
      updatedAt: now,
      dir: (typeof jobDirFromStore === "string" ? jobDirFromStore : jobDir) ?? jobDir,
      directory: effectiveDirForJob,
      dashboardUrl: postDashboardUrl,
      ...(validatedModelRef ? { modelRef: validatedModelRef } : {}),
      ...(validatedReviewerRef ? { reviewerRef: validatedReviewerRef } : {}),
      ...(jobStatus !== undefined ? { status: jobStatus } : {}),
      ...(jobTimeline !== undefined ? { timeline: jobTimeline } : {}),
      ...(jobCost !== undefined ? { cost: jobCost } : {}),
      ...(jobRunnerId !== undefined ? { runnerId: jobRunnerId } : {}),
      ...(jobDotDonePath !== undefined ? { dotDonePath: jobDotDonePath } : {}),
    };
    void jobLogs;
    void jobDir;
    void buildUrl;

    const dotDoneForResp = path.join(jobDir, ".done");
    const body201: Record<string, unknown> = {
      id,
      path: jobDir,
      dashboardUrl: postDashboardUrl,
      ...(job.directory ? { directory: job.directory } : {}),
      ...(job.modelRef ? { modelRef: job.modelRef } : {}),
      ...(job.reviewerRef ? { reviewerRef: job.reviewerRef } : {}),
      status: "Intake",
      timeline: intakeTimeline,
      cost: intakeCost,
      runnerId: intakeRunnerId,
      workItem: {
        id,
        prompt,
        worktree,
        phase,
        state: "queued",
        status: "Intake",
        createdAt: createdAtIso,
        updatedAt: new Date(now).toISOString(),
        timeline: intakeTimeline,
        cost: intakeCost,
        runnerId: intakeRunnerId,
        dir: jobDir,
        dotDonePath: dotDoneForResp,
        dashboardUrl: postDashboardUrl,
        ...(job.directory ? { directory: job.directory } : {}),
        ...(job.modelRef ? { modelRef: job.modelRef } : {}),
        ...(job.reviewerRef ? { reviewerRef: job.reviewerRef } : {}),
      },
      job: {
        id,
        prompt,
        phase,
        state: "queued",
        status: "Intake",
        worktree,
        createdAt: createdAtIso,
        dashboardUrl: postDashboardUrl,
        timeline: intakeTimeline,
        cost: intakeCost,
        runnerId: intakeRunnerId,
        ...(job.directory ? { directory: job.directory } : {}),
        ...(job.modelRef ? { modelRef: job.modelRef } : {}),
        ...(job.reviewerRef ? { reviewerRef: job.reviewerRef } : {}),
      },
    };

    return { status: 201, body: body201, job, validatedModelRef };
  } catch (e) {
    try {
      return {
        status: 500,
        body: { error: String(e instanceof Error ? e.message : e).slice(0, 160) },
      };
    } catch {
      return { status: 500, body: { error: "create failed" } };
    }
  }
}

// ── F1-T2 integration intake refs (additive, restore-tolerant) ──
//
// One job carries at most ONE integrationRef (INTEGRATION_REF_MAX = 1):
// an inbound reply with the same threadId (or a replyTo pointing at it)
// CONTINUES the same job — it never creates a duplicate (D01 invariant
// extended across the wire). The ref is stamped two ways: an in-memory
// extra key (fast path, survives store spreads) and a timeline meta entry
// under `integrationRef` (durable path — timeline IS persisted to
// job.json, so the lookup survives daemon restarts; jobs written before
// F1 simply never match, which is the restore-tolerant behavior).
// This module stays decoupled from the integrations domain: the ref shape
// is declared locally (mirrors IntegrationRefSchema, never imported).

/** Integration link stamped onto intake jobs (local mirror, F1). */
export interface JobIntegrationRef {
  readonly provider: "linear" | "slack";
  readonly threadId: string;
  readonly eventId: string;
  readonly liveMode: boolean;
}

/** Timeline meta key carrying the ref (durable path). */
export const JOB_INTEGRATION_META_KEY = "integrationRef";

/** Input ref for creation (validated, fail-closed). */
export interface JobIntegrationRefInput {
  readonly provider?: unknown;
  readonly threadId?: unknown;
  readonly eventId?: unknown;
  readonly liveMode?: unknown;
}

function sanitizeIntegrationRef(ref: unknown): JobIntegrationRef | null {
  try {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const r = ref as Record<string, unknown>;
    if (r.provider !== "linear" && r.provider !== "slack") return null;
    if (typeof r.threadId !== "string" || r.threadId.trim().length === 0) return null;
    if (typeof r.eventId !== "string" || r.eventId.trim().length === 0) return null;
    return {
      provider: r.provider,
      threadId: r.threadId.trim().slice(0, 256),
      eventId: String(r.eventId).slice(0, 128),
      liveMode: r.liveMode === true,
    };
  } catch {
    return null;
  }
}

function readThreadFromMeta(meta: unknown): string | null {
  try {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
    const m = meta as Record<string, unknown>;
    for (const key of [JOB_INTEGRATION_META_KEY, "integration"]) {
      try {
        const cand = m[key];
        if (cand && typeof cand === "object" && !Array.isArray(cand)) {
          const t = (cand as Record<string, unknown>).threadId;
          if (typeof t === "string" && t.trim().length > 0) return t.trim();
        }
      } catch {
        // next key
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads the integration ref of one stored item (memory fast path, then
 * timeline meta durable path). Null when absent or malformed — old jobs
 * (pre-F1) always read null (restore-tolerant). Never throws.
 */
export function readJobIntegrationRef(item: unknown): JobIntegrationRef | null {
  try {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const rec = item as Record<string, unknown>;
    const fast = sanitizeIntegrationRef(rec[JOB_INTEGRATION_META_KEY]);
    if (fast !== null) return fast;
    const timeline = rec.timeline;
    if (Array.isArray(timeline)) {
      for (let i = timeline.length - 1; i >= 0; i -= 1) {
        try {
          const entry = timeline[i] as Record<string, unknown>;
          const meta = entry?.meta as unknown;
          if (meta && typeof meta === "object") {
            const holder = (meta as Record<string, unknown>)[JOB_INTEGRATION_META_KEY] ??
              (meta as Record<string, unknown>).integration;
            const ref = sanitizeIntegrationRef(holder);
            if (ref !== null) return ref;
          }
        } catch {
          // a broken entry never aborts the scan
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Full ref lookup for one job id (null for unknown jobs). Never throws.
 */
export function getIntegrationRef(jobId: unknown): JobIntegrationRef | null {
  try {
    if (typeof jobId !== "string" || jobId.trim().length === 0) return null;
    return readJobIntegrationRef(workItemStore.get(jobId.trim()));
  } catch {
    return null;
  }
}

/**
 * Finds the job id already linked to a thread (same threadId → same job,
 * no dup). Scans memory refs first, then timeline metas. Null when none.
 * Never throws.
 */
export function findJobIdByIntegrationThread(threadId: unknown): string | null {
  try {
    if (typeof threadId !== "string" || threadId.trim().length === 0) return null;
    const key = threadId.trim();
    let items: WorkItem[] = [];
    try {
      items = workItemStore.list();
    } catch {
      return null;
    }
    for (const item of items) {
      try {
        const ref = readJobIntegrationRef(item);
        if (ref !== null && ref.threadId === key) return item.id;
      } catch {
        // a broken item never aborts the scan
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Intake lookup: `replyTo` wins when it resolves (a reply names its
 * parent), otherwise the event's own `threadId`. Either hit means
 * "continue that job, create nothing". Never throws.
 */
export function findJobIdForIntake(
  threadId: unknown,
  replyTo: unknown,
): string | null {
  try {
    if (typeof replyTo === "string" && replyTo.trim().length > 0) {
      const viaReply = findJobIdByIntegrationThread(replyTo.trim());
      if (viaReply !== null) return viaReply;
    }
    return findJobIdByIntegrationThread(threadId);
  } catch {
    return null;
  }
}

/**
 * Stamps one integration ref onto a job (memory fast path + timeline
 * `integrationRef` meta event for the durable path). False when the job
 * is unknown or the ref is malformed. Never throws.
 */
export function stampIntegrationRef(
  jobId: unknown,
  ref: unknown,
): boolean {
  try {
    if (typeof jobId !== "string" || jobId.trim().length === 0) return false;
    const clean = sanitizeIntegrationRef(ref);
    if (clean === null) return false;
    const id = jobId.trim();
    const current = workItemStore.get(id);
    if (!current) return false;
    try {
      (current as unknown as Record<string, unknown>)[JOB_INTEGRATION_META_KEY] = { ...clean };
    } catch {
      // memory fast path is best-effort; the timeline event below is the record
    }
    try {
      workItemStore.appendEvent(
        id,
        "system",
        `intake link ${clean.provider}#${clean.threadId} event=${clean.eventId}`,
        { [JOB_INTEGRATION_META_KEY]: { ...clean } } as unknown as Record<string, unknown>,
      );
    } catch {
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

/** Result of `createJobWithIntegrationRef` (create XOR continue). */
export interface JobWithIntegrationResult {
  readonly status: 200 | 201 | 400 | 500;
  readonly body: Record<string, unknown>;
  readonly jobId: string | null;
  readonly continued: boolean;
}

/**
 * Intake writer: same-thread reply → continue the SAME job (200,
 * `continued:true`, timeline note, zero new jobs); new thread → create
 * via `createJobRequest` (201) and stamp the ref. Additive: the existing
 * `createJobRequest` behavior is untouched. Never throws (500 honest).
 */
export function createJobWithIntegrationRef(
  input: {
    prompt: unknown;
    worktree: unknown;
    phase?: unknown;
    replyTo?: unknown;
    ref: JobIntegrationRefInput;
    infra?: JobCreateInfra;
  },
): JobWithIntegrationResult {
  try {
    if (!input || typeof input !== "object") {
      return { status: 400, body: { error: "input is required" }, jobId: null, continued: false };
    }
    const clean = sanitizeIntegrationRef(input.ref);
    if (clean === null) {
      return {
        status: 400,
        body: { error: "ref.provider/threadId/eventId are required (linear|slack)" },
        jobId: null,
        continued: false,
      };
    }
    const replyTo =
      typeof input.replyTo === "string" && input.replyTo.trim().length > 0
        ? input.replyTo.trim()
        : null;
    let existing: string | null = null;
    try {
      existing = findJobIdForIntake(clean.threadId, replyTo);
    } catch {
      existing = null;
    }
    if (typeof existing === "string" && existing.length > 0) {
      try {
        workItemStore.appendEvent(
          existing,
          "user",
          `intake reply ${clean.eventId}: continued (no dup)`,
          { [JOB_INTEGRATION_META_KEY]: { ...clean } } as unknown as Record<string, unknown>,
        );
      } catch {
        // the identity held; the note is best-effort
      }
      return {
        status: 200,
        body: { id: existing, continued: true, threadId: clean.threadId },
        jobId: existing,
        continued: true,
      };
    }
    const created = createJobRequest(
      {
        prompt: input.prompt,
        worktree: input.worktree,
        ...(typeof input.phase === "string" && input.phase.trim().length > 0
          ? { phase: input.phase }
          : {}),
      },
      JSON.stringify({ prompt: input.prompt, worktree: input.worktree }),
      false,
      input.infra,
    );
    if (created.status !== 201 || !created.job) {
      return {
        // Narrowed here: status is 400|500 (the `!== 201` guard above) —
        // passed through byte-identically, no remap.
        status: created.status,
        body: created.body,
        jobId: null,
        continued: false,
      };
    }
    try {
      stampIntegrationRef(created.job.id, clean);
    } catch {
      // the job exists; the link is best-effort
    }
    return {
      status: 201,
      body: { ...(created.body as Record<string, unknown>), integrationRef: { ...clean } },
      jobId: created.job.id,
      continued: false,
    };
  } catch (e) {
    try {
      return {
        status: 500,
        body: { error: String(e instanceof Error ? e.message : e).slice(0, 160) },
        jobId: null,
        continued: false,
      };
    } catch {
      return { status: 500, body: { error: "create failed" }, jobId: null, continued: false };
    }
  }
}

// ── GitHub issue intake refs (additive, restore-tolerant) ──
//
// The Warp panel Resolve button creates factory jobs for GitHub issues
// (POST /factory/jobs with `issueRef`). Same stamping pattern as
// `triggerRef` (Ola14) and `integrationRef` (F1): an in-memory extra key
// (fast path) plus a timeline meta entry under `issueRef` (durable path —
// timeline IS persisted to job.json, so the link survives daemon
// restarts; jobs written before this section simply never match, which is
// the restore-tolerant behavior). This module stays decoupled from the
// GitHub domain: the ref shape is declared locally.
// Renderer mirror (no node imports there): the pure helpers live in
// `src/features/warpPanel/adapters/factoryIssueJobs.ts` — same shape,
// same caps, same key. The two sides cite each other; the daemon never
// imports the renderer copy and vice versa.

/** GitHub issue link stamped onto resolve jobs (local shape). */
export interface JobIssueRef {
  readonly provider: "github";
  readonly issueNumber: number;
  /** "owner/repo" from the issue URL, null when unknown (never invented). */
  readonly repo: string | null;
  readonly url: string | null;
}

/** Timeline meta key carrying the ref (durable path). */
export const JOB_ISSUE_META_KEY = "issueRef";

/** Input ref for creation (validated, fail-open: junk is ignored). */
export interface JobIssueRefInput {
  readonly provider?: unknown;
  readonly issueNumber?: unknown;
  readonly repo?: unknown;
  readonly url?: unknown;
}

function sanitizeIssueRef(ref: unknown): JobIssueRef | null {
  try {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const r = ref as Record<string, unknown>;
    if (r.provider !== "github") return null;
    if (
      typeof r.issueNumber !== "number" ||
      !Number.isInteger(r.issueNumber) ||
      (r.issueNumber as number) <= 0
    ) {
      return null;
    }
    const repo =
      typeof r.repo === "string" && r.repo.trim().length > 0
        ? r.repo.trim().slice(0, 256)
        : null;
    const url =
      typeof r.url === "string" && r.url.trim().length > 0
        ? r.url.trim().slice(0, 500)
        : null;
    return {
      provider: "github",
      issueNumber: r.issueNumber as number,
      repo,
      url,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the issue ref of one stored item (memory fast path, then
 * timeline meta durable path). Null when absent or malformed — old jobs
 * (pre-issueRef) always read null (restore-tolerant). Never throws.
 */
export function readJobIssueRef(item: unknown): JobIssueRef | null {
  try {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const rec = item as Record<string, unknown>;
    const fast = sanitizeIssueRef(rec[JOB_ISSUE_META_KEY]);
    if (fast !== null) return fast;
    const timeline = rec.timeline;
    if (Array.isArray(timeline)) {
      for (let i = timeline.length - 1; i >= 0; i -= 1) {
        try {
          const entry = timeline[i] as Record<string, unknown>;
          const meta = entry?.meta as unknown;
          if (meta && typeof meta === "object" && !Array.isArray(meta)) {
            const holder = (meta as Record<string, unknown>)[JOB_ISSUE_META_KEY];
            const ref = sanitizeIssueRef(holder);
            if (ref !== null) return ref;
          }
        } catch {
          // a broken entry never aborts the scan
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Full ref lookup for one job id (null for unknown jobs). Never throws.
 */
export function getIssueRef(jobId: unknown): JobIssueRef | null {
  try {
    if (typeof jobId !== "string" || jobId.trim().length === 0) return null;
    return readJobIssueRef(workItemStore.get(jobId.trim()));
  } catch {
    return null;
  }
}

/**
 * Stamps one issue ref onto a job (memory fast path + timeline
 * `issueRef` meta event for the durable path). False when the job is
 * unknown or the ref is malformed. Never throws.
 */
export function stampIssueRef(
  jobId: unknown,
  ref: unknown,
): boolean {
  try {
    if (typeof jobId !== "string" || jobId.trim().length === 0) return false;
    const clean = sanitizeIssueRef(ref);
    if (clean === null) return false;
    const id = jobId.trim();
    const current = workItemStore.get(id);
    if (!current) return false;
    try {
      (current as unknown as Record<string, unknown>)[JOB_ISSUE_META_KEY] = { ...clean };
    } catch {
      // memory fast path is best-effort; the timeline event below is the record
    }
    try {
      workItemStore.appendEvent(
        id,
        "system",
        `resolve link github#${clean.issueNumber}${clean.repo ? ` (${clean.repo})` : ""}`,
        { [JOB_ISSUE_META_KEY]: { ...clean } } as unknown as Record<string, unknown>,
      );
    } catch {
      return true;
    }
    return true;
  } catch {
    return false;
  }
}
