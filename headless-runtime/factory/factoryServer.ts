/**
 * Factory daemon real - singleton que responde GET /factory/health
 * y gestiona jobs en memoria + disco ({worktree}/.agents/factory/<id>/).
 *
 * Contratos:
 * - Puerto fijo 17680, si ocupado prueba 17681-17690 con probarBind secuencial.
 * - Si @opencode-ai/sdk esta instalado, se detecta y se loggea, pero el
 *   servidor factory sigue siendo http minimal para garantizar health
 *   aunque opencode no este (daemon REAL, no localStorage mock).
 * - Health: GET /factory/health -> 200 {queue:{pending,running}, uptime, version:"local", ts}
 * - Jobs: POST /factory/jobs, GET /factory/jobs, GET /factory/jobs/:id, GET /factory/jobs/:id/events (SSE)
 *
 * Uso:
 *   import { ensureFactoryServer, closeFactoryServer, getFactoryPort } from "../headless-runtime/factory/factoryServer.ts"
 *   await ensureFactoryServer() // en electron/main.ts app.whenReady
 *
 * Standalone (sin Electron):
 *   node --loader tsx headless-runtime/factory/factoryServer.ts
 *   o node scripts/start-factory.mjs
 */

import http from "node:http";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTermCanvasDataDir } from "../../shared/termcanvas-instance";
import { getFactoryPorts, getRunner } from "./agentLoader";
import { SESSION_CREATE_FUSE_MS, withTransportRetry } from "../llm/agentTransport";
import { isPipelineLive, markPipelineLive } from "./pipelineLive";
import { allSessionsExtras, hookRunsExtras, roleSessionExtras } from "../workItem/jobView";
import { hookStagesExtras } from "./agents/agentHooks";
import { probarBind } from "../interview/puerto-libre";
import { workItemStore } from "../workItem/workItemStore";
import { appendWorkItemLog, readJobIndexBases, readJobIndexDirs, shouldRestoreJobDir, writeWorkItemJsonAtomic } from "../workItem/workItemDisk";
// FASE 2 E1: la vista única la aplica jobs/jobService (este cascarón ya no
// proyecta directo; el import se mudó al dominio dueño).
import * as resultStore from "../workItem/resultStore";
import { foremanService } from "../foreman/foreman";
import { foremanLogStore } from "../foreman/foremanLog";
import { runnerService } from "../runner/runnerService";
import { opencodeServerManager } from "../opencodeServerManager";
import type {
  WorkItem,
  WorkItemStatus,
} from "../../shared/types/workItem";
import { BOOT_INTERRUPTED_META_KEY, PARKABLE_STATUSES, mapStatusToLegacyState, needsResume } from "../../shared/types/workItem";
// FASE 2 E1: el MATCH por tabla vive en los dominios dueños (jobs/jobRoutes,
// verify/verifyRoutes); este cascarón ya no matchea directo.
// ── FASE 2 E1 — Dominios jobs + verify (delegación delgada, C5 aditivo) ──
// Dueño E1: jobs/ (lista/detalle/salud + lecturas por id) y verify/
// (lectura + reintento con dedupe). El server conserva formas/handlers;
// solo el MATCH y la lectura delegan. Nada de revisión/triageSpec se toca
// (E2 es dueño).
import {
  parseJobLogsRoute as parseJobLogsRouteT2,
} from "./jobs/jobRoutes";
import { applyDashboardUrls as applyDashboardUrlsTA, getJobDetail, getJobEventsSnapshot, getJobLogs as getJobLogsT2, listJobs, listJobSummaries, readJobBuildLog, readJobResultRaw as readJobResultRawTA, requestJobCancel as requestJobCancelTA, requestJobResume as requestJobResumeTA, resolveDashboardMigration as resolveDashboardMigrationTA, type JobExtrasFor } from "./jobs/jobService";
import { createJobRequest as createJobRequestT2, getIssueRef } from "./jobs/jobCreate";
import { consumeAgentsDirty, markAgentsDirty } from "./agents/agentDirty";
import {
  clearWorkerActive,
  hasActiveWorkers,
  isWorkerActive,
  markWorkerActive,
} from "../workItem/workerActivity";
// ── T01 factory isolation (daemon core; panel surface reads timeline meta) ──
// Dueños: isolation/gitWorktree (jail), isolation/gitHubPr (handoff PR),
// isolation/isolationStore (puros: gate, resolver, guards). Delegación
// delgada: este cascarón conserva formas/handlers y solo suma los hooks
// post-201 / post-Complete más la única ruta nueva (DELETE worktree).
import {
  decideWorktreeDelete,
  isPactIsolationJob,
  parseIssueTitleFromPrompt,
  parseWorktreeDeletePath,
  readIsolationFromTimeline,
  readPrFromTimeline,
} from "./isolation/isolationStore";
import type { PrVisibility } from "./isolation/isolationStore";
import {
  ensureIsolatedWorktree,
  isWorkingTreeDirty,
  removeIsolatedWorktree,
} from "./isolation/gitWorktree";
// B2: session cwd = isolation jail when recorded, else the anchor.
import { resolveSessionWorktree } from "./isolation/sessionWorktree";
import { maybeOpenPrForCompletedJob, gateAcceptOnBranchDiff, notePrMergedEqual, readPrState } from "./isolation/gitHubPr";
import {
  parseVerifyGetPath as parseVerifyGetPathE1,
  parseVerifyRetryPath as parseVerifyRetryPathE1,
} from "./verify/verifyRoutes";
import {
  checkVerifyRetryGuards as checkVerifyRetryGuardsE1,
  readVerifyById,
  requestVerifyRetry as requestVerifyRetryT2,
  runVerifyRetryWorker as runVerifyRetryWorkerT2,
  scheduleVerifyRetryRun,
} from "./verify/verifyService";
// ── FIN FASE 2 E1 — imports de dominios ──
// ── FASE 2 E2 — Dominios review + triageSpec (delegación delgada, C5 aditivo) ──
// Dueño E2: review/ (lectura, raw, accept igual, reintento a Building,
// reintento solo-review) y triageSpec/ (respond/approve + extras para vista).
// El server conserva formas/handlers/respuestas; solo la lógica delega.
// Verify NO se toca (dueño E1). Nada de measure/notify/definition/runner acá.
import {
  parseReviewAcceptPath,
  parseReviewPath,
  parseReviewRetryPath,
  parseReviewRetryReviewPath,
} from "./review/reviewRoutes";
import {
  acceptReviewEqual,
  getReviewById,
  readReviewRawById,
  requestReviewRetryOnly,
  requestReviewRetryToBuilding,
} from "./review/reviewActions";
import {
  parseSpecApprovePath as parseSpecApprovePathE2,
  parseSpecRejectPath as parseSpecRejectPathE2,
  parseTriageRespondPath as parseTriageRespondPathE2,
} from "./triageSpec/triageSpecRoutes";
import {
  applySpecApproveTransition,
  applySpecRejectTransition,
  applyTriageRespondTransition as applyTriageRespondTransitionE2,
  checkSpecApproveGuards as checkSpecApproveGuardsE2,
  checkSpecRejectGuards as checkSpecRejectGuardsE2,
  checkTriageRespondGuards as checkTriageRespondGuardsE2,
  parseSpecRejectBody as parseSpecRejectBodyE2,
  parseTriageRespondBody as parseTriageRespondBodyE2,
  triageSpecExtras as triageSpecExtrasE2,
} from "./triageSpec/triageSpecService";
// ── FIN FASE 2 E2 — imports de dominios ──
// ── FASE 3 E2 — Dominios notifications/definition/health/intake/loaders (delegación delgada, C5 aditivo) ──
// Dueño E2: notifications/ (listar con flags + ack por id), definition/
// (estado validado con file/line/rule para el badge), health/ (snapshot con
// pendiente/corriendo/uptime/buildId/puertos), intake/ (ping inocuo MVP +
// allowlist + 7 builders) y loaders/ (loadSpec genérico + runners por nombre).
// El server conserva formas/handlers/respuestas; solo el MATCH, los guards y
// la lectura delegan. El bloque Rutas measure de E1 queda intacto.
import {
  ackNotificationById as ackNotificationByIdE2,
  buildNotificationsResponse as buildNotificationsResponseE2,
  parseNotificationAckPath as parseNotificationAckPathE2,
} from "./notifications/notificationRoutes";
import {
  buildDefinitionStatusResponse as buildDefinitionStatusResponseE2,
} from "./definition/definitionRoutes";
import {
  buildHealthPayload as buildHealthPayloadE2,
  buildMinimalHealthSnapshot as buildMinimalHealthSnapshotE2,
} from "./health/healthRoutes";
import {
  MVP_TRACKING_PING_PREFIX,
  MVP_TRACKING_PING_SUFFIX,
  MVP_TRACKING_TOOLS,
  buildMvpAsyncBody,
  buildMvpAsyncLegacy,
  buildMvpChatParts,
  buildMvpNoReplyBody,
  buildMvpNoReplyLegacy,
  buildMvpSyncBody,
  buildMvpSyncLegacy,
  buildMvpTrackingPing,
} from "./intake/mvpBuilders";
import type { MvpTrackingModel } from "./intake/mvpBuilders";
import {
  applyDotDone as applyDotDoneB,
  buildPortFilePath as buildPortFilePathB,
  collectRestoreBases as collectRestoreBasesB,
  decideRestoreJob as decideRestoreJobB,
  formatPortFile as formatPortFileB,
  shouldKickManager as shouldKickManagerB,
  shouldRetryBind as shouldRetryBindB,
} from "./startup/startupService";
import {
  extractIntakeSessionId as extractIntakeSessionIdB,
  intakeResultError as intakeResultErrorB,
  shortIntakeError as shortIntakeErrorB,
} from "./intake/intakeSession";
// ── FIN FASE 3 E2 — imports de dominios ──
// ── TANDA B — Dominios intake-session + startup (delegación delgada, C5 aditivo) ──
// Dueño B: intake/intakeSession (orquestador de sesión con SDK inyectado) y
// startup/startupService (restore/bind puros con efectos inyectados). El
// server conserva formas/handlers/respuestas; solo la orquestación delega.
// Ping/builders MVP intactos (no se re-tocan). Lo vivo (red/puertos) queda
// como carry-over pineado en la suite (no a ciegas).
// ── FIN TANDA B — imports de dominios ──
import {
  parseReviewRawPath,
  resolveFactoryBuildId,
} from "./reviewRaw";
// ── TANDA C — Dispatch por tabla (C8): el MATCH vive en routing/routeTable ──
// Dueño C: el loop de match vive en `matchRoute` (un `for` acotado a 36 filas
// con retorno temprano); este cascarón hace UN match + switch por dominio.
// Cero ramas por método+path fuera del switch; formas y handlers intactos.
import { matchRoute } from "./routing/routeTable";
import { createWorkflowRouteHandler } from "../workflows/workflowRoutes";
import { WorkflowRuntime } from "../workflows/runtime";
import { defaultRunsDir } from "../workflows/artifacts";
import {
  handleGate,
  handleRunEvent,
  isWorkflowEngineEnabled,
  runWorkflowJob,
  tryHandleWorkflowAction,
  WORKFLOW_ACTION_DOMAINS,
} from "./engineBridge";
import { createAgentFile, deleteAgentFile, listAgents, parseAgentFilePath, readAgentFull, writeAgentBody, writeAgentFull } from "./agents/agentFileRoutes";
import { handleAutomationsListRoute, handleAutomationsTickRoute } from "./automations/automationRoutes";
import { handleIntegrationsStatusRoute, handleIntegrationsTestPostRoute, handleIntegrationsWebhookInRoute, handleIntegrationsPostBackRoute } from "./integrations/integrationRoutes";
import { isPactTriageJob } from "../../shared/types/triage";
import type { TriageFindings } from "../../shared/types/triage";
import type { SpecBrief } from "../../shared/types/spec";
import { buildSpecApprovalMeta } from "../../shared/types/spec";
import {
  needsOnDemandTriage,
  resolveTriageMode,
  runTriageForJob,
  persistTriage,
  shouldRunPreTriage,
} from "../triage/triageFlow";
import {
  runSpecForJob,
  persistSpec,
} from "../spec/specFlow";
import {
  notify,
} from "../notify/notifications";

// ── Constantes (fallbacks; fuente de verdad: factory/factory.yaml vía agentLoader) ──
const FACTORY_DEFAULT_PORT = 17680;
const FACTORY_PORT_MAX = 17690;
const VERSION = "local";

// ── FASE 3 E2 — Rutas notifications/definition (delegación delgada, C5 aditivo) ──
// Dueño E2: notifications/notificationRoutes (listar con flags + ack por id
// con longitud exacta y rechazo de traversal) y definition/definitionRoutes
// (estado validado con file/line/rule para el badge). El server conserva
// formas/handlers/respuestas; solo el MATCH, los guards y la lectura delegan.
// El bloque Rutas measure de E1 queda intacto. Las 8 + C1–C10 citadas en los
// dominios dueños.
export {
  ackNotificationById,
  buildNotificationsResponse,
  isNotificationsListRoute,
  parseNotificationAckPath,
} from "./notifications/notificationRoutes";
export type {
  AckNotificationResult,
  NotificationAckPathErr,
  NotificationAckPathOk,
  NotificationsResponse,
} from "./notifications/notificationRoutes";
export {
  isDefinitionStatusRoute,
} from "./definition/definitionRoutes";
/**
 * Payload de GET /factory/definition/status (forma intacta, cero args por
 * compat con pacts y suites vecinas). Delegación delgada al dominio E2: el
 * buildId lo sigue calculando el cascarón (`ensureFactoryBuildId`, mismo que
 * `/factory/health`) y el estado lo valida el dominio. Nunca lanza.
 */
export function buildDefinitionStatusResponse(): {
  valid: boolean;
  issues: import("./definition/definitionRoutes").DefinitionIssue[];
  checkedAt: string;
  buildId: string;
} {
  try {
    return buildDefinitionStatusResponseE2(ensureFactoryBuildId());
  } catch {
    try {
      return {
        valid: false,
        issues: [
          {
            file: "factory/",
            rule: "validate-crashed",
            message: "no se pudo validar la definition (fallo interno del endpoint)",
            severity: "error",
          },
        ],
        checkedAt: new Date().toISOString(),
        buildId: ensureFactoryBuildId(),
      };
    } catch {
      return {
        valid: false,
        issues: [],
        checkedAt: new Date().toISOString(),
        buildId: "dev-unknown",
      };
    }
  }
}
// ── FIN FASE 3 E2 — Rutas notifications/definition ──

/** Seam SOLO para tests: inyecta el auto-score humano sin red/LLM. */
let acceptAutoScoreHook: ((id: string) => Promise<void>) | null = null;
export function setAcceptAutoScoreHookForTests(fn: ((id: string) => Promise<void>) | null): void {
  try {
    acceptAutoScoreHook = typeof fn === "function" ? fn : null;
  } catch {
    // noop
  }
}
export function resetAcceptAutoScoreHookForTests(): void {
  try {
    acceptAutoScoreHook = null;
  } catch {
    // noop
  }
}

/**
 * Auto-score tras accept HUMANO (P0.3, Ola 19): MISMA llamada
 * fire-and-forget que el accept automático (`autoScoreCompletedJob`).
 * Best-effort total: si el scorer falla, igual se resuelve (el accept ya
 * respondió 200). Nunca lanza. El handler la invoca vía `setImmediate`
 * (no bloquea el 200); los tests la llaman directo con hook mockeado.
 */
export async function runHumanAcceptAutoScore(id: string): Promise<void> {
  try {
    if (typeof id !== "string" || id.length === 0) return;
    if (acceptAutoScoreHook) {
      await acceptAutoScoreHook(id);
      return;
    }
    const { autoScoreCompletedJob } = await import("../measure/scorerEngine");
    await autoScoreCompletedJob(id);
  } catch (e) {
    try {
      console.warn(`[Factory] human-accept auto-score fail ${String(id).slice(0, 60)}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
    } catch {
      // noop
    }
  }
}

/**
 * Rango de puertos efectivo: yaml cuando válido, constantes cuando no.
 * Nunca lanza.
 */
function effectivePortRange(): { start: number; end: number } {
  try {
    const p = getFactoryPorts();
    return { start: p.factoryDefault, end: p.factoryMax };
  } catch {
    return { start: FACTORY_DEFAULT_PORT, end: FACTORY_PORT_MAX };
  }
}

// Debounce para self-heal del opencode manager desde GET /factory/health
let lastManagerKickMs = 0;

// ── Repo root & opencode directory helpers ──
function getRepoRoot(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const fromFile = path.resolve(path.dirname(currentFile), "../..");
    if (fs.existsSync(path.join(fromFile, "package.json"))) return fromFile;
  } catch {}
  try {
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, "package.json")) && fs.existsSync(path.join(cwd, "headless-runtime"))) return cwd;
    const parent = path.resolve(cwd, "..");
    if (fs.existsSync(path.join(parent, "package.json")) && fs.existsSync(path.join(parent, "headless-runtime"))) return parent;
  } catch {}
  return process.cwd();
}

function isGitRepoDir(dir: string): boolean {
  try {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) return false;
    if (fs.existsSync(path.join(resolved, ".git"))) return true;
    const repoRoot = getRepoRoot();
    const normDir = resolved.toLowerCase();
    const normRepo = path.resolve(repoRoot).toLowerCase();
    if (normDir === normRepo || normDir.startsWith(normRepo + path.sep.toLowerCase())) return true;
    return false;
  } catch {
    return false;
  }
}

/** Perf A2: el warn de worktree no-git salía docenas de veces por boot
 * (una por job restaurado). Se emite una vez por worktree. Nunca lanza. */
const warnedNonGitWorktrees = new Set<string>();

function resolveOpencodeDirectory(worktree: string): string {
  const repoRoot = path.resolve(getRepoRoot());
  const resolvedWorktree = path.resolve(worktree);
  const normWorktree = resolvedWorktree.toLowerCase();
  const normRepo = repoRoot.toLowerCase();
  if (normWorktree === normRepo || normWorktree.startsWith(normRepo + path.sep.toLowerCase())) {
    try {
      if (fs.existsSync(resolvedWorktree)) return resolvedWorktree;
    } catch {}
    return repoRoot;
  }
  try {
    if (fs.existsSync(path.join(resolvedWorktree, ".git"))) return resolvedWorktree;
  } catch {}
  try {
    if (!warnedNonGitWorktrees.has(resolvedWorktree)) {
      warnedNonGitWorktrees.add(resolvedWorktree);
      console.warn(`[Factory] worktree "${worktree}" no es proyecto git, usando directory "${repoRoot}" para opencode session (worktree preservado en metadata/title)`);
    }
  } catch {
    // best-effort
  }
  return repoRoot;
}

// ── Estado singleton ──
let server: http.Server | null = null;
let factoryPort: number | null = null;
let startedAt: number | null = null;
// ── Ola 5: buildId visible (qué código corre el daemon) ──
let factoryBuildId: string | null = null;
function ensureFactoryBuildId(): string {
  if (factoryBuildId) return factoryBuildId;
  try {
    const cwd = getRepoRoot();
    factoryBuildId = resolveFactoryBuildId({
      exec: (cmd) => execSync(cmd, { cwd, timeout: 3000, encoding: "utf-8", windowsHide: true } as never) as string,
      cwd,
    });
  } catch {
    try {
      factoryBuildId = resolveFactoryBuildId();
    } catch {
      factoryBuildId = `dev-${Date.now().toString(36)}`;
    }
  }
  if (!factoryBuildId) factoryBuildId = `dev-${Date.now().toString(36)}`;
  return factoryBuildId;
}

type FactoryJobState = "queued" | "running" | "done" | "error";

interface FactoryJob {
  id: string;
  prompt: string;
  worktree: string;
  phase: string;
  state: FactoryJobState;
  createdAt: number;
  updatedAt: number;
  logs: string[];
  dir: string | null;
  /** opencode cableado MVP - opcional, no exigido por pacts F01-F14 */
  sessionId?: string;
  dashboardUrl?: string;
  /** directory efectivo para opencode (resolveOpencodeDirectory fallback), usado para encode base64url en dashboardUrl UI */
  directory?: string;
  /** modelRef seleccionado por el usuario en FactoryLab (providerID/modelID/variant) - si no viene, fallback a anthropic/openai */
  modelRef?: { providerID: string; modelID: string; variant?: string };
  /** reviewerRef explícito elegido por el usuario en FactoryLab - si no viene, selector automático disjunto */
  reviewerRef?: { providerID: string; modelID: string; variant?: string };
  // Ola 1 WorkItem extension — opcionales para compat pacts
  status?: WorkItemStatus;
  timeline?: WorkItem["timeline"];
  cost?: WorkItem["cost"];
  runnerId?: string;
  dotDonePath?: string;
}

// ── opencode cableado (manager efímero) ──
const OPENCODE_WEB_DEFAULT_URL = "http://127.0.0.1:4096";
const OPENCODE_WEB_FALLBACK_URL = "http://127.0.0.1:40014";
async function getWorkingOpencodeUrl(): Promise<string> {
  // Preferir OpencodeServerManager efímero si está disponible
  try {
    const mgrUrl = opencodeServerManager.getUrl();
    if (mgrUrl) {
      const healthy = await opencodeServerManager.isHealthy().catch(() => false);
      if (healthy) return mgrUrl;
      // URL del manager NO healthy: no se devuelve (era el fallback que
      // creaba sesiones contra un server muerto). getUrlAsync reintenta
      // ensureClient y, si no puede, sigue a discovery.
    }
    const ensured = await opencodeServerManager.getUrlAsync().catch(() => null);
    if (ensured) return ensured;
  } catch {}
  // Fallback legacy discovery 4096/40014 (si manager no está, p.ej. tests sin server efímero)
  for (const url of [OPENCODE_WEB_DEFAULT_URL, OPENCODE_WEB_FALLBACK_URL]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 800);
      const r = await fetch(`${url}/provider`, { signal: ctrl.signal as unknown as AbortSignal, headers: { Accept: "application/json" } }).catch(() => null);
      clearTimeout(t);
      if (r && r.ok) return url;
      // also try session list as lighter probe
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 800);
      const r2 = await fetch(`${url}/session`, { signal: ctrl2.signal as unknown as AbortSignal }).catch(() => null);
      clearTimeout(t2);
      if (r2 && r2.ok) return url;
    } catch {}
  }
  const fallbackMgr = opencodeServerManager.getUrl();
  if (fallbackMgr) return fallbackMgr;
  return OPENCODE_WEB_DEFAULT_URL;
}
function encodeDirectory(dir: string): string {
  return Buffer.from(dir).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function getOpencodeBaseUrlSync(): string {
  return opencodeServerManager.getUrl() ?? OPENCODE_WEB_DEFAULT_URL;
}
function buildDashboardUrl(sessionId?: string, directory?: string): string {
  const base = getOpencodeBaseUrlSync();
  if (!sessionId) return base;
  if (!directory) return `${base}/session/${sessionId}`;
  const enc = encodeDirectory(directory);
  return `${base}/${enc}/session/${sessionId}`;
}

// TANDA 1 (cierre anti-God): Map dual eliminado. La tienda única
// `workItemStore` es el único registro en memoria; `jobView` la única
// proyección; `resultStore` el único escritor de `result.json`. Este cascarón
// persiste SOLO vía `persistSingleStore` / `appendSingleStoreLog` /
// `syncSessionFieldsAndPersist` (job.json + `.done` solo en pass + poda del
// pobre vía `resultStore.pruneIfPoor`). Sin Map, sin escritor legacy.
const sseClients = new Map<string, Set<http.ServerResponse>>();

/**
 * TANDA 1 — persistencia única (las 8 + C1–C10).
 * Escribe job.json + `.done` vía la tienda (`writeWorkItemJsonAtomic`:
 * Complete crea `.done`, resto lo borra) + poda del pobre vía
 * `resultStore.pruneIfPoor` (rico con `verification` se conserva).
 * Semántica intacta del escritor extirpado, sin reescritura ciega:
 * cada call-site migrado llama exactamente a lo que necesita
 * (job.json siempre, `.done`/poda solo vía este punto único).
 * Best-effort, nunca lanza (C2/C4). Sin loops nuevos, sin polling nuevo.
 */
function persistSingleStore(id: string): void {
  try {
    const wi = workItemStore.get(id);
    if (!wi || !wi.dir) return;
    writeWorkItemJsonAtomic(wi);
    try {
      if (wi.status !== "Complete") resultStore.pruneIfPoor(wi.dir);
    } catch {}
  } catch {}
}

/**
 * TANDA 1 — log único sin entrada de timeline (espejo exacto del
 * `legacy.logs.push` + `appendJobLog` anterior, sin duplicar historia).
 * Agrega la línea a `wi.logs` + `logs.ndjson` + broadcast SSE + persiste
 * vía `persistSingleStore`. Nunca lanza.
 */
function appendSingleStoreLog(id: string, line: string): void {
  try {
    const wi = workItemStore.get(id);
    if (!wi) return;
    try {
      wi.logs = [...(wi.logs ?? []), line];
    } catch {}
    try {
      appendWorkItemLog(wi, line);
    } catch {}
    try {
      broadcastSse(id, line);
    } catch {}
    persistSingleStore(id);
  } catch {}
}

/**
 * Sesión huérfana (job sin sessionId porque el attach post-201 nunca corrió
 * o murió sin dejar logs — caso job-mtr7fpwf-a1te 2026-09-07, "attaching…"
 * eterno sin sessionId ni dashboardUrl): reconciliación best-effort sobre
 * la actividad EXISTENTE del pipeline (cero intervalos nuevos, nunca
 * bloquea el stage — los callers la invocan fire-and-forget). No-op si ya
 * hay sessionId o si hay un attach en vuelo para el job. Nunca lanza.
 */
const sessionAttachInFlight = new Set<string>();
export async function ensureJobSessionAttached(id: string): Promise<void> {
  try {
    // Inerte fuera del daemon vivo (tests importan handlers sin bootear:
    // sin este gate spawnearían un server opencode real).
    try {
      if (!isPipelineLive()) return;
    } catch {
      return;
    }
    if (typeof id !== "string" || id.trim() === "") return;
    const wi = workItemStore.get(id);
    if (!wi) return;
    const sid = (wi as unknown as Record<string, unknown>).sessionId;
    if (typeof sid === "string" && sid.trim() !== "") return;
    if (sessionAttachInFlight.has(id)) return;
    sessionAttachInFlight.add(id);
    try {
      const fresh = workItemStore.get(id);
      if (!fresh) return;
      await tryCreateOpencodeSession(fresh as unknown as FactoryJob);
    } catch {
      // best-effort: el próximo stage lo reintenta
    } finally {
      try {
        sessionAttachInFlight.delete(id);
      } catch {}
    }
  } catch {
    // nunca lanza hacia el pipeline
  }
}

/**
 * TANDA 1 — sincroniza campos de sesión MVP a la tienda y persiste.
 * El escritor extirpado NUNCA copiaba `sessionId`/`dashboardUrl`/`directory`
 * al store (divergencia + race con timeline stale); este punto único sí,
 * sin pisar el timeline (el store ya lo tiene vía transition/appendEvent).
 * Nunca lanza.
 */
function syncSessionFieldsAndPersist(
  id: string,
  fields: { sessionId?: string; dashboardUrl?: string; directory?: string },
): void {
  try {
    const wi = workItemStore.get(id);
    if (!wi) return;
    try {
      if (typeof fields.sessionId === "string" && fields.sessionId.length > 0) {
        (wi as { sessionId?: string }).sessionId = fields.sessionId;
      }
      if (typeof fields.dashboardUrl === "string" && fields.dashboardUrl.length > 0) {
        (wi as { dashboardUrl?: string }).dashboardUrl = fields.dashboardUrl;
      }
      if (typeof fields.directory === "string" && fields.directory.length > 0) {
        (wi as { directory?: string }).directory = fields.directory;
      }
    } catch {}
    persistSingleStore(id);
  } catch {}
}

// ── FASE 4 E1 — Entierro del puente dual (las 8 + C7/C10): el conversor Ola 1
// de WorkItem a FactoryJob se extirpó por uso-cero (cero llamadas en el repo;
// el símbolo exacto y su prueba viven en tests/legacy-zero-use.test.ts). La vista única (`jobView`,
// vía jobs/jobService) es la única proyección; el Map `jobs` residual sigue
// solo en handlers vivos (carry-over F4-E1 con conteo en el reporte).

function getAllJobsForList(view?: unknown): Array<Record<string, unknown>> {
  // FASE 4 E1: tienda única, sin rama legacy (forma intacta, C5).
  // El merge compat + vista + extras + orden viven en jobs/jobService, que
  // conserva su opt `legacy` para suites vecinas; el cascarón ya no lo
  // alimenta (uso-cero verificado: POST siempre crea en la tienda).
  // view=summary: proyección liviana para el poll 2.5s (sin timeline/costos;
  // ver `toListSummary` en workItem/jobView). Mismos extras en ambas vistas.
  try {
    const extrasFor: JobExtrasFor = (wi) => ({
      ...triageSpecExtras(wi.timeline, wi.status),
      ...roleSessionExtras(wi, buildDashboardUrl),
      ...allSessionsExtras(wi, buildDashboardUrl),
      ...hookRunsExtras(wi, buildDashboardUrl),
      ...hookStagesExtras(),
    });
    if (view === "summary") {
      try {
        return listJobSummaries({ extrasFor });
      } catch {
        return [];
      }
    }
    return listJobs({
      extrasFor,
    });
  } catch {
    return [];
  }
}

function getSingleJobResponse(id: string): Record<string, unknown> | null {
  // FASE 4 E1: tienda única vía jobView (forma intacta, C5). Sin alimento dual:
  // el handler llama acá solo con WorkItem presente, así que el corte es
  // idéntico en comportamiento (ver tests/legacy-zero-use.test.ts).
  try {
    return getJobDetail(id, {
      extrasFor: (wi) => ({
        ...triageSpecExtras(wi.timeline, wi.status),
        ...roleSessionExtras(wi, buildDashboardUrl),
        ...allSessionsExtras(wi, buildDashboardUrl),
        ...hookRunsExtras(wi, buildDashboardUrl),
        ...hookStagesExtras(),
      }),
    });
  } catch {
    return null;
  }
}

// ── Port file helpers ──
// TANDA B: ruta y formato puros en startup/startupService (el fs best-effort queda acá).
function getFactoryPortFile(): string {
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const dir = getTermCanvasDataDir(isDev ? "dev" : "prod");
  return buildPortFilePathB(dir);
}

function writeFactoryPortFile(port: number): void {
  try {
    const file = getFactoryPortFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatPortFileB(port, process.pid), "utf-8");
  } catch {
    // best-effort
  }
}

function cleanupFactoryPortFile(): void {
  try {
    fs.unlinkSync(getFactoryPortFile());
  } catch {
    // ignore
  }
}

// ── Util: puerto libre secuencial (rango efectivo de factory.yaml) ──
async function findAvailablePort(): Promise<number> {
  const { start, end } = effectivePortRange();
  for (let p = start; p <= end; p++) {
    try {
      await probarBind("127.0.0.1", p);
      return p;
    } catch {
      // occupied, try next
    }
  }
  throw new Error(
    `No hay puerto libre para Factory en ${start}-${end}`,
  );
}

// ── TANDA B — Shims de disco local (carry-over pineado, NO borrado) ──
// `ensureJobDir` (0 llamados en lógica) y `appendJobLog` (log sobre el DTO
// local) NO se extirpan: su texto lo pinea H-010
// (`tests/mvp-prompt-inocuo.test.ts`: `prompt.md` + `prompt: job.prompt,`) y
// la sesión MVP los usa vía el flujo intacto de abajo. Carry-over B-SHIM-1/2
// con evidencia en el reporte (no a ciegas).
// ── Job disk helpers ──
function ensureJobDir(job: FactoryJob): void {
  try {
    const dir = path.join(path.resolve(job.worktree), ".agents", "factory", job.id);
    fs.mkdirSync(dir, { recursive: true });
    job.dir = dir;
    // Ola 1: ensure WorkItem fields have defaults
    if (!job.status) job.status = "Intake";
    if (!job.timeline) job.timeline = [{ id: `${job.id}-t0`, from: "Intake" as WorkItemStatus, to: (job.status as WorkItemStatus) ?? "Intake", at: new Date(job.createdAt).toISOString(), actor: "user", message: "created Intake" }];
    if (!job.cost) job.cost = { estimatedUSD: 0, currency: "USD", breakdown: [] };
    if (!job.runnerId) job.runnerId = "linux-build";
    if (!job.dotDonePath) job.dotDonePath = path.join(dir, ".done");
    fs.writeFileSync(
      path.join(dir, "job.json"),
      JSON.stringify(
        {
          id: job.id,
          prompt: job.prompt,
          worktree: job.worktree,
          phase: job.phase,
          state: job.state,
          status: job.status,
          createdAt: new Date(job.createdAt).toISOString(),
          updatedAt: new Date(job.updatedAt).toISOString(),
          timeline: job.timeline,
          cost: job.cost,
          dir: job.dir,
          dotDonePath: job.dotDonePath,
          runnerId: job.runnerId,
          ...(job.sessionId ? { sessionId: job.sessionId } : {}),
          ...(job.dashboardUrl ? { dashboardUrl: job.dashboardUrl } : {}),
          ...(job.directory ? { directory: job.directory } : {}),
          ...(job.modelRef ? { modelRef: job.modelRef } : {}),
          ...(job.reviewerRef ? { reviewerRef: job.reviewerRef } : {}),
        },
        null,
        2,
      ),
      "utf-8",
    );
    fs.writeFileSync(path.join(dir, "prompt.md"), job.prompt, "utf-8");
    fs.writeFileSync(path.join(dir, "logs.ndjson"), job.logs.join("\n") + (job.logs.length ? "\n" : ""), "utf-8");
    // ensure .done not present initially unless Complete/done
    const isComplete = job.status === "Complete" || job.state === "done";
    try {
      if (isComplete) {
        if (!fs.existsSync(path.join(dir, ".done"))) fs.writeFileSync(path.join(dir, ".done"), "", "utf-8");
      } else {
        fs.unlinkSync(path.join(dir, ".done"));
      }
    } catch {}
    try {
      if (!isComplete) fs.unlinkSync(path.join(dir, "result.json"));
    } catch {}
    // Sync to WorkItemStore if not already there (Ola 1 dual store)
    try {
      if (!workItemStore.get(job.id)) {
        const wi: WorkItem = {
          id: job.id,
          prompt: job.prompt,
          worktree: path.resolve(job.worktree),
          modelRef: job.modelRef,
          reviewerRef: job.reviewerRef,
          status: (job.status as WorkItemStatus) ?? "Intake",
          createdAt: new Date(job.createdAt).toISOString(),
          updatedAt: new Date(job.updatedAt).toISOString(),
          timeline: (job.timeline as WorkItem["timeline"]) ?? [],
          cost: (job.cost as WorkItem["cost"]) ?? { estimatedUSD: 0, currency: "USD", breakdown: [] },
          dir: job.dir,
          dotDonePath: job.dotDonePath ?? path.join(dir, ".done"),
          runnerId: job.runnerId ?? "linux-build",
          phase: job.phase,
          state: job.state,
          logs: job.logs,
          ...(job.sessionId ? { sessionId: job.sessionId } : {}),
          ...(job.dashboardUrl ? { dashboardUrl: job.dashboardUrl } : {}),
          ...(job.directory ? { directory: job.directory } : {}),
        };
        workItemStore.getMap().set(job.id, wi);
      }
    } catch {}
  } catch (e) {
    console.warn("[Factory] failed to write job files", e);
  }
}

function appendJobLog(job: FactoryJob, line: string): void {
  job.logs.push(line);
  job.updatedAt = Date.now();
  if (job.dir) {
    try {
      fs.appendFileSync(path.join(job.dir, "logs.ndjson"), line + "\n", "utf-8");
    } catch {}
  }
  // Sync to WorkItemStore logs if exists
  try {
    const wi = workItemStore.get(job.id);
    if (wi) {
      wi.logs = [...(wi.logs ?? []), line];
      wi.updatedAt = new Date(job.updatedAt).toISOString();
      // also append to workItem's logs file is same path, already done
    }
  } catch {}
  broadcastSse(job.id, line);
}

/**
 * FASE 4 E1 — Entierro del re-export jubilado (las 8 + C7/C10): `isRichResultJson`
 * vive SOLO en la tienda única (`resultStore.isRichResultJson`); este cascarón
 * ya no lo re-exporta (uso-cero verificado: la única importadora era la suite
 * `writejobjson-result-guard`, actualizada en la misma tanda a aserción
 * estática de ausencia; ver tests/legacy-zero-use.test.ts).
 * TANDA 1: el escritor `writeJobJson` EXTIRPADO (job.json + `.done` + poda
 * ahora vía `persistSingleStore` en la tienda única; ver helpers TANDA 1
 * arriba). Sin delegación: cero llamados restantes.
 */

// ── Ola 9: verify-retry + verify.json (Triage --re-verify--> Review, sin estado nuevo) ──
// Helpers puros (testeables sin server vivo) + worker fire-and-forget que
// re-corre verificationService.run sobre el worktree del job, reescribe
// result.json vía la tienda única, appendea evento de timeline y, si overall=pass,
// transiciona Triage→Review disparando el review automático existente.

export type VerifyRetryPathOk = { id: string; isWorkItemsAlias: boolean };
export type VerifyRetryPathErr = { error: string };

// FASE 2 E1: `isVerifyReservedId` se mudó al dominio dueño
// (verify/verifyRoutes.ts, SET VERIFY_RESERVED_IDS). Se elimina acá para no
// duplicar (C7); los parsers de arriba ya delegan.

/**
 * Parsea el pathname de POST .../review/verify-retry.
 * Espejo de POST .../review/retry-review: split("/").filter(Boolean),
 * alias work-items (len 4) vs factory (len 5), rechaza traversal.
 */
export function parseVerifyRetryPath(pathname: unknown): VerifyRetryPathOk | VerifyRetryPathErr {
  // FASE 2 E1: delega en verify/verifyRoutes (misma forma, C5 aditivo).
  try {
    return parseVerifyRetryPathE1(pathname);
  } catch {
    return { error: "invalid pathname" };
  }
}

export type VerifyRetryGuardOk = { ok: true };
export type VerifyRetryGuardErr = { ok: false; code: 404 | 409; error: string };
export type VerifyRetryGuard = VerifyRetryGuardOk | VerifyRetryGuardErr;

/**
 * Guards puros de POST .../review/verify-retry:
 * - 404 si no existe el job
 * - 409 si status !== "Triage"
 * Pacts nunca llegan acá: el camino pact (mock pass→Complete, hold F04 en
 * Building) jamás pisa Triage — verificado por lectura de implementService.
 */
export function checkVerifyRetryGuards(
  job: { status?: unknown } | null | undefined,
  idForMsg = "",
): VerifyRetryGuard {
  // FASE 2 E1: delega en verify/verifyService (misma semántica, C5 aditivo).
  try {
    return checkVerifyRetryGuardsE1(job, idForMsg);
  } catch {
    return { ok: false, code: 409, error: "verify-retry failed" };
  }
}

/**
 * H-002 E2: helpers puros/testeables de POST .../triage/respond.
 * Estilo espejo de verify-retry/spec-approve: parseo de ruta (factory len 5
 * vs alias work-items len 4 — "triage/respond" son 2 segmentos), guards
 * 404/409, validación del body {answers} y transición aplicada.
 * Nada existente se toca: Triage→Foreman ya permitida (sin estados nuevos).
 */

export type TriageRespondPathOk = { id: string; isWorkItemsAlias: boolean };
export type TriageRespondPathErr = { error: string };

/**
 * Parsea el pathname de POST .../triage/respond.
 * FASE 2 E2: delega en triageSpec/triageSpecRoutes (misma forma, C5 aditivo).
 * Rechaza traversal vía id seguro; nunca lanza.
 */
export function parseTriageRespondPath(pathname: unknown): TriageRespondPathOk | TriageRespondPathErr {
  try {
    return parseTriageRespondPathE2(pathname);
  } catch {
    return { error: "invalid pathname" };
  }
}

export type TriageRespondGuardOk = { ok: true };
export type TriageRespondGuardErr = { ok: false; code: 404 | 409; error: string };
export type TriageRespondGuard = TriageRespondGuardOk | TriageRespondGuardErr;

/**
 * Guards puros de POST .../triage/respond:
 * - 404 si no existe el job
 * - 409 si status !== "Triage" (responder solo tiene sentido en Triage)
 * FASE 2 E2: delega en triageSpec/triageSpecService (misma semántica).
 */
export function checkTriageRespondGuards(
  job: { status?: unknown } | null | undefined,
  idForMsg = "",
): TriageRespondGuard {
  try {
    return checkTriageRespondGuardsE2(job, idForMsg);
  } catch {
    return { ok: false, code: 409, error: "triage respond failed" };
  }
}

export type TriageRespondBodyOk = { ok: true; answers: string[] };
export type TriageRespondBodyErr = { ok: false; error: string };
export type TriageRespondBody = TriageRespondBodyOk | TriageRespondBodyErr;

/**
 * Valida el body {answers:string[]} de POST .../triage/respond.
 * FASE 2 E2: delega en triageSpec/triageSpecService (misma semántica;
 * espejo de `normalizeTriageAnswers` del renderer). Nunca lanza.
 */
export function parseTriageRespondBody(body: unknown): TriageRespondBody {
  try {
    return parseTriageRespondBodyE2(body);
  } catch {
    return { ok: false, error: "answers must be a non-empty array of strings" };
  }
}

/**
 * Aplica la respuesta humana: evento `user` con las respuestas (trazado en
 * timeline meta `triageRespond`) + transición Triage→Foreman (ya permitida).
 * FASE 2 E2: delega en triageSpec/triageSpecService (misma semántica;
 * Triage→Foreman sin estados nuevos). Deja que el store lance 404/409 con
 * `.status` (el handler los mapea). NO re-dispara el foreman: eso lo hace el
 * handler HTTP vía setImmediate (espejo spec/approve); así esta función es
 * testeable sin daemon ni LLM.
 */
export function applyTriageRespondTransition(id: string, answers: string[]) {
  return applyTriageRespondTransitionE2(id, answers);
}

export type VerifyGetPathOk = { id: string; isWorkItemsAlias: boolean };
export type VerifyGetPathErr = { error: string };

/**
 * Parsea el pathname de GET .../verify (sirve verify.json).
 * Espejo de GET .../result: alias work-items (len 3) vs factory (len 4).
 * Nunca confunde /review/verify-retry (no termina en "/verify").
 */
export function parseVerifyGetPath(pathname: unknown): VerifyGetPathOk | VerifyGetPathErr {
  // FASE 2 E1: delega en verify/verifyRoutes (misma forma, C5 aditivo).
  try {
    return parseVerifyGetPathE1(pathname);
  } catch {
    return { error: "invalid pathname" };
  }
}

// ── TANDA 2 — Worker verify-retry mudado a verify/verifyService (1 llamada) ──
// Dueño: verify/verifyService.runVerifyRetryWorker (reconcile H-013 intacto +
// nota reconciledLateFiles; dedupe uno-en-vuelo + budget + veredictos intactos).
// Este cascarón ya no define Set ni worker propio (C7, sin duplicar).

// TANDA 2: `runVerifyRetryForJob` extirpado (vive en
// verify/verifyService.runVerifyRetryWorker); el handler verify-retry llama
// al dominio en 1 llamada (ver bloque Ola 9). Sin wrapper residual (C7).

// ── Ola 8: extras triage/spec para GETs (desde meta del timeline, sin tocar schemas) ──
// FASE 2 E2: cálculo mudado a triageSpec/triageSpecService (misma firma y
// misma semántica; E1 congeló el contrato extrasFor de jobs/jobService).
function triageSpecExtras(timeline: unknown, status: unknown): Record<string, unknown> {
  try {
    return triageSpecExtrasE2(timeline, status);
  } catch {
    return {};
  }
}

/**
 * Ola 8: flujo Foreman extraído (decide con LLM + despacha a Building|Triage|Cancelled).
 * Asume status Foreman. T2 triage on-demand: según `triageMode` (yaml,
 * default auto) el Triage-agent corre siempre antes (always), solo si el
 * foreman pide más input (auto: segunda opinión con contexto) o nunca
 * (never). Bypass total para pact jobs, salvo `skipTriageSpec`
 * (re-disparo post-aprobación). El contexto triage/spec viaja en la meta
 * de las transiciones del foreman
 * (Record<string,unknown>, sin tocar schemas) y en triage.json/spec.md en disco.
 * Llamadores: worker post-201 de POST /factory/jobs y POST .../spec/approve.
 */
/**
 * Worker en vuelo (Agents tiempo-real): marca el job durante TODO el
 * orquestador Foreman/Triage/Spec para que el reciclado del server opencode
 * no lo pise a mitad de turno. Además intenta el reciclado al entrar: cubre
 * los caminos que re-empujan el pipeline sin un intake nuevo (aprobar spec,
 * responder triage, rerun) además del intake. Nunca lanza.
 */
export async function runForemanDecisionAndDispatch(
  id: string,
  opts?: { skipTriageSpec?: boolean },
): Promise<void> {
  if (isWorkflowEngineEnabled()) {
    await runWorkflowJob(id, getWorkflowRuntime());
    return;
  }
  try {
    maybeRecycleOpencodeForAgentUpdate(id);
  } catch {
    // noop: el reciclado nunca frena el worker
  }
  markWorkerActive(id);
  try {
    return await runForemanDecisionAndDispatchInner(id, opts);
  } finally {
    clearWorkerActive(id);
  }
}

async function runForemanDecisionAndDispatchInner(id: string, opts?: { skipTriageSpec?: boolean }): Promise<void> {
  const wi0 = workItemStore.get(id);
  if (!wi0 || wi0.status !== "Foreman") return;
  // Reconcilia sesión huérfana sin bloquear el foreman (caso attach
  // post-201 caído: el panel queda en "attaching…" eterno).
  try {
    void ensureJobSessionAttached(id).catch(() => {});
  } catch {}
  const prompt = wi0.prompt;
  const worktree = wi0.worktree;
  const modelRef = wi0.modelRef;

  // ── T2 triage on-demand: pre-pasos Triage-agent → Spec-agent extraídos ──
  // Régimen según `triageMode` (yaml, default auto):
  // - always: pre-triage siempre antes del foreman (régimen anterior exacto).
  // - auto: el foreman decide primero con el issue completo; el triage-agent
  //   corre SOLO si el foreman pide más input (on-demand, más abajo). Un
  //   issue claro cuesta 1 llamada LLM en vez de 2.
  // - never: jamás corre el triage-agent.
  // Pact jobs ni tocan este código (bypass total) y el re-dispatch
  // post-approve pasa skipTriageSpec. decision=building → sigue al Foreman.
  // decision=triage → Foreman decide como hoy. decision=spec → Spec-agent;
  // trivial sigue a Foreman, no-trivial va a Triage con gate.
  // Retorna parked=true cuando transicionó a Triage (el caller corta).
  const runPreTriageAndSpec = async (): Promise<{
    parked: boolean;
    triageFindings?: TriageFindings;
    specBrief?: SpecBrief;
  }> => {
    let outTriageFindings: TriageFindings | undefined;
    let outSpecBrief: SpecBrief | undefined;
    try {
      const preWI = workItemStore.get(id);
      if (preWI && preWI.status === "Foreman") {
        const tri = await runTriageForJob(preWI);
        outTriageFindings = tri.findings;
        try {
          persistTriage(id, tri.findings);
        } catch {}
        // TANDA 1: tienda única (log sin timeline; el store ya tiene
        // los findings vía persistTriage en disco + meta en dispatch).
        try {
          appendSingleStoreLog(
            id,
            `[${new Date().toISOString()}] triage: ${tri.findings.decision} (${tri.findings.complexity}) conf=${tri.findings.confidence}${tri.findings.fallback ? " fallback" : ""}`,
          );
        } catch {}
        if (tri.findings.decision === "spec") {
          const specRes = await runSpecForJob(preWI, tri.findings);
          if (specRes.brief) {
            outSpecBrief = specRes.brief;
            try {
              persistSpec(id, specRes.brief);
            } catch {}
            if (!specRes.brief.trivial) {
              // Spec no-trivial → Triage con gate de aprobación humana. FIN: no corre foreman.
              try {
                const gated = workItemStore.transition(
                  id,
                  "Triage",
                  "system",
                  `spec no-trivial: espera aprobación humana — ${specRes.brief.summary.slice(0, 120)}`,
                  buildSpecApprovalMeta(specRes.brief.summary),
                );
                void gated;
                // TANDA 1: tienda única (la transición ya persistió;
                // acá solo el log sin timeline).
                try {
                  appendSingleStoreLog(id, `[${new Date().toISOString()}] spec: brief no-trivial → Triage (espera aprobación POST /spec/approve)`);
                } catch {}
                try {
                  foremanLogStore.info(`[Spec] ${id} → Triage espera aprobación (no-trivial)`, id);
                } catch {}
                // Ola 19 (b) spec pendiente de aprobación → centro de
                // notificaciones (1 línea best-effort, espeja el summary ya
                // construido, jamás bloquea el gate).
                try { notify({ kind: "spec-approval", workItemId: id, title: "Spec pendiente de aprobación", body: specRes.brief.summary.slice(0, 500) }); } catch {}
              } catch (e) {
                console.warn(`[Factory] Spec gate transition failed for ${id}: ${String(e)}`);
              }
              return { parked: true };
            }
            try {
              workItemStore.appendEvent(
                id,
                "system",
                `spec trivial: continúa a Foreman — ${specRes.brief.summary.slice(0, 120)}`,
                { specAutoApproved: true } as unknown as Record<string, unknown>,
              );
              // TANDA 1: tienda única (el appendEvent ya persistió).
              try {
                persistSingleStore(id);
              } catch {}
            } catch {}
          } else {
            // Spec-agent falló o fue omitido: evento trazado y sigue al Foreman actual.
            try {
              workItemStore.appendEvent(
                id,
                "system",
                `spec omitido (${(specRes.skipReason ?? "sin brief").slice(0, 120)}): sigue a Foreman`,
                { specSkipped: true } as unknown as Record<string, unknown>,
              );
              // TANDA 1: tienda única (el appendEvent ya persistió).
              try {
                persistSingleStore(id);
              } catch {}
            } catch {}
          }
        }
      }
    } catch (e) {
      console.warn(`[Factory] Triage/Spec pre-paso fallo ${id} (sigue a Foreman): ${String(e).slice(0, 120)}`);
    }
    return { parked: false, triageFindings: outTriageFindings, specBrief: outSpecBrief };
  };

  const triageMode = resolveTriageMode();
  const pactTriage = isPactTriageJob({ id, prompt, worktree });
  let triageFindings: TriageFindings | undefined;
  let specBrief: SpecBrief | undefined;
  if (shouldRunPreTriage(triageMode, opts?.skipTriageSpec === true, pactTriage)) {
    const pre = await runPreTriageAndSpec();
    if (pre.parked) return;
    triageFindings = pre.triageFindings;
    specBrief = pre.specBrief;
  }

  // Decide con LLM real (timeout 10s, zod, fallback). Distingue triage (prompt ambiguo) vs error (infra/model no disponible).
  // Extraído a closure: en modo auto con needs_triage se pide segunda
  // opinión ya con el contexto triage en el timeline.
  const decideForemanOnce = async (): Promise<import("../../shared/types/foreman").ForemanDecision> => {
    try {
      const currentWI = workItemStore.get(id);
      if (!currentWI) throw new Error("workItem gone");
      return await foremanService.decideWithLLM(currentWI);
    } catch (e) {
      const { buildFallbackDecision, buildErrorDecision, isInfraErrorMessage } = await import("../../shared/types/foreman");
      const msg = e instanceof Error ? e.message : String(e);
      if (isInfraErrorMessage(msg)) {
        return buildErrorDecision(msg.slice(0, 160), 0.5);
      }
      return buildFallbackDecision(msg.slice(0, 80), 0.5);
    }
  };
  let decision = await decideForemanOnce();

  // T2 on-demand: el foreman habló SIN contexto triage y pide más input —
  // recién ahí corre el triage-agent (para formular preguntas) + spec, y el
  // foreman da su segunda opinión ya con ese contexto en el timeline
  // (persistTriage). Un issue claro nunca llega acá: 1 sola llamada.
  if (!opts?.skipTriageSpec && !pactTriage && needsOnDemandTriage(triageMode, decision.decision)) {
    try {
      appendSingleStoreLog(
        id,
        `[${new Date().toISOString()}] triage on-demand: foreman pidió más input (${decision.decision}) — corre triage-agent`,
      );
    } catch {}
    const pre = await runPreTriageAndSpec();
    if (pre.parked) return;
    triageFindings = pre.triageFindings;
    specBrief = pre.specBrief;
    decision = await decideForemanOnce();
  }

  const triageMeta = triageFindings ? { triage: triageFindings } : {};
  const specMeta = specBrief ? { spec: specBrief } : {};

  // Persistir decision en ForemanLog + timeline meta
  try {
    foremanLogStore.logDecision({
      workItemId: id,
      prompt,
      worktree,
      modelRef,
      decision,
    });
  } catch {}

  const isBuilding = decision.decision === "building";
  const isError = decision.decision === "error";

  if (isBuilding) {
    // Foreman → Building
    try {
      const built = workItemStore.transition(id, "Building", "foreman", `decided building: ${decision.reason}`, { foremanDecision: decision, ...triageMeta, ...specMeta } as unknown as Record<string, unknown>);
      // TANDA 1: tienda única (la transición ya persistió; acá solo el log).
      void built;
      try {
        appendSingleStoreLog(id, `[${new Date().toISOString()}] foreman: decided building (runner linux-build) reason="${decision.reason.slice(0, 80)}"`);
      } catch {}
    } catch (e) {
      console.warn(`[Factory] Building transition failed for ${id}: ${String(e)}`);
      return;
    }
    // Runner prepare
    try {
      const runnerSpec = runnerService.loadSpecSync("linux-build");
      // C3 (E1 remate): imagen REAL del yaml vía loader; el spec legacy ya no
      // trae dockerImage (undefined tras el saneo). Fallback honesto local.
      // Best-effort, nunca lanza (el outer try ya avisa ante fallo de resolve).
      let runnerRealImage = "(sin imagen: local)";
      try {
        const yamlImage = getRunner("linux-build")?.platform?.dockerImage?.trim();
        if (yamlImage) runnerRealImage = yamlImage;
      } catch {}
      workItemStore.appendEvent(id, "runner", `runner:prepared ${runnerSpec.id} ${runnerRealImage} ${runnerSpec.instanceShape.cpu}/${runnerSpec.instanceShape.memory} setup=${runnerSpec.setupCommands.join(",")}`, { runnerSpec } as unknown as Record<string, unknown>);
      foremanLogStore.info(`[Runner] ${id} prepared ${runnerSpec.id} ${runnerRealImage}`, id);
      // TANDA 1: tienda única (el appendEvent ya persistió).
      try {
        persistSingleStore(id);
      } catch {}
    } catch (e) {
      console.warn(`[Factory] runner resolve failed for ${id}: ${String(e)}`);
    }

    // Ola 3: set job running for UI, then launch real implement pipeline
    // TANDA 1: tienda única (sin Map; los 3 logs quedan en el store).
    setTimeout(() => {
      try {
        const w = workItemStore.get(id);
        if (w && w.status === "Building") {
          appendSingleStoreLog(id, `[${new Date().toISOString()}] worker picked job - state -> running`);
          appendSingleStoreLog(id, `[${new Date().toISOString()}] implement: runner linux-build accepted`);
          try {
            workItemStore.appendEvent(id, "runner", "worker picked job - state -> running");
          } catch {}
          persistSingleStore(id);
        }
      } catch {}
    }, 700);

    // Ola 4 pipeline real: Building → Implement → Review (fire-and-forget) → Complete|Building|stay
    // Pact jobs (job-abc123/F10/F11/...) van directo Complete sin Review (isPactJob en implementService).
    setImmediate(() => {
      void (async () => {
        try {
          const w = workItemStore.get(id);
          if (!w || w.status !== "Building") return;
          try {
            void ensureJobSessionAttached(id).catch(() => {});
          } catch {}
          const { implementService } = await import("../implement/implementService");
          const result = await implementService.handleBuilding(w);
          // TANDA 1: tienda única (implementService ya transicionó + persistió
          // vía la tienda; acá solo los logs sin timeline + SSE done).
          const updated = workItemStore.get(id);
          if (updated) {
            const isComplete = updated.status === "Complete";
            const isTriage = updated.status === "Triage";
            const isReview = updated.status === "Review";
            if (isComplete) {
              appendSingleStoreLog(id, `[${new Date().toISOString()}] implement: verification pass → Complete (.done created)`);
              // T01 isolation: Complete directo del pipeline (vía pact-legado);
              // un job aislado abre acá su PR de handoff, una vez, best-effort.
              setImmediate(() => {
                void maybeOpenPrForCompletedJob(id);
              });
              const clients = sseClients.get(id);
              if (clients) {
                const donePayload = `event: done\ndata: ${JSON.stringify({ state: "done", status: "Complete", ts: new Date().toISOString() })}\n\n`;
                for (const c of clients) { try { c.write(donePayload); } catch {} }
              }
            } else if (isTriage) {
              appendSingleStoreLog(id, `[${new Date().toISOString()}] implement: verification fail → Triage`);
            } else if (isReview) {
              appendSingleStoreLog(id, `[${new Date().toISOString()}] implement: verification pass → Review (await review)`);
            } else {
              persistSingleStore(id);
            }
          }
          void result;
        } catch (e) {
          console.warn(`[Factory] Ola3 implement pipeline failed for ${id}: ${String(e)}`);
          try {
            const w2 = workItemStore.get(id);
            if (w2 && w2.status === "Building") {
              const failVerif = {
                steps: [{ name: "test" as const, command: "pnpm test", exitCode: 1 as number | null, durationMs: 0, status: "fail" as const, logPath: "logs/build.log", logSnippet: String(e).slice(0, 500) }],
                overall: "fail" as const,
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 0,
              };
              try {
                workItemStore.transitionWithVerification(id, "Triage", failVerif as unknown as import("../../shared/types/implement").VerificationReport, [], `implement pipeline error: ${String(e).slice(0, 80)}`);
              } catch {}
              // TANDA 1: tienda única (la transición ya persistió; solo el log).
              try {
                appendSingleStoreLog(id, `[${new Date().toISOString()}] implement: pipeline error → Triage`);
              } catch {}
              // T3: el parking queda esperando humano en silencio si no se
              // avisa (mismo helper que los parkings de implementService).
              try {
                const { notifyTriageParking } = await import("../implement/implementService");
                notifyTriageParking(id, `implement pipeline error: ${String(e).slice(0, 160)}`);
              } catch {}
            }
          } catch {}
        }
      })();
    });

  } else if (isError) {
    // infra/model/LLM no disponible (401, 429, payment, timeout) → Cancelled/error, NO triage
    try {
      workItemStore.transition(id, "Cancelled", "foreman", `error: ${decision.reason}`, { foremanDecision: decision } as unknown as Record<string, unknown>);
      // TANDA 1: tienda única (la transición ya persistió; solo el log).
      try {
        appendSingleStoreLog(id, `[${new Date().toISOString()}] foreman: error infra/model no disponible reason="${decision.reason.slice(0, 120)}" confidence=${decision.confidence}`);
      } catch {}
      try {
        foremanLogStore.logDecision({
          workItemId: id,
          prompt,
          worktree,
          modelRef,
          decision,
        });
      } catch {}
    } catch (e) {
      console.warn(`[Factory] Cancelled (error) transition failed for ${id}: ${String(e)}`);
      try {
        const w = workItemStore.get(id);
        if (w && w.status === "Foreman") {
          workItemStore.transition(id, "Cancelled", "foreman", `fallback error: ${String(e).slice(0, 80)}`, { foremanDecision: decision } as unknown as Record<string, unknown>);
          // TANDA 1: tienda única (la transición ya persistió).
          try {
            persistSingleStore(id);
          } catch {}
        }
      } catch {}
    }
    // TANDA 1: tienda única (el Cancelled ya persistió vía transición).
    try {
      persistSingleStore(id);
    } catch {}
  } else {
    // needs_triage / needs_input → Triage (prompt ambiguo, confidence 0.8-0.9).
    // P1c: si venimos de un approve humano (skipTriageSpec), la ambigüedad YA
    // la resolvió un humano: volver a Triage silencioso re-armaría el gate de
    // spec (loop approve→Triage→approve). Se va a Triage con evento honesto +
    // notificación ask-human para que decida el humano (la derivación H4 la
    // muestra como "Waiting on your decision").
    const postApproval = opts?.skipTriageSpec === true;
    try {
      workItemStore.transition(id, "Triage", "foreman", postApproval ? `post-approve: foreman pide más contexto — ${decision.reason}` : `triaged: ${decision.reason}`, { foremanDecision: decision, ...triageMeta } as unknown as Record<string, unknown>);
      // TANDA 1: tienda única (la transición ya persistió; solo el log).
      try {
        appendSingleStoreLog(id, `[${new Date().toISOString()}] foreman: triaged needs_triage reason="${decision.reason.slice(0, 80)}" confidence=${decision.confidence}`);
      } catch {}
      foremanLogStore.info(`[Foreman] ${id} → Triage reason="${decision.reason.slice(0, 80)}"`, id);
      if (postApproval) {
        try { notify({ kind: "ask_human", workItemId: id, title: "Se aprobó la spec pero falta contexto", body: decision.reason.slice(0, 500) }); } catch {}
      }
    } catch (e) {
      console.warn(`[Factory] Triage transition failed for ${id}: ${String(e)}`);
      // Ensure at least Triage via fallback if Foreman was lost
      try {
        const w = workItemStore.get(id);
        if (w && w.status === "Foreman") {
          workItemStore.transition(id, "Triage", "foreman", `fallback triaged: ${String(e).slice(0, 80)}`);
          // TANDA 1: tienda única (la transición ya persistió).
          try {
            persistSingleStore(id);
          } catch {}
        }
      } catch {}
    }
    // Triage no crea .done, queda en queued para retry futuro (Ola 3)
    // TANDA 1: tienda única (el Triage ya persistió vía transición).
    try {
      persistSingleStore(id);
    } catch {}
  }
}

// ── opencode SDK cableado MVP - hook async no bloqueante ──
// No rompe pacts: POST responde 201 inmediato (queued), y GET sigue
// devolviendo queued->running->done via stub. Esta funcion solo anade
// logs extra y prepara job.sessionId/dashboardUrl para proximo wiring real.
// Proximo cambio: reemplazar stub setTimeout por `client.session.prompt(...)` streaming.
let opencodeSdkAvailableCache: boolean | null = null;

async function detectOpencodeSdk(): Promise<boolean> {
  if (opencodeSdkAvailableCache !== null) return opencodeSdkAvailableCache;
  try {
    await import("@opencode-ai/sdk");
    opencodeSdkAvailableCache = true;
    return true;
  } catch {}
  try {
    await import("@opencode-ai/sdk/v2");
    opencodeSdkAvailableCache = true;
    return true;
  } catch {
    opencodeSdkAvailableCache = false;
    return false;
  }
}

// ── FASE 3 E2 — Ingesta MVP (delegación delgada, C5 aditivo) ──
// Dueño E2: intake/mvpBuilders (ping inocuo + allowlist + 7 builders) e
// intake/intakeService (guards + nota de variante C). El dispatch
// fire-and-forget conserva formas/handlers/tiempos; solo los payloads delegan.
// Decisión intacta: variante C ping-only (sin slot tools). Las 8 + C1–C10
// citadas en los dominios dueños. El bloque Rutas measure de E1 queda intacto.
// Nota H-010 (origen, preservada): la sesión MVP NUNCA recibe `job.prompt`
// crudo; el texto es SIEMPRE `buildMvpTrackingPing(job.id)` y `job.prompt`
// sigue en prompt.md + job.json.
export {
  MVP_TRACKING_PING_PREFIX,
  MVP_TRACKING_PING_SUFFIX,
  MVP_TRACKING_TOOLS,
  buildMvpAsyncBody,
  buildMvpAsyncLegacy,
  buildMvpChatParts,
  buildMvpNoReplyBody,
  buildMvpNoReplyLegacy,
  buildMvpSyncBody,
  buildMvpSyncLegacy,
  buildMvpTrackingPing,
};
export type { MvpTrackingModel };
// ── FIN FASE 3 E2 — Ingesta MVP ──

/**
 * Intenta cableado real opencode para el job.
 * Mantiene stub vivo - nunca tira, nunca bloquea p:verify.
 * Logs distinguen: SDK detectado vs SDK no detectado vs web no responde.
 * Fix cableado visible en web:
 * - createOpencodeClient solo con baseUrl (directory va en session.create)
 * - session.create con title + directory (v2: {title, directory}, fallback: {body:{title,directory}})
 * - luego session.prompt con un ping inocuo de visibilidad (H-010: NUNCA job.prompt
 *   crudo — buildMvpTrackingPing(job.id) + MVP_TRACKING_TOOLS read-only) para que
 *   la sesion tenga contenido visible sin ejecutar nada en el worktree
 * Pacts: POST sigue 201 inmediato, prompt es async post-201 con try/catch y log, no rompe queued->running->done stub.
 */
export async function tryCreateOpencodeSession(job: FactoryJob): Promise<void> {
  try {
    // B2: prefer the recorded jail (store lookup: isolation lands post-201
    // before this dispatch runs); falls back to the anchor, byte-identical
    // to the old behavior when no jail is recorded.
    if (!job.directory) {
      try {
        const stored = workItemStore.get(job.id);
        job.directory = resolveOpencodeDirectory(
          stored ? resolveSessionWorktree(stored) : job.worktree,
        );
      } catch {
        job.directory = resolveOpencodeDirectory(job.worktree);
      }
    }
    const hasSdk = await detectOpencodeSdk();
    if (!hasSdk) {
      appendJobLog(
        job,
        `[${new Date().toISOString()}] [opencode: SDK no detectado - usando stub, logs falsos. Para sesion real: pnpm add @opencode-ai/sdk y reinicia Factory]`,
      );
      // Sin sesión NO se estampa dashboardUrl: la base (4096) no es un link
      // vivo — View Agent debe quedar honestamente deshabilitado (B5).
      persistSingleStore(job.id);
      return;
    }

    appendJobLog(
      job,
      `[${new Date().toISOString()}] [opencode: SDK detectado - cableado MVP - intentando sesion real para ${job.id}]`,
    );
    // TANDA 1: el log ya quedó en el store vía appendJobLog; se persiste
    // job.json + poda vía la tienda (sin pisar el timeline).
    persistSingleStore(job.id);

    // Intentar crear sesion real via SDK con timeout corto (no bloquear stub)
    let sessionId: string | undefined;
    let directoryForSession: string = job.directory || resolveOpencodeDirectory(job.worktree);
    // Keep client ref for prompt step after sessionId is obtained
    let opencodeClient: {
      session: {
        create: (opts: unknown) => Promise<unknown>;
        prompt?: (opts: unknown, ...rest: unknown[]) => Promise<unknown>;
        chat?: (...args: unknown[]) => Promise<unknown>;
      };
    } | null = null;

    try {
      type CreateClientFn = (cfg: unknown) => {
        session: {
          create: (opts: unknown) => Promise<unknown>;
          prompt?: (opts: unknown, ...rest: unknown[]) => Promise<unknown>;
          chat?: (...args: unknown[]) => Promise<unknown>;
        };
      } & Record<string, unknown>;
      let createClient: CreateClientFn | null = null;
      // Prioritize v2 (correct shape {title, directory}) over v1 legacy to ensure title persists and session is listable
      try {
        const modV2 = (await import("@opencode-ai/sdk/v2")) as unknown as { createOpencodeClient?: CreateClientFn };
        if (typeof modV2.createOpencodeClient === "function") createClient = modV2.createOpencodeClient;
      } catch {}
      if (!createClient) {
        try {
          const mod = (await import("@opencode-ai/sdk")) as unknown as { createOpencodeClient?: CreateClientFn };
          if (typeof mod.createOpencodeClient === "function") createClient = mod.createOpencodeClient;
        } catch {}
      }
      if (!createClient) throw new Error("createOpencodeClient not found en @opencode-ai/sdk");

      // Usa OpencodeServerManager efímero si está disponible, con fallback a discovery 4096/40014
      const effectiveBaseUrl = await getWorkingOpencodeUrl();
      const client: {
        session: {
          create: (opts: unknown) => Promise<unknown>;
          prompt?: (opts: unknown, ...rest: unknown[]) => Promise<unknown>;
          chat?: (...args: unknown[]) => Promise<unknown>;
        };
      } = (() => {
        try {
          const mgrClient = opencodeServerManager.getClient() as unknown as {
            session: {
              create: (opts: unknown) => Promise<unknown>;
              prompt?: (opts: unknown, ...rest: unknown[]) => Promise<unknown>;
              chat?: (...args: unknown[]) => Promise<unknown>;
            };
          } | null;
          const mgrUrl = opencodeServerManager.getUrl();
          if (mgrClient && mgrUrl === effectiveBaseUrl) return mgrClient as typeof client;
        } catch {}
        return createClient({
          baseUrl: effectiveBaseUrl,
        } as unknown as Record<string, unknown>) as typeof client;
      })();
      opencodeClient = client;
      const opencodeBaseForLogs = effectiveBaseUrl;

      // Ensure opencode storage stable: if worktree is not a git project (e.g. C:\tmp\factory-lab-test), use repo root
      // so session is listable via SDK session.list() and visible in Playwright at 4096.
      // Preserve original worktree in title/metadata to avoid losing traceability.
      // B2: the jail when recorded (isolation worktree), else the anchor.
      const sessionAnchor = (() => {
        try {
          const stored = workItemStore.get(job.id);
          return stored ? resolveSessionWorktree(stored) : job.worktree;
        } catch {
          return job.worktree;
        }
      })();
      const effectiveDirectory = resolveOpencodeDirectory(sessionAnchor);
      directoryForSession = effectiveDirectory;
      job.directory = effectiveDirectory;
      const needsFallback = effectiveDirectory !== path.resolve(job.worktree);
      const titleBase = `Factory ${job.id} ${job.phase}`;
      const title = needsFallback ? `${titleBase} (worktree:${job.worktree})` : titleBase;
      const directory = effectiveDirectory;
      if (needsFallback) {
        appendJobLog(job, `[${new Date().toISOString()}] [opencode: worktree no es proyecto git, usando directory ${directory} para sesion (original: ${job.worktree})]`);
      }

      // Try both SDK shapes: primero v2 { title, directory }, si falla { body: { title, directory } }
      // Create con el transporte único (doctrina no-resend): UN reintento
      // solo ante error de transporte; ante timeout se falla limpio
      // (reintentar huérfana sesiones vacías en el server).
      let res: unknown;
      let lastCreateError: unknown = null;
      try {
        res = await withTransportRetry(
          () =>
            (client.session.create as (o: unknown) => Promise<unknown>)({
              title,
              directory,
            }),
          SESSION_CREATE_FUSE_MS,
          "intake session.create",
        );
        // Si el SDK devuelve { error } sin data, considerarlo fallo para probar fallback body
        const hasError =
          res !== null && typeof res === "object" && "error" in (res as Record<string, unknown>) && (res as Record<string, unknown>).error;
        const hasData =
          res !== null && typeof res === "object" && "data" in (res as Record<string, unknown>) && (res as Record<string, unknown>).data != null;
        if (hasError && !hasData) {
          lastCreateError = (res as Record<string, unknown>).error;
          throw new Error(`v2 create error: ${JSON.stringify(lastCreateError).slice(0, 120)}`);
        }
      } catch (errV2) {
        // Fallback a shape anomalyco { body: { title, directory } }
        try {
          res = await withTransportRetry(
            () =>
              (client.session.create as (o: unknown) => Promise<unknown>)({
                body: { title, directory },
              }),
            SESSION_CREATE_FUSE_MS,
            "intake session.create body",
          );
        } catch (errBody) {
          // Si ambos fallan, lanzar el error mas informativo (body si existe, sino v2)
          throw errBody ?? errV2;
        }
      }

      // TANDA B: extracción del sessionId en intake/intakeSession (mismo
      // espejo de shapes: string `ses_*`, variantes de id o id anidado en
      // `session`). El guardado intacto abajo.
      sessionId = extractIntakeSessionIdB(res);
      if (!sessionId) {
        // No fatal - logueamos y caemos a fallback stub, pero ahora con diagnostico mas claro
        throw new Error("session.create sin sessionId en respuesta");
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const lower = raw.toLowerCase();
      const isConnRefused =
        lower.includes("abort") ||
        lower.includes("econnrefused") ||
        lower.includes("fetch failed") ||
        lower.includes("failed to fetch") ||
        lower.includes("econom") ||
        lower.includes("network");
      if (isConnRefused) {
        const baseForMsg = getOpencodeBaseUrlSync();
        appendJobLog(
          job,
          `[${new Date().toISOString()}] [opencode: SDK disponible pero web no responde en ${baseForMsg} - usando stub. Levanta: npx opencode web --port 4096 o manager efímero]`,
        );
        // Ola 19 (e) daemon opencode no disponible → centro de notificaciones
        // (1 línea best-effort, sin workItemId: es infra global, no de un job;
        // punto central donde ya se detecta "opencode no disponible").
        try { notify({ kind: "daemon-error", title: "Daemon opencode no disponible", body: `opencode no responde en ${baseForMsg} (job ${job.id}): ${(raw as string).slice(0, 300)}`.slice(0, 500) }); } catch {}
      } else {
        const short = raw.slice(0, 140).replace(/\s+/g, " ");
        appendJobLog(
          job,
          `[${new Date().toISOString()}] [opencode: sesion no creada (${short}) - fallback stub]`,
        );
        // Visibilidad honesta: el pipeline queda sin sesión (los roles no
        // van a aparecer y View Agent no tiene link). Notificación global
        // igual que en ECONNREFUSED — antes este path quedaba mudo.
        try { notify({ kind: "daemon-error", title: "Daemon opencode no disponible", body: `session.create falló (job ${job.id}): ${short}`.slice(0, 500) }); } catch {}
      }
      // Sin sesión NO se estampa dashboardUrl (la base no es un link vivo;
      // el renderer exige URL con /session/). Solo se persiste el log.
      persistSingleStore(job.id);
      return;
    }

    if (sessionId) {
      job.sessionId = sessionId;
      job.directory = directoryForSession;
      job.dashboardUrl = buildDashboardUrl(sessionId, directoryForSession);
      appendJobLog(
        job,
        `[${new Date().toISOString()}] [opencode: sesion creada ${sessionId} -> ${job.dashboardUrl}]`,
      );
      // TANDA 1: tienda única (el escritor extirpado jamás copiaba la sesión
      // al store; este punto único sí, sin pisar el timeline) + job.json/poda.
      syncSessionFieldsAndPersist(job.id, {
        sessionId,
        directory: directoryForSession,
        dashboardUrl: job.dashboardUrl,
      });

      // Enviar prompt inicial para que la sesion sea visible con contenido en la web (http://127.0.0.1:4096/session/<id>)
      // Fix: el server requiere model; sin model da UnknownError "Unexpected server error".
      // Intenta 3 variantes secuenciales con timeout no bloqueante con AbortController (12000ms sync vivo, 2000ms async):
      // A) session.prompt con model anthropic/claude-sonnet-4-20250514 (y fallback gpt-4o/openai)
      // B) session.prompt con noReply:true (inyecta contexto sin modelo, no requiere model segun docs)
      // C) session.chat anomalyco si existe
      // Tambien prueba shapes correctos path/body para SDK real (client.session.prompt({path:{id}, body:{...}}))
      // ASCII logs por variante, si todas fallan loggea error original pero no tira - deja sesion creada.
      try {
        if (!opencodeClient) throw new Error("opencode client no disponible para prompt");
        // H-010: NUNCA el prompt crudo del usuario — la sesión MVP es solo de
        // seguimiento/visibilidad y con agent default + full tools ejecutaba el
        // prompt como tarea (escrituras laterales). Ping inocuo; job.prompt sigue
        // en prompt.md/job.json donde ya vive (no se pierde nada).
        const promptText = buildMvpTrackingPing(job.id);
        const withTimeoutPrompt = <T>(p: Promise<T>, ms: number): Promise<T> => {
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<T>((_, rej) => {
            timer = setTimeout(() => {
              controller.abort();
              rej(new Error(`timeout ${ms}ms waiting for opencode prompt`));
            }, ms);
          });
          return Promise.race([p.finally(() => clearTimeout(timer)), timeoutPromise.finally(() => clearTimeout(timer))]);
        };

        const sessionAny = opencodeClient.session as unknown as Record<string, unknown>;
        const promptFn = sessionAny.prompt as ((opts: unknown, ...rest: unknown[]) => Promise<unknown>) | undefined;
        const promptAsyncFn = sessionAny.promptAsync as ((opts: unknown) => Promise<unknown>) | undefined;
        const chatFn = sessionAny.chat as ((...args: unknown[]) => Promise<unknown>) | undefined;

        // TANDA B: errores del SDK en intake/intakeSession (mismos recortes
        // 180/140; alias delgados estilo E1, cero cambios de call-sites).
        const hasResultError = (res: unknown): string | null => intakeResultErrorB(res);
        const shortErr = (e: unknown): string => shortIntakeErrorB(e);
        // Helper: verifica si la sesion ya tiene al menos 1 user message visible en opencode web
        const isPromptVisible = async (): Promise<boolean> => {
          try {
            // Intentar via fetch directo con timeout 1000ms (no depende de SDK shape) — usa manager url
            const baseForVisible = getOpencodeBaseUrlSync();
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 1000);
            try {
              const r = await fetch(`${baseForVisible}/session/${sessionId}/message`, {
                headers: { Accept: "application/json" },
                signal: ctrl.signal as unknown as AbortSignal,
              });
              clearTimeout(t);
              if (r.ok) {
                const arr = (await r.json()) as unknown[];
                if (Array.isArray(arr) && arr.length > 0) {
                  for (const m of arr as Record<string, unknown>[]) {
                    const info = (m as Record<string, unknown>).info as Record<string, unknown> | undefined;
                    const role = (info?.role as string) ?? ((m as Record<string, unknown>).role as string);
                    if (role === "user") return true;
                  }
                  // si hay cualquier mensaje, consideramos visible (fallback)
                  return arr.length > 0;
                }
              }
            } catch {
              clearTimeout(t);
            }
            // Fallback via SDK session.messages si fetch falla
            const msgsFn = (sessionAny.messages as ((opts: unknown) => Promise<unknown>) | undefined);
            if (typeof msgsFn === "function") {
              try {
                // Plano SDK 1.18.18 (el {path} se dropea igual que {path,body}).
                const res = await withTimeoutPrompt(msgsFn.call(opencodeClient.session, { sessionID: sessionId }), 1000);
                const data = res !== null && typeof res === "object" && "data" in (res as Record<string, unknown>) ? (res as Record<string, unknown>).data : res;
                if (Array.isArray(data) && (data as unknown[]).length > 0) {
                  for (const mm of data as Record<string, unknown>[]) {
                    const info2 = (mm as Record<string, unknown>).info as Record<string, unknown> | undefined;
                    const role2 = (info2?.role as string) ?? ((mm as Record<string, unknown>).role as string);
                    if (role2 === "user") return true;
                  }
                  return (data as unknown[]).length > 0;
                }
              } catch {}
            }
          } catch {}
          return false;
        };

        let promptSucceeded = false;
        let firstError: unknown = null;
        let succeededVariant = "";

        // --- Variante A: con model (selectedModel primero si existe, fallback anthropic/openai) ---
        // FIX: usa job.modelRef como primera opción si el usuario seleccionó modelo en FactoryLab (ej opencode-go/muse-spark)
        // Si selectedModel falla (ej sin credencial), recién ahí prueba anthropic/openai como fallback. Variant handling:
        // si variant !== "default", pásalo en model: {providerID, modelID, variant} o body:{model, variant} según shape.
        // Usa promptAsync primero (no espera LLM, solo crea user message) para evitar bloqueo y errores de auth.
        if (!promptSucceeded && (typeof promptFn === "function" || typeof promptAsyncFn === "function")) {
          const anthropicModel = { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" };
          const openaiModel = { providerID: "openai", modelID: "gpt-4o" };
          let modelCandidates: Array<{ providerID: string; modelID: string; variant?: string }> = [];
          let selectedModel: { providerID: string; modelID: string } | null = null;
          let selectedModelWithVariant: { providerID: string; modelID: string; variant?: string } | null = null;
          if (
            job.modelRef &&
            typeof job.modelRef.providerID === "string" &&
            job.modelRef.providerID.trim().length > 0 &&
            typeof job.modelRef.modelID === "string" &&
            job.modelRef.modelID.trim().length > 0
          ) {
            const selProviderID = job.modelRef.providerID.trim();
            const selModelID = job.modelRef.modelID.trim();
            const selVariantRaw = typeof job.modelRef.variant === "string" ? job.modelRef.variant.trim() : undefined;
            const hasVariant = !!selVariantRaw && selVariantRaw.length > 0 && selVariantRaw !== "default";
            selectedModel = { providerID: selProviderID, modelID: selModelID };
            selectedModelWithVariant = hasVariant
              ? { providerID: selProviderID, modelID: selModelID, variant: selVariantRaw }
              : { providerID: selProviderID, modelID: selModelID };
            modelCandidates.push(selectedModelWithVariant);
            modelCandidates.push(anthropicModel, openaiModel);
            appendJobLog(
              job,
              `[${new Date().toISOString()}] [opencode: usando modelRef seleccionado ${selProviderID}/${selModelID}${hasVariant ? ` variant=${selVariantRaw}` : ""} como primera opcion (fallback anthropic/openai si falla)]`,
            );
          } else {
            modelCandidates = [anthropicModel, openaiModel];
          }
          let variantAError: unknown = null;
          const isSelectedModel = (m: { providerID: string; modelID: string }): boolean =>
            !!selectedModel && m.providerID === selectedModel.providerID && m.modelID === selectedModel.modelID;
          // VIVO: Prioriza prompt sync (streaming, con SSE replay) antes que promptAsync.
          // prompt sync: timeout 12000ms (big-pickle necesita >2s, muse-spark tarda 2829ms; con AbortController no bloquea), tools:{}, parts correctos, sin noReply
          // fallback async: timeout 2000ms, con isPromptVisible
          const tryModelWithVivoFirst = async (model: { providerID: string; modelID: string; variant?: string }): Promise<boolean> => {
            const isSelected = isSelectedModel(model);
            const selectedSuffix = isSelected ? " selected" : "";
            const hasVariantInModel = !!(model as { variant?: string }).variant && (model as { variant?: string }).variant !== "default";
            const variantValue = hasVariantInModel ? (model as { variant?: string }).variant : undefined;
            const baseModelClean = { providerID: model.providerID, modelID: model.modelID };
            const buildSyncBody = (): Record<string, unknown> => {
              return buildMvpSyncBody(baseModelClean, promptText, variantValue);
            };
            const buildSyncLegacy = (): Record<string, unknown> => {
              return buildMvpSyncLegacy(sessionId as string, baseModelClean, promptText, variantValue);
            };
            const buildAsyncBody = (): Record<string, unknown> => {
              return buildMvpAsyncBody(baseModelClean, promptText, variantValue);
            };
            const buildAsyncLegacy = (): Record<string, unknown> => {
              return buildMvpAsyncLegacy(sessionId as string, baseModelClean, promptText, variantValue);
            };

            // helper to call prompt sync con AbortSignal y timeout 12000ms (vivo via prompt sync) - no bloqueante con AbortController
            const callPromptSyncWithSignal = async (syncBody: Record<string, unknown>, syncLegacy: Record<string, unknown>): Promise<unknown> => {
              if (typeof promptFn !== "function") throw new Error("no promptFn");
              const ctrl = new AbortController();
              const abortTimer = setTimeout(() => ctrl.abort(), 12000);
              const timeoutError = new Promise<never>((_, rej) => {
                const t = setTimeout(() => rej(new Error("timeout 12000ms waiting for opencode prompt")), 12000);
                ctrl.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
              });
              try {
                try {
                  const p1 = (promptFn as unknown as (a: unknown, b: unknown) => Promise<unknown>).call(
                    opencodeClient.session,
                    syncLegacy,
                    { signal: ctrl.signal },
                  );
                  const res = await Promise.race([p1, timeoutError]);
                  return res;
                } catch (eHarness) {
                  const msgH = eHarness instanceof Error ? eHarness.message.toLowerCase() : String(eHarness).toLowerCase();
                  if (msgH.includes("timeout 12000ms") || msgH.includes("abort")) throw eHarness;
                  // Plano SDK 1.18.18 (el envelope {path,body} se dropea y hace
                  // 500 — ver reviewAgent.buildReviewPromptPayload).
                  const pathBody = { sessionID: sessionId, ...syncBody };
                  const p2 = (promptFn as unknown as (a: unknown, b: unknown) => Promise<unknown>).call(
                    opencodeClient.session,
                    pathBody,
                    { signal: ctrl.signal },
                  );
                  const res2 = await Promise.race([p2, timeoutError]);
                  return res2;
                }
              } finally {
                clearTimeout(abortTimer);
              }
            };

            // 1) INTENTAR SYNC VIVO (12000ms) con tools:{} y signal abortable — prioritaria, no bloquea Foreman 25s porque es post-201 async
            if (typeof promptFn === "function") {
              try {
                const syncBody = buildSyncBody();
                const syncLegacy = buildSyncLegacy();
                const resSync = await callPromptSyncWithSignal(syncBody, syncLegacy);
                const errStrSync = hasResultError(resSync);
                if (errStrSync) throw new Error(errStrSync);
                promptSucceeded = true;
                succeededVariant = `vivo via prompt sync (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
                return true;
              } catch (eSync) {
                variantAError = eSync;
                if (!firstError) firstError = eSync;
                const isTimeoutSync = (() => {
                  const m = eSync instanceof Error ? eSync.message.toLowerCase() : String(eSync).toLowerCase();
                  return m.includes("timeout") || m.includes("abort");
                })();
                if (isTimeoutSync) {
                  appendJobLog(job, `[${new Date().toISOString()}] [opencode: vivo via prompt sync timeout 12000ms para ${model.providerID}/${model.modelID}${selectedSuffix} - intentando fallback async]`);
                } else {
                  appendJobLog(job, `[${new Date().toISOString()}] [opencode: vivo via prompt sync fallo (${shortErr(eSync)}) para ${model.providerID}/${model.modelID}${selectedSuffix} - intentando fallback async]`);
                }
                try {
                  if (await isPromptVisible()) {
                    promptSucceeded = true;
                    succeededVariant = `vivo via prompt sync verificado (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                    appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                    persistSingleStore(job.id);
                    return true;
                  }
                } catch {}
              }
            }

            // 2) FALLBACK ASYNC (2000ms) — promptAsync + isPromptVisible
            if (typeof promptAsyncFn === "function") {
              try {
                // Plano SDK 1.18.18 (mismo motivo que arriba).
                const payloadAsync = { sessionID: sessionId, ...buildAsyncBody() };
                const resA = await withTimeoutPrompt(promptAsyncFn.call(opencodeClient.session, payloadAsync), 2000);
                const errStrA = hasResultError(resA);
                if (errStrA) throw new Error(errStrA);
                promptSucceeded = true;
                succeededVariant = `fallback async (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
                return true;
              } catch (eA) {
                variantAError = eA;
                if (!firstError) firstError = eA;
                try {
                  if (await isPromptVisible()) {
                    promptSucceeded = true;
                    succeededVariant = `fallback async verificado (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                    appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                    persistSingleStore(job.id);
                    return true;
                  }
                } catch {}
                try {
                  const payloadLegacyAsync = buildAsyncLegacy();
                  const resLegacyA = await withTimeoutPrompt(promptAsyncFn.call(opencodeClient.session, payloadLegacyAsync), 2000);
                  const errStrLegacyA = hasResultError(resLegacyA);
                  if (errStrLegacyA) throw new Error(errStrLegacyA);
                  promptSucceeded = true;
                  succeededVariant = `fallback async (model ${model.providerID}/${model.modelID} legacy${selectedSuffix})`;
                  appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                  persistSingleStore(job.id);
                  return true;
                } catch (eLegacyA) {
                  variantAError = eLegacyA;
                  if (!firstError) firstError = eLegacyA;
                  try {
                    if (await isPromptVisible()) {
                      promptSucceeded = true;
                      succeededVariant = `fallback async legacy verificado (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                      appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                      persistSingleStore(job.id);
                      return true;
                    }
                  } catch {}
                }
              }
            }

            // 3) ULTIMO FALLBACK: prompt sync legacy sin signal timeout 12000 (por compat, con AbortController via withTimeoutPrompt)
            if (typeof promptFn === "function") {
              try {
                const syncBody = buildSyncBody();
                // Plano SDK 1.18.18 (mismo motivo que arriba).
                const pathBodyFallback = { sessionID: sessionId, ...syncBody };
                const resFallbackSync = await withTimeoutPrompt(promptFn.call(opencodeClient.session, pathBodyFallback), 12000);
                const errStrFallback = hasResultError(resFallbackSync);
                if (errStrFallback) throw new Error(errStrFallback);
                promptSucceeded = true;
                succeededVariant = `vivo via prompt sync fallback (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
                return true;
              } catch (eFallback) {
                variantAError = eFallback;
                if (!firstError) firstError = eFallback;
                try {
                  if (await isPromptVisible()) {
                    promptSucceeded = true;
                    succeededVariant = `vivo via prompt sync fallback verificado (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                    appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                    persistSingleStore(job.id);
                    return true;
                  }
                } catch {}
                try {
                  const legacy = buildSyncLegacy();
                  const resLegacy = await withTimeoutPrompt(promptFn.call(opencodeClient.session, legacy), 12000);
                  const errStrLegacy = hasResultError(resLegacy);
                  if (errStrLegacy) throw new Error(errStrLegacy);
                  promptSucceeded = true;
                  succeededVariant = `vivo via prompt sync legacy (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                  appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                  persistSingleStore(job.id);
                  return true;
                } catch (eLegacy) {
                  variantAError = eLegacy;
                  if (!firstError) firstError = eLegacy;
                  try {
                    if (await isPromptVisible()) {
                      promptSucceeded = true;
                      succeededVariant = `vivo via prompt sync legacy verificado (model ${model.providerID}/${model.modelID}${selectedSuffix})`;
                      appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado ${succeededVariant} a sesion ${sessionId}]`);
                      persistSingleStore(job.id);
                      return true;
                    }
                  } catch {}
                }
              }
            }

            return false;
          };
          for (const model of modelCandidates) {
            if (promptSucceeded) break;
            const ok = await tryModelWithVivoFirst(model);
            if (ok) break;
            // antes de probar siguiente model, verificar si ya hay prompt visible (evita crear 2 mensajes)
            try {
              if (await isPromptVisible()) {
                const selSufInner = isSelectedModel(model) ? " selected" : "";
                promptSucceeded = true;
                succeededVariant = `A (model ${model.providerID}/${model.modelID} verificado tras fallo${selSufInner})`;
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
                break;
              }
            } catch {}
          }
          if (!promptSucceeded && variantAError) {
            // Verificacion final antes de declarar fallo A: si hay mensaje, es exito
            try {
              if (await isPromptVisible()) {
                promptSucceeded = true;
                succeededVariant = "A (verificado tras fallo)";
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
              } else {
                const short = shortErr(variantAError);
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante A (${short}) - probando B]`);
              }
            } catch {
              const short = shortErr(variantAError);
              appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante A (${short}) - probando B]`);
            }
          } else if (!promptSucceeded) {
            const short = variantAError ? shortErr(variantAError) : "no prompt method";
            appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante A (${short}) - probando B]`);
            if (!firstError) firstError = variantAError ?? new Error("no prompt method for variante A");
          }
        } else if (!promptSucceeded) {
          appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante A (no prompt method) - probando B]`);
          if (!firstError) firstError = new Error("no prompt method for variante A");
        }

        // Si A ya creo el prompt (visible) no intentar B para evitar duplicate - verificar
        if (!promptSucceeded) {
          try {
            if (await isPromptVisible()) {
              promptSucceeded = true;
              succeededVariant = "A/B (verificado)";
              appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
              persistSingleStore(job.id);
            }
          } catch {}
        }

        // --- Variante B: noReply true (inyecta contexto sin modelo, no requiere model segun docs) ---
        if (!promptSucceeded && (typeof promptFn === "function" || typeof promptAsyncFn === "function")) {
          let variantBError: unknown = null;
          const tryB = async (): Promise<boolean> => {
            // B1: promptAsync noReply (mas confiable, no bloquea)
            if (typeof promptAsyncFn === "function") {
              try {
                // Plano SDK 1.18.18 (mismo motivo que arriba).
                const payloadBAsync = { sessionID: sessionId, ...buildMvpNoReplyBody(promptText) };
                const resBA = await withTimeoutPrompt(promptAsyncFn.call(opencodeClient.session, payloadBAsync), 2000);
                const errStrBA = hasResultError(resBA);
                if (errStrBA) throw new Error(errStrBA);
                promptSucceeded = true;
                succeededVariant = "B-async (noReply)";
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
                return true;
              } catch (eBA) {
                variantBError = eBA;
                if (!firstError) firstError = eBA;
                try {
                  if (await isPromptVisible()) {
                    promptSucceeded = true;
                    succeededVariant = "B-async (noReply verificado)";
                    appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                    persistSingleStore(job.id);
                    return true;
                  }
                } catch {}
              }
            }
            // B2: shape plano (el path/body se dropea — ver arriba).
            if (typeof promptFn === "function") {
              try {
                const payloadBCorrect = { sessionID: sessionId, ...buildMvpNoReplyBody(promptText) };
                const resB2 = await withTimeoutPrompt(promptFn.call(opencodeClient.session, payloadBCorrect), 2000);
                const errStrB2 = hasResultError(resB2);
                if (errStrB2) throw new Error(errStrB2);
                promptSucceeded = true;
                succeededVariant = "B (noReply path/body)";
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
                return true;
              } catch (eB2) {
                variantBError = eB2;
                if (!firstError) firstError = eB2;
                try {
                  if (await isPromptVisible()) {
                    promptSucceeded = true;
                    succeededVariant = "B (noReply path/body verificado)";
                    appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                    persistSingleStore(job.id);
                    return true;
                  }
                } catch {}
                // B3: legacy flat fallback
                try {
                  const payloadB = buildMvpNoReplyLegacy(sessionId as string, promptText);
                  const resB = await withTimeoutPrompt(promptFn.call(opencodeClient.session, payloadB), 2000);
                  const errStrB = hasResultError(resB);
                  if (errStrB) throw new Error(errStrB);
                  promptSucceeded = true;
                  succeededVariant = "B (noReply)";
                  appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                  persistSingleStore(job.id);
                  return true;
                } catch (eB) {
                  variantBError = eB;
                  if (!firstError) firstError = eB;
                  try {
                    if (await isPromptVisible()) {
                      promptSucceeded = true;
                      succeededVariant = "B (noReply verificado)";
                      appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                      persistSingleStore(job.id);
                      return true;
                    }
                  } catch {}
                }
              }
            }
            return false;
          };
          const okB = await tryB();
          if (!okB && !promptSucceeded) {
            try {
              if (await isPromptVisible()) {
                promptSucceeded = true;
                succeededVariant = "B (verificado tras fallo)";
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
              } else if (variantBError) {
                const short = shortErr(variantBError);
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante B (${short}) - probando C]`);
              } else {
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante B (unknown) - probando C]`);
              }
            } catch {
              if (variantBError) {
                const short = shortErr(variantBError);
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante B (${short}) - probando C]`);
              }
            }
          }
        } else if (!promptSucceeded) {
          // Solo verificar visibilidad antes de declarar B fallida
          try {
            if (await isPromptVisible()) {
              promptSucceeded = true;
              succeededVariant = "B (verificado)";
              appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
              persistSingleStore(job.id);
            } else {
              appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante B (no prompt method) - probando C]`);
            }
          } catch {
            appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante B (no prompt method) - probando C]`);
          }
        }

        // --- Variante C: chat anomalyco (si SDK lo expone) ---
        if (!promptSucceeded) {
          const chatAny = chatFn;
          if (typeof chatAny === "function") {
            let variantCError: unknown = null;
            // C1: chat(sessionId, { providerID, modelID, parts })
            try {
              const resC = await withTimeoutPrompt(
                chatAny.call(opencodeClient.session, sessionId, {
                  providerID: "anthropic",
                  modelID: "claude-3-5-sonnet-20241022",
                  parts: buildMvpChatParts(promptText),
                }),
                2000,
              );
              const errStrC = hasResultError(resC);
              if (errStrC) throw new Error(errStrC);
              promptSucceeded = true;
              succeededVariant = "C (chat)";
              appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
              persistSingleStore(job.id);
            } catch (eC) {
              variantCError = eC;
              if (!firstError) firstError = eC;
              // C2: chat({ sessionID, providerID, modelID, parts })
              try {
                const resC2 = await withTimeoutPrompt(
                  chatAny.call(opencodeClient.session, {
                    sessionID: sessionId,
                    providerID: "anthropic",
                    modelID: "claude-3-5-sonnet-20241022",
                    parts: buildMvpChatParts(promptText),
                  }),
                  2000,
                );
                const errStrC2 = hasResultError(resC2);
                if (errStrC2) throw new Error(errStrC2);
                promptSucceeded = true;
                succeededVariant = "C (chat object)";
                appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                persistSingleStore(job.id);
              } catch (eC2) {
                variantCError = eC2;
                if (!firstError) firstError = eC2;
                // C3: chat con gpt-4o como fallback
                try {
                  const resC3 = await withTimeoutPrompt(
                    chatAny.call(opencodeClient.session, sessionId, {
                      providerID: "openai",
                      modelID: "gpt-4o",
                      parts: buildMvpChatParts(promptText),
                    }),
                    2000,
                  );
                  const errStrC3 = hasResultError(resC3);
                  if (errStrC3) throw new Error(errStrC3);
                  promptSucceeded = true;
                  succeededVariant = "C (chat gpt-4o)";
                  appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt enviado via ${succeededVariant} a sesion ${sessionId}]`);
                  persistSingleStore(job.id);
                } catch (eC3) {
                  variantCError = eC3;
                  if (!firstError) firstError = eC3;
                }
              }
            }
            if (!promptSucceeded && variantCError) {
              const short = shortErr(variantCError);
              appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante C (${short}) - todas fallaron]`);
            }
          } else {
            appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo variante C (no chat method) - todas fallaron]`);
            if (!firstError) firstError = new Error("no chat method for variante C");
          }
        }

        if (!promptSucceeded) {
          const raw = firstError instanceof Error ? firstError.message : String(firstError ?? "unknown");
          const lower = raw.toLowerCase();
          const isTimeout = lower.includes("timeout");
          const short = raw.slice(0, 140).replace(/\s+/g, " ");
          if (isTimeout) {
            appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt timeout 2000ms para sesion ${sessionId} (${short}) - sesion creada pero prompt no confirmado]`);
          } else {
            appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo (${short}) - sesion creada pero sin prompt, revisa web]`);
          }
          // No throw - stub sigue vivo, sesion queda visible aunque sin prompt
        }
      } catch (promptErr) {
        const raw = promptErr instanceof Error ? promptErr.message : String(promptErr);
        const short = raw.slice(0, 140).replace(/\s+/g, " ");
        appendJobLog(job, `[${new Date().toISOString()}] [opencode: prompt fallo (${short}) - sesion creada pero sin prompt, revisa web]`);
        // No throw - stub sigue vivo
      }

      // Stub sigue vivo para pacts (queued->running->done) - prompt ya enviado hace la sesion visible en web.
    } else {
      // Sin sessionId no hay dashboard real: no se estampa la base 4096
      // (el renderer exige `/session/`, pero el job tampoco debe mentir en
      // disco). Log honesto + persist del estado del stub.
      appendJobLog(
        job,
        `[${new Date().toISOString()}] [opencode: SDK sin sessionId - sin dashboard (stub)]`,
      );
      persistSingleStore(job.id);
    }
  } catch (e) {
    try {
      const msg = e instanceof Error ? (e.message ?? String(e)) : String(e);
      appendJobLog(
        job,
        `[${new Date().toISOString()}] [opencode: tryCreateOpencodeSession error ${msg.slice(0, 120)} - stub activo]`,
      );
    } catch {}
  }
}

function broadcastSse(jobId: string, line: string): void {
  const clients = sseClients.get(jobId);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify({ line, ts: new Date().toISOString() })}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {}
  }
}

// ── CORS ──
function setCors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Body reader ──
// Now returns raw + parseError so caller can give a useful hint instead of silent {}.
// Uses Buffer concat + utf8 to avoid mojibake on tildes/emoji (e.g. ñ, á, 😀, →).
// Keeps backward compat for fetch callers: valid JSON returns parsed object, empty body returns {}.
type ReadBodyResult = { parsed: unknown; raw: string; parseError: boolean };
function readBody(req: http.IncomingMessage): Promise<ReadBodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8");
      chunks.push(buf);
      total += buf.length;
      if (total > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({ parsed: {}, raw: "", parseError: false });
        return;
      }
      const rawWithBom = Buffer.concat(chunks).toString("utf-8");
      const raw = rawWithBom.replace(/^\uFEFF/, "");
      if (!raw) {
        resolve({ parsed: {}, raw: "", parseError: false });
        return;
      }
      try {
        resolve({ parsed: JSON.parse(raw), raw, parseError: false });
      } catch {
        // invalid json - keep raw for hint, don't swallow silently
        resolve({ parsed: {}, raw, parseError: true });
      }
    });
    req.on("error", reject);
  });
}

// ── TANDA C — Entierro E1: los 3 wrappers de match salud/lista/detalle
// murieron con el loop (uso-cero verificado en tests/dispatch-table.test.ts
// TC-13; el MATCH vive en routing/routeTable y los dominios dueños siguen
// intactos).

// ── TANDA 2 — Dispatch post-201 (sesión MVP + foreman; el handler create delega) ──
// Dueño del create: jobs/jobCreate (validación + tienda + 201). Este helper
// conserva los workers async post-201 byte-idénticos (no bloquean el 201).
//
// Reciclado perezoso de prompts (Agents tiempo-real, solo próximo JOB):
// si la UI editó un agent.md (flag dirty de agentFileRoutes), y NO hay otros
// jobs corriendo, se cierra el server opencode efímero AQUÍ para que el
// próximo `ensureClient()` bootee fresco y lea los espejos nuevos. El texto
// del turno queda byte-idéntico (cero tokens extra). Con jobs corriendo se
// re-marca (defer): el job en curso usa el prompt anterior, el siguiente
// idle aplica el nuevo. Nunca lanza.
function maybeRecycleOpencodeForAgentUpdate(currentJobId: string): void {
  try {
    if (!consumeAgentsDirty()) return;
    let othersRunning = false;
    try {
      // Señal REAL de ocupación: worker en vuelo (foreman/triage/spec/resume)
      // o lock tomado (implement/review). El criterio viejo contaba cualquier
      // job no terminal — los Triage colgados (que nunca se parkean) dejaban
      // el reciclado diferido para siempre y la sesión nueva usaba el prompt
      // viejo cacheado por el server efímero.
      const all = workItemStore.list();
      othersRunning = hasActiveWorkers(all, currentJobId, {
        isWorker: (id) => isWorkerActive(id),
        isLocked: (id) =>
          workItemStore.isBuildingLocked(id) ||
          workItemStore.isReviewLocked(id),
      });
    } catch {
      // Ante duda no se recicla: se re-marca y el próximo inicio reintenta.
      try {
        markAgentsDirty();
      } catch {}
      return;
    }
    if (othersRunning) {
      try {
        markAgentsDirty();
      } catch {}
      try {
        console.log(
          `[Factory] agent prompt actualizado pero hay jobs corriendo → se aplica en próximo JOB idle (job ${currentJobId} usa prompt anterior)`,
        );
      } catch {}
      return;
    }
    try {
      opencodeServerManager.close();
    } catch {}
    try {
      console.log(
        `[Factory] agent prompt actualizado → opencode server reciclado para job ${currentJobId} (próximo JOB)`,
      );
    } catch {}
  } catch {
    // noop: el reciclado nunca rompe el intake
  }
}

function dispatchJobPostCreateT2(
  job: FactoryJob,
  validatedModelRef: { providerID: string; modelID: string; variant?: string } | undefined,
  prompt: string,
  worktree: string,
): void {
  try {
    maybeRecycleOpencodeForAgentUpdate(job.id);
  } catch {
    // noop
  }
  try {
    void tryCreateOpencodeSession(job).catch(() => {});
  } catch {
    // noop
  }
  try {
    const id = job.id;
    setImmediate(() => {
      void (async () => {
        try {
          const wi = workItemStore.get(id);
          if (!wi) return;
          if (wi.status !== "Intake") return;
          try {
            const transitioned = workItemStore.transition(id, "Foreman", "foreman", "foreman review started");
            (job as FactoryJob).status = transitioned.status;
            (job as FactoryJob).timeline = transitioned.timeline as unknown as FactoryJob["timeline"];
            job.updatedAt = Date.now();
            appendSingleStoreLog(id, `[${new Date().toISOString()}] foreman: Intake → Foreman`);
          } catch (e) {
            console.warn(`[Factory] Foreman transition failed for ${id}: ${String(e)}`);
            return;
          }
          await runForemanDecisionAndDispatch(id);
        } catch (e) {
          console.warn(`[Factory] Foreman LLM worker failed for ${id}: ${String(e)}`);
          try {
            const w = workItemStore.get(id);
            if (w && w.status === "Intake") {
              try { workItemStore.transition(id, "Foreman", "foreman", "foreman review started (fallback)"); } catch {}
            }
            const w2 = workItemStore.get(id);
            if (w2 && (w2.status === "Foreman" || w2.status === "Intake")) {
              const { buildFallbackDecision, buildErrorDecision, isInfraErrorMessage } = await import("../../shared/types/foreman");
              const msg = String(e);
              const isInfra = isInfraErrorMessage(msg);
              const fb = isInfra ? buildErrorDecision(msg.slice(0, 160), 0.5) : buildFallbackDecision(msg.slice(0, 80), 0.5);
              foremanLogStore.logDecision({ workItemId: id, prompt, worktree, modelRef: validatedModelRef, decision: fb });
              const targetStatus = isInfra ? "Cancelled" as const : "Triage" as const;
              try { workItemStore.transition(id, targetStatus, "foreman", `${isInfra ? "fallback error" : "fallback triage"}: ${msg.slice(0, 80)}`, { foremanDecision: fb } as unknown as Record<string, unknown>); } catch {}
              const upd = workItemStore.get(id);
              if (upd) {
                (job as FactoryJob).status = upd.status;
                (job as FactoryJob).timeline = upd.timeline as unknown as FactoryJob["timeline"];
                persistSingleStore(id);
              }
            }
          } catch {}
        }
      })();
    });
  } catch {
    // noop
  }
}

// ── TANDA 2 — Worker verify-retry con efectos del cascarón (1 llamada desde el handler) ──
function runVerifyWithServerEffectsT2(jid: string): Promise<void> {
  return runVerifyRetryWorkerT2(jid, {
    log: (a, b) => { try { appendSingleStoreLog(a, b); } catch {} },
    onNoted: (a, m) => { try { foremanLogStore.info(m, a); } catch {} },
    onPassReview: (a) => {
      setImmediate(() => {
        void (async () => {
          try {
            const w = workItemStore.get(a);
            if (!w || w.status !== "Review") return;
            try {
              void ensureJobSessionAttached(a).catch(() => {});
            } catch {}
            const { reviewService } = await import("../review/reviewService");
            await reviewService.handleReview(w);
          } catch (e) {
            console.warn(`[Factory] verify-retry review trigger fail ${a}: ${String(e).slice(0, 120)}`);
          }
        })();
      });
    },
  });
}

// ── Workflows engine (Fase 4b): runtime en background + rutas pre-tabla ──
let workflowRuntime: WorkflowRuntime | null = null;
const workflowRepoRoot = (): string => {
  const fromEnv = process.env.TERMCANVAS_WORKFLOWS_ROOT;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  // cwd primero; si no tiene factory/workflows, la raíz del repo del módulo
  // (daemon empaquetado corriendo desde resources u otro cwd).
  const candidates = [
    process.cwd(),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "factory", "workflows"))) {
        return candidate;
      }
    } catch {
      // candidato inválido: sigue
    }
  }
  return process.cwd();
};
function getWorkflowRuntime(): WorkflowRuntime {
  if (!workflowRuntime) {
    workflowRuntime = new WorkflowRuntime({
      repoRoot: workflowRepoRoot(),
      cwd: process.cwd(),
      runsDir: defaultRunsDir(),
      onEvent: (event) => {
        try {
          handleRunEvent(event);
        } catch {
          // el espejo nunca rompe el run
        }
      },
      onGate: (request) => {
        try {
          handleGate(request);
        } catch {
          // el espejo nunca rompe el run
        }
      },
    });
  }
  return workflowRuntime;
}
const tryHandleWorkflowRoute = createWorkflowRouteHandler(
  getWorkflowRuntime,
  workflowRepoRoot,
);

// ── Main request handler ──
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  try {
    // ── T01 isolation DELETE (pre-tabla; ver nota del helper) ──
    if (await tryHandleIsolationDeleteRoute(req, res, pathname)) return;
    // ── Agents body real (pre-tabla; PIN igual que el DELETE: la tabla queda
    // en 46 filas y PUT no existe en RouteMethod — parse propio y delegación
    // delgada al dominio `agents/agentFileRoutes`). GET devuelve solo el body,
    // PUT escribe solo el body preservando el frontmatter byte por byte.
    if (await tryHandleAgentFileRoute(req, res, pathname)) return;
    // ── Workflows engine (pre-tabla): lista, run, gates y cancel ──
    if (await tryHandleWorkflowRoute(req, res, pathname)) return;
    // ── TANDA C — Dispatch por tabla (C8): UN match + switch por dominio ──
    // El loop vive en `matchRoute` (routing/routeTable, acotado a 36 filas,
    // nunca lanza, null = no-ruta). Acá: match → dominio → respuesta.
    // Sin respuesta del handler (`!res.headersSent`) → 404 histórico.
    const routed = matchRoute(method, pathname);
    if (routed === null) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `not found: ${method} ${pathname}` }));
      return;
    }
    // ── Engine declarativo (F8c): acciones del panel sobre jobs espejados ──
    // Si el job tiene un run del engine, accept/retry/approve/reject/respond/
    // resume/cancel/discard se traducen a runtime.respond/resume/cancel.
    // Jobs legacy (sin run) siguen por el switch intactos.
    if (routed.id && WORKFLOW_ACTION_DOMAINS.has(routed.domain)) {
      const action = await tryHandleWorkflowAction({
        domain: routed.domain,
        itemId: routed.id,
        runtime: getWorkflowRuntime(),
        req,
      });
      if (action.handled) {
        res.writeHead(action.status ?? 200, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(action.body ?? { ok: true }));
        return;
      }
    }
    switch (routed.domain) {
      case "health": await handleHealthRoute(res); break;
      case "jobs-list": await handleJobsListRoute(pathname, res, url); break;
      case "foreman-logs": await handleForemanLogsRoute(url, res); break;
      case "jobs-create": await handleJobsCreateRoute(req, res); break;
      case "job-detail": await handleJobDetailRoute(pathname, res); break;
      case "job-logs": await handleJobLogsRoute(method, pathname, res); break;
      case "job-events": await handleJobEventsRoute(req, res, pathname); break;
      case "job-result": await handleResultBuildLogRoute(pathname, res); break;
      case "job-build-log": await handleResultBuildLogRoute(pathname, res); break;
      case "job-review": await handleJobReviewRoute(method, pathname, res); break;
      case "job-review-raw": await handleReviewRawRoute(pathname, res); break;
      case "job-review-accept": await handleReviewAcceptRoute(method, pathname, res); break;
      case "job-merge-notify": await handleMergeNotifyRoute(pathname, req, res); break;
      case "job-review-retry": await handleReviewRetryRoute(method, pathname, res); break;
      case "job-review-retry-review": await handleReviewRetryReviewRoute(method, pathname, res); break;
      case "job-triage-respond": await handleTriageRespondRoute(pathname, req, res); break;
      case "job-spec-approve": await handleSpecApproveRoute(pathname, res); break;
      case "job-spec-reject": await handleSpecRejectRoute(pathname, req, res); break;
      case "job-resume": await handleJobResumeRoute(pathname, res); break;
      case "job-verify-retry": await handleVerifyRetryRoute(pathname, res); break;
      case "job-verify": await handleVerifyGetRoute(pathname, res); break;
      case "job-cancel": await handleJobCancelRoute(pathname, res); break;
      case "job-discard": await handleJobDiscardRoute(pathname, res); break;
      case "job-review-rerun": await handleReviewRerunRoute(pathname, res); break;
      case "job-scores-get": await handleScoresGetRoute(pathname, res); break;
      case "job-scores-manual": await handleManualScoreRoute(pathname, res); break;
      case "scorers-list": await handleScorersListRoute(res); break;
      case "scores-summary": await handleScoresSummaryRoute(res); break;
      case "benchmarks-create": await handleBenchmarkCreateRoute(req, res); break;
      case "benchmarks-list": await handleBenchmarkListRoute(res); break;
      case "benchmark-get": await handleBenchmarkGetRoute(pathname, res); break;
      case "improve-failures": await handleImproveFailuresRoute(url, res); break;
      case "improve-proposals-create": await handleProposalCreateRoute(req, res); break;
      case "improve-proposals-list": await handleProposalListRoute(res); break;
      case "improve-proposal-get": await handleProposalGetRoute(pathname, res); break;
      case "improve-proposal-adopt": await handleProposalAdoptRoute(pathname, res); break;
      case "improve-proposal-discard": await handleProposalDiscardRoute(pathname, res); break;
      case "improve-proposal-retry-analysis": { const { handleProposalRetryAnalysisRoute } = await import("./measure/improvementRoutes"); await handleProposalRetryAnalysisRoute(pathname, res); break; }
      case "notifications-list": await handleNotificationsListRoute(res); break;
      case "notifications-ack": await handleNotificationAckRoute(pathname, res); break;
      case "definition-status": await handleDefinitionStatusRoute(res); break;
      case "automations-list": await handleAutomationsListRoute(res); break;
      case "automations-tick": await handleAutomationsTickRoute(req, res); break;
      case "integrations-status": await handleIntegrationsStatusRoute(res); break;
      case "integrations-test-post": await handleIntegrationsTestPostRoute(req, res); break;
      case "integrations-webhook-in": await handleIntegrationsWebhookInRoute(req, res); break;
      case "integrations-post-back": await handleIntegrationsPostBackRoute(req, res); break;
      default: break;
    }
    if (!res.headersSent) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `not found: ${method} ${pathname}` }));
      return;
    }
    return;
// ── TANDA C — Handlers por dominio + dispatch por tabla (C8 rutas en tabla) ──
// El MATCH vive en routing/routeTable (`matchRoute`: un recorrido acotado a 36
// filas con retorno temprano; nunca lanza, null = no-ruta). `handleRequest`
// hace UN match y despacha por dominio en el switch de arriba; cada handler
// conserva su cuerpo, sus formas y sus textos byte-idénticos (solo el gate
// `if` se vuelve `case`, y la caída sin respuesta se vuelve 404 genérico vía
// `!res.headersSent`, misma forma que el NOT FOUND histórico).
// Precedencia: las filas son mutuamente excluyentes (método + longitud exacta
// de segmentos + sufijo exacto), así que el orden no altera el resultado;
// donde el gate sumaba defensa (longitud, id), el handler la conserva.
// Deltas documentados ante no-ruta con forma casi-válida: ids reservados o
// inseguros que los gates laxos dejaban pasar ahora caen al 404 genérico
// (antes 400 o 404 específico del dominio); ningún pact ni suite vecina
// pineaba esos bordes por HTTP (ver tests/dispatch-table.test.ts).
// ── FASE 1 E1 — Bloque Rutas lista/detalle/salud (C8 tabla, C5 aditivo) ──
// Dueño: E1. MATCH y lectura en jobs/ (FASE 2 E1, paridad con tabla);
// formas y handlers intactos (pacts F01–F14). El resto NO se toca.
// ── HEALTH ── (MATCH por tabla; handler intacto)
// TANDA C: match en el loop (dominio "health"); cuerpo intacto.
async function handleHealthRoute(res: http.ServerResponse): Promise<void> {
  // TANDA 1: tienda única (conteo por estado legacy derivado del status;
  // misma semántica que el Map: queued=pendiente, running=en curso).
  const stored = workItemStore.list();
  const pending = stored.filter((w) => (w.state ?? mapStatusToLegacyState(w.status)) === "queued").length;
  const running = stored.filter((w) => (w.state ?? mapStatusToLegacyState(w.status)) === "running").length;
  const opencodeUrl = opencodeServerManager.getUrl() ?? OPENCODE_WEB_DEFAULT_URL;
  const opencodePort = opencodeServerManager.getPort();
  // Fast path: don't block health on provider fetch (was adding 800ms+). Use cached url presence.
  // Self-heal: si nunca hubo url, patear ensure en background (debounced 15s) para recuperarse solo.
  const mgrHasUrl = !!opencodeServerManager.getUrl();
  const opencodeStatus = mgrHasUrl ? "healthy" : "not_started";
  if (!mgrHasUrl) {
    const nowMs = Date.now();
    // TANDA B: debounce del self-heal en startup/startupService (misma
    // regla 15s; el efecto vivo `ensureClient` queda en el cascarón).
    if (shouldKickManagerB(lastManagerKickMs, nowMs)) {
      lastManagerKickMs = nowMs;
      void opencodeServerManager.ensureClient().then(() => {
        console.log(`[Factory] opencode manager self-heal ready ${opencodeServerManager.getUrl()}`);
      }).catch((e) => {
        console.warn(`[Factory] opencode manager self-heal failed: ${String(e).slice(0, 120)}`);
      });
    }
  }
  const mgrErr: string | null = typeof (opencodeServerManager as unknown as { getLastError?: () => string | null }).getLastError === "function"
    ? (opencodeServerManager as unknown as { getLastError: () => string | null }).getLastError()
    : null;
  // ── FASE 3 E2 — Snapshot salud (delegación delgada, C5 aditivo) ──
  // Dueño E2: health/healthRoutes construye el payload (pendiente y
  // corriendo, uptime, buildId y puertos por discovery). MATCH y forma
  // intactos (dueño E1 para el MATCH); solo la construcción delega.
  const payload = buildHealthPayloadE2({
    pending,
    running,
    uptime: startedAt ? Date.now() - startedAt : 0,
    buildId: ensureFactoryBuildId(),
    version: VERSION,
    ts: new Date().toISOString(),
    startedAt: startedAt ?? Date.now(),
    factoryPort: factoryPort ?? effectivePortRange().start,
    opencodeUrl,
    opencodeStatus,
    opencodePort,
    opencodeUptime: opencodeServerManager.getStartedAt() ? Date.now() - (opencodeServerManager.getStartedAt() as number) : 0,
    ...(mgrErr ? { opencodeError: mgrErr } : {}),
  });
  // ── FIN FASE 3 E2 — Snapshot salud ──
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
  return;
}

    // ── LIST JOBS ── (TANDA A: merge dashboard en jobs/, forma intacta; alias /work-items)
    // MATCH por tabla (forma y handler intactos).
    // TANDA C: match en el loop (dominio "jobs-list"); cuerpo intacto.
    // view=summary: proyección liviana para el poll (una sola clave `jobs`;
    // el renderer lee `workItems ?? jobs`). Vista full intacta por default.
async function handleJobsListRoute(pathname: string, res: http.ServerResponse, url?: URL): Promise<void> {
  let view: string | null = null;
  try {
    view = url?.searchParams.get("view") ?? null;
  } catch {
    view = null;
  }
  if (view === "summary") {
    let list: Array<Record<string, unknown>> = [];
    try {
      list = applyDashboardUrlsTA(getAllJobsForList("summary"), { resolveDirectory: resolveOpencodeDirectory, buildDashboardUrl });
    } catch {
      list = [];
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jobs: list }));
    return;
  }
  const list = applyDashboardUrlsTA(getAllJobsForList(), { resolveDirectory: resolveOpencodeDirectory, buildDashboardUrl });
  res.writeHead(200, { "Content-Type": "application/json" });
  // Compat: also expose as workItems alias
  const isWorkItems = pathname === "/work-items";
  res.end(JSON.stringify(isWorkItems ? { workItems: list, jobs: list } : { jobs: list, workItems: list }));
  return;
}

    // ── FOREMAN LOGS (Ola 1) ──
    // TANDA C: match en el loop (dominio "foreman-logs"); cuerpo intacto.
async function handleForemanLogsRoute(url: URL, res: http.ServerResponse): Promise<void> {
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(500, Math.max(1, parseInt(limitRaw, 10) || 100)) : 100;
  const logs = foremanLogStore.list(limit);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ logs, total: foremanLogStore.size() }));
  return;
}

    // ── CREATE JOB (TANDA 2: delegación a jobs/jobCreate ≤15 líneas, formas intactas) ──
    // TANDA C: match en el loop (dominio "jobs-create"); cuerpo intacto.
async function handleJobsCreateRoute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { parsed, raw, parseError } = await readBody(req);
  const outT2 = createJobRequestT2(parsed, raw, parseError, { resolveDirectory: resolveOpencodeDirectory, getBaseUrl: getOpencodeBaseUrlSync, buildDashboardUrl, onIdempotentReset: (rid) => { try { sseClients.delete(rid); } catch {} } });
  res.writeHead(outT2.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(outT2.body));
  if (outT2.status === 201 && outT2.job) {
    try { await runIsolationPostCreate(outT2.job.id); } catch {}
    try {
      const dj = outT2.job as unknown as FactoryJob;
      dispatchJobPostCreateT2(dj, outT2.validatedModelRef, dj.prompt, dj.worktree);
    } catch {}
  }
  return;
}

    // ── SINGLE JOB: /factory/jobs/:id + alias /work-items/:id (TANDA A: decisión de migración en jobs/, forma intacta) ──
    // MATCH por tabla (forma y handler intactos; el guard interno de longitud queda como defensa).
    // TANDA C: match en el loop (dominio "job-detail"); cuerpo intacto.
async function handleJobDetailRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const parts = pathname.split("/").filter(Boolean);
  // ["factory","jobs",":id"] or ["work-items",":id"]
  const isWorkItemsAlias = parts[0] === "work-items";
  const id = isWorkItemsAlias ? parts[1] : parts[2];
  if (parts.length === (isWorkItemsAlias ? 2 : 3)) {
    // TANDA 1: tienda única (sin fallback al Map dual; el restore
    // puebla el store desde disco, ver `restoreJobsFromDisk`).
    const wiD = workItemStore.get(id);
    if (!wiD) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: `job not found: ${id}` })); return; }
    const migD = resolveDashboardMigrationTA({ sessionId: wiD.sessionId, dashboardUrl: wiD.dashboardUrl, worktree: wiD.worktree, directory: wiD.directory }, { resolveDirectory: resolveOpencodeDirectory, buildDashboardUrl });
    if (migD) { wiD.dashboardUrl = migD.dashboardUrl; if (!wiD.directory) wiD.directory = migD.directory; persistSingleStore(id); }
    const resp = getSingleJobResponse(id);
    if (resp) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(resp)); return; }
  }
}
    // ── FIN FASE 1 E1 — Bloque Rutas lista/detalle/salud (el resto del archivo NO se toca) ──

// ── T01 isolation: helpers post-201 + DELETE (fuera de las regiones medidas
// por tests/jobs-create-delegation.test.ts A3 y tests/handlers-delegation —
// el handler create queda compacto y la tabla de rutas intacta) ──
// Hook post-201 (una vez, best-effort, nunca lanza): con `issueRef` válido
// y job no-pact crea (o anexa) la jaula `git worktree add` + rama
// `issue-N[-slug]`, en memoria (`workItem.isolation`) y en la meta
// `isolation` del timeline (durable). Sin `issueRef` o ante fallo: el 201
// queda en pie e in-place legado. Pacts: retorno inmediato.
async function runIsolationPostCreate(jobId: string): Promise<void> {
  try {
    if (typeof jobId !== "string" || jobId.length === 0) return;
    const wi = workItemStore.get(jobId);
    if (!wi) return;
    const ref = getIssueRef(jobId);
    if (ref === null) return;
    if (isPactIsolationJob({ id: wi.id, prompt: wi.prompt, worktree: wi.worktree })) return;
    const title = parseIssueTitleFromPrompt(wi.prompt, ref.issueNumber) ?? undefined;
    const ensured = await ensureIsolatedWorktree({
      repoAnchor: wi.worktree,
      issueNumber: ref.issueNumber,
      ...(title !== undefined ? { title } : {}),
      jobId,
    });
    if (!ensured.ok) {
      try {
        workItemStore.appendEvent(
          jobId,
          "system",
          `isolation unavailable: ${ensured.error} — running in place`,
          { isolation: { error: ensured.error } } as unknown as Record<string, unknown>,
        );
      } catch {}
      return;
    }
    const record = {
      branch: ensured.branch,
      baseBranch: ensured.baseBranch,
      worktreePath: ensured.worktreePath,
      repoRoot: ensured.repoRoot,
      state: "created" as const,
      createdAt: new Date().toISOString(),
    };
    try {
      wi.isolation = record;
    } catch {}
    try {
      workItemStore.appendEvent(
        jobId,
        "system",
        `isolation created branch=${ensured.branch}`,
        { isolation: { ...record } } as unknown as Record<string, unknown>,
      );
    } catch {}
  } catch {
    // Best-effort: el 201 ya se respondió; el job existe igual.
  }
}

// GET /factory/agents → { agents: [{ name, description, agentType }] }.
// GET /factory/agents/:name → { name, body, frontmatter } (frontmatter
// aditivo: los clientes viejos siguen leyendo `body`).
// PUT /factory/agents/:name { body?, frontmatter? } → { name, body,
// frontmatter } (`{ body }` solo sigue válido: frontmatter preservado +
// revalidación + espejo opencode best-effort).
// POST /factory/agents { name, frontmatter, body } → 201 { name,
// frontmatter, body } (alta en una pasada; 409 duplicado/2do foreman,
// 400 inválido).
// DELETE /factory/agents/:name → 200 { deleted } (404 ausente, 409 core,
// 400 inválido).
// Despacho previo a la tabla (mismo PIN que el DELETE: la tabla no se toca y
// PUT/POST no existen en RouteMethod). Nunca lanza: `true` = respondido.
async function tryHandleAgentFileRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {
  try {
    // Nota TC-5: este pre-tabla solo compara por desigualdad sobre
    // `req.method` (igual que el DELETE de worktree): cero ramas por método.
    if (req.method !== "GET" && req.method !== "PUT" && req.method !== "POST" && req.method !== "DELETE") return false;
    if (!pathname.startsWith("/factory/agents")) return false;
    // POST exacto (alta): no lleva :name en el path.
    if (req.method === "POST" && (pathname === "/factory/agents" || pathname === "/factory/agents/")) {
      let payload: Record<string, unknown> | null = null;
      try {
        const { parsed } = await readBody(req);
        payload = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        payload = null;
      }
      if (!payload) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "body JSON requerido: { name, frontmatter, body }" }));
        return true;
      }
      const created = createAgentFile(payload.name, payload.frontmatter, payload.body);
      if (!created.ok) {
        const status = created.code === "duplicate" || created.code === "foreman" ? 409 : 400;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: created.error }));
        return true;
      }
      // Agente nuevo: si no hay workers activos, reciclar YA para que la
      // próxima sesión lo vea sin esperar a otro job (si hay, difiere).
      maybeRecycleOpencodeForAgentUpdate("");
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: created.value.name, frontmatter: created.value.frontmatter, body: created.value.body, ...(typeof created.value.mirrorSynced === "boolean" ? { mirrorSynced: created.value.mirrorSynced } : {}) }));
      return true;
    }
    // GET exacto (lista): va antes del parseo :name (que lo rechazaría).
    if (req.method === "GET" && (pathname === "/factory/agents" || pathname === "/factory/agents/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ agents: listAgents() }));
      return true;
    }
    if (!pathname.startsWith("/factory/agents/")) return false;
    const parsedPath = parseAgentFilePath(pathname);
    if ("error" in parsedPath) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsedPath.error }));
      return true;
    }
    const name = parsedPath.name;
    // DELETE (los core se rechazan con 409 en deleteAgentFile).
    if (req.method === "DELETE") {
      const deleted = deleteAgentFile(name);
      if (!deleted.ok) {
        const status = deleted.code === "not-found" ? 404 : deleted.code === "protected" ? 409 : 400;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: deleted.error }));
        return true;
      }
      maybeRecycleOpencodeForAgentUpdate("");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted: deleted.value.name }));
      return true;
    }
    if (req.method !== "PUT") {
      const found = readAgentFull(name);
      if (!found.ok) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: found.error }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: found.value.name, body: found.value.body, frontmatter: found.value.frontmatter }));
      return true;
    }
    // PUT: `{ body?, frontmatter? }` JSON (misma forma que el resto del daemon: readBody).
    let putBody: unknown = undefined;
    let putFrontmatter: unknown = undefined;
    try {
      const { parsed } = await readBody(req);
      const rec = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
      if (rec !== null) {
        if ("body" in rec) putBody = rec.body;
        if ("frontmatter" in rec) putFrontmatter = rec.frontmatter;
      }
    } catch {
      putBody = undefined;
    }
    if (putFrontmatter === undefined) {
      // Camino clásico solo-body (compatibilidad intacta).
      const saved = writeAgentBody(name, putBody ?? null);
      if (!saved.ok) {
        const status = saved.error.includes("no encontrado") ? 404 : 400;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: saved.error }));
        return true;
      }
      // Prompt guardado: reciclar YA si no hay workers activos (si hay,
      // queda dirty y el próximo inicio de worker lo aplica).
      maybeRecycleOpencodeForAgentUpdate("");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: saved.value.name, body: saved.value.body, ...(typeof saved.value.mirrorSynced === "boolean" ? { mirrorSynced: saved.value.mirrorSynced } : {}) }));
      return true;
    }
    const savedFull = writeAgentFull(name, putFrontmatter, putBody);
    if (!savedFull.ok) {
      const status = savedFull.code === "not-found" ? 404 : savedFull.code === "foreman" ? 409 : 400;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: savedFull.error }));
      return true;
    }
    maybeRecycleOpencodeForAgentUpdate("");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: savedFull.value.name, body: savedFull.value.body, frontmatter: savedFull.value.frontmatter, ...(typeof savedFull.value.mirrorSynced === "boolean" ? { mirrorSynced: savedFull.value.mirrorSynced } : {}) }));
    return true;
  } catch {
    try {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no se pudo procesar el agente" }));
    } catch {}
    return true;
  }
}

// La única ruta nueva — DELETE /factory/jobs/:id/worktree — limpieza
// explícita y humana, jamás automática. Despacho previo a la tabla (PIN: la
// tabla queda en 43 filas / 42 dominios, el switch en 42 `case` y UN
// `matchRoute` según tests/dispatch-table.test.ts TC-1/TC-4/TC-6; DELETE no
// existe en RouteMethod — parse propio y delegación delgada al módulo).
async function tryHandleIsolationDeleteRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {
  try {
    if (req.method !== "DELETE") return false;
    if (!pathname.startsWith("/factory/jobs/")) return false;
    const parsedPath = parseWorktreeDeletePath(pathname);
    if ("error" in parsedPath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsedPath.error }));
      return true;
    }
    const id = parsedPath.id;
    const wi = workItemStore.get(id);
    if (!wi) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `job not found: ${id}` }));
      return true;
    }
    let force = false;
    try {
      const { parsed: delBody } = await readBody(req);
      if (
        delBody !== null &&
        typeof delBody === "object" &&
        !Array.isArray(delBody) &&
        (delBody as Record<string, unknown>).force === true
      ) {
        force = true;
      }
    } catch {
      force = false;
    }
    const memIso =
      wi.isolation !== undefined &&
      typeof wi.isolation.worktreePath === "string" &&
      wi.isolation.worktreePath.length > 0
        ? wi.isolation
        : null;
    const tlIso = memIso === null ? readIsolationFromTimeline(wi.timeline) : null;
    const isoPath = memIso?.worktreePath ?? tlIso?.worktreePath ?? null;
    if (isoPath === null) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no isolated worktree recorded given this job" }));
      return true;
    }
    // Visibilidad del PR (best-effort; el fallo deja `unknown`, que rehúsa
    // sin force). El cwd es el ancla del repo, siempre presente.
    const prMeta = readPrFromTimeline(wi.timeline);
    const prSel =
      (typeof memIso?.prNumber === "number" ? memIso.prNumber : null) ??
      (typeof prMeta?.prNumber === "number" ? prMeta.prNumber : null) ??
      (typeof memIso?.prUrl === "string" ? memIso.prUrl : null) ??
      (typeof prMeta?.prUrl === "string" ? prMeta.prUrl : null);
    let prState: PrVisibility = prSel === null ? "none" : "unknown";
    if (prSel !== null) {
      try {
        const seen =
          typeof prSel === "number"
            ? await readPrState({ repoPath: wi.worktree, prNumber: prSel })
            : await readPrState({ repoPath: wi.worktree, prUrl: prSel });
        if (seen.ok) prState = seen.state;
      } catch {
        prState = "unknown";
      }
    }
    // Suciedad (fail-closed: el fallo de lectura cuenta como sucio).
    let dirty = true;
    try {
      const check = await isWorkingTreeDirty({ worktreePath: isoPath });
      dirty = check.ok ? check.dirty : true;
    } catch {
      dirty = true;
    }
    const verdict = decideWorktreeDelete({
      status: wi.status,
      hasIsolation: true,
      prState,
      dirty,
      force,
    });
    if (!verdict.ok) {
      res.writeHead(verdict.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: verdict.reason }));
      return true;
    }
    const removed = await removeIsolatedWorktree({ worktreePath: isoPath, force });
    if (!removed.ok) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: removed.error }));
      return true;
    }
    try {
      const base = memIso ?? tlIso;
      const cleanedAt = new Date().toISOString();
      wi.isolation = {
        branch: base?.branch ?? "issue-unknown",
        baseBranch: base?.baseBranch ?? "main",
        worktreePath: isoPath,
        repoRoot: base?.repoRoot ?? path.dirname(isoPath),
        ...(typeof memIso?.prNumber === "number" || typeof prMeta?.prNumber === "number"
          ? { prNumber: (memIso?.prNumber as number) ?? (prMeta?.prNumber as number) }
          : {}),
        ...(typeof memIso?.prUrl === "string" || typeof prMeta?.prUrl === "string"
          ? { prUrl: (memIso?.prUrl as string) ?? (prMeta?.prUrl as string) }
          : {}),
        state: "cleaned" as const,
        createdAt:
          typeof (memIso as { createdAt?: unknown } | null)?.createdAt === "string"
            ? (memIso as unknown as { createdAt: string }).createdAt
            : cleanedAt,
      };
    } catch {}
    try {
      workItemStore.appendEvent(
        id,
        "system",
        `isolation worktree removed (${isoPath}) — branch kept`,
        { isolation: { ...(wi.isolation as unknown as Record<string, unknown>) } } as unknown as Record<string, unknown>,
      );
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id, path: isoPath, state: "cleaned" }));
    return true;
  } catch {
    try {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "worktree delete failed" }));
      }
    } catch {}
    return true;
  }
}

    // ── LOGS JSON (TANDA 2: delegación a jobs/, forma intacta; ≤30 líneas y op expuesta) ──
    // TANDA C: match en el loop (dominio "job-logs"); cuerpo intacto.
async function handleJobLogsRoute(method: string, pathname: string, res: http.ServerResponse): Promise<void> {
  const mT2 = parseJobLogsRouteT2(method, pathname);
  if (mT2) {
    const outT2 = getJobLogsT2(mT2.id);
    if (!outT2.ok) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: outT2.error })); return; }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: outT2.id, logs: outT2.logs })); return;
  }
}

    // ── SSE: /factory/jobs/:id/events (also alias /work-items/:id/events) ──
    // TANDA C: match en el loop (dominio "job-events"); cable intacto byte-idéntico.
async function handleJobEventsRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  const parts = pathname.split("/").filter(Boolean);
  // ["factory","jobs",":id","events"] or ["work-items",":id","events"]
  const isWorkItemsAlias = parts[0] === "work-items";
  const expectedLen = isWorkItemsAlias ? 3 : 4;
  if (parts.length === expectedLen) {
    const id = isWorkItemsAlias ? parts[1] : parts[2];
    // TANDA A: foto de datos en jobs/ (misma regla state/status/terminal;
    // el cable SSE —cabeceras, latidos, cierres finitos— no se toca).
    const snapTA = getJobEventsSnapshot(id);
    if (!snapTA.ok) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: snapTA.error }));
      return;
    }
    const targetLogs = snapTA.logs;
    // TANDA 1: estado derivado del store (misma regla de terminal).
    const targetState = snapTA.state;
    const targetStatus = snapTA.status;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    // send existing logs as data events
    for (const line of targetLogs) {
      res.write(`data: ${JSON.stringify({ line, ts: new Date().toISOString() })}\n\n`);
    }
    // For done/error jobs, Pact handshake needs finite response (not infinite keep-alive).
    // If job already done, send final event and close quickly so Verifier doesn't hang 45s.
    // For running jobs (live SSE), keep open to stream future logs (hybrid: Pact only checks handshake, helper checks live).
    const isTerminal = targetState === "done" || targetState === "error" || targetStatus === "Complete" || targetStatus === "Cancelled";
    if (isTerminal) {
      // For terminal jobs, give client a moment to read initial buffer then close.
      // This makes Pact verification succeed (finite body) while still allowing manual SSE clients
      // to get data: lines + event: done if they connect within timeout (collectSse handles close).
      res.write(`event: done\ndata: ${JSON.stringify({ state: targetState, status: targetStatus, ts: new Date().toISOString() })}\n\n`);
      const closeTimer = setTimeout(() => {
        try {
          res.end();
        } catch {}
      }, 300);
      req.on("close", () => clearTimeout(closeTimer));
      req.on("error", () => clearTimeout(closeTimer));
      // Don't add to sseClients, don't heartbeat - terminal job won't broadcast more logs.
      return;
    }

    if (!sseClients.has(id)) sseClients.set(id, new Set());
    sseClients.get(id)!.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {}
    }, 15000);

    // For Pact handshake: even for running jobs, we need finite response so Verifier doesn't hang 45s.
    // Keep open long enough for live logs (stub: 2200ms to done) then close. Manual helper with 3500ms still sees stream.
    // Real long-lived clients can reconnect; this is hybrid approach documented in F03.
    const finiteCloseTimer = setTimeout(() => {
      try {
        // Send final done event if job became done in the meantime
        // TANDA 1: tienda única (el Map dual murió; el estado manda).
        const wiCurrent = workItemStore.get(id);
        const isDoneNow =
          wiCurrent && (wiCurrent.status === "Complete" || wiCurrent.status === "Cancelled");
        if (isDoneNow) {
          const stateForEvent = wiCurrent.status === "Complete" ? "done" : wiCurrent.status === "Cancelled" ? "error" : "done";
          try {
            res.write(`event: done\ndata: ${JSON.stringify({ state: stateForEvent, ts: new Date().toISOString() })}\n\n`);
          } catch {}
        }
        res.end();
      } catch {}
    }, 4000);

    const cleanup = () => {
      clearInterval(heartbeat);
      clearTimeout(finiteCloseTimer);
      sseClients.get(id)?.delete(res);
      if (sseClients.get(id)?.size === 0) sseClients.delete(id);
      try {
        res.end();
      } catch {}
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
    // keep open for SSE live, but finite for Pact (4s)
    return;
  }
}

    // ── Ola 3: GET /factory/jobs/:id/result y .../build-log (TANDA A: lectura en jobs/, forma intacta) ──
    // TANDA C: match en el loop (dominios "job-result" + "job-build-log"); cuerpo intacto.
async function handleResultBuildLogRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const parts = pathname.split("/").filter(Boolean);
  const isWorkItemsAlias = parts[0] === "work-items";
  // /factory/jobs/:id/result -> parts ["factory","jobs",":id","result"] length 4, work-items => ["work-items",":id","result"] length 3
  const id = isWorkItemsAlias ? parts[1] : parts[2];
  if (pathname.endsWith("/result")) {
    const outR = readJobResultRawTA(id);
    if (!outR.ok) { res.writeHead(outR.code, { "Content-Type": "application/json" }); res.end(JSON.stringify(outR.hint === undefined ? { error: outR.error } : { error: outR.error, hint: outR.hint })); return; }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(outR.payload)); return;
  }
  const outB = readJobBuildLog(id);
  if (!outB.ok) { res.writeHead(outB.code, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: outB.error })); return; }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); res.end(outB.text); return;
}

    // ── Ola 4: GET /factory/jobs/:id/review (+ alias /work-items/:id/review) ──
    // FASE 2 E2: lectura en review/reviewActions (misma forma 200/400/404).
    // TANDA C: match en el loop (dominio "job-review"); cuerpo intacto.
async function handleJobReviewRoute(method: string, pathname: string, res: http.ServerResponse): Promise<void> {
  const parsedReview = parseReviewPath(method, pathname);
  if (parsedReview === null) {
    // Defensa: el gate ya filtró método+prefijo+sufijo, así que acá
    // siempre hay match; sin él se cae a los handlers siguientes (C2).
  } else if ("error" in parsedReview) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedReview.error }));
    return;
  } else {
    // TANDA 1: tienda única (el dominio ya resuelve sin legacy).
    const outcome = getReviewById(parsedReview.id);
    if (!outcome.ok) {
      res.writeHead(outcome.code, { "Content-Type": "application/json" });

      res.end(JSON.stringify({ error: outcome.error })); return;
    }
    // Misma forma del dominio (sin el flag interno `ok`).
    const { ok: _reviewOk, ...reviewBody } = outcome;
    void _reviewOk;
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(reviewBody)); return;
  }
}

    // ── Ola 5: GET /factory/jobs/:id/review/raw (+ alias; espejo de GET /:id/review) ──
    // FASE 2 E2: lectura del raw en review/reviewActions (mismo texto plano
    // 200, mismos 404 con textos idénticos y mismo 500 de lectura).
    // TANDA C: match en el loop (dominio "job-review-raw"); cuerpo intacto.
async function handleReviewRawRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const parsedRaw = parseReviewRawPath(pathname);
  if (!parsedRaw || "error" in parsedRaw) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "missing id for review raw" }));
    return;
  }
  // TANDA 1: tienda única (el dominio ya resuelve sin legacy).
  const outRaw = readReviewRawById(parsedRaw.id);
  if (!outRaw.ok) {
    res.writeHead(outRaw.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: outRaw.error }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); res.end(outRaw.text); return;
}

    // ── Ola 4 P1: POST /factory/jobs/:id/review/accept (+ alias; humano acepta igual) ──
    // FASE 2 E2: transición en review/reviewActions (Review→Complete con
    // `.done`, misma forma 200); el aviso (log + auto-score) lo aporta el
    // caller por `onAccepted` (vive acá, dominio ajeno).
    // TANDA C: match en el loop (dominio "job-review-accept"); cuerpo intacto.
async function handleReviewAcceptRoute(method: string, pathname: string, res: http.ServerResponse): Promise<void> {
  const parsedAccept = parseReviewAcceptPath(method, pathname);
  if (parsedAccept === null) {
    // Defensa: el gate ya filtró método+sufijo; sin match se cae abajo (C2).
  } else {
    // Gate PR-antes-de-Complete (read-only): rama aislada + worktree
    // limpio + 0 commits vs base → 409 honesto, el job QUEDA en Review.
    // Completar sería varar un Complete sin diff ni PR posible.
    let gate: { ok: true } | { ok: false; error: string } = { ok: true };
    try {
      gate = await gateAcceptOnBranchDiff(parsedAccept.id);
    } catch {
      gate = { ok: true };
    }
    if (!gate.ok) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: gate.error }));
      return;
    }
    const outAccept = acceptReviewEqual(parsedAccept.id, {
      onAccepted: (aid) => {
        try {
          appendSingleStoreLog(aid, `[${new Date().toISOString()}] review: aceptado igual por humano → Complete`);
        } catch {}
        // T01 isolation: primer Complete de un job aislado abre el PR de
        // handoff (una vez por job, best-effort; legados son no-op).
        setImmediate(() => {
          void maybeOpenPrForCompletedJob(aid);
        });
        setImmediate(() => {
          void runHumanAcceptAutoScore(aid);
        });
      },
    });
    if (!outAccept.ok) {
      res.writeHead(outAccept.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: outAccept.error }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id: outAccept.id, status: outAccept.status }));
    return;
  }
}

    // ── POST /factory/jobs/:id/merge-notify (+ alias; el forge mergeó el PR) ──
    // Close-out Warp paso 7 (cierre): registra el merge en el job (evento
    // durable + isolation.state="pr-merged"). Idempotente: duplicados
    // responden ok sin duplicar eventos. Sin git ni red (solo store).
async function handleMergeNotifyRoute(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    if (typeof pathname !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid pathname" }));
      return;
    }
    const isFactory = pathname.startsWith("/factory/jobs/");
    const isAlias = pathname.startsWith("/work-items/");
    if ((!isFactory && !isAlias) || !pathname.endsWith("/merge-notify")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not merge-notify route" }));
      return;
    }
    const parts = pathname.split("/").filter(Boolean);
    const expectedLen = isAlias ? 3 : 4;
    if (parts.length !== expectedLen) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unexpected path length for merge-notify" }));
      return;
    }
    const id = isAlias ? parts[1] : parts[2];
    if (typeof id !== "string" || id.length === 0 || id === "merge-notify") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing id for merge-notify" }));
      return;
    }
    let prNumber: unknown = null;
    try {
      const { parsed } = await readBody(req);
      const rec = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
      prNumber = rec !== null ? rec.prNumber : null;
    } catch {
      prNumber = null;
    }
    const out = notePrMergedEqual(id, prNumber);
    if (!out.ok) {
      res.writeHead(out.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: out.error }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id: out.id, prNumber: out.prNumber, duplicate: out.duplicate }));
    return;
  } catch {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "merge-notify failed" }));
    return;
  }
}

    // ── Ola 4 P1: POST /factory/jobs/:id/review/retry (+ alias; humano manda a Building) ──
    // FASE 2 E2: transición en review/reviewActions (Review→Building sin
    // budget, misma forma 200); el re-disparo de implement lo agenda el
    // caller (vive acá).
    // TANDA C: match en el loop (dominio "job-review-retry"); cuerpo intacto.
    // (El descarte de `.../review/retry-review` que hacía el gate sobra acá:
    // la tabla distingue ambos sufijos por longitud+sufijo exactos.)
async function handleReviewRetryRoute(method: string, pathname: string, res: http.ServerResponse): Promise<void> {
  const parsedRetry = parseReviewRetryPath(method, pathname);
  if (parsedRetry === null) {
    // Defensa: sin match se cae a los handlers siguientes (C2).
  } else {
    const outRetry = requestReviewRetryToBuilding(parsedRetry.id, {
      onAccepted: (rid, _count) => {
        try {
          appendSingleStoreLog(rid, `[${new Date().toISOString()}] review: reintento humano → Building (re-corre implement)`);
        } catch {}
        setImmediate(() => {
          void (async () => {
            try {
              const w = workItemStore.get(rid);
              if (!w || w.status !== "Building") return;
              try {
                void ensureJobSessionAttached(rid).catch(() => {});
              } catch {}
              const { implementService } = await import("../implement/implementService");
              await implementService.handleBuilding(w);
            } catch (e) {
              console.warn(`[Factory] review-retry implement re-dispatch failed for ${rid}: ${String(e).slice(0, 120)}`);
            }
          })();
        });
      },
    });
    if (!outRetry.ok) {
      res.writeHead(outRetry.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: outRetry.error }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id: outRetry.id, status: outRetry.status }));
    return;
  }
}

    // ── Ola 5: POST /factory/jobs/:id/review/retry-review (+ alias; solo-review sin re-correr implement) ──
    // FASE 2 E2: guards en review/reviewActions (misma forma 200 sin
    // re-correr implement); el `run` y su agenda se inyectan (viven acá).
    // TANDA C: match en el loop (dominio "job-review-retry-review"); cuerpo intacto.
async function handleReviewRetryReviewRoute(method: string, pathname: string, res: http.ServerResponse): Promise<void> {
  const parsedRR = parseReviewRetryReviewPath(method, pathname);
  if (parsedRR === null) {
    // Defensa: sin match se cae a los handlers siguientes (C2).
  } else {
    const outRR = requestReviewRetryOnly(parsedRR.id, {
      run: async (jid: string) => {
        const { reviewService } = await import("../review/reviewService");
        const w = workItemStore.get(jid);
        if (!w || w.status !== "Review") return;
        try {
          void ensureJobSessionAttached(jid).catch(() => {});
        } catch {}
        await reviewService.handleReview(w);
      },
      schedule: (fn: () => void) => setImmediate(fn),
      onAccepted: (jid) => {
        try {
          appendSingleStoreLog(jid, `[${new Date().toISOString()}] review: reintento solo-review (sin re-correr implement)`);
        } catch {}
      },
    });
    if (!outRR.ok) {
      res.writeHead(outRR.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: outRR.error }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id: parsedRR.id, status: outRR.status }));
    return;
  }
}

    // ── H-002 E2: POST .../triage/respond (delegación a triageSpec/; Triage→Foreman sin estados nuevos) ──
    // TANDA C: match en el loop (dominio "job-triage-respond"); cuerpo intacto.
async function handleTriageRespondRoute(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsedTR = parseTriageRespondPath(pathname);
  if ("error" in parsedTR) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedTR.error }));
    return;
  }
  const guardsTR = checkTriageRespondGuards(workItemStore.get(parsedTR.id) ?? null, parsedTR.id);
  if (!guardsTR.ok) {
    res.writeHead(guardsTR.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: guardsTR.error }));
    return;
  }
  const { parsed: bodyTR } = await readBody(req);
  const validTR = parseTriageRespondBody(bodyTR);
  if (!validTR.ok) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: validTR.error }));
    return;
  }
  try {
    applyTriageRespondTransition(parsedTR.id, validTR.answers);
  } catch (e) {
    const codeTR = (e as { status?: unknown })?.status === 404 ? 404 : 409;
    const msgTR = e instanceof Error ? e.message : String(e);
    res.writeHead(codeTR, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msgTR.slice(0, 160) }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: parsedTR.id, status: "Foreman" }));
  // Re-disparo del foreman con las respuestas humanas (sin estados nuevos).
  setImmediate(() => {
    void runForemanDecisionAndDispatch(parsedTR.id);
  });
  return;
}

    // ── Ola 8: POST .../spec/approve (delegación a triageSpec/; Triage→Foreman con skipTriageSpec) ──
    // TANDA C: match en el loop (dominio "job-spec-approve"); cuerpo intacto.
async function handleSpecApproveRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const parsedSA = parseSpecApprovePathE2(pathname);
  if ("error" in parsedSA) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedSA.error }));
    return;
  }
  const guardsSA = checkSpecApproveGuardsE2(workItemStore.get(parsedSA.id) ?? null, parsedSA.id);
  if (!guardsSA.ok) {
    res.writeHead(guardsSA.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: guardsSA.error }));
    return;
  }
  try {
    applySpecApproveTransition(parsedSA.id);
  } catch (e) {
    const codeSA = (e as { status?: unknown })?.status === 404 ? 404 : 409;
    const msgSA = e instanceof Error ? e.message : String(e);
    res.writeHead(codeSA, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msgSA.slice(0, 160) }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: parsedSA.id, status: "Foreman" }));
  // Re-disparo del foreman con la spec ya aprobada (skipTriageSpec: no
  // re-corre triage/spec; la spec trazada viaja en el timeline).
  setImmediate(() => {
    void runForemanDecisionAndDispatch(parsedSA.id, { skipTriageSpec: true });
  });
  return;
}

    // ── POST .../spec/reject (delegación a triageSpec/; queda en Triage y
    // re-corre el spec agent con el motivo humano) ──
    // TANDA C: match en el loop (dominio "job-spec-reject"); cuerpo espejo
    // de approve con worker propio de regeneración.
async function handleSpecRejectRoute(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsedSR = parseSpecRejectPathE2(pathname);
  if ("error" in parsedSR) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedSR.error }));
    return;
  }
  const guardsSR = checkSpecRejectGuardsE2(workItemStore.get(parsedSR.id) ?? null, parsedSR.id);
  if (!guardsSR.ok) {
    res.writeHead(guardsSR.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: guardsSR.error }));
    return;
  }
  const { parsed: bodySR } = await readBody(req);
  const validSR = parseSpecRejectBodyE2(bodySR);
  if (!validSR.ok) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: validSR.error }));
    return;
  }
  try {
    applySpecRejectTransition(parsedSR.id, validSR.feedback);
  } catch (e) {
    const codeSR = (e as { status?: unknown })?.status === 404 ? 404 : 409;
    const msgSR = e instanceof Error ? e.message : String(e);
    res.writeHead(codeSR, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msgSR.slice(0, 160) }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: parsedSR.id, status: "Triage" }));
  // Regeneración del brief con el motivo humano (queda en Triage; si el
  // brief nuevo es trivial o el spec falla, continúa a Foreman).
  const rejectFeedback = validSR.feedback;
  setImmediate(() => {
    void runSpecRejectWorker(parsedSR.id, rejectFeedback);
  });
  return;
}

/**
 * Worker post-reject: re-corre el Spec-agent con el motivo humano y reabre
 * el gate con el brief nuevo. Sin estados nuevos, sin loops escritos:
 * - brief no-trivial → evento con pedido NUEVO (queda en Triage, notifica).
 * - brief trivial o spec omitido → Triage→Foreman + foreman completo (sin
 *   skip: evaluación fresca, como el skip del flujo principal).
 * Si el job ya no está en Triage (el humano avanzó meanwhile), no hace nada.
 * Nunca lanza (el caller es setImmediate).
 */
async function runSpecRejectWorker(id: string, feedback: string | null): Promise<void> {
  try {
    const wi = workItemStore.get(id);
    if (!wi || wi.status !== "Triage") return;
    let triageCtx: TriageFindings | undefined;
    try {
      const { getLatestTriage } = await import("../triage/triageFlow");
      triageCtx = getLatestTriage(wi) ?? undefined;
    } catch {
      triageCtx = undefined;
    }
    const specRes = await runSpecForJob(wi, triageCtx, feedback ?? undefined);
    const cur = workItemStore.get(id);
    if (!cur || cur.status !== "Triage") return;
    if (specRes.brief) {
      try {
        persistSpec(id, specRes.brief);
      } catch {}
      if (!specRes.brief.trivial) {
        try {
          workItemStore.appendEvent(
            id,
            "system",
            `spec regenerada tras rechazo: espera aprobación — ${specRes.brief.summary.slice(0, 120)}`,
            buildSpecApprovalMeta(specRes.brief.summary),
          );
        } catch {}
        try {
          appendSingleStoreLog(id, `[${new Date().toISOString()}] spec: brief regenerado tras rechazo → Triage (espera aprobación POST /spec/approve)`);
        } catch {}
        try {
          foremanLogStore.info(`[Spec] ${id} → Triage espera aprobación (brief regenerado)`, id);
        } catch {}
        try { notify({ kind: "spec-approval", workItemId: id, title: "Spec pendiente de aprobación", body: specRes.brief.summary.slice(0, 500) }); } catch {}
        return;
      }
    } else {
      try {
        workItemStore.appendEvent(
          id,
          "system",
          `spec omitida tras rechazo (${(specRes.skipReason ?? "sin brief").slice(0, 120)}): sigue a Foreman`,
          { specSkipped: true } as unknown as Record<string, unknown>,
        );
      } catch {}
    }
    try {
      workItemStore.transition(id, "Foreman", "system", "spec tras rechazo: re-corre foreman");
    } catch {
      return;
    }
    await runForemanDecisionAndDispatch(id);
  } catch (e) {
    console.warn(`[Factory] Spec reject worker fallo ${id}: ${String(e).slice(0, 120)}`);
  }
}

    // ── P3d: POST /factory/jobs/:id/resume (+ alias; humano retoma un turno
    // parqueado por reinicio) ──
    // TANDA C: match en el loop (dominio "job-resume"). Guards + marca en
    // jobs/jobService (404/409 honestos, marca `resumed` sincrónica anti
    // doble disparo); el worker de la fase lo agenda el caller (vive acá).
async function handleJobResumeRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const partsR = pathname.split("/").filter(Boolean);
  const aliasR = partsR[0] === "work-items";
  const idR = aliasR ? partsR[1] : partsR[2];
  const outR = requestJobResumeTA(idR);
  if (!outR.ok) {
    res.writeHead(outR.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: outR.error }));
    return;
  }
  appendSingleStoreLog(outR.id, `[${new Date().toISOString()}] resume: ${outR.id} retomado por humano en ${outR.status}`);
  try { foremanLogStore.info(`[Resume] ${outR.id} retomado en ${outR.status} (humano)`, outR.id); } catch {}
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, id: outR.id, status: outR.status }));
  const resumeStatus = outR.status;
  setImmediate(() => {
    void runResumeWorker(outR.id, resumeStatus);
  });
  return;
}

/**
 * Worker post-resume: re-dispara el worker de la fase donde quedó el turno
 * (Foreman decide de cero; Building corre implement; Review corre review con
 * sus locks). Si el job se movió meanwhile, no hace nada. Marca el job en
 * vuelo (Agents tiempo-real: el reciclado del server no debe pisarlo) e
 * intenta el reciclado al entrar (prompt guardado mientras estaba parado).
 * Nunca lanza.
 */
async function runResumeWorker(id: string, status: string): Promise<void> {
  try {
    maybeRecycleOpencodeForAgentUpdate(id);
  } catch {
    // noop: el reciclado nunca frena el worker
  }
  markWorkerActive(id);
  try {
    const w = workItemStore.get(id);
    if (!w || w.status !== status) return;
    if (status === "Foreman") {
      await runForemanDecisionAndDispatch(id);
      return;
    }
    if (status === "Building") {
      const { implementService } = await import("../implement/implementService");
      await implementService.handleBuilding(w);
      return;
    }
    if (status === "Review") {
      const { reviewService } = await import("../review/reviewService");
      await reviewService.handleReview(w);
      return;
    }
  } catch (e) {
    console.warn(`[Factory] resume worker fallo ${id}: ${String(e).slice(0, 120)}`);
  } finally {
    clearWorkerActive(id);
  }
}

    // ── DISCARD: POST /factory/jobs/:id/discard + alias (NO RETOMAR TRABAJO: cancela y limpia lo que hizo) ──
    // TANDA C: match en el loop (dominio "job-discard"); delega en jobs/jobDiscard (single-shot humano, sin reintentos).
async function handleJobDiscardRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const partsD = pathname.split("/").filter(Boolean);
  const aliasD = partsD[0] === "work-items";
  const idD = aliasD ? partsD[1] : partsD[2];
  const { requestJobDiscard } = await import("./jobs/jobDiscard");
  const outD = await requestJobDiscard(idD);
  if (!outD.ok) { res.writeHead(outD.code, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: outD.error })); return; }
  appendSingleStoreLog(outD.id, `[${new Date().toISOString()}] discard: ${outD.id} teardown completo (PR ${outD.cleaned.prClosed.length}, rama ${outD.cleaned.branchDeleted.length}, worktree ${outD.cleaned.worktreeRemoved.length}, borrados ${outD.cleaned.deleted.length}, revertidos ${outD.cleaned.restored.length}) (pedido humano)`);
  try { foremanLogStore.info(`[Discard] ${outD.id} teardown completo (humano)`, outD.id); } catch {}
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, id: outD.id, state: outD.state, status: outD.status, cleaned: outD.cleaned })); return;
}

    // ── RERUN: POST /factory/jobs/:id/review/rerun + alias (re-revisa un Complete sin mover status) ──
    // TANDA C: match en el loop (dominio "job-review-rerun"); delega en review/reviewRerun (single-shot humano, sin reintentos).
async function handleReviewRerunRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const partsR = pathname.split("/").filter(Boolean);
  const aliasR = partsR[0] === "work-items";
  const idR = aliasR ? partsR[1] : partsR[2];
  if (!idR || idR === "review" || idR === "rerun") { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "missing id for review rerun" })); return; }
  const { runReviewRerun } = await import("../review/reviewRerun");
  const outR = await runReviewRerun(idR);
  if (!outR.ok) { res.writeHead(outR.code, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: outR.error })); return; }
  appendSingleStoreLog(outR.id, `[${new Date().toISOString()}] review-rerun: ${outR.id} ${outR.verdict} (intento ${outR.attempt}, sin mover status) (pedido humano)`);
  try { foremanLogStore.info(`[ReviewRerun] ${outR.id} ${outR.verdict} (humano)`, outR.id); } catch {}
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, id: outR.id, status: outR.status, verdict: outR.verdict, summary: outR.summary, findings: outR.findings, attempt: outR.attempt })); return;
}

    // ── Ola 9: POST .../verify-retry (TANDA 2: handler .../review/verify-retry, 1 llamada, forma intacta) ──
    // TANDA C: match en el loop (dominio "job-verify-retry"); cuerpo intacto.
async function handleVerifyRetryRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const parsedV = parseVerifyRetryPath(pathname);
  if (!parsedV || "error" in parsedV) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "invalid path" })); return; }
  const outV = requestVerifyRetryT2(parsedV.id, { run: (jid: string) => runVerifyWithServerEffectsT2(jid), schedule: (fn: () => void) => setImmediate(fn) });
  if (!outV.ok) { res.writeHead(outV.code, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: outV.error })); return; }
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, id: outV.id, status: "Triage" })); return;
}

    // ── Ola 9: GET .../verify (sirve verify.json; TANDA 2: lectura en verify/) ──
    // TANDA C: match en el loop (dominio "job-verify"); cuerpo intacto.
async function handleVerifyGetRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const parsedVG = parseVerifyGetPath(pathname);
  if (!parsedVG || "error" in parsedVG) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "missing id for verify" })); return; }
  const outVG = readVerifyById(parsedVG.id);
  if (!outVG.ok) { res.writeHead(outVG.code, { "Content-Type": "application/json" }); res.end(JSON.stringify(outVG.hint === undefined ? { error: outVG.error } : { error: outVG.error, hint: outVG.hint })); return; }
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(outVG.payload)); return;
}

    // ── CANCEL: POST /factory/jobs/:id/cancel + alias /work-items/:id/cancel (TANDA A: cambio de estado en jobs/, forma intacta) ──
    // TANDA C: match en el loop (dominio "job-cancel"); cuerpo intacto.
async function handleJobCancelRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const partsC = pathname.split("/").filter(Boolean);
  const aliasC = partsC[0] === "work-items";
  const idC = aliasC ? partsC[1] : partsC[2];
  const outC = requestJobCancelTA(idC);
  if (!outC.ok) { res.writeHead(outC.code, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: outC.error })); return; }
  appendSingleStoreLog(outC.id, `[${new Date().toISOString()}] cancel: ${outC.id} pasa a ${outC.status} (pedido humano)`);
  try { foremanLogStore.info(`[Cancel] ${outC.id} pasa a ${outC.status} (humano)`, outC.id); } catch {}
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, id: outC.id, state: outC.state, status: outC.status })); return;
}

    // ── FASE 3 E1 — Bloque Rutas measure (delegación delgada, C5 aditivo) ──
    // Dueño E1: factory/measure/scorerRoutes (parsers/guards puros + lecturas
    // + scoring manual; puerta del cascarón hacia scorers). El server conserva
    // formas/handlers/respuestas; solo el MATCH, los guards y la lectura
    // delegan (import dinámico, como implementService, sin ciclos).
    // Dominios de routeTable: scorers-list, scores-summary, job-scores-get,
    // job-scores-manual. Pacts F01–F14, thresholds y sampling intactos.
    // ── scorers-list: GET /factory/scorers ──
    // TANDA C: match en el loop (dominio "scorers-list"); cuerpo intacto.
async function handleScorersListRoute(res: http.ServerResponse): Promise<void> {
  const { listScorers } = await import("./measure/scorerRoutes");
  const scorers = listScorers();
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ scorers })); return;
}

    // ── scores-summary: GET /factory/scores/summary ──
    // TANDA C: match en el loop (dominio "scores-summary"); cuerpo intacto.
async function handleScoresSummaryRoute(res: http.ServerResponse): Promise<void> {
  const { getScoresSummary } = await import("./measure/scorerRoutes");
  const summary = getScoresSummary();
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(summary)); return;
}

    // ── Ola 11: GET /factory/jobs/:id/scores (+ alias; lee scores del job) ──
    // TANDA C: match en el loop (dominio "job-scores-get"); cuerpo intacto.
async function handleScoresGetRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const { parseScoresGetPath, jobExistsForScores, readScores } = await import("./measure/scorerRoutes");
  const parsedS = parseScoresGetPath(pathname);
  if ("error" in parsedS) {
    if (parsedS.error === "not scores route") {
      // Defensa: el gate ya filtró; sin match se cae abajo (C2).
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsedS.error }));
      return;
    }
  } else {
    if (!jobExistsForScores(parsedS.id)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `job not found: ${parsedS.id}` }));
      return;
    }
    const scoresS = readScores(parsedS.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ workItemId: parsedS.id, scores: scoresS }));
    return;
  }
}

    // ── Ola 11/18: POST /factory/jobs/:id/scores/:name (+ alias; score manual con guards + gate) ──
    // TANDA C: match en el loop (dominio "job-scores-manual"); cuerpo intacto.
async function handleManualScoreRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const { parseManualScorePath, checkManualScoreRequest, collectScorerInputs, loadScorer, scoreJob } = await import("./measure/scorerRoutes");
  const { isUnscored, isNotApplicable } = await import("../measure/scorerEngine");
  const parsedMS = parseManualScorePath(pathname);
  if ("error" in parsedMS) {
    if (parsedMS.error === "not manual-score route") {
      // Defensa: sin match se cae a los handlers siguientes (C2).
    } else {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: parsedMS.error }));
      return;
    }
  } else {
    const loadedMS = loadScorer(parsedMS.scorer);
    const guardMS = checkManualScoreRequest({
      jobId: parsedMS.id,
      jobExists: workItemStore.get(parsedMS.id),
      scorer: parsedMS.scorer,
      scorerExists: loadedMS,
      scorerAgents: loadedMS?.definition?.agents ?? null,
      inputs: collectScorerInputs(parsedMS.id),
    });
    if (!guardMS.ok) {
      res.writeHead(guardMS.code, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: guardMS.error }));
      return;
    }
    const outcomeMS = await scoreJob(parsedMS.id, parsedMS.scorer, { manual: true });
    if (isNotApplicable(outcomeMS)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: outcomeMS.reason, requiredStages: outcomeMS.requiredStages }));
      return;
    }
    if (isUnscored(outcomeMS)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: outcomeMS.reason }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id: parsedMS.id, scorer: parsedMS.scorer, outcome: outcomeMS }));
    return;
  }
}

    // ── Ola 12: POST /factory/benchmarks (crea run + ejecuta trials en background) ──
    // FASE 3 E1: validación compuesta en measure/benchmarkRoutes (mismo orden
    // y mismos textos); creación/ejecución en measure/benchmarkEngine.
    // TANDA C: match en el loop (dominio "benchmarks-create"); cuerpo intacto.
async function handleBenchmarkCreateRoute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { parsed: bodyBM } = await readBody(req);
  const { validateBenchmarkCreate, createPendingBenchmarkRun, executeBenchmarkTrials } = await import("./measure/benchmarkRoutes");
  const validBM = validateBenchmarkCreate(bodyBM);
  if (!validBM.ok) {
    res.writeHead(validBM.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: validBM.error }));
    return;
  }
  const pendingBM = createPendingBenchmarkRun(validBM.def);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, run: pendingBM }));
  // Trials secuenciales en background (nunca en paralelo; no bloquea el 201).
  setImmediate(() => {
    void (async () => {
      try {
        await executeBenchmarkTrials(pendingBM.id, validBM.def);
      } catch (e) {
        console.warn(`[Factory] benchmark trials failed for ${pendingBM.id}: ${String(e).slice(0, 120)}`);
      }
    })();
  });
  return;
}

    // ── Ola 12: GET /factory/benchmarks (lista runs) ──
    // TANDA C: match en el loop (dominio "benchmarks-list"); cuerpo intacto.
async function handleBenchmarkListRoute(res: http.ServerResponse): Promise<void> {
  const { listBenchmarkRuns } = await import("./measure/benchmarkRoutes");
  const runsBM = listBenchmarkRuns();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ runs: runsBM }));
  return;
}

    // ── Ola 12: GET /factory/benchmarks/:id (un run) ──
    // TANDA C: match en el loop (dominio "benchmark-get"); cuerpo intacto.
async function handleBenchmarkGetRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const { parseBenchmarkGetPath, getBenchmarkRun } = await import("./measure/benchmarkRoutes");
  const parsedBG = parseBenchmarkGetPath(pathname);
  if ("error" in parsedBG) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedBG.error }));
    return;
  }
  const runBG = getBenchmarkRun(parsedBG.id);
  if (!runBG) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `benchmark not found: ${parsedBG.id}` }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ run: runBG }));
  return;
}

    // ── Ola 13: GET /factory/improve/failures?scorer=NAME ──
    // TANDA C: match en el loop (dominio "improve-failures"); cuerpo intacto.
async function handleImproveFailuresRoute(url: URL, res: http.ServerResponse): Promise<void> {
  const { checkFailuresRequest, collectFailures } = await import("./measure/improvementRoutes");
  const checkedF = checkFailuresRequest(url.searchParams.get("scorer"));
  if (!checkedF.ok) {
    res.writeHead(checkedF.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: checkedF.error }));
    return;
  }
  const failures = collectFailures(checkedF.scorer);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ scorer: checkedF.scorer, failures }));
  return;
}

    // ── Ola 13: POST /factory/improve/proposals (crea propuesta + analiza) ──
    // TANDA C: match en el loop (dominio "improve-proposals-create"); cuerpo intacto.
async function handleProposalCreateRoute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { parsed: bodyIP } = await readBody(req);
  const { checkCreateProposalBody, createPendingProposal, runAnalysisForProposal } = await import("./measure/improvementRoutes");
  const validIP = checkCreateProposalBody(bodyIP);
  if ("error" in validIP) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: validIP.error }));
    return;
  }
  const pendingIP = createPendingProposal(validIP.scorer);
  const analyzedIP = await runAnalysisForProposal(pendingIP.id);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, proposal: analyzedIP }));
  return;
}

    // ── Ola 13: GET /factory/improve/proposals (lista resúmenes) ──
    // TANDA C: match en el loop (dominio "improve-proposals-list"); cuerpo intacto.
async function handleProposalListRoute(res: http.ServerResponse): Promise<void> {
  const { listProposalSummaries } = await import("./measure/improvementRoutes");
  const proposals = listProposalSummaries();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ proposals }));
  return;
}

    // ── Ola 13: GET /factory/improve/proposals/:id (una propuesta) ──
    // TANDA C: match en el loop (dominio "improve-proposal-get"); cuerpo intacto.
async function handleProposalGetRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const { parseProposalGetPath, readProposal } = await import("./measure/improvementRoutes");
  const parsedPG = parseProposalGetPath(pathname);
  if ("error" in parsedPG) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedPG.error }));
    return;
  }
  const proposalPG = readProposal(parsedPG.id);
  if (!proposalPG) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `proposal not found: ${parsedPG.id}` }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ proposal: proposalPG }));
  return;
}

    // ── Ola 13: POST /factory/improve/proposals/:id/adopt (humano adopta; único writer) ──
    // TANDA C: match en el loop (dominio "improve-proposal-adopt"); cuerpo intacto.
async function handleProposalAdoptRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const { parseProposalActionPath, checkAdoptGuards, adoptProposal, readProposal } = await import("./measure/improvementRoutes");
  const parsedPA = parseProposalActionPath(pathname, "adopt");
  if ("error" in parsedPA) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedPA.error }));
    return;
  }
  const guardsPA = checkAdoptGuards(readProposal(parsedPA.id) ?? null, parsedPA.id);
  if (!guardsPA.ok) {
    res.writeHead(guardsPA.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: guardsPA.error }));
    return;
  }
  try {
    const adopted = adoptProposal(parsedPA.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, proposal: adopted }));
  } catch (e) {
    const codePA = (e as { status?: unknown })?.status === 404 ? 404 : 409;
    res.writeHead(codePA, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }));
  }
  return;
}

    // ── Ola 13: POST /factory/improve/proposals/:id/discard (humano descarta) ──
    // TANDA C: match en el loop (dominio "improve-proposal-discard"); cuerpo intacto.
async function handleProposalDiscardRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const { parseProposalActionPath, checkDiscardGuards, discardProposal, readProposal } = await import("./measure/improvementRoutes");
  const parsedPD = parseProposalActionPath(pathname, "discard");
  if ("error" in parsedPD) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: parsedPD.error }));
    return;
  }
  const guardsPD = checkDiscardGuards(readProposal(parsedPD.id) ?? null, parsedPD.id);
  if (!guardsPD.ok) {
    res.writeHead(guardsPD.code, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: guardsPD.error }));
    return;
  }
  try {
    const discarded = discardProposal(parsedPD.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, proposal: discarded }));
  } catch (e) {
    const codePD = (e as { status?: unknown })?.status === 404 ? 404 : 409;
    res.writeHead(codePD, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }));
  }
  return;
}

    // ── FASE 3 E2 — Bloque Rutas notifications (delegación delgada, C5 aditivo) ──
    // Dueño E2: notifications/notificationRoutes (listar con flags + ack por
    // id). Forma/handler intactos; solo la lectura delega.
    // GET /factory/notifications → {notifications, notificationsEnabled, osNotifications}
    // (centro apagado → `notifications: []` + flags; el store NO borra).
    // TANDA C: match en el loop (dominio "notifications-list"); cuerpo intacto.
async function handleNotificationsListRoute(res: http.ServerResponse): Promise<void> {
  try {
    const payload = buildNotificationsResponseE2();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `failed to list notifications: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` }));
    return;
  }
}

    // POST /factory/notifications/:id/ack → {ok:true, notification} o 404
    // {error:"notification not found"} si no existe. Espeja guards 404 + JSON.
    // TANDA C: match en el loop (dominio "notifications-ack"); cuerpo intacto.
async function handleNotificationAckRoute(pathname: string, res: http.ServerResponse): Promise<void> {
  const parsed = parseNotificationAckPathE2(pathname);
  if ("error" in parsed) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "notification not found" }));
    return;
  }
  const acked = ackNotificationByIdE2(parsed.id);
  if (!acked.ok) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "notification not found" }));
    return;
  }
  try {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, notification: acked.notification }));
    return;
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `failed to ack notification: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` }));
    return;
  }
}
    // ── FIN FASE 3 E2 — Bloque Rutas notifications ──

    // ── FASE 3 E2 — Bloque Ruta definition (delegación delgada, C5 aditivo) ──
    // Dueño E2: definition/definitionRoutes (estado validado con file/line/rule
    // para el badge). Forma/handler intactos; solo la lectura delega (el wrapper
    // `buildDefinitionStatusResponse` ya delega con el buildId de salud).
    // GET /factory/definition/status → {valid, issues, checkedAt, buildId}
    // (`buildId` = el mismo de /factory/health; `valid` = cero issues error).
    // TANDA C: match en el loop (dominio "definition-status"); cuerpo intacto.
async function handleDefinitionStatusRoute(res: http.ServerResponse): Promise<void> {
  try {
    const payload = buildDefinitionStatusResponse();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `failed to validate definition: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` }));
    return;
  }
}
    // ── FIN FASE 3 E2 — Bloque Ruta definition ──
  } catch (err) {
    console.error("[Factory] handleRequest error", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    try {
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    } catch {}
  }
}

// ── Disk restore: scan .agents/factory/*/job.json and reload Map ──
// Scans repo/.agents/factory and also external worktrees like C:\tmp\factory-lab-test/.agents/factory
// If .done exists -> state=done, otherwise keep state from job.json (queued/running)
/**
 * Parqueo honesto al tomar ownership (P3d): marca con UN evento los jobs en
 * estado obrero (Foreman/Building/Review) cuyo turno murió con el proceso
 * anterior. Idempotente: ya marcado y pendiente → skip (sin spam); retomado
 * y vuelto a caer → se marca de nuevo (el `resumed` posterior lo permite).
 * La marca persiste vía el evento (job.json) y la UI la muestra con Retomar.
 * Nunca lanza. Solo se llama tras `markPipelineLive` (ownership real).
 */
export function parkInterruptedJobs(): number {
  let parked = 0;
  try {
    const all = workItemStore.getMap();
    all.forEach((wi) => {
      try {
        if (!wi || typeof wi.id !== "string") return;
        const status: unknown = (wi as { status?: unknown }).status;
        if (typeof status !== "string") return;
        if (!(PARKABLE_STATUSES as readonly string[]).includes(status)) return;
        if (needsResume(status, wi.timeline)) return;
        workItemStore.appendEvent(
          wi.id,
          "system",
          `daemon reiniciado: turno interrumpido en ${status} — retomalo con Retomar cuando quieras`,
          { [BOOT_INTERRUPTED_META_KEY]: true, fromStatus: status } as unknown as Record<string, unknown>,
        );
        parked++;
      } catch {}
    });
  } catch {}
  if (parked > 0) {
    try {
      console.log(`[Factory] parqueados ${parked} jobs interrumpidos por reinicio (Retomar disponible)`);
    } catch {}
  }
  return parked;
}
export function restoreJobsFromDisk(): number {
  // Perf dev-boot (A1): se mide el restore completo; el log por job se
  // resume en una línea (566 líneas por boot tapaban todo).
  const restoreT0 = Date.now();
  const repoRoot = path.resolve(getRepoRoot());  // TANDA B: bases en startup/startupService (misma composición con
  // `path.join`; los `readdirSync/existsSync` vivos los hace el cascarón y
  // los inyecta como nombres; el `continue` ante base ausente lo hace el
  // loop). Carry-over B-R2: listado fs vivo, no a ciegas.
  let tmpNames: string[] = [];
  try {
    tmpNames = fs.readdirSync(os.tmpdir(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {}
  let cTmpNames: string[] = [];
  try {
    if (fs.existsSync("C:\\tmp")) {
      cTmpNames = fs.readdirSync("C:\\tmp", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    }
  } catch {}
  let wtNames: string[] = [];
  try {
    const wtBase = path.join(repoRoot, ".worktrees");
    if (fs.existsSync(wtBase)) {
      wtNames = fs.readdirSync(wtBase, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    }
  } catch {}
  const bases = new Set<string>(
    collectRestoreBasesB({ repoRoot, tmpdir: os.tmpdir(), tmpEntries: tmpNames, cTmpEntries: cTmpNames, worktreeEntries: wtNames }),
  );
  // P3b: sumar las bases del índice de job-dirs (worktrees arbitrarios fuera
  // de las bases fijas). Best-effort: el loop ya salta lo ausente/presente.
  try {
    readJobIndexBases().forEach((b) => {
      try {
        bases.add(b);
      } catch {}
    });
  } catch {}

  let restored = 0;
  // Ola 1: restore WorkItems via dedicated store (handles timeline/cost/runnerId)
  // TANDA 1: tienda única (el Map dual murió; el conteo sale del store).
  try {
    const wiRestored = workItemStore.restoreFromDisk();
    restored += wiRestored;
    if (wiRestored > 0) {
      console.log(`[Factory] restoreJobsFromDisk: workItemStore restored ${wiRestored}`);
    }
  } catch (e) {
    console.warn(`[Factory] workItemStore restore failed: ${String(e)}`);
  }
  // Perf boot (A3): set de dirs indexados (una lectura) + contador de
  // tmp-viejos salteados para el resumen.
  let restoreIndexedDirs = new Set<string>();
  try {
    restoreIndexedDirs = readJobIndexDirs();
  } catch {
    restoreIndexedDirs = new Set<string>();
  }
  let skippedTmp = 0;
  for (const base of bases) {
    try {
      if (!fs.existsSync(base)) continue;
      const jobDirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("job-"));
      for (const jd of jobDirs) {
        const jobDir = path.join(base, jd.name);
        const jobJsonPath = path.join(jobDir, "job.json");
        if (!fs.existsSync(jobJsonPath)) continue;
        // Perf boot (A3): tmp no-indexados (playgrounds muertos) se saltean
        // acá también — mismo predicado que el store. Nada se borra;
        // `RESTORE_TMP_FULL=1` restaura el comportamiento anterior.
        try {
          if (!shouldRestoreJobDir(jobDir, restoreIndexedDirs)) {
            skippedTmp += 1;
            continue;
          }
        } catch {
          // ante duda se restaura
        }
        // TANDA 1: tienda única (el store ya restauró; se salta lo presente).
        if (workItemStore.has(jd.name)) continue;
        try {
          const raw = fs.readFileSync(jobJsonPath, "utf-8");
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          // TANDA B: decisión pura en startup/startupService (mismo
          // state/status/timeline/cost/runnerId/sessionId/urls/refs; la
          // migración dashboard reusa jobs/resolveDashboardMigration con la
          // misma regla `||` + `!==`). El fs (`readFileSync`, `.done`,
          // logs) + store + `persistSingleStore` vivos quedan acá
          // (carry-over B-R1: disco/tienda vivos, no a ciegas).
          const decided0 = decideRestoreJobB(parsed, jd.name, jobDir, {
            resolveDirectory: resolveOpencodeDirectory,
            buildDashboardUrl,
            getBaseUrl: getOpencodeBaseUrlSync,
          });
          if (!decided0) throw new Error("restore decision null");
          let decided = decided0;
          try {
            if (fs.existsSync(path.join(jobDir, ".done"))) {
              decided = applyDotDoneB(decided0) ?? decided0;
            }
          } catch {}
          const id = decided.id;
          const prompt = decided.prompt;
          const worktree = decided.worktree;
          const phase = decided.phase;
          const finalState = decided.finalState;
          const finalStatus = decided.finalStatus;
          const sessionId = decided.sessionId;
          const directory = decided.directory;
          const finalDashboardUrl = decided.finalDashboardUrl;
          const modelRefDisk = decided.modelRef;
          const reviewerRefDisk = decided.reviewerRef;
          const createdAtRaw = decided.createdAtIso;
          const updatedAtRaw = decided.updatedAtIso;
          const finalTimeline = decided.finalTimeline as unknown as WorkItem["timeline"];
          const finalCost = decided.finalCost as unknown as WorkItem["cost"];
          const finalRunnerId = decided.finalRunnerId;
          const finalDotDonePath = decided.finalDotDonePath;
          const urlMigrated = decided.urlMigrated;
          let logs: string[] = [];
          try {
            const logsPath = path.join(jobDir, "logs.ndjson");
            if (fs.existsSync(logsPath)) {
              const content = fs.readFileSync(logsPath, "utf-8");
              logs = content.split("\n").filter((l) => l.length > 0);
            }
          } catch {}
          if (logs.length === 0) logs = [`[${new Date().toISOString()}] job ${id} restored from disk - worktree=${worktree} phase=${phase}`];
          // TANDA 1: tienda única (se construye el WorkItem directo, sin
          // objeto legacy intermedio; el Map dual murió).
          // Ola 1: ensure workItemStore has this job (tienda única)
          try {
            if (!workItemStore.get(id)) {
              const wi: WorkItem = {
                id,
                prompt,
                worktree,
                modelRef: modelRefDisk as unknown as WorkItem["modelRef"],
                reviewerRef: reviewerRefDisk as unknown as WorkItem["reviewerRef"],
                status: finalStatus,
                createdAt: new Date(createdAtRaw).getTime() ? new Date(createdAtRaw).toISOString() : new Date().toISOString(),
                updatedAt: new Date(updatedAtRaw).getTime() ? new Date(updatedAtRaw).toISOString() : new Date().toISOString(),
                timeline: finalTimeline,
                cost: finalCost,
                dir: jobDir,
                dotDonePath: finalDotDonePath,
                runnerId: finalRunnerId,
                phase,
                state: mapStatusToLegacyState(finalStatus),
                logs,
                ...(sessionId ? { sessionId } : {}),
                dashboardUrl: finalDashboardUrl,
                ...(directory ? { directory } : {}),
              };
              workItemStore.getMap().set(id, wi);
            }
          } catch {}
          // Persistir migracion a disco si URL cambio de generica/vieja a directa
          // TANDA 1: vía la tienda única (job.json + `.done` + poda).
          if (urlMigrated) {
            try {
              persistSingleStore(id);
            } catch {}
          }
          restored++;
          // Perf A1: sin log por job (eran 500+ líneas por boot); el resumen
          // con conteo + ms va al final de la función.
        } catch (e) {
          console.warn(`[Factory] no se pudo restaurar ${jobJsonPath}: ${String(e)}`);
        }
      }
    } catch {}
  }
  let restoreMs = 0;
  try {
    restoreMs = Date.now() - restoreT0;
  } catch {
    restoreMs = 0;
  }
  // Boot: el server opencode es NUEVO — toda sesión persistida de jobs NO
  // terminales está muerta (URLs con puerto efímero viejo, ej. 24511). Se
  // limpian para que el panel muestre "attaching" honesto en vez de links
  // muertos: ensureJobSessionAttached + el resume crean sesiones frescas.
  // Los terminales conservan su histórico. Best-effort, nunca lanza.
  try {
    let clearedSessions = 0;
    workItemStore.list().forEach((wi) => {
      try {
        if (wi.status === "Complete" || wi.status === "Cancelled") return;
        const rec = wi as unknown as Record<string, unknown>;
        const hadTop = typeof rec.sessionId === "string" || typeof rec.dashboardUrl === "string" || typeof rec.directory === "string";
        const hadRoles = rec.agentSessions !== null && typeof rec.agentSessions === "object" && !Array.isArray(rec.agentSessions) && Object.keys(rec.agentSessions as Record<string, unknown>).length > 0;
        if (!hadTop && !hadRoles) return;
        try {
          delete rec.sessionId;
          delete rec.dashboardUrl;
          delete rec.directory;
          delete rec.agentSessions;
        } catch {}
        try {
          persistSingleStore(wi.id);
          clearedSessions += 1;
        } catch {}
      } catch {}
    });
    if (clearedSessions > 0) console.log(`[Factory] sesiones muertas limpiadas en ${clearedSessions} job(s) no-terminales`);
  } catch {}
  if (restored > 0) console.log(`[Factory] restaurados ${restored} jobs desde disco en ${restoreMs}ms${skippedTmp > 0 ? ` (+${skippedTmp} tmp-viejos salteados, RESTORE_TMP_FULL=1 para incluirlos)` : ""}`);
  else console.log(`[Factory] no hay jobs previos en disco para restaurar`);
  // Retención C1: este loop escribe directo al Map (poda de
  // `workItemStore.restoreFromDisk` no lo ve) — se poda el excedente acá,
  // una vez, al final del restore completo. Disco intacto.
  try {
    const evicted = workItemStore.pruneTerminalFromMemory();
    if (evicted > 0) console.log(`[Factory] retención: ${evicted} terminales fuera de memoria`);
  } catch {
    // noop
  }
  return restored;
}

// ── Singleton probe: detect existing factory (rango efectivo) with timeout ──
async function probeExistingFactory(timeoutMs = 600): Promise<number | null> {
  const { start, end } = effectivePortRange();
  for (let p = start; p <= end; p++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`http://127.0.0.1:${p}/factory/health`, {
        signal: controller.signal as unknown as AbortSignal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(t);
      if (res.ok) {
        try {
          const body = (await res.json()) as unknown;
          if (body !== null && typeof body === "object" && "queue" in (body as Record<string, unknown>)) return p;
        } catch {}
        return p;
      }
    } catch {}
  }
  return null;
}

// ── Public API ──
export async function ensureFactoryServer(): Promise<number> {
  if (server && factoryPort !== null) return factoryPort;
  // Singleton check across processes: reuse existing healthy factory if any
  try {
    const existing = await probeExistingFactory(700);
    if (existing !== null) {
      console.warn(`[Factory] ya hay instancia en puerto ${existing}, reutilizando (evita duplicados)`);
      factoryPort = existing;
      // Ensure local Map is populated from disk for callers that inspect jobs locally (though remote owns storage, local cache helps)
      try {
        restoreJobsFromDisk();
      } catch {}
      return existing;
    }
  } catch (e) {
    console.warn(`[Factory] probeExistingFactory error: ${String(e)}`);
  }
  // Restore jobs from disk before starting (handles restart)
  try {
    restoreJobsFromDisk();
  } catch (e) {
    console.warn(`[Factory] restoreJobsFromDisk failed: ${String(e)}`);
  }

  // Try to detect opencode SDK - best effort, not required
  try {
    const mod = await import("@opencode-ai/sdk/v2");
    if (mod && typeof mod.createOpencodeServer === "function") {
      console.log("[Factory] @opencode-ai/sdk/v2 detected - factory http server will run alongside opencode if needed");
    }
  } catch {
    // opencode not installed or failed - http minimal is still REAL
  }

  // Robust port binding with retry on EADDRINUSE and singleton reuse
  let port = await findAvailablePort();
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    server = http.createServer((req, res) => {
      void handleRequest(req, res);
    });
    server.timeout = 30_000;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error & { code?: string }) => {
          server?.removeListener("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server?.removeListener("error", onError);
          resolve();
        };
        server!.once("error", onError);
        server!.once("listening", onListening);
        server!.listen(port, "127.0.0.1");
      });
      break; // success
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const msg = err instanceof Error ? err.message : String(err);
      // TANDA B: decisión de reintento en startup/startupService (misma
      // regla EADDRINUSE; el `listen` + `probarBind` vivos quedan acá).
      const isAddrInUse = shouldRetryBindB(code, msg);
      // Clean up failed server instance
      try {
        server?.close();
      } catch {}
      server = null;
      if (isAddrInUse) {
        console.warn(`[Factory] puerto ${port} ocupado al hacer listen (${msg}), probando reutilizar existente`);
        const existingRetry = await probeExistingFactory(700);
        if (existingRetry !== null) {
          console.warn(`[Factory] reutilizando instancia existente en puerto ${existingRetry} tras EADDRINUSE`);
          factoryPort = existingRetry;
          try {
            restoreJobsFromDisk();
          } catch {}
          return existingRetry;
        }
        attempts++;
        if (attempts < maxAttempts) {
          try {
            port = await findAvailablePort();
            console.warn(`[Factory] reintentando con puerto ${port} (intento ${attempts + 1}/${maxAttempts})`);
            continue;
          } catch (e) {
            throw err;
          }
        }
      }
      throw err;
    }
  }

  factoryPort = port;
  startedAt = Date.now();
  // Espejos de agentes al día en cada arranque (proyecto + global): la
  // fuente es factory/agents/*. Un espejo rancio serviría instrucciones
  // viejas a los jobs (caso punto-12). Best-effort, nunca frena el boot.
  try {
    const sync = await import("./opencodeAgentSync");
    try {
      const local = sync.syncFactoryAgentsToOpencode();
      console.log(`[Factory] agents sync proyecto: ${local.written.length} escritos, ${local.skipped.length} skips`);
    } catch (e) {
      console.warn(`[Factory] agents sync proyecto fail: ${String(e).slice(0, 120)}`);
    }
    try {
      const global = sync.syncFactoryAgentsGlobal();
      console.log(`[Factory] agents sync global: ${global.written.length} escritos, ${global.skipped.length} skips`);
    } catch (e) {
      console.warn(`[Factory] agents sync global fail: ${String(e).slice(0, 120)}`);
    }
  } catch {}
  try {
    ensureFactoryBuildId();
  } catch {}
  writeFactoryPortFile(port);
  console.log(`[Factory] listening on http://127.0.0.1:${port} (health: /factory/health)`);
  // Arma los efectos best-effort con LLM/procesos (reconciliación de
  // sesión, refresh de triage): fuera del boot quedan inertes para que
  // los tests que importan handlers no spawneen nada real.
  try {
    markPipelineLive();
  } catch {}

  // P3d: parqueo honesto (SOLO acá, cuando este proceso toma ownership del
  // pipeline — nunca en las rutas de reutilización/caché de arriba, donde
  // otro daemon puede seguir corriendo los workers). Ningún worker
  // sobrevivió al reinicio: todo job en estado obrero sin marca pendiente
  // quedó interrumpido y se marca UNA vez (ya marcado → skip, sin spam).
  try {
    parkInterruptedJobs();
  } catch {}

  // Levantar OpencodeServerManager efímero en background (no bloquea 201 ni health)
  void opencodeServerManager.ensureClient().then(() => {
    console.log(`[Factory] opencode manager ready ${opencodeServerManager.getUrl()}`);
  }).catch((e) => {
    console.warn(`[Factory] opencode manager ensure failed (fallback a 4096 discovery): ${String(e).slice(0, 120)}`);
  });

  // Also attempt to create opencode server on same port? No - separate service.
  // The http factory above is the source of truth for health even when opencode exists.

  return port;
}

export function closeFactoryServer(): void {
  if (server) {
    try {
      server.close();
    } catch {}
    server = null;
  }
  // close all SSE clients
  for (const [, set] of sseClients) {
    for (const res of set) {
      try {
        res.end();
      } catch {}
    }
  }
  sseClients.clear();
  cleanupFactoryPortFile();
  try { opencodeServerManager.close(); } catch {}
  factoryPort = null;
  startedAt = null;
  console.log("[Factory] closed");
}

export function getFactoryPort(): number {
  if (factoryPort === null) return effectivePortRange().start;
  return factoryPort;
}

export function getFactoryHealthSnapshot(): { pending: number; running: number; uptime: number; version: string } {
  // ── FASE 3 E2 — Snapshot salud (delegación delgada, C5 aditivo; forma intacta) ──
  // TANDA 1: tienda única (mismo conteo por estado derivado).
  try {
    const stored = workItemStore.list();
    return buildMinimalHealthSnapshotE2({
      pending: stored.filter((w) => (w.state ?? mapStatusToLegacyState(w.status)) === "queued").length,
      running: stored.filter((w) => (w.state ?? mapStatusToLegacyState(w.status)) === "running").length,
      uptime: startedAt ? Date.now() - startedAt : 0,
      version: VERSION,
    });
  } catch {
    const stored = workItemStore.list();
    const pending = stored.filter((w) => (w.state ?? mapStatusToLegacyState(w.status)) === "queued").length;
    const running = stored.filter((w) => (w.state ?? mapStatusToLegacyState(w.status)) === "running").length;
    return { pending, running, uptime: startedAt ? Date.now() - startedAt : 0, version: VERSION };
  }
}

// ── Standalone entry (node --loader tsx headless-runtime/factory/factoryServer.ts) ──
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].replace(/\\/g, "/").endsWith("factoryServer.ts") ||
    process.argv[1].replace(/\\/g, "/").endsWith("factoryServer.js"));

if (isDirectRun) {
  ensureFactoryServer()
    .then((port) => {
      console.log(`[Factory] standalone ready http://127.0.0.1:${port}/factory/health - Ctrl+C to stop`);
    })
    .catch((err) => {
      console.error("[Factory] failed to start standalone:", err);
      process.exit(1);
    });

  const shutdown = () => {
    closeFactoryServer();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}



